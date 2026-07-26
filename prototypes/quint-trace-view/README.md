# Quint trace explanation view — throwaway prototype

This isolated prototype combines six paths sampled from the real
`frontierRecovery.reconciliationProfileStep` action into one interactive
observed state graph. Task A begins `Outstanding`. Three concrete diamonds
show Task C becoming `Outstanding` before or after A loses authority; each pair
reconverges, rereads A, and isolates only A. One exact model state is one node
regardless of where it occurs in a trace.
ITF set and map entries are canonicalized as unordered values before equality;
tuple and sequence order remains significant.

**This graph is observed and incomplete.** Its edges are transitions executed
by six retained samples. An absent edge is unknown, not disabled. It is not the
complete state machine, model checking, MBT, or proof of correctness. The
decoder never selects an action or computes a legal transition.

## Run

Use Node 22.22.2+ or 24.15.0+ and pnpm 10.29.3:

```sh
cd prototypes/quint-trace-view
pnpm install --ignore-workspace --lockfile=false
pnpm check
```

`pnpm check` runs the decoder/equality/drift/fail-closed and graph tests, compiles
the prototype, and regenerates byte-identical normalized, table, and
interactive graph artifacts.

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
| Sampled | `fixtures/normal.itf.json` | 3 | Capacity-one selection of A while C has an exact `CapacityWait`. |
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
| Claim loss | `fixtures/story-claim-loss.itf.json` | 9 | Existing test isolates A after claim loss while C progresses. |
| Git rewrite | `fixtures/story-git-rewrite.itf.json` | 9 | Existing test isolates A after incompatible target rewrite while C progresses. |
| External completion | `fixtures/story-external-completion.itf.json` | 8 | Existing test settles A from tracker completion without a duplicate effect. |

Only the six nondeterministic exploration paths feed the interactive graph.
The sample, restart, counterexample, and acceptance stories remain retained
decoder/conformance evidence.

The sample's `fixtures/normal.mbt-projection.json` was independently captured
from the existing version-3 production-backed MBT controls by running `init`
and two `reconstructionStep` calls at capacity one. The test compares every
frame's capacity, task and operation identities, transition tags, exact
task-specific explanation, reservations, occupancy, and coordinator status.

Generated evidence for each trace:

- `artifacts/*.normalized.json`: normalized frames with the raw ITF state
  retained for inspection;
- `artifacts/*.table.md`: the complete decision-bearing frame table; and
- `index.html` and `artifacts/observed-state-dag.html`: the same interactive
  branching graph, node inspector, semantic HTML frame tables, and raw ITF state.

The earlier per-trace Mermaid, SVG, and side-by-side linear path artifacts were
deleted.

## Exact fixture commands

The retained fixtures were produced from Dalph commit `a6233814c`, which is an
ancestor of this prototype branch. The exact `specs/frontierRecovery.qnt`
SHA-256 was
`2c042fe67afd4a84e8481179ec82fc67bd72b198dffed58ec1c9150aaf8243a1`.
The exact `specs/frontierRecovery_test.qnt` SHA-256 for the story traces was
`abe0b81006cc8f291fcca9a479f0ea97de411fcef0ab221b3bb697e81472b185`.

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

Normal sampled trace:

```sh
pnpm exec quint run specs/frontierRecovery.qnt \
  --main frontierRecoveryCapacityOne \
  --init init \
  --step reconstructionStep \
  --max-steps 2 \
  --max-samples 1 \
  --n-traces 1 \
  --seed 131 \
  --mbt \
  --backend typescript \
  --out-itf normal_{seq}.itf.json \
  --verbosity 0
```

Restart candidates (sequence zero was retained). The copies recreate the exact
absolute wrapper source recorded in the raw ITF:

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

Focused result on 2026-07-26:

```text
Test Files  1 passed (1)
Tests       23 passed (23)
```

The final `pnpm check:all` run passed from the isolated worktree: build, package
boundaries, typecheck, lint/format, cycle, complexity, duplication, deterministic
and exhaustive Quint checks, 454 production tests with coverage thresholds,
and the secret scan all completed successfully. Earlier attempts encountered
transient dropped connections from the shared Apalache endpoint; a private
Apalache 0.56.1 server had already returned `[ok] No violation found` for the
same five exhaustive profiles before the final shared-endpoint run succeeded.

Positive cases prove raw-ITF-to-frame preservation, meaningful branching from
the five existing acceptance tests, equality with the existing
MBT comparable projection at all three sampled steps, first-divergence
reporting, agreement with the existing version-3 closed reconstruction action
inventory, deterministic normalized bytes, and decoding of all three retained
trace kinds. Artifact generation also hashes the checked-out Quint model and
refuses to proceed unless it matches the manifest.

Fail-closed cases reject:

- an unknown action;
- a sampled trace with violation status or counterexample trace with ok status;
- a model task identity outside the bounded `0..3` identity map;
- an unsafe JavaScript state index that would lose integer precision; and
- removal of a decision-bearing or displayed revision field;
- an unknown closed Quint state variant; and
- incomplete or mismatched acceptance-test provenance.

## Performance observations

On the retained 1,357,366 bytes of raw ITF (81 frames total), the latest warm
`pnpm check` completed in 2.9 seconds: Vitest reported 575 ms, with the
remaining time covering TypeScript compilation plus all thirty presentation
artifacts.
Regenerating twice produced identical SHA-256 hashes for every artifact.

The normalized artifacts intentionally retain each raw ITF state, so this
prototype favors inspectability over storage efficiency.

## Fidelity statement

Every displayed value comes from one schema-decoded field:

- state position from `#meta.index`;
- action and picked task from `mbt::actionTaken` and
  `mbt::nondetPicks.task`;
- coordinator status from `state.coordinator.running`; and
- task pause from `state.control.taskPaused`;
- task boundary, responsibility, isolation, and settlement from
  `state.workflow`;
- task lifecycle, claim, worktree, invocation, target membership, Git
  compatibility, promotion, and revision from `state.authority`;
- task observation and durable knowledge revision from `state.knowledge`; and
- capacity, frontier, admission, task/operation identities, transition tags,
  explanations, reservations, and occupancy from
  `state.selectorProjection`.

Projected away from the first-screen view:

- authority fields not named above, including blockers and readability;
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
- the older tag-only selector projection without task-specific explanations;
- missing decision-bearing selector fields; and
- traces containing zero or multiple imported `::state` variables.

The comparison says only whether the decoded model frame equals a supplied
implementation projection. It does not decide whether either side is correct.

## Adoption boundary

If Dalph later adopts a trace explanation artifact, the normalized decoder,
semantic tables, and observed graph may be useful as test/research tooling. A
durable graph must retain the sampled/incomplete label unless an authoritative
bounded explorer supplies every successor. Keep Quint and the existing MBT
comparison authoritative.

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
imports the existing version-3 conformance inventory and fails on drift.

The final standards pass noted that model operation ID `-1` is a sentinel
rather than a real operation identity. This prototype retains it because it is
the exact existing Quint/MBT wire value and constrains the schema to `-1` or a
nonnegative integer. A durable domain model should use a tagged
`NoOperationYet | ModelOperationId` variant instead.
