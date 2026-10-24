const path = require("path");
const { resolveServer, installServer, latestServerVersion } = require("./server");

const setting = (key) => lumine.config.get("ide-typescript." + key);

const nativeSettings = () => ({
  locale: setting("locale") || undefined,
  tsserver: {
    automaticTypeAcquisition: { enabled: !setting("disableAutomaticTypeAcquisition") },
  },
  suggest: {
    autoImports: true,
    includeCompletionsForImportStatements: true,
  },
  preferences: {
    quoteStyle: setting("preferences.quoteStyle"),
    importModuleSpecifier: setting("preferences.importModuleSpecifier"),
    importModuleSpecifierEnding: setting("preferences.importModuleSpecifierEnding"),
    preferTypeOnlyAutoImports: setting("preferences.preferTypeOnlyAutoImports"),
    autoImportFileExcludePatterns: setting("preferences.autoImportFileExcludePatterns") || [],
    jsxAttributeCompletionStyle: setting("preferences.jsxAttributeCompletionStyle"),
  },
  inlayHints: {
    parameterNames: {
      enabled: setting("inlayHints.parameterNames"),
      suppressWhenArgumentMatchesName: !setting("inlayHints.parameterNamesWhenArgumentMatches"),
    },
    parameterTypes: { enabled: setting("inlayHints.parameterTypes") },
    variableTypes: {
      enabled: setting("inlayHints.variableTypes"),
      suppressWhenTypeMatchesName: !setting("inlayHints.variableTypesWhenNameMatches"),
    },
    propertyDeclarationTypes: { enabled: setting("inlayHints.propertyDeclarationTypes") },
    functionLikeReturnTypes: { enabled: setting("inlayHints.functionReturnTypes") },
    enumMemberValues: { enabled: setting("inlayHints.enumMemberValues") },
  },
  implementationsCodeLens: { enabled: setting("codeLens.implementations") },
  referencesCodeLens: {
    enabled: setting("codeLens.references"),
    showOnAllFunctions: setting("codeLens.referencesOnAllFunctions"),
  },
  workspaceSymbols: { scope: "allOpenProjects", excludeLibrarySymbols: true },
});

const uriToPath = (uri) => {
  if (typeof uri !== "string" || !uri.startsWith("file:")) return null;
  try {
    const { pathname, hostname } = new URL(uri);
    const decoded = decodeURIComponent(pathname);
    if (hostname) return `\\\\${hostname}${decoded.replaceAll("/", "\\")}`;
    // A Windows path arrives as /C:/… — the leading slash is the URL's, not the path's.
    return /^\/[a-zA-Z]:/.test(decoded) ? decoded.slice(1).replaceAll("/", "\\") : decoded;
  } catch {
    return null;
  }
};

// Servers are free to canonicalize file URIs. typescript-language-server does
// so on Windows by lowercasing and percent-encoding the drive before it asks
// for formattingOptions, while TextEditor#getPath normally keeps the drive's
// original case. Compare filesystem identities rather than URI spellings.
const pathKey = (filePath, platform = process.platform) => {
  if (!filePath) return null;
  const normalized = (platform === "win32" ? path.win32 : path.posix).normalize(filePath);
  return platform === "win32" ? normalized.toLowerCase() : normalized;
};

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

const workspaceSettings = () => ({
  "js/ts": nativeSettings(),
  typescript: {},
  javascript: {},
  editor: formattingOptions(),
});

module.exports = {
  consumeIde(service) {
    return service.registerAdapter({
      id: "ide-typescript",
      displayName: "TypeScript Language Server",
      grammarScopes: ["source.js", "source.js.jsx", "source.ts", "source.tsx"],
      caseSensitiveFileNames: process.platform !== "win32",
      sessionScope: "project-root",
      settingsKeyPaths: ["ide-typescript"],
      restartKeyPaths: ["ide-typescript.serverPath"],
      bundledServer: true,
      latestServerVersion,
      installServer,
      resolveServer(context) {
        return resolveServer(context, setting("serverPath"));
      },
      getInitializationOptions() {
        return { disablePushDiagnostics: true };
      },
      getSettings: workspaceSettings,
      getWorkspaceConfiguration(section, resource) {
        if (section === "editor") return formattingOptions(resource);
        const settings = workspaceSettings();
        if (!section) return settings;
        return Object.hasOwn(settings, section) ? settings[section] : undefined;
      },
    });
  },
};

module.exports.nativeSettings = nativeSettings;
module.exports.pathKey = pathKey;
module.exports.uriToPath = uriToPath;
module.exports.formattingOptions = formattingOptions;
