import { describe, expect, it } from "vite-plus/test";

import {
  blockedConnectTarget,
  isOfflineMode,
  isRemoteNetworkUrl,
  offlineChildProcessEnv,
} from "./offlineNetwork.ts";

describe("isOfflineMode", () => {
  it.each([
    [undefined, true],
    ["", true],
    ["1", true],
    ["yes", true],
    ["0", false],
    [" false ", false],
    ["FALSE", false],
  ])("T3CODE_OFFLINE=%j is offline: %s", (value, offline) => {
    expect(isOfflineMode(value === undefined ? {} : { T3CODE_OFFLINE: value })).toBe(offline);
    expect(Object.keys(offlineChildProcessEnv({ T3CODE_OFFLINE: value })).length > 0).toBe(offline);
  });
});

describe("blockedConnectTarget", () => {
  it.each([
    ["options to a remote host", [{ host: "example.com", port: 443 }], "example.com:443"],
    ["port and host", [80, "10.0.0.2"], "10.0.0.2:80"],
    ["numeric string port", ["8080", "192.168.1.5"], "192.168.1.5:8080"],
    ["pre-normalized args", [[{ host: "2001:db8::1", port: 22 }, () => {}]], "2001:db8::1:22"],
    ["IPv4-mapped public address", [{ host: "::ffff:8.8.8.8", port: 53 }], "::ffff:8.8.8.8:53"],
    [
      "localhost subdomain lookalike",
      [{ host: "localhost.example.com", port: 80 }],
      "localhost.example.com:80",
    ],
    ["loopback IPv4", [{ host: "127.0.0.53", port: 53 }], null],
    ["loopback IPv6", [{ host: "::1", port: 80 }], null],
    ["IPv4-mapped loopback", [{ host: "::ffff:127.0.0.1", port: 80 }], null],
    ["localhost", [3000, "LOCALHOST."], null],
    ["*.localhost", [{ host: "app.localhost", port: 80 }], null],
    ["default host", [{ port: 80 }], null],
    ["IPC path option", [{ path: "/tmp/t3.sock" }], null],
    ["IPC path string", ["\\\\.\\pipe\\t3"], null],
  ])("%s", (_name, args, expected) => {
    expect(blockedConnectTarget(args)).toBe(expected);
  });
});

describe("isRemoteNetworkUrl", () => {
  it.each([
    ["https://www.google.com/s2/favicons?domain=x", true],
    ["wss://relay.example.com/ws", true],
    ["http://192.168.1.10:3773/", true],
    ["http://127.0.0.1:5173/", false],
    ["ws://[::1]:3773/ws", false],
    ["http://localhost/", false],
    ["t3code://app/index.html", false],
    ["data:image/png;base64,AA==", false],
    ["devtools://devtools/bundled/inspector.html", false],
    ["not a url", false],
  ])("%s → %s", (url, remote) => {
    expect(isRemoteNetworkUrl(url)).toBe(remote);
  });
});
