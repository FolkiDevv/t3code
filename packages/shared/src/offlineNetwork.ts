// @effect-diagnostics nodeBuiltinImport:off -- Patches Node's own socket and DNS entry points before any runtime starts.
import * as NodeModule from "node:module";
import * as NodeNet from "node:net";

/**
 * Offline is the default: T3 Code opens no connection to a non-loopback host unless
 * T3CODE_OFFLINE is explicitly "0" or "false". Loopback stays open for local servers and models.
 */
const OFFLINE_ENV_VAR = "T3CODE_OFFLINE";

export const isOfflineMode = (env: NodeJS.ProcessEnv = process.env): boolean => {
  const value = env[OFFLINE_ENV_VAR]?.trim().toLowerCase();
  return value !== "0" && value !== "false";
};

const loopback = new NodeNet.BlockList();
loopback.addSubnet("127.0.0.0", 8, "ipv4");
loopback.addAddress("0.0.0.0", "ipv4");
loopback.addAddress("::1", "ipv6");
loopback.addAddress("::", "ipv6");
loopback.addSubnet("::ffff:127.0.0.0", 104, "ipv6");

const normalizeHost = (rawHost: string) =>
  rawHost
    .trim()
    .toLowerCase()
    .replace(/^\[|\]$/g, "")
    .replace(/\.$/, "");

const allowedHosts = new Set<string>();

/** Lets this process reach a host on this machine that is not loopback, such as a WSL distro. */
export const allowOfflineHost = (host: string): void => {
  allowedHosts.add(normalizeHost(host));
};

const isLoopbackHost = (rawHost: string): boolean => {
  const host = normalizeHost(rawHost);
  if (host === "localhost" || host.endsWith(".localhost") || allowedHosts.has(host)) return true;
  const family = NodeNet.isIP(host);
  if (family === 0) return false;
  return loopback.check(host, family === 4 ? "ipv4" : "ipv6");
};

const NETWORK_PROTOCOLS = new Set(["http:", "https:", "ws:", "wss:", "ftp:"]);

/** Whether loading this URL would leave the machine. Non-network schemes never do. */
export const isRemoteNetworkUrl = (url: string): boolean => {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  return NETWORK_PROTOCOLS.has(parsed.protocol) && !isLoopbackHost(parsed.hostname);
};

const LOOPBACK_SOURCES = ["localhost", "127.0.0.1", "[::1]"]
  .flatMap((host) => ["http", "https", "ws", "wss"].map((scheme) => `${scheme}://${host}:*`))
  .join(" ");

/** Keeps a browser client on its own origin and loopback. Sources follow the desktop policy. */
export const OFFLINE_CONTENT_SECURITY_POLICY = [
  "script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval'",
  "worker-src 'self' blob:",
  "style-src 'self' 'unsafe-inline'",
  "object-src 'self' blob:",
  `connect-src 'self' blob: ${LOOPBACK_SOURCES}`,
  `img-src 'self' data: blob: ${LOOPBACK_SOURCES}`,
  `media-src 'self' data: blob: ${LOOPBACK_SOURCES}`,
  `font-src 'self' data: ${LOOPBACK_SOURCES}`,
  `frame-src 'self' data: blob: ${LOOPBACK_SOURCES}`,
].join("; ");

const offlineNetworkError = (target: string): NodeJS.ErrnoException =>
  Object.assign(
    new Error(
      `T3 Code is offline: blocked network access to ${target}. Set ${OFFLINE_ENV_VAR}=0 to allow it.`,
    ),
    { code: "ENETUNREACH", syscall: "connect" },
  );

/** Unroutable proxy for T3 Code's own git and host CLI runs; NO_PROXY keeps loopback reachable. */
export const offlineChildProcessEnv = (
  env: NodeJS.ProcessEnv = process.env,
): Record<string, string> => {
  if (!isOfflineMode(env)) return {};
  const proxy = "http://127.0.0.1:9";
  const noProxy = "localhost,127.0.0.1,::1";
  return {
    GIT_ALLOW_PROTOCOL: "file",
    HTTP_PROXY: proxy,
    HTTPS_PROXY: proxy,
    ALL_PROXY: proxy,
    http_proxy: proxy,
    https_proxy: proxy,
    all_proxy: proxy,
    NO_PROXY: noProxy,
    no_proxy: noProxy,
  };
};

type ConnectArgs = ReadonlyArray<unknown>;

// Mirrors net's normalizeArgs: connect(options), connect(path), connect(port, host), or the
// pre-normalized [options, callback] array that net.connect and tls.connect pass.
export const blockedConnectTarget = (args: ConnectArgs): string | null => {
  const first: unknown = Array.isArray(args[0]) ? args[0][0] : args[0];
  let host: unknown;
  let port: unknown;
  if (first !== null && typeof first === "object") {
    const options = first as { path?: unknown; host?: unknown; port?: unknown };
    // net picks IPC only for a truthy path; an empty one still connects over TCP.
    if (options.path) return null;
    host = options.host;
    port = options.port;
  } else if (typeof first === "string" && Number.isNaN(Number(first))) {
    return null;
  } else {
    port = first;
    host = args[1];
  }
  const hostname = typeof host === "string" && host.length > 0 ? host : "localhost";
  return isLoopbackHost(hostname) ? null : `${hostname}:${String(port)}`;
};

let installed = false;

/**
 * Blocks every non-loopback TCP/TLS connection and DNS query in this process: http, https,
 * fetch, WebSocket and http2 all connect through net.Socket. IPC sockets stay open.
 */
export const installOfflineNetworkGuard = (): void => {
  if (installed) return;
  installed = true;

  const originalConnect = NodeNet.Socket.prototype.connect;
  NodeNet.Socket.prototype.connect = function (this: NodeNet.Socket, ...args: Array<unknown>) {
    const target = blockedConnectTarget(args);
    if (target === null) {
      return Reflect.apply(originalConnect, this, args) as NodeNet.Socket;
    }
    const error = offlineNetworkError(target);
    process.nextTick(() => this.destroy(error));
    return this;
  } as typeof originalConnect;

  // The CommonJS exports object is writable; syncBuiltinESMExports republishes it to ESM imports.
  const dns = process.getBuiltinModule("node:dns");
  // An IP literal resolves locally, without a query.
  const isAllowedName = (hostname: unknown) =>
    typeof hostname === "string" && (isLoopbackHost(hostname) || NodeNet.isIP(hostname) !== 0);
  const dnsError = (hostname: unknown, syscall: string) =>
    Object.assign(offlineNetworkError(String(hostname)), { syscall, hostname });

  const originalLookup = dns.lookup;
  dns.lookup = function (hostname: unknown, ...rest: Array<unknown>) {
    if (isAllowedName(hostname)) return Reflect.apply(originalLookup, dns, [hostname, ...rest]);
    const callback = rest.at(-1);
    if (typeof callback === "function") {
      process.nextTick(() => callback(dnsError(hostname, "getaddrinfo")));
    }
  } as typeof dns.lookup;
  const originalPromiseLookup = dns.promises.lookup;
  dns.promises.lookup = ((hostname: string, ...rest: Array<unknown>) =>
    isAllowedName(hostname)
      ? Reflect.apply(originalPromiseLookup, dns.promises, [hostname, ...rest])
      : Promise.reject(dnsError(hostname, "getaddrinfo"))) as typeof dns.promises.lookup;

  // resolve*, reverse and lookupService always query a DNS server, even for loopback names.
  const blockQueries = (target: Record<string, unknown>, async: boolean) => {
    for (const key of Object.getOwnPropertyNames(target)) {
      if (!/^(resolve|reverse|lookupService)/.test(key) || typeof target[key] !== "function")
        continue;
      target[key] = (...args: Array<unknown>) => {
        const error = dnsError(args[0], key);
        if (async) return Promise.reject(error);
        const callback = args.at(-1);
        if (typeof callback === "function") process.nextTick(() => callback(error));
      };
    }
  };
  blockQueries(dns as unknown as Record<string, unknown>, false);
  blockQueries(dns.promises as unknown as Record<string, unknown>, true);
  blockQueries(dns.Resolver.prototype as unknown as Record<string, unknown>, false);
  blockQueries(dns.promises.Resolver.prototype as unknown as Record<string, unknown>, true);

  NodeModule.syncBuiltinESMExports();
};
