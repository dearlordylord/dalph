# Effect Analyzer and Quint evaluation

Status: research input for a later handoff. This note changes no production
code and makes no adoption decision.

Research date: 2026-07-26.

External source versions:

- [`effect-analyzer` 2.1.0](https://github.com/jagreehal/effect-analyzer/tree/effect-analyzer%402.1.0),
  the version published under npm's `latest` tag during this evaluation;
- `effect-analyzer` `main` at
  [`f8a84c68b6fba820929e31c5c39e2b06dc2e370d`](https://github.com/jagreehal/effect-analyzer/commit/f8a84c68b6fba820929e31c5c39e2b06dc2e370d);
- Dalph `master` at `84b2c9768`; and
- Quint 0.32.0 and `@firfi/quint-connect` 2.0.2-effect4.1, as pinned by
  Dalph's [`package.json`](../package.json).

## Recommendation now

Do not adopt `effect-analyzer` as a correctness gate and do not use it to
derive a Quint model from Effect source.

It is promising in two narrower roles:

1. a local, non-authoritative architecture report over selected Effect
   workflows; and
2. a renderer library for a deliberately small projection of a Quint ITF
   trace.

The second role deserves one throwaway prototype. The prototype must consume
Quint's existing ITF output and Dalph's existing conformance projection. It
must not introduce a second transition system or teach production code XState
concepts.

These are separate adoption decisions. Failure of the whole-codebase
architecture audit must not block experimenting with the Quint trace renderer,
and a readable Quint trace does not validate `effect-analyzer` as a Dalph
source-analysis gate.

## What the tool actually does

### Established facts

`effect-analyzer` parses TypeScript with `ts-morph` and the TypeScript type
checker. It constructs a static intermediate representation of Effect
programs, then renders service, error, concurrency, resource, retry, timeline,
statechart, and other views. It does not execute the analyzed program or
instrument it at analysis time
([README](https://github.com/jagreehal/effect-analyzer/blob/effect-analyzer%402.1.0/README.md#why)).

Its 2.1.0 package:

- supports Node 22;
- declares Effect `^4.0.0-beta.99` as both peer and direct dependency;
- exports a small root API and broader `analysis`, `diagram`, `rules`, and
  `migration` subpaths; and
- depends on `ts-morph`
  ([package manifest](https://github.com/jagreehal/effect-analyzer/blob/effect-analyzer%402.1.0/packages/effect-analyzer/package.json)).

Dalph uses Node 22 or 24 and Effect `4.0.0-beta.99`, so published version 2.1.0
is package-compatible with Dalph's currently pinned versions. Current
`effect-analyzer` `main` has already moved to Effect beta.101
([current manifest](https://github.com/jagreehal/effect-analyzer/blob/f8a84c68b6fba820929e31c5c39e2b06dc2e370d/packages/effect-analyzer/package.json)).
Any experiment therefore has to pin 2.1.0 exactly instead of tracking
`latest` or `main`.

The analyzer has two different representations relevant to Dalph:

1. `StaticEffectIR` represents the source structure of an Effect program.
   The library indexes source nodes, parents, and literal nested span paths
   ([IR indexing](https://github.com/jagreehal/effect-analyzer/blob/effect-analyzer%402.1.0/packages/effect-analyzer/src/ir.ts)).
2. `StateMachine` represents states and transition triples. It can be
   extracted from a few recognized TypeScript shapes or constructed from
   MachineJSON
   ([state-machine IR](https://github.com/jagreehal/effect-analyzer/blob/effect-analyzer%402.1.0/packages/effect-analyzer/src/state-machine.ts),
   [MachineJSON ingestion](https://github.com/jagreehal/effect-analyzer/blob/effect-analyzer%402.1.0/packages/effect-analyzer/src/state-machine-json.ts)).

MachineJSON ingestion is a programmatic API. The CLI does not discover a
MachineJSON object as an executable state machine. Actions, guards, and invoked
effects are labels; the analyzer does not run them
([state-machine documentation](https://github.com/jagreehal/effect-analyzer/blob/effect-analyzer%402.1.0/apps/docs/src/content/docs/reference/state-machines.mdx#machinejson)).

The analyzer's state-machine “coverage” is structural. It checks such things
as reachability, event/state alphabet drift, and whether a declared event is
used by any transition. It does not explore concurrent interleavings or check
temporal or safety invariants
([coverage implementation](https://github.com/jagreehal/effect-analyzer/blob/effect-analyzer%402.1.0/packages/effect-analyzer/src/state-machine-coverage.ts)).

It can also join Effect or OpenTelemetry spans to static IR nodes by an exact
nested span-name path. The result distinguishes uniquely matched, unmatched,
and ambiguous spans
([runtime adapter](https://github.com/jagreehal/effect-analyzer/blob/effect-analyzer%402.1.0/packages/effect-analyzer/src/runtime-trace.ts),
[fidelity documentation](https://github.com/jagreehal/effect-analyzer/blob/effect-analyzer%402.1.0/apps/docs/src/content/docs/reference/diagram-fidelity.mdx#match-runtime-spans)).
This join is about source location and execution status. It is not a join on
Dalph task identity, operation identity, journal position, or model state.

### Hypotheses that still require experiments

- A selected set of Dalph Effect programs may produce useful architecture
  diffs in review even when a whole-project audit is too expensive or noisy.
- A small ITF projection can be converted to MachineJSON for rendering without
  losing facts needed to explain one sampled trace.
- If Dalph later emits operationally useful spans, an Effect-span overlay could
  show which source operations a conformance run actually exercised.
- A three-way view—Quint state, Dalph projected state, and Effect source
  location—may help debug a failed MBT comparison.

None of those hypotheses says the analyzer can prove that the implementation
conforms to the Quint model.

## Trial against Dalph

The following read-only commands used published `effect-analyzer@2.1.0` through
`pnpm dlx`. No generated files were colocated with source.

### Task admission controller

```text
pnpm dlx effect-analyzer@2.1.0 \
  packages/orchestrator/src/task-admission-controller.ts \
  --assert-diagram-fidelity --format summary
```

The analyzer found six Effect programs. Five received exact fidelity reports.
`makeTaskAdmissionController` received 91/100, with:

- one unknown node: it could not determine a loop body; and
- two duplicate static span-path findings for
  `TaskAdmissionController.admit`.

The concurrency renderer found the two sequential `Effect.all` calls and the
semaphore construction. It did not represent the important semantic behavior:
the semaphore protects admission-state changes, and an uninterruptible handoff
coordinates a `Deferred`, reservation ownership, interruption cleanup, and
the next waiting invocation
([controller](../packages/orchestrator/src/task-admission-controller.ts#L151-L245)).

That is direct evidence that a clean-looking analyzer diagram is not enough to
validate controller correctness.

### Recovery workflow

```text
pnpm dlx effect-analyzer@2.1.0 \
  packages/orchestrator/src/workflow-recovery.ts \
  --assert-diagram-fidelity --format summary
```

It found nine programs, filtered six as trivial, and reported exact fidelity
for the three displayed programs:

- `continueMissingPlannedTaskAttemptStages`;
- `observeManagedRunAuthorities`; and
- `recoverExactRunAfterCoordinatorDeath`.

This is useful evidence that the static analyzer can read an important
production workflow without source changes. It is not evidence that recovery
uses the correct frontier, capacity, or authority facts.

### Frontier and conformance reducers

The statechart renderer found no machine in `runnable-frontier.ts`. It reported
the two single-level `Match.tags` values as variant dispatch rather than
state/event transitions. This is intentional analyzer behavior: a statechart
needs a source-state dimension and an event dimension
([recognizer rationale](https://github.com/jagreehal/effect-analyzer/blob/effect-analyzer%402.1.0/README.md#state-machines-without-xstate)).

It likewise found no machine in
`frontier-recovery-conformance.ts`; its closed action dispatch is one
action-to-control mapping, not a state transition function
([Dalph adapter](../packages/orchestrator/test/frontier-recovery/frontier-recovery-conformance.ts)).

This is the correct reason not to rewrite those reducers into an
analyzer-recognized shape merely to obtain a picture. A visualization adapter
should consume their existing outputs.

The analyzer did parse the reconstruction control implementation, but the
main factory received 45/100 fidelity due to repeated static span paths. One
named control received 90/100 because a constructor was not recognized, while
`rawControls.reconstructionStep` received 100/100. This result is too mixed to
use as a gate without an intentional source-wide baseline and triage.

### Whole-directory audit

The CLI whole-directory coverage audit did not complete successfully in the
current execution environment, including with a one-file cursor window. It
produced no diagnostic before the process ended. The cause was not established.

Therefore this research does **not** claim that `effect-analyzer` can audit the
whole Dalph project within acceptable memory and time. A handoff considering
code-analysis adoption must reproduce and diagnose this result before changing
CI or dependencies.

## Techniques worth reusing

### 1. Use a typed, renderer-independent intermediate representation

**Fact:** Effect Analyzer separates source extraction from its IR and
renderers. Its analysis subpath exports the IR traversal, state-machine,
MachineJSON, coverage, and rendering APIs
([analysis exports](https://github.com/jagreehal/effect-analyzer/blob/effect-analyzer%402.1.0/packages/effect-analyzer/src/analysis-entry.ts)).

**Dalph application hypothesis:** Keep Dalph's existing versioned conformance
projection as the semantic boundary. Convert that projection to a visualization
IR only after decoding it. Mermaid, SVG, HTML, and XState config then become
replaceable presentations of the same facts.

Do not make MachineJSON a production Dalph domain type.

### 2. Report fidelity instead of hiding unsupported syntax

**Fact:** Effect Analyzer records unknown, opaque, dynamic-span, and
duplicate-span-path findings and can refuse to call a diagram exact
([fidelity implementation](https://github.com/jagreehal/effect-analyzer/blob/effect-analyzer%402.1.0/packages/effect-analyzer/src/diagram-fidelity.ts)).

**Dalph application hypothesis:** A generated Quint step view should carry its
own fidelity record:

- exact ITF fields decoded;
- fields intentionally projected away;
- unknown action or identity;
- duplicate presentation state;
- missing implementation comparison; and
- whether the trace is sampled, a witness, or a counterexample.

A picture without this record invites readers to mistake a projection for the
full model.

### 3. Use declared alphabets for drift detection

**Fact:** The state-machine analyzer compares extracted symbols with tagged
union, Schema-derived, or MachineJSON-declared alphabets.

**Dalph application hypothesis:** The visualization adapter should use the
closed action inventory already exported by
`frontierRecoveryReconstructionActions`, plus a closed schema for every
displayed model field. An unknown Quint action should fail the adapter instead
of rendering an unlabeled edge.

This duplicates no scheduler logic. It checks the compatibility boundary
already required by the MBT driver.

### 4. Join runtime observations only through explicit stable names

**Fact:** Effect Analyzer refuses to treat a computed or duplicate span path as
an exact runtime join.

**Dalph application hypothesis:** If an MBT trace is ever joined to runtime
spans, the join must include a stable conformance action identity and Dalph
operation identity in a dedicated typed adapter. Literal Effect span names
alone are insufficient because the same operation function may execute many
times for different tasks and operations.

Do not overload a span name with task IDs. Dynamic facts belong in span
attributes or the conformance observation.

### 5. Keep trace visualization downstream of MBT

**Fact:** Dalph already drives implementation controls from Quint actions and
compares exact model and implementation projections after each step
([MBT driver](../packages/orchestrator/test/frontier-recovery/frontier-recovery-reconstruction.mbt.test.ts#L523-L560)).
Quint can emit ITF traces with `mbt::actionTaken` and nondeterministic picks.
The formal-model gate already runs simulations, exhaustive profiles, witnesses,
and expected counterexamples
([model gate](../scripts/check-frontier-recovery-model.mjs)).

**Dalph application hypothesis:** The viewer should display the same states and
actions that MBT already consumes. It should never select actions, compute the
expected next state, or decide whether model and implementation match.

This is the most important reusable technique: one authority pipeline, several
read-only views.

## Quint/ITF prototype feasibility

### Established facts

A fixed-seed local Quint run was executed with `--mbt` and `--out-itf`.
The resulting trace had nine states and was approximately 148 KiB. Every state
contained:

- `#meta.index`;
- `mbt::actionTaken`;
- `mbt::nondetPicks`; and
- the full model state, including `selectorProjection`.

The raw trace is too detailed for a useful first screen. Its
`selectorProjection` is already close to the accepted MBT comparison:
capacity, frontier tasks, admitted tasks, occupied tasks, reservation tasks,
transition tags, explanation tags, and operation IDs
([Dalph projection](../packages/orchestrator/test/frontier-recovery/frontier-recovery-projection.ts)).

Quint treats traces as sequences of states that can be inspected and replayed
without recomputing nondeterministic actions
([Quint trace design](https://quint-lang.org/docs/development-docs/stories/story008-repl-traces)).
Quint Connect's stated MBT behavior is to replay model steps against an
implementation and compare projected states; production trace validation is
described as future work, not a solved feature
([Quint Connect announcement](https://quint-lang.org/posts/quint_connect)).

### Smallest throwaway prototype

Time box: half a day. Location: a temporary directory or an isolated prototype
worktree, not `packages/orchestrator/src`.

Inputs:

1. one fixed-seed ITF file emitted from `frontierRecovery.qnt` with `--mbt`;
2. the existing closed action and state schemas; and
3. optionally, the implementation projections captured by the existing MBT
   driver for the same steps.

Adapter behavior:

1. Schema-decode the ITF envelope and the eight displayed
   `selectorProjection` fields.
2. Decode `mbt::actionTaken` through the existing closed action map.
3. Produce one display frame per ITF state:

   ```text
   step, action, picked task
   coordinator running/crashed
   capacity
   frontier → admitted
   occupied + reserved
   exact wait/explanation tags
   model/implementation match (when supplied)
   ```

4. Convert the frames to a `MachineJSON` path solely for
   `renderStatechartMermaid` or `renderStatechartSVG`.
5. Also render a simple step table. If the statechart is harder to understand
   than the table, reject the statechart approach.

Expected picture:

```text
S0 ──commitFirstIntent(task 0)──> S1 ──requestApplies(task 0)──> S2

S1
capacity: 2
frontier:  [task 0 CheckTaskClaim, task 2 CommitFreshTaskClaimIntent]
admitted:  [task 0, task 2]
occupied:  []
reserved:  [task 0, task 2]
```

The state names should be `S0`, `S1`, and so on. Do not encode the full state
in a state name; put the projection in the selected-frame panel. This avoids
creating a false reusable state graph from one sampled path.

Prototype acceptance:

- every displayed value round-trips to one exact decoded ITF field;
- an unknown action, malformed identity, or lossy integer fails closed;
- the same trace always renders byte-identical normalized data;
- model/implementation disagreement is visible at the first divergent field;
- the raw ITF state remains inspectable;
- the UI calls the artifact a sampled trace, witness, or counterexample—not
  “the state machine”;
- no production source, domain type, or workflow depends on
  `effect-analyzer`; and
- an engineer unfamiliar with the model can explain one restart or capacity
  decision from the view.

This prototype does not need XState at runtime. `effect-analyzer` can emit
Mermaid, SVG, or XState configuration from the same MachineJSON
([renderer exports](https://github.com/jagreehal/effect-analyzer/blob/effect-analyzer%402.1.0/packages/effect-analyzer/src/analysis-entry.ts#L48-L53)).

## How Effect Analyzer could analyze Dalph itself

### Safe first use

Run pinned, read-only reports on a small reviewed allowlist:

- `workflow-recovery.ts`;
- `task-admission-controller.ts`;
- one journaled ambiguity-crossing workflow;
- one Layer composition root; and
- the two conformance control adapters.

Store the command, analyzer version, exit status, fidelity report, and generated
diagram as review artifacts. Do not colocate generated Markdown with source
and do not gate CI.

The first questions should be:

- Did the analyzer resolve the important operations?
- Does it show typed errors and service boundaries accurately?
- Does the diagram expose architecture that code review missed?
- Are findings stable across an unchanged tree?
- Does semantic diff distinguish meaningful Effect-structure changes from
  harmless refactors?

### Possible later uses

- A nonblocking pull-request artifact for selected high-level workflows.
- A reviewed baseline for unresolved and duplicate-span findings.
- A service/layer dependency view to complement, not replace, Dalph's package
  boundary and circular-dependency gates.
- Runtime overlay for deliberately instrumented end-to-end scenarios.
- A semantic-diff report when an Effect workflow changes substantially.

### Uses not justified by this research

- Automated source rewriting.
- Analyzer lint profiles as Dalph coding standards.
- Generated test stubs.
- A whole-project fidelity or coverage gate.
- Treating analyzer complexity scores as acceptance criteria.
- Translating static Effect IR into Quint.
- Treating a rendered XState configuration as executable Dalph semantics.

## Risks and limits

1. **Static shape is not behavior.** `Deferred`, interruption masks,
   semaphore handoff, schedules, external authority rereads, and crash recovery
   require runtime/model evidence beyond an AST graph.
2. **Recognizer conventions are partial.** Dalph's valid single-level
   `Match.tags` reducers do not form recognized state machines.
3. **Structural coverage is weaker than model checking.** Reachability in a
   flattened transition graph does not prove Dalph invariants, fairness,
   bounded capacity, or eventual progress.
4. **MachineJSON is lossy for some statechart semantics.** Effect Analyzer
   documents flattened coverage, no event bubbling, and no history restoration
   semantics. Actions and invokes remain labels.
5. **Sampled ITF is not the reachable state space.** Building a graph from a
   few traces would omit legal states and could merge materially different
   states.
6. **Projection design can lie.** Hiding a field that changes the next legal
   action can make two different states look equal.
7. **Span paths are not domain correlation.** They locate code, not one task
   operation or journaled obligation.
8. **Version churn is real.** Published 2.1.0 and `main` already pin different
   Effect v4 betas. Exact dependency and artifact versioning are necessary.
9. **Project-scale cost is unknown.** The whole-directory trial ended without
   a diagnostic in this environment.
10. **Generated diagrams can become false authority.** Every artifact needs
    source revision, model revision, projection version, seed/trace kind, and a
    fidelity notice.

## Exact evidence needed before adoption

### Decision A: Quint trace visualization

Required result:

1. one reviewed prototype satisfying every acceptance item above;
2. one normal sampled trace, one restart trace, and one counterexample trace;
3. a proof-by-test that its normalized frames equal the existing MBT
   comparable projection for every step;
4. a deliberate field-removal test showing that the adapter detects a lossy
   projection;
5. user confirmation that the frame-by-frame view explains the decision more
   clearly than raw Quint output; and
6. a maintenance decision naming who owns the projection version when the
   Quint or conformance schema changes.

If those results pass, adopt only the adapter and renderer as test/research
tooling. Keep the formal model and MBT comparison authoritative.

### Decision B: Dalph source analysis

Required result:

1. reproduce or diagnose the incomplete whole-directory audit;
2. record wall time and peak memory for the reviewed allowlist and full source
   tree;
3. establish a checked-in or attached baseline that classifies every inexact
   finding as tool limitation, instrumentation defect, or code defect;
4. demonstrate one real review finding not already caught by TypeScript,
   ESLint, complexity, circularity, duplication, tests, or Quint;
5. verify deterministic output across two identical runs;
6. verify a pinned upgrade procedure against Dalph's Effect version; and
7. decide separately whether reports are local-only, review artifacts, or a
   nonblocking CI lane.

Only after those results should Dalph consider a required gate. A gate should
begin with a narrow allowlist and an exact committed analyzer version.

## Handoff result contract

A follow-up research/prototype handoff is complete only when it returns:

- the exact pinned versions and commands;
- the ITF fixture provenance: model revision, init, step, seed, trace kind;
- the decoded normalized frame schema;
- generated table plus one visual format;
- frame-to-ITF and frame-to-MBT equality tests;
- explicit lossy/unknown-input failures;
- performance observations;
- a list of analyzer findings classified against Dalph source; and
- a recommendation for **Decision A** and **Decision B** independently.

The current conversation can continue without the source-analysis result if it
only needs to decide how issue 131 traces should be explained visually. It
needs the Quint prototype result before choosing a durable visualization
format, and it needs every Decision B result before adding
`effect-analyzer` to Dalph dependencies or CI.
