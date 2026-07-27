# Quint trace explanation view — throwaway prototype

This isolated prototype presents five switchable stories backed by real Quint
traces: crash-safe retry, pause/interruption and capacity, external completion,
one complete successful task, and branch-local external changes. Each story
starts with a user question, gives the modeled answer, and exposes curated
milestones plus the complete decoded trace.

The earlier reconciliation DAG remains only as a secondary diagnostic in Story
5. One exact model state is one node regardless of trace position.
ITF set and map entries are canonicalized as unordered values before equality;
tuple and sequence order remains significant.

**Every story is bounded evidence, not the complete state machine.** The
storyboards show transitions executed by named deterministic Quint scenarios.
The secondary graph contains six retained samples; an absent edge is unknown,
not disabled. The viewer never selects an action or computes a legal
transition.

The post-#133 refresh decodes conformance projection version 5. Fresh selected
transitions and durable `OperationId` correlations are distinct tagged values;
each transition shows the executor-declared outer-invocation capacity use; and
activation owners, runners, selected transitions, reserved correlations, and
pending triggers remain visible. The viewer contains no evidence-, review-, or
handback-specific generic orchestration vocabulary.

## Run

Use Node 22.22.2+ or 24.15.0+ and pnpm 10.29.3:

```sh
cd prototypes/quint-trace-view
pnpm install --ignore-workspace --lockfile=false
pnpm check
```

`pnpm check` runs the decoder/equality/drift/fail-closed and graph tests,
compiles the prototype, and regenerates byte-identical normalized, table, and
interactive story artifacts.

Pinned versions:

- Quint `0.32.0` (the repository root pin);
- Effect `4.0.0-beta.99`;
- TypeScript `5.9.3`;
- Vitest `4.0.18`; and
- pnpm `10.29.3`.

No dependency was added to Dalph's root package, production packages, or CI.
The prototype has its own isolated package manifest on this throwaway branch.
It deliberately has no second lockfile or package-local quality configuration;
the exact dependency versions are pinned in `package.json`.

## Retained evidence

Each raw ITF fixture has a neighboring manifest carrying Dalph/model revision,
the exact model SHA-256, projection version, Quint and renderer versions, init,
step, seed, and trace kind.

| Trace | Raw ITF | Frames | Purpose |
| --- | --- | ---: | --- |
| Activation ownership | `fixtures/activation.itf.json` | 5 | One generated derive → reserve → own prefix exposes the process-local owner, runner, selected transition, and reserved correlation. |
| Sampled | `fixtures/normal.itf.json` | 3 | Capacity-one selection of A while C has an exact `CapacityWait`. |
| Responsibility first | `fixtures/responsibility-first.itf.json` | 1 | Capacity one admits outstanding C while fresh A has an exact `CapacityWait`. |
| Restart | `fixtures/restart.itf.json` | 7 | Reconstruction steps, coordinator crash, and restart using only the closed reconstruction action inventory. |
| Counterexample | `fixtures/counterexample.itf.json` | 3 | Deliberately weakened capacity action makes A and C carry outstanding workflow responsibility at capacity one; Quint records status `violation`. |
| Claim C, then A loses claim | `fixtures/explore-claim-c-then-claim-loss.itf.json` | 5 | C becomes outstanding before A loses its claim; A is then isolated. |
| A loses claim, then claim C | `fixtures/explore-claim-loss-then-claim-c.itf.json` | 5 | Same final state with the independent claim after A's authority change. |
| Claim C, then rewrite A | `fixtures/explore-claim-c-then-git-rewrite.itf.json` | 5 | C becomes outstanding before A's Git target changes; A is then isolated. |
| Rewrite A, then claim C | `fixtures/explore-git-rewrite-then-claim-c.itf.json` | 5 | Same final state with the independent claim after the rewrite. |
| Claim C, then conflict A | `fixtures/explore-claim-c-then-authority-conflict.itf.json` | 5 | C becomes outstanding before A's authority conflicts; A is then isolated. |
| Conflict A, then claim C | `fixtures/explore-authority-conflict-then-claim-c.itf.json` | 5 | Same final state with the independent claim after the conflict. |
| Crash after intent | `fixtures/story-crash-after-intent.itf.json` | 6 | Existing test proves restart requires a fresh task read before retry. |
| Pause with independent progress | `fixtures/story-pause-independent.itf.json` | 6 | Existing test pauses A while C remains admitted and records responsibility. |
| Pause, interrupt, resume | `fixtures/story-pause-resume.itf.json` | 22 | Running A is paused, interrupted, reread, and resumed without abandoning responsibility. |
| Successful task | `fixtures/story-success.itf.json` | 34 | A crosses all eight claim-through-completion boundaries and settles. |
| Lost worktree | `fixtures/story-lost-worktree.itf.json` | 16 | A records exact worktree-loss isolation while retaining responsibility. |
| New blocker | `fixtures/story-blocker.itf.json` | 4 | C waits on a new blocker while independent A becomes outstanding. |
| Claim loss | `fixtures/story-claim-loss.itf.json` | 9 | Existing test isolates A after claim loss while C progresses. |
| Git rewrite | `fixtures/story-git-rewrite.itf.json` | 9 | Existing test isolates A after incompatible target rewrite while C progresses. |
| External completion | `fixtures/story-external-completion.itf.json` | 8 | Existing test settles A from tracker completion without a duplicate effect. |

The crash, pause/resume, completion, success, and constraint traces feed the
five visible stories. The normal sample and responsibility-first state supply
Story 2's capacity comparison. Only the six nondeterministic exploration paths
feed Story 5's secondary graph. The restart and counterexample traces remain
retained decoder/conformance evidence.

The sample's `fixtures/normal.mbt-projection.json` records the version-5
comparable shape. A focused test independently creates fresh production-backed
reconstruction controls, runs `init` and two
`orchestratorCommitsNextFreshTaskClaimIntent` actions at capacity one, and
compares every frame. The comparison includes activation, capacity, task and
tagged operation identities, transition tags, exact task-specific explanation,
reservations, occupancy, and coordinator status.

Generated evidence for each trace:

- `artifacts/*.normalized.json`: normalized frames with the raw ITF state
  retained for inspection;
- `artifacts/*.table.md`: the complete decision-bearing frame table; and
- `index.html` and `artifacts/observed-state-dag.html`: the same interactive
  five-story view, semantic HTML frame tables, raw ITF state, and secondary
  observed graph.

The earlier per-trace Mermaid, SVG, and side-by-side linear path artifacts were
deleted.

## Exact fixture commands

The refreshed fixtures were produced from post-#133 `master` commit
`a8a3d078c9dc303b7ac1d5150dfeb8b56072f572`. The exact
`specs/frontierRecovery.qnt`
SHA-256 was
`ecc53c65b24c980323ef42747402f9f0c871c3c8f6b45b415084c662d3583972`.
The exact `specs/frontierRecovery_test.qnt` SHA-256 for the story traces was
`d15d9ef1f0ac0865c58ca302c81b520a2d386cb11498a5a85c6196161681852a`.

The six displayed paths were retained from this 1,500-path sample using the
manifest names in the evidence table:

```sh
pnpm quint run specs/frontierRecovery.qnt \
  --main frontierRecoveryCapacityTwo \
  --init initReconciliationProfile \
  --step reconciliationProfileStep \
  --max-steps 4 \
  --max-samples 1500 \
  --n-traces 1500 \
  --seed 131136 \
  --mbt \
  --backend typescript \
  --out-itf "explore_{seq}.json" \
  --verbosity 1
```

Each story used this command with the manifest's exact `INIT`, `SEED`, and
`OUTPUT` values:

```sh
pnpm quint run specs/frontierRecovery_test.qnt \
  --main frontierRecoveryTest \
  --init "$INIT" \
  --step step \
  --max-steps 0 \
  --max-samples 1 \
  --n-traces 1 \
  --seed "$SEED" \
  --mbt \
  --backend typescript \
  --out-itf "prototypes/quint-trace-view/fixtures/$OUTPUT" \
  --verbosity 0
```

| Story | `INIT` | `SEED` | `OUTPUT` |
| --- | --- | ---: | --- |
| Crash after intent | `crashAfterIntentRequiresFreshReadTest` | 13101 | `story-crash-after-intent.itf.json` |
| Pause with independent progress | `taskPauseLeavesIndependentBranchRunnableTest` | 13102 | `story-pause-independent.itf.json` |
| Claim loss | `claimLossIsolatesOnlyAffectedTaskTest` | 13103 | `story-claim-loss.itf.json` |
| Git rewrite | `rewrittenTargetIsolatesOnlyAffectedTaskTest` | 13104 | `story-git-rewrite.itf.json` |
| External completion | `externallyCompletedTaskSettlesWithoutDuplicateEffectTest` | 13105 | `story-external-completion.itf.json` |
| Pause, interrupt, resume | `pauseInterruptResumeRereadsBeforeReinvocationTest` | 13106 | `story-pause-resume.itf.json` |
| Successful task | `completeProtocolKeepsFinalitiesDistinctTest` | 13107 | `story-success.itf.json` |
| Lost worktree | `lostWorktreeRecordsAttemptOutcomeTest` | 13108 | `story-lost-worktree.itf.json` |
| New blocker | `newBlockerWaitsWithoutStoppingUnrelatedTaskTest` | 13109 | `story-blocker.itf.json` |

Normal sampled trace:

```sh
pnpm exec quint run specs/frontierRecovery.qnt \
  --main frontierRecoveryCapacityOne \
  --init init \
  --step orchestratorCommitsNextFreshTaskClaimIntent \
  --max-steps 2 \
  --max-samples 1 \
  --n-traces 1 \
  --seed 131 \
  --mbt \
  --backend typescript \
  --out-itf normal_{seq}.itf.json \
  --verbosity 0
```

Responsibility-first capacity-one state:

```sh
pnpm quint run specs/frontierRecovery.qnt \
  --main frontierRecoveryCapacityOne \
  --init initCapacityOneResponsibilityFirstProfile \
  --step orchestratorCommitsNextFreshTaskClaimIntent \
  --max-steps 0 \
  --max-samples 1 \
  --n-traces 1 \
  --seed 131137 \
  --mbt \
  --backend typescript \
  --out-itf prototypes/quint-trace-view/fixtures/responsibility-first.itf.json \
  --verbosity 1
```

Activation ownership prefix:

```sh
pnpm exec quint run specs/frontierRecovery.qnt \
  --main frontierRecoveryCapacityTwo \
  --init init \
  --step activationOwnedThenDerivedPrefixStep \
  --max-steps 4 \
  --max-samples 80 \
  --n-traces 80 \
  --seed 132151 \
  --mbt \
  --backend typescript \
  --out-itf "activation_{seq}.json" \
  --verbosity 0
```

Restart candidates (sequence 14 was retained because it ends in `restart`).
The copies recreate the exact absolute wrapper source recorded in the raw ITF:

```sh
cp specs/frontierRecovery.qnt /tmp/frontierRecovery.qnt
cp prototypes/quint-trace-view/fixtures/restart-trace-profile.qnt \
  /tmp/frontierRecoveryRestartTrace.qnt
pnpm exec quint run /tmp/frontierRecoveryRestartTrace.qnt \
  --main frontierRecoveryRestartTrace \
  --init init \
  --step restartTraceStep \
  --max-steps 6 \
  --max-samples 40 \
  --n-traces 40 \
  --seed 9132 \
  --mbt \
  --backend typescript \
  --out-itf restart_{seq}.itf.json \
  --verbosity 0
```

Expected capacity counterexample (exit status 1 is required):

```sh
pnpm exec quint run specs/frontierRecovery_counterexamples.qnt \
  --main frontierRecoveryCapacityCounterexample \
  --init init \
  --step weakenedCapacityStep \
  --invariant boundedCapacity \
  --max-steps 3 \
  --max-samples 1 \
  --seed 1310 \
  --mbt \
  --backend typescript \
  --out-itf counterexample_{seq}.itf.json \
  --verbosity 0
```

The normal and restart commands were rerun after the source change landed.
Removing only Quint's timestamp and human-readable generation time produced
byte-identical canonical JSON traces.

## Test result

Focused result on 2026-07-27:

```text
Test Files  1 passed (1)
Tests       27 passed (27)
```

This throwaway story revision uses the focused prototype check. It does not add
a production gate or rerun the full repository review workflow.

Positive cases prove raw-ITF-to-frame preservation, the capacity-one
responsibility-priority comparison, retained deterministic acceptance stories,
meaningful branching from the reconciliation samples, equality with the existing
MBT comparable projection at all three sampled steps, first-divergence
reporting, agreement with the existing version-5 closed reconstruction action
inventory, deterministic normalized bytes, decoding of activation ownership,
and all three required trace kinds. Artifact generation also hashes the
checked-out Quint model and refuses to proceed unless it matches the manifest.

Fail-closed cases reject:

- an unknown action;
- a sampled trace with violation status or counterexample trace with ok status;
- a model task identity outside the bounded `0..3` identity map;
- an unsafe JavaScript state index that would lose integer precision; and
- removal of a decision-bearing or displayed revision field;
- removal of activation ownership state;
- an unknown closed Quint state variant; and
- incomplete or mismatched acceptance-test provenance.

## Performance observations

On the retained 3,524,088 bytes of raw ITF (163 frames total), the latest warm
`pnpm check` completed in 3.6 seconds. The remaining time after the focused
tests covered TypeScript compilation plus all forty-one presentation artifacts.
Regenerating twice produced identical SHA-256 hashes for every artifact.

The normalized artifacts intentionally retain each raw ITF state, so this
prototype favors inspectability over storage efficiency.

## Fidelity statement

Every displayed value comes from one schema-decoded field:

- state position from `#meta.index`;
- action and picked task from `mbt::actionTaken` and
  `mbt::nondetPicks.task`;
- coordinator status from `state.coordinator.running`; and
- process-local ownership, runner, selection, reservation correlation, and
  trigger state from `state.activation`;
- task pause from `state.control.taskPaused`;
- task boundary, responsibility, isolation, and settlement from
  `state.workflow`;
- task lifecycle, claim, worktree, invocation, target membership, Git
  compatibility, promotion, and revision from `state.authority`;
- task observation and durable knowledge revision from `state.knowledge`; and
- capacity, frontier, admission, tagged transition-operation identities,
  transition tags, executor-declared resource use, explanations, reservations,
  and occupancy from
  `state.selectorProjection`.

Projected away from the first-screen view:

- authority fields not named above, including blockers and readability;
- activation registration counts and release-correlation diagnostics;
- control epochs;
- effect identity sets and effect counters;
- complete reconstructed facts and reconstruction graph evidence;
- request identity sets, freshness counters, and duplicate-effect counters;
- workflow intent, request counters, and attempt outcome; and
- nondeterministic picks other than the selected model task.

Those fields remain in `rawItfState` and in the raw fixture. The decoder does
not claim equivalence for them.

The counterexample's violated `initialReservedCount` conjunct counts
responsibility-backed initial reservations from the raw workflow state. That
is distinct from the first-screen `selectorProjection.reservationTaskIds`
field, which contains only A in the final frame. The retained counterexample
therefore proves fail-closed decoding of a violation trace; this narrow view
does not by itself explain that violated conjunct.

Unsupported inputs fail closed:

- actions outside the closed reconstruction inventory (plus the one named
  counterexample action for counterexample traces);
- model task identities outside `0..3`;
- non-ITF, non-canonical, or lossy integer encodings;
- selector projections without tagged transition operations,
  executor-declared resource use, or task-specific explanations;
- missing decision-bearing selector fields; and
- traces containing zero or multiple imported `::state` variables.

The comparison says only whether the decoded model frame equals a supplied
implementation projection. It does not decide whether either side is correct.

## Adoption boundary

Adopt the normalized semantic table as the durable trace-explanation baseline.
It is complete for every decoded frame and keeps each displayed value directly
auditable. Retain the observed DAG only as a supplemental research view for
reconvergent samples: it is materially clearer for those samples, but it cannot
replace the table because absent edges remain unknown. Keep Quint and the
existing MBT comparison authoritative.

This result makes no decision about Effect Analyzer source analysis. That
separate decision still requires all seven Decision B results in
`research/effect-analyzer-quint-evaluation.md`, including diagnosis of the
incomplete whole-directory audit and one unique review finding.

## Review dispositions

Fresh domain/spec, architecture/connascence, and strict code-review passes
found reproducibility, schema-boundary, invalid-state, comparison coverage,
and conformance-inventory drift risks. All were accepted and corrected.

One tooling recommendation was intentionally not applied: adding disposable
prototype sources to the root TypeScript/lint configuration would change
Dalph's CI gate, which this handoff explicitly forbids. The prototype instead
uses strict standalone compilation and focused tests without a second
lockfile or package-local quality configuration. Its retained action inventory
cannot import production test code during standalone artifact generation
without coupling the disposable package to Dalph internals, so a focused test
imports the existing version-5 conformance inventory and fails on drift. The
same test invokes fresh production reconstruction controls to prove model-frame
equality at the current boundary.

Projection version 5 removed the earlier `-1` not-yet-created operation
sentinel. The viewer now preserves the model's
`FreshTransitionWithoutOperation | DurableTransitionOperation` distinction and
rejects negative durable operation identities.
