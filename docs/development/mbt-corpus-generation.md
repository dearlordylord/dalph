# Generate and replay an explicit MBT corpus

**All 39 current corpus lanes pass provenance validation and complete replay.**
The replay-only implementation is source commit
`65e88ca892aead74f4f4dc494936b46f2f2b15da`; its refreshed manifest provenance is
`375828764bbd69a68a431bb1ebdb42cfd282311c0056cc1924bd34e49ce6deba`.
The focused observations below ran against those source bytes before committing,
with Git HEAD still at planned Base `08fa36605900f9edb59fc4bdc79b07d51d64593f`.
They are source/corpus qualification, not a frozen candidate gate or hosted CI.

Pre-migration generation/replay evidence binds source commit
`87a897ebf2496ac32b07cb9b0bb3e1afe64a4476` and manifest provenance digest
`c7ae0604d8fbb64ae3628d9ba530cc10b1ba34f808368839561fcf6d8b5c4359`.
The original detached-generator custody blocker has a controlled repair in this
candidate. Before importing the existing `TraceGeneration` service, the Linux
worker proves it is its bounded supervisor's group leader and durably records
its exact PID, group, start ticks and boot. A narrow installed-library patch
honors that worker's opt-in group binding. Quint and compiled-evaluator children
inherit the existing worker group; the adapter's scope signals its exact child,
while the bounded supervisor owns group termination and absence observation.
Other library consumers retain the default detached behavior. This changes no
Dalph workflow, journal, Git/tracker effect or model-generation algorithm.

A failed, missing, foreign-boot or still-present group observation cannot
authorize corpus publication. The producer preserves raw evidence and custody;
it never turns worker disappearance into proof of generator disappearance.
Repeated launch into a retained custody namespace is refused before importing
the generator. Linux generation is the currently proved host boundary; other
platforms fail explicitly rather than inventing ownership proof.

The maintainer invokes `mise exec -- pnpm mbt:generate --all` in the prepared
worktree. The producer first derives and validates the current
[manifest](../../scripts/mbt-corpus-manifest.json), then generates its 39 lanes
serially using the installed pinned Quint executable through `TraceGeneration`.
A selected invocation accepts exact lane IDs; unknown or duplicate IDs fail
before child launch. No replay command refreshes the manifest or generates data.

The producer records the batch and each lane's expected duration, options and
absolute UTC stop before effects. Its decreasing total budget is thirty minutes;
each lane has at most ten minutes. An interruption margin lets Effect release
the generator before the outer process deadline. The existing bounded runner
owns worker process groups and relays parent signals. A monitor refuses raw
output exceeding the lane or remaining batch byte allowance. Before publication,
it drains pending samples and checks final raw bytes again. Validation checks
trace count, state/byte bounds, current inputs and the pinned ITF decoder before
publication. It writes complete corpus bytes first and the receipt last through
same-directory renames. If interrupted between them, replay refuses the
mismatched pair. Existing complete artifacts remain available until replacement;
partial raw traces stay only in retained evidence.

Every invocation retains its manifest, intent, raw traces, child output and
outcomes under `.scratch/mbt-generation/batch-*`. A failed lane stops the batch
without retry or continuation. Inspect its `outcome.json` and raw traces before
a focused repair. A failed or interrupted batch cannot count as all required
artifacts. Never reduce samples, traces or depth to make a lane fit.

The maintainer invokes `mise exec -- pnpm test:mbt` (or `pnpm mbt:replay`)
for the complete replay consumer. The required `mbt-replay` quality stage invokes
that same command. It validates every required artifact before launching either
maintained MBT project. Every suite routes its three generation-named imports
through `corpusReplayFor` with its exact original source identity; all bodies,
state checks, mutant assertions, reverse evaluator controls and driver
configurations remain. Ordinary suites use four workers; accepted-result
integration remains serial. `quintIt` retains its thirty-second default, and all
explicit existing test timeouts remain. Each child command is bounded by ten
minutes and the decreasing thirty-minute batch allowance. No temporary suite
copies are created. The existing bounded runner retains child custody; an
unproven child outcome retains its evidence for reconciliation. A sentinel
executable fails and records any attempt to launch Quint; success requires zero
invocations. The enclosing quality stage has its own ten-minute bound.

The corpus-only layer can also be selected explicitly by lane ID:

```ts
quintRunWithTraceGeneration(existingOptions).pipe(
  Effect.provide(corpusTraceGenerationLayer("result-recovery-direction/1"))
)
```

Import the layer from `scripts/mbt-corpus-loader.mjs` in repository tooling.
The layer compares effective generation options and the model with the selected
lane, then reads both files, derives current provenance, checks byte hashes and
budgets, and decodes ITF envelopes before returning traces. It refuses compiled
input, live trace directories and generator executable overrides. The caller
keeps its existing driver, configurable action/state paths, state checks and
post-replay assertions. No alternate runner or model checker is introduced.

This is verification tooling only. It does not change a Dalph command, workflow
operation, decision, provider effect, journal record, retry, cleanup action or
runtime-visible result. Runtime operational scenarios do not apply. Hosted CI must validate shared automatic selection after integration; focused
local routing controls do not claim hosted qualification.

| Tooling chronology | Focused acceptance control |
| --- | --- |
| The maintainer supplies current inputs and a selected lane; the producer records intent, generates with the declared options, validates complete traces, then publishes bytes and receipt. Unknown/duplicate selections refuse before generation. | `pnpm mbt:generate --all`; manifest freshness and lane inventory controls in `scripts/mbt-corpus-contract.test.mjs` |
| A replay consumer has a matching artifact and options; the layer validates provenance and decoding, then the existing driver replays every state. Repeated loads return the same traces without process or network effects. | `scripts/mbt-corpus-loader.test.mjs`; `pnpm mbt:replay`; `scripts/measure-mbt-corpus.mjs` compares supplied-trace baseline and corpus states and exact replay outcomes |
| A replay consumer encounters missing bytes/receipt, corruption, stale model/tool/options with a rehashed receipt, malformed ITF, wrong options or unknown lane. It fails before exposing traces, without generation or network effects. | `scripts/mbt-corpus-loader.test.mjs`; stale imported-model, seed, depth and byte controls in `scripts/mbt-corpus-contract.test.mjs` |
| The maintainer runs ordinary verification for narrow, shared or unknown changed paths. Local and hosted plans require exactly one `mbt-replay` stage using `test:mbt`; a missing/failed hosted replay cell cannot produce a passing aggregate. | `scripts/mbt-automatic-routing.test.mjs`; `scripts/quality-gate-stage-plan.test.mjs`; `scripts/quality-command-routing.test.mjs`; `scripts/hosted-quality-evidence.test.mjs` |
| A generation lane fails or exceeds its bounds; the producer retains raw evidence and the failed outcome and does not launch the next lane. A crash during publication cannot authorize partial replay. | Failed generation evidence plus receipt/hash/count negatives in the contract controls; process custody remains owned by `scripts/run-bounded-command.mjs` |

The representative fixture and loader instrumentation are focused proof of this
seam. They do not claim automatic `test:mbt` migration, gate qualification,
or acceptance of a partially generated corpus.

## Historical attempts before custody and fixed-base repairs

At Base `72a197658092c2e65e902a15e898ec70264e3937`, review of tooling commit
`bf8b71512305be56a3093d0d49665f897607c5d5` on 2026-10-07 UTC found the
unresolved detached-generator custody blocker above. It also found unconditional
consumer cleanup after unproven stops and a byte-monitor/publication race.
The local repairs retain unresolved inputs, drain samples and check final raw
bytes; four focused custody/byte controls pass. This is not generation custody
qualification or full replay evidence.

The explicit batch recorded a 05:25:15 UTC outer stop and was stopped for review
before it. It published 38 of the 39 required corpus/receipt pairs before stop;
`task-fact-reconciliation/9` was missing in that batch. Raw traces, intents, child outputs and
outcomes are retained under `.scratch/mbt-generation/batch-Bs76Py/`; the captured
stop inventory and proof are `.scratch/mbt-generation-review-stop-processes.txt`
and `.scratch/mbt-generation-review-stop-proof.json`. The exact observed producer,
worker and Quint process groups were proven absent. That actual stop evidence
cannot qualify the unsupported future worker-crash boundary. The partial files
under `corpora/mbt/` were untracked evidence with stale receipts after
review repairs. Those files were subsequently replaced by explicit regeneration;
the historical batch was not rehashed or credited as accepted.

The representative pre-review fixture replayed the same ten traces/160 states
and returned `{ "tracesReplayed": 10, "seed": "428" }` in both live and validated
corpus paths, with zero replay generator/process/fetch calls. Its exact outcomes
remain in `.scratch/mbt-fixture/measurement.json`. It does not qualify this changed
draft or replace complete corpus replay. No full `mbt:replay` pass was claimed
for that historical candidate.

The original custody prerequisite was subsequently repaired at the pinned
spawn boundary as described below. A review also found redundant live generation
inside the representative Vitest fixture. The fixture now reads the exact
explicitly generated lane bytes and receipt, supplies those traces directly
through `TraceGeneration` as its baseline, then runs the validated corpus layer
with the same existing driver and options. It compares all trace states and
exact driver outcomes. It performs no live generation. Generation timing and
custody evidence belong to the explicit producer's retained command records.

## Generation custody repair evidence

`scripts/mbt-corpus-process-custody.test.mjs` exercises the actual pinned
TraceGeneration adapter with a controlled executable. Its five controls prove
unowned-worker refusal, inherited exact group identity and stopped receipt,
the original detached-group negative, forced worker/Quint group termination,
and missing/foreign custody refusal. The earlier draft's 38/39 artifact pairs
were unqualified; the changed producer, patch, lockfile and custody fingerprints
required a newly derived manifest and complete regeneration, now completed.
No full gate or complete corpus is credited by these focused controls.

## Historical complete generation and blocked replay, 2026-10-07 UTC

The producer at source commit `1e7daef051a2866e183f44bade8d42b35b160fc3`
generated all 39 lanes with unchanged seeds, samples,
trace counts and depths. Batch `.scratch/mbt-generation/batch-4VCT6m/` recorded
39 passed outcomes, 171,921,812 corpus bytes and 412,752 milliseconds. Each lane
has a generator-group record and stopped-group observation before publication.
The batch started at 06:45:07 UTC; its recorded command-level outer hard stop
was 06:55:30 UTC. It completed before that stop. The 39 artifact/receipt pairs
under `corpora/mbt/` then passed that candidate's provenance, complete inventory and ITF
validation under zero-process/zero-network instrumentation.

The representative controlled fixture uses the exact generated
`result-recovery-direction/1` bytes (276,227 bytes, ten traces, 160 states).
Direct supplied-trace baseline and validated corpus replay both return
`{ "tracesReplayed": 10, "seed": "428" }`; the replay records one corpus seam
call and zero generator/process/network calls. Exact outcomes are retained in
`.scratch/mbt-fixture/measurement.json`.

Complete replay was attempted with a 07:02:30 UTC outer hard stop, after full
inventory validation. It stopped on an ordinary child test failure with
stopped writers proven. Thirteen ordinary suites passed; all nine task-fact
replay lanes failed at initialization. The model expects
`independentTaskEligible: true`, while the unchanged driver's production-frontier
projection reports `false`. The focused lifecycle re-establishment test (seed
2815) reproduces that same mismatch in 3.84 seconds. Evidence is retained in
`.scratch/mbt-complete-replay.log` and
`.scratch/mbt-task-fact-focused-mismatch.log`. Temporary consumer files were
removed after stopped-writer proof; no generation was attempted during replay.
The serial accepted-result replay child was not reached and is not credited.

This was a blocking acceptance conflict at the existing driver/model boundary,
not missing or stale corpus data. No state predicate, model, trace, runtime
behavior or acceptance lane has been weakened or skipped to force success.
The subsequent fixed-base fixture repair below resolved the starting facts
without changing runtime behavior, model state or the eligibility predicate.
A fresh explicit generation batch then replaced the artifacts with current
fingerprints, and complete replay passed.
No mandatory automatic-gate migration or parent-issue closure is claimed.

## Controlled task-fact fixture repair

The driver represents a contemporary workflow established with an explicit fixed
base. Its starting facts now record that policy at the same base as attempt A.
When capacity permits independent task B, the fresh frontier must select ordinal
zero at that exact base; the driver checks both before recording B's plan. The
separately observed replacement base for explicit restart remains unchanged.
The existing independent-task scenario in `reconcile-changed-task-facts.md` owns
this chronology. A focused initial-state test checks eligibility, and all nine
task-fact replay lanes check the subsequent boundary calls and state predicates.

Only the controlled fixture changes: historical runs without a base policy still
refuse fresh admission. Production code, the Quint model, state predicates and
generation/replay budgets remain unchanged. Refreshed manifest fingerprints and
complete corpus replay are required before crediting acceptance.

## Integrator source refresh

The Integrator owns the merge of its fixed target head H and accepted task commit
C. This task's producer fingerprints the implementation import closure as well
as models and tools; every receipt binds to the complete manifest. If that merge
changes an input (including published host-recovery maintenance), the Integrator
must regenerate the derived artifacts against the merged source before freezing
and qualifying its candidate:

```sh
mise exec -- node scripts/mbt-corpus-contract.mjs --write
mise exec -- pnpm mbt:generate --all
mise exec -- pnpm mbt:replay
```

Record an expected duration and absolute hard stop before generation/replay;
recent complete generation took about seven minutes. Preserve all 39 lanes and
the declared seeds, traces, samples and depths. Reconcile stopped writers before
retrying a failed boundary. Do not relabel older receipts or reuse pre-merge
qualification. Include the refreshed manifest, corpora and receipts inside the
merge candidate whose ordered direct parents remain exactly [H, C]; do not add a
separate single-parent artifact-fix commit. Then run the repository's required
checks on that exact frozen candidate and let Dalph publish it through its
existing owner boundary. The task's immutable PlannedBase remains unchanged.

This is derived-artifact maintenance under the accepted Integrator scenario
(`introduce-outer-integrator.md`), not a runtime or provenance policy change.

## Fixed-base replay verification, 2026-10-07 UTC

Both task-fact and accepted-result fixtures now use internally consistent fixed
Run bases. The earlier task-fact initialization mismatch and accepted-result
plan/worktree semantic refusal are retained as negative evidence. Focused initial
eligibility, stop-A/select-B preservation, and accepted-result promotion checks
pass; the historical no-policy fresh-admission refusal also passes. Fresh
typecheck, changed lint, documentation links and 150 formal controls passed.

Batch `.scratch/mbt-generation/batch-KbvJ1P/` generated all 39 lanes with unchanged
budgets. Complete inventory/provenance/ITF validation passed without processes or
network. Full replay passed: 14 ordinary suites / 87 tests, followed by the serial
accepted-result suite / 14 tests. Generator executable invocations were zero.
Exact evidence is in `.scratch/fixture-combined-generation.log`,
`.scratch/fixture-combined-inventory.log` and
`.scratch/fixture-combined-replay.log`. This qualifies that replay boundary only;
the task owner still must complete required submission checks and the Integrator
must qualify its exact merged source as described above.

## Submission qualification, 2026-10-07 UTC

Source candidate `87a897ebf2496ac32b07cb9b0bb3e1afe64a4476` passed fresh
manifest/inventory validation and five focused fixed-base fixture controls.
`check:fast` and one coherent `check:submit` passed before the 07:55:50 UTC
hard stop (expected five minutes). Submission covered production artifacts,
formal controls, typechecking, changed lint, the full lint census, and the
in-memory cassette suite: 49 files passed, 506 tests passed, and 21 existing
cassette skips. Required MBT lanes were not skipped. Exact command evidence is
retained in `.scratch/mbt-fresh-fixture-control-repaired.log`,
`.scratch/mbt-fresh-inventory.log`, `.scratch/mbt-revised-check-fast.log` and
`.scratch/mbt-revised-check-submit.log`.

The subsequent documentation correction only labels superseded negative
attempts as historical and pins the current passing source/provenance. It changes
no fingerprinted implementation or model input, no corpus bytes, and no runtime
behavior. Its affected check is `check:docs`; unchanged source qualification is
not rerun. Integration, publication and parent issue disposition remain with
Dalph and the Integrator as described above.

## Automatic replay migration evidence, 2026-10-07 UTC

The source/corpus snapshot identified above passed complete replay through the
routine `pnpm test:mbt` entry point: all 14 ordinary suites / 87 tests, followed
by the serial accepted-result suite / 14 tests. No required MBT test was skipped;
the sentinel recorded zero generator invocations. Every inventory-approved lane
option, driver expression, state-check expression, seed, trace/state budget and
replay call expression equals the planned Base inventory; source line locations
changed with the imports. Explicit generation batch
`.scratch/mbt-generation/batch-HjM79u/` published all 39 pairs before its
08:15:40 UTC outer stop. No receipt was relabeled to accept old artifacts.

All artifacts passed current provenance/ITF validation under process/network
traps. The representative fixture now invokes the actual `corpusReplayFor`
adapter; supplied-trace baseline and corpus replay both return ten traces with
seed 428, with zero generator/process/network calls. Isolated copies of the
routine replay entry point refused missing corpus in 3.0 seconds and stale
manifest in 1.6 seconds, before any child launch; process spies recorded zero.
The maintained loader controls cover missing receipts, rehashed stale provenance,
corruption, wrong options and malformed ITF without self-healing.

Routing/aggregation controls, 150 formal controls, fresh typecheck and lint,
`check:fast`, documentation links, and one coherent `check:submit` passed.
Submission included 49 cassette files / 506 tests with the 21 existing cassette
skips unchanged. Exact local evidence is retained in
`.scratch/mbt-automatic-generation-final.log`,
`.scratch/mbt-automatic-inventory.log`, `.scratch/mbt-automatic-replay.log`,
`.scratch/mbt-automatic-measurement.log`,
`.scratch/mbt-automatic-command-negatives.json`,
`.scratch/mbt-inventory-preservation.json`,
`.scratch/mbt-automatic-ci-controls.log`,
`.scratch/mbt-automatic-formal-controls.log`, and
`.scratch/mbt-automatic-check-submit.log`.

An earlier partial batch was stopped to correct the adapter declaration's error
contract. Its producer and every launched worker/generator group were proven
absent before the complete batch above; its partial artifacts are not credited.
Shared selection still requires hosted CI after integration, and the Integrator
must refresh provenance and corpora for its exact merged source as described
above. This bounded slice does not close #363 or claim hosted qualification.
