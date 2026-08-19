# Effect Workflow usability prestudy

**Research date:** 2026-08-19

**Dalph baseline:** `4e2167602b18790712589db4532b43f3ec4192e1`

**Effect baseline:** `effect@4.0.0-beta.106`, tag
[`fb75264`](https://github.com/Effect-TS/effect/tree/effect%404.0.0-beta.106)

## Status and decision boundary

This is pre-research for an evaluation, not an adoption decision. It changes no
Dalph command, workflow decision, external request, durable fact, retry,
recovery, concurrency, cleanup, or visible runtime result. Operational
scenarios are therefore not required for this document. Any executable spike
that crosses a boundary or changes behavior still needs accepted chronological
scenarios and a scenario-to-test mapping before implementation.

Issue
[#143](https://github.com/dearlordylord/dalph/issues/143)
authorized a focused `effect/unstable/workflow` prototype only after the current
single Run entry and ordinary delivery runtime were established. Its handoff
required retaining one Dalph Journal authority. On 2026-08-19 the project owner
reopened that constraint because testing whether Workflow can replace the
Journal's durable-computation role is the central purpose of the evaluation.

The governing Wayfinder,
[#232](https://github.com/dearlordylord/dalph/issues/232), therefore supersedes
#143 on this point, with the accepted correction linked back to #143. The
experiment may produce either:

- Workflow-owned durable computation with no Dalph Journal; or
- Workflow-owned durable computation plus a reduced semantic occurrence log
  whose remaining records are justified independently by accepted scenarios.

Neither outcome is an adoption decision. Both must preserve fresh reads from
the tracker, Git, and executor wherever a new decision depends on facts those
systems may have changed.

The study is not restricted to Effect Workflow. Effect Workflow is the first
prototype because Dalph already uses Effect V4 and can test it with the least
initial integration distance. If it cannot satisfy the accepted scenarios or
requires rebuilding a durable engine around it, the same harness may pivot to
another solution without changing the decision question.

## Executive finding

The path is open, but the evaluation should begin with a paired, SQL-backed
tracer bullet rather than a broad integration.

Effect Workflow offers a compact typed surface for stable workflow identity,
schema-encoded input and output, named activities, polling, interruption,
resume, durable deferreds, and clocks. Its durable engine replays a handler
from its beginning and reuses stored named results. That is potentially useful
for redelivering one Dalph Run activation after process loss.

It does not replace Dalph's difficult correctness work. A stored Activity
reply is historical evidence that an invocation returned, not current evidence
from GitHub, Git, or an executor. An Activity can still cross the classic
ambiguous window in which the outside system applied a request but the engine
did not store the reply. Dalph must still record intent, check the owning
system, and reconcile before retry.

The preliminary evaluation branches are therefore:

1. **Workflow-only durable computation**, where Workflow execution history
   replaces Run establishment, reconstruction, and continuation records;
2. **Workflow plus a reduced semantic occurrence log**, where the engine owns
   continuation and Dalph records only domain evidence an accepted scenario
   independently requires; and
3. **Workflow around the current Journal**, retained only as a diagnostic arm
   that reveals duplication and migration seams, not as a preferred outcome.

All branches retain explicit runtime resource ownership, application Exit, and
fresh authority rereads where the next decision depends on current external
facts. Whether Workflow can express those rereads naturally is a primary
research question rather than a presupposed custom protocol.

This is a hypothesis to measure, not a conclusion. The decisive evidence is
deleted lifecycle code plus preserved failure behavior, not preservation of
the Journal for its own sake and not a successful demo.

## Evidence discipline

The study uses four evidence levels:

1. **Pinned fact** — established by Dalph or Effect source at the revisions
   named above.
2. **Maintainer report** — a first-party GitHub issue with a reproduction; it
   identifies a test target but is not treated as a proven Dalph outcome.
3. **Inference** — a consequence drawn from pinned source and stated as such.
4. **Experiment result** — reserved for a reproducible harness committed by the
   prototype. There are no experiment results yet.

The superseded July comparison remains useful as historical question-setting
evidence at
[`154d8e85c`](https://github.com/dearlordylord/dalph/blob/154d8e85c339785256f657f2eabb3dccccbc4c6c/research/effect-otp-durable-workflow-comparison.md),
but none of its package claims are carried forward without checking the current
pinned source.

## What the current API actually provides

### Workflow identity and control

A Workflow has payload, success, and error schemas, a payload-derived
idempotency key, and operations to execute, poll, interrupt, resume, and
register a handler. It also exposes deterministic execution-ID derivation
([`Workflow.ts`, lines 45–149](https://github.com/Effect-TS/effect/blob/effect%404.0.0-beta.106/packages/effect/src/unstable/workflow/Workflow.ts#L45-L149)).

That is a useful correlation mechanism. It is not intrinsically a Dalph
`RunId`, `AttemptId`, tracker claim, worktree, or executor locator. The spike
must define a one-way mapping from an exact Dalph identity to a versioned
Workflow execution identity and must never use the latter as authority for the
former.

Workflow compensation is limited to top-level effects and does not apply to
nested activities
([`Workflow.ts`, lines 151–186](https://github.com/Effect-TS/effect/blob/effect%404.0.0-beta.106/packages/effect/src/unstable/workflow/Workflow.ts#L151-L186)).
It therefore cannot stand in for Dalph's exact, disposition-typed, recoverable,
fail-closed cleanup protocols.

### Handler replay and named activities

The Cluster engine constructs a fresh Workflow instance and invokes the
registered handler for a delivered `run` request
([`ClusterWorkflowEngine.ts`, lines 351–390](https://github.com/Effect-TS/effect/blob/effect%404.0.0-beta.106/packages/effect/src/unstable/cluster/ClusterWorkflowEngine.ts#L351-L390)).
Activities have stable names and encoded success/error schemas
([`Activity.ts`, lines 123–178](https://github.com/Effect-TS/effect/blob/effect%404.0.0-beta.106/packages/effect/src/unstable/workflow/Activity.ts#L123-L178)).

The important interpretation is “run the handler again and reuse stored named
results,” not “restore the JavaScript continuation.” Open files, child
processes, fibers, scopes, Codex sessions, and Git state remain process-local or
owned by their external system.

The default Activity wrapper retries interruption according to an exponential
schedule capped by ten-second spacing while the attempt predicate remains true
([`Activity.ts`, lines 181–200](https://github.com/Effect-TS/effect/blob/effect%404.0.0-beta.106/packages/effect/src/unstable/workflow/Activity.ts#L181-L200)).
That default is not safe evidence for repeating a GitHub, Git, executor-start,
promotion, or cleanup call. The spike must supply an explicit policy and keep
Dalph reconciliation inside the boundary.

### Memory and SQL engines are different evidence

`WorkflowEngine.layerMemory` explicitly keeps state only in memory and is not
suitable when durability is required
([`WorkflowEngine.ts`, lines 561–577](https://github.com/Effect-TS/effect/blob/effect%404.0.0-beta.106/packages/effect/src/unstable/workflow/WorkflowEngine.ts#L561-L577)).
It is suitable for API learning and fast tests only. No result from it counts
as restart evidence.

The production-shaped single-process layer still uses Sharding, SQL-backed
message storage, runner storage, configuration, and no-op runner communication
and health services. Message storage remains SQL-backed even when runner
storage is in memory
([`SingleRunner.ts`, lines 26–76](https://github.com/Effect-TS/effect/blob/effect%404.0.0-beta.106/packages/effect/src/unstable/cluster/SingleRunner.ts#L26-L76)).

This is materially more infrastructure than Dalph's workflow-history Journal.
It is acceptable for a spike only if its extra tables and identities are
classified as delivery/replay infrastructure, not a second source of Dalph
domain history.

SQL mailbox reads mark messages and normally make them eligible for stale
redelivery only after ten minutes
([`SqlMessageStorage.ts`, lines 352–429](https://github.com/Effect-TS/effect/blob/effect%404.0.0-beta.106/packages/effect/src/unstable/cluster/SqlMessageStorage.ts#L352-L429)).
Other reset paths may make recovery immediate, so the ten-minute clause is not
a general restart-latency claim. It is a required fault point: the harness must
measure which crash positions take the immediate reset path and which fall
back to stale redelivery.

### The surface is moving

Effect V4 remains beta, and its migration guide classifies `workflow` and
`cluster` as unstable modules that may receive breaking changes in minor
releases
([Effect V4 migration guide](https://github.com/Effect-TS/effect/blob/main/MIGRATION.md#unstable-module-system)).

The movement is not merely theoretical. A reported overlong SQL message-key
failure from v3 has a current v4 fix: beta.106 hashes composed keys longer than
255 characters while retaining a SQLite compatibility lookup
([`SqlMessageStorage.ts`, lines 96–118](https://github.com/Effect-TS/effect/blob/effect%404.0.0-beta.106/packages/effect/src/unstable/cluster/SqlMessageStorage.ts#L96-L118)).
This is evidence that the current tag must be pinned in every experiment and
that upgrade/replay compatibility needs its own lane.

## Current risk signals to reproduce, not assume

Recent first-party issue reports identify concrete experiments:

- [#6294](https://github.com/Effect-TS/effect/issues/6294) reports that second
  and later child-workflow resumes wait for the storage poll because the
  parent-resume reset does not wake the storage reader. The beta.106 source
  still resets that request without the `pollStorage` call used by ordinary
  resume
  ([source comparison](https://github.com/Effect-TS/effect/blob/effect%404.0.0-beta.106/packages/effect/src/unstable/cluster/ClusterWorkflowEngine.ts#L272-L309)).
- [#6318](https://github.com/Effect-TS/effect/issues/6318) reports a lost
  `DurableDeferred` wake-up when completion arrives before the suspended reply
  is persisted.
- [#6179](https://github.com/Effect-TS/effect/issues/6179) reports SQLite
  contention between a long-lived runner and short-lived control clients.
- [#6508](https://github.com/Effect-TS/effect/issues/6508) reports concurrent
  entity execution after a SQL runner refresh hangs in a multi-runner setup.
  Dalph's authorized first spike is single-process, so this is not a direct
  failure claim; it is evidence against inferring exact ownership from Cluster
  alone.

The evaluation should pin a disposition for each report: reproduced, not
applicable with a concrete reason, fixed in the pinned version, or unresolved.

## Industry problem and solution boundary

The problem is usually called **durable execution** or **durable workflow
orchestration**. It is acute wherever one logical process lasts longer than one
host process and crosses systems that do not share a transaction:

- payment, order-fulfilment, and customer-onboarding flows, which Temporal
  names as mission-critical examples
  ([Temporal documentation](https://docs.temporal.io/));
- infrastructure provisioning, deployment, repository automation, and CI/CD,
  where a remote create or update may succeed before the caller loses its
  response;
- human approvals and other long waits, represented by Azure Durable
  Functions' external-event mechanism
  ([Azure external events](https://learn.microsoft.com/en-us/azure/azure-functions/durable/durable-functions-external-events));
- background jobs, data pipelines, storefronts, and AI agents, which DBOS
  presents as durable-workflow use cases
  ([DBOS documentation](https://docs.dbos.dev/)); and
- distributed service workflows, where Restate places a log-first runtime
  between callers and participating handlers
  ([Restate architecture](https://docs.restate.dev/references/architecture)).

### What established systems generally provide

The common mechanism is replay from durable history. Azure states the model
directly: an orchestrator is re-executed from the beginning, and a completed
activity's recorded result is supplied instead of calling it again
([Durable Task orchestrations](https://learn.microsoft.com/en-us/azure/durable-task/common/durable-task-orchestrations)).
DBOS similarly recovers from the last completed step, while requiring workflow
determinism and idempotent steps
([DBOS architecture](https://docs.dbos.dev/architecture)). Restate replays a
handler against its invocation journal and skips actions with recorded results
([Restate request lifecycle](https://docs.restate.dev/guides/request-lifecycle)).

This gives applications durable control flow, durable waits, remembered step
results, retries, and a stable execution identity. It does not make every
outside system part of the workflow engine's transaction.

Delivery guarantees vary at the boundary. Azure documents at-least-once
delivery for external events and recommends application-provided unique IDs for
deduplication. DBOS requires steps that may be retried during recovery to be
idempotent. AWS's durable-execution guidance recommends at-most-once handling
or a provider idempotency key for non-idempotent external effects
([AWS idempotency guidance](https://docs.aws.amazon.com/durable-execution/patterns/best-practices/idempotency/)).

Restate goes further when both sides participate in Restate: it journals an
inter-handler call before dispatch and supplies end-to-end idempotency. That
property does not automatically extend to an arbitrary GitHub, Git, cloud, or
executor API outside Restate
([Restate request lifecycle](https://docs.restate.dev/guides/request-lifecycle)).

### What Effect Workflow appears to give Dalph

| Industry mechanism | Effect Workflow beta.106 | Remaining research/application concern |
| --- | --- | --- |
| Stable execution identity and duplicate-start correlation | deterministic ID from workflow name and payload key | mapping and versioning relative to exact Dalph identities |
| Replay after process loss | SQL-backed Cluster handler re-execution | actual crash latency, stuck-message behavior, and operator diagnosis |
| Remember completed nondeterministic work | named Activity results | ambiguous external success before the Activity reply is stored |
| Durable waiting and wake-up | durable deferreds, queues, and clocks | lost/delayed wake-up reports and how current facts are refreshed afterward |
| Retry support | workflow retry schedules and Activity retry machinery | retries must not repeat an unsafe request or defeat application Exit |
| Provider idempotency | deterministic Activity idempotency-key helper | the provider must accept the key with suitable semantics; Git often does not |
| External signals | durable-deferred tokens can be completed outside the handler | authentication, deduplication, ordering, and whether a signal is current authority |
| Current-state reconciliation after downtime | no domain-specific primitive found | model a new read as new work rather than replaying the old recorded result |
| Code evolution | stable names and schemas are required by replay | no accepted Dalph version-routing or migration protocol yet |
| Operator control | execute, poll, interrupt, and resume APIs | no established Dalph inspection, quarantine, repair, or retention surface |

The current `WorkflowInstance` exposes execution identity, suspension,
interruption, failure, and activity coordination, but no public “this handler
is replaying after a process restart” or external-fact freshness epoch
([`WorkflowEngine.ts`, lines 210–288](https://github.com/Effect-TS/effect/blob/effect%404.0.0-beta.106/packages/effect/src/unstable/workflow/WorkflowEngine.ts#L210-L288)).
An Activity's deterministic idempotency-key helper combines the execution ID,
name, and optionally attempt
([`Activity.ts`, lines 248–271](https://github.com/Effect-TS/effect/blob/effect%404.0.0-beta.106/packages/effect/src/unstable/workflow/Activity.ts#L248-L271)).

The provisional answer is therefore that Effect Workflow supplies much of the
same durable-computation kernel as the industry systems, but not an automatic
freshness/reconciliation policy for arbitrary external authorities. The
experiment must discover the most natural Effect Workflow idiom for this
sequence:

1. replay enough history to know what Dalph previously attempted and observed;
2. identify that the next decision depends on a fact GitHub, Git, or the
   executor could have changed;
3. perform a deliberately new read rather than reuse the old read's result;
4. compare current evidence with remembered execution history; and
5. continue, wait, conflict, or reconcile without repeating an ambiguous
   state-changing request.

That sequence may be expressible with a new versioned Activity name, a loop
iteration/observation ordinal in Activity identity, a durable external signal,
or a smaller Dalph semantic log. Choosing among them is experiment work; the
prestudy does not assume custom journaling is necessary.

### Candidate ladder if Effect Workflow fails

The alternatives solve overlapping but not identical problems:

1. **Restate** is the strongest next candidate for the ambiguous-call boundary.
   Its log-first runtime persists requests, durable steps, timers, promises,
   state updates, and participating inter-service calls; calls routed through
   Restate receive end-to-end idempotency and superseded execution epochs are
   fenced
   ([Restate architecture](https://docs.restate.dev/references/architecture)).
   The trade-off is adopting a separate runtime/server and fitting Dalph's
   external GitHub, Git, and executor boundaries into or beside its service
   fabric. Kafka is an optional event-ingress integration, not a deployment
   dependency: Restate documents its local server as one self-contained binary
   with no external dependencies
   ([Restate installation](https://docs.restate.dev/installation)). That is
   still materially heavier than an embedded library for software intended to
   run on user computers, so binary lifecycle, ports, storage, upgrades, and
   packaging must be scored explicitly.
2. **DBOS** is the closest lightweight code-first comparison. It recovers a
   deterministic workflow from checkpointed steps in Postgres, supplies stable
   workflow identities and durable queues, and explicitly requires retried
   steps to be idempotent
   ([DBOS architecture](https://docs.dbos.dev/architecture)). Its TypeScript
   fit and operational footprint merit a spike if Effect Workflow's engine is
   too incomplete, although arbitrary external freshness remains application
   logic.
3. **Temporal** is the maturity/reference benchmark. It durably replays
   workflows and provides Activities, timers, signals/updates, retries,
   versioning mechanisms, and substantial operational tooling. It remains a
   candidate only if those capabilities justify its separate service and
   deployment weight for Dalph
   ([Temporal documentation](https://docs.temporal.io/)).
4. **Azure/AWS durable execution** remain pattern evidence rather than leading
   Dalph candidates because they bind the runtime to a cloud platform. Their
   documented at-least-once, idempotency, external-event, and versioning rules
   still supply useful negative controls.

The prototype should not implement all candidates. It should preserve one
solution-neutral scenario suite and move down this ladder only after recording
why the preceding candidate failed or imposed unacceptable cost.

There is no hard deployment ceiling. Dalph should prefer the lightest solution
that satisfies the study, especially because it runs on user computers, and
must record installation, processes, ports, storage, upgrades, resource use,
and operator work for every candidate. Heavier infrastructure, including
Kafka, remains admissible when its measured benefit justifies that burden; the
study scores the trade-off instead of excluding it in advance.

## Proposed methodology

### 1. Ask one decision question

> With one exact Run and one coordinator process, can SQL-backed Effect
> Workflow replace all or most Journal-owned durable computation while
> preserving the accepted chronology, fresh external reads, and application
> Exit behavior—and what semantic history, if any, must remain outside it?

Do not broaden the first round to distributed runners, adoption, or a new user
command. Journal replacement and the minimum independently necessary semantic
history are the experiment's core questions.

### 2. Compare two implementations of the same chronology

Use a paired harness:

| Arm | Entry and durability | Purpose |
| --- | --- | --- |
| Baseline | current `runWorkflow`, Journal, and controlled boundaries | Establish the existing behavior and cost |
| Workflow-only candidate | versioned Workflow execution with SQL `SingleRunner`; no Dalph Journal | Test full durable-computation substitution |
| Reduced-log candidate | same Workflow execution plus only scenario-justified semantic events | Test the smallest fallback when Workflow history cannot serve a required Dalph meaning |
| Current-Journal diagnostic | Workflow around the existing entry | Expose duplicated identities and two-store crash seams; not a preferred outcome |

All arms receive the same initial policy, exact `RunId`, tracker target,
controlled tracker/Git/executor outcomes, and semantic trace collector. The
candidate may not fork the workflow algebra or substitute Workflow results for
current facts owned by an outside system. The Workflow-only arm may derive the
semantic trace from Workflow execution history if it can preserve the accepted
meaning.

### 3. Stage the spike

**Stage A — API and topology probe.** Register one versioned Workflow, execute
it by exact Run identity, inspect SQL rows, stop the process, restart it, and
record setup code, Layer graph, required configuration, startup latency, table
shape, and operator-visible diagnostics. Use both memory and SQL engines, but
label memory results non-durable.

**Stage B — responsibility inventory.** For every current Journal record and
consumer, state the concrete restart decision or semantic query it supports.
Map each responsibility to Workflow execution history, an explicit fresh read,
a reduced semantic event, or deletion. “Keep it because it exists” is not an
allowed mapping.

**Stage C — Workflow-only tracer bullet.** Re-express one exact Run chronology
without the Dalph Journal. Exercise initial execution, process death, replay,
an outside fact changed during downtime, and an ambiguous state-changing
request. Derive the canonical semantic trace from the candidate's actual
evidence rather than manufacturing Journal-shaped compatibility records.

**Stage D — reduced-log fallback.** For each Stage C failure, test whether one
minimal, domain-named semantic event solves a scenario that Workflow history
cannot. Do not restore the general Journal or a second durable-computation
driver.

**Stage E — current-Journal diagnostic.** Only if needed to isolate an engine
behavior, run Workflow around the existing entry or protocol and exercise both
store orderings. Treat this as migration/fault evidence, not a candidate
architecture.

**Stage F — upgrade and operability probe.** Restart an execution created by
the pinned version under one deliberately changed workflow/activity version.
Verify fail-closed version routing, database backup/restore, malformed-row
diagnostics, retention, and the impossibility of selecting `layerMemory` in a
production composition.

Do not proceed from a stage merely because its happy path works. Each stage
must meet its own negative controls.

Begin with one real Dalph ambiguity to keep the harness and evidence legible.
This is an organizing center rather than a fixed scope limit: add adjacent
tracker, Git, executor, wait, or restart cases when they reuse the same harness
cheaply and materially improve the comparison. Defer cases that require a new
boundary model or obscure the first candidate's result.

### 4. Drive chronological cut points

Before implementation, write and accept scenarios with at least these process
cut points:

| Concrete event | Expected evidence after restart | Forbidden result |
| --- | --- | --- |
| first execution request is stored | one exact Run execution begins | second Run identity or duplicate beginning |
| durable intent/step acknowledged; outside request not sent | candidate determines whether a fresh read or first send is allowed | blind duplicate request |
| outside system applies request; response is lost | candidate rereads the owning system before another request | stored Workflow request treated as proof of absence |
| outside observation is durably known; step reply is absent | replay reuses sufficient durable evidence and makes no unsafe second call | duplicate boundary call or invented result |
| Workflow reply stored; current outside facts later change | activation performs the accepted fresh read | cached reply treated as current authority |
| application Exit closes admission during handler/activity work | the accepted five-second drain and ordinary durable boundary remain controlling | Workflow retry starts new forward progress during Exit |
| process dies while a message is marked read | restart latency and reset/stale-redelivery path are measured | silent hang reported as safe suspension |
| old execution is opened by changed code | explicit version routing accepts or fails closed | silent semantic replay under changed names/control flow |

### 5. Scenario-to-test map for the proposed spike

These are proposed test seams, not yet accepted implementation scenarios:

| Scenario outcome | Proposed acceptance test |
| --- | --- |
| one exact Run is established across replay | `replays the stored Run request and establishes one exact execution` |
| lost outside response is reconciled | `checks the owning boundary after the Activity loses its response and does not repeat the request` |
| durable observation survives an absent step reply | `replays after recording outside evidence and makes no unsafe second provider call` |
| Workflow cache is not current authority | `reads current tracker facts after replaying a stored historical result` |
| canonical trace is unchanged | `projects the same semantic trace from baseline and Workflow-backed executions at every cut point` |
| application Exit remains controlling | `admits no successor Workflow progress after the Exit cutoff` |
| SQL recovery is bounded and visible | `reports or resumes every marked-read crash point within the accepted evaluation bound` |
| code evolution fails closed | `rejects an unversioned replay after workflow or activity semantics change` |
| production cannot use memory engine | `production Workflow composition requires SQL message storage` |

The tests should kill a child process rather than merely interrupt a fiber.
They should inspect the Workflow tables, any candidate semantic log, and the
provider-call ledger, then compare the canonical semantic trace with the
baseline.

### 6. Score outcomes, not features

Record measurements in seven dimensions:

| Dimension | Evidence |
| --- | --- |
| Semantic preservation | scenario results, trace equivalence, and no authority substitution |
| Lifecycle deletion | production lines/modules/concepts actually removed, not hidden behind wrappers |
| Readability | whether the concrete actor, boundary call, intent, observation, and reconciliation remain visible |
| Failure behavior | every process/SQL cut point, duplicate/loss ledger, bounded recovery, negative controls |
| Test usability | fixture size, determinism, failure diagnosis, and memory/SQL parity gaps |
| Operations | tables, migrations, locks, backup/restore, inspection, retention, startup and recovery latency |
| Evolution | pinned-version replay, workflow/activity identity versioning, and upgrade failure mode |

A candidate is favorable only if every semantic requirement passes and it
either removes material lifecycle code or produces a measured operational
improvement large enough to justify the extra store and concepts. Typed API
pleasantness alone is insufficient.

### 7. Predetermine escalation rules

Stop implementation of the tested placement and consult the project owner if
any of these occurs:

- a Workflow record becomes authoritative for tracker, Git, executor, or
  Dalph history;
- a crash point permits a duplicate ambiguity-crossing call;
- the canonical semantic trace changes or gains engine-private occurrences;
- application Exit cannot prevent successor progress;
- production correctness depends on the memory engine;
- old executions replay changed semantics without explicit version routing;
- no material lifecycle code can be deleted after keeping the accepted Dalph
  protocols; or
- the SQL engine can remain silently stuck at a tested cut point without a
  bounded, operator-visible outcome.

A correctness failure triggers an escalation only after the experiment records
why it cannot be fixed within the candidate framework without violating an
accepted invariant or rebuilding the missing durable mechanism. It does not
automatically reject Effect Workflow or authorize a pivot. The project owner
decides rejection, remediation, or movement to another candidate from the
recorded evidence. Ergonomics, deployment weight, and code reduction remain
comparative evidence rather than automatic rejection rules unless the
Wayfinder later accepts a hard bound.

## Findings so far

### Supported

- The prerequisite path is genuinely open: #143 closed the structural lane and
  explicitly authorized this focused prototype.
- The API can represent a versioned, typed Run request and can replay a
  registered handler using SQL-backed mailbox and reply storage.
- Dalph's current single Run entry and explicit Journal responsibilities provide
  a concrete baseline against which full substitution can be measured.
- Current Effect source documents the single-process SQL topology clearly
  enough to build a bounded spike.

### Not supported

- There is no evidence yet that Workflow removes material Dalph lifecycle code.
- There is no exactly-once guarantee for arbitrary external Activity effects.
- `interrupt`, `resume`, `Suspended`, and a stored reply do not prove executor
  safe suspension, fresh outside facts, or cleanup disposition.
- Memory-engine tests cannot support a production durability claim.
- A green happy-path Workflow execution says nothing about two-store crash
  orderings, process death, stale redelivery, or versioned replay.

### Preliminary recommendation

Proceed to a small, throwaway, SQL-backed prototype in a dedicated worktree
from an exact `master` SHA after its chronological scenarios are accepted.
Permit production edits inside that worktree when the experiment requires
them, with no presumption that they will be integrated.

Start with the Workflow-only candidate. Introduce a reduced semantic log only
when a named scenario or trace consumer proves the engine's execution history
cannot carry the required meaning. Use the current-Journal arm only to expose
migration and two-store behavior. The outcome may be complete replacement,
reduced-log replacement, or rejection of Workflow; none is preferred in
advance.

## Questions the prototype must answer

1. Which current Journal responsibilities map directly to Workflow history,
   which require a new fresh read, and which require an independently justified
   semantic event?
2. What wakes an unfinished Dalph Run after its bounded activation returns
   `RunMustRemainActive`, and does that mechanism preserve fresh reads?
3. Can the Workflow execution ID be derived from a versioned exact `RunId`
   mapping without becoming a substitute identity?
4. What are both durable-store states at every crash point between a Journal
   append and Workflow reply persistence?
5. Can Activity interruption retry be disabled or constrained so application
   Exit and reconcile-before-retry remain controlling?
6. Which restart paths reset `last_read` immediately, which wait for stale
   redelivery, and how are stuck messages made visible?
7. Does using the same SQLite database file worsen lock contention, and does a
   second file worsen backup/restore consistency?
8. How are workflow names, activity names, payload schemas, and handler control
   flow versioned for unfinished executions?
9. What operator tooling exists to inspect, quarantine, retry, or retire one
   exact stored execution without editing SQL by hand?
10. Can the SQL-backed engine drive the same controlled fixtures and canonical
    semantic assertions as baseline Dalph without a second test-only workflow?
