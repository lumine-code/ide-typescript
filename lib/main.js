const { resolveServer } = require("./server");

module.exports = {
  consumeLanguageServer(service) {
    return service.registerAdapter({
      id: "ide-typescript",
      displayName: "TypeScript Language Server",
      grammarScopes: ["source.js", "source.js.jsx", "source.ts", "source.tsx"],
      sessionScope: "project-root",
      async resolveServer(context) {
        const launch = await resolveServer(atom.config.get("ide-typescript.serverPath"));
        return { ...launch, cwd: context.rootPath, transport: "stdio" };
      },
      getWorkspaceConfiguration(section) {
        return section ? atom.config.get(section) : {};
      },
    });
  },
};
