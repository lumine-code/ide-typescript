const { resolveServer } = require("./server");

module.exports = {
  consumeIdeClient(service) {
    return service.registerAdapter({
      id: "ide-typescript",
      displayName: "TypeScript Language Server",
      grammarScopes: ["source.js", "source.js.jsx", "source.ts", "source.tsx"],
      sessionScope: "project-root",
      async resolveServer(context) {
        const launch = await resolveServer(atom.config.get("ide-typescript.serverPath"));
        return { ...launch, cwd: context.rootPath, transport: "stdio" };
      },
      getInitializationOptions() {
        return {
          preferences: {
            // Without this the server still offers symbols from other modules,
            // but `completionItem/resolve` returns no import edit for them —
            // so accepting one inserts the symbol and silently leaves the file
            // without the import it needs.
            includeCompletionsForModuleExports: true,
            includeCompletionsForImportStatements: true,
            // Offer a call signature rather than a bare name, so accepting a
            // function fills in its parameters as snippet tab stops.
            includeCompletionsWithSnippetText: true,
            useLabelDetailsInCompletionEntries: true,
          },
        };
      },
      getWorkspaceConfiguration(section) {
        return section ? atom.config.get(section) : {};
      },
    });
  },
};
