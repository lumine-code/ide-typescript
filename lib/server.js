// Where the editor can fetch a newer server than the one this package pins.
//
// An upgrade tier, not the only way in: the dependency below is always present,
// so uninstalling drops back to it and can never leave the user with nothing.
exports.managedServer = {
  source: "npm",
  displayName: "TypeScript Language Server",
  packages: ["typescript-language-server", { name: "typescript", version: "^6.0.3" }],
  module: "node_modules/typescript-language-server/lib/cli.mjs",
  bundled: true,
};

exports.resolveServer = async (context, configuredPath) => {
  const selection = await context.resolver.select({
    configuredPath,
    configuredKind: "auto",
    managed: () => {
      const install = context.getManagedServer();
      return install ? { path: install.modulePath, version: install.version } : null;
    },
    bundledPath: () => require.resolve("typescript-language-server/lib/cli.mjs"),
    kind: "node",
    allowShellWrapper: true,
  });
  if (!selection) return null;
  return context.resolver.launch(selection, {
    args: ["--stdio"],
    cwd: context.rootPath,
    transport: "stdio",
  });
};
