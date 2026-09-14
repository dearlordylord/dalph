# First invoker/invokee milestone: inspect and direct one running Dalph

Specification issue: [#365](https://github.com/dearlordylord/dalph/issues/365).

Status: specification synthesized from the accepted interview through Q27.
The product decisions are accepted interview decisions; the application-contract
choices below are this specification's design, not retroactive interview answers
or claims of shipped behavior. Required acceptance tests are declared, not added
or reported passing. The changing-graph termination defect remains a release
blocker for the complete milestone.

This is a documentation-only artifact on the interview worktree. It changes no
runtime, formal model, dependencies, or delivery-provider state. The user has
authorized publishing this specification as one repository issue. Implementation
ticket breakdown, implementation, and integration into master remain outside
this task. The ready-for-agent label classifies the specification for triage;
it does not waive the explicit implementation gates or authorize coding here.

## Problem Statement

Alice starts Dalph to deliver tracker work. Later, she asks her coding agent to
inspect progress, request more work within the same scope, or change capacity.
Today the production invocation owns the host lifetime, and its observation
callback does not expose the supported remote controls these clients need.
Simply running another invocation risks confusing attachment with ownership of
delivery. Losing an agent's process must not stop Alice's ongoing work.

Alice and her agent also need to distinguish what Dalph currently knows from
what it has merely been asked to check. A refresh acknowledgement does not prove
GitHub was read; a saved Unpause does not alone prove its live owner was notified;
a delivered task does not prove the whole Run can terminate.

## Solution

Alice starts Dalph separately for one repository and one tracker root. Her agent's
MCP process and her CLI connect to that same application. They inspect a coherent
current task graph and delivery state, follow updates, request ordinary work,
explicitly Resume/Unpause, and read or change capacity. Dalph chooses eligible
work and uses its existing managed executors. Closing either client leaves the
host and its authorized delivery running.

The agent creates tasks and explicit blockers directly in the tracker. It can
then submit a whole-graph refresh hint or advisory task IDs. Dalph obtains facts
from the tracker; neither the hint nor client chat becomes authority. Startup
and scheduled reads continue without a required client notification.

### Governing behavior

The scenarios preserve these protocols and refine only their attachment and
application-result boundaries. They do not change protected delivery compositions.

| Concrete decision | Governing scenarios, invariant, and formal boundary |
| --- | --- |
| A second client joins or a host reconstructs its Run | [Reactivation](issue-218-reactivate-incomplete-runs.md#a-normal-finality-result-stops-or-retains-the-exact-run); [D38–D40](../DELIVERY-INVARIANTS.md#run-boundaries); [runActivation](../../specs/runActivation.qnt): `oneBeginningPerRun`, `onlyExactEstablishedRunActivates`, `atMostOneDiscoveredUnfinishedRunMayActivate`, `existingHistoryUsesLatestDurablePolicy`. |
| Alice observes a task whose desired placement changes while its attempt remains executing | [Current status](issue-300-current-status-admission-witness.md#alice-remains-attached-while-an-admitted-proposal-leaves-the-current-graph), [capacity evidence](issue-131-conflicting-capacity-observation.md#the-fake-executor-completes-task-as-planned-attempt); [D12–D15](../DELIVERY-INVARIANTS.md#admission-and-capacity); [runActivation](../../specs/runActivation.qnt): `everyDurableRetainedAttemptHasExactPosition`, `latestPolicyControlsAdmission`. These laws do not prove transport buffering. |
| Alice asks for work while paused, then explicitly resumes | [Run Unpause](issue-134-pause-whole-run.md#alice-unpauses-a-passively-paused-run), [pause ADR](../adr/0008-derive-run-scoped-pause-state.md); [D20](../DELIVERY-INVARIANTS.md#locality), [D47](../DELIVERY-INVARIANTS.md#operator-requests); [controlDirectionApplication](../../specs/controlDirectionApplication.qnt): `applicationClaimsNoLaterEffects`, `appliedDirectionIsOperatorInitiated`. Callback completion and response loss need the concrete tests below; this model does not establish them. |
| An agent edits GitHub and requests a check | [Active-work refresh](issue-218-reactivate-incomplete-runs.md#alice-edits-instructions-while-executor-work-remains-active), [graph-knowledge ADR](../adr/0006-retain-incomparable-task-graph-facts.md), [admission ADR](../adr/0009-separate-frontier-from-bounded-admission.md); [D21–D24](../DELIVERY-INVARIANTS.md#ambiguity-and-evidence). The existing executable scenario `failed live refresh neither starts nor suspends work` constrains unreadable evidence. Q17 refines the authored-intermediate-state case, not that failure rule. |
| A later tracker read might permit termination | [Stabilization](issue-194-stabilize-each-run.md#g2-proves-complete-and-settled-termination); [D35](../DELIVERY-INVARIANTS.md#progress); [runActivation](../../specs/runActivation.qnt): `terminationRequiresLaterSettledObservation`, `terminationRequiresExactFreshGraphEvidence`, `terminationRequiresNoRetainedResponsibilityOrPosition`, `completedRequiresAllCurrentTasksSuccessful`, `blockedRequiresFreshConclusiveTrackerFacts`. These abstractions do not qualify the reproduced concrete graph-predecessor gap. |
| The host receives Exit, rather than a client disconnecting | [Exit model mapping](issue-203-application-exit-model-mapping.md#scenario-to-test-mapping-for-issue-203), [host-scoped Exit architecture](../ARCHITECTURE.md#graceful-application-exit); [application Exit invariants](../DELIVERY-INVARIANTS.md#application-exit); [applicationExit](../../specs/applicationExit.qnt), through that exact executable mapping. No new Exit protocol or drain duration is introduced. |

### Shared starting facts for S1–S9

Unless a scenario overrides them, Alice's repository has one selected Run R for
root C. GitHub contains open parser task A, validation task B, and command task C;
C explicitly requires successful A and B. Grouping is separate from these
blockers. The host holds the coordinator lock for the exact Git common directory.
SQLite has one Run beginning, current capacity one at revision r, and A's claim,
immutable attempt plan and executor responsibility. Git has A's one exact
worktree and branch at its planned Base SHA. The executor reports A executing.
B and C have no attempt. The host is unpaused. Clients run under Alice's existing
instructions. They neither acquire the coordinator lock nor construct a Run.

For passive and rejected operations, the absence of tracker/Git/executor calls
is an asserted outcome: those authorities have no role in answering that request.
No crash occurs in a scenario unless stated. Loss/retry variants are explicit
below; reconnecting is always a new passive attachment, never replay of commands.
Each S identifier names its required acceptance test in Testing Decisions.

### S1 — Alice and her agent join the same delivery

1. Alice supplies the running host's local address to her CLI and agent's MCP
   adapter. Each connects, reads the selected Run descriptor, then reads R's
   snapshot and subscribes to R's updates.
2. The application uses its existing runtime signal. Each subscriber receives
   its attached current value before later complete publications. Tasks without
   executors remain visible; assigned executors have only opaque associations.
3. A publication changes while A executes. Both clients can observe the new
   graph/frontier/status without starting another activation just to read it.

Alice sees one delivery, not one per client. Assert no attachment-caused journal
append, authority call, second coordinator, second Run beginning, claim, attempt,
or Begin. A publication between attaching and consuming changes must not be lost
through a separate read-then-subscribe race. Repeated reads remain passive.
Governing prohibitions: D1, D12–D15, D29, D38–D40 and descriptive status architecture.

### S2 — Alice closes the MCP process while A is executing

1. Start from S1, with the executor result held at the controlled provider seam.
   Alice closes the agent application; its stdio MCP child exits. Also exercise
   CLI watch cancellation and a broken CLI stdout connection.
2. Only that client's transport, waiter and subscription are released. The
   original host continues observing A and performing ordinary delivery.
3. A replacement MCP child or CLI connects to the same R. Release A's result;
   prove ordinary accepted-result integration, target promotion, tracker
   confirmation and exact resource dispositions independently of either client.

The replacement sees current state without the old chat or cursor. Client loss
must issue zero application Exit requests, release no occupied task position,
prove no executor stop, authorize no cleanup, and create no replacement attempt
(D2, D12–D17, D24, D29–D31). This is client process death, not host death; S9 owns
host loss. No workflow mutation is retried because a client reconnects.

### S3 — The agent requests work and adjusts capacity

1. The agent reads R's capacity policy, submits capacity two with expected
   revision r, and receives the accepted policy at r+1 from the existing control
   boundary. It sends start work, which submits an ordinary owner wake hint.
2. Dalph admits eligible B through the ordinary tracker claim, post-claim facts,
   immutable plan, Git worktree and executor protocols. Their required journal
   intents precede their outside calls. C remains blocked by A and B.
3. While A and B execute, the agent lowers capacity to one with the now-current
   revision. Both exact holders remain; no new task is admitted until allowed.

The capacity result proves a durable policy change; the wake result proves only
hint submission. Neither is proof that B began. Assert actual Begin and exact
attempt facts separately. A lower ceiling does not evict, suspend, cancel or
clean a holder. Desired selection is not occupancy (D12–D15, D16, D40, D47).
No crash here; competing requests and response loss are S5. Startup capacity
continues to use the existing initial-policy mechanism, not client attachment.

### S4 — Start work preserves Pause; explicit Unpause survives client loss

Starting override: Alice previously applied Run Pause. SQLite records that
direction; the actual owner has stopped its timer. Any safely suspended A retains
its exact plan, claim and recoverable Git work. Its task position was released
only upon the exact qualifying executor report, not upon Pause receipt.

1. Her agent sends start work, then refresh. Both hint calls return without
   overriding Pause; no polling or fresh task work follows from these hints.
2. Under Alice's instructions the agent explicitly calls Unpause. The host
   admits and owns the complete bootstrap command independently of the client.
3. Hold SQLite after INSERT but before COMMIT, or after COMMIT before storage
   acknowledgement. Kill the client waiter. Release the storage gate.
4. The command completes accepted publication and invokes the actual owner
   callback once. The owner restarts its timer and requests activation. Ordinary
   workflow reads/reconciles the required current authority facts before progress.

A received `UnpauseApplied` proves the append and callback returned, not executor
resumption or task admission. Assert one additional control ordinal, one actual
callback and the owner activation, not just a service return. Do not leave the
ongoing owner locally paused because request cancellation skipped its callback.
Do not require an online human, a parent handback, or another Unpause (D20–D22,
D47). Host death between append and callback is S9; response uncertainty is S5.

### S5 — Two clients race and one loses a command response

1. Both clients read capacity at r. One submits two, the other three, each with
   expected r. The accepted journal order permits one change; the other receives
   a revision conflict containing the complete current policy.
2. Lose the winner's response after command admission, at each SQLite cut in S4,
   and after completion before response delivery. The host still owns completion.
   The replacement reads capacity and may resubmit only the original expected r.
   Once r+1 is accepted, that exact repeat conflicts without a second change.
3. In a separate paused fixture, lose an Unpause response. Read durable Run
   control after reconnect; do not infer the request's identity from the current
   direction. Alice then applies Pause through the existing control boundary.
   The adapter must not automatically replay the old Unpause over that Pause.
4. Before host command admission, cancel a request and prove no command ran.
   If the caller cannot establish which side of admission it reached, report
   unknown outcome rather than claiming cancellation or success.

Expose the actual current policy or durable pause state, and retain unknown
command outcome where attribution cannot be proved. Do not silently acquire a
new capacity revision and repeat the old intent. A fresh explicitly chosen
Unpause is a new direction, not deduplicated replay. No transport request ID
creates durable idempotency. D21–D22 and D47 govern these distinctions; D49's
changed-attempt-choice replay protocol is not automatically an Unpause protocol.
Git and executor mutations are not command-outcome queries.

### S6 — The agent authors work in GitHub, then hints refresh

1. While A executes, the agent creates example-data task E in the tracker and
   adds E as an explicit prerequisite of C, within C's target closure.
2. It sends either whole-graph refresh or advisory IDs [C, E]. The application
   validates the hint and submits a tracker notification to the existing owner.
3. The owner coalesces the opportunity. When the workflow admits the active-work
   refresh, it records the graph-read intent, reads the complete target closure
   through the tracker adapter, and records the qualified observation.
4. Clients later see E and the distinct E-to-C blocker. In a separate variant,
   omit or lose the hint and let the configured timer discover the same facts.
   Startup discovery likewise needs no explicit refresh call.
5. In the successful story variant, let A, B and E deliver, then let C begin
   only after their required tracker success is established. Complete C and all
   resource obligations. A later client sees an actual `Completed` Run only after
   the qualified final tracker read. This suffix requires the S10 causal-evidence
   correction; a graph update alone does not qualify it.

`RefreshSubmitted` says neither queued nor read-complete. Advisory IDs cannot
supply facts, restrict completeness, expand R's root, or choose tasks. Ordinary
workflow controls whether a read occurs, especially while paused, terminal or
without a qualifying executing subject. Clients inspect later snapshots rather
than treating the response as a correlated refresh receipt. No new mutation
retry exists: the agent's tracker tools own authoring. D21–D24, D29 and D36 apply.

### S7 — An edit is visible before its blockers, or evidence is incomplete

Starting override: GitHub has newly authored D within the root's grouping
closure, with no blockers yet; capacity is available and D has no claim, plan,
Git worktree or executor. The journal contains no D responsibility.

1. A scheduled complete read observes D without blockers before the agent's
   later tracker call adds D's prerequisite E. Dalph may admit D from that
   complete observed state. Test this interleaving explicitly (Q17).
2. In a separate fixture, E already blocks D, but a required GitHub page or
   blocker read is missing, contradictory or unreadable. The adapter returns
   typed incomplete/failure evidence. Dalph must not infer no blocker or admit D
   from that result. Later independent refresh follows ordinary retry limits.
3. During a refresh activation, a current `Ready` publication can say
   `GraphNotEstablished`. Clients render graph unavailable; a retained prior
   graph is labeled stale and is never used for admission or reported as current.

These cases must remain distinguishable. There is no mandatory editing Pause,
publication barrier, transaction or ready label. Later blocker authoring does
not imply a new automatic yield protocol for an already running D. No client or
host crash is needed to demonstrate these ordering and coverage failures.
D23 and D29 forbid false absence or authoritative presentation caches.

### S8 — A slow watcher reconnects or sees closure

1. Starting from S1, hold one client's transport write while complete states
   continue to publish. Preserve its first attached current frame separately;
   later pending states may coalesce to the latest complete state.
2. If the client becomes writable within the configured finite write deadline,
   deliver the latest state, without claiming every intermediate publication.
   If it remains blocked, disconnect that watcher and release its subscription.
3. If the source publishes `Closed` while blocked, retain its final value in
   preference to any pending ordinary update. Deliver Closed before normal EOF
   if the writer recovers; otherwise report a transport failure, never normal
   successful closure. A reconnect to a still-available source receives current
   Closed and ends.
4. Repeat with two different runtime states sharing one accepted journal
   position. Both are eligible publications; that position is not a wire cursor.

No tracker, Git or executor boundary is involved in slow-consumer handling.
A broken watcher does not stop delivery (S2). Closed denotes observation-source
closure, not Run success; terminal disposition requires separate accepted
termination evidence. Host crash may prevent delivery of Closed and is a
transport failure, not fabricated EOF success (S9). D24 and D29 apply.

### S9 — The actual host exits or dies after accepting a command

1. Start from S4 with Unpause durably appended, but kill the host before its
   callback. The transport disappears; the client reports outcome unknown.
   Do not persist a synthetic crash or treat the lost host as stopped executors.
2. Start Dalph separately again over the same repository and SQLite history.
   It reacquires coordinator ownership, establishes the same unfinished R, reads
   durable control and reconstructs the owner. Unpause restarts its timer without
   another control direction. Existing responsibilities keep exact Run/attempt,
   Base, worktree and executor correlations; ambiguous effects are checked at
   their owning boundaries before retry.
3. In a separate branch of the scenario, request graceful Exit through the
   existing host/supervisor boundary. New attached commands are refused after
   the cutoff. Already admitted work follows the existing bounded drain; report
   its actual success, failure or timeout, then finalize the host scope.

There is no uninterrupted-delivery guarantee across host death. Graceful Exit,
process death, observation Closed and durable Run termination remain different
facts. Assert no second beginning, blind Unpause, replacement attempt or unsafe
cleanup (D17, D21–D22, D29–D32a, D38–D40 and Exit invariants). A host scope cannot
promise command completion past its own shutdown; independent command ownership
protects against client loss only.

### S10 — A changing graph reaches task delivery but exposes a finality defect

Use the exact research shape rather than S1's graph: root A initially has no
blockers; capacity one; A's exact attempt is executing. Git/SQLite and delivery
are real production components with controlled GitHub/Codex boundaries.

1. GitHub now reports B and D grouped under A; B explicitly depends on C;
   C is terminal without success. The timer reads this complete four-task graph.
2. The attached client sees separate grouping and prerequisite edges. B and C
   cannot run. D may rank ahead of A, but A's retained responsibility occupies
   the only position. No second task executor begins.
3. GitHub makes D terminal without success. The first client exits; a replacement
   reads the four-task graph from the same Run. Release A and obtain its accepted
   result, real target promotion and confirmed tracker success.
4. Preserve the research's negative control: post-quiescence g10 depended on
   g1–g9, but later `WorkflowEstablishment` read g11 had no predecessors and
   changed A from open to successful. The journal rejects termination as causally
   incomparable and records zero `WorkflowRunTerminated` events.
5. Required milestone qualification adds a corrected production chronology in
   which the later complete facts have justified causal replacement evidence,
   all obligations settle and ordinary finality can classify this graph. With B
   still blocked by unsuccessful C and no cancellation, the expected disposition
   is `Blocked`, not `Completed`. Assert its actual accepted termination record.

Alice must see the typed `WorkflowRunTerminationEvidenceInvalid` failure until
step 5 is qualified; no wrapper may convert it to success. Preserve the causal
validator and the rejection test for genuinely incomparable evidence. Position
order, a reconnect, or a successful root task cannot manufacture comparability.
No crash or mutation retry is part of this reproduction. Step 5 is a required
correction, not evidence it exists; D23–D24 and D35 remain blocking requirements.

### S11 — A client names another Run, or no host is available

Starting override: Alice has either no running host (no command-created journal,
claim, worktree or executor), or the S1 host fixed to R. The client is configured
with an unavailable address, an incompatible protocol version, malformed input,
or a different requested Run X.

1. Connect and decode the handshake/request before invoking an operation.
2. Return `HostUnavailable`, `ProtocolVersionUnsupported`, `InvalidRequest`, or
   `RunMismatch` with the selected/requested Run identities as applicable.
3. Alice starts the host separately or corrects her client configuration. A
   retry connects afresh; it never allocates another Run or silently switches X
   to R. A root/target parameter on a control request is invalid.

These rejections call no workflow, tracker, Git or executor boundary and apply
no direction. No crash is required; host startup failure is handled by its
existing protocol. Exact identity and one-Run rules are D1 and D38–D40.

### S12 — Capacity is temporarily unavailable or the Run is terminal

1. Starting from S1, let the activation end while R remains unfinished. A client
   calls read/set capacity between active runtime leases. The first contract
   returns `RunInactive`; it does not activate R or synthesize a policy result.
2. Repeating a read is passive. A later deliberate set still carries the caller's
   expected revision. A start-work hint may request an ordinary activation if
   unpaused; it cannot guarantee an active capacity window or change Pause.
3. With accepted termination instead, commands report `RunClosed` when established
   from termination evidence; no command reopens R. A race not yet classified
   terminal may return the concrete inactive failure. Snapshots retain their
   actual lifecycle; a still-open source is not relabeled Closed just because
   termination is known. Once the source closes, watchers receive Closed then EOF.

Git, tracker and executor calls have no role in these capacity error results.
No crash occurs; loss of an applied set response follows S5. This deliberately
selects the existing active-runtime capacity limitation for the first boundary;
active-only capacity was not an interview requirement. D24, D39–D40 and D47
forbid invented application or revival.

## User Stories

1. As Alice, I want autonomous Dalph to keep delivering while I use an agent, so that the two ways of working coexist.
2. As Alice's agent, I want to connect to the already selected Run, so that I do not create duplicate delivery.
3. As Alice, I want a CLI reaching the same operations as MCP, so that either interface gives the same results.
4. As Alice's agent, I want the selected Run and root identity, so that I can reject a connection to the wrong work.
5. As Alice, I want tasks without executors visible, so that unstarted work is not hidden.
6. As Alice's agent, I want explicit blockers and grouping shown separately, so that I can understand eligibility.
7. As Alice, I want optional opaque executor associations, so that I can relate running work to tasks without requiring provider internals.
8. As Alice's agent, I want a passive coherent snapshot, so that inspection does not initiate work or mix observations.
9. As Alice, I want current-first updates, so that I can follow progress without rebuilding it from chat.
10. As Alice, I want unavailable and stale graphs distinguished, so that refresh does not look like task deletion.
11. As Alice's agent, I want to request ordinary work within the selected root, so that Dalph chooses eligible tasks.
12. As Alice, I want start work to preserve Pause, so that inspection or a general request cannot silently resume delivery.
13. As Alice's agent, I want explicit Unpause under my existing instructions, so that no extra human approval or handback is necessary.
14. As Alice's agent, I want to read capacity and its revision, so that I can submit an informed change.
15. As Alice, I want conflicting capacity changes reported with the current policy, so that another client's decision is not silently overwritten.
16. As Alice, I want capacity reduction to preserve running attempts, so that lowering the ceiling does not discard work.
17. As Alice's agent, I want to author tasks directly in the tracker, so that one system owns the task and blocker facts.
18. As Alice's agent, I want whole-graph or advisory-ID refresh hints, so that I can ask Dalph to check after edits.
19. As Alice, I want startup and scheduled discovery to continue, so that delivery does not depend on a remembered refresh call.
20. As Alice, I accept admission from a complete intermediate tracker state, so that multi-call editing needs no new publication protocol.
21. As Alice, I want incomplete tracker evidence to remain unresolved, so that missing pages do not erase blockers.
22. As Alice, I want delivery to survive the agent application's exit, so that client lifetime does not control task lifetime.
23. As Alice's replacement agent, I want current state without an earlier cursor or conversation, so that I can take over inspection.
24. As Alice, I want truthful lost-response results and safe revision conflicts, so that uncertainty does not duplicate or override commands.
25. As Alice, I want slow watchers released independently, so that observing progress does not stall delivery.
26. As Alice, I want host shutdown distinguished from Run completion, so that a closed connection never implies successful delivery.
27. As Alice, I want a graph-finality failure visible until corrected, so that successful task integration does not conceal invalid termination evidence.
28. As Alice, I want native worker access where its host supports it, so that this milestone does not require a new Dalph conversation protocol.

## Implementation Decisions

These define the specified boundary; they are not an implementation plan.

### Host and adapters

- Retain one separately started application host, one Run per repository and the
  existing single-root graph. The host owns the existing bootstrap, reactivation
  owner, runtime and coordinator lock. Adapters use those instances, never a
  second composition that happens to share storage.
- Select explicit local host addressing for the first connection contract.
  The host advertises a versioned selected-Run descriptor after successful Run
  establishment. Clients receive the address as configuration; connection does
  not auto-start, discover work, select another root or launch a daemon. A local
  HTTP bridge is the researched design precedent; exact address/command spelling
  and MCP resource naming are adapter details, not new product decisions.
  Remote hosting and a new authentication system are outside this contract.
- MCP and CLI decode into one application request/result algebra. CLI calls that
  host boundary directly rather than invoking MCP. MCP maps observation updates
  through its subscription facilities; CLI provides structured snapshot results
  and a watch stream. Both preserve current-first, coalescing, error and closure
  semantics. Transport message IDs are correlation only, not durable retries.
- An agent acts on the logical Operator's existing instructions. Preserve the
  current Operator actor class; do not invent authenticated identities or infer
  permission from parent/child conversation structure.

### Shared operations and result meaning

Names below identify application operations, not frozen CLI spellings. Every
operation after reading the host descriptor requires the exact selected RunId.
Failures retain safe diagnostic detail and known subject/position evidence.

| Operation | Input beyond RunId | Successful result and retry meaning |
| --- | --- | --- |
| Read snapshot | None | Actual `NotReady`, `Ready`, or `Closed` projection; passive and repeatable. |
| Watch snapshots | None | One current-first subscription; later complete states may coalesce. Reconnect reads current, without replay cursor. |
| Read Run control | None | Durable `RunPaused`, `RunUnpaused`, or `RunTerminated` from the existing bootstrap's journal-backed read. It is separate from runtime snapshot coherence and proves neither a past request identity nor callback completion. |
| Read capacity | None | Current capacity and revision when an active runtime lease exists; otherwise S12. |
| Set capacity | Capacity and expected revision | `CapacityApplied` with the complete accepted policy; conflict carries expected revision and complete current policy. Never retry with a refreshed revision automatically. |
| Start work / wake | None | `WakeSubmitted` after the host calls the ordinary owner hint. No claim of queued work, activation, authority read or Unpause. Repetition can coalesce and never changes Pause. |
| Unpause / Resume | None | `UnpauseApplied` with applied control ordinal and accepted journal position, returned only after the complete bootstrap callback path. Lost response is ambiguous; no automatic replay. |
| Refresh | Whole-graph interest or advisory task IDs | `RefreshSubmitted`, preserving the requested interest. Both forms submit the existing tracker-notification hint. Neither is a fetch scope, execution selector or read receipt. Repetition may coalesce. |

No task authoring, worker registration, arbitrary assignment, generic workflow
command, or client-triggered application Exit is added to this operation set.
Existing Run Pause and host Exit remain available through their existing owning
boundaries; a new remote Pause operation is not needed to prove Q27.

The host normalizes known malformed requests, Run mismatch, unavailable host,
unsupported version, closing host, inactive runtime, terminal Run, policy
conflict and command failure into distinct outcomes. A disconnected client with
no response reports unknown outcome, not a fabricated server rejection. When
known, `RunClosed` retains the terminal journal position. Hint results may remain
`Submitted` on a stopped-owner race and never imply effects; known termination
can be rejected before submission. No post-termination append is permitted.

### Command admission and interruption

Decode and verify Run identity before admission. Make accepting the command into
host ownership indivisible with starting its complete operation under the
existing application lifecycle cutoff. A client owns only its wait for the
result. A timeout, MCP cancellation, SIGTERM or broken client stdout after that
handoff does not cancel the accepted command. Protect the callback after journal
acceptance as well as storage/publication; protecting append alone is inadequate.
Host Exit still uses the existing drain and does not promise all commands finish.
If a callback fails after durable application, return that distinct partial
completion failure with the known accepted position; never report rollback or
`UnpauseApplied`. Present durable control and live progress separately. A wake
is not a repair for a missed callback, and no failure handler blindly reapplies
Unpause. Extend S4 with this fault and assert the durable direction survives
while callback completion remains unproved.

Do not add durable command receipts merely to acknowledge hints. Read Run control
and capacity for present facts after uncertainty, without pretending these reads
recover a lost Unpause's unique result. No automatic policy overwrite follows a
read. Within a live host, competing controls follow the existing serialized
journal/control rules; adapter arrival order is not durable ordering evidence.

### Observation and slow-client contract

Each snapshot projects a single runtime publication: Run identity, accepted
journal position when present, graph availability, normalized tasks and separate
prerequisite/grouping relationships, frontier, delivery status and optional exact
attempt/opaque executor association. Keep desired placement and retained execution
responsibility separate. Do not expose provider transcripts, fibers, controllers
or executor-internal stages.

Use tagged alternatives for `NotReady`, established versus unavailable graph,
and `Closed` with or without a retained final publication. Preserve conflicts
and evidence limitations. Any last-known UI graph is explicitly stale,
process-local presentation memory. A termination result read from its separate
source is labeled separately, never spliced into a supposedly atomic snapshot.

Select latest-state delivery for public watches, not loss-free history. Preserve
the initial attachment value; retain at most one pending latest complete state
at the adapter stage plus a currently written frame. Closed supersedes pending
ordinary state and precedes normal EOF. Use a documented finite write deadline
and close the exact stalled subscription when it expires. The implementation
must select and expose finite frame-size and subscription limits and test their
rejection outcomes before claiming bounded transport resources; exceeding a
limit is a typed observation failure, never a truncated graph presented as
complete. No global memory bound is claimed from this design: the existing
internal SubscriptionRef retains an unbounded queue. Qualification must account
for that upstream retention and prove release on disconnect. A one-value sliding
buffer alone does not settle the resource question.

Normal host shutdown must keep observation delivery alive long enough to publish
Closed and finish writable subscribers, within the existing lifecycle budget.
It may fail slow connections instead of extending that budget. Abrupt host death
cannot guarantee a final frame. A terminal Run and a closed signal are separate;
only accepted termination evidence supports a disposition.

### Authority, types and compatibility

Use idiomatic Effect V4 services, scoped ownership and Schema decoding at the
boundary. Retain distinct branded Run/task/attempt identities, capacities,
policy revisions, control ordinals, journal positions and local addresses.
Document the concrete phenomenon at each new branded type and non-obvious event.
No new domain event is required for passive reads, connections, wake queues,
watch positions, client death or transport receipt.

Tracker owns task identity, lifecycle, dependencies, grouping and claims. Git owns
lineage, commits, refs, worktrees and integration facts. Execution substrate owns
process/session evidence, exposed through the opaque executor boundary. Journal
owns accepted workflow history. Do not persist a graph, frontier, occupancy map
or UI state as another authority. Preserve one exact worktree and planned Base
per attempt, bounded admission, intent/observation ordering, reconciliation before
ambiguous retry and exact disposition-typed cleanup. Dry-run, tests and production
continue interpreting the same workflow algebra.

## Testing Decisions

### Main acceptance seam and prior art

Prefer one production-host composition with real Git, SQLite, coordinator,
workflow, executor and integrator adapters, replacing only GitHub/Codex provider
edges with controlled Layers. Exercise actual MCP child processes and the public
attached CLI against that host. Assert outside calls, exact identities, journal
facts, visible frames, process exit and forbidden effects. Do not assert private
helper order or treat coverage totals as the scenario evidence.

Reuse the [MCP-host composition](../../research/invokee-mcp-host-results.md),
[graph stream](../../research/invokee-graph-stream-results.md) and
[changing graph](../../research/invokee-changing-graph-results.md) fixture shapes.
Existing production-host, delivery-status, task-work-capacity and reactivation
owner tests supply prior art for fixed Run selection, passive reads, revision
conflicts, coalescing and Pause. These sources do not already implement the new
public boundary.

Use focused lower seams only where the main fixture cannot distinguish the cut:
real SQLite plus live Journal/bootstrap/owner for S4–S5/S9, and a controlled
CurrentSignal plus gated transport writer for S1/S8. Use Deferred gates and
controlled clocks rather than real sleeps. Test the actual callback and final
Closed payload. Memory storage cannot stand in for INSERT/COMMIT interruption.
No live provider mutations or bulk live tests are needed for these scenarios.

### Scenario-to-test mapping

All names in the required-test column are tests the eventual implementation must
add or adapt; none are claimed executed by this specification task.

| Scenario | Required acceptance test and decisive assertions | Existing evidence and limitation |
| --- | --- | --- |
| S1 | `Alice and two clients observe one Run without starting work`: same descriptor; coherent current-first graph, tasks with/without executors; update at attachment cut; zero read-caused writes/authority calls; one host. | Graph-stream and passive delivery-status tests qualify mechanisms; supported DTO, executor association and both adapter projections remain unproved. |
| S2 | `MCP and CLI exit while the original host completes delivery`: verify both client exits, zero Exit calls and no released responsibility; reconnect same R; real promotion/confirmation and dispositions. | MCP-host probe proves actual capacity and unchanged one-task completion through disposable MCP replacement; public attached CLI is unbuilt. |
| S3 | `Agent raises and lowers capacity without replacing running attempts`: accepted revisions, actual B admission, C blocked, exact plans/worktrees, no preemptive contraction. | Existing capacity/admission tests; changed-graph probe proves retained A but deliberately does not prove D later starts. |
| S4 | `Start work preserves Pause and disconnected Unpause reaches the owner once`: no wake/refresh override; each SQLite cut; one ordinal/callback, timer restart, ordinary activation and safe resumption checks; callback failure retains durable application without claiming full completion. | Recovery probe qualifies real owner with controlled activation; full public host command ownership remains to implement. |
| S5 | `Two clients preserve control decisions after races and lost responses`: one capacity winner, full conflict, exact retry no extra record; unknown pre-admission cut; no blind Unpause over intervening Pause. | Interruption probe covers SQLite cuts and harmful Unpause replay; adapter cancellation/races need public qualification. |
| S6 | `Tracker edits appear through hints or timer without selecting IDs`: direct fixture authority edits; complete qualified read; E blocker visible; no hint payload facts; startup without refresh; paused/idle/active/coalesced/terminal hint cases; full A/B/E-to-C delivery and accepted Completed after S10 correction. | Operation research establishes state-dependent limits; changing-graph probe proves active timer discovery, not correlated refresh completion. |
| S7 | `Complete intermediate edits permit admission while incomplete evidence does not`: admitted D before later authored blocker; separate missing-page rejection; unavailable graph distinct from deletion and stale display. | Q17 is accepted behavior; active graph experiment does not exercise D's pre-blocker admission. Required dedicated interleaving is not optional. |
| S8 | `Slow watchers coalesce or disconnect and never invent completion`: same-position updates, exact current/latest/Closed, blocked writer deadline, upstream subscription release, limit rejection and reconnect; failure rather than normal EOF if Closed cannot be sent. | Sliding probe proves only a bounded stage with controlled values; public backpressure, shutdown ordering and upstream resource behavior remain gaps. |
| S9 | `Host loss reconstructs durable Unpause and exact work without retry`: process cut between append/callback, same R and ordinal count, fresh owner activates; graceful Exit refuses later commands and preserves uncertain work. | Fresh-owner recovery tested in a scoped composition; actual host process cut and new command admission/Exit race remain to qualify. |
| S10 negative | `Incomparable changed graph evidence rejects Run termination`: retain g10/g11 provenance, typed failure and zero terminal records despite promotion/confirmation. | The changing-graph probe already reproduces this failure; its passing test is not successful Run settlement. |
| S10 correction | `Changed graph settles with justified causal evidence and Blocked disposition`: validate replacement evidence through unchanged validator, settle obligations, record actual Blocked; retain independent negative control. | No corrected production evidence exists. Blocks complete milestone qualification; cannot be waived by changing a test expectation. |
| S11 | `Unavailable host and wrong Run cause no workflow effects`: all decoding/address/version/identity failures, no auto-start or root replacement, zero outside calls. | Existing fixed-Run checks are prior art; supported connection/decoding contract remains unbuilt. |
| S12 | `Inactive capacity is explicit and a terminal Run never reopens`: read/set lease failures, no implicit activation, terminal normalization with known position, actual snapshot lifecycle, no terminal append. | Source-only inactive/terminal matrix; active-only behavior is this spec's limited boundary choice, not a passed product test. |

### Qualification boundary

Do not promote the research probes into maintained acceptance evidence by renaming
them. Preserve their recorded prerequisites and controlled-provider limitations.
Keep the minimal one-task completion case and the complete changing-graph story;
a successful prefix cannot replace the latter's required finality suffix.

Production command exposure, full-command ownership, supported MCP/CLI parity,
projection encoding, inactive/terminal behavior, slow-client limits, shutdown
ordering and corrected changing-graph finality all need implementation evidence.
The remaining concrete adapter limits and encodings must be recorded with their
chronological scenario tests before implementing the affected boundary; until
then those boundary implementations remain blocked by the operational scenario
gate. This is a named technical contract gap, not a deferred documentation chore. No product interview
needs reopening to choose these technical details.

This spec changes no Quint model. A future behavior change governed by a model
must follow the Quint guide and retain reachability/negative controls; model
success cannot prove unmodeled transport or concrete causal-history behavior.
Implementation handoff must map every row above to passing evidence and preserve
all blocking outcomes, in addition to required repository checks. No such
implementation handoff or gate claim is made here.

## Out of Scope

- Implementation-ticket breakdown, implementation, live delivery-provider
  mutation, commits into master or other integration as part of this
  specification task. Publishing this one specification issue is authorized.
- Arbitrary task or task-set selection: outside the plan, not a later backlog
  commitment. Advisory refresh IDs do not reintroduce it.
- Multiple independent simultaneous Runs per repository, automatic background
  startup, a process manager, remote deployment/authentication or multiple
  authenticated Operator identities.
- Caller-selected executors, external worker launch/registration/adoption/report/
  release protocols, worker leases, or provider-internal helper graphs.
- Dalph-authored tracker edit transactions, plan publication receipts, mandatory
  readiness labels/barriers, parent approval or recursive credentials.
- Custom parent/child chat, handback, message routing, exclusive manual checkout
  takeover or a new native interaction standard.
- Durable observation replay/cursors, a loss-free public event stream, guaranteed
  synchronous refresh completion, inactive journal-backed capacity extensions,
  or new remote controls beyond the listed first-milestone operations.
- Recursive unfinished-attempt yielding and partial-work disposition in this
  milestone. Q24 remains accepted later core work in the current planned set,
  including autonomous use; it is not discarded or turned into tickets here.

## Further Notes

### Decision provenance and validation gaps

Read [the handoff](../../research/FRESH-SESSION-HANDOFF.md) in its stated order.
The [interview](../../research/invoker-invokee-interview.md),
[first milestone](../../research/invokee-first-milestone.md),
[readiness audit](../../research/invokee-spec-readiness-audit.md),
[operation research](../../research/invokee-operation-contract-research.md) and
[research conclusion](../../research/invokee-research-conclusion.md) are the
provenance. Later interview answers override earlier proposals, especially Q17
(intermediate edits), Q22 (separate startup), Q25–Q26 (managed executors, rooted
scope, no arbitrary selection) and Q27 (start preserves Pause).

The host-ownership recommendation, combined projection, advisory refresh results,
explicit inactive-capacity failure and latest-state watch policy are technical
choices made explicit here. The interview did not select their wire schemas or
prove them. Historical sources call some records active interviews or research;
this spec does not rewrite that provenance.

The [interruption](../../research/invokee-command-interruption-results.md) and
[recovery](../../research/invokee-command-recovery-results.md) records distinguish
SQLite persistence, accepted publication and owner callback. Research did not
execute the inverse missed-Pause callback case; its source inference is extra
local activations, not proven fresh work despite durable Pause. Nor did it
instrument an internal SQLite mid-COMMIT cut.

The [external-worker research](../../research/invokee-external-worker-participation.md)
remains a separate track. Admission before launch can enforce a bound;
registration afterward cannot establish it retroactively. Missing reports,
client exit and expired leases never prove stopped writers or authorize capacity
release/cleanup. Keep exact opaque attempt correlation compatible with that later
work without inventing its protocol now.

Native human interaction remains conditional on the worker host's capabilities;
no universal direct conversation or exclusive editing guarantee is inferred.
For later recursive yielding, new blockers alone do not end an attempt. Exact
stopped-execution evidence, partial Git work disposition and a permitted successor
attempt need their own chronology. The original immutable Base/worktree cannot
silently become that successor.

### Specification review and checks

The domain/spec pass checked the final scope against Q17 and Q22–Q27 and kept
external workers and recursive yielding distinct from this milestone. The
architecture/connascence pass checked one host-owned operation algebra, authority
ownership, non-preemptive capacity and snapshot coherence. The correctness and
acceptance pass added the successful A/B/E-to-C finality suffix, distinguished
callback failure after durable application, and made unresolved adapter limits
an explicit implementation gate. A follow-up pass checked these corrections
against the scenario-to-test table; no scoped finding was rejected or waived.

Documentation verification checks local links/headings, whitespace and the
scenario-to-test census. Runtime tests, `pnpm check:all` and `pnpm check:quint`
are not run for this prose-only change: no executable, model or configuration
input changes, and this is not implementation handoff or integration. Required
future tests above remain unrun. The documentation check policy is in
[Development: choosing checks](../DEVELOPMENT.md#choosing-checks).
