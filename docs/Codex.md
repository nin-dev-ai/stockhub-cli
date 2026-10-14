# Working notes for maintainers and coding agents

Start with the root [README](../README.md), then use the [docs index](README.md) to find the focused document. Treat code as the source for implementation details and update the docs when code changes make them stale.

## Documentation routine

1. Identify which user flow, screen, API call, or setup step changed.
2. Update the corresponding document and any affected README section in the same change.
3. Check links and statements against current files and commands.
4. Keep notes short and current; remove superseded guidance.

## Useful source files

- `app/src/lib/functions.ts`: supported commands and parser.
- `app/src/App.tsx`: screen registration and layout.
- `app/src/lib/api.ts`: data endpoints and providers.
- `app/src/lib/signals.ts`: signal thresholds and verdict logic.
- `app/src/store/workspaceStore.ts`: tab state and persistence.
- `app/package.json`: dependencies and build commands.

Do not record API keys, credentials, or private user data here.
