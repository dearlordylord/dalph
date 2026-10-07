# Generate and replay an explicit MBT corpus

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
output exceeding the lane or remaining batch byte allowance. Validation checks
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
removed only after their owned child stops. A sentinel executable fails and
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
