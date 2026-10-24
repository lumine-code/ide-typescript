const fs = require("fs");
const os = require("os");
const path = require("path");
const { pathToFileURL } = require("url");
const { serverContext } = require("./helpers/server-context");

let main, server;
const registerAdapter = () => {
  let adapter;
  const disposable = main.consumeIde({
    registerAdapter(value) {
      adapter = value;
      return { dispose() {} };
    },
  });
  return { adapter, disposable };
};

describe("ide-typescript native server", () => {
  let adapter, disposable;
  beforeEach(async () => {
    main = (await lumine.packages.activatePackage("ide-typescript")).mainModule;
    server = require("../lib/server");
    ({ adapter, disposable } = registerAdapter());
  });
  afterEach(async () => {
    disposable.dispose();
    await lumine.packages.deactivatePackage("ide-typescript");
  });

  it("launches the native compiler directly with the LSP stdio transport", async () => {
    const launch = await server.resolveServer(serverContext({ rootPath: __dirname }), "");
    expect(launch.command).toBe(
      server.nativeExecutable(require.resolve("typescript/package.json")),
    );
    expect(launch.command).not.toBe(process.execPath);
    expect(launch.args).toEqual(["--lsp", "--stdio"]);
    expect(launch.cwd).toBe(__dirname);
    expect(launch.transport).toBe("stdio");
    expect(launch.env?.ELECTRON_RUN_AS_NODE).toBeUndefined();
  });

  it("selects an explicit native executable before reading a managed installation", async () => {
    const getManagedServer = jasmine.createSpy("managed").and.throwError("Corrupt installation");
    const launch = await server.resolveServer(
      serverContext({ getManagedServer }),
      process.execPath,
    );
    expect(launch.command).toBe(process.execPath);
    expect(launch.args).toEqual(["--lsp", "--stdio"]);
    expect(getManagedServer).not.toHaveBeenCalled();
  });

  it("resolves the platform binary from the selected managed compiler generation", async () => {
    const manifest = require.resolve("typescript/package.json");
    const launch = await server.resolveServer(
      serverContext({ managedServer: { modulePath: manifest, version: "7.0.2" } }),
      "",
    );
    expect(launch.command).toBe(server.nativeExecutable(manifest));
    expect(launch.version).toBe("7.0.2");
  });

  it("reports a corrupt managed install before considering the bundled compiler", async () => {
    await expectAsync(
      server.resolveServer(
        serverContext({
          getManagedServer: () => {
            throw new Error("Corrupt installation");
          },
        }),
        "",
      ),
    ).toBeRejectedWithError("Corrupt installation");
  });

  it("preserves an unavailable selection as null", async () => {
    const resolver = { select: jasmine.createSpy("select").and.resolveTo(null) };
    expect(await server.resolveServer({ rootPath: __dirname, resolver }, "")).toBeNull();
  });

  it("registers native installation, project sessions and the standard workspace-symbol path", () => {
    expect(adapter.id).toBe("ide-typescript");
    expect(adapter.grammarScopes).toEqual([
      "source.js",
      "source.js.jsx",
      "source.ts",
      "source.tsx",
    ]);
    expect(adapter.caseSensitiveFileNames).toBe(process.platform !== "win32");
    expect(adapter.sessionScope).toBe("project-root");
    expect(adapter.settingsKeyPaths).toEqual(["ide-typescript"]);
    expect(adapter.restartKeyPaths).toEqual(["ide-typescript.serverPath"]);
    expect(adapter.bundledServer).toBe(true);
    expect(adapter.installServer).toBe(server.installServer);
    expect(adapter.latestServerVersion).toBe(server.latestServerVersion);
    expect(adapter.searchWorkspaceSymbols).toBeUndefined();
    expect(adapter.handleServerRequest).toBeUndefined();
  });

  it("uses pull diagnostics supported by the language-server client", () => {
    expect(adapter.getInitializationOptions()).toEqual({ disablePushDiagnostics: true });
  });

  it("uses the native configuration sections and includes all activated projects in symbol search", () => {
    const settings = adapter.getSettings();
    expect(Object.keys(settings)).toEqual(["js/ts", "typescript", "javascript", "editor"]);
    expect(settings["js/ts"].workspaceSymbols).toEqual({
      scope: "allOpenProjects",
      excludeLibrarySymbols: true,
    });
    expect(settings["js/ts"].suggest).toEqual({
      autoImports: true,
      includeCompletionsForImportStatements: true,
    });
    expect(adapter.getWorkspaceConfiguration("js/ts")).toEqual(settings["js/ts"]);
    expect(adapter.getWorkspaceConfiguration()).toEqual(settings);
    expect(adapter.getWorkspaceConfiguration("constructor")).toBeUndefined();
    expect(adapter.getWorkspaceConfiguration("__proto__")).toBeUndefined();
  });

  it("maps import style to the native preferences rather than tsserver initialization", () => {
    lumine.config.set("ide-typescript.preferences.quoteStyle", "single");
    lumine.config.set("ide-typescript.preferences.importModuleSpecifier", "relative");
    lumine.config.set("ide-typescript.preferences.autoImportFileExcludePatterns", [
      "**/internal/**",
    ]);
    const preferences = adapter.getSettings()["js/ts"].preferences;
    expect(preferences.quoteStyle).toBe("single");
    expect(preferences.importModuleSpecifier).toBe("relative");
    expect(preferences.autoImportFileExcludePatterns).toEqual(["**/internal/**"]);
  });

  it("uses the native inlay-hint configuration and inverts suppression switches", () => {
    lumine.config.set("ide-typescript.inlayHints.parameterNames", "literals");
    lumine.config.set("ide-typescript.inlayHints.parameterNamesWhenArgumentMatches", true);
    lumine.config.set("ide-typescript.inlayHints.functionReturnTypes", true);
    const hints = adapter.getSettings()["js/ts"].inlayHints;
    expect(hints.parameterNames).toEqual({
      enabled: "literals",
      suppressWhenArgumentMatchesName: false,
    });
    expect(hints.functionLikeReturnTypes.enabled).toBe(true);
    expect(hints.variableTypes.enabled).toBe(false);
    expect(hints.variableTypes.suppressWhenTypeMatchesName).toBe(true);
  });

  it("updates code-lens, locale and automatic-type-acquisition preferences", () => {
    lumine.config.set("ide-typescript.codeLens.references", true);
    lumine.config.set("ide-typescript.locale", "de");
    lumine.config.set("ide-typescript.disableAutomaticTypeAcquisition", true);
    const settings = adapter.getSettings()["js/ts"];
    expect(settings.referencesCodeLens.enabled).toBe(true);
    expect(settings.locale).toBe("de");
    expect(settings.tsserver.automaticTypeAcquisition.enabled).toBe(false);
  });

  it("removes controls for the retired Node tsserver implementation", () => {
    const { configSchema, dependencies } = require("../package.json");
    expect(dependencies).toEqual({ typescript: "7.0.2" });
    for (const name of [
      "tsserver",
      "completeFunctionCalls",
      "ignoredDiagnosticCodes",
      "implicitProjectConfiguration",
    ])
      expect(configSchema[name]).toBeUndefined();
    expect(configSchema.features.properties.callHierarchy.default).toBe(true);
    expect(configSchema.preferences.properties.maximumHoverLength).toBeUndefined();
    expect(configSchema.preferences.properties.includePackageJsonAutoImports).toBeUndefined();
  });

  it("answers editor formatting configuration from the requested document", async () => {
    const filePath = path.join(__dirname, "fixture.ts");
    const editor = await lumine.workspace.open(filePath);
    editor.setTabLength(3);
    editor.setSoftTabs(false);
    expect(adapter.getWorkspaceConfiguration("editor", pathToFileURL(filePath).href)).toEqual({
      tabSize: 3,
      insertSpaces: false,
    });
  });

  it("uses editor defaults for malformed resources and closed files", () => {
    lumine.config.set("editor.tabLength", 8);
    for (const uri of ["file://[", "file:///invalid%ZZ.ts", {}, "untitled:test.ts"]) {
      expect(main.uriToPath(uri)).toBeNull();
      expect(main.formattingOptions(uri).tabSize).toBe(8);
    }
    expect(adapter.getWorkspaceConfiguration("editor", "file:///nowhere/absent.ts").tabSize).toBe(
      8,
    );
  });

  it("matches native server-canonicalized Windows URIs to the open editor", () => {
    expect(main.uriToPath("file:///c%3A/Project/example.ts")).toBe("c:\\Project\\example.ts");
    expect(main.pathKey("C:\\Project\\example.ts", "win32")).toBe(
      main.pathKey("c:/Project/example.ts", "win32"),
    );
    expect(main.pathKey("/Project/Example.ts", "linux")).not.toBe(
      main.pathKey("/Project/example.ts", "linux"),
    );
    spyOn(lumine.workspace, "getTextEditors").and.returnValue([
      {
        getPath: () => "C:\\Project\\example.ts",
        getTabLength: () => 7,
        getSoftTabs: () => false,
      },
    ]);
    expect(main.formattingOptions("file:///c%3A/Project/example.ts", "win32")).toEqual({
      tabSize: 7,
      insertSpaces: false,
    });
  });

  describe("native platform package validation", () => {
    let directory;
    beforeEach(() => {
      directory = fs.mkdtempSync(path.join(os.tmpdir(), "ide-ts-native-"));
    });
    afterEach(() => fs.rmSync(directory, { recursive: true, force: true }));
    it("rejects a classic TypeScript SDK instead of launching a Node tsserver", () => {
      const manifest = path.join(directory, "package.json");
      fs.writeFileSync(manifest, JSON.stringify({ name: "typescript", version: "6.0.3" }));
      expect(() => server.nativeExecutable(manifest)).toThrowError(/native TypeScript 7/);
    });
    it("rejects a compiler with no published binary for the selected platform", () => {
      const manifest = path.join(directory, "package.json");
      fs.writeFileSync(manifest, JSON.stringify({ name: "typescript", version: "7.0.2" }));
      expect(() => server.nativeExecutable(manifest)).toThrowError(/no native server/);
    });
    it("rejects a platform binary left over from a different compiler generation", () => {
      const dependency = "@typescript/typescript-" + process.platform + "-" + process.arch;
      const packageDirectory = path.join(directory, "node_modules", dependency);
      fs.mkdirSync(packageDirectory, { recursive: true });
      fs.writeFileSync(
        path.join(packageDirectory, "package.json"),
        JSON.stringify({ version: "7.0.1" }),
      );
      const manifest = path.join(directory, "package.json");
      fs.writeFileSync(
        manifest,
        JSON.stringify({
          name: "typescript",
          version: "7.0.2",
          optionalDependencies: { [dependency]: "7.0.2" },
        }),
      );
      expect(() => server.nativeExecutable(manifest)).toThrowError(/does not match/);
    });
  });

  describe("managed native compiler installation", () => {
    let api, signal;
    beforeEach(() => {
      signal = new AbortController().signal;
      api = {
        signal,
        npmPackageLatestVersion: jasmine.createSpy("latest").and.resolveTo("7.0.2"),
        npmInstallPackage: jasmine.createSpy("install").and.resolveTo(),
        npmPackageInstalledVersion: jasmine.createSpy("installed").and.returnValue("7.0.2"),
        setServerInstallationStatus: jasmine.createSpy("status"),
      };
    });
    it("installs with npm so optional platform binaries are materialized", async () => {
      const result = await server.installServer({
        storagePath: __dirname,
        version: "7.0.2",
        api,
        signal,
      });
      expect(api.npmInstallPackage).toHaveBeenCalledOnceWith("typescript", "7.0.2", __dirname, {
        signal,
      });
      expect(result).toEqual({ module: "node_modules/typescript/package.json", version: "7.0.2" });
    });
    it("discovers the latest native compiler for managed upgrades", async () => {
      expect(await server.latestServerVersion(api)).toBe("7.0.2");
      await server.installServer({ storagePath: __dirname, api, signal });
      expect(api.npmInstallPackage).toHaveBeenCalledOnceWith("typescript", "7.0.2", __dirname, {
        signal,
      });
    });
    it("rejects a requested classic compiler before installation", async () => {
      await expectAsync(
        server.installServer({ storagePath: __dirname, version: "6.0.3", api, signal }),
      ).toBeRejectedWithError(/TypeScript 7/);
      expect(api.npmInstallPackage).not.toHaveBeenCalled();
    });
    it("does not publish a cancelled or incomplete installation", async () => {
      const owner = new AbortController();
      api.npmInstallPackage.and.callFake(async () => owner.abort(new Error("cancelled")));
      await expectAsync(
        server.installServer({
          storagePath: __dirname,
          version: "7.0.2",
          api,
          signal: owner.signal,
        }),
      ).toBeRejectedWithError("cancelled");
      expect(api.npmPackageInstalledVersion).not.toHaveBeenCalled();
    });
    it("rejects an installation without a native compiler version", async () => {
      api.npmPackageInstalledVersion.and.returnValue(null);
      await expectAsync(
        server.installServer({ storagePath: __dirname, version: "7.0.2", api, signal }),
      ).toBeRejectedWithError(/no native compiler/);
    });
  });
});
