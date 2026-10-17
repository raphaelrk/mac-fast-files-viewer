import type { ApplicationMenuItemConfig } from "electrobun/main";

// Application-scoped native accelerators; never register Quit globally.
// Electrobun menu accelerators are single keys (Command on macOS).
export const applicationMenu: ApplicationMenuItemConfig[] = [
  { label: "Fast Files", submenu: [
    { label: "About Fast Files", action: "about" },
    { type: "separator" },
    { role: "hide" }, { role: "hideOthers" }, { role: "showAll" },
    { type: "separator" },
    { label: "Quit Fast Files", role: "quit", accelerator: "q" },
  ] },
  { label: "File", submenu: [
    { label: "New Window", action: "new-window", accelerator: "n" },
    { label: "Close Window", role: "close", accelerator: "w" },
  ] },
  { label: "Edit", submenu: [
    { role: "undo", accelerator: "z" }, { role: "redo", accelerator: "Z" }, { type: "separator" },
    { role: "cut", accelerator: "x" }, { role: "copy", accelerator: "c" }, { role: "paste", accelerator: "v" },
    { label: "Select All", action: "select-all", accelerator: "a" },
  ] },
  { label: "Window", submenu: [{ role: "minimize" }, { role: "zoom" }] },
];
