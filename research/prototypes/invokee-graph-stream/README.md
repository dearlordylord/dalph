# Disposable graph stream experiment

This probe connects real OS clients to a disposable HTTP adapter over the
unchanged production host's process-local runtime observation signal. It tests
one current-first attachment, later status publication without reconnect, client
detachment while delivery continues, fresh current-first attachment, and final
`Closed` delivery. GitHub and Codex provider edges are controlled.

Run from the interview worktree root:

```sh
pnpm exec vitest run --config research/prototypes/invokee-graph-stream/vitest.config.ts --reporter=verbose
```

The two smaller cases isolate an attachment-boundary publication and a finite
ordered burst held behind a gated consumer. They do not establish durable replay
or bounded-memory behavior. The HTTP adapter, wire projection, and client are
disposable research artifacts, not a supported Dalph API.

See [the chronology, evidence, and limits](../../invokee-graph-stream-results.md).
