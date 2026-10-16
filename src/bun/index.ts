import { ApplicationMenu, BrowserWindow, Utils } from "electrobun/main";
import { resolve } from "node:path";
import { homedir } from "node:os";
import { startServer } from "../server/server";
import { fileDragBridge } from "./file-drag";
import { applicationMenu } from "./menu";

// Bundled entrypoint is Resources/app/bun/index.js; copies live in Resources/app.
const appRoot = resolve(import.meta.dir, "..");
const armDrag = fileDragBridge(resolve(appRoot, "helpers/file-drag.dylib"));
const app = startServer({
  webRoot: resolve(appRoot, "views/mainview"), helper: resolve(appRoot, "helpers/thumbnail"),
  metadataHelper: resolve(appRoot, "helpers/metadata"),
  shortlistPath: resolve(homedir(), "Library/Application Support/Fast Files/shortlist.json"),
  pickFolder: async () => (await Utils.openFileDialog({ canChooseFiles: false, canChooseDirectory: true, allowsMultipleSelection: false }))[0],
  reveal: path => { Utils.showItemInFolder(path); },
  openFolder: path => { Utils.openPath(path); },
  armDrag,
});
const window = new BrowserWindow({ title: "Fast Files", url: app.url, frame: { width: 1500, height: 960, x: 80, y: 60 } });
ApplicationMenu.setApplicationMenu(applicationMenu);
ApplicationMenu.on("application-menu-clicked", event => {
  if ((event as { data?: { action?: string } }).data?.action === "about") {
    window.webview.executeJavascript("document.getElementById('about-button')?.click()");
  }
});
void window;
