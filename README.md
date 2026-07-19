# Dalph

Dalph is a graph-native delivery orchestrator. It consumes a tracker-owned task
DAG, derives the runnable frontier, and supervises bounded concurrent task
workflows while preserving exact worktree, review, retry, integration,
recovery, evidence, and cleanup semantics.

The task tracker remains authoritative for work identity and dependencies. Git
remains authoritative for source lineage and accepted integration. Dalph owns
only its managed execution history and typed orchestration decisions.

## Status

The research and prototype evidence has been extracted from the original D&D
repository. The accepted implementation specification and tracer tickets live
in this repository's issue tracker. Production implementation has not started.

## Repository map

- `docs/` — stable Dalph context and architecture.
- `research/` — completed Wayfinder decisions and market/tool evaluations.
- `prototypes/control-plane/` — disposable Effect V4 seam evidence.
- `prototypes/execution-trace/` — disposable multi-actor trace presentation.

The prototypes are evidence, not production architecture or compatibility
targets.

## Development

Use pnpm. Work is performed on `master`; implementation tickets declare their
blocking edges and acceptance evidence in GitHub.

Install dependencies with `pnpm install`, use focused package tests while
developing, and run `pnpm check:all` before handoff. The root harness enforces
strict TypeScript and Effect-aware linting, dependency-cycle and duplication
checks, enforced test coverage, and secret scanning. See
[`docs/DEVELOPMENT.md`](docs/DEVELOPMENT.md) and
[`docs/CODE_REVIEW.md`](docs/CODE_REVIEW.md).
