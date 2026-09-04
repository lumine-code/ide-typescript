const path = require("path");
const { resolveServer, managedServer } = require("./server");

const REFACTOR_RENAME_COMMAND = "refactor:rename";
const setting = (key) => lumine.config.get(`ide-typescript.${key}`);
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
  implicitProjectConfiguration: {
    checkJs: setting("implicitProjectConfiguration.checkJs"),
    experimentalDecorators: setting("implicitProjectConfiguration.experimentalDecorators"),
    target: setting("implicitProjectConfiguration.target"),
    module: setting("implicitProjectConfiguration.module"),
  },
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

// Servers are free to canonicalize file URIs. typescript-language-server does
// so on Windows by lowercasing and percent-encoding the drive before it asks
// for formattingOptions, while TextEditor#getPath normally keeps the drive's
// original case. Compare filesystem identities rather than URI spellings.
const pathKey = (filePath, platform = process.platform) => {
  if (!filePath) return null;
  const normalized = path.normalize(filePath);
  return platform === "win32" ? normalized.toLowerCase() : normalized;
};

const refactorRenameAvailableAt = (target) =>
  !!target &&
  lumine.commands.findCommands({ target }).some(({ name }) => name === REFACTOR_RENAME_COMMAND);

const refactorRenameAvailable = () =>
  lumine.workspace.getTextEditors().some((editor) => {
    try {
      return refactorRenameAvailableAt(lumine.views.getView(editor));
    } catch {
      return false;
    }
  });

const formattingOptions = (resource, platform = process.platform) => {
  const filePath = uriToPath(resource);
  const editor = filePath
    ? lumine.workspace
        .getTextEditors()
        .find((item) => pathKey(item.getPath(), platform) === pathKey(filePath, platform))
    : null;
  if (editor) return { tabSize: editor.getTabLength(), insertSpaces: editor.getSoftTabs() };
  return {
    tabSize: lumine.config.get("editor.tabLength"),
    insertSpaces: lumine.config.get("editor.tabType") !== "hard",
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
      restartKeyPaths: [
        "ide-typescript.serverPath",
        "ide-typescript.tsserver",
        "ide-typescript.locale",
        "ide-typescript.disableAutomaticTypeAcquisition",
        "ide-typescript.preferences",
        "ide-typescript.completeFunctionCalls",
      ],
      managedServer,
      async resolveServer(context) {
        const launch = await resolveServer(setting("serverPath"), context.managedServer);
        return { ...launch, cwd: context.rootPath, transport: "stdio" };
      },
      getInitializationOptions() {
        return {
          hostInfo: "lumine",
          // Move-to-file finishes by asking the client to start an interactive
          // rename. Advertise it only when that UI command can answer.
          supportsMoveToFileCodeAction: refactorRenameAvailable(),
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
      async handleServerRequest(method, params) {
        if (method !== "_typescript.rename") return undefined;
        const filePath = uriToPath(params?.textDocument?.uri);
        const { line, character } = params?.position || {};
        if (!filePath || !Number.isInteger(line) || !Number.isInteger(character))
          throw new Error("TypeScript requested an interactive rename at an invalid location");

        const editor = await lumine.workspace.open(filePath, { activateItem: true });
        if (!editor?.setCursorBufferPosition)
          throw new Error("TypeScript requested an interactive rename outside a text editor");
        editor.setCursorBufferPosition([line, character], { autoscroll: true });
        const target = lumine.views.getView(editor);
        if (!refactorRenameAvailableAt(target))
          throw new Error("The refactor:rename UI is no longer available");
        const dispatched = lumine.commands.dispatch(target, REFACTOR_RENAME_COMMAND);
        if (!dispatched) throw new Error("The refactor:rename UI did not accept the request");
        await dispatched;
        return null;
      },
    };

    return service.registerAdapter(adapter);
  },
};

module.exports.pathKey = pathKey;
module.exports.uriToPath = uriToPath;
module.exports.formattingOptions = formattingOptions;
module.exports.refactorRenameAvailable = refactorRenameAvailable;
