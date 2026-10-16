const fs = require("fs");
const os = require("os");
const path = require("path");
const { pathToFileURL } = require("url");
const { serverContext } = require("./helpers/server-context");
const idePath = lumine.packages.resolvePackagePath("ide");
const Manager = require(path.join(idePath, "lib", "language-server-manager"));
const ServerSession = require(path.join(idePath, "lib", "server-session"));

describe("TypeScript Windows file identity", () => {
  let manager, session, rootPath, editors, registration, originalTimeout;

  beforeEach(async () => {
    if (process.platform !== "win32") return;
    jasmine.useRealClock();
    originalTimeout = jasmine.DEFAULT_TIMEOUT_INTERVAL;
    jasmine.DEFAULT_TIMEOUT_INTERVAL = 30000;
    editors = [];
    rootPath = fs.mkdtempSync(path.join(os.tmpdir(), "ide-typescript-alias-"));
    fs.writeFileSync(path.join(rootPath, "main.js"), "const value = 1;\nvalue;\n");
    const main = (await lumine.packages.activatePackage("ide-typescript")).mainModule;
    await lumine.packages.activatePackage("language-javascript");
    let adapter;
    registration = main.consumeIde({
      registerAdapter(value) {
        adapter = value;
        return { dispose() {} };
      },
    });
    manager = new Manager();
    const launch = await adapter.resolveServer(serverContext({ rootPath }));
    session = new ServerSession(manager, adapter, rootPath, launch);
    await session.start();
  });

  afterEach(async () => {
    if (process.platform !== "win32") return;
    for (const editor of editors) editor.destroy();
    await session?.stop();
    await manager?.deactivate();
    registration?.dispose();
    await lumine.packages.deactivatePackage("ide-typescript");
    await fs.promises.rm(rootPath, {
      recursive: true,
      force: true,
      maxRetries: 10,
      retryDelay: 100,
    });
    jasmine.DEFAULT_TIMEOUT_INTERVAL = originalTimeout;
  });

  async function open(name) {
    const editor = lumine.workspace.buildTextEditor();
    editors.push(editor);
    editor.getBuffer().setPath(path.join(rootPath, name));
    editor.setGrammar(lumine.grammars.grammarForScopeName("source.js"));
    editor.setText("const value = 1;\nvalue;\n");
    await session.openEditor(editor);
    return editor;
  }

  const references = (editor) =>
    session.request("textDocument/references", {
      textDocument: { uri: pathToFileURL(editor.getPath()).href },
      position: { line: 0, character: 7 },
      context: { includeDeclaration: true },
    });

  it("keeps references available after a differently cased preview closes", async () => {
    if (process.platform !== "win32") {
      pending("TypeScript folds file path case on Windows.");
      return;
    }
    const original = await open("main.js");
    expect((await references(original)).length).toBe(2);
    const preview = await open("Main.js");
    expect((await references(preview)).length).toBe(2);
    preview.destroy();
    expect((await references(original)).length).toBe(2);
  });

  it("keeps the differently cased preview available after the original closes", async () => {
    if (process.platform !== "win32") {
      pending("TypeScript folds file path case on Windows.");
      return;
    }
    const original = await open("main.js");
    const preview = await open("Main.js");
    expect((await references(preview)).length).toBe(2);
    original.destroy();
    expect((await references(preview)).length).toBe(2);
  });

  it("synchronizes the requested alias when its unsaved text differs", async () => {
    if (process.platform !== "win32") {
      pending("TypeScript folds file path case on Windows.");
      return;
    }
    const original = await open("main.js");
    const preview = await open("Main.js");
    preview.setText("const value = 1;\nvalue;\nvalue;\n");
    expect((await references(preview)).length).toBe(3);
    expect((await references(original)).length).toBe(2);
    original.destroy();
    expect((await references(preview)).length).toBe(3);
  });
});
