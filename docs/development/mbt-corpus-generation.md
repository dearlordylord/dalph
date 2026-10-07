# Generate and replay an explicit MBT corpus

**Unaccepted draft — do not use for unattended generation.** The bounded worker
runner does not own the pinned library's separately detached Quint group.
Worker crash or forced termination can bypass the library's signal hooks;
worker-group absence cannot prove that the exact generator stopped. The public
`TraceGeneration` service exposes neither its child identity nor a stopped-group
receipt. Exact custody at that existing spawn boundary is a prerequisite for
qualification. This draft does not add an alternate generation/model engine.


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

The maintainer invokes `mise exec -- pnpm mbt:replay` for the complete manual
consumer. It validates every required artifact before launching drivers, then
creates exclusive temporary ordinary-test copies of the selected source files.
Only the three live generation imports are routed through the corpus layer;
the original bodies, state checks, mutant assertions, reverse evaluator controls
and driver configurations remain. Copies preserve their original source identity
for exact lane/options matching. Ordinary suites use four workers; accepted-result
integration remains serial. `quintIt` retains its thirty-second default, and all
explicit existing test timeouts remain. Each child command is bounded by ten
minutes and the decreasing thirty-minute batch allowance. Temporary copies are
removed only after their owned child stops. An unproven child outcome retains
exact paths in `cleanup-retained.json`; reconciliation must prove stopped writers
before removing them or retrying. A sentinel executable fails and
records any attempt to launch Quint; success requires zero invocations.

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
runtime-visible result. Runtime operational scenarios do not apply. Automatic
MBT gate selection and source migration remain separate acceptance boundaries.

| Tooling chronology | Focused acceptance control |
| --- | --- |
| The maintainer supplies current inputs and a selected lane; the producer records intent, generates with the declared options, validates complete traces, then publishes bytes and receipt. Unknown/duplicate selections refuse before generation. | `pnpm mbt:generate --all`; manifest freshness and lane inventory controls in `scripts/mbt-corpus-contract.test.mjs` |
| A replay consumer has a matching artifact and options; the layer validates provenance and decoding, then the existing driver replays every state. Repeated loads return the same traces without process or network effects. | `scripts/mbt-corpus-loader.test.mjs`; `pnpm mbt:replay`; `scripts/measure-mbt-corpus.mjs` compares live and corpus states and exact replay outcomes |
| A replay consumer encounters missing bytes/receipt, corruption, stale model/tool/options with a rehashed receipt, malformed ITF, wrong options or unknown lane. It fails before exposing traces, without generation or network effects. | `scripts/mbt-corpus-loader.test.mjs`; stale imported-model, seed, depth and byte controls in `scripts/mbt-corpus-contract.test.mjs` |
| A generation lane fails or exceeds its bounds; the producer retains raw evidence and the failed outcome and does not launch the next lane. A crash during publication cannot authorize partial replay. | Failed generation evidence plus receipt/hash/count negatives in the contract controls; process custody remains owned by `scripts/run-bounded-command.mjs` |

The representative fixture and loader instrumentation are focused proof of this
seam. They do not claim automatic `test:mbt` migration, gate qualification,
or acceptance of a partially generated corpus.

## Current attempt evidence and open review

At Base `72a197658092c2e65e902a15e898ec70264e3937`, review of tooling commit
`bf8b71512305be56a3093d0d49665f897607c5d5` on 2026-10-07 UTC found the
unresolved detached-generator custody blocker above. It also found unconditional
consumer cleanup after unproven stops and a byte-monitor/publication race.
The local repairs retain unresolved inputs, drain samples and check final raw
bytes; four focused custody/byte controls pass. This is not generation custody
qualification or full replay evidence.

The explicit batch recorded a 05:25:15 UTC outer stop and was stopped for review
before it. It published 38 of the 39 required corpus/receipt pairs before stop;
`task-fact-reconciliation/9` is missing. Raw traces, intents, child outputs and
outcomes are retained under `.scratch/mbt-generation/batch-Bs76Py/`; the captured
stop inventory and proof are `.scratch/mbt-generation-review-stop-processes.txt`
and `.scratch/mbt-generation-review-stop-proof.json`. The exact observed producer,
worker and Quint process groups were proven absent. That actual stop evidence
cannot qualify the unsupported future worker-crash boundary. The partial files
under `corpora/mbt/` remain untracked evidence, and their receipts are stale after
review repairs; they have not been silently rehashed or credited as accepted.

The representative pre-review fixture replayed the same ten traces/160 states
and returned `{ "tracesReplayed": 10, "seed": "428" }` in both live and validated
corpus paths, with zero replay generator/process/fetch calls. Its exact outcomes
remain in `.scratch/mbt-fixture/measurement.json`. It does not qualify this changed
draft or replace complete corpus replay. No full `mbt:replay` pass is claimed.

The next discriminating action belongs at the pinned generator's actual spawn
boundary: expose exact process/group intent, observation and stopped-writer
proof through the existing seam; then exercise forced-worker-stop/crash controls
before another explicit generation batch. Do not substitute another worker
watchdog, lower budgets, rerun the unchanged generator, or wire mandatory gates.
