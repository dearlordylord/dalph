# Quint trace explanation view — throwaway prototype

This isolated prototype answers one question: does a generated path visual
explain the frontier-recovery Quint traces more clearly than a frame table?

**Decision: retain the table format, not the statechart, if Dalph later adopts
a durable trace view.** The SVG makes action order and the crash/restart
position easy to scan, but it omits the capacity, frontier, admission,
reservation, operation identity, and exact capacity-wait explanation that
explain the decision. Adding those values to graph nodes would make the visual
denser than the table. The generated HTML keeps both side by side so the
decision can be inspected.

This is one sampled path, restart path, or counterexample path. It is not “the
state machine,” model checking, MBT, or proof of correctness. The decoder never
selects an action or computes a legal transition.

## Run

Use Node 22.22.2+ or 24.15.0+ and pnpm 10.29.3:

```sh
cd prototypes/quint-trace-view
pnpm install --ignore-workspace --lockfile=false
pnpm check
```

`pnpm check` runs fourteen decoder/equality/drift/fail-closed tests, compiles the
prototype, and regenerates byte-identical normalized, table, Mermaid, SVG, and
side-by-side HTML artifacts.

Pinned versions:

- Quint `0.32.0` (the repository root pin);
- Effect `4.0.0-beta.99`;
- `effect-analyzer@2.1.0`;
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

The sample's `fixtures/normal.mbt-projection.json` was independently captured
from the existing version-3 production-backed MBT controls by running `init`
and two `reconstructionStep` calls at capacity one. The test compares every
frame's capacity, task and operation identities, transition tags, exact
task-specific explanation, reservations, occupancy, and coordinator status.

Generated evidence for each trace:

- `artifacts/*.normalized.json`: normalized frames with the raw ITF state
  retained for inspection;
- `artifacts/*.table.md`: the complete decision-bearing frame table;
- `artifacts/*.visual.mmd`: MachineJSON rendered through Effect Analyzer;
- `artifacts/*.visual.svg`: the same path as standalone SVG; and
- `artifacts/*.side-by-side.html`: table and visual together, followed by
  expandable raw ITF states.

## Exact fixture commands

The retained fixtures were produced from Dalph commit `a6233814c`, which is an
ancestor of this prototype branch. The exact `specs/frontierRecovery.qnt`
SHA-256 was
`2c042fe67afd4a84e8481179ec82fc67bd72b198dffed58ec1c9150aaf8243a1`.

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
Tests       14 passed (14)
```

The final `pnpm check:all` run passed from the isolated worktree: build, package
boundaries, typecheck, lint/format, cycle, complexity, duplication, deterministic
and exhaustive Quint checks, 454 production tests with coverage thresholds,
and the secret scan all completed successfully. Earlier attempts encountered
transient dropped connections from the shared Apalache endpoint; a private
Apalache 0.56.1 server had already returned `[ok] No violation found` for the
same five exhaustive profiles before the final shared-endpoint run succeeded.

Positive cases prove raw-ITF-to-frame preservation, equality with the existing
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
- removal of `reservationTaskIds`, a decision-bearing field.

## Performance observations

On the retained 218,756 bytes of raw ITF (13 frames total), `pnpm check`
completed in 8.16 seconds cold and 7.06 seconds warm: Vitest reported 1.22
seconds and 881 ms respectively, with the remaining time covering TypeScript
compilation plus all 15 presentation artifacts.
Regenerating twice produced identical SHA-256 hashes for every artifact.

The fixture sizes are 50,548 bytes sampled, 117,454 bytes restart, and 50,754
bytes counterexample. The normalized artifacts intentionally retain each raw
ITF state, so this prototype favors inspectability over storage efficiency.

## Fidelity statement

Every displayed value comes from one schema-decoded field:

- state position from `#meta.index`;
- action and picked task from `mbt::actionTaken` and
  `mbt::nondetPicks.task`;
- coordinator status from `state.coordinator.running`; and
- capacity, frontier, admission, task/operation identities, transition tags,
  explanations, reservations, and occupancy from
  `state.selectorProjection`.

Projected away from the first-screen view:

- task-tracker/Git/provider authority records;
- control epochs and detailed pause maps;
- effect identity sets and effect counters;
- complete durable knowledge and reconstruction graph evidence;
- request identity sets, freshness counters, and duplicate-effect counters;
- detailed workflow boundary, intent, request, isolation, outcome, and
  settlement fields; and
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

If Dalph later adopts a trace explanation artifact, adopt the normalized
decoder and table as test/research tooling. Do not adopt the generated
statechart as a durable format: it is not materially clearer for the decision
being explained. Keep Quint and the existing MBT comparison authoritative.

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
