const fs = require("fs");
const path = require("path");

const PACKAGE = "typescript";
const MODULE = "node_modules/typescript/package.json";
const isNativeVersion = (version) => Number.parseInt(version, 10) >= 7;

const nativeExecutable = (manifestPath, platform = process.platform, arch = process.arch) => {
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  if (manifest.name !== PACKAGE || !isNativeVersion(manifest.version))
    throw new Error("The TypeScript language server requires a native TypeScript 7 installation.");
  const platformPackage = `@typescript/typescript-${platform}-${arch}`;
  if (!manifest.optionalDependencies?.[platformPackage])
    throw new Error(`TypeScript publishes no native server for ${platform}-${arch}.`);
  const platformManifest = require.resolve(`${platformPackage}/package.json`, {
    paths: [path.dirname(manifestPath)],
  });
  if (JSON.parse(fs.readFileSync(platformManifest, "utf8")).version !== manifest.version)
    throw new Error("The TypeScript native binary does not match the compiler version.");
  return path.join(path.dirname(platformManifest), "lib", platform === "win32" ? "tsc.exe" : "tsc");
};

// npm also installs the platform-specific optional binary. The JavaScript
// package alone contains only a launcher, not a native language server.
exports.latestServerVersion = (api) => api.npmPackageLatestVersion(PACKAGE);
exports.installServer = async ({ storagePath, version, api, signal = api.signal }) => {
  signal?.throwIfAborted();
  const requested = version || (await api.npmPackageLatestVersion(PACKAGE, { signal }));
  if (!isNativeVersion(requested))
    throw new Error("Choose TypeScript 7 or newer for the native language server.");
  api.setServerInstallationStatus("installing");
  await api.npmInstallPackage(PACKAGE, requested, storagePath, { signal });
  signal?.throwIfAborted();
  const installed = api.npmPackageInstalledVersion(PACKAGE, storagePath);
  if (!isNativeVersion(installed))
    throw new Error("The TypeScript installation contains no native compiler version.");
  return { module: MODULE, version: installed };
};

exports.resolveServer = async (context, configuredPath) => {
  const selection = await context.resolver.select({
    configuredPath,
    configuredKind: "executable",
    managed: () => {
      const install = context.getManagedServer();
      return install
        ? { path: nativeExecutable(install.modulePath), version: install.version }
        : null;
    },
    bundledPath: () => nativeExecutable(require.resolve("typescript/package.json")),
    kind: "executable",
  });
  if (!selection) return null;
  // A Node CLI wrapper would put an extra process between the session's
  // lifetime and the native server on Windows.
  return context.resolver.launch(selection, {
    args: ["--lsp", "--stdio"],
    cwd: context.rootPath,
    transport: "stdio",
  });
};

exports.nativeExecutable = nativeExecutable;
