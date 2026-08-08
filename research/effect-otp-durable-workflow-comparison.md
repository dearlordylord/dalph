# Effect, Effect Workflow, and OTP for Dalph durability

**Audit date:** 2026-07-30
**Decision boundary:** one active Dalph coordinator per canonical Git common
directory

## 1. Scope and evidence

This comparison separates three mechanisms that are easy to collapse into one:

1. **Ordinary Effect v4**: typed effects, services, Layers, scopes, fibers,
   schedules, streams, and test services.
2. **Effect Workflow with the Cluster engine**: an unstable durable-workflow
   API whose production-shaped engine stores cluster messages and replies and
   re-executes workflow handlers.
3. **Elixir/OTP as used by OpenAI Symphony**: one mailbox-owning scheduler,
   supervised tasks, monitors, timers, and deliberate in-memory reset.

The Effect source is the project-pinned `4.0.0-beta.99` source at commit
[`6184a7dc53cb9310e299b65ad6d6c712c2cbf202`](https://github.com/Effect-TS/effect/tree/6184a7dc53cb9310e299b65ad6d6c712c2cbf202).
The workflow and cluster modules live under `unstable`; their public
declarations carry `@since 4.0.0`, but this audit treats package placement and
the beta dependency as the operative stability signal.

The Dalph baseline is commit
[`0ea1340802f90a879991f2efe554b74c5009c003`](https://github.com/dearlordylord/dalph/tree/0ea1340802f90a879991f2efe554b74c5009c003).
The Symphony baseline is
[`f8e8b8a670c799f6e0ade7a8c25c4bf4a4a56ec7`](https://github.com/openai/symphony/tree/f8e8b8a670c799f6e0ade7a8c25c4bf4a4a56ec7)
and the accompanying
[source audit](cards/symphony-otp-reliability-architecture.md).

No Effect Workflow process-kill or database fault experiment was run for this
comparison. “Proven” below means established by pinned source and repository
tests, not proven for Dalph production.

## 2. Executive finding

Ordinary Effect and Effect Workflow answer different questions.

Ordinary Effect gives Dalph a strong way to express and test **what one live
process should do**. It does not make a fiber, queue, timer, scope, or Layer
survive process loss. Dalph already uses this part effectively.

Effect Workflow's Cluster engine provides a credible substrate for **replaying
named work after process loss**. It does not persist an arbitrary fiber
continuation. It derives a deterministic execution ID, starts the workflow
handler again, and uses persisted messages and replies to avoid repeating
completed named activities and deferred completions. The in-memory engine has
the same API but explicitly has no restart durability
([memory-layer contract, lines 560-576](https://github.com/Effect-TS/effect/blob/6184a7dc53cb9310e299b65ad6d6c712c2cbf202/packages/effect/src/unstable/workflow/WorkflowEngine.ts#L560-L576);
[restart-from-handler behavior, lines 606-639](https://github.com/Effect-TS/effect/blob/6184a7dc53cb9310e299b65ad6d6c712c2cbf202/packages/effect/src/unstable/workflow/WorkflowEngine.ts#L606-L639)).

OTP, as demonstrated by Symphony, is strongest at **in-process ownership and
failure containment**. One GenServer serializes scheduler mutations and
`:one_for_all` restarts the scheduler with its supervised worker pool. It
deliberately does not preserve scheduler maps, retry timers, worker handles, or
agent sessions
([Symphony runtime supervision](https://github.com/openai/symphony/blob/f8e8b8a670c799f6e0ade7a8c25c4bf4a4a56ec7/elixir/lib/symphony_elixir/agent_runtime_supervisor.ex#L14-L33);
[restart test](https://github.com/openai/symphony/blob/f8e8b8a670c799f6e0ade7a8c25c4bf4a4a56ec7/elixir/test/symphony_elixir/core_test.exs#L416-L471)).

For Dalph, the material question is not whether durable workflow has useful
features. It is whether a replay database can preserve Dalph's stricter rule:
the tracker owns task facts and claims, Git owns refs and worktrees, the
executor owns session/process observations, and the Dalph journal owns only
workflow history. A generic workflow replay record must not silently become
authority for any of those outside facts.

## 3. What each mechanism actually preserves

| Mechanism | Survives a function return | Survives fiber interruption | Survives coordinator process loss | Survives host/storage loss |
|---|---:|---:|---:|---:|
| Ordinary Effect value, fiber, queue, scope, or timer | Only while retained by the live runtime | According to the effect's interruption and scope rules | No | No |
| `WorkflowEngine.layerMemory` result cache | Yes, in one engine instance | Yes, while the engine remains live | No; explicitly local/test-only | No |
| Cluster Workflow completed activity/reply | Yes | Yes, subject to stored request/reply protocol | Intended to, when SQL message storage remains available | Only if the configured SQL deployment survives |
| Dalph SQLite journal record | Yes | Yes after acknowledged append | Yes after crash-consistent reopen | Only if the journal file/storage survives |
| OTP mailbox, process state, timer, monitor | Yes while the BEAM process remains live | OTP restart policy determines the local reset | No | No |
| Tracker, Git, executor, or hosting fact | According to that authority | According to that authority | Yes if that authority survives | According to that authority |

The Cluster engine's storage service persists outgoing requests, control
envelopes, replies, duplicate-request identity, and unprocessed mailbox work
([message-storage contract, lines 36-173](https://github.com/Effect-TS/effect/blob/6184a7dc53cb9310e299b65ad6d6c712c2cbf202/packages/effect/src/unstable/cluster/MessageStorage.ts#L36-L173)).
That is broader than Dalph's journal envelope, but narrower than a snapshot of
the whole coordinator.

## 4. Ordinary Effect: useful, but not durable by itself

Ordinary Effect can express:

- a service interface for each authority boundary;
- a production, deterministic-test, fake, dry-run, or faulting Layer for that
  interface;
- scoped ownership of files, locks, child processes, fibers, and queues;
- bounded concurrency and structured interruption;
- typed retry schedules selected by the caller;
- deterministic time and controlled boundary results in tests.

Those properties improve failure handling only when the application supplies
the protocol. A scoped finalizer can close a child process during orderly
interruption; it cannot run after abrupt host loss. A retry schedule can bound
requests; it cannot decide whether a lost response means that GitHub or Git
already applied a change. A service interface can expose a fresh read; it
cannot make yesterday's journal observation current.

Dalph already composes boundaries this way. Its production Layer independently
provides coordinator ownership, tracker mutation, Git worktree and lineage
reads, SQLite journal storage, recovery, and the controlled fake executor
([production composition, lines 28-82](https://github.com/dearlordylord/dalph/blob/0ea1340802f90a879991f2efe554b74c5009c003/packages/dalph/src/application/production.ts#L28-L82)).
Dry-run uses the same operation shapes while denying filesystem and child
process mutation
([dry-run denied capabilities, lines 19-59](https://github.com/dearlordylord/dalph/blob/0ea1340802f90a879991f2efe554b74c5009c003/packages/dalph/src/application/dry-run.ts#L19-L59);
[dry-run composition, lines 74-90](https://github.com/dearlordylord/dalph/blob/0ea1340802f90a879991f2efe554b74c5009c003/packages/dalph/src/application/dry-run.ts#L74-L90)).
Deterministic test and dry-run interpreters replace individual effects rather
than branching the workflow algebra
([interpreter Layers, lines 20-92](https://github.com/dearlordylord/dalph/blob/0ea1340802f90a879991f2efe554b74c5009c003/packages/orchestrator/src/workflow/interpretation/layers.ts#L20-L92)).

This is ordinary Effect's highest-value contribution to Dalph. It remains
valuable whether or not Effect Workflow is ever evaluated.

## 5. Effect Workflow's execution model

A workflow declaration supplies payload, success, and error schemas; an
idempotency-key function; and operations to execute, poll, interrupt, resume,
and register a handler
([workflow interface, lines 37-149](https://github.com/Effect-TS/effect/blob/6184a7dc53cb9310e299b65ad6d6c712c2cbf202/packages/effect/src/unstable/workflow/Workflow.ts#L37-L149)).
The execution ID is a digest of the workflow tag and payload-derived
idempotency key
([execution-ID derivation, lines 313-318](https://github.com/Effect-TS/effect/blob/6184a7dc53cb9310e299b65ad6d6c712c2cbf202/packages/effect/src/unstable/workflow/Workflow.ts#L313-L318)).

The significant implementation fact is replay:

1. The Cluster engine receives the persisted workflow run request.
2. It creates a fresh `WorkflowInstance`.
3. It invokes the registered handler from its beginning.
4. When the handler reaches a named activity or deferred whose stored reply
   already exists, the engine returns that reply.
5. If a required deferred result is absent, the workflow becomes suspended.
6. Resume resets the suspended run request so it can be delivered and replayed
   again.

The fresh instance and handler invocation are visible in the entity handler
([run reconstruction, lines 347-387](https://github.com/Effect-TS/effect/blob/6184a7dc53cb9310e299b65ad6d6c712c2cbf202/packages/effect/src/unstable/cluster/ClusterWorkflowEngine.ts#L347-L387)).
Resume first verifies that the stored result is `Suspended`, resets that
request, and asks storage for it again
([resume, lines 268-285](https://github.com/Effect-TS/effect/blob/6184a7dc53cb9310e299b65ad6d6c712c2cbf202/packages/effect/src/unstable/cluster/ClusterWorkflowEngine.ts#L268-L285)).

Consequently, correctness depends on more than serializable payloads:

- workflow tags and idempotency-key semantics must remain compatible;
- activity names and attempt semantics must be stable;
- code before durable boundaries must be safe to re-execute;
- control flow must reach the same durable boundary for the same recorded
  history;
- deployment changes need an explicit compatibility and migration policy.

The API does not snapshot lexical variables, a JavaScript stack, an open file
descriptor, a subprocess, a Codex context window, or a Git index. Those remain
runtime or external-system facts.

## 6. Activities and ambiguous external effects

An Activity packages a stable name plus success/error schemas. Its result is
routed through the workflow engine, and the Activity module exposes a derived
idempotency key based on the workflow execution ID, optionally including the
retry attempt
([activity construction and execution, lines 117-179](https://github.com/Effect-TS/effect/blob/6184a7dc53cb9310e299b65ad6d6c712c2cbf202/packages/effect/src/unstable/workflow/Activity.ts#L117-L179);
[engine-routed execution, lines 300-325](https://github.com/Effect-TS/effect/blob/6184a7dc53cb9310e299b65ad6d6c712c2cbf202/packages/effect/src/unstable/workflow/Activity.ts#L300-L325);
[activity idempotency key, lines 246-271](https://github.com/Effect-TS/effect/blob/6184a7dc53cb9310e299b65ad6d6c712c2cbf202/packages/effect/src/unstable/workflow/Activity.ts#L246-L271)).

That key is a capability offered to adapter code, not an exactly-once
guarantee. If an activity sends “create tracker claim,” the provider applies
the claim, and the process dies before the Activity reply is durable, replay
can invoke the activity again. Safety still requires one of:

- a provider-native idempotency key with proven payload semantics;
- a compare-and-set request;
- an intent recorded before the request plus a fresh-result check before retry;
- a fail-closed operator reconciliation path.

The default interruption retry policy retries interrupted activities with an
exponential schedule, bounded by attempt count
([interruption retry, lines 181-200](https://github.com/Effect-TS/effect/blob/6184a7dc53cb9310e299b65ad6d6c712c2cbf202/packages/effect/src/unstable/workflow/Activity.ts#L181-L200)).
That is convenient for pure or provider-idempotent work. It is unsafe as a
blanket policy for ambiguity-crossing tracker, Git, hosting, cleanup, or
executor-start effects.

Dalph's journaled interpreter is stricter at an existing boundary: it appends
the exact tracker-read intent, reuses a recorded outcome when one exists,
otherwise calls the tracker and then appends the observation
([journaled tracker read, lines 56-101](https://github.com/dearlordylord/dalph/blob/0ea1340802f90a879991f2efe554b74c5009c003/packages/orchestrator/src/workflow-journal/journaled-interpreter.ts#L56-L101)).
Claim acquisition appends its intent inside an uninterruptible region before
calling the tracker
([journaled claim acquisition, lines 103-142](https://github.com/dearlordylord/dalph/blob/0ea1340802f90a879991f2efe554b74c5009c003/packages/orchestrator/src/workflow-journal/journaled-interpreter.ts#L103-L142)).
Putting that whole protocol inside one Activity would not remove it; it would
add another durable request/reply identity around it.

## 7. Poll, interrupt, suspend, and resume

Effect Workflow exposes attractive control primitives, but their names are
more general than Dalph's accepted meanings.

- **Poll** asks for a stored completed result. It does not reread the tracker,
  Git, executor, or process substrate.
- **Interrupt** writes an interrupt signal and sends an interrupt envelope.
  It can interrupt the currently registered workflow fiber; it does not prove
  that independently surviving executor work or a remote process stopped
  ([cluster interruption, lines 307-345](https://github.com/Effect-TS/effect/blob/6184a7dc53cb9310e299b65ad6d6c712c2cbf202/packages/effect/src/unstable/cluster/ClusterWorkflowEngine.ts#L307-L345)).
- **Suspend** means the workflow cannot currently continue and may later be
  replayed. It is not Dalph's `SafelySuspended` executor report, which proves
  that no executor-owned activity remains running and that the same planned
  attempt can resume.
- **Resume** re-delivers a suspended workflow. It does not by itself perform
  Dalph's required fresh tracker, claim, worktree, target, executor, and
  journal reconciliation.

Workflow compensation is also narrower than a durable disposition protocol.
The API explicitly warns that compensation finalizers attach only to top-level
workflow effects, not nested activities
([compensation contract, lines 151-186](https://github.com/Effect-TS/effect/blob/6184a7dc53cb9310e299b65ad6d6c712c2cbf202/packages/effect/src/unstable/workflow/Workflow.ts#L151-L186)).
A compensation effect can itself cross an ambiguous boundary, and “undo” is
not valid for many Git, tracker, executor, or cleanup outcomes. Dalph's
cleanup/disposition requirements therefore cannot be replaced with a generic
finalizer.

## 8. SQL message storage and `SingleRunner`

The Cluster workflow Layer requires both sharding and `MessageStorage`
([cluster layer, lines 762-780](https://github.com/Effect-TS/effect/blob/6184a7dc53cb9310e299b65ad6d6c712c2cbf202/packages/effect/src/unstable/cluster/ClusterWorkflowEngine.ts#L762-L780)).
`SingleRunner.layer` packages those dependencies for a single process:
message storage is always SQL-backed; runner storage is SQL-backed by default
or may be in memory; communication and health services are no-ops
([single-runner contract, lines 25-74](https://github.com/Effect-TS/effect/blob/6184a7dc53cb9310e299b65ad6d6c712c2cbf202/packages/effect/src/unstable/cluster/SingleRunner.ts#L25-L74)).

This is the relevant topology for the agreed one-coordinator evaluation. It
does not imply a lightweight embedded journal:

- it brings entity addressing, shards, runners, mailbox requests, replies,
  deduplication, delivery times, and migrations;
- the SQL reader has a ten-minute stale-read fallback
  ([SQL redelivery query, lines 326-390](https://github.com/Effect-TS/effect/blob/6184a7dc53cb9310e299b65ad6d6c712c2cbf202/packages/effect/src/unstable/cluster/SqlMessageStorage.ts#L326-L390));
- shard acquisition tries to reset unprocessed messages' read markers before
  admitting the acquired shards
  ([shard acquisition, lines 344-375](https://github.com/Effect-TS/effect/blob/6184a7dc53cb9310e299b65ad6d6c712c2cbf202/packages/effect/src/unstable/cluster/Sharding.ts#L344-L375);
  [SQL reset, lines 616-625](https://github.com/Effect-TS/effect/blob/6184a7dc53cb9310e299b65ad6d6c712c2cbf202/packages/effect/src/unstable/cluster/SqlMessageStorage.ts#L616-L625));
- activity definitions and captured service contexts are still registered in
  process-local maps before replay can execute them
  ([activity registration and execution, lines 389-428](https://github.com/Effect-TS/effect/blob/6184a7dc53cb9310e299b65ad6d6c712c2cbf202/packages/effect/src/unstable/cluster/ClusterWorkflowEngine.ts#L389-L428)).

The ten-minute stale-read threshold and best-effort reset-on-acquisition are
concrete recovery mechanics, not merely implementation details. The reset is
ignored on failure and bounded by the shard-lock refresh timeout. Dalph would
need a fault experiment to establish actual `SingleRunner` restart latency and
redelivery behavior for each storage and shard-acquisition crash point.

By comparison, Dalph's current SQLite journal uses one strict table with
ordered per-run positions and unique per-run record keys
([journal schema, lines 184-208](https://github.com/dearlordylord/dalph/blob/0ea1340802f90a879991f2efe554b74c5009c003/packages/orchestrator/src/workflow-journal/adapters/sqlite-store.ts#L184-L208)).
Its public interface deliberately contains only run lifecycle, append, read,
scan, and recovery operations
([journal service, lines 120-145](https://github.com/dearlordylord/dalph/blob/0ea1340802f90a879991f2efe554b74c5009c003/packages/orchestrator/src/workflow-journal/store.ts#L120-L145)).

## 9. Dalph authority fit

Effect Workflow would fit Dalph only if every persisted item has one explicit
meaning:

| Workflow/Cluster datum | Safe Dalph interpretation | Unsafe interpretation |
|---|---|---|
| Workflow execution ID | Deduplication/correlation for one registered replay program | Replacement for `RunId`, `AttemptId`, tracker claim, executor session, or journal key |
| Persisted Activity reply | Evidence that this adapter invocation returned this encoded result | Proof that an external fact remains current |
| Suspended run reply | The replay program reached a suspension boundary | Proof that executor work is safely stopped |
| Interrupt envelope | A control message was persisted/sent | Proof that an OS, container, VM, SSH child, or remote agent stopped |
| Durable deferred completion | A named signal was stored | Tracker, Git, executor, or operator authority unless that boundary explicitly owns the signal |
| Durable clock | A wake-up request | Permission to cross a state-changing boundary without fresh authority reads |

Dalph explicitly persists workflow history rather than in-memory coordinator
state. On restart it validates the full history, then rereads current tracker,
Git, and other authority facts. It does not restore queue buffers, capacity
reservations, timers, frontiers, or presentation state from durable copies
([architecture durability contract](https://github.com/dearlordylord/dalph/blob/0ea1340802f90a879991f2efe554b74c5009c003/docs/ARCHITECTURE.md#L129-L144)).

That contract exposes two risks:

1. **Duplication.** The workflow database can record run, activity, deferred,
   timer, and interrupt facts already represented more precisely in the Dalph
   journal.
2. **Distortion.** Developers may start treating “Activity completed” as the
   current truth of a tracker, Git, executor, or hosting fact, weakening
   reconcile-before-retry.

The safest possible experiment would keep the Dalph journal authoritative for
all domain history and use the workflow store only as delivery/replay
infrastructure. That still leaves two databases whose transaction boundary and
crash ordering must be specified.

## 10. Deterministic reduction, property tests, and models

Dalph's reconstruction is intentionally visible and pure. Separate reducers
rebuild graph knowledge, per-subject responsibility, complete workflow
history, control policy, and pause state; composition then returns one
reconstructed state
([pure reducers and composition, lines 22-29 and 67-91](https://github.com/dearlordylord/dalph/blob/0ea1340802f90a879991f2efe554b74c5009c003/packages/orchestrator/src/coordination/reconstruction/reduce.ts#L22-L91);
[state composition, lines 191-217](https://github.com/dearlordylord/dalph/blob/0ea1340802f90a879991f2efe554b74c5009c003/packages/orchestrator/src/coordination/reconstruction/reduce.ts#L191-L217)).
The chronological validator accumulates identity and semantic issues instead of
letting replay silently choose one history
([history envelope validation, lines 90-124](https://github.com/dearlordylord/dalph/blob/0ea1340802f90a879991f2efe554b74c5009c003/packages/orchestrator/src/coordination/reconstruction/history.ts#L90-L124)).

That shape supports stronger tests than happy-path workflow replay:

- property tests generate histories and assert that observations cannot invent
  responsibilities
  ([reconstruction property, lines 20-81](https://github.com/dearlordylord/dalph/blob/0ea1340802f90a879991f2efe554b74c5009c003/packages/orchestrator/src/coordination/reconstruction/reduce.property.test.ts#L20-L81));
- model-based tests replay generated Quint traces through the actual executor
  boundary and compare state projections
  ([Quint conformance, lines 272-295](https://github.com/dearlordylord/dalph/blob/0ea1340802f90a879991f2efe554b74c5009c003/packages/dalph/test/conformance/planned-attempt-executor.mbt.test.ts#L272-L295)).

Effect Workflow's pinned tests establish important engine mechanics—suspend,
resume, deduplication, polling, interruption, compensation, activity races,
and clock routing
([Cluster Workflow tests, lines 77-239](https://github.com/Effect-TS/effect/blob/6184a7dc53cb9310e299b65ad6d6c712c2cbf202/packages/effect/test/cluster/ClusterWorkflowEngine.test.ts#L77-L239)).
They do not replace Dalph's domain properties or formal model. If the engine is
evaluated, its storage and replay controls should become another conformance
driver for the same reducers and scenarios, not the specification itself.

## 11. OTP comparison

OTP and ordinary Effect overlap substantially in one live process:

| Concern | Symphony/OTP | Ordinary Effect |
|---|---|---|
| Serialized scheduler owner | GenServer mailbox | Queue/serialized effect loop or synchronized service |
| Child ownership | Supervisor and `Task.Supervisor` | Scope and scoped fibers/resources |
| Failure observation | Links and monitors | Fiber exits, typed failures, causes |
| Restart policy | Supervisor strategy | Explicit retry/restart loop and Layer reacquisition |
| Timers | BEAM timers | Clock and Schedule |
| Dependency substitution | Named processes plus injected options/fakes | Services and Layers |
| Process-loss durability | None in Symphony | None without a durable adapter |

Symphony demonstrates that OTP's supervision can produce a clean local reset:
the Orchestrator and task supervisor restart together, and the old supervised
worker is terminated. It does not demonstrate adoption after whole-BEAM or
host loss, durable attempt identity, session restoration, or ambiguous
external-effect reconciliation. Its specification defines recovery as fresh
polling plus preserved workspace directories
([Symphony restart contract](https://github.com/openai/symphony/blob/f8e8b8a670c799f6e0ade7a8c25c4bf4a4a56ec7/SPEC.md#L1689-L1703)).

Effect Workflow is therefore not “Effect's OTP.” It adds persisted request,
reply, clock, and deferred replay that Symphony does not have. Conversely, it
does not automatically reproduce OTP's proven supervisor reset boundary for
arbitrary local and OS children. Dalph still needs an explicit runtime
ownership tree and process-loss protocol.

## 12. User-visible restart cases

| Chronological case | Ordinary Effect only | Cluster Workflow, if correctly integrated | Symphony/OTP baseline | Dalph requirement that remains |
|---|---|---|---|---|
| Process stops before a tracker request | Runtime state disappears | Handler replays; a prior durable Activity boundary may be reused | Fresh tracker poll | Journal evidence must decide whether any intent existed |
| Tracker applies mutation; response is lost | Retry behavior is application-defined | Activity may replay unless provider idempotency or Dalph reconciliation prevents it | Fresh agent/tracker state decides | Record intent, reread tracker, distinguish exact match/conflict/unreadable |
| Process stops after a completed Activity reply is stored | Application state disappears | Replay returns stored reply without invoking the Activity | No comparable durable step | Decide whether reply is historical evidence or still-current authority |
| Process stops while workflow is suspended | Suspension state disappears | Stored suspended run can be reset and replayed | Retry/blocked state disappears | Do not equate workflow suspension with executor safe suspension |
| Process stops while local child is running | Scope cannot run after process death | Workflow storage survives; child survival is independent | In-BEAM supervisor reset kills supervised task; whole-BEAM loss is uncertain | Inspect/adopt/stop/quarantine exact executor activity before duplicate start |
| Host disappears for a week | No local state | SQL can preserve replay records if independently hosted/durable | Tracker and directory survive only where externally retained | Reread current tracker/Git/executor facts; never restore stale frontier or lease |
| Code changes before replay | New process runs new code | Old execution is replayed through new registered handler unless versioned | New worker uses new workflow/config | Define workflow/activity compatibility and migration behavior |

For users, the strongest potential improvement from Cluster Workflow is not
“resume the same JavaScript execution.” It is “a replacement coordinator can
find a persisted named request and avoid repeating already-recorded named
results.” The strongest remaining caveat is that an agent session and dirty
worktree are not those named results. In the user's umbrella meaning, a
recoverable coding session includes the agent's session/thread/context/log
plus the exact worktree: committed, staged, unstaged, untracked, ignored,
conflicted, and stashed state. The audit still reports those parts separately
because each has a different owner and can survive or disappear independently.

## 13. Maintainability consequences

### Ordinary Effect

Benefits already realized:

- boundary interfaces expose the error surface;
- Layer composition keeps production, fake, test, and dry-run policies
  inspectable;
- pure decision code remains independent of runtime scheduling;
- scoped resources make orderly shutdown behavior local and testable.

Costs:

- the application must author its own journal and recovery protocol;
- Layer graphs can become hard to read if broad merged environments hide
  authority dependencies;
- structured concurrency still needs explicit domain correlation and
  admission accounting.

### Effect Workflow/Cluster

Potential benefits:

- one typed API for execute, poll, interrupt, resume, clocks, deferreds, and
  persisted activity results;
- storage-level request deduplication and reply replay;
- a `layerMemory` double for local tests and SQL-backed `SingleRunner` for a
  one-process deployment.

Costs and risks:

- unstable beta APIs may change schemas, storage tables, replay semantics, or
  Layer requirements;
- workflow/activity name stability becomes deployment policy;
- two durable stores create ordering, migration, backup, corruption, and
  operator-repair questions;
- generic Activity semantics can conceal the exact intent/observation protocol
  that Dalph reviews today;
- Cluster terminology and services introduce architectural weight even when
  only one coordinator is allowed;
- memory and SQL engines may share an interface without sharing crash
  behavior, so passing `layerMemory` tests is weak evidence for production.

### OTP

Benefits demonstrated by Symphony:

- a simple, observable single-owner state machine;
- mature local supervision and mailbox ordering;
- a deliberate reset boundary that prevents an old supervised worker and its
  replacement from normally overlapping inside one runtime.

Costs for Dalph:

- adopting OTP would be a language/runtime rewrite;
- Symphony's direct clocks, filesystem, process, shell, and SSH calls provide
  fewer independently composable boundary Layers than Dalph currently has;
- supervision alone does not solve durable attempt identity, external
  ambiguity, or recovery from host loss.

## 14. Proven claims, future claims, and unknowns

### Proven in pinned source

- `WorkflowEngine.layerMemory` is non-durable and restarts handlers from their
  beginning within its live instance.
- Cluster Workflow stores and queries persisted requests/replies through
  `MessageStorage`.
- Workflow execution identity is deterministic from workflow tag and a
  payload-derived idempotency key.
- named Activity results are keyed by workflow execution, activity name, and
  attempt in the engines.
- Cluster resume resets a stored suspended request and replays it.
- `SingleRunner` still requires SQL message storage and uses no-op runner
  communication/health.
- Dalph's SQLite journal and pure reducers are separate from outside
  authorities and from derived frontier/runtime state.
- Symphony's OTP tree provides local supervision but its scheduler, retry,
  capacity, and session state are memory-only.

### Future claims requiring Dalph design and experiments

- that Cluster Workflow reduces Dalph's code or incident rate after retaining
  the existing journal protocol;
- that one SQL store can safely replace the Dalph journal rather than merely
  accompany it;
- that a stored Activity reply can be mapped to every existing Dalph journal
  event without losing causal or authority semantics;
- that crash recovery is acceptably fast across every message read, activity,
  reply, deferred, interrupt, and clock boundary;
- that version upgrades can replay old workflows without semantic drift;
- that production, fake, dry-run, and fault Layers remain behaviorally aligned;
- that a remote executor or Codex session can be adopted, stopped, or resumed
  after coordinator/host loss.

### Confirmed open questions

1. Which exact Dalph operation, if any, is sufficiently pure and narrow to be
   the first Workflow experiment?
2. Is the Workflow database delivery infrastructure only, or may it contain
   domain history? If the latter, which store is authoritative on disagreement?
3. Can one atomic SQL transaction append the required Dalph event and complete
   the corresponding workflow reply? If not, what are both crash orderings?
4. What deployment/version key prevents new code from replaying an old
   execution under changed activity names or control flow?
5. How are poison messages, malformed replies, incompatible schemas, and
   corrupted mailbox rows surfaced without hiding unaffected Dalph runs?
6. On startup, what clears or waits for SQL `last_read`, and what is the
   measured worst-case recovery delay?
7. Does interruption request safe executor suspension, or merely stop the
   coordinator fiber? What evidence distinguishes the two?
8. Which failure schedules are bounded, and which engine-internal retries can
   continue indefinitely?
9. Can `layerMemory` be prevented from accidentally appearing in a production
   composition?
10. What backup, restore, migration, retention, and operator-inspection tools
    exist for the workflow tables?

## 15. Evaluation prerequisites

No feature checklist is sufficient to justify adoption. Before implementation
work, an evaluation would need:

1. accepted chronological scenarios for each chosen crash boundary, including
   the person-visible result and forbidden duplicate/loss;
2. a written authority map for every Workflow run, Activity, deferred,
   interrupt, and clock record;
3. a scenario-to-test mapping that uses the real SQL engine, not only
   `layerMemory`;
4. process-kill tests before/after Activity request and reply persistence;
5. database-unavailable, locked, delayed-redelivery, duplicate, corruption,
   and schema-upgrade tests;
6. an executor-child experiment covering orderly interruption, coordinator
   kill, whole-host loss, and a surviving remote process;
7. a two-store fault matrix if the Dalph journal remains separate;
8. property tests asserting that replay never invents current tracker/Git/
   executor facts or duplicate responsibility;
9. a Quint/conformance adapter that feeds Workflow recovery outcomes through
   the existing deterministic reducer and frontier;
10. measured immediate-restart and week-later recovery behavior, including
    the complete agent session plus committed, staged, unstaged, untracked, and
    conflicted worktree state.

## 16. Bottom line

Ordinary Effect is already a good fit for Dalph because it makes boundary
authority, runtime ownership, and test substitution explicit. OTP would mostly
offer another implementation of the same in-process supervision strengths, and
Symphony demonstrates that those strengths do not create durable orchestration.

Effect Workflow/Cluster is materially different: it can persist named
requests, results, waits, and wakeups and replay code after process loss. That
makes it worth a narrowly controlled crash experiment, not a conclusion.

The decisive constraint is Dalph's architecture. A replay engine may deliver a
workflow again; only the tracker can say what the task and claim are now, only
Git can say what branch and worktree exist now, only the executor substrate can
say whether work survives, and only Dalph's validated journal can establish
the workflow history Dalph chose to record. Any evaluation that blurs those
owners would improve apparent convenience by weakening recovery correctness.
