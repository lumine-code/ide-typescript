const fs = require("fs");
const { resolveServer } = require("../lib/server");
const main = require("../lib/main");

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
});

describe("ide-typescript adapter", () => {
  it("registers with the language-server service", async () => {
    let adapter;
    const disposable = main.consumeIdeClient({
      registerAdapter(registered) {
        adapter = registered;
        return { dispose() {} };
      },
    });
    expect(adapter.id).toBe("ide-typescript");
    expect(adapter.grammarScopes).toContain("source.ts");
    expect(adapter.grammarScopes).toContain("source.js");
    const launch = await adapter.resolveServer({ rootPath: __dirname });
    expect(launch.cwd).toBe(__dirname);
    expect(launch.transport).toBe("stdio");
    disposable.dispose();
  });
});
