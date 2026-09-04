const fs = require("fs");
const path = require("path");
const { pathToFileURL } = require("url");
const { resolveServer, managedServer } = require("../lib/server");
const main = require("../lib/main");
const { formattingOptions, pathKey, uriToPath } = main;

const registerAdapter = () => {
  let adapter;
  const disposable = main.consumeIdeClient({
    registerAdapter(registered) {
      adapter = registered;
      return { dispose() {} };
    },
    getSessions: () => [],
    restart: async () => {},
  });
  return { adapter, disposable };
};

describe("ide-typescript server resolution", () => {
  it("prefers the configured path", async () => {
    const launch = await resolveServer(process.execPath);
    expect(launch.command).toBe(process.execPath);
    expect(launch.args).toEqual(["--stdio"]);
  });
  it("falls back to the bundled server module", async () => {
    const launch = await resolveServer("");
    expect(launch.command).toBe(process.execPath);
    expect(fs.existsSync(launch.args[0])).toBe(true);
    expect(launch.env.ELECTRON_RUN_AS_NODE).toBe("1");
  });

  it("prefers a managed install over the bundled server", async () => {
    const managed = { modulePath: "/managed/server.js", version: "9.9.9" };
    const launch = await resolveServer("", managed);
    expect(launch.args[0]).toBe(managed.modulePath);
    // Reported in the session details, so which copy is running is visible.
    expect(launch.version).toBe("9.9.9");
    expect((await resolveServer(process.execPath, managed)).command).toBe(process.execPath);
  });

  it("declares the bundled floor so uninstall falls back", () => {
    // The dependency is always present, so removing the managed copy returns to
    // a working server rather than to none.
    expect(managedServer.source).toBe("npm");
    expect(managedServer.bundled).toBe(true);
    expect(managedServer.module).toContain("node_modules/");
    expect(managedServer.packages).toEqual([
      "typescript-language-server",
      { name: "typescript", version: "^6.0.3" },
    ]);
  });
});

describe("ide-typescript adapter", () => {
  let adapter;
  let disposable;

  beforeEach(async () => {
    // Applies the configSchema, so the defaults the adapter reads are the ones
    // the manifest declares rather than undefined.
    await lumine.packages.activatePackage("ide-typescript");
    ({ adapter, disposable } = registerAdapter());
  });
  afterEach(async () => {
    disposable.dispose();
    await lumine.packages.deactivatePackage("ide-typescript");
  });

  it("registers with the language-server service", async () => {
    expect(adapter.id).toBe("ide-typescript");
    expect(adapter.grammarScopes).toContain("source.ts");
    expect(adapter.grammarScopes).toContain("source.js");
    expect(adapter.settingsKeyPaths).toEqual(["ide-typescript"]);
    expect(adapter.restartKeyPaths).toEqual([
      "ide-typescript.serverPath",
      "ide-typescript.tsserver",
      "ide-typescript.locale",
      "ide-typescript.disableAutomaticTypeAcquisition",
      "ide-typescript.preferences",
      "ide-typescript.completeFunctionCalls",
    ]);
    const launch = await adapter.resolveServer({ rootPath: __dirname });
    expect(launch.cwd).toBe(__dirname);
    expect(launch.transport).toBe("stdio");
  });

  it("asks the server to offer completions from other modules", () => {
    const { preferences } = adapter.getInitializationOptions();

    // Verified against typescript-language-server 6.0: without this the server
    // still lists symbols from other modules, but `completionItem/resolve`
    // returns no `additionalTextEdits` for them — so accepting one inserts the
    // symbol and leaves the file without its import, silently uncompilable.
    expect(preferences.includeCompletionsForModuleExports).toBe(true);
    expect(preferences.includeCompletionsForImportStatements).toBe(true);
  });

  it("advertises Move to File only while the refactor rename UI is active", () => {
    const editor = {};
    const target = {};
    spyOn(lumine.workspace, "getTextEditors").and.returnValue([editor]);
    spyOn(lumine.views, "getView").and.returnValue(target);
    spyOn(lumine.commands, "findCommands").and.returnValue([]);

    expect(adapter.getInitializationOptions().supportsMoveToFileCodeAction).toBe(false);
    lumine.commands.findCommands.and.returnValue([{ name: "refactor:rename" }]);
    expect(adapter.getInitializationOptions().supportsMoveToFileCodeAction).toBe(true);
  });

  it("reveals and awaits the refactor UI requested by Move to File", async () => {
    const filePath = path.join(__dirname, "move-target.ts");
    const target = {};
    const editor = { setCursorBufferPosition: jasmine.createSpy("setCursorBufferPosition") };
    spyOn(lumine.workspace, "open").and.returnValue(Promise.resolve(editor));
    spyOn(lumine.views, "getView").and.returnValue(target);
    spyOn(lumine.commands, "findCommands").and.returnValue([{ name: "refactor:rename" }]);
    let finishRename;
    const renameFinished = new Promise((resolve) => (finishRename = resolve));
    spyOn(lumine.commands, "dispatch").and.returnValue(renameFinished);

    let settled = false;
    const pending = adapter
      .handleServerRequest("_typescript.rename", {
        textDocument: { uri: pathToFileURL(filePath).href },
        position: { line: 4, character: 7 },
      })
      .then((result) => {
        settled = true;
        return result;
      });
    await Promise.resolve();
    await Promise.resolve();

    expect(lumine.workspace.open).toHaveBeenCalledOnceWith(filePath, { activateItem: true });
    expect(editor.setCursorBufferPosition).toHaveBeenCalledOnceWith([4, 7], {
      autoscroll: true,
    });
    expect(lumine.commands.dispatch).toHaveBeenCalledOnceWith(target, "refactor:rename");
    expect(settled).toBe(false);
    finishRename();
    expect(await pending).toBeNull();
    await expectAsync(adapter.handleServerRequest("unknown/request", {})).toBeResolvedTo(undefined);
  });

  it("maps the settings page onto the server's own preference names", () => {
    lumine.config.set("ide-typescript.preferences.quotePreference", "single");
    lumine.config.set("ide-typescript.preferences.importModuleSpecifierPreference", "relative");
    lumine.config.set("ide-typescript.tsserver.path", "/ts/lib");
    lumine.config.set("ide-typescript.tsserver.maxTsServerMemory", 4096);

    const options = adapter.getInitializationOptions();
    expect(options.preferences.quotePreference).toBe("single");
    expect(options.preferences.importModuleSpecifierPreference).toBe("relative");
    expect(options.tsserver.path).toBe("/ts/lib");
    expect(options.maxTsServerMemory).toBe(4096);
    // Zero is how the settings page spells "the Node default", which the
    // server spells as an absent value.
    lumine.config.set("ide-typescript.tsserver.maxTsServerMemory", 0);
    expect(adapter.getInitializationOptions().maxTsServerMemory).toBeUndefined();
  });

  it("names the inlay hints for what they show, not for the server's flags", () => {
    lumine.config.set("ide-typescript.inlayHints.parameterNames", "literals");
    lumine.config.set("ide-typescript.inlayHints.functionReturnTypes", true);

    const { typescript, javascript } = adapter.getSettings();
    expect(typescript.inlayHints.includeInlayParameterNameHints).toBe("literals");
    expect(typescript.inlayHints.includeInlayFunctionLikeReturnTypeHints).toBe(true);
    expect(typescript.inlayHints.includeInlayVariableTypeHints).toBe(false);
    // The server keeps these per language and serves .js files from the other
    // block, so both have to carry them.
    expect(javascript.inlayHints).toEqual(typescript.inlayHints);
  });

  it("carries the code lens and diagnostic settings the server reads", () => {
    lumine.config.set("ide-typescript.codeLens.references", true);
    lumine.config.set("ide-typescript.ignoredDiagnosticCodes", [2307]);

    const settings = adapter.getSettings();
    expect(settings.typescript.referencesCodeLens.enabled).toBe(true);
    expect(settings.diagnostics.ignoredCodes).toEqual([2307]);
    expect(settings.completions.completeFunctionCalls).toBe(true);
    expect(adapter.getWorkspaceConfiguration("diagnostics").ignoredCodes).toEqual([2307]);
    expect(adapter.getWorkspaceConfiguration("typescript").referencesCodeLens.enabled).toBe(true);
  });

  it("carries inferred-project compiler settings instead of leaving the controls inert", () => {
    lumine.config.set("ide-typescript.implicitProjectConfiguration.checkJs", true);
    lumine.config.set("ide-typescript.implicitProjectConfiguration.experimentalDecorators", true);
    lumine.config.set("ide-typescript.implicitProjectConfiguration.target", "ES2020");
    lumine.config.set("ide-typescript.implicitProjectConfiguration.module", "ESNext");

    expect(adapter.getSettings().implicitProjectConfiguration).toEqual({
      checkJs: true,
      experimentalDecorators: true,
      target: "ES2020",
      module: "ESNext",
    });
    expect(adapter.getWorkspaceConfiguration("implicitProjectConfiguration")).toEqual(
      adapter.getSettings().implicitProjectConfiguration,
    );
  });

  describe("formattingOptions", () => {
    // tsserver formats the edits it produces itself — organize-imports, a
    // rename that adds an import — and asks for the tab settings of the file it
    // is about to edit. Answering with nothing leaves those edits indented the
    // server's way rather than the file's.
    it("answers from the editor holding the file", async () => {
      const filePath = path.join(__dirname, "fixture.ts");
      const editor = await lumine.workspace.open(filePath);
      editor.setTabLength(3);
      editor.setSoftTabs(false);

      const uri = `file:///${filePath.replaceAll("\\", "/")}`;
      expect(adapter.getWorkspaceConfiguration("formattingOptions", uri)).toEqual({
        tabSize: 3,
        insertSpaces: false,
      });
    });

    it("falls back to the editor settings for a file that is not open", () => {
      lumine.config.set("editor.tabLength", 8);
      const options = adapter.getWorkspaceConfiguration(
        "formattingOptions",
        "file:///nowhere/absent.ts",
      );
      expect(options.tabSize).toBe(8);
      expect(typeof options.insertSpaces).toBe("boolean");
    });

    it("matches a server-canonicalized Windows drive to the open editor", () => {
      expect(uriToPath("file:///c%3A/Project/example.ts")).toBe("c:\\Project\\example.ts");
      expect(pathKey("C:\\Project\\example.ts", "win32")).toBe(
        pathKey("c:/Project/example.ts", "win32"),
      );
      expect(pathKey("/Project/Example.ts", "linux")).not.toBe(
        pathKey("/Project/example.ts", "linux"),
      );
      spyOn(lumine.workspace, "getTextEditors").and.returnValue([
        {
          getPath: () => "C:\\Project\\example.ts",
          getTabLength: () => 7,
          getSoftTabs: () => false,
        },
      ]);
      expect(formattingOptions("file:///c%3A/Project/example.ts", "win32")).toEqual({
        tabSize: 7,
        insertSpaces: false,
      });
    });
  });

  it("offers a switch for every capability the server advertises", () => {
    // Read from the server's own initialize response; it serves all of them.
    const { configSchema } = require("../package.json");
    expect(Object.keys(configSchema.features.properties)).toEqual([
      "diagnostics",
      "autocomplete",
      "hover",
      "signature",
      "definition",
      "references",
      "symbols",
      "format",
      "rename",
      "codeActions",
      "inlayHints",
      "codeLens",
      "semanticTokens",
    ]);
  });
});
