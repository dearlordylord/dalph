# Proposed source-code module structure

Status: Implemented and verified in compiling structural slices

Implementation base: successive local `master` integration through
`3df566f3a31117b3470435f88d49e9458d0ddeef`

This proposal changes no Dalph runtime behavior. It reorganizes production
source and tests so that the filesystem reflects the behavior and authority
model already accepted in `docs/CONTEXT.md`, `docs/ARCHITECTURE.md`, and the
architecture decision records.

## Concrete behavior that the structure must reveal

A maintainer following one Dalph action should be able to find its complete
protocol without searching one flat directory. For example:

1. Dalph records that it intends to read one task-tracker graph.
2. Dalph asks the configured task tracker for the requested graph facts.
3. Dalph receives normalized facts or a typed failure.
4. Dalph records the observed result.
5. After process loss, Dalph reconstructs whether the read must be repeated or
   whether its durable result can be consumed.

The same locality is required for task-claim acquisition, task-attempt
planning, Git worktree reconciliation, and planned-attempt executor work.

At the same time, a maintainer changing the GitHub task-tracker adapter should
find GitHub query, identity, schema, pagination, graph-read, and claim-mutation
code together without encountering Git, SQLite, executor, or run-admission
implementation.

These are two independent axes:

| Operational protocol | Task tracker | Git | Executor | Workflow journal |
| --- | --- | --- | --- | --- |
| Task-tracker facts observation | read normalized fact families under one declared read policy | — | — | record intent, full facts or unchanged reconfirmation, and observation evidence |
| Task-claim acquisition | read or create the exact claim | — | — | record intent and outcome |
| Claimed-task eligibility observation | reread the exact claim and current task facts | — | — | record the positive or exhaustive negative result |
| Task-attempt planning | consume exact claimed-task eligibility evidence | bind the planned Base SHA and locators | bind the executor locator | record the immutable plan |
| Worktree reconciliation | — | observe or create the exact worktree | — | record intent and outcome |
| Planned-attempt executor work | — | preserve the planned worktree correlation | receive Dalph's start, continuation, or suspension request and return a normalized report | record responsibility and reports |
| Control-direction application | prove the run or task subject still exists | — | later ask for safe suspension or continuation | record the applied Operator direction, not command receipt |

A directory tree can encode only one axis as its primary hierarchy. This
proposal therefore uses the following placement rule:

- An **operational protocol module** owns chronological Dalph behavior:
  operations, durable event meaning, ordering, retry and recovery decisions,
  and scenario tests.
- An **authority module** owns facts and effects at one authority seam:
  normalized authority values, the injected interface, typed failures, and
  concrete adapters.
- A protocol depends on authority interfaces. An authority adapter never
  depends on run coordination or on a protocol implementation.
- Dependency-neutral workflow contracts such as `RunId`, `AttemptId`, and
  `PlannedTaskAttempt` sit below both axes. Their behavioral creation and use
  still belong to the relevant protocols.
- Protocol-specific event leaves remain with their originating protocol.
  Genuinely multi-protocol task-tracker observation and graph-knowledge
  phenomena have a capability owner instead of being forced into one protocol.
- Dalph's workflow journal is an internal authority for recorded workflow
  history, not an external authority adapter. Its storage and codec modules
  must not become the owner of every domain event merely because they persist
  them.

This gives external authority a first-class structural axis without organizing
the entire application as adapters or technical layers.

## Live issue map

GitHub issues are part of the design evidence, not a second source-code
taxonomy. Closed issues below identify accepted behavior already represented
in the repository. Open issues identify active or deferred work whose target
shape this reorganization must leave clear without pretending it is already
implemented.

| Area | Accepted baseline | Active or deferred owner |
| --- | --- | --- |
| Overall graph-native orchestrator | [#24 Specification: Dalph graph-native task orchestration](https://github.com/dearlordylord/dalph/issues/24) (open umbrella); [#115 Model authority, observation, knowledge, and responsibility](https://github.com/dearlordylord/dalph/issues/115) (closed) | [#143 Delete superseded orchestration and perform final audits](https://github.com/dearlordylord/dalph/issues/143) |
| Task-tracker facts and graph | [#42 Traverse a complete GitHub task snapshot](https://github.com/dearlordylord/dalph/issues/42), [#164 Record complete tracker observations before decisions](https://github.com/dearlordylord/dalph/issues/164) (closed) | [#145 Fold tracker-mutation graph facts into reconstructed graph knowledge](https://github.com/dearlordylord/dalph/issues/145), [#71 Qualify GitHub graph, membership, and claim behavior](https://github.com/dearlordylord/dalph/issues/71) |
| Task claims and eligibility | [#43 Claim and reconcile one eligible GitHub task](https://github.com/dearlordylord/dalph/issues/43) (closed); ADR-0002 | [#113 Finish GitHub claim observation and define its timing policy](https://github.com/dearlordylord/dalph/issues/113), [#137 Reconcile missing, foreign, and unreadable claims](https://github.com/dearlordylord/dalph/issues/137) |
| Planned task attempt and Git worktree | [#44 Durably plan one exact attempt](https://github.com/dearlordylord/dalph/issues/44), [#45 Create or rediscover the exact worktree](https://github.com/dearlordylord/dalph/issues/45) (closed) | [#136 Reconcile changed task instructions, lifecycle, and membership](https://github.com/dearlordylord/dalph/issues/136), [#139 Reconcile Git lineage, worktrees, and promotion races](https://github.com/dearlordylord/dalph/issues/139) |
| Journal and reconstruction | [#39 Restart one planned workflow from SQLite](https://github.com/dearlordylord/dalph/issues/39), [#50 Recover an exact attempt after coordinator death](https://github.com/dearlordylord/dalph/issues/50), [#109 Define production journal composition and deterministic fake boundaries](https://github.com/dearlordylord/dalph/issues/109), [#130 Reconstruct one managed run through distinct reducers](https://github.com/dearlordylord/dalph/issues/130) (closed) | [#29 Recover managed execution from the durable journal](https://github.com/dearlordylord/dalph/issues/29), [#142 Close the complete conformance and recovery matrix](https://github.com/dearlordylord/dalph/issues/142), [#70 Archive terminal history losslessly](https://github.com/dearlordylord/dalph/issues/70) |
| Frontier, admission, activation, and finality | [#118 Specify bounded frontier derivation, scheduling, and capacity](https://github.com/dearlordylord/dalph/issues/118), [#151 Define exact activation ownership and admission handoff](https://github.com/dearlordylord/dalph/issues/151), [#132 Activate fresh and recovered work through one loop](https://github.com/dearlordylord/dalph/issues/132) (closed) | [#131 Derive the runnable frontier and bounded admission](https://github.com/dearlordylord/dalph/issues/131), [#54 Resize task admission non-preemptively](https://github.com/dearlordylord/dalph/issues/54), [#152 Decide explicit preemptive task-work capacity contraction](https://github.com/dearlordylord/dalph/issues/152), [#102 Terminate one globally settled live run](https://github.com/dearlordylord/dalph/issues/102) |
| Planned-attempt executor work | [#158 Expose one planned-attempt executor boundary and controlled fake](https://github.com/dearlordylord/dalph/issues/158), [#160 Make workflow-event initiation runtime-exhaustive](https://github.com/dearlordylord/dalph/issues/160), [#161 Test duplicate unfinished planned-attempt executor work through recovery](https://github.com/dearlordylord/dalph/issues/161), [#162 Define planned-attempt executor work and task-position release](https://github.com/dearlordylord/dalph/issues/162) (closed) | [#168 Reconcile the experimental review-loop executor after the fake-provider milestone](https://github.com/dearlordylord/dalph/issues/168), [#127 Research configurable per-task resolution pipelines](https://github.com/dearlordylord/dalph/issues/127) |
| Operator control | [#155 Decide durable evidence for applied pause and unpause directions](https://github.com/dearlordylord/dalph/issues/155) (closed decision) | [#166 Apply durable Pause and Unpause directions](https://github.com/dearlordylord/dalph/issues/166), [#134 Pause or unpause a whole run](https://github.com/dearlordylord/dalph/issues/134), [#135 Pause a task and its grouping descendants](https://github.com/dearlordylord/dalph/issues/135), [#156 Reject stale task pause and unpause requests visibly](https://github.com/dearlordylord/dalph/issues/156) |
| Cassettes and conformance | [#123 Define model-based and crash/pause cut-point test coverage](https://github.com/dearlordylord/dalph/issues/123) (closed); the accepted #165 scenarios and their implementation are present on local `master` | [#163 Specify production-shaped fake-provider behavior and executable cassettes](https://github.com/dearlordylord/dalph/issues/163), [#167 Complete fake-provider behavior through executable cassettes](https://github.com/dearlordylord/dalph/issues/167), [#159 Stabilize model-based coverage timing in hosted CI](https://github.com/dearlordylord/dalph/issues/159) |
| CLI and presentation | [#100 Preserve truthful causal concurrent trace order](https://github.com/dearlordylord/dalph/issues/100) (closed) | [#103 Expose GitHub tracker targets through the dry-run CLI](https://github.com/dearlordylord/dalph/issues/103), [#33 Ship the multi-actor semantic trace view](https://github.com/dearlordylord/dalph/issues/33), [#80 Ship the trace reader and task or causal cursor view](https://github.com/dearlordylord/dalph/issues/80) |

Issue state in this table was reread from GitHub on 2026-07-29 before the final
local-master integrations. This proposal therefore records repository facts
about #165 without asserting that the tracker issue itself has since been
closed. An accepted
issue or scenario wins if an older repository note still describes a
superseded design. In particular, closed #155 has decided the applied-direction
semantics even though ADR-0008 still says “Reconsidering.”

## Proposed tree

The package dependency graph is:

```text
@dalph/dalph ──> @dalph/orchestrator ──> @dalph/contracts
             └─> @dalph/executor ─────> @dalph/contracts
```

`@dalph/contracts` is the deliberately shared package. It contains only
cross-package Schema values and injected interfaces: no coordination,
interpretation, adapters, application wiring, or miscellaneous helpers.

`@dalph/orchestrator` depends on the executor contract but never imports the
concrete executor package. `@dalph/executor` satisfies that contract without
importing the orchestrator. `@dalph/dalph` is the composition root that installs
the concrete executor and authority adapters into the orchestrator and exposes
the executable.

```text
packages/
  contracts/
    src/
      workflow-identity.ts
      task-identity.ts
      git-locator.ts
      planned-attempt.ts
      executor.ts
      index.ts

  executor/
    src/
      controlled-fake.ts
      index.ts

  dalph/
    bin/
      dalph.ts
    src/
      application/
        cli.ts
        target.ts
        dry-run.ts
        production.ts
        composition.ts
      presentation/
        stdio-trace-output.ts
        workflow-trace.ts
      cassettes/
        authored.ts
        measurement.ts
        recorded-domain.ts
        recorded.ts
        index.ts
      index.ts
    test/
      scenarios/
        generic-workflow.test.ts
        production-application.test.ts
      conformance/
        planned-attempt-executor.mbt.test.ts
      cassettes/
        scenario.test.ts
        scenario.property.test.ts
```

```text
packages/orchestrator/
  src/
    coordination/
      run/
        run.ts
        startup-recovery.ts
        fresh-activation.ts
        recovery-activation.ts
      reconstruction/
        state.ts
        reduce.ts
        graph-knowledge.ts
        responsibility.ts
        history.ts
        history-result.ts
        history-transition.ts
      frontier/
        frontier.ts
        fresh-facts.ts
        recovery.ts
      admission/
        capacity.ts
        controller.ts
      activation/
        coordinator.ts
        selected-transition.ts

    workflow/
      identity.ts
      kernel/
        causal-graph.ts
        event.ts
        occurrence.ts
      registry/
        operation.ts
        event.ts
        event-descriptor.ts
        occurrence-projection.ts
      interpretation/
        interpreter.ts
      protocols/
        task-tracker-read/
          read-shape.ts
          operation.ts
          protocol.ts
          events.ts
        claimed-task-eligibility-observation/
          operation.ts
          classification.ts
          events.ts
          recovery.ts
        task-claim-acquisition/
          plan.ts
          protocol.ts
          events.ts
        task-attempt-planning/
          plan.ts
          record.ts
          journal-evidence.ts
          events.ts
        worktree-reconciliation/
          protocol.ts
          events.ts
        planned-attempt-executor-work/
          protocol.ts
          correlation.ts
          events.ts
        control-direction-application/
          request.ts
          apply.ts
          events.ts

      task-tracker-facts/
        observation.ts
        events.ts

    authorities/
      task-tracker/
        task.ts
        graph.ts
        graph-reader.ts
        read-policy.ts
        claim.ts
        claim-mutation.ts
        fixture/
          target.ts
          reader.ts
        github/
          target.ts
          graphql-client.ts
          graph-schema.ts
          task-identity.ts
          graph-reader.ts
          claim-mutation.ts
          read-limits.ts
      git/
        command.ts
        worktree.ts
        node-worktree.ts
      coordinator-ownership/
        ownership.ts
        owned-task-claim-mutation.ts
        owned-git-worktree-mutation.ts
        controlled-lock.ts
        node-lock.ts

    workflow-journal/
      identity.ts
      record.ts
      event-codec.ts
      store.ts
      recovery-model.ts
      adapters/
        memory-store.ts
        sqlite-store.ts

    control/
      command.ts
      service.ts

    presentation/
      trace-output.ts

    index.ts

  test/
    contracts/
      task-tracker-graph-reader.ts
    support/
      task-graph.ts
```

Production tests remain colocated with the module whose interface they
exercise. Only cross-module scenario, contract, conformance, and reusable test
support belong under package-level `test/`. The #165 cassette slice is
implemented under `@dalph/dalph`, with its cross-package scenario and property
tests under `packages/dalph/test/cassettes/`; #163 and #167 retain ownership of
the broader fake-provider behavior. Likewise, `control-direction-application/` is the #166
target; the behavior-neutral reorganization keeps today's control behavior
together under `control/` until that issue implements the replacement.
`claimed-task-eligibility-observation/` is ADR-0002's target placement; the
structural migration does not create its unimplemented behavior before a
behavior-owning ticket supplies the required scenarios and tests.

## Module responsibilities

### `@dalph/contracts`

This is the shared contract package that breaks the orchestrator/executor
dependency loop. It owns only the cross-package values both sides must compile
against:

- `RunId`, `TaskId`, `TaskRevision`, `AttemptId`, and `TaskExecutorLocator`;
- Git commit, branch, and worktree locator values embedded in a plan;
- the immutable `PlannedTaskAttempt`;
- planned-attempt executor correlation and normalized reports; and
- the injected planned-attempt executor interface.

It contains no workflow selection, journal behavior, executor algorithm,
provider adapter, Layer composition, or generic helper collection.

### `@dalph/executor`

This package contains concrete adapters satisfying the shared executor
interface. During the #158 milestone it contains the controlled fake only.
Generic orchestration cannot import this package. #168 owns the later
post-milestone executor reconciliation.

### `@dalph/dalph`

This is the application and composition package. It is the only package that
imports both `@dalph/orchestrator` and `@dalph/executor`. It owns the executable,
CLI target routing, production/dry-run Layer assembly, and concrete trace
output.

### `application`

This module lives under `@dalph/dalph`. It parses a person-visible command,
chooses a production or dry-run composition, constructs concrete authority
adapters, installs the concrete executor, and starts run coordination. High
fan-out is expected here.

It owns no task, claim, Git, executor, journal, reconstruction, or scheduling
semantics. A deletion test should leave those semantics intact and remove only
application assembly. Startup discovery, invalid-history handling, and the rule
that another unfinished run blocks the current single-run milestone belong to
orchestrator `coordination/run/startup-recovery.ts`, not
`packages/dalph/src/application/production.ts`.

### `coordination`

This module derives what Dalph may do next and arranges bounded concurrent
execution.

- `reconstruction` composes the distinct pure reducers required by ADR-0004
  and validates their cross-state invariants. Tracker observation evidence,
  and per-protocol responsibility entries remain declared by their semantic
  owners; reconstruction owns their composed state, unions, cross-state
  invariants, and final aggregate. During the behavior-neutral move, today's
  receipt-derived pause state remains in reconstruction and the already
  projected `AppliedControlDirection` contract remains in the occurrence
  registry. #166 later moves the accepted applied-direction state to its
  protocol under its own scenarios.
- `frontier` derives every allowed transition and the concrete reason for each
  wait or isolation.
- `admission` applies task-work capacity after frontier derivation, as required
  by ADR-0009.
- `activation` owns exact process-local transition ownership and the
  interruption-masked reservation-to-runner handoff.
- `run` owns the outer fresh and recovered coordination loops.

Coordination consumes reconstructed workflow facts and authority interfaces.
It does not own authority facts, persist derived frontier or admission state,
or select concrete adapters.

### `workflow` kernel, registries, and interpretation

`identity.ts`, `planned-attempt.ts`, and `kernel/` are dependency-neutral
semantic leaves used by protocols, authority interfaces, and coordination.
They own `RunId`, `OperationId`, `AttemptId`, the immutable
`PlannedTaskAttempt`, causal-graph primitives, journal-event versioning, and
the actor/classification contracts shared by concrete workflow occurrences.
Planning behavior and concrete event unions do not move into these leaves.

Each protocol owns dependency-light `operation` and `events` leaves plus its
behavioral implementation. The closed operation, workflow-event, descriptor,
and occurrence-projection registries compose those leaves above the protocols.
An outcome registry is earned only when several protocols need one; the
current tracker-only outcome stays with tracker-facts observation. The injected
interpreter interface consumes the closed registries and is implemented by
application compositions.

This arrangement avoids two cycles:

- authority interfaces may consume `PlannedTaskAttempt` without importing its
  planning protocol;
- the workflow journal and closed registries may compose protocol event leaves
  without importing protocol implementations that use the journal.

`kernel/occurrence.ts` declares `WorkflowActor`,
`InitiatedAction | NonActionOccurrence`, and their field contracts without
importing a concrete event. Protocol event leaves import that kernel.
`registry/occurrence-projection.ts` then composes every concrete event
exhaustively and owns causal validation shared by generic consumers.
Presentation imports this production classification rather than maintaining an
event-name map.

### `workflow/protocols/*`

Each subdirectory is one chronological protocol that crosses one or more
authority seams.

The module owns:

- the exact workflow operation and its causal predecessors;
- the durable intent and outcome events established by the accepted behavior;
- protocol-specific record-key derivation, normally colocated with `events.ts`
  instead of isolated in a shallow one-function module;
- interpretation ordering and typed contradictions;
- retry or reconcile-before-retry decisions;
- recovery of an unresolved responsibility;
- focused examples, properties, and chronological scenario tests.

The module does not own raw GitHub, Git, SQLite, or executor implementation.

`task-tracker-read` implements the policy-indexed logical reads required by
ADR-0003 and #164. The calling protocol selects and passes one usage-earned
read shape and bounded policy declared at the task-tracker seam. The interface
associates that policy with its request, result, and failure types; an adapter
executes page and assembly schedules without reading the journal.

`claimed-task-eligibility-observation` is the distinct ADR-0002 protocol between
claim acquisition and attempt planning. It rereads the exact claim and current
task graph, records one positive or exhaustive negative result, and never lets
a generic graph observation alone authorize planning.

`workflow/task-tracker-facts` owns the normalized observation and canonical
`TaskTrackerFactsObserved` event family. It declares coverage, completeness,
consistency, freshness, content identity, and either full facts or an unchanged
reconfirmation. The family may be established through an explicit read and,
only when #145's production mutation actually returns normalized
non-completion graph facts with equivalent evidence, through that mutation
result. Claim-only mutation results must not manufacture graph knowledge.
`coordination/reconstruction/graph-knowledge.ts` consumes this capability-owned
contract.

### `authorities/task-tracker`

This module owns normalized tasks, graph structure, task-claim facts, and the
graph-read and claim-mutation interfaces.

`fixture` and `github` are adapters and own their target codecs. GitHub-specific
targets, node identifiers, GraphQL shapes, pagination limits, and
repository-label mechanics do not escape the GitHub adapter. The application
target registry performs the closed CLI routing required by #103, or an
adapter is constructed already bound to its decoded target; the provider-
neutral reader interface does not own a `Fixture | GitHub` target union.

Graph projection belongs here because it translates normalized tracker-owned
facts into a checked task graph. Dependency/lifecycle eligibility policy moves
to claimed-task eligibility or frontier coordination; it is not tracker-owned
graph structure. Runnable-frontier selection likewise remains a Dalph
coordination decision.

### `authorities/git`

This module owns the Git command and exact planned-worktree seams, normalized
Git observations, and typed Git failures. The Node implementation is its
production adapter.

The chronological “record intent, ask Git, observe result, record outcome”
behavior belongs to `workflow/protocols/worktree-reconciliation`.

### Planned-attempt executor seam

`@dalph/contracts/executor` owns the planned-attempt executor interface and its
normalized `Running`, `SafelySuspended`, and terminal reports.
`@dalph/executor` contains the controlled fake adapter satisfying that
interface.

The fact that Dalph assumed executor-work responsibility, the required earlier
event, and journal/recovery behavior belong to
`workflow/protocols/planned-attempt-executor-work`.

For the #158 milestone, the controlled fake and Dalph share one process
lifetime and generic source contains no review, evidence, handback, retry, or
restoration stages. The proposal does not pre-create a review-loop executor
tree. #168 owns reconciling that experimental implementation after the
fake-provider milestone, while #127 owns any later configurable per-attempt
executor protocols and #75 owns later executor session/process qualification.
Restart recreates the controlled fake and never searches for surviving fake
executor work.

The report correlation value and key belong beside the executor report
contract in `@dalph/contracts/executor`. The operational protocol
owns validation that a requested plan and returned report name the same pair.

### `workflow-journal`

This module owns physical journal records, encoded-event decoding, storage
errors, the store interface, and memory and SQLite adapters. It is Dalph's
internal authority for recorded workflow history.

The closed workflow-event and descriptor registries live above protocol event
leaves under `workflow/registry`. `workflow-journal/store.ts` consumes that
closed event contract but does not own the meaning of its variants. A protocol
implementation may depend on the store while its dependency-light `events.ts`
leaf may be imported by the registry; that file-level direction must remain
acyclic. `workflow-journal/identity.ts` owns record keys and positions without
importing the typed event registry; `record.ts` may compose those identities
with the closed event value. This separates three concerns currently combined in
`journal-store.ts`: event declaration, physical storage, and the memory
adapter.

### `authorities/coordinator-ownership`

This module proves that one Dalph coordinator may send state-changing requests
for a canonical Git common directory. It is separate from Git worktree
management: the lock protects all relevant authority changes, not just Git
commands.

The controlled and Node implementations are adapters at the same seam.
`OwnedTaskClaimMutation` and `OwnedGitWorktreeMutation` are distinct guarded
interfaces consumed by state-changing protocols. Their adapters decorate the
raw tracker and Git interfaces with the ownership proof and widen the typed
failure channel. Read-only protocols consume the raw interfaces. Dry-run
receives no guarded mutation interface; deterministic tests install controlled
guarded adapters. This delivery invariant must not be left in the application
composition root.

### `workflow/protocols/control-direction-application`

Closed issue #155 decided that receipt is not journaled and V1 has one
singleton `Operator`, with no authenticated identity or command-redelivery
identity. Open issue #166 owns replacing receipt journaling with applying Pause
or Unpause to one exact run or task and recording that past-tense initiated
action. #156 separately owns the fresh logical-tracker read and visible
rejection for a stale `(RunId, TaskId)`.
`ControlCommandId`, `AuthenticatedOperatorIdentity`, and receipt events are
transitional code to delete, not target architecture. Later safe suspension,
fresh reads, resumed work, and pause phase remain distinct occurrences under
#134 and #135.

The main tree keeps today's `control/{command,service}.ts` together during a
behavior-neutral move. The `control-direction-application` protocol is the
issue-owned target created by #166, not part of the structural migration.

### `presentation`

The orchestrator owns the injected trace-output interface used while
coordinating work. `@dalph/dalph` owns the concrete stdio adapter and maps
production projections to person-visible output. Presentation consumes
workflow occurrence and trace values but does not independently classify event
names, actors, or authority.

### `cassettes`

Issues #163, #165, and #167 own the domain-readable cassette seam.
Authored cassettes drive the production coordination loop through fake
authority interfaces; they never inject reducer state or journal events.
Recorded cassettes are projected from journaled occurrence meanings and folded
as history; they never run as an outside-world script. This is a first-class
executable scenario module under `@dalph/dalph`, where it can compose the
orchestrator and concrete fake executor without reversing either dependency.
It is not presentation and not disposable test support. #165 now supplies the
authored runner, recorded-domain projection and renaming, byte measurement,
lyrics, prefix-by-prefix equivalence checks, and generated-cassette property.
#163 and #167 still own behavior beyond that accepted slice.

## Specific disposition of current production files

The mapping below names a move when the current module is already cohesive and
a split when it currently contains several semantic owners.

| Current file | Proposed disposition |
| --- | --- |
| `activation-coordinator.ts` | Move to `coordination/activation/coordinator.ts`. |
| `packages/dalph/src/cassettes/authored.ts` | Keep the authored Schema, production-loop runner, decision capture, boundary failures, and readable lyrics together at the composition root, where the controlled executor and generic orchestrator may both be installed. |
| `packages/dalph/src/cassettes/measurement.ts` | Keep maintained journal-versus-recorded-cassette encoding measurements beside the cassette schemas they measure. |
| `packages/dalph/src/cassettes/recorded-domain.ts` | Keep the domain occurrence entry union and identity-renaming Schema independent of physical journal storage fields. |
| `packages/dalph/src/cassettes/recorded.ts` | Keep journal projection, history folding, checkpoint comparison, renaming, and recorded lyrics together as the recorded-cassette protocol. |
| `packages/dalph/src/cassettes/index.ts` | Retain as the public cassette surface exported by `@dalph/dalph`; it contains no behavior. |
| `cli.ts` | Move to `packages/dalph/src/application/cli.ts`. |
| `control-command.ts` | Move behavior-neutral to `control/command.ts` with its current receipt contract intact. #166 later moves retained request decoding to `workflow/protocols/control-direction-application/request.ts`, replaces receipt events, and deletes rejected identities under its own scenarios. |
| `control-service.ts` | Move behavior-neutral to `control/service.ts`. #166 later replaces its receipt behavior with applied-direction behavior; this structural migration must not do so. |
| `coordinator-lock.ts` | Split the ownership interface and facts into `authorities/coordinator-ownership/ownership.ts`, and its test adapter into `controlled-lock.ts`. |
| `domain.ts` | Remove after distributing every value to its semantic owner; see the identity split below. |
| `dry-run-application.ts` | Move application assembly to `packages/dalph/src/application/dry-run.ts`. |
| `dry-run-simulator.ts` | Fold into `packages/dalph/src/application/dry-run.ts` unless deletion reveals independently reusable simulation behavior. |
| `fresh-task-attempt-stages.ts` | Split among the corresponding protocol modules; keep only cross-protocol activation sequencing in `coordination/run/fresh-activation.ts`. |
| `fresh-workflow-stage.ts` | Fold into `coordination/run/fresh-activation.ts`. |
| `git-command.ts` | Move to `authorities/git/command.ts`. |
| `git-worktree.ts` | Split authority facts and interface into `authorities/git/worktree.ts`; move the reconciliation protocol to `workflow/protocols/worktree-reconciliation/protocol.ts`; keep its test adapter beside `worktree.ts`. |
| `github-graphql-client.ts` | Move to `authorities/task-tracker/github/graphql-client.ts`. |
| `github-task-graph-schema.ts` | Move to `authorities/task-tracker/github/graph-schema.ts`. |
| `github-task-identity.ts` | Move to `authorities/task-tracker/github/task-identity.ts`. |
| `github-tracker-graph-reader.ts` | Move to `authorities/task-tracker/github/graph-reader.ts`. |
| `github-tracker-mutation.ts` | Move to `authorities/task-tracker/github/claim-mutation.ts`. |
| `github-tracker-read-limits.ts` | Move to `authorities/task-tracker/github/read-limits.ts`. |
| `journal-event-codec.ts` | Move to `workflow-journal/event-codec.ts`; consume the closed event registry from `workflow/registry/event.ts`. |
| `journal-event-descriptor.ts` | Split descriptor leaves beside protocol events and compose the closed descriptor registry in `workflow/registry/event-descriptor.ts`. |
| `journal-event-version.ts` | Move to dependency-leaf `workflow/kernel/event.ts`; protocol event schemas and the closed registry both depend on it. Its small interface earns its keep by preventing a registry/event-leaf cycle. |
| `journal-record-key.ts` | Split derivation beside owning protocol events; keep the branded physical key in dependency-leaf `workflow-journal/identity.ts`. Do not create one shallow key file per protocol. |
| `journal-recovery-model.ts` | Move physical journal discovery facts to `workflow-journal/recovery-model.ts`; move semantic run-history results to `coordination/reconstruction`. |
| `journal-store.ts` | Split event leaves to protocols, the closed union to `workflow/registry/event.ts`, physical records and failures to `workflow-journal/record.ts`, the interface to `store.ts`, and the memory adapter to `adapters/memory-store.ts`. |
| `journaled-workflow-interpreter.ts` | Split protocol-specific journaling into orchestrator protocol modules; retain only genuinely generic Layer composition in `packages/dalph/src/application/composition.ts`. |
| `live-task-work-start.ts` | Split coordinator-owned tracker and Git decorators into `authorities/coordinator-ownership/{owned-task-claim-mutation,owned-git-worktree-mutation}.ts`; application only installs them. Raw authority interfaces do not include ownership errors. |
| `node-coordinator-lock.ts` | Move to `authorities/coordinator-ownership/node-lock.ts`. |
| `node-git-worktree.ts` | Move to `authorities/git/node-worktree.ts`. |
| `planned-attempt-executor-journal.ts` | Move event schemas and keys to `workflow/protocols/planned-attempt-executor-work/`. |
| `planned-attempt-executor-workflow.ts` | Move to `workflow/protocols/planned-attempt-executor-work/protocol.ts`. |
| `planned-attempt-executor.ts` | Split normalized reports, correlation, and the injected interface into `packages/contracts/src/executor.ts`; move requested-versus-reported validation to the executor-work protocol and the controlled fake to `packages/executor/src/controlled-fake.ts`. |
| `planned-attempt-recovery-authority.ts` | Split authority rereads into their owning protocol recovery code; cross-protocol recovered activation stays in `coordination/run/recovery-activation.ts`. |
| `planned-task-attempt.ts` | Move the shared immutable contract and equivalence to `packages/contracts/src/planned-attempt.ts`; planning behavior remains in the orchestrator protocol. |
| `production-application.ts` | Split startup discovery, invalid-history accumulation, unfinished-other-run policy, and `StartupRecoveryBlocked` into orchestrator `coordination/run/startup-recovery.ts`; move only Layer selection and assembly to `packages/dalph/src/application/production.ts`. |
| `reconstructed-run-state.ts` | Split tracker observation evidence to `workflow/task-tracker-facts` and protocol responsibility entries to their protocols. Keep today's receipt-derived pause state plus composed states/unions/cross-state invariants in `coordination/reconstruction/state.ts` during the structural move; #166 later moves the accepted applied-direction state. |
| `reconstructed-run.ts` | Move to `coordination/reconstruction/reduce.ts`; preserve the distinct composed reducers required by ADR-0004. |
| `responsibility-fresh-facts.ts` | Move to `coordination/frontier/fresh-facts.ts`. |
| `run-recovery-activation.ts` | Move to `coordination/run/recovery-activation.ts`. |
| `run-recovery-frontier.ts` | Split journal-history extraction into `coordination/reconstruction/history.ts` and frontier input derivation into `coordination/frontier/recovery.ts`. |
| `runnable-frontier.ts` | Move transition, explanation, and current limited finality derivation to `coordination/frontier/frontier.ts`; split globally established run finality only when #102 supplies its accepted interface. |
| `runnable-transition-recovery.ts` | Move to `coordination/frontier/recovery.ts`. |
| `selected-transition.ts` | Move to `coordination/activation/selected-transition.ts`. |
| `sqlite-journal-store.ts` | Move to `workflow-journal/adapters/sqlite-store.ts`. |
| `task-admission-controller.ts` | Move to `coordination/admission/controller.ts`; move capacity schema and policy from `domain.ts` to `capacity.ts`. |
| `task-attempt-plan-journal-evidence.ts` | Move to `workflow/protocols/task-attempt-planning/journal-evidence.ts`. |
| `task-attempt-plan-recording.ts` | Move to `workflow/protocols/task-attempt-planning/record.ts`. |
| `task-claim-planning.ts` | Move to `workflow/protocols/task-claim-acquisition/plan.ts`. |
| `task-claim-protocol.ts` | Move to `workflow/protocols/task-claim-acquisition/protocol.ts`. |
| `task-dag.ts` | Split normalized graph projection, validation, and query primitives into `authorities/task-tracker/graph.ts`; move lifecycle/dependency eligibility policy to claimed-task eligibility and frontier coordination. |
| `task-revision-fingerprint.ts` | Fold into `authorities/task-tracker/task.ts` or `graph.ts`; it is part of normalized task-fact interpretation rather than a standalone module. |
| `task-tracker-facts.ts` | Split normalized fact-family and observation schemas into `workflow/task-tracker-facts/observation.ts`, the dependency-light canonical durable event into `events.ts`, and journal-aware full-versus-reconfirmation construction into the task-tracker-read protocol. Preserve the exact #164 encodings. |
| `task-tracker-knowledge.ts` | Move journal-derived graph and focused task-work-specification projection to `coordination/reconstruction/graph-knowledge.ts`; it is reconstructed selector input, not tracker authority. |
| `task-tracker-observation-match.ts` | Move the exact read-operation/observation relationship check to a dependency-light task-tracker-facts leaf consumed by history validation and occurrence projection. |
| `task-tracker-reconfirmation.ts` | Keep pure full-observation/reconfirmation matching with task-tracker facts; move journal-order indexing and whole-history reference validation to reconstruction history validation. |
| `task-tracker-target.ts` | Split task-subject coverage helpers beside task-tracker facts. Preserve canonical target equality and the exact current `FixtureTarget | GithubIssueTarget` durable encoding under `authorities/task-tracker/target.ts` during this behavior-neutral migration. |
| `task-work-planning.ts` | Move to `workflow/protocols/task-attempt-planning/plan.ts`. |
| `task-worktree-reconciliation.ts` | Fold into `workflow/protocols/worktree-reconciliation/protocol.ts`. |
| `trace-output.ts` | Split the injected interface and typed failure into orchestrator `presentation/trace-output.ts`; move the stdio adapter to `packages/dalph/src/presentation/stdio-trace-output.ts`. |
| `tracker-graph-reader.ts` | Split the provider-independent read-shape/policy interface and policy-indexed failures into `authorities/task-tracker/{graph-reader,read-policy}.ts`, and fixture target/adapter into `fixture/{target,reader}.ts`. Remove the core closed provider-target union. |
| `tracker-mutation.ts` | Split claim facts into `authorities/task-tracker/claim.ts`, the mutation interface and failures into `claim-mutation.ts`, and the controlled adapter beside that interface. |
| `tracker-workflow-trace.ts` | Split trace values into their owning operational protocols; presentation formatting stays under `presentation`. |
| `workflow-interpreters.ts` | Move Layer composition to `packages/dalph/src/application/composition.ts`; protocol implementations stay with the orchestrator protocols. |
| `workflow-journal-history-result.ts` | Move to `coordination/reconstruction/history-result.ts`. |
| `workflow-journal-history.ts` | Move to `coordination/reconstruction/history.ts`. |
| `workflow-journal-transition.ts` | Move to `coordination/reconstruction/history-transition.ts`; import the closed descriptor registry rather than protocol implementations. |
| `workflow-occurrence.ts` | Split actor/classification field contracts into dependency-leaf `workflow/kernel/occurrence.ts` and exhaustive concrete composition/projection into `workflow/registry/occurrence-projection.ts`; concrete event leaves remain protocol- or capability-owned. Keep the existing `AppliedControlDirection` contract in this registry until #166 gives it its protocol-owned replacement. |
| `workflow-operation.ts` | Move `OperationId` and causal helpers to the workflow kernel, operation leaves/constructors to protocols, and compose the closed tagged union in `workflow/registry/operation.ts`. |
| `workflow-outcome.ts` | Already deleted by #164. Its shallow tracker-read outcome was replaced by the canonical `TaskTrackerFactsObserved` event family; do not recreate an outcome registry. |
| `workflow-run.ts` | Move to `coordination/run/run.ts`. |
| `workflow-trace-output.ts` | Move to `packages/dalph/src/presentation/workflow-trace.ts`. |
| `workflow.ts` | Remove after splitting the interpreter interface into `workflow/interpretation/interpreter.ts`, closed unions into registries, protocol constructors/traces into protocol modules, and formatting into presentation. |
| `index.ts` | Inventory every workspace and emitted-package consumer, then divide exports among `@dalph/contracts`, `@dalph/orchestrator`, `@dalph/executor`, and `@dalph/dalph`. Removing an externally consumed export is not automatically behavior-neutral. |

### `domain.ts` identity split

The current file is imported by almost every production module because it
mixes identities and facts from unrelated semantic owners. The replacement is
ownership-based:

| Current value | Owning module |
| --- | --- |
| `FixtureTarget` | `authorities/task-tracker/fixture/target.ts` |
| `GithubIssueNumber`, `GithubRepositoryOwner`, `GithubRepositoryName`, `GithubIssueTarget` | `authorities/task-tracker/github/target.ts` |
| closed `TrackerTarget` routing union | Preserve its exact journal encoding in orchestrator `authorities/task-tracker/target.ts` for this migration. Moving provider routing solely into the application requires a later behavior-owning journal/operation migration. |
| `TaskId`, `TaskRevision` | `packages/contracts/src/task-identity.ts`, because they cross the executor seam in `PlannedTaskAttempt` |
| `TrackerRevision`, `TaskLifecycle`, `TrackerTask`, `Task`, `TrackerSnapshot` | orchestrator `authorities/task-tracker/task.ts` |
| `ClaimOwner`, `ClaimToken` | `authorities/task-tracker/claim.ts` |
| `GitCommitSha`, `WorktreeLocator`, `TaskBranchRef` | `packages/contracts/src/git-locator.ts`, because the orchestrator and executor share the immutable plan |
| `TaskExecutorLocator` | `packages/contracts/src/executor.ts` |
| `JournalRecordKey`, `JournalPosition`, `JournalDatabaseLocator`, `JournalSchemaVersion` | dependency-leaf `workflow-journal/identity.ts`; the typed physical record stays in `record.ts` |
| `JournalEventVersion`, `JournalEventKind` | dependency-leaf `workflow/kernel/event.ts` |
| `GitCommonDirectoryTarget`, `GitCommonDirectoryLocator` | `authorities/coordinator-ownership/ownership.ts` |
| `RunId` | `packages/contracts/src/workflow-identity.ts` |
| `OperationId` | orchestrator `workflow/identity.ts`; it does not cross the executor seam |
| `SelectedTransitionFingerprint`, `SelectedTransitionIdentity` | `coordination/activation/selected-transition.ts` |
| `AttemptId`, `PlannedTaskAttempt` | `packages/contracts/src/planned-attempt.ts`; the orchestrator planning protocol owns creation and recording |
| `TaskWorkCapacity`, its default, and its maximum | `coordination/admission/capacity.ts` |
| `ControlCommandId`, `AuthenticatedOperatorIdentity` | transitional `control/command.ts` during the structural move; #155 rejected them as V1 workflow requirements and #166 owns their removal |

No replacement `shared/domain.ts` or `types.ts` barrel is proposed. A type used
widely is not necessarily ownerless; callers should import it from the module
that defines its meaning. The dependency-neutral workflow leaves are not
generic shared buckets: each contains one canonical cross-axis phenomenon and
its invariants.

## Dependency rules

The intended production dependency direction is:

```text
@dalph/contracts
    ↑                 ↑
@dalph/orchestrator  @dalph/executor
    ↑                 ↑
    └────── @dalph/dalph ──────┘

protocol operation/event leaves ──> workflow kernel + journal identity leaves
closed workflow registries ──> protocol operation/event leaves
workflow-journal typed record/store ──> closed event registry
protocol implementations ──> workflow-journal store + authority interfaces

authority adapters ──> their own authority interfaces/facts
guarded mutation adapters ──> raw mutation interfaces + coordinator ownership

orchestrator coordination ──> @dalph/contracts
                         └─> workflow registries + protocol contracts
             └─> authority interfaces/facts + workflow-journal records

dalph application ──> orchestrator coordination + protocol implementations
                  └─> concrete executor/authority/journal adapters + presentation
```

The critical file-level rule is that protocol `operation.ts` and `events.ts`
leaves never import their implementation or the workflow journal. This lets a
closed registry import those leaves while `protocol.ts` imports the store,
without forming `journal -> protocol implementation -> journal`.

`workflow/kernel/event.ts`, `workflow/kernel/occurrence.ts`, and
`workflow-journal/identity.ts` sit below both protocol event leaves and closed
registries. `workflow-journal/record.ts` may import the closed event registry;
the identity leaf must not.

The shared contract package composes the exact planned-attempt value and
executor interface without importing either implementation package. The
orchestrator and executor meet only at that shared interface.

Forbidden production dependencies:

- an authority adapter importing `application`, `coordination`, or another
  authority adapter;
- workflow-journal storage importing GitHub, Git, executor, frontier,
  admission, or protocol implementation;
- coordination importing a concrete GitHub, Node, SQLite, fixture, memory, or
  controlled-fake adapter;
- `@dalph/orchestrator` importing `@dalph/executor`;
- `@dalph/executor` importing `@dalph/orchestrator`;
- `@dalph/contracts` importing any of the other production packages;
- presentation classifying raw event names independently of the production
  occurrence projection;
- operational protocols importing one another's implementation merely to
  obtain shared identities;
- a provider-neutral task-tracker interface importing fixture or GitHub target
  codecs;
- raw tracker or Git interfaces importing coordinator-ownership failures;
- a root `utils`, `common`, `shared`, `models`, `views`, `controllers`,
  `services`, `ports`, or `infrastructure` directory.

The existing circular-dependency check should enforce cycles. A later
architecture check may enforce these direction rules only after the actual
imports demonstrate that the proposed seams are workable; this draft does not
assume a static path rule can design the modules for us.

## Test placement

Tests follow the interface they exercise:

- `activation-coordinator.test.ts` and its property test move beside
  `coordination/activation/coordinator.ts`.
- authority adapter tests move beside their adapter, such as
  `authorities/task-tracker/github/graph-reader.test.ts`.
- planned-attempt Schema and executor-interface contract tests move under
  `packages/contracts`; controlled-fake behavior tests move under
  `packages/executor`.
- protocol tests move beside the protocol, such as
  `workflow/protocols/task-claim-acquisition/protocol.test.ts`.
- `workflow-occurrence.test.ts` moves beside the occurrence projection.
- reconstruction unit, property, duplicate-attempt, and chronological history
  tests move under `coordination/reconstruction/`.
- `generic-workflow.test.ts` and production end-to-end scenarios move to
  `packages/dalph/test/scenarios/` because their test surface intentionally
  crosses several package and module interfaces.
- tracker graph-reader contract support moves to `test/contracts/`; each
  adapter invokes the same contract.
- planned-attempt executor model-based conformance remains under
  `packages/dalph/test/conformance/`, where the test may consume both
  implementation packages without reversing their production dependencies.
- reusable task-graph fixture builders move to `test/support/`; production
  modules never import them.

Tests should import the owning file directly while the internal organization is
settling. Module-local `index.ts` barrels should be added only where an actual
consumer benefits from a smaller stable interface; one barrel per directory
would create shallow modules and obscure dependency direction.

## Migration sequence

This should be implemented as compiling structural slices, not one repository-
wide rename followed by semantic cleanup.

### 1. Establish the package DAG and shared contracts

Create `@dalph/contracts`, `@dalph/executor`, and `@dalph/dalph` with package
manifests and explicit exports. Move the cross-package identity, planned-
attempt, and executor schemas first; qualify the contract package without
moving behavior. Add a package check that rejects either implementation package
importing the other and rejects contracts importing an implementation.

Move the controlled fake into `@dalph/executor`. Move CLI, application
composition, and concrete trace output into `@dalph/dalph`. The application
continues to wire the same Effect Layers and is the only package that imports
both implementations.

### 2. Distribute remaining domain values and authority adapters

Move remaining orchestrator-only branded identities and normalized facts to
their semantic owners. Move cohesive GitHub, Node Git, SQLite, controlled,
memory, and fixture adapters beside their seams. Update imports one owning
module at a time. A temporary compatibility re-export may keep a slice
compiling, but it must be deleted when that slice lands; it is not the new
architecture.

Preserve every brand, Schema encoding, exported value, Effect service tag, and
planned-attempt round trip from #44. This slice also preserves #40, #42, and
#45 scenarios and their lock, GitHub graph, and Git worktree contract tests.

### 3. Separate journal storage from event meaning

Split `journal-store.ts`, `journal-record-key.ts`, and
`journal-event-descriptor.ts`. Establish the closed event registry from
dependency-light protocol event schemas without importing protocol
implementations. Preserve journal event kinds, versions, record keys, encoded
bytes, SQLite schema behavior, store Layer tags, and reopened-history behavior
from #39, #109, #130, and #160.

### 4. Form operational protocol modules

Move claim acquisition, attempt planning, worktree reconciliation, current
tracker observation, and executor-work code into their protocol directories.
Split `workflow.ts`, `workflow-operation.ts`, `workflow-outcome.ts`,
fresh-stage files, and journaled interpretation by semantic owner.

This structural slice preserves the implemented #43, #44, #45, #164, #160,
and #162 behavior. It moves #164's complete graph facts, compact unchanged
reconfirmation, focused task-work facts, exact initiating-read relationship,
and journal-first replay without changing their schemas or ordering. It creates
no #166 control behavior merely to fill the target tree. That open issue creates
its module only through its accepted scenarios and tests. The structural move
also does not create ADR-0002's unimplemented claimed-task eligibility module.
A later behavior-owning ticket must establish its positive,
exhaustive-negative, and crash/recovery tests before implementation; no later
code may treat a generic graph observation as planning evidence.

### 5. Form reconstruction, frontier, admission, and activation modules

Move the pure reducer composition without merging its component states. Then
move frontier derivation, bounded task admission, and activation ownership as
three distinct modules. Split current mixed reconstructed state by semantic
owner. Preserve #130, #131, #151, #132, ADR-0004, and ADR-0009.

### 6. Narrow composition and public exports

Leave only high fan-out wiring in `application`; startup recovery policy and
ownership guards must already have moved to their behavioral owners. Inventory
the executable, workspace, emitted declarations, and any package consumers
before narrowing the root barrel. Remove only exports proven internal or
explicitly superseded by #143, plus temporary compatibility exports and empty
files.

The #165 cassette module arrived as a separate behavior-owning delivery slice
on local `master` and was integrated at the composition-root placement selected
above. #163 and #167 remain the broader behavior owners.

## Verification and scenario-to-test mapping

The proposed reorganization is implementation-structural only:

- it adds or changes no user command;
- it changes no workflow decision, authority request, journal fact, retry,
  recovery rule, concurrency rule, cleanup action, or visible result;
- it therefore requires no new operational scenario.

Every migration slice must preserve the accepted chronological scenarios by
moving, not weakening, their existing tests:

| Accepted scenario or issue | Concrete result preserved | Existing acceptance test moved without semantic rewrite |
| --- | --- | --- |
| #40 exclusive coordinator ownership | Reject a second live owner and stop guarded mutations after ownership contradiction | `rejects a second live coordinator before mutation`; `interrupts every affected mutation after a contradictory observation`; `guards generic tracker and Git mutations with coordinator ownership` |
| #42 complete GitHub snapshot | Complete paginated closure or no schedulable graph | `projects paginated grouping and transitive prerequisite closure atomically`; `rejects an incomplete pagination response without exposing a snapshot` |
| #43 ambiguity-safe task claim | Check tracker again before repeating an uncertain acquisition | `rereads tracker authority after an ambiguously applied acquisition`; `observes an uncertain prior request before repeating it` |
| ADR-0002 claimed-task eligibility | No generic graph read authorizes planning; exact claim and graph are reread first | No current implementation test: the behavior-owning ticket must add the ADR-0002 positive, exhaustive-negative, and crash/recovery seams before implementation |
| #44 exact planned attempt | Bind every exact identity and resource locator before resource mutation | `binds every exact attempt identity and resource locator`; `roundtrips arbitrary valid planned task attempts through the persisted Schema boundary` |
| #45 exact Git worktree | Rediscover exact resources and preserve contradictions | `rediscovers an exact existing worktree without creating another`; `preserves a conflicting registration as a typed reconciliation fact` |
| #39/#109 journal storage and composition | Preserve canonical append/reopen behavior and inject production/test compositions at the same seams | `assigns canonical positions and returns ordered workflow-journal history`; `migrates the production SQLite journal and enables WAL mode`; `interprets live-claim and dry-run generic operations` |
| #50 exact-attempt recovery | Reread tracker and Git authority instead of treating journal history as current fact | `rereads the exact tracker claim and Git worktree before recovery`; `rejects a changed tracker claim and an absent planned worktree` |
| #130 composed reconstruction | Graph membership alone creates no responsibility and invalid history fails closed | `never creates responsibility from generated graph membership`; `accepts every chronological workflow-journal-history boundary prefix`; `rejects duplicate unfinished planned-attempt executor work before frontier derivation or an executor call` |
| #160 exhaustive workflow occurrence | Classify initiated actions and non-action occurrences without a presentation map | `generic occurrence consumer renders every runtime classification without event-name mapping`; `compile-time exhaustive fixtures cover every occurrence and actor variant` |
| #164 graph read cannot authorize work before append | Use only journaled complete facts; after restart a completed observation can be reused but a lost process-local result cannot | `a crash before append authorizes no work; restart after append reconstructs facts and only a later observed completion releases B` |
| #164 one logical read spans several tracker moments | Expose scheduling facts only when every requested family is complete, consistently covered, and matches the initiating read | `a potentially mixed-time complete read is schedulable only when every fact family is complete and consistent`; `rejects canonical facts whose target contradicts the initiating logical read` |
| #164 fresh read finds unchanged facts | Record later freshness compactly only when it references an earlier matching full observation in the same run | `a fresh unchanged read records later freshness compactly and restart reuses the earlier full facts`; `reconfirms unchanged generated graphs compactly while preserving reconstructable facts` |
| #164 focused instructions and completion acknowledgement | Plan only from journaled exact title/body facts; a completion acknowledgement alone does not release dependants | `replays a focused read from its canonical journal observation without calling the provider again`; `records exact normalized title and body only through the focused attempt read`; `classifies every generated pre-attempt fact-to-next-intent crash prefix` |
| #162 planned-attempt executor work | Correlate by `RunId` plus `AttemptId`; release capacity only after terminal or safe suspension | `drives one planned attempt through the generic executor boundary`; `releases capacity only after the planned attempt is safely suspended`; `replays the planned-attempt model through the executor boundary` |
| #165 authored singleton cassette | Supply tracker, claim, worktree, and executor facts through the production interfaces; compare declared decisions and visible results without injecting journal events or reducer state | `runs an authored cassette through the production loop and matches its declared decisions`; `rejects an executor entry for a different planned attempt`; `fails typed authored boundaries and declared behavior mismatches` |
| #165 recorded cassette projection | Project exactly one domain occurrence per journal record and compare history, reconstructed state, and frontier decisions after every prefix | `round-trips every journaled occurrence and preserves state and decisions after every prefix`; `renders recorded operator commands from their structured entry`; `rejects an illegal early start even when the final semantic state agrees` |
| #165 observed-history boundary | Keep authored outside facts that Dalph never observed out of the recorded cassette | `does not invent an authored outside occurrence that Dalph never observes` |
| #165 generated cassettes | Generate valid small graphs and preserve journal validity plus checkpoint equivalence while shrinking | `generated valid authored cassettes produce valid journals and checkpoint-equivalent recordings` |
| #165 encoding measurement | Report maintained encoded sizes for complete changed observations and compact unchanged reconfirmations without changing compression behavior | `reports encoded journal and cassette sizes for changed and unchanged graph observations` |
| #118/#131 frontier and admission | Preserve responsibility order and exact zero-or-one task-work positions | `gives a resumed responsibility the next released position before fresh work`; `rejects binding, cancellation, and release for positions it does not own` |
| #151/#132 activation | One owner per transition with rollback-safe admission handoff and rederivation after results | `coalesces concurrent triggers into one owner for one exact transition`; `rolls back the exact partial handoff when a controlled boundary interrupts`; `records a result, releases its exact position, and rederives the next transition` |
| [`planned-attempt-executor-boundary.md`: startup discovers work owned by another run](../docs/scenarios/planned-attempt-executor-boundary.md) | Block another unfinished run but retain completed history | `blocks startup instead of ignoring another run's unfinished responsibility`; `does not block startup for another run's completed responsibility` |

Open #166, #163, and #167 do not inherit passing acceptance from this
structural proposal. Their issue-owned scenarios must add applied-control-
direction and broader fake-provider tests respectively; directory placement is
not implementation evidence. The #165 rows above are implementation evidence
because their accepted scenarios, production cassette modules, and named tests
are all present.

The passing #131-related tests above are preservation evidence for the
structural move, not a claim that open issue #131 is complete.

After each slice, run the focused moved tests, typecheck, formatting, and the
circular-dependency check. Before implementation handoff, run
`pnpm check:all`. Run `pnpm check:quint` once after the final relevant changes
and before integration, as required by `AGENTS.md`; during development it is
needed only when a slice changes a Quint model, its executable conformance
adapter, or behavior governed by that model.

## Implementation structure delta after local master integration

The pre-implementation sweep classified the four-package DAG, behavior
neutrality, journal-first tracker authorization, exact durable encodings, and
one-way implementation-package dependencies as hard constraints. The detailed
tree is a selected target. Individual file placements are provisional where
verified code mixes owners. Directories reserved for #145, #166, #163, #167,
and unimplemented ADR-0002 behavior are open-issue placeholders rather than
permission to add behavior. #165 is no longer a placeholder: its accepted
slice lives in `packages/dalph/src/cassettes/`.

### Durable tracker target

Contradicted assumption: the draft placed the closed provider target union only
in application routing. #164 now embeds the exact `FixtureTarget |
GithubIssueTarget` value in tracker-read operations, fact-family coverage,
canonical observations, journal payloads, reconstruction keys, and replay
matching. Moving it to `@dalph/dalph` would reverse the package DAG; replacing
it with another identity would change durable encoding.

Viable placements were application-only routing, a new cross-package contract,
or orchestrator task-tracker authority. This migration selects
`authorities/task-tracker/target.ts` and preserves the exact Schema encoding.
Fixture and GitHub codecs remain beside their adapters, while the persisted
union remains orchestrator-owned until a behavior-owning issue specifies a
journal and operation migration. Focused validation: #164 fact round trips,
journal codec round trips, target/read matching, graph-reader contracts, and
reconstruction replay.

### Executor request mismatch

Contradicted assumption: the current `PlannedAttemptExecutor` interface exposes
`ControlledFakeExecutorMismatch`, so its error channel is not separable from
the fake by moving files alone. Moving that error into `@dalph/executor` would
reverse the dependency; silently renaming it would change the exported Effect
contract.

The viable placements were a new provider-neutral request failure or preserving
the existing typed mismatch in contracts. This behavior-neutral migration
preserves its class name, `_tag`, fields, and failure behavior in
`@dalph/contracts`; `@dalph/executor` constructs it and orchestrator consumes
only the shared interface. A later executor behavior ticket may replace that
provisional name with accepted semantics. Focused validation: executor contract
round trip, wrong-kind/wrong-correlation fake requests, service-tag identity,
and emitted declaration checks.

### #164, #165, and current-file count

The first implementation base contained 71 production files rather than the
67 in the research snapshot. After the structural split and the five-file
#165 cassette slice, the final four-package source set contains 97 production
TypeScript files. The five cassette files now have explicit dispositions
above, and deleted `workflow-outcome.ts` retains a historical disposition.
Completion audits therefore account for all 97 current production files and
must not recreate the deleted shallow outcome.

### Effect and emitted-package invariants

Every move preserves the exact `Context.Service` class value and tag string,
and every Layer preserves its provided service, requirements, scoped lifetime,
and typed error channel. No move redeclares a tag behind a compatibility
module. A clean build regenerates declarations before consumer checks because
the pre-implementation `dist` tree was stale. Package checks cover all four
manifests, emitted declarations, implementation-package direction, test-file
exclusion, and the built `dalph` executable.

### Compiling implementation disposition

The migration established the four-package graph and then moved every
orchestrator production module out of the flat `src/` root. Shared exact
attempt and executor contracts live in `@dalph/contracts`; the controlled fake
lives in `@dalph/executor`; executable, CLI, composition, and concrete stdio
presentation live in `@dalph/dalph`. Startup history discovery and
unfinished-other-run policy remain generic run coordination under
`coordination/run/startup-recovery.ts`.

The former mixed `domain.ts` was not retained as a renamed catch-all. Its
values were split among workflow identity, journal identity, control identity,
admission capacity, selected-transition identity, task-tracker task/claim and
target modules, GitHub target, fixture target, and coordinator ownership.
The exact Schema values and encodings were moved, not re-declared behind
compatibility exports. The in-memory journal adapter is likewise separate from
the journal interface and event registry.

Verified implementation evidence also narrowed some provisional file splits.
Closed operation and event registries remain cohesive runtime values under
`workflow/registry`; `workflow-journal/store.ts` consumes the event registry
without owning its domain meanings. Extracting still finer protocol leaves
while preserving the exact existing values would add pass-through modules
without improving the interface tested by codec and occurrence exhaustiveness
tests. Chronological protocols, reconstruction, authority adapters, and journal
storage are nevertheless in distinct owner directories. This is the selected
behavior-neutral disposition; later behavior-owning issues may deepen a
protocol when they add a second real adapter or a new event leaf.

### Review adjudication

The final domain, architecture, and migration-safety sweeps found the package
DAG, cassette placement, durable encodings, Effect tag identity, emitted
declarations, and runtime import paths sound. Two architecture suggestions
were deliberately not folded into this structural change:

- The raw Git and tracker mutation Effect error channels still include
  `CoordinatorOwnershipError` even though guarded wrappers also check
  ownership. Splitting new raw and guarded service tags would change public
  Effect service and typed-error contracts at a behavior-bearing authority
  boundary. No accepted scenario authorizes that semantic migration, so this
  proposal preserves the existing tags and channels for a focused future
  behavior ticket.
- `workflow/interpretation/interpreter.ts` remains a broad compatibility
  aggregation around one existing service tag and its public trace contract.
  Fully splitting that surface would change exports, service requirements, and
  trace/event contracts rather than merely moving files. It now lives under
  its semantic owner; a later focused refactor can split it when accepted
  scenarios define the replacement contracts.

These are recorded deferrals, not claims that the suggested end states are
undesirable. The migration's behavior-neutral constraint is the concrete
reason they are outside this implementation.

Validation for this disposition is the named scenario suite above plus clean
four-package builds, public emitted declarations, the source/import package
gate, zero runtime cycles, codec/property round trips, and the built CLI smoke
path. Vitest explicitly excludes nested workspace `node_modules` so each test
is discovered once after adding package-local workspace links.

## Recommendation

Adopt the two-axis hybrid together with the four-package dependency graph:

- `@dalph/contracts` owns only shared cross-package contracts;
- `@dalph/orchestrator` owns generic workflow coordination;
- `@dalph/executor` owns the concrete executor implementation; and
- `@dalph/dalph` owns executable composition and presentation.

This split is required to avoid an immediate orchestrator/executor dependency
cycle. It also gives chronological behavior the locality needed to understand
and test a protocol while making authority ownership and adapter replacement
visible.

Do not add a second generic `shared` package. New values enter
`@dalph/contracts` only when at least two production packages must compile
against the exact same semantic contract.
