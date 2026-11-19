import * as Electron from "electron";

import {
  installOfflineNetworkGuard,
  isOfflineMode,
  isRemoteNetworkUrl,
} from "@t3tools/shared/offlineNetwork";

const blockRemoteRequests = (session: Electron.Session) => {
  session.webRequest.onBeforeRequest(
    { urls: ["http://*/*", "https://*/*", "ws://*/*", "wss://*/*", "ftp://*/*"] },
    (details, callback) => callback({ cancel: isRemoteNetworkUrl(details.url) }),
  );
  session.setSpellCheckerDictionaryDownloadURL("http://127.0.0.1:9/");
};

/** Must run before the app is ready, so every session, the default one included, is covered. */
export const installDesktopOfflineGuard = (): void => {
  if (!isOfflineMode()) return;
  installOfflineNetworkGuard();
  Electron.app.on("session-created", blockRemoteRequests);
};
