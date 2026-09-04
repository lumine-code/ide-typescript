# ide-typescript

TypeScript and JavaScript language-server adapter.

Registers `typescript-language-server` with `ide-client`, providing completions, diagnostics, navigation, formatting, and refactoring for TypeScript and JavaScript projects.

## Features

- **Server choice**: ships `typescript-language-server` with a pinned compiler, can install a newer server with a compatible TypeScript 6, and accepts custom server and TypeScript paths.
- **Import style**: chooses the quotes, path style, and extension of every import the server inserts, and can exclude modules from auto-import entirely.
- **Inlay hints**: shows inferred parameter names, variable, property and return types, and enum values, each behind its own switch.
- **Code lens**: serves implementation and reference counts for the line a declaration sits on, which the code-lens package renders above it.
- **Refactoring**: renames symbols, applies source actions, and offers Move to File when the optional `refactor` package is active to collect the new name.
- **Files outside a project**: sets the compiler options for a file with no `tsconfig.json` above it.
- **Feature switches**: any of the fourteen capabilities the server offers can be turned off, which hands it to another server on the same file.
- **Project sessions**: one server per project root, started lazily with the first matching editor.
- **Workspace configuration**: answers server configuration requests from the editor settings, including the tab settings tsserver formats its own edits with.

## Installation

Install `ide-client` first, then search for `ide-typescript` in the Install pane of the Lumine settings, or run `lumine --install lumine-code/ide-typescript`.

## Services

- `ide-client`: consumed to register the TypeScript adapter with the editor's language-server client.

## Contributing

Got ideas to make this package better, found a bug, or want to help add new features? Just drop your thoughts on GitHub. Any feedback is welcome!
