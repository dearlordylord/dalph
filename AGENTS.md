## Working rules

- Use pnpm, never npm. Work on `master` unless the task requires an isolated
  branch or worktree.
- When Dalph says it has prepared the exact task worktree before the turn, do
  not run preparation again. Otherwise, in a fresh task worktree run
  `node scripts/prepare-attempt-worktree.mjs` before the first typecheck, test,
  build, or lint. It selects the repository's Node through `mise` and installs
  frozen dependencies. If it fails, report the preparation stage instead of
  treating it as a source failure. Run later
  Node and pnpm commands through `mise exec --` because a login shell can reset
  `PATH` to an unsupported Node version. This preparation does not qualify code.
- Start explanations with the concrete actor, action, and boundary; introduce
  domain shorthand afterward. Preserve accepted scenarios and blocking edges.

## Read by task

Read the applicable owner below before that work; follow links for concrete
questions. Reuse guidance already read unless it changed or scope changed.

| Task | Required guidance |
| --- | --- |
| Find a behavior, source module, or verification owner | [Repository navigation](docs/NAVIGATION.md); [scenario catalog](docs/scenarios/README.md) for behavior, [tooling owners](docs/development/tooling.md) for checks |
| Plan or change runtime behavior | [Operational scenarios](docs/OPERATIONAL-SCENARIOS.md), then the accepted issue/specification/scenario |
| Change domain or architecture language | [Context glossary](docs/CONTEXT.md#language) and [architecture compositions](docs/ARCHITECTURE.md#protected-compositions) |
| Write or change a Quint model | [Quint guide](docs/QUINT-GUIDE.md) |
| Review significant changes or repair findings | [Code review](docs/CODE_REVIEW.md) |
| Develop, choose checks, or diagnose stalls | [Development workflow](docs/development/workflow.md#keeping-implementation-work-finite) and [commands](docs/development/commands.md#commands) |

## Implementation constraints

- Behavior-changing implementation is blocked until accepted chronological
  scenarios cover starting facts, trigger, boundary calls, visible and forbidden
  results, applicable crashes/retries, and acceptance tests. Explain
  inapplicable fields. Plans and handoffs map each scenario to tests; aggregate
  totals do not substitute. Tooling/documentation changes instead explain why
  Dalph runtime behavior cannot change.
- Use idiomatic Effect V4. Name distinct domain phenomena with distinct types or
  events; document branded types and non-obvious events. Make invalid states
  unrepresentable; brand identities, capacities, revisions, ordinals, durations,
  positions, and locators at boundaries.
- Read task identity, lifecycle, dependencies, grouping, and claims from the
  tracker; lineage, refs, commits, worktrees, and integration facts from Git;
  session/process observations from the execution substrate. The Dalph journal
  owns workflow history only. Do not duplicate these authorities or persist
  derived frontier, resource, or UI state.

## Delivery invariants

- One exact worktree and planned Base SHA per task attempt; bounded concurrency.
- Record intent before effects with uncertain outcomes, then observation;
  reconcile before retrying an ambiguous outcome.
- Cleanup is disposition-typed, exact, recoverable, and fail-closed.
- Dry-run, test, and production interpret one workflow algebra.

## Verification and closure

- After a failed qualification, use retained gate evidence to identify and
  diagnose the failed boundary. Run a focused reproducer or diagnostic for that
  boundary; run a test directly only when the failed child was a test.
  Preparation and input-guard failures can occur before a child stage launches,
  leaving no stage result or child-stage log. Repair the cause and observe the
  focused check passing before another full run. An incomplete process retains
  its custody fence until stopped writers are proved through reconciliation.
  After two attempts without new discriminating evidence, name competing causes
  and change the experiment; another full run or reviewer alone is not progress.
- After a completed broad run, close isolated test-only defects using
  [focused repair evidence](docs/development/checks.md#closing-a-test-only-repair).
  Repeat broad checks only for a named affected boundary or still-required agreed
  full qualification; a focused pass can close the defect without a fresh full run.
- Before starting or waiting on an operation expected to exceed one minute,
  record its expected duration and wall-clock stop time. At that time, stop
  safely, preserve evidence, and name the next discriminating action before a
  rerun; a live handle is not progress. After 30 minutes of active fixture repair
  without new discriminating evidence, open a scoped follow-up, or report blocked
  if it is the only proof of current acceptance behavior.
- Use minimal live-provider fixtures, controlled tests for bulk behavior, and
  never retry throttled mutations.
- For implementation and handoff, follow
  [choosing checks](docs/development/checks.md#choosing-checks) for focused checks,
  broad-run authorization and evidence, and final acceptance. In delegated work,
  the parent/integrator owns acceptance of the combined task. Close
  [scoped reviews](docs/CODE_REVIEW.md#review-closure) before handoff.
- Target repositories' application-specific typecheck, model-checking, and MBT
  gates are not Dalph implementation gates.
- `check:all`, `check:ci:quality`, `test:coverage`, `check:quint`, `check:baseline`,
  and standalone `check:preflight` take the exact worktree lock before a
  clone-wide admission slot. Nested commands validate their active custody
  record; a slot environment value alone does not grant admission. Incomplete
  runs retain durable fences;
  inspect with `pnpm gate:status <run-id>` and explicitly prove stopped writers
  with `pnpm gate:reconcile <run-id>`. Missing exits remain unproven. Run the
  command to wait for ownership; never poll another agent's gate. See the local
  Linux/cooperative scope in [gate custody](docs/development/gates.md#heavy-gate-admission).
  `DALPH_GATE_SLOTS` sets clone capacity. `check:fast` and focused tests remain
  unadmitted; standalone preflight writes artifacts and is admitted.
- During a full gate, freeze its exact worktree and follow the
  [parallel-work rules](docs/development/gates.md#parallel-work-during-a-full-gate):
  independent work uses other worktrees; candidate Git reads set
  `GIT_OPTIONAL_LOCKS=0`; shared tools, dependencies, Git configuration, packed
  refs, and unknown shared writes wait. Blocking edges still forbid
  implementation, though read-only planning may continue.
- `pnpm check:all --candidate=<base sha>` runs the clean frozen candidate's
  own command manifest once. Ordinary qualification does not resume stages or
  reuse cross-worktree formal certification. Interrupted runs restart after
  stopped-writer reconciliation. Never credit missing or failed stages.
- Before declaring Playwright environment-blocked, try the documented
  [browser setup](docs/development/browser.md#browser-and-real-host-setup); report the exact unrun command
  and missing dependency if privileges block setup.
