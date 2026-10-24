const fs = require("fs");
const os = require("os");
const path = require("path");
const { LiveLspClient, fileUri } = require("./helpers/live-lsp-client");

let main;

const registerAdapter = () => {
  let adapter;
  const disposable = main.consumeIde({
    registerAdapter(registered) {
      adapter = registered;
      return { dispose() {} };
    },
  });
  return { adapter, disposable };
};

describe("ide-typescript bundled server", () => {
  let adapter, client, disposable, rootPath;
  let originalTimeout;

  beforeEach(async () => {
    jasmine.useRealClock();
    originalTimeout = jasmine.DEFAULT_TIMEOUT_INTERVAL;
    jasmine.DEFAULT_TIMEOUT_INTERVAL = 30000;
    rootPath = fs.mkdtempSync(path.join(os.tmpdir(), "ide-typescript-live-"));
    main = (await lumine.packages.activatePackage("ide-typescript")).mainModule;
    ({ adapter, disposable } = registerAdapter());
    client = new LiveLspClient(adapter, rootPath);
  });

  afterEach(async () => {
    await client.stop();
    disposable.dispose();
    lumine.config.unset("ide-typescript.implicitProjectConfiguration.checkJs");
    await lumine.packages.deactivatePackage("ide-typescript");
    // Windows can retain the native process's working-directory handle briefly.
    await fs.promises.rm(rootPath, {
      recursive: true,
      force: true,
      maxRetries: 10,
      retryDelay: 100,
    });
    jasmine.DEFAULT_TIMEOUT_INTERVAL = originalTimeout;
  });

  it("serves JavaScript with the project's compiler options and pull diagnostics", async () => {
    fs.writeFileSync(
      path.join(rootPath, "jsconfig.json"),
      JSON.stringify({
        compilerOptions: { checkJs: true, target: "ES2022" },
        include: ["*.js"],
      }),
    );
    const { capabilities } = await client.start();
    expect(capabilities.completionProvider.resolveProvider).toBe(true);
    expect(capabilities.documentFormattingProvider).toBe(true);
    expect(capabilities.renameProvider.prepareProvider).toBe(true);
    expect(capabilities.semanticTokensProvider.full).toBe(true);

    const uri = fileUri(path.join(rootPath, "example.js"));
    client.open(uri, "javascript", '/** @type {number} */\nconst answer = "wrong";\nanswer.toF');
    const diagnostics = (
      await client.request("textDocument/diagnostic", {
        textDocument: { uri },
      })
    ).items;
    expect(diagnostics.some(({ code }) => code === 2322)).toBe(true);

    const completion = await client.request("textDocument/completion", {
      textDocument: { uri },
      position: { line: 2, character: 10 },
    });
    const items = Array.isArray(completion) ? completion : completion.items;
    expect(items.map(({ label }) => label)).toContain("toFixed");
  });

  it("finds symbols in two independently activated configured projects", async () => {
    const projectFiles = [];
    for (const [directory, name] of [
      ["alpha", "SearchableAlpha"],
      ["beta", "SearchableBeta"],
    ]) {
      const projectPath = path.join(rootPath, directory);
      fs.mkdirSync(projectPath);
      fs.writeFileSync(
        path.join(projectPath, "tsconfig.json"),
        JSON.stringify({ compilerOptions: { target: "ES2020" }, files: ["source.ts"] }),
      );
      const filePath = path.join(projectPath, "source.ts");
      const text = `export function ${name}() { return 1; }`;
      fs.writeFileSync(filePath, text);
      projectFiles.push({ uri: fileUri(filePath), text });
    }
    await client.start();
    for (const { uri, text } of projectFiles) {
      client.open(uri, "typescript", text);
      await client.request("textDocument/documentSymbol", { textDocument: { uri } });
    }
    const found = await client.request("workspace/symbol", { query: "Searchable" });
    expect(found.map(({ name }) => name).sort()).toEqual(["SearchableAlpha", "SearchableBeta"]);
    const locationKey = (uri) => main.pathKey(main.uriToPath(uri));
    expect(found.map(({ location }) => locationKey(location.uri)).sort()).toEqual(
      projectFiles.map(({ uri }) => locationKey(uri)).sort(),
    );
  });

  it("resolves an auto-import using the native import preferences", async () => {
    fs.writeFileSync(
      path.join(rootPath, "tsconfig.json"),
      JSON.stringify({
        compilerOptions: { target: "ES2022", module: "nodenext" },
        include: ["*.ts"],
      }),
    );
    fs.writeFileSync(
      path.join(rootPath, "helpers.ts"),
      "export function greetFriendly(name: string) { return name; }\n",
    );
    fs.writeFileSync(path.join(rootPath, "entry.ts"), "greetFr");
    lumine.config.set("ide-typescript.preferences.quoteStyle", "single");
    await client.start();
    const uri = fileUri(path.join(rootPath, "entry.ts"));
    client.open(uri, "typescript", "greetFr");
    const completion = await client.request("textDocument/completion", {
      textDocument: { uri },
      position: { line: 0, character: 7 },
    });
    const item = (Array.isArray(completion) ? completion : completion.items).find(
      (entry) => entry.label === "greetFriendly",
    );
    expect(item).toBeDefined();
    const resolved = await client.request("completionItem/resolve", item);
    expect(
      resolved.additionalTextEdits.some((edit) => /from '\.\/helpers'/.test(edit.newText)),
    ).toBe(true);
  });

  it("renames a declaration and its call through the standard LSP request", async () => {
    fs.writeFileSync(
      path.join(rootPath, "tsconfig.json"),
      JSON.stringify({
        compilerOptions: { target: "ES2022" },
        include: ["*.ts"],
      }),
    );
    const uri = fileUri(path.join(rootPath, "rename.ts"));
    const text = "function oldName(value: number) { return value; }\noldName(1);\n";
    await client.start();
    client.open(uri, "typescript", text);
    const edit = await client.request("textDocument/rename", {
      textDocument: { uri },
      position: { line: 0, character: 12 },
      newName: "newName",
    });
    const edits = Object.values(edit.changes || {})
      .flat()
      .concat((edit.documentChanges || []).flatMap((change) => change.edits || []));
    expect(edits.filter((change) => change.newText === "newName").length).toBe(2);
  });

  it("updates diagnostics after unsaved edits and restarts without an orphaned wrapper", async () => {
    fs.writeFileSync(
      path.join(rootPath, "tsconfig.json"),
      JSON.stringify({
        compilerOptions: { strict: true, target: "ES2022" },
        include: ["*.ts"],
      }),
    );
    const uri = fileUri(path.join(rootPath, "changed.ts"));
    await client.start();
    client.open(uri, "typescript", 'const value: number = "wrong";\n');
    expect(
      (await client.request("textDocument/diagnostic", { textDocument: { uri } })).items.some(
        (item) => item.code === 2322,
      ),
    ).toBe(true);
    await client.connection.sendNotification("textDocument/didChange", {
      textDocument: { uri, version: 2 },
      contentChanges: [{ text: "const value: number = 1;\n" }],
    });
    expect(
      (await client.request("textDocument/diagnostic", { textDocument: { uri } })).items.some(
        (item) => item.code === 2322,
      ),
    ).toBe(false);
    const first = client.child;
    await client.stop();
    expect(client.shutdownError).toBeUndefined();
    expect(client.forcedStop).toBeUndefined();
    expect(first.signalCode).toBeNull();
    // TypeScript 7.0.2 reports its own cancellation as exit 1 after a valid
    // shutdown: https://github.com/microsoft/TypeScript/issues/64742.
    // Accept only that exact upstream result, never a timeout or forced kill.
    expect(
      first.exitCode === 0 || (first.exitCode === 1 && /^context canceled$/m.test(client.stderr)),
    )
      .withContext(client.stderr)
      .toBe(true);
    client = new LiveLspClient(adapter, rootPath);
    await client.start();
    expect(client.child.pid).not.toBe(first.pid);
    client.open(uri, "typescript", "export const restarted = 1;\n");
    const symbols = await client.request("textDocument/documentSymbol", { textDocument: { uri } });
    expect(symbols.map((symbol) => symbol.name)).toContain("restarted");
  });
});
