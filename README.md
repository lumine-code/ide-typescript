# ide-typescript

TypeScript and JavaScript language-server adapter.

Registers `typescript-language-server` with the bundled `ide-client` package, providing completions, diagnostics, navigation, formatting, and refactoring for TypeScript and JavaScript projects.

## Features

- **Bundled server**: ships `typescript-language-server` with a pinned TypeScript, no setup required.
- **Managed upgrade**: installs a newer server from npm when you want one, and removing it returns to the bundled copy.
- **Custom binary**: the Server Path setting points at any other `typescript-language-server` executable, and the TypeScript Path setting checks against the version your project builds with.
- **Import style**: chooses the quotes, path style, and extension of every import the server inserts, and can exclude modules from auto-import entirely.
- **Inlay hints**: shows inferred parameter names, variable, property and return types, and enum values, each behind its own switch.
- **Code lens**: counts implementations and references above a declaration.
- **Files outside a project**: sets the compiler options for a file with no `tsconfig.json` above it.
- **Feature switches**: any of the fourteen capabilities the server offers can be turned off, which hands it to another server on the same file.
- **Project sessions**: one server per project root, started lazily with the first matching editor.
- **Workspace configuration**: answers server configuration requests from the editor settings, including the tab settings tsserver formats its own edits with.

## Installation

To install `ide-typescript` search for _ide-typescript_ in the Install pane of the Lumine settings or run `lumine --install lumine-code/ide-typescript`.

## Services

- **ide-client** (`^1.0.0`): consumed to register the TypeScript adapter with the editor's language-server client.

## Contributing

Got ideas to make this package better, found a bug, or want to help add new features? Just drop your thoughts on GitHub. Any feedback is welcome!
