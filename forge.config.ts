import { FusesPlugin } from "@electron-forge/plugin-fuses";
import { FuseV1Options, FuseVersion } from "@electron/fuses";
import { WebpackPlugin } from "@electron-forge/plugin-webpack";
import path from "path";

import type { ForgeConfig } from "@electron-forge/shared-types";

const mainConfig = require("./webpack.main.config");
const rendererConfig = require("./webpack.renderer.config");
const { buildMcpRuntime } = require("./scripts/copy-mcp-runtime.cjs");

const config: ForgeConfig = {
  packagerConfig: {
    asar: true,
    extraResource: [path.resolve(__dirname, ".mcp-runtime")],
  },
  rebuildConfig: {},
  makers: [
    {
      name: "@electron-forge/maker-squirrel",
      config: {},
    },
    {
      name: "@electron-forge/maker-zip",
      platforms: ["darwin"],
      config: {},
    },
    {
      name: "@electron-forge/maker-deb",
      config: {},
    },
    {
      name: "@electron-forge/maker-rpm",
      config: {},
    },
  ],
  hooks: {
    generateAssets: async () => {
      buildMcpRuntime(__dirname);
    },
  },
  plugins: [
    new FusesPlugin({
      version: FuseVersion.V1,
      [FuseV1Options.RunAsNode]: false,
      [FuseV1Options.EnableCookieEncryption]: true,
      [FuseV1Options.EnableNodeOptionsEnvironmentVariable]: false,
      [FuseV1Options.EnableNodeCliInspectArguments]: false,
      [FuseV1Options.EnableEmbeddedAsarIntegrityValidation]: true,
      [FuseV1Options.OnlyLoadAppFromAsar]: true,
    }),
    new WebpackPlugin({
      mainConfig,
      renderer: {
        config: rendererConfig,
        entryPoints: [
          {
            name: "main_window",
            html: "./src/renderer/index.html",
            js: "./src/renderer/renderer.tsx",
            preload: { js: "./src/preload/preload.ts" },
          },
        ],
      },
    }),
  ],
};

export default config;
