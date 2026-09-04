const fs = require("fs");
const os = require("os");
const path = require("path");
const main = require("../lib/main");
const { LiveLspClient, fileUri } = require("./helpers/live-lsp-client");

const registerAdapter = () => {
  let adapter;
  const disposable = main.consumeIdeClient({
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
    await lumine.packages.activatePackage("ide-typescript");
    lumine.config.set("ide-typescript.implicitProjectConfiguration.checkJs", true);
    ({ adapter, disposable } = registerAdapter());
    client = new LiveLspClient(adapter, rootPath);
  });

  afterEach(async () => {
    await client.stop();
    disposable.dispose();
    lumine.config.unset("ide-typescript.implicitProjectConfiguration.checkJs");
    await lumine.packages.deactivatePackage("ide-typescript");
    fs.rmSync(rootPath, { recursive: true, force: true });
    jasmine.DEFAULT_TIMEOUT_INTERVAL = originalTimeout;
  });

  it("serves inferred JavaScript with the configured compiler options", async () => {
    const { capabilities } = await client.start();
    expect(capabilities.completionProvider.resolveProvider).toBe(true);
    expect(capabilities.documentFormattingProvider).toBe(true);
    expect(capabilities.renameProvider.prepareProvider).toBe(true);
    expect(capabilities.semanticTokensProvider.full).toBe(true);

    const uri = fileUri(path.join(rootPath, "example.js"));
    client.open(uri, "javascript", '/** @type {number} */\nconst answer = "wrong";\nanswer.toF');
    const diagnostics = await client.waitFor(
      () =>
        client
          .messages("textDocument/publishDiagnostics")
          .find(({ params }) => params.diagnostics.some(({ code }) => code === 2322))?.params
          .diagnostics,
      "checkJs diagnostic",
    );
    expect(diagnostics.some(({ code }) => code === 2322)).toBe(true);

    const completion = await client.request("textDocument/completion", {
      textDocument: { uri },
      position: { line: 2, character: 10 },
    });
    const items = Array.isArray(completion) ? completion : completion.items;
    expect(items.map(({ label }) => label)).toContain("toFixed");
  });
});
