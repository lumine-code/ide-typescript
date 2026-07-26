const fs = require("fs");

exports.resolveServer = async (configuredPath) => {
  if (configuredPath) {
    await fs.promises.access(configuredPath, fs.constants.X_OK);
    return { command: configuredPath, args: ["--stdio"] };
  }

  // The exact server dependency ships with this package. Invoking its module
  // through the editor's Node executable avoids platform-specific .bin shims.
  const serverModule = require.resolve("typescript-language-server/lib/cli.mjs");
  return {
    command: process.execPath,
    args: [serverModule, "--stdio"],
    env: { ELECTRON_RUN_AS_NODE: "1" },
  };
};
