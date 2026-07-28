# Dalph agent instructions

## Project memory

- Codex's built-in Memories are disabled for this project. The checked-in
  OptMem store is advisory project memory.
- After a fresh clone, run `git submodule update --init tools/optmem` before
  using project memory or starting Codex.
- The `SessionStart` hook performs the same read as `pnpm memory:wake`. If the
  hook was not trusted or did not run, execute that command before relying on
  prior project context.
- Multiple independent root Codex sessions may publish concurrently when they
  share `master`'s primary worktree; OptMem's local file lock serializes their
  record positions. Before adding a note, reread or recall related memory to
  avoid semantic duplicates. Treat memory changes from other sessions as
  shared worktree changes: never discard them, and review them before commit.
- Subagents and agents in separate task worktrees must put proposed memories in
  their handoff. The wrapper enforces the Git location; the root-agent
  restriction is an instruction because a process cannot identify its caller.
- Record only durable project decisions, verified repository facts, and
  reusable lessons with `pnpm memory -- note "<one line>"`. Never record
  credentials, secrets, personal facts, private incident details, speculative
  conclusions, or facts owned by GitHub, Git, an executor, or Dalph's journal.
- If OptMem requests a compression after `note` or `wake`, complete the shown
  `nap` command before continuing. If another session settled it first, reread
  memory and continue with the next pending compression. Treat checked-in
  documentation, accepted scenarios, and tracker records as authoritative
  when they disagree with memory.
- Read `.codex/PROJECT-MEMORY.md` before changing the memory tooling or update
  protocol.

## Package manager and branch

- Use pnpm, never npm.
- Work on `master` unless a task explicitly requires an isolated task branch or
  worktree.

## Operational scenario gate

- Read `docs/OPERATIONAL-SCENARIOS.md` before planning behavior-changing work.
- Implementation must not begin until the accepted issue, specification, or a
  file under `docs/scenarios/` explains the behavior as chronological
  operational scenarios. Each scenario names the person affected when one
  exists, the relevant systems, relevant starting
  GitHub/Git/executor/journal facts, concrete trigger, boundary calls, visible
  result, forbidden result, and acceptance test. For a person, boundary, crash,
  or retry that does not apply, state the concrete reason instead of inventing
  filler.
- Start plans and explanations with those real events. Introduce canonical
  terms only after the concrete behavior is understandable without them.
- Every implementation plan and handoff must contain a scenario-to-test
  mapping. Passing aggregate test or coverage totals is not a substitute.
- Treat a missing or abstract scenario as blocked implementation work, not as a
  documentation improvement to defer. A tooling-only or documentation-only
  change may instead state why it changes no Dalph runtime behavior.

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
- During design and review, identify distinct domain phenomena, give them
  canonical names, and materialize them as distinct domain types or events.
  Document the phenomenon above each branded type and non-obvious domain event.
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

- In explanations and reviews, state the concrete actor, action, and boundary
  before using canonical shorthand. Prefer “try to create the claim up to
  three times” over “bounded acquisition,” “check GitHub again” over
  “perform an authoritative reread,” and “repository label used as the task
  claim record” over “label-backed lock.” Introduce the canonical term after
  the concrete behavior is clear.
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
