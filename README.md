# Dalph

Dalph is a graph-native delivery orchestrator. It consumes a tracker-owned task
DAG, derives the runnable frontier, and supervises bounded concurrent task
workflows while preserving exact worktree, review, retry, integration,
recovery, evidence, and cleanup semantics.

The task tracker remains authoritative for work identity and dependencies. Git
remains authoritative for source lineage and accepted integration. Dalph owns
only its managed execution history and typed orchestration decisions.

## Dalph in motion

The delivery workflow and its live orchestration state, side by side:

![Dalph delivery workflow and orchestration state](docs/assets/dalph-delivery-workflow.gif)

## Status

Production implementation is split across the packages described below. The
CLI requires Alice to choose `--dry` or `--production` explicitly. Dry-run
retains the controlled/read-only interpreter. Production accepts one GitHub
issue target and a decoded repository-host configuration, then reports the
exact allocated or recovered Run and immutable historical snapshots. Passive
current-status attachment, bounded SIGINT/SIGTERM Exit, and same-Run recovery
after process loss are also available.

## Repository map

- `docs/` — stable Dalph context and architecture.
- `packages/contracts/` — exact contracts shared by orchestration and executor implementations.
- `packages/orchestrator/` — generic Effect V4 workflow coordination and authority adapters.
- `packages/dalph/` — the CLI, application composition, and concrete presentation.
- `research/` — completed Wayfinder decisions and market/tool evaluations.
- `prototypes/control-plane/` — disposable Effect V4 seam evidence.
- `prototypes/execution-trace/` — disposable multi-actor trace presentation.

The prototypes are evidence, not production architecture or compatibility
targets.

## Try the current implementation

Dalph supports Node 24 from 24.20.0. Other Node majors are not supported.
Use Node 24.20.0 with pnpm 10.29.0 or newer.

```sh
pnpm install
pnpm build
node packages/dalph/dist/bin/dalph.js \
  run packages/orchestrator/fixtures/diamond.json --dry
```

The command emits newline-delimited semantic trace items. With the diamond
fixture you can witness one tracker-graph observation, bounded admission of the
currently eligible tasks, and simulated task outcomes. The larger retained
fixture is available at
`packages/orchestrator/fixtures/wayfinder-105.json`.

Production changes live state. Use only a dedicated disposable GitHub
repository with one unblocked issue for a first run. Give `GITHUB_TOKEN` access
only to that repository (metadata read, issues read/write, and contents
read for the local clone), keep both credentials in the environment,
and never put either value in the JSON file. The complete, copyable
[disposable production walkthrough](docs/DEVELOPMENT.md#disposable-production-repository-walkthrough)
creates disjoint local state and worktree paths, explains every configuration
field and consequence, shows the version-1 NDJSON records, exercises recovery,
and disposes or deliberately preserves the exact resources.

Production is selected only with an explicit GitHub target and a normalized
absolute configuration path. Its exact public command is:

```sh
node packages/dalph/dist/bin/dalph.js \
  run github:OWNER/REPOSITORY#ISSUE --production \
  --config /absolute/dalph-production.json
```

The non-secret JSON document contains the repository/ref, exact Base SHA,
capacity/cadence, Journal/evidence, disjoint worktree/private-state, and Codex
settings accepted by the production-host schema. Credential values come only
from `GITHUB_TOKEN` and `DALPH_CODEX_PROVIDER_CREDENTIAL`; public validation
records and help never print them.

While the production command is attached, Ctrl-C (`SIGINT`) and supervisor
`SIGTERM` deliveries enter the same host-owned graceful application Exit. A
later signal joins the first request and cannot extend its fixed five-second
drain. The shipped Node runner does not independently interrupt the application
fiber for those signals. The command reports the redacted application-Exit
disposition and returns status zero only for `Succeeded`; `TimedOut`, a
conclusive drain failure, lost output, or abrupt process death remains nonzero.
A typed stdout-write failure is exposed only as the stable redacted
`output.write_failed` boundary failure; the command does not recursively try to
write another stdout failure record. Graceful application Exit does not itself
terminate the selected Run. If that Run was not independently and durably
terminated, it remains available to the ordinary recovery path on the next
invocation.

For a visual preview of the intended experience, run the disposable historical
execution-trace prototype:

```sh
pnpm install --dir prototypes/execution-trace --ignore-workspace
pnpm --dir prototypes/execution-trace dev
```

Open `http://localhost:5173`. The workbench provides synchronized task and
causal graphs, cursor replay, actor spans, dependency focus, pan/zoom/fit, a
minimap, convergence collapsing, and both focused and large-run fixtures. Its
execution occurrences are simulated decision evidence. This isolated app has
its own fixtures and projection code; it neither imports nor executes
`packages/orchestrator`.

## Development

Use pnpm. Work is performed on `master`; implementation tickets declare their
blocking edges and acceptance evidence in GitHub.

Install dependencies with `pnpm install`, use focused package tests while
developing, and run `pnpm check:all` before handoff. The root harness enforces
strict TypeScript and Effect-aware linting, dependency-cycle and duplication
checks, enforced test coverage, and secret scanning. See
[`docs/DEVELOPMENT.md`](docs/DEVELOPMENT.md) and
[`docs/CODE_REVIEW.md`](docs/CODE_REVIEW.md).
