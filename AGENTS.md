## Package manager and branch

- Use pnpm, never npm.
- Work on `master` unless a task explicitly requires an isolated task branch or
  worktree.

## Read by task

Use the relevant route below; follow additional links when they answer a
concrete question. Reuse already-read guidance unless it changed or the task
crosses another boundary. These routes do not waive the gates below.

| Task | Guidance |
| --- | --- |
| Change runtime behavior | [Operational scenarios](docs/OPERATIONAL-SCENARIOS.md), then the accepted scenario for that behavior |
| Change domain or architecture language | [Context](docs/CONTEXT.md) and [architecture](docs/ARCHITECTURE.md) |
| Write or change a Quint model | [Quint guide](docs/QUINT-GUIDE.md) |
| Review a candidate or repair findings | [Code review checklist and closure](docs/CODE_REVIEW.md) |
| Choose checks or diagnose repeated stalls | [Development workflow](docs/DEVELOPMENT.md#keeping-implementation-work-finite) and [commands](docs/DEVELOPMENT.md#commands) |

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
- Use Effect V4 features at its fullest. Be idiomatic.
- The tracker owns task identity, lifecycle, dependencies, grouping, and
  claims. Git owns lineage, refs, commits, worktrees, and integration facts.
  The execution substrate owns session and process observations. Dalph's
  journal owns only workflow-journal history.
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
- Bounded concurrent task execution
- Intent before ambiguity-crossing effects, observation afterward, and
  reconcile-before-retry after ambiguous outcomes.
- Cleanup is disposition-typed, exact, recoverable, and fail-closed.
- Dry-run, test, and production interpret one workflow algebra.

## Verification and review

- Do not spam live providers: use minimal fixtures, prove bulk behavior with
  controlled tests, and do not retry throttled mutations.
- In explanations and reviews, state the concrete actor, action, and boundary
  before using canonical shorthand. Prefer “try to create the claim up to
  three times” over “bounded acquisition,” “check GitHub again” over
  “perform an authoritative reread,” and “repository label used as the task
  claim record” over “label-backed lock.” Introduce the canonical term after
  the concrete behavior is clear or not at all
- Use focused package tests while developing. Do not inherit target
  repositories' application-specific typecheck, model-checking, or MBT gates
  as Dalph implementation gates.
- Before reporting a Playwright check as environment-blocked, try the browser
  setup documented in `docs/DEVELOPMENT.md`; if privileges prevent setup,
  report the exact unrun command and missing dependency.
- Follow `docs/DEVELOPMENT.md` and `docs/CODE_REVIEW.md`. Run
  `pnpm check:all` before implementation handoff.
- Run `pnpm check:quint` once after the final relevant changes and before
  integration. During development, run it only when changing a Quint model,
  its executable conformance adapter, or behavior governed by that model;
  `pnpm check:all` intentionally does not repeat exhaustive model checking.
- Read `docs/QUINT-GUIDE.md` before writing or changing a Quint model. Quint
  fails silently: uncollected tests, undefined behavior, and unreachable
  actions all read as a passing gate, so treat a green model result as a claim
  needing a negative control.
- Every implementation ticket must preserve its declared acceptance scenarios
  and blocking edges.
- Review significant changes along domain/spec, architecture/connascence, and
  code-review axes. Classify findings against the accepted task before editing;
  follow the review closure rules in `docs/CODE_REVIEW.md`. Recheck fixes and
  affected behavior rather than restarting every review for each checkpoint.
  Record a concrete reason for any rejected or deferred finding.
- For composed workflows, attempt a minimally instrumented complete-story
  diagnostic before polishing individual checkpoints. If it stops, record the
  reached outcome, first obstruction, and unexecuted suffix.
  Follow `docs/DEVELOPMENT.md` when repeated runs or reviews stop advancing the
  same observable outcome; a new subtask does not reset the parent time budget.
