## Working rules

- Use pnpm, never npm. Work on `master` unless the task requires an isolated
  branch or worktree.
- Start explanations with the concrete actor, action, and boundary; introduce
  domain shorthand afterward. Preserve accepted scenarios and blocking edges.

## Read by task

Read the applicable owner below before that work; follow links for concrete
questions. Reuse guidance already read unless it changed or scope changed.

| Task | Required guidance |
| --- | --- |
| Plan or change runtime behavior | [Operational scenarios](docs/OPERATIONAL-SCENARIOS.md), then the accepted issue/specification/scenario |
| Change domain or architecture language | [Context](docs/CONTEXT.md) and [architecture](docs/ARCHITECTURE.md) |
| Write or change a Quint model | [Quint guide](docs/QUINT-GUIDE.md) |
| Review significant changes or repair findings | [Code review](docs/CODE_REVIEW.md) |
| Develop, choose checks, or diagnose stalls | [Development workflow](docs/DEVELOPMENT.md#keeping-implementation-work-finite) and [commands](docs/DEVELOPMENT.md#commands) |

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

- Use minimal live-provider fixtures, controlled tests for bulk behavior, and
  never retry throttled mutations.
- Develop with focused checks. Target repositories' application-specific
  typecheck, model-checking, and MBT gates are not Dalph implementation gates.
- Before handoff, run `pnpm check:all`; review domain/spec,
  architecture/connascence, and code correctness under the scoped closure rules
  in [CODE_REVIEW.md](docs/CODE_REVIEW.md).
- Run `pnpm check:quint` after final relevant changes and before integration.
  During development, run it for model, conformance-adapter, or model-governed
  behavior changes. It is separate from `check:all`. Uncollected tests,
  undefined behavior, and unreachable actions can appear green: require a
  negative control.
- Before declaring Playwright environment-blocked, try the documented
  [browser setup](docs/DEVELOPMENT.md#browser-and-real-host-setup); report the exact unrun command
  and missing dependency if privileges block setup.
