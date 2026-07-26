# ide-typescript

TypeScript and JavaScript language-server adapter.

Registers `typescript-language-server` with the bundled `ide-client` package, providing completions, diagnostics, navigation, formatting, and refactoring for TypeScript and JavaScript projects.

## Features

- **Bundled server**: ships `typescript-language-server` with a pinned TypeScript, no setup required.
- **Custom binary**: the Server Path setting points at any other `typescript-language-server` executable.
- **Project sessions**: one server per project root, started lazily with the first matching editor.
- **Workspace configuration**: answers server configuration requests from the editor settings.

## Installation

To install `ide-typescript` search for _ide-typescript_ in the Install pane of the Lumine settings or run `lumine --install lumine-code/ide-typescript`.

## Services

- **ide-client** (`^1.0.0`): consumed to register the TypeScript adapter with the editor's language-server client.

## Contributing

Got ideas to make this package better, found a bug, or want to help add new features? Just drop your thoughts on GitHub. Any feedback is welcome!
