import Electrobun, { ApplicationMenu, BrowserWindow, Utils } from "electrobun/main";
import { resolve } from "node:path";
import { homedir } from "node:os";
import { startServer } from "../server/server";
import { WorkQueue } from "../server/queue";
import { ShortlistStore } from "../server/shortlist";
import { fileDragBridge } from "./file-drag";
import { applicationMenu } from "./menu";

// Bundled entrypoint is Resources/app/bun/index.js; copies live in Resources/app.
const appRoot = resolve(import.meta.dir, "..");
const armDrag = fileDragBridge(resolve(appRoot, "helpers/file-drag.dylib"));
const queue = new WorkQueue(500 * 1024 ** 2, 3);
const shortlist = new ShortlistStore(resolve(homedir(), "Library/Application Support/Fast Files/shortlist.json"));
const windows = new Map<number, { window: BrowserWindow; dispose: () => void }>();
let nextWindow = 0, focused: number | undefined;
function createWindow(showAbout = false) {
  const ordinal = ++nextWindow;
  // A unique title also binds native drag requests to the originating window.
  const title = `Fast Files — ${ordinal}`;
  const session = startServer({
    webRoot: resolve(appRoot, "views/mainview"), helper: resolve(appRoot, "helpers/thumbnail"),
    metadataHelper: resolve(appRoot, "helpers/metadata"), shortlist, queue,
    pickFolder: async () => (await Utils.openFileDialog({ canChooseFiles: false, canChooseDirectory: true, allowsMultipleSelection: false }))[0],
    reveal: path => { Utils.showItemInFolder(path); },
    openFolder: path => { Utils.openPath(path); },
    armDrag: (paths, startedAt) => armDrag(paths, title, startedAt),
    newWindow: createWindow,
  });
  try {
    const offset = ((ordinal - 1) % 8) * 24;
    const window = new BrowserWindow({ title, url: showAbout ? session.url.replace("/#", "/?about=1#") : session.url, frame: { width: 1500, height: 960, x: 80 + offset, y: 60 + offset } });
    windows.set(window.id, { window, dispose: session.dispose }); focused = window.id;
    window.on("focus", () => { focused = window.id; });
    window.on("close", () => {
      session.dispose(); windows.delete(window.id);
      if (focused === window.id) focused = [...windows.keys()].at(-1);
    });
  } catch (error) { session.dispose(); throw error; }
}
ApplicationMenu.setApplicationMenu(applicationMenu);
ApplicationMenu.on("application-menu-clicked", event => {
  const action = (event as { data?: { action?: string } }).data?.action;
  if (action === "new-window") { createWindow(); return; }
  const window = focused === undefined ? undefined : windows.get(focused)?.window;
  if (action === "about" || action === "select-all") {
    if (!window) { if (action === "about") createWindow(true); return; }
    const target = focused === undefined ? undefined : windows.get(focused)?.window;
    target?.webview.executeJavascript(`window.dispatchEvent(new CustomEvent('fast-files-command', { detail: ${JSON.stringify(action)} }))`);
  }
});
// Closing the last window leaves the app menu available for Command-N.
Electrobun.events.on("reopen", () => {
  if (!windows.size) createWindow();
  else windows.get(focused ?? [...windows.keys()].at(-1)!)?.window.activate();
});
createWindow();
