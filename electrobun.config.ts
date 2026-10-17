import type { ElectrobunConfig } from "electrobun";

export default {
  app: { name: "Fast Files", identifier: "dev.fastfiles.viewer", version: "0.1.0" },
  runtime: { exitOnLastWindowClosed: false },
  scripts: { preBuild: "scripts/prebuild.ts" },
  build: {
    mainProcess: "bun",
    mac: { icons: "icon.iconset" },
    bun: { entrypoint: "src/bun/index.ts" },
    copy: {
      "dist/web": "views/mainview",
      ".cache/thumbnail": "helpers/thumbnail",
      ".cache/file-drag.dylib": "helpers/file-drag.dylib",
      ".cache/metadata": "helpers/metadata",
    },
  },
} satisfies ElectrobunConfig;
