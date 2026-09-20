# Can TypeScript-originated traces replace Quint-driven conformance?

Research date: 2026-09-20. Repository base: `97d6138e0075ccee4c9f08377977cf57ca4da039`.

## Decision

TypeScript-originated traces checked against Quint can be a **full substitute for the generation direction** of Dalph's existing model-based tests, but only if the replacement suite preserves the same semantic obligations: an independent TypeScript generator covers the required behaviors and fault schedules, a sound abstraction relates each observed execution to some legal Quint execution, and negative controls demonstrate both coverage and rejection. Direction alone does not make either approach adequate.

Accordingly:

- In the near term, keep #363's pre-generated Quint-trace replay as the lower-risk restoration of the currently missing automatic conformance lane.
- A reverse lane may replace it after a comparative experiment shows equivalent action/edge/fault coverage, mutation sensitivity, reproducibility, and cost. It need not preserve the same traces, action labels, or explicit nondeterministic picks when a whole-path checker can existentially infer hidden model choices.
- Such a replacement would require amending #363 and the repository's accepted conformance policy. The current issue is evidence about the approved restoration path, not a permanent technical requirement.

This conclusion does not alter model-only simulation. Dalph's deterministic Quint tests, sampled runs with invariants and witnesses, negative controls, and exhaustive projections check the model itself and explore behaviors independently of TypeScript. Checking observed TypeScript traces against Quint neither explores the Quint state space nor establishes unobserved invariants/witness reachability. The four evidence classes are explicitly separate in the [Quint guide](../docs/QUINT-GUIDE.md#what-runs-a-model); the current gate deliberately retains canonical simulation when a smaller projection owns exhaustive verification.

## Present contracts

Dalph pins `@firfi/quint-connect` `2.0.2-effect4.1` and patches only Effect error constructors ([package and patch](../package.json)). The pinned runner obtains traces from Quint, creates a fresh driver for each trace, dispatches the recorded action and nondeterministic picks, then compares the projected Quint and implementation states after every dispatched step. Unknown actions fail, except for the connector's special direct-no-op `step`; an empty action is skipped only at step zero. A driver without a state observer cannot use state checking. These details are source contracts, not merely README descriptions: [runner](https://github.com/dearlordylord/quint-connect-ts/blob/v2.0.2-effect4.1/src/runner/runner.ts), [dispatch](https://github.com/dearlordylord/quint-connect-ts/blob/v2.0.2-effect4.1/src/runner/replay-dispatch.ts), and [state checking](https://github.com/dearlordylord/quint-connect-ts/blob/v2.0.2-effect4.1/src/runner/state-check.ts).

The Dalph adapters use that stronger stateful form. They invoke production decision/protocol seams and compare intentional projections after each step. Examples include fixed random traces for [application Exit](../packages/dalph/test/conformance/application-exit.mbt.test.ts), [planned-attempt execution](../packages/dalph/test/conformance/planned-attempt-executor.mbt.test.ts), and [task-fact reconciliation](../packages/dalph/test/conformance/task-fact-reconciliation.mbt.test.ts), plus focused one-trace chronologies for lost responses, crashes, re-establishment, and retry. The application-Exit mapping states the intended boundary plainly: every canonical step action is registered, controlled facts are established, production lifecycle decisions are invoked, and the full canonical projection is compared after every generated step ([mapping](../docs/scenarios/application-exit-model-mapping.md#scenario-to-test-mapping-for-issue-203)).

The tracker currently says automatic MBT is disabled because traces are regenerated during each TypeScript run. [Issue #363](https://github.com/dearlordylord/dalph/issues/363) requires a pre-generated ITF corpus, provenance over model/tool/options, failure on missing or stale traces, preservation of current drivers/state checks/seeds/budgets, and proof that routine replay launches no generator. Reverse trace validation does not satisfy those acceptance criteria by itself.

### Reverse-validation mechanisms checked

The pinned Quint `0.32.0` CLI exposes simulation/test/verification and ITF **output**, but no dedicated command that consumes an implementation trace and checks its transition relation ([pinned CLI implementation](https://github.com/quint-co/quint/blob/v0.32.0/quint/src/cli.ts), [current command documentation](https://github.com/quint-co/quint/blob/6fb2924e00707cef6dbc5e30db606d555c447123/docs/content/docs/quint.md)). That is an API observation, not a claim that reverse validation is impossible or unavailable by composition.

Three concrete mechanisms are viable:

1. Generate a small Quint harness from the TypeScript trace (or expose it as typed constants), constrain `init` to the first abstract observation and each indexed `step` to the next observation, then use `quint test`, `run`, or `verify` to ask whether a complete matching execution exists. Hidden action identities and nondeterministic values remain existential choices.
2. Drive Quint's evaluator/REPL step interface programmatically, retain the frontier of states matching each abstract observation, and accept only if at least one complete path survives. This is simulation-guided validation; exhaustive branching is required when local matches are ambiguous.
3. Translate Quint to its TLA+/Apalache boundary and use symbolic transition constraints. Apalache accepts typed ITF as input ([ITF ADR](https://apalache-mc.org/docs/adr/015adr-trace.html#itf-as-input-to-apalache)); its transition-exploration interface supports constraining symbolic states/transitions and checking satisfiability ([transition-explorer RFC](https://apalache-mc.org/docs/adr/010rfc-transition-explorer.html)). Apalache's `tracee` command evaluates expressions over an input trace but does **not by itself** establish that adjacent states satisfy `Next` ([trace-evaluation ADR](https://apalache-mc.org/docs/adr/023adr-trace-evaluation.html)); transition validity still needs explicit symbolic constraints.

This research evaluated those mechanisms at the contract level, not by implementing them. The 2025 Quint Connect post's characterization of trace validation as future work describes that library's status at publication time only and is not used as evidence of present-day nonexistence.

## What reverse validation can and cannot establish

| Concern | TypeScript trace checked by Quint | Existing Quint-generated replay |
| --- | --- | --- |
| Observed transition safety | Strong, if the trace has a sound abstraction and the checker proves a legal whole model path rather than merely checking state invariants. | Strong for every generated step through the same reviewed action/pick/state projection. |
| Missing enabled behavior | Cannot detect behavior its TypeScript generator never chooses. An independent property/schedule/fault generator plus explicit coverage obligations can close this gap; without them, passing traces establish subset inclusion only for the sample. | Quint independently chooses enabled model actions and inputs; bounded generation can exercise behavior absent from handwritten implementation tests. It is still sampling, not proof. |
| Forbidden/extra implementation behavior | Detects an observed illegal transition. It does not detect a dormant illegal branch. | Detects a wrong implementation result when a generated model action reaches the branch; it cannot directly ask the implementation to initiate an extra action outside the driver map. |
| Model-only safety/exploration | No substitute: it checks one imported finite prefix. | Also not a substitute by itself, but Dalph runs separate tests, simulations, mutation controls and exhaustive verification. |
| Fairness/liveness | A finite successful trace cannot show that all relevant executions eventually progress. Timeouts can expose one failure, but trace truncation must not pass as success. | Finite replay has the same logical limit, but model-generated schedules and model-only liveness/verification can independently search adverse schedules. |
| Oracle/generator independence | Quint remains an independent oracle, but the implementation (or tests written around it) becomes the behavior generator. Shared bugs and omissions can make both trace and projection look self-consistent. | The model generates behavior and expected state independently of production; the adapter is still a reviewed trust boundary. |

### Trace completeness and abstraction

A reverse checker needs a reviewed refinement boundary, not a log parser that happens to accept current output. Each trace needs enough information to reconstruct:

1. a complete initial abstract state;
2. modeled external inputs and outputs; action identity and hidden nondeterministic choices may instead be existentially inferred;
3. the implementation projection at every relevant abstract boundary;
4. ordering/correlation needed to distinguish concurrent boundary calls; and
5. an explicit outcome for crash, cancellation, timeout, or truncated collection.

Projection is necessarily lossy. Raw internal events need not all appear. Omitting detail is sound when the abstraction proves that the skipped implementation fragment refines one model step, a sequence of hidden model steps, or stuttering at the abstract boundary. TLA's foundational account explains why stuttering is semantically harmless only when the abstract behavior is unchanged ([Lamport, *Safety and Liveness Properties*](https://lamport.azurewebsites.net/tla/safety-liveness.pdf)). Dalph already treats projection/stutter mappings as audited obligations rather than guesses—for example, every canonical fresh-admission action has an explicit projection action or stutter mapping ([Quint guide](../docs/QUINT-GUIDE.md#what-runs-a-model)). An abstraction must still expose transient facts that matter to authorization, release, duplicate effects, or reconciliation; final-state equality alone is insufficient.

State-pair matching can be sufficient when the model transition relation plus observed external I/O uniquely constrains an acceptable step; an implementation action label is not inherently part of the semantic contract. Labels and recorded picks are useful diagnostics and may be mandatory where two observationally equal transitions have different obligations. Conversely, action matching alone is insufficient because the right label can produce the wrong durable state. Where choices are hidden or the model is nondeterministic, the checker must solve for an entire compatible model path (with backtracking or symbolic constraints); a greedy choice of the first locally matching action can reject a valid trace or accept an incoherent one.

### Crashes, retries, and internal actions

Dalph's models deliberately generate awkward cuts: lost append responses, ambiguous executor outcomes, crash/recovery, exact rereads before retry, and bounded redelivery. Examples are visible in [fresh-task admission](../specs/freshTaskAdmission.qnt), [planned-attempt execution](../specs/plannedAttemptExecutor.qnt), and [Run cancellation](../specs/runCancellation.qnt). A normal TypeScript run will rarely choose process loss at the exact modeled cut. Reverse validation therefore needs a fault/schedule injector and durable-state capture around each uncertain boundary. Without that independent control, it preferentially validates happy paths and loses the main value of these adapters.

An internal implementation action may map to stutter, but only if its abstract projection genuinely does not change. Conversely, one implementation call may refine into several model steps or one model action may cover several atomic implementation operations. The trace schema must express these mappings and atomicity; one-event-to-one-action matching is not generally sound.

### Failures, shrinking, and reproduction

Current replay failures name seed, trace index, step index, action, and expected/actual state; #363 adds immutable corpus provenance. Reverse validation should retain the raw TypeScript trace, implementation revision, test/fault seed, model revision, checker/tool version, projection version, and matching path. A first unmatched transition is usually reproducible from that artifact, but with nondeterminism the diagnostic should report the viable model frontier, not invent one expected successor.

Property-based shrinking can help minimize the implementation inputs or fault schedule, but every shrink candidate must be re-executed and revalidated. Deleting an event from an already captured trace can manufacture an impossible prefix, erase a required reconciliation, or turn a non-stuttering internal action into an apparent atomic jump. Model-generated ITF replay already has exact seeds and retained trace artifacts; reverse validation is not inherently better at shrinking.

### Cost

Reverse validation may remove per-test Quint trace generation and may reuse executions already produced by ordinary tests. That is a plausible CPU and latency saving, but it is not yet measured here. It still pays for production execution, trace serialization, projection, and model-path matching. Ambiguous traces can require branching search and cost more than linear replay. Pre-generated corpus replay under #363 removes routine generation while preserving the existing simple linear dispatch/check loop, so it is the lower-risk near-term response—not necessarily the final policy. No benchmark or gate was run for this research.

Migration would not be free: current action handlers drive exact production seams, whereas a reverse lane needs trustworthy instrumentation, an action/atomicity abstraction, fault injection, a path matcher, corpus provenance, truncation handling, and new diagnostics. State-projection code may be reusable; most action-driving code is not.

## Smallest discriminating experiment

Use the existing focused planned-attempt scenario `resumeRedeliveryMbtStep` (one trace, at most 40 steps) rather than migrating a whole adapter. It contains an initial Resume delivery crash, a crash during redelivery, a second redelivery, durable intent, reconciliation projection, and exact state comparison ([adapter](../packages/dalph/test/conformance/planned-attempt-executor.mbt.test.ts), [model](../specs/plannedAttemptExecutor.qnt)).

1. Run its production driver from a TypeScript-authored directed schedule and record initial state plus action, picks, pre/post projection, correlation, ordinal and crash marker at every boundary.
2. Validate the complete trace existentially against the pinned model, constraining abstract states and external I/O while allowing hidden action/pick choices; report the complete viable model path and inferred choices.
3. Replay the existing pre-generated/model-generated trace through the current driver as the control. Compare unique production boundary calls and projected states, not just pass/fail.
4. Add these negative controls:
   - wrong post-state with the correct action label must fail;
   - wrong action label with an equal post-state must fail in an action-sensitive control, while an intentionally hidden-label control must still find the legal transition existentially;
   - deletion/reordering of the reconciliation step must fail rather than become implicit stutter;
   - a half-recorded crash/truncated trace must fail closed;
   - an ambiguous prefix requiring backtracking must pass only when one complete path exists;
   - an implementation mutant reachable only on an omitted retry/fault schedule must pass the reverse sample but fail the existing model-generated corpus. This is the critical demonstration of the guarantee reverse validation loses;
   - a model mutant that wrongly admits that illegal transition must make the preceding negative trace pass, proving the model oracle is actually consulted.
5. Record CPU time separately for production execution, trace capture, and model matching. Do not compare it with fresh generation until #363's replay-only baseline exists.

Success would justify a complementary reverse lane and replacement of duplicate replay for this *exact chronology*. Full replacement of the canonical 100-trace executor MBT and other focused traces becomes justified if the independent TypeScript generator and coverage/mutation controls preserve their semantic obligations at acceptable cost. No result from this experiment would justify removing model-only simulation/verification.

## Limitations

This was a bounded source review. It inspected the pinned Quint/connector contracts, current Dalph adapters/models, current Apalache trace and transition interfaces, and the live read-only state of #363; it did not implement a reverse checker, execute MBT, benchmark either direction, or audit every action-to-production handler. It did not establish whether a newer third-party Quint-specific reverse-validation library exists. The recommendation is therefore architectural and evidence-based, not a performance result.
