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
  { label: "Edit", submenu: [
    { role: "undo" }, { role: "redo" }, { type: "separator" },
    { role: "cut" }, { role: "copy" }, { role: "paste" }, { role: "selectAll" },
  ] },
  { label: "Window", submenu: [{ role: "minimize" }, { role: "zoom" }, { role: "close" }] },
];
