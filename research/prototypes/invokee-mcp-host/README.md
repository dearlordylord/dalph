# Disposable MCP-to-production-host composition

Runs the real production host from source with controlled provider edges and
actual Git/SQLite. Two real stdio MCP server children forward tool calls to a
throwaway local adapter. A child exits while capacity handling is held; the
host accepts the change, a replacement reads it, and actual delivery completes.

```sh
pnpm exec vitest run --config research/prototypes/invokee-mcp-host/vitest.config.ts --reporter verbose
```

Requires the existing built fixture binary and installed sibling MCP SDK 1.29.0
at `/workspace/typescript/dnd/node_modules/@modelcontextprotocol/sdk`.
The binary is used for fixture metadata; host code resolves to source.

See [results and limits](../../invokee-mcp-host-results.md). No production
command surface or MCP resource-subscription protocol is implemented.
