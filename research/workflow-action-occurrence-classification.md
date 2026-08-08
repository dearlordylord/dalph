# Production workflow action and occurrence classification

Status: accepted code and issue research for implementation issue
[#160](https://github.com/dearlordylord/dalph/issues/160). This note and its
canonical-document updates change no Dalph runtime behavior.

## Concrete question

When a production reducer or presentation receives a typed value describing
something that happened, can it tell from that value whether a named actor
intentionally initiated the happening?

The required answer is yes. A coordinator crash is one production occurrence,
regardless of whether a process supervisor, test harness, or prototype caused
the process to die. Delivery mechanics do not create a second workflow
occurrence and do not belong in the production classification.

## Existing vocabulary

The canonical vocabulary already establishes the semantic distinction:

- a workflow occurrence is any concrete happening, and its later journal record
  is not the occurrence itself
  ([`docs/CONTEXT.md:659-665`](../docs/CONTEXT.md#L659-L665));
- an initiated action is a past-tense occurrence intentionally initiated by a
  typed actor, while a non-action occurrence is not itself an action
  ([`docs/CONTEXT.md:667-677`](../docs/CONTEXT.md#L667-L677)); and
- a Dalph-selected observation operation and the occurrence it later reports
  remain distinct
  ([`docs/CONTEXT.md:686-691`](../docs/CONTEXT.md#L686-L691)).

The accepted production rule is therefore one exhaustive initiation
classification:

```text
Workflow occurrence
├── InitiatedAction (initiatedBy is part of the value)
└── NonActionOccurrence
```

`Action | Occurrence` would be the wrong exclusive union because every action
is also an occurrence. `InitiatedAction | NonActionOccurrence` expresses the
exclusive distinction without claiming that an outcome had no cause.

Canonical architecture now separates commands, occurrences, workflow events,
and journal records and forbids a Lab/test-source classification
([`docs/ARCHITECTURE.md:17-61`](../docs/ARCHITECTURE.md#L17-L61)). Production
evidence provenance remains a separate concern described below.

## The production algebras are different things

The repository does not have one union that can be annotated and thereby
classify every production value.

| Algebra | Concrete role | Current classification |
| --- | --- | --- |
| `ControlCommand` | The current transitional control boundary receives Pause or Unpause. | It incorrectly carries `operatorId` and is journaled as receipt; #155 now owns removing both ([`control-command.ts:31-69`](../packages/orchestrator/src/control-command.ts#L31-L69)). |
| `WorkflowOperation` | Dalph selects a tracker, Git, task-work, executor, or recording operation. | Ten variants carry identities and predecessors but no actor/initiation discriminant ([`workflow-operation.ts:29-238`](../packages/orchestrator/src/workflow-operation.ts#L29-L238)). |
| `WorkflowJournalEvent` | The journal records Dalph intent, requests, reports, outcomes, and commands. | The union has no represented-occurrence classification ([`journal-store.ts:256-285`](../packages/orchestrator/src/journal-store.ts#L256-L285)). |
| `TraceItem` | The process emits a non-authoritative semantic trace projection. | The union repeats operations and boundary results but carries no actor/initiation discriminant ([`workflow.ts:410-446`](../packages/orchestrator/src/workflow.ts#L410-L446)). |
| `RunnableFrontierTransition` | The selector proposes a next Dalph transition. | The union has task/operation correlations only ([`runnable-frontier.ts:14-47`](../packages/orchestrator/src/runnable-frontier.ts#L14-L47)). |
| Quint `action` | A formal-model state transition, including crashes and external authority changes. | Quint's language keyword is not the production domain term “workflow action”; for example the same model declares `crash`, pause requests, provider changes, and external task completion as actions ([`frontierRecovery.qnt:2807-2903`](../specs/frontierRecovery.qnt#L2807-L2903)). |

These algebras must not be collapsed. In particular, classifying a journal
append as “Dalph-selected” does not classify the occurrence described by the
event payload. `TrackerGraphOutcomeObserved` records Dalph's observation of
tracker facts; it is distinct from both Dalph selecting the read and any person
editing the tracker.

## What can be inferred today

Only isolated cases are typed strongly enough:

- `ControlCommand` currently names a supposed authenticated operator, but that
  is transitional code contradicted by the accepted singleton `Operator` and
  applied-direction event decision in
  [#155](https://github.com/dearlordylord/dalph/issues/155)
  ([`control-service.ts:43-56`](../packages/orchestrator/src/control-service.ts#L43-L56)).
- An `OperationSelected` trace item contains a `WorkflowOperation`
  ([`tracker-workflow-trace.ts:6-9`](../packages/orchestrator/src/tracker-workflow-trace.ts#L6-L9)).
  Its name and emission call sites imply Dalph selected it, but the value does
  not declare the actor or classification. A consumer must hard-code tag or
  call-site knowledge.
- Provider reports, failures, acknowledgements, and tracker outcomes contain
  operation and observation correlation, but not a uniform initiation
  classification. For example, the session trace distinguishes request,
  acknowledgement, failure, lookup, and report shapes without an actor field
  ([`task-work-session-trace.ts:47-102`](../packages/orchestrator/src/task-work-session-trace.ts#L47-L102)).
- A tracker snapshot reports current graph facts, not the historical person or
  system that changed them. The graph outcome carries only revision and task
  identities ([`workflow-outcome.ts:6-10`](../packages/orchestrator/src/workflow-outcome.ts#L6-L10)).
  It cannot prove an actor-selected tracker edit.

Therefore actor selection cannot be inferred exhaustively today. A map from
operation/event names to presentation categories would merely duplicate
semantics outside the originating types and would drift as variants change.

## How occurrences currently reach reducers

The reconstructed-run reducers receive ordered `JournalRecord` values;
each record contains one `WorkflowJournalEvent`
([`journal-store.ts:298-303`](../packages/orchestrator/src/journal-store.ts#L298-L303)).
The graph, responsibility, history, and pause reducers fold those records
([`reconstructed-run.ts:128-205`](../packages/orchestrator/src/reconstructed-run.ts#L128-L205)).
The workflow-journal-history validator likewise switches on journal-event descriptors
and transition roles, not occurrence classification
([`workflow-journal-history.ts:84-160`](../packages/orchestrator/src/workflow-journal-history.ts#L84-L160)).

A coordinator crash does **not** enter this reducer as a journal event. The
process dies, losing process-local state. Startup reads the retained journal,
validates it, and refreshes external authorities through
`recoverExactRunAfterCoordinatorDeath`
([`workflow-recovery.ts:436-469`](../packages/orchestrator/src/workflow-recovery.ts#L436-L469)).
The current journal union has no coordinator-crash variant
([`journal-store.ts:256-285`](../packages/orchestrator/src/journal-store.ts#L256-L285)).

Consequences:

1. A crash is conceptually one `NonActionOccurrence`.
2. Its test/prototype delivery mechanism must not appear in the production
   type.
3. The journal reducer must not pretend the absence of a row proves when or why
   a crash occurred.
4. If a future production surface needs to display a crash occurrence, it
   needs truthful external process-lifecycle evidence. Startup, a missing row,
   a Quint action, or a prototype/conformance control cannot manufacture that
   occurrence from journal history.

This also exposes one design question for the implementation specification:
“every reducer input is a typed production occurrence” cannot mean that a
`WorkflowJournalEvent` becomes identical to the occurrence it records. The
specification must name whether classification belongs to a represented
occurrence carried by reducer input, or to a broader production input envelope
that keeps the journal record and represented occurrence distinct.

## Provenance

Initiation classification and evidence provenance are independent:

- `InitiatedAction` answers **whether and who intentionally initiated the
  action**. `NonActionOccurrence` does not copy that actor through causality.
- Existing operation IDs, observation IDs, authority reports, revisions,
  coverage, freshness, and journal positions answer **what evidence supports
  Dalph's recorded knowledge**.

The second is necessary for authority consistency, but it should remain in the
specific production boundary types. A generic Lab/test/fault-injection source
tag is neither needed nor correct. Simulation is already represented by
distinct non-authoritative variants, for example
`TaskExecutionSimulated` and `TaskWorkSessionEstablishmentSimulated`
([`task-execution-trace.ts:30-45`](../packages/orchestrator/src/task-execution-trace.ts#L30-L45)).

There is no second generic observer/source category. Concrete production types
retain usage-shaped origin, causal, authority, observation, freshness,
coverage, and journal-position relationships. An observation exposes an
originating action only when production evidence establishes one.

## Issue ownership

No existing implementation issue owns the originating production type
contract:

- [#24](https://github.com/dearlordylord/dalph/issues/24) is the accepted
  product specification parent. It requires one exhaustive workflow-operation
  algebra and a schema-versioned semantic trace, but it is not an
  implementation leaf.
- [#33](https://github.com/dearlordylord/dalph/issues/33) is explicitly a
  tracking parent. Its acceptance criterion that inspection answer “what
  occurred” and “who acted” makes it a consumer of this contract, not its
  implementation owner.
- [#80](https://github.com/dearlordylord/dalph/issues/80) implements the trace
  reader and cursor projections. Assigning domain classification there would
  make presentation code the semantic authority.
- Closed [#130](https://github.com/dearlordylord/dalph/issues/130) implemented
  reconstruction through distinct reducers, but did not classify represented
  occurrences and should not be reopened for this cross-algebra contract.

Focused implementation issue
[#160](https://github.com/dearlordylord/dalph/issues/160) is a native child of
[#126](https://github.com/dearlordylord/dalph/issues/126). Its accepted
chronological scenarios and scenario-to-test mappings define the work.

The native dependency graph is:

```text
#158 truthful review-loop executor source boundary
  → #160 runtime-exhaustive workflow-event initiation
    → #80 trace reader and causal cursor view
    → #142 complete conformance and recovery matrix
```

The eventual implementation ticket produced from
[#155](https://github.com/dearlordylord/dalph/issues/155) must also consume
#160 for the applied Pause or Unpause event.

## Resolved decisions

1. Classification lives in originating runtime-visible tagged/branded
   production event types, not one universal reducer-input envelope.
2. Only past-tense events are occurrences. Commands, requests, proposals,
   capabilities, constructed operations, and journal records are not.
3. The exhaustive classification is
   `InitiatedAction | NonActionOccurrence`; initiated actions carry
   `initiatedBy`.
4. Actor vocabulary is usage-earned. V1 has one singleton `Operator` and no
   authentication boundary, operator identity, role, or multi-operator
   attribution.
5. Concrete origin and evidence relationships remain separate from
   classification. No generic Lab/test/source category exists.
6. A generic consumer must classify runtime values and follow typed
   relationships without an event-name or operation-name map.
7. The representation of an originating-action reference may remain
   usage-shaped, provided it is runtime-traversable, consistency-checked, and
   never fabricated.
8. A coordinator cannot write its own death. Production has no crash journal
   event, and startup recovery neither requires nor infers one.

## Parked adjacent handoff: executor and process-boundary naming

Production currently exports `TaskExecutor` as the provider-neutral boundary
that requests and observes task-execution worker processes
([`task-execution.ts:278-293`](../packages/orchestrator/src/task-execution.ts#L278-L293)).
The repository also names the first concrete Dalph executor the
`review-loop executor`. No canonical source inspected here says that these
cannot ultimately be one executor-owned implementation or that `TaskExecutor`
must remain a separate production concept.

Do not resolve that source-ownership question as a side effect of occurrence
classification. Hand it to
[#158](https://github.com/dearlordylord/dalph/issues/158), which already owns
the truthful review-loop executor source boundary, and require that work to
decide whether `TaskExecutor` is retained, renamed, moved inside the
review-loop executor, or replaced. Until that decision, documentation and
handoffs must not describe `TaskExecutor` as inherently “not the review-loop
executor.”
