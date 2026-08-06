const { CompositeDisposable } = require("atom");
const { resolveServer } = require("./server");

const setting = (key) => atom.config.get(`ide-typescript.${key}`);
// An empty setting means "no opinion", so it is left out and the server keeps
// its own default rather than being told to use nothing.
const text = (key) => setting(key) || undefined;
const list = (key) => {
  const value = setting(key);
  return value?.length ? value : undefined;
};
const positive = (key) => {
  const value = setting(key);
  return value > 0 ? value : undefined;
};

// Read once at initialize; changing any of these restarts the server.
const preferences = () => ({
  // Without this the server still offers symbols from other modules, but
  // `completionItem/resolve` returns no import edit for them — so accepting one
  // inserts the symbol and silently leaves the file without the import it
  // needs. Not a preference: turning it off breaks completions quietly.
  includeCompletionsForModuleExports: true,
  includeCompletionsForImportStatements: true,
  // Offer a call signature rather than a bare name, so accepting a function
  // fills in its parameters as snippet tab stops.
  includeCompletionsWithSnippetText: setting("completeFunctionCalls"),
  useLabelDetailsInCompletionEntries: true,
  quotePreference: setting("preferences.quotePreference"),
  importModuleSpecifierPreference: setting("preferences.importModuleSpecifierPreference"),
  importModuleSpecifierEnding: setting("preferences.importModuleSpecifierEnding"),
  includePackageJsonAutoImports: setting("preferences.includePackageJsonAutoImports"),
  preferTypeOnlyAutoImports: setting("preferences.preferTypeOnlyAutoImports"),
  autoImportFileExcludePatterns: list("preferences.autoImportFileExcludePatterns"),
  jsxAttributeCompletionStyle: setting("preferences.jsxAttributeCompletionStyle"),
  maximumHoverLength: positive("preferences.maximumHoverLength"),
});

// The server's own spelling of the inlay-hint flags. The settings page names
// them for what they show instead, since `includeInlayVariableTypeHints` is not
// a phrase anybody reaches for.
const inlayHints = () => ({
  includeInlayParameterNameHints: setting("inlayHints.parameterNames"),
  includeInlayParameterNameHintsWhenArgumentMatchesName: setting(
    "inlayHints.parameterNamesWhenArgumentMatches",
  ),
  includeInlayFunctionParameterTypeHints: setting("inlayHints.parameterTypes"),
  includeInlayVariableTypeHints: setting("inlayHints.variableTypes"),
  includeInlayVariableTypeHintsWhenTypeMatchesName: setting(
    "inlayHints.variableTypesWhenNameMatches",
  ),
  includeInlayPropertyDeclarationTypeHints: setting("inlayHints.propertyDeclarationTypes"),
  includeInlayFunctionLikeReturnTypeHints: setting("inlayHints.functionReturnTypes"),
  includeInlayEnumMemberValueHints: setting("inlayHints.enumMemberValues"),
});

// What the server keeps per language, re-read on every configuration push.
const languageSettings = () => ({
  inlayHints: inlayHints(),
  implementationsCodeLens: { enabled: setting("codeLens.implementations") },
  referencesCodeLens: {
    enabled: setting("codeLens.references"),
    showOnAllFunctions: setting("codeLens.referencesOnAllFunctions"),
  },
});

const workspaceSettings = () => ({
  typescript: languageSettings(),
  javascript: languageSettings(),
  completions: { completeFunctionCalls: setting("completeFunctionCalls") },
  diagnostics: { ignoredCodes: setting("ignoredDiagnosticCodes") || [] },
});

// tsserver formats the edits it produces itself — organize-imports, a rename
// that adds an import, any refactoring — and asks the client for the tab
// settings of the file it is about to edit. Answering with the editor's own is
// the only way those edits come back indented like the rest of the file.
const uriToPath = (uri) => {
  if (!uri?.startsWith("file:")) return null;
  const { pathname, hostname } = new URL(uri);
  const decoded = decodeURIComponent(pathname);
  if (hostname) return `\\\\${hostname}${decoded.replaceAll("/", "\\")}`;
  // A Windows path arrives as /C:/… — the leading slash is the URL's, not the
  // path's.
  return /^\/[a-zA-Z]:/.test(decoded) ? decoded.slice(1).replaceAll("/", "\\") : decoded;
};

const formattingOptions = (resource) => {
  const filePath = uriToPath(resource);
  const editor = filePath
    ? atom.workspace.getTextEditors().find((item) => item.getPath() === filePath)
    : null;
  if (editor) return { tabSize: editor.getTabLength(), insertSpaces: editor.getSoftTabs() };
  return {
    tabSize: atom.config.get("editor.tabLength"),
    insertSpaces: atom.config.get("editor.tabType") !== "hard",
  };
};

module.exports = {
  consumeIdeClient(service) {
    const adapter = {
      id: "ide-typescript",
      displayName: "TypeScript Language Server",
      grammarScopes: ["source.js", "source.js.jsx", "source.ts", "source.tsx"],
      sessionScope: "project-root",
      settingsKeyPaths: ["ide-typescript"],
      async resolveServer(context) {
        const launch = await resolveServer(setting("serverPath"));
        return { ...launch, cwd: context.rootPath, transport: "stdio" };
      },
      getInitializationOptions() {
        return {
          hostInfo: "lumine",
          locale: text("locale"),
          maxTsServerMemory: positive("tsserver.maxTsServerMemory"),
          disableAutomaticTypingAcquisition: setting("disableAutomaticTypeAcquisition"),
          tsserver: {
            path: text("tsserver.path"),
            useSyntaxServer: setting("tsserver.useSyntaxServer"),
            logVerbosity: setting("tsserver.logVerbosity"),
          },
          preferences: preferences(),
        };
      },
      getSettings() {
        return workspaceSettings();
      },
      getWorkspaceConfiguration(section, resource) {
        if (section === "formattingOptions") return formattingOptions(resource);
        const settings = workspaceSettings();
        if (!section) return settings;
        // `hasOwn`, not `in`: a section named after something on Object's
        // prototype would otherwise resolve to a function.
        return Object.hasOwn(settings, section) ? settings[section] : undefined;
      },
    };

    const subscriptions = new CompositeDisposable(service.registerAdapter(adapter));
    // The per-language settings are re-pushed on change. Everything in the
    // initialization options is read once, so those changes need a restart.
    const restart = () => {
      for (const session of service.getSessions()) {
        if (session.adapter !== adapter || ["stopping", "stopped"].includes(session.state))
          continue;
        service.restart(session).catch((error) => {
          atom.notifications.addError("Unable to restart TypeScript Language Server", {
            detail: error.message,
            dismissable: true,
          });
        });
      }
    };
    for (const key of [
      "serverPath",
      "tsserver",
      "locale",
      "disableAutomaticTypeAcquisition",
      "preferences",
      "completeFunctionCalls",
    ]) {
      subscriptions.add(atom.config.onDidChange(`ide-typescript.${key}`, restart));
    }
    return subscriptions;
  },
};
