import * as Electron from "electron";

import {
  installOfflineNetworkGuard,
  isOfflineMode,
  isRemoteNetworkUrl,
} from "@t3tools/shared/offlineNetwork";

const blockRemoteRequests = (session: Electron.Session) => {
  session.webRequest.onBeforeRequest((details, callback) =>
    callback({ cancel: isRemoteNetworkUrl(details.url) }),
  );
  session.setSpellCheckerDictionaryDownloadURL("http://127.0.0.1:9/");
};

/** Must run before the app is ready: Chromium reads switches and announces sessions only then. */
export const installDesktopOfflineGuard = (): void => {
  if (!isOfflineMode()) return;
  installOfflineNetworkGuard();
  // Chromium's own DNS (prefetch, preconnect) never reaches webRequest.
  Electron.app.commandLine.appendSwitch(
    "host-resolver-rules",
    "MAP * ~NOTFOUND, EXCLUDE localhost",
  );
  Electron.app.on("session-created", blockRemoteRequests);
};
