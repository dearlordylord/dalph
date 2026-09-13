# Externally started worker participation

Research date: 2026-09-13. Checkout: `f99a2343f5b5d90c08e84b536ffab4a8d562b1fb`.
This is a source-only research note. It changes no Dalph runtime behavior and
does not select an implementation protocol.

## The pivot in concrete terms

Alice has an already running Dalph Run for one repository. The Run has a rooted
task graph, one eligible task, capacity one, and no worker for that task. An
invoking agent asks for the assignment and wants its own host to start the
worker. The open question is whether Dalph must first admit and authorize that
start, or whether the caller or the worker can start first and register later.

The current first milestone does not require this choice. The interview accepts
MCP or CLI clients connecting to a separately started Dalph, inspecting the
existing root-based graph/frontier, requesting work, and changing capacity while
Dalph uses its existing Dalph-managed executors. MCP/client exit must not stop
accepted work. Caller-started worker registration and release remain a separate
research track. See [Q21's accepted answer](invoker-invokee-interview.md#L696-L715)
and [Q25/Q26's milestone boundary](invoker-invokee-interview.md#L782-L820).

For a later externally hosted worker, an execution bound can be enforced only if
the worker's start is causally after an accepted, exact admission, or if the
product explicitly weakens the promise to post-start observation. A later
registration can attach an already-running worker to an attempt after exact
adoption evidence, but it cannot prove that a duplicate did not start, that
capacity was not exceeded before registration, or that an unregistered process
did not write the planned worktree. The identity of the reporting actor (caller
or worker) is therefore a transport choice; the server-side admission and
provider evidence are the authority choices.

## What is required for the first milestone and what is later

| Scope | Evidence in the current interview | Consequence |
| --- | --- | --- |
| First milestone | One active Run per repository; MCP and CLI connect to a separately started Run; the caller inspects the graph/frontier, requests work in the existing root scope, and adjusts capacity; Dalph chooses eligible tasks and uses Dalph-managed executors. | No external worker registration, worker lease, or posthoc adoption is required to finish the initial operator-facing slice. Native user interaction and the rooted graph/frontier are usable independently of the external-worker question. |
| Required before promising an external execution bound | Admission ordering, exact assignment identity, provider/session/process identity, lifecycle observation, ambiguous start recovery, stop/quiescence evidence, and disposition/cleanup ownership. | These are technical gates for a later external-worker protocol, not unresolved user choices that block the first milestone. |
| Later feature | The accepted caller-host story leaves launch, registration, reporting, and release unresolved. Recursive planning is accepted as later core behavior, with preservation of partial Git work and the unfinished-attempt outcome still open. | Registration must not be made a prerequisite for native user access or recursive planning as concepts. Each later feature needs its own chronological protocol and acceptance mapping. |

The interview explicitly says that missing MCP reports, a missing release, or an
expired proposed lease do not prove that execution stopped
([registration docket](invoker-invokee-interview.md#L222-L258)). If the execution
host cannot establish whether the worker is still running, the accepted outcome
is to leave the attempt visibly unresolved and retain capacity until verification
or operator intervention ([Q23](invoker-invokee-interview.md#L738-L756)).

## Existing boundaries

| Boundary | What it can support | What it cannot establish for a caller-started worker |
| --- | --- | --- |
| Immutable attempt planning | `PlannedTaskAttempt` binds `RunId`, task revision, `AttemptId`, exact Base SHA, branch, worktree, and an opaque executor locator before Git or executor work. The deterministic planner materializes all of those values together ([planned attempt schema](../packages/contracts/src/planned-attempt.ts#L7-L28); [planner](../packages/orchestrator/src/workflow/protocols/task-attempt-planning/plan.ts#L52-L104)). | `TaskExecutorLocator` is only a branded non-empty string ([locator](../packages/contracts/src/executor-locator.ts#L1-L5)). It carries no caller identity, provider session, process identity, start credential, or registration state. A planned attempt therefore names the assignment but not an independently launched worker. |
| Fresh-task and task-work admission | Accepted claim intent is retained through claim, specification, plan, and worktree stages; exact executor responsibility replaces the pre-attempt commitment ([fresh admission projection](../packages/orchestrator/src/coordination/admission/fresh-task-admission.ts#L308-L371); [domain definition](../docs/CONTEXT.md#L350-L379)). The runtime reservation transaction prepares an Exit owner, reserves the planned-attempt protocol, reserves the task position, acquires any integration target, and registers the local owner before returning an admission reservation ([reservation sequence](../packages/orchestrator/src/coordination/delivery/delivery-runtime-admission.ts#L1154-L1235)). Capacity is a Run policy reconstructed from journal history, with revision-checked changes appended to the journal ([capacity control](../packages/orchestrator/src/control/task-work-capacity.ts#L62-L133)). | The executor does not acquire or release task capacity ([capacity definition](../docs/CONTEXT.md#L350-L355)). There is no external `registerWorker` or `adoptWorker` call in this transaction. A self-registration message arriving after a process has started cannot retroactively make the capacity bound true. |
| Executor responsibility and lifecycle | Dalph records `PlannedAttemptExecutorWorkResponsibilityBegan` before asking the executor to work; the record is explicit responsibility, not proof that a provider accepted or started work ([responsibility boundary](../packages/orchestrator/src/workflow/protocols/planned-attempt-executor-work/responsibility.ts#L21-L102); [event definition](../packages/orchestrator/src/workflow/protocols/planned-attempt-executor-work/events.ts#L177-L190)). The generic service has `begin`, passive `observe`, `requestSuspension`, and same-attempt `resume`; correlation is exactly `(RunId, AttemptId)` ([contract](../packages/contracts/src/executor.ts#L78-L95); [service](../packages/contracts/src/executor.ts#L178-L225)). | The contract exposes no registration, adoption, caller-host handoff, provider identity, process census, or worker-owned lease. It intentionally hides sessions and processes. `NoReport`, unavailable, unreadable, or foreign-correlation observations are not proof that the worker is absent; missing evidence cannot authorize replacement. |
| Passive observation and reconciliation | The publication path requires an accepted exact responsibility and exact planned-attempt equivalence before it accepts a provider projection. It reconciles an unsettled Begin/Resume/Suspend before a passive read, records observations, and distinguishes an unchanged replay from a new lifecycle report ([projection publication](../packages/orchestrator/src/workflow/protocols/planned-attempt-executor-work/protocol.ts#L58-L178); [reconcile-or-observe](../packages/orchestrator/src/workflow/protocols/planned-attempt-executor-work/protocol.ts#L275-L309)). | A provider report containing only a copied `RunId` and `AttemptId` is not enough to establish which external process is writing. The adapter must validate provider identity and its activity scope before turning a caller/worker report into the generic lifecycle projection. |
| Codex substrate | The concrete Codex adapter has durable attempt/thread/turn associations, including an associated idle thread before a turn, a fresh turn token, observed turn, running, safely suspended, and sealed terminal states ([attempt record](../packages/dalph/src/application/codex-attempt-store.ts#L436-L522)). Its app-server startup acquires an exclusive lease, reconciles a prior exact launch token, records a pre-spawn launch, obtains a process-start identity, and records Spawned/Live launch facts before normal operation ([lease and launch gate](../packages/dalph/src/application/codex-app-server.ts#L2187-L2319); [spawn handoff](../packages/dalph/src/application/codex-app-server.ts#L2719-L2839)). Lease replacement is allowed only after an observation classifies the old owner as absent; live, unreadable, or contradictory owners fail closed ([memory lease](../packages/dalph/src/application/codex-attempt-store.ts#L726-L773); [file lease](../packages/dalph/src/application/codex-attempt-store.ts#L1554-L1600)). | This lease owns the Dalph application-scoped Codex app-server process. It is not a lease handed to an arbitrary caller-hosted worker and does not define an external worker registration API. Codex's provider-specific process/token census is a useful adapter pattern, not a generic executor guarantee. |
| Run reactivation | `RunReactivationOwner` exposes only an ephemeral `hint`; tracker notifications, timers, accepted facts, and Operator wake are coalesced into one Run activation. Tracker/timer hints enter active authority refresh, while ordinary/operator hints enter ordinary Run entry ([owner service](../packages/orchestrator/src/coordination/run/run-reactivation-owner.ts#L77-L105); [hint processing](../packages/orchestrator/src/coordination/run/run-reactivation-owner.ts#L288-L309); [activation selection](../packages/orchestrator/src/coordination/run/run-reactivation-owner.ts#L356-L370)). | A hint wakes a reader. It is not an external worker owner, registration, lease expiry, stop proof, capacity release, or cleanup authorization. A replacement coordinator must reconstruct the Run and reconcile the exact attempt. |
| Git worktree and cleanup | Git planning reads or creates only the exact planned path/branch/Base relationship, reads after an ambiguous create, and preserves contradictions ([Git worktree boundary](../packages/orchestrator/src/authorities/git/worktree.ts#L7-L14); [reconciliation](../packages/orchestrator/src/authorities/git/worktree.ts#L154-L203)). Cleanup authorization names the exact attempt locator/branch/expected head, fresh observation operation and revision, causal predecessors, and `writerQuiescent: true` ([authorization](../packages/orchestrator/src/workflow/protocols/disposition-cleanup/disposition.ts#L147-L178)). Cleanup takes a fresh matching observation, bounds destructive requests, rereads after removal, and settles only after absence is confirmed ([cleanup protocol](../packages/orchestrator/src/workflow/protocols/disposition-cleanup/worktree.ts#L484-L637)). | Git path, branch, and HEAD facts do not identify every process that may still write the directory. An external provider authority must supply the writer-quiescence evidence; MCP EOF, a caller release, a timeout, or a missing process response cannot be substituted for it. |

The position reconstruction makes the release rule explicit: an unfinished
responsibility remains required unless it is abandoned or has a distinct accepted
safe-suspension or terminal report with no unsettled command
([required positions](../packages/orchestrator/src/coordination/run/required-planned-attempt-positions.ts#L18-L48)).

## Chronological alternatives

These are design alternatives, not accepted behavior.

### 1. Dalph admits first; the caller starts second

1. The caller asks Dalph for an eligible assignment. Dalph reads one coherent
   Run graph/frontier and current policy, reserves the exact task position, and
   performs the existing claim/specification/plan/worktree sequence.
2. Dalph records exact executor responsibility and establishes a server-validated,
   attempt-scoped association for the provider start. A capability passed to the
   host is one possible mechanism; an existing provider launch identity is
   another. Either way, the association identifies the immutable `(RunId,
   AttemptId)` assignment and permitted provider scope; it is not merely a
   string placed in a prompt.
3. The caller host starts one worker only after that admission. Before accepting
   work, the executor adapter records or observes the provider's durable worker
   identity, exact worktree, and any descendant/activity scope.
4. The worker reports through the caller or directly; either route is accepted
   only after the adapter matches the selected admission evidence and provider
   identity to the planned attempt. A replacement Run activation uses the same
   exact identity.
5. The adapter reports `ExecutorWorkSafelySuspended` only after proving the
   complete owned activity is stopped, or reports a terminal result with its
   required evidence. Dalph then follows the existing position, integration,
   tracker, and exact cleanup protocols.

If the caller disappears after step 2, the accepted assignment and capacity stay
with the Run. If the start response is lost, Dalph reconciles the exact
credential/provider identity before any retry. If the worker cannot be located
or its activity cannot be proven stopped, the attempt remains unresolved and the
position stays occupied. This is the only alternative that can preserve the
existing “capacity one” promise at the worker-start boundary, provided the host
cannot bypass the admitted provider association and the adapter can observe all
owned writers.

The current responsibility and `begin` boundaries are the natural places to
attach such an adapter, but they need an explicit admission-evidence and
external-identity contract. The current runtime reservation itself does not
start a caller-host worker.

### 2. The caller or worker starts first and registers afterward

1. The caller host starts a worker, perhaps before it has an accepted Dalph
   assignment or while the registration request is in flight.
2. The caller or worker sends a registration containing the Run, attempt, host,
   provider/session/process identity, worktree, and claimed lifecycle state.
3. Dalph checks accepted task/claim/plan/worktree facts and asks a provider
   authority for exact identity and activity evidence. It adopts the worker only
   if every subject matches; otherwise it records an unresolved/foreign
   observation and does not treat the report as executor authority.
4. After verified adoption, later lifecycle reports may use the ordinary exact
   executor projection. Before adoption, Dalph cannot say that one worker was
   started, that no duplicate exists, or that only one capacity position is
   occupied.
5. Caller loss, worker loss, registration-response loss, and missing final
   release all retain the attempt until the provider supplies an authoritative
   safe-stop/terminal observation. The worker cannot release capacity or delete
   its worktree by sending a self-authored release message.

This alternative is useful for attaching existing host workflows, but it is
posthoc observation, not an enforceable admission bound. It is safe only with a
weaker promise or with an independent pre-start reservation that turns it into
alternative 1. A self-registration message alone cannot repair a duplicate launch,
capacity overshoot, foreign writer, or a start that occurred before intent.

### 3. Admission association plus provider discovery

1. Dalph admits the exact assignment and establishes the provider association
   before the caller host starts anything. A one-use capability is one candidate
   mechanism; a provider-native launch token or durable launch identity may be
   sufficient for another provider. The host may start the worker independently
   after the association exists, without keeping the invoking conversation
   online.
2. The provider launches with a durable, queryable identity. The Dalph adapter
   discovers the provider session/process and matches the available admission
   evidence, attempt, worktree, and owner; it records adoption before accepting
   lifecycle reports.
3. A replacement coordinator performs the same current provider listing/process
   census and exact match. A missing, foreign, unreadable, or contradictory
   result preserves responsibility and capacity.
4. The provider exposes an authoritative stop operation and a complete activity
   census. Only the adapter's fresh no-activity proof plus the existing Git,
   tracker, and journal witnesses can authorize release and cleanup.

This is a practical hybrid when a provider has durable identities, listing,
scoped stop, and descendant/activity evidence. The Codex app-server launch token,
process-start identity, and exact activity reconciliation show one existing
substrate shape, but they do not establish that every external provider can
provide it or that the app-server lease is the right worker association. It
remains a provider-specific executor adapter rather than a generic MCP lease.

## What counts as authoritative reclaim evidence

The following chain is sufficient in principle for a later external adapter:

1. A server-validated credential or durable provider identity names exactly one
   `(RunId, AttemptId)` and the planned worktree. The identity is checked by the
   provider boundary, not inferred from a caller-provided label.
2. A fresh provider observation returns the exact identity and a complete
   activity census. The observation must distinguish the worker from its owned
   child processes, background terminals, and other writers that can touch the
   worktree.
3. The adapter accepts `ExecutorWorkSafelySuspended` only when the provider has
   proved all owned activity stopped and same-attempt resumption remains valid, or
   accepts a terminal result with its complete evidence. The generic report
   definition makes the no-owned-activity condition part of safe suspension
   ([contract](../packages/contracts/src/executor.ts#L42-L52); [domain definition](../docs/CONTEXT.md#L403-L428)).
4. Dalph reconciles any unsettled command before retrying, reconstructs the
   required position from accepted history, and takes fresh tracker/claim/Git
   observations required by the disposition. Process disappearance alone does
   not authorize another Begin ([architecture recovery rule](../docs/ARCHITECTURE.md#L421-L439)).
5. Worktree cleanup uses the exact authorization, fresh matching Git facts, and
   a post-mutation absence read. The provider quiescence witness and Git witness
   are separate facts; one cannot be inferred from the other.

The following are useful triggers for another read, but are not reclaim proof:

- MCP EOF, transport disconnect, a caller process exit, or a missing final
  report;
- a caller's “release” request, a worker's self-reported completion, or a
  prompt-level lease string;
- timeout, heartbeat silence, credential expiry, lease expiry, or a stale PID;
- an empty or `NoReport` executor projection; and
- a Git worktree that happens to have the expected path, branch, or HEAD.

Each can coexist with an active writer. Credential/lease expiry can prevent a
future control call while leaving the worker running. An observed PID absence is
only useful when it belongs to an adapter-scoped process identity and the adapter
also proves descendants and other owned writers absent. The current interview's
explicit rule is to retain unresolved work and capacity until verification or
operator intervention when the host cannot establish this fact.

## Smallest discriminating future experiment

Do not build this as part of the current note. The smallest valid future
experiment must first identify a real production substrate that already exposes
the worker identity, complete activity census, and scoped stop evidence needed
for adoption. If no configured substrate exposes those facts, the correct result
is “external adoption is not currently qualified,” not a fake provider that
assumes the answers. If a suitable substrate is selected, the experiment is:

- one Run, one eligible task, capacity one, one exact planned attempt/worktree,
  two independent caller processes, and that selected provider's existing
  durable worker identity, stop operation, and complete descendant/activity
  census;
- run the admission-before-start chronology: commit assignment/responsibility,
  establish the provider association using the substrate's real launch identity
  or capability mechanism, start one worker, lose the caller/MCP response, kill
  or disconnect the caller, and let a replacement coordinator observe the same
  worker without issuing a second start;
- run the start-first chronology: start a worker before accepted admission or
  before registration, inject a duplicate or foreign worker, then attempt
  adoption. The adapter must reject the unproven association or leave it
  unresolved, never claim that capacity stayed within one, and never clean up;
- in both branches, send a repeated/stale report, lose the release response, and
  expire or invalidate the proposed association while the selected worker still
  writes. Assert that no position or worktree is released; then provide the
  substrate's exact stop plus fresh no-activity proof and assert that the normal
  terminal/disposition path can release and clean up once;
- inspect the SQLite workflow journal and provider census for one responsibility,
  one start intent, one exact worker association, no duplicate lifecycle facts,
  and the expected retained-then-released capacity transition.

The experiment may reuse the existing `PlannedAttemptExecutor`,
`CodexProcessNative`, and `CodexOwnedActivityCensus` seams only if the selected
Codex boundary is the real external-worker substrate under test; those seams
must not be treated as a generic worker-adoption oracle. It can also use the
hermetic Git/worktree and journal fixtures. It must not use MCP EOF, sleeps, or
synthetic heartbeats as the proof of worker safety. The decisive variable is the
ordering of the real worker start relative to accepted admission, and the first
gate is whether that real substrate can observe/adopt it at all.

## Scenario-to-test mapping for a later implementation

| Chronological scenario | Required visible result | Future acceptance seam |
| --- | --- | --- |
| An agent client connects to an already running Run, requests work, then its MCP process exits. | The same Run retains accepted work and capacity; another client can inspect it; no client owns the Run lifetime. | Existing production-host attachment acceptance for two clients and client cancellation; this is first-milestone evidence and does not prove external worker adoption. |
| Dalph admits an assignment, then a caller host starts one worker with exact admission evidence. | A replacement coordinator finds the same worker and does not start a duplicate after lost start/registration response. | `admission precedes caller-host start and reconciles one exact worker after response loss`. |
| A caller or worker starts first, or two workers use an unverified/stale registration. | Adoption is rejected or visibly unresolved; the task position and worktree remain retained; the execution-bound claim is not retroactively asserted. | `rejects posthoc foreign or duplicate worker adoption without releasing capacity`. |
| MCP release/EOF, timeout, missing final report, or admission-association expiry occurs while a provider writer may continue. | The attempt remains unresolved and capacity/worktree cleanup do not occur. | `retains unresolved external activity until provider-scoped quiescence evidence`. |
| Provider proves exact worker identity, all owned writers stopped, and terminal/safe-suspended state; Git then proves the exact disposition subject and absence after cleanup. | Capacity release and cleanup happen through the normal journaled protocols, once each. | `releases and cleans one externally adopted attempt only after fresh no-writer and Git evidence`. |
| A worker discovers recursive prerequisites and ends its own attempt. | Later planning can use the graph change independently of the registration actor; partial Git and unfinished-attempt disposition remain explicit design work. | Separate recursive-planning scenario and test; do not make it depend on MCP registration. |

## Limits and unresolved facts

- No generic external registration, adoption, or worker lease exists at this
  checkout. Adding one would require an accepted scenario and a contract that
  names exact admission evidence, provider identity and activity scope,
  reporting route, crash recovery, and reclaim authority. A caller capability is
  only one possible mechanism; a provider-native launch identity may be enough
  for another adapter.
- The generic executor correlation deliberately remains `(RunId, AttemptId)`;
  a provider identity can be an adapter-private witness, but it cannot silently
  become a second generic attempt identity.
- The controlled executor shares Dalph's process lifetime and therefore cannot
  prove independently surviving worker adoption. The architecture records this
  limitation explicitly ([executor boundary](../docs/ARCHITECTURE.md#L401-L439)).
- The Codex app-server lease proves ownership of one application child and its
  token-scoped descendants. It does not prove that a caller host's arbitrary
  process, MCP server, or provider session has stopped.
- Git observations prove exact repository resources and cleanup subjects, not
  all operating-system writers. Provider-native identity and activity evidence
  varies by host; where it is missing, retention and operator intervention are
  the safe outcomes.
- No live provider, external worker, or new fixture was run for this note. The
  alternatives and tests above are research seams, not passing acceptance tests
  or implementation authorization.

## Primary sources

- [Invoker/invokee interview and settled milestone](invoker-invokee-interview.md#L513-L560)
- [Invoker/invokee registration docket](invoker-invokee-interview.md#L222-L258)
- [Invoker/invokee MCP disconnect, unresolved worker, and milestone answers](invoker-invokee-interview.md#L696-L820)
- [Executor research and provider/adoption comparison](agent-driven-executors.md#L13-L66)
- [Canonical executor/capacity vocabulary](../docs/CONTEXT.md#L293-L428)
- [Planned-attempt executor architecture and recovery](../docs/ARCHITECTURE.md#L380-L446)
- [Execution stop evidence and no-timeout release rule](../docs/architecture/control-plane-latency-and-responsiveness.md#L36-L44)
- [Planned attempt and opaque executor locator](../packages/contracts/src/planned-attempt.ts#L7-L30)
- [Executor lifecycle contract](../packages/contracts/src/executor.ts#L42-L225)
- [Task admission projection and capacity](../packages/orchestrator/src/coordination/admission/fresh-task-admission.ts#L308-L371)
- [Delivery reservation ordering](../packages/orchestrator/src/coordination/delivery/delivery-runtime-admission.ts#L1018-L1032)
- [Delivery resource transaction](../packages/orchestrator/src/coordination/delivery/delivery-runtime-admission.ts#L1154-L1235)
- [Responsibility before executor commands](../packages/orchestrator/src/workflow/protocols/planned-attempt-executor-work/responsibility.ts#L52-L102)
- [Codex attempt/thread/turn authority](../packages/dalph/src/application/codex-attempt-store.ts#L436-L522)
- [Codex app-server lease and process-start identity](../packages/dalph/src/application/codex-app-server.ts#L2291-L2319)
- [Exact worktree reconciliation](../packages/orchestrator/src/authorities/git/worktree.ts#L154-L203)
- [Worktree cleanup authorization and fresh evidence](../packages/orchestrator/src/workflow/protocols/disposition-cleanup/disposition.ts#L147-L178)
- [Required position reconstruction](../packages/orchestrator/src/coordination/run/required-planned-attempt-positions.ts#L18-L48)
