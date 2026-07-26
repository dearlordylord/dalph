# Capacity-one evidence findings for issue #131

## Evidence snapshot

This note assesses the committed baseline
[`b1ef939179501a2b950a97f7df9aa9322b442780`](https://github.com/dearlordylord/dalph/commit/b1ef939179501a2b950a97f7df9aa9322b442780),
not concurrent uncommitted implementation work. On 2026-07-26, the live
[issue #131](https://github.com/dearlordylord/dalph/issues/131) was open and
its body had last been updated at `2026-07-26T19:54:09Z`.

## Exact ticket boundary

The live issue assigns #131 three things: the shared production
runnable-frontier selector, one process-local bounded admission controller, and
executable evidence that ordinary and reconstructed inputs use that same
selector. Given the same journal history, fresh external observations, and
current configured capacity, ordinary and restarted selection must return the
same exact transition or explanation. The runnable frontier is not persisted.
The task tracker, Git, and execution provider remain owners of their current
facts; the controller owns only process-local reservations and freshly observed
occupied positions. These are the issue's `Ticket boundary`, `Actor and
authority boundary`, and capacity acceptance bullets in the
[live issue body](https://github.com/dearlordylord/dalph/issues/131).

The live issue explicitly leaves the repeated production loop—select one exact
operation, execute it, record the result, reconstruct, and select again—to
[#132](https://github.com/dearlordylord/dalph/issues/132). This handoff is
narrower still: it asks only for the missing capacity-one formal and
model-to-code evidence. It excludes #132 activation/waiter ownership,
changed-capacity restart, pause commands, and the #133 executor-boundary
migration
([handoff](capacity-one-evidence.md)).

The acceptance boundary for this handoff is therefore:

1. Check M2 with configured capacity one while at least A and independent C are
   eligible.
2. Prove the checked admission/reservation count uses that configured limit,
   and prove a deliberately weakened rule violates it.
3. Replay the capacity-one model projection through the production selector and
   controller, comparing model-exported task, transition, operation,
   explanation, reservation, and occupied identities.
4. Keep the existing fresh-memory and closed/reopened SQLite capacity-one lanes
   green, and make the canonical specification and coverage inventory describe
   exactly that evidence.

## Current evidence and gaps

| Evidence | Committed baseline | Gap to close |
| --- | --- | --- |
| Genuine capacity-one Quint profile | M2 defines `CAPACITY = 2`; A and C are independently eligible, and admission checks compare reservations with that fixed value ([model](../../specs/frontierRecovery.qnt#L162), [eligibility and admission](../../specs/frontierRecovery.qnt#L271)). | Make capacity a checking-profile input and add a named capacity-one profile. The profile must retain both eligible A and C, expose both in the frontier, and admit/reserve only the canonical first task. |
| Capacity invariant | `boundedCapacity` is `initialReservedCount(state) <= CAPACITY`, but `CAPACITY` is the fixed model constant ([invariant](../../specs/frontierRecovery.qnt#L1259)). | Bind the invariant to the profile's configured limit. Keep that limit a process/configuration projection, not a journal fact. |
| Model-exported selector state | The export reports capacity, frontier/admitted task IDs, transition/operation IDs, explanation tags, reservations, and occupied IDs. At the baseline it hard-codes selected A/C as both admitted and reserved and always exports no explanations ([projection](../../specs/frontierRecovery.qnt#L288)). | At capacity one, export the actual bounded choice and the exact capacity-wait explanation for the non-admitted eligible task. Do not make the TypeScript replay derive a second expected scheduler. |
| Negative capacity evidence | The gate expects counterexamples only for missing intent, duplicate authority effect, and stale knowledge ([gate](../../scripts/check-frontier-recovery-model.mjs#L172), [negative model](../../specs/frontierRecovery_counterexamples.qnt)). | Add a weakened capacity action/profile that can reserve both independently eligible tasks at configured capacity one, and require TLC to report a `boundedCapacity` violation. |
| Exhaustive model gate | Every sampled and exhaustive M2 command uses the default module; the named exhaustive profiles are all-boundaries, crash/restart, pause/resume, and reconciliation. There is no capacity-one invocation or module binding ([gate profiles](../../scripts/check-frontier-recovery-model.mjs#L73)). | Add a named exhaustive capacity-one admission profile to the gate. A sampled run alone does not satisfy the live ticket. |
| Quint-connect production comparison | The adapter calls production `deriveRunnableFrontier` and `makeTaskAdmissionController`, then exports exact transition, operation, explanation, reservation, and occupied identities ([adapter](../../packages/orchestrator/test/frontier-recovery/frontier-recovery-selection.ts#L37)). The state checker compares all of them ([comparison](../../packages/orchestrator/test/frontier-recovery/frontier-recovery-reconstruction.mbt.test.ts#L522)). | The driver constructs and reconstructs controls only with capacity two ([driver](../../packages/orchestrator/test/frontier-recovery/frontier-recovery-reconstruction.mbt.test.ts#L391)). Parameterize or duplicate the sampled lane at capacity one and compare against the capacity-one model export. |
| Fresh-memory and SQLite lanes | Fresh-memory selection already runs at capacities one and two, and P0/P1 reconstruction uses capacity one ([memory lanes](../../packages/orchestrator/test/frontier-recovery/frontier-recovery-reconstruction.test.ts#L60)). Closed/reopened SQLite selection also runs at capacities one and two ([SQLite lane](../../packages/orchestrator/test/frontier-recovery/frontier-recovery-reconstruction.test.ts#L334)). | Preserve these lanes. Their literal expected arrays are readable examples; they do not replace the model-exported Quint-connect comparison. |
| Canonical coverage text | The specification says M2 is checked at capacity two with capacity one still required, but its profile inventory already lists “exhaustive … capacity-one” ([portfolio](../../docs/BOUNDED-RESUMABLE-GRAPH-FRONTIER.md#L249)). The reconstruction inventory also names a capacity-one profile that the gate does not yet contain ([inventory](../../packages/orchestrator/test/frontier-recovery/RECONSTRUCTION-COVERAGE.md#L13)). | After the executable profile exists, replace aspirational wording with the exact checked profile, two-task frontier, one admitted reservation, capacity-wait explanation, negative counterexample, and capacity-one Quint-connect lane. Align inventory property names with the actual M2 names. |

## Authority guardrails

Capacity is already a branded configuration value from one through eight, with
a default of two
([`TaskWorkCapacity`](../../packages/orchestrator/src/domain.ts#L263)).
Recovery receives the current capacity as an argument and passes it to the
recovery slice; it does not reconstruct the value from journal history
([recovery](../../packages/orchestrator/src/workflow-recovery.ts#L353)). The
controller stores capacity, reservations, and occupied observations in Effect
`Ref`s created for the current process
([controller](../../packages/orchestrator/src/task-admission-controller.ts#L104)).
The canonical specification likewise forbids persisting capacity reservations,
admission sets, or the frontier as authority
([specification](../../docs/BOUNDED-RESUMABLE-GRAPH-FRONTIER.md#L98)).

The formal change should preserve that split: a Quint profile supplies the
configured limit; modeled journal events do not record it; restart recomputes
the selector projection from current configured capacity and reconstructed
responsibility.

## Profiles and commands required for handoff

Minimum exact evidence profiles:

- **M2 capacity one, exhaustive:** initialize with eligible A and C, configure
  one position, run `reconstructionStep`, and check the full M2 invariant set,
  including `boundedCapacity`.
- **M2 capacity two, exhaustive:** retain the existing checked profiles as the
  comparison baseline.
- **M2 weakened capacity one:** initialize the same two eligible tasks, use the
  deliberately weakened admission step, and require a TLC counterexample for
  `boundedCapacity`.
- **Quint-connect capacity one and two:** replay `reconstructionStep` with the
  production selector/controller configured to the same capacity as the model;
  compare every exported selector/controller identity rather than expected
  arrays authored in the test.

Focused development commands:

```sh
pnpm vitest run \
  packages/orchestrator/src/runnable-frontier.test.ts \
  packages/orchestrator/test/frontier-recovery/frontier-recovery-reconstruction.test.ts \
  packages/orchestrator/test/frontier-recovery/frontier-recovery-reconstruction.mbt.test.ts

pnpm check:quint
```

The focused Vitest command passed on the baseline: 18 tests in 3 files. The
baseline `pnpm check:quint` command is the owning formal gate
([root scripts](../../package.json)); after implementation it must show both
capacity profiles and the expected weakened-capacity counterexample. The final
repository gate is:

```sh
pnpm check:all
```

Repository policy requires that gate plus domain/spec,
architecture/connascence, and strict code-review passes before handoff
([development harness](../../docs/DEVELOPMENT.md#L64),
[review checklist](../../docs/CODE_REVIEW.md#L56)).
