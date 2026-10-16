import { BrowserWindow, Utils } from "electrobun/main";
import { resolve } from "node:path";
import { homedir } from "node:os";
import { startServer } from "../server/server";

// Bundled entrypoint is Resources/app/bun/index.js; copies live in Resources/app.
const appRoot = resolve(import.meta.dir, "..");
const app = startServer({
  webRoot: resolve(appRoot, "views/mainview"), helper: resolve(appRoot, "helpers/thumbnail"),
  shortlistPath: resolve(homedir(), "Library/Application Support/Fast Files/shortlist.json"),
  pickFolder: async () => (await Utils.openFileDialog({ canChooseFiles: false, canChooseDirectory: true, allowsMultipleSelection: false }))[0],
  reveal: path => { Utils.showItemInFolder(path); },
});
const window = new BrowserWindow({ title: "Fast Files", url: app.url, frame: { width: 1500, height: 960, x: 80, y: 60 } });
void window;
