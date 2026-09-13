# Disposable changing-graph production-host probe

This research-only probe runs the actual production host workflow against a
throwaway Git repository and SQLite journal. GitHub and Codex are controlled
provider boundaries. A separate Node process consumes a disposable NDJSON
current-first observation stream.

Run it from the repository root:

```sh
pnpm vitest --config research/prototypes/invokee-changing-graph/vitest.config.ts --run
```

The scenario starts root A at capacity one, holds its executor observation,
changes the controlled tracker closure to add child B, prerequisite C, and
independent child D, then lets the production timer refresh the graph. It checks
live graph/frontier delivery, retained executor evidence, client detach and
reattach, ordinary result/integration/completion work, and the actual terminal
evidence decision.

The expected terminal result is a typed rejection because the exercised history
ends with a predecessor-free `WorkflowEstablishment` graph read whose changed
facts are not causally comparable with the preceding post-quiescence graph.
That negative result is part of the qualification, not a supported recovery
strategy.

This folder defines no production transport. It does not call live GitHub or
Codex, create tracker tasks, prove durable replay, prove arbitrary first-frame
graph availability, or prove that a new blocker yields already executing work.
The fixture and server are scoped; client exits and subscription-fiber
interruption are awaited before the fixture directory is removed.

See [`../../invokee-changing-graph-results.md`](../../invokee-changing-graph-results.md)
for source evidence, chronology, results, and limits.
