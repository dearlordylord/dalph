# Dalph agent instructions

## Package manager and branch

- Use pnpm, never npm.
- Work on `master` unless a task explicitly requires an isolated task branch or
  worktree.

## Architecture

- Read `docs/CONTEXT.md` and `docs/ARCHITECTURE.md` before changing domain or
  architecture language.
- Dalph is a clean graph-native orchestrator, not a rewrite or compatibility
  layer for the historical `ralph-run.sh` experiment.
- Use Effect V4 services, layers, Schema boundaries, schedules, streams, scoped
  concurrency, and typed failures for the production control plane.
- The tracker owns task identity, lifecycle, dependencies, grouping, and
  claims. Git owns lineage, refs, commits, worktrees, and integration facts.
  The execution substrate owns session and process observations. Dalph's
  journal owns only managed workflow history.
- Do not duplicate authority facts or persist derived frontier, resource, or UI
  state.
- Make invalid states unrepresentable. Brand distinct identities, capacities,
  revisions, ordinals, durations, positions, and resource locators at their
  boundaries.

## Delivery invariants

- One exact worktree and planned Base SHA per task attempt.
- Bounded concurrent task execution; integration resources remain distinct and
  serialized according to the accepted target protocol.
- Fresh independent reviewers, same-session handback, distinct technical and
  semantic retry scopes, automatic bounded retries, and typed non-convergence.
- Intent before ambiguity-crossing effects, observation afterward, and
  reconcile-before-retry after ambiguous outcomes.
- Cleanup is disposition-typed, exact, recoverable, and fail-closed.
- Dry-run, live-fake, test, and production interpret one workflow algebra.

## Verification and review

- Use focused package tests while developing. Do not inherit target
  repositories' application-specific typecheck, model-checking, or MBT gates
  as Dalph implementation gates.
- Follow `docs/DEVELOPMENT.md` and `docs/CODE_REVIEW.md`. Run
  `pnpm check:all` before implementation handoff.
- Every implementation ticket must preserve its declared acceptance scenarios
  and blocking edges.
- After significant changes, repeat domain/spec, architecture/connascence, and
  code-review passes until no reasonable finding remains. Record a concrete
  reason for any rejected finding.
