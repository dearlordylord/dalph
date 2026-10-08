# Executor proposals and planner-reviewed task decomposition

Status: **proposed, awaiting maintainer acceptance**. This is the scenario draft
for [#484](https://github.com/dearlordylord/dalph/issues/484), under [parent
#421](https://github.com/dearlordylord/dalph/issues/421). Reviewing or
completing this documentation task does not accept this design or authorize
implementation. No implementation tickets are created by this proposal.

The executor suggests a split to a planner; the planner reviews an exact
revision; an authorized publisher authors tracker tasks and relations; Dalph
subsequently reads those tasks through its ordinary graph boundary. The proposed
publisher protocol below is new design, not an existing Dalph capability.

## Evidence and preserved boundaries

This draft consumes the completed [boundary research](../../research/planner-reviewed-task-decomposition.md), including its pinned Choir source and
alternatives. Research inspected `ab7f6b6e2a5090959ea52bf379e8c2f9fc7d336b`; the
prerequisite draft's immutable planned Base was
`50a55341a826631755d7d845f829030044cdb848`. The source review uses planned Base
`d6b703c75d4a18a9b31bf7aceb7a20f8d9fb370b`. The research's exact source
inventory establishes existing contracts, not proof of this proposal.

When choosing publication order, preserve [complete intermediate tracker
edits](../scenarios/intermediate-tracker-edits.md#a-complete-intermediate-edit-admits-d): Dalph can admit an open grouped child before a later blocker arrives.
Missing pages are not complete empty blockers. Preserve [D9](../DELIVERY-INVARIANTS.md#graph-and-selection) and [D12–D16](../DELIVERY-INVARIANTS.md#admission-and-capacity), with `latestPolicyControlsAdmission` and
`everyDurableRetainedAttemptHasExactPosition` in
[runActivation](../../specs/runActivation.qnt). These laws constrain existing
admission; they do not model the proposed publication protocol.

When changing parent instructions, preserve [changed-attempt
choices](../scenarios/reconcile-changed-task-facts.md#alice-changes-as-instructions-while-its-planned-attempt-is-running), [exact attempt
identity](../DELIVERY-INVARIANTS.md#identity), and [durable
planning](../ARCHITECTURE.md#durable-task-attempt-planning). A split cannot
rewrite an attempt's revision, Base, branch, worktree, or executor locator.
`Accepted` remains an executor result with a commit, not split approval, tracker
success, or parent completion. An advisory artifact uses no new executor
terminal variant.

When stopping publication exposure, use the existing [whole-Run
Pause](../scenarios/pause-whole-run.md) and [observed safe
boundaries](../scenarios/observe-pause-progress.md). Pause request receipt is
insufficient. No mandatory Pause rule is added to the canonical intermediate-
edit scenario; this proposal chooses it for its own stronger publication
promise. Existing `runActivation` controls remain governing; new publication
safety needs future tests rather than claimed formal coverage.

When recovering an unknown mutation, preserve [journal intent and
readback](../architecture/journal-and-reconstruction.md#intent-observation-and-retry), [tracker observation coverage](../architecture/tracker-graph-and-claims.md), and [D23](../DELIVERY-INVARIANTS.md#ambiguity-and-evidence). Claim
reconciliation is precedent, not evidence that issue creation is idempotent. The
current claim mutation service does not supply the proposed child-authoring
seam.

Only the Markdown proposal and its research review appendix change. It is not
loaded by runtime, adds no workflow operation or model, and changes neither the
accepted glossary/ADRs nor [protected
compositions](../ARCHITECTURE.md#protected-compositions). Prose cannot change
runtime admission, executor reports, tracker mutations, or retry policy.

## Proposed actors, identities, and authority

All new terms here are local proposal vocabulary, pending maintainer acceptance.

| Actor or boundary | Proposed responsibility and explicit limit |
| --- | --- |
| Executor | Emits an immutable advisory artifact from one exact planned attempt. Its private sessions remain opaque. It cannot approve the split, create children, release claims, or declare itself safely stopped through the artifact. |
| Planner | Reviews scope, chronological acceptance stories, dependencies, shared surfaces, and residual parent work. Records approve/reject/revise for an exact proposal revision. It is a proposed logical role, not an authenticated identity added to the existing Operator. |
| Maintainer/Operator | Maintainer delegates review and tracker authoring explicitly. Existing Operator controls Pause, Unpause, and exact Continue/Restart/Stop choices. Planner approval alone grants none of these controls. |
| Authorized publisher | A proposed external serialized authoring actor, outside the paused Run's forward-progress workflow and separate from pure delivery planning. Records intent before each tracker effect and observes it afterward. Graph-write credentials and maintainer authorization are separate from task claims. |
| Tracker | Owns actual TaskIds, instructions, lifecycle, grouping, dependency edges, membership and claims. A proposal's child key never substitutes for a tracker TaskId. |
| Git and executor/substrate | Git owns commits, refs, worktrees and integration. Executor owns exact-attempt reports; its substrate owns sessions/processes. Neither a journal entry nor coordinator disappearance proves stopped writers. |
| Journal and evidence store | Journal owns immutable proposal/review/publication occurrences, intents and observations; immutable artifact bytes may live in the evidence store. Neither stores a second authoritative task graph, derived admission frontier, resource inventory, or UI state. |

An executor submission names its originating Run, parent TaskId, AttemptId,
planned TaskRevision, and artifact digest. Proposed transport request identity
is scoped to that Run and parent: redelivery of the same request must carry
identical bytes. Different bytes under the same request identity are a conflict,
not an update. Allocation happens in an action/receipt boundary, never pure
planning.

A proposal identity groups one review conversation. Its immutable numbered
revisions have distinct digests and explicit predecessor links. A revised split
uses a new request identity; identical contents sent under a different request
are a separate proposal unless explicitly attached by the planner. Content
similarity never authorizes merging independently submitted requests.

Each revision contains starting instruction fingerprint, separately observed
lifecycle/grouping/dependency/claim evidence, originating exact plan, children
with stable revision-local keys and full instructions/acceptance stories,
explicit grouping and prerequisite edges, shared-interface ownership, residual
parent scope, mutation order, and publication/recovery limits. The fingerprint
covers title/body only; it is not a transactional graph version.

A review decision names proposal/revision/digest and the fresh observations it
reviewed. Approval is permission for that exact manifest, not a reusable token
for later revisions. Journal append responses lost during submission or review
are reconciled by exact history lookup before another append. Planner rejection
is not executor failure. Publication operation identities bind revision, child
key or exact edge endpoints, and intended mutation; tracker-assigned identities
are recorded only after authoritative observation.

## Proposed publication profile

The recommended candidate is an external-publisher hybrid of research A/B, not
research B's Dalph-owned workflow boundary. It is reviewed, serialized
publication with an explicitly acknowledged whole-Run Pause. This trades
interruption of independent work for an understandable partial-publication
boundary. It needs acceptance and new contracts before automation. External
manual authorship remains an alternative.

The publisher is an external author, not a Run workflow operation exempted from
Pause. Its proposed receipt/review/authoring history needs a separately accepted
journal scope and ownership contract; it must not append new forward-progress
operations to the paused Run or alter its protected planning composition. Reads
and tracker edits below are publisher calls. Ordinary Dalph remains passively
paused and promises no polling. This separation is an explicit design decision,
not a currently available authoring API.

1. Read parent instructions, lifecycle, grouping, dependencies and claims through
   the tracker; inspect exact retained attempts through existing executor/Git
   boundaries. Review all facts separately, without inventing a graph-wide CAS.
2. Obtain Operator Run Pause and observe its safe-boundary confirmation. Resolve
   already admitted work and ambiguities; retain exact claims/resources. Do not
   publish if another coordinator/Run or external worker can admit these tasks
   without the same agreed hold. Pause is local to a Run, not a tracker lock.
3. Serialize publication for the parent and shared surfaces in the authorized
   coordinator scope. Record the exact approved manifest and authorization.
   Revalidate before each effect. Cross-process or external author contention
   fails closed unless a separately accepted fencing contract can prove exclusion.
4. Create children, read back exact identities/content, add explicit native
   prerequisites and grouping, and add children as blockers of the residual
   parent. For example, interface task I precedes implementation C and D;
   C and D both block parent P's final coherence work. I, C and D are grouped
   under P. P must not block I/C/D: that would create a cycle.
5. Reconcile every mutation separately. Obtain a fresh complete closure and
   focused instruction reads proving the approved contents and all intended
   edges, lifecycle and membership. Bare acknowledgements prove no eligibility.
   Edit P's residual instructions only after S8 proves exact A safely suspended.
   The publisher readback is not a Run-journal changed-instruction observation.
6. Record established publication history. Operator explicitly Unpauses only
   after publication intents/conflicts are resolved and the parent has a proven
   safe report. P's fresh complete blockers must prevent old A from resuming.
   After Unpause, ordinary focused reads establish the changed revision in the
   Run journal; only then can Operator apply an exact choice. Replacement waits
   for P eligibility and atomically settles A while planning its successor;
   predecessor cleanup is separately authorized, never a replacement prerequisite.
   Dalph's ordinary reads, claims, plans, Base selection, execution, integration
   and finality then apply. Child attempts get their own exact worktree and
   planned Base; no parent's worktree or plan is reused.

Partial children may be visible in the tracker while held. No claim of atomic
tracker visibility is made. Removing grouping, using a label, leaving a child
outside the root, or making a cycle is not a substitute hold: other prerequisite
paths can expose it. Whole-Run Pause prevents this Run's forward admissions; it
cannot prevent other actors. Unknown concurrent writers invalidate the strong
no-early-execution promise and stop publication.

Issue creation needs an exact operation marker in its initial tracker payload
and a readback contract that distinguishes one matching child, conflicting
matches, conclusive non-application, and unknown. A search returning zero issues
is not conclusive absence when indexing can lag or the original request can
still apply. Without a provider idempotency guarantee or authoritative proof
that the original request cannot later apply, do not automatically retry create.
Keep Pause and report the unresolved operation for reconciliation. This
deliberate availability limit is part of the candidate, not an assertion about
GitHub APIs.

Recovery resumes a verified prefix; it does not roll back by deleting tasks.
Foreign edits, claimed/executing children, or changed approval requirements stop
repair and demand fresh review. A revised manifest must explicitly adopt
observed partial tasks by TaskId and revalidate their content; it cannot create
replacements blindly. Throttled mutations are retained and reported, never
retried automatically.

## Chronological proposed scenarios

All scenarios below are proposed acceptance obligations, not implemented tests.
Each names the people/system actors and its own seam. S1 defines the normal
publication sequence; later scenarios name the exact point where it stops or
changes. No live-provider qualification or cassette is claimed to exist here.

The maintainer observes every scenario; Operator controls and authorized
publisher calls are distinct actors throughout. Unless a scenario explicitly
changes them, S2–S9 inherit S1's exact parent attempt/claim/Git resources and
absence of child attempts before publication; S10 states its already-planned
child exception. All publishing scenarios require current exact claim
observations for affected retained tasks and unclaimed proposed children.
Foreign, missing or unreadable retained claims follow [claim
reconciliation](../scenarios/reconcile-task-claims.md), never publisher
release/reacquisition. No proposal reserves child claims. S7's different-parent
case inherits each parent's own exact resources independently.

When application Exit or host loss interrupts any scenario, preserve [graceful
Exit](../scenarios/graceful-application-exit.md) and [cleanup during
Exit](../scenarios/cleanup-dispositions-during-application-exit.md); S12
supplies the proposed external-publisher composition. When disposing any
retained resource, preserve [exact cleanup](../scenarios/disposition-cleanup.md)
and D16–D17 in [preservation invariants](../DELIVERY-INVARIANTS.md#preservation). Publication/rejection does no resource cleanup;
adopting an existing tracker child is a tracker readback, not a Git resource
disposition. Current models prove no external-publisher Exit or fencing
contract.

### S1 — Executor suggests a split; planner approves; children enter ordinary delivery

**Starting facts.** Parent P is open in one established Run. Its exact attempt A
is executing in worktree W at Base B under its owned claim. Tracker has no
I/C/D. No publication history exists. Operator and planner are explicitly
available.

**Trigger and ordered calls.** Executor submits artifact Q1 recommending I/C/D
and residual P coherence. Receipt records Q1; planner reads tracker facts and
exact A report, then records review approval. Operator requests Run Pause; Dalph
records controls, asks executor to suspend A and observes safe boundaries.
Publisher then performs steps 3–5 above: journal intent, tracker create I, exact
readback, observation; likewise C and D; intent/mutation/readback for C→I and
D→I prerequisites, P grouping, and P→C/P→D blockers. Parent residual
instructions and the post-Unpause exact A choice/replacement follow S8. Complete
graph/specification readback precedes publication observation and explicit
Unpause. Ordinary Dalph delivers I, then C/D when tracker success releases them,
then residual P.

**Visible and forbidden outcomes.** Maintainer sees Q1 approval, partial tracker
records during Pause, then the intended graph. I owns the shared contract; C and
D have disjoint responsibilities. Grouping does not imply dependency. No child
runs before readback/unpause, approval does not complete P, and no plan is
copied from A. P succeeds only through ordinary residual delivery/finality.

**Crashes/retries.** Submission/review append ambiguity follows S3. Every
mutation cut follows S4/S5; final observation/Unpause cuts follow S6. No extra
retry is permitted by normal-path approval.

**Proposed test mapping.** T1 composes receipt, review, Pause, publisher,
tracker and ordinary activation. Assert exact call ordering and absence of Begin
while held; establish one TaskId per key, separate grouping/blocker sets, fresh
readback before Unpause, and tracker-success-only release through I→C/D→P.

### S2 — Planner rejects, then executor submits revised scope

**Starting facts.** Q1 is recorded for executing A, but has conflicting shared
ownership or incomplete child acceptance stories. No approval or mutation
exists.

**Trigger and ordered calls.** Planner reads Q1 and current parent facts,
records rejection with reasons, and returns it. Executor submits Q2 with
predecessor Q1, new request/revision/digest and one shared owner. Receipt
records Q2; planner rereads tracker facts and reviews Q2. Only Q2 approval can
enter S1.

**Visible and forbidden outcomes.** Maintainer sees rejected Q1 and separately
reviewable Q2. Rejection leaves P's attempt and normal work unchanged; it cannot
close P, fail A, create tasks, or silently replace an approval.

**Crashes/retries.** Crash before durable decision leaves pending review; after
append but before response, read history and redeliver that exact decision. No
tracker mutation retry applies because none was authorized.

**Proposed test mapping.** T2 at receipt/review/journal seams asserts rejection
reasons, revision binding, no publisher calls and preservation of A; approve Q2
and prove a delayed Q1 approval request cannot publish Q2.

### S3 — Duplicate submission or approval response is redelivered

**Starting facts.** Q1's receipt or approval was appended, response was lost;
publication may already have recorded child I's identity. Client retained the
original request bytes.

**Trigger and ordered calls.** Client redelivers the request. Receipt reads
exact history and compares subject/digest. It returns the recorded result for
equal bytes, rejects conflicting bytes under the same request identity, and
routes any unfinished publication to readback of its original operations.
Approval delivery performs the same exact decision lookup; it never creates a
second publication.

**Visible and forbidden outcomes.** One review conversation and one publication
history remain. Different request identity with similar content remains a
separate proposal subject to S7, not permission to create duplicate children.

**Crashes/retries.** Before receipt append, no tracker effect is allowed. After
append before reply, exact history proves receipt. A journal read failure keeps
the response unresolved; no new append/create is inferred from missing memory.

**Proposed test mapping.** T3 injects lost append/reply at receipt and review;
assert one durable receipt/decision, same result on equal redelivery, conflict
on changed bytes, and zero additional tracker creates after duplicate approval.

### S4 — Publisher crashes after the first created task or loses its response

**Starting facts.** Q1 is approved; Run Pause is confirmed. I creation is next,
with no established tracker identity for its child key.

**Trigger and ordered calls.** Publisher records exact create intent, waits for
acknowledgement, then calls tracker with that operation's initial marker. Inject
crash (a) before intent, (b) after intent before call, (c) after provider
applies but before response, or (d) after response before observation append. On
restart, read journal, re-establish current Pause/exclusion, read exact tracker
result and original request status before choosing any continuation. If the
crash follows observed I creation but precedes C creation, verify I and the
unresolved-operation inventory before creating only the missing suffix. One
exact matching I is adopted and observed; conflicts or unreadability retain the
intent. Even case (b) requires reconciliation because persisted intent alone
cannot prove no call.

**Visible and forbidden outcomes.** Maintainer sees verified I or an unresolved
creation, never a fabricated success. No duplicate I, no speculative
replacement, no Unpause, and no inference that timeout means non-application.

**Crashes/retries.** Case (a) can start normally after current authorization
checks. Cases (b)–(d) reuse the original identity. Only authoritative non-
application with proof no late application is possible, or accepted provider
idempotency, permits the same create again. Zero search matches without such
proof leaves publication blocked. Throttle reports stop without automatic
mutation retry.

**Proposed test mapping.** T4 at publisher/journal/controlled tracker seams cuts
each prefix, simulates applied-but-lost response and delayed
indexing/application; assert intent precedes call, readback precedes any retry,
one I, and retained hold for absent-but-inconclusive, conflicting, unreadable
and throttled outcomes.

### S5 — Some children and edges exist; later edge mutation fails

**Starting facts.** I/C/D exist and have exact observed identities. C→I is
observed; D→I is intended but its response is lost. Grouping or parent blockers
may be incomplete. Run remains paused and no child has begun.

**Trigger and ordered calls.** Restart reads the publication prefix, validates
current Pause/exclusion, then reads D's complete blocker relation and current
child specifications/grouping/claims. If exact D→I exists, record its
observation; if authoritatively absent and the old request cannot later apply,
authorize the same edge mutation and readback. Revalidate before adding the
remaining edges. Unexpected edits/claims stop with conflict. Final complete
graph proof follows S1.

**Visible and forbidden outcomes.** Tracker can show partial grouped or
ungrouped children; status explains the failed edge and retained Pause. No
deletion of created tasks, no released children from incomplete blockers, no
foreign-edge removal, and no claim that all edges applied from one successful
response.

**Crashes/retries.** Cut before/after each edge effect and observation.
Reconcile exact endpoints/relation before retry; create operations are not
repeated. An ambiguous failed remainder stays held. Revised repair requires
S2/S9 approval explicitly adopting the observed prefix.

**Proposed test mapping.** T5 cuts create/grouping/blocker boundaries, including
a child without grouping and grouping before blockers. Assert ordinary
activation makes no Begin under Pause, verified prefix reuse, relation-specific
reads, foreign-record preservation and no destructive compensation.

### S6 — Full tracker publication exists but completion acknowledgement is lost

**Starting facts.** All Q1 tasks and edges exist under Pause. Final graph-read
or publication-observation response is lost. No confirmed Unpause result exists.

**Trigger and ordered calls.** Restart reads exact journal history and tracker
closure/specifications, verifies all intended facts and current controls, and
records only the missing established observation. Operator then issues an exact
Unpause request. If its response is lost, reconcile existing control history and
current applied direction through the accepted control protocol.

**Visible and forbidden outcomes.** Maintainer sees either held publication
awaiting proof or ordinary deliveries already admitted after a proven Unpause.
Do not create tasks again, replay a stale Unpause over a newer Operator Pause,
or manufacture child completion from publication history.

**Crashes/retries.** Crash after full read before append repeats the read; crash
after append before reply looks up the append. Crash after Unpause may leave
children executing: observe their exact ordinary obligations, never begin them
again or force them back into publication holding.

**Proposed test mapping.** T6 cuts final read/append/Unpause boundaries;
combines publisher history with control and ordinary activation seams to assert
one graph, no repeated mutation, newer Pause preservation and exact retained
child attempts.

### S7 — Two executors or planners propose conflicting splits concurrently

**Starting facts.** Q and R are distinct proposals for P, or different parents
sharing interface S. Neither has publication authority. Both may pass local
review.

**Trigger and ordered calls.** Planners record review results against exact
revisions. Authorized coordinator serializes publication admission by parent and
explicit shared surface; rereads current facts and earlier publication history.
The first admitted manifest can proceed under Pause. The other is held for a
fresh review that explicitly adopts existing tasks or rejects the overlap. A
second process/Run or external publisher without proved exclusion stops both
strong-profile publication admissions rather than relying on a parent claim.

**Visible and forbidden outcomes.** Maintainer sees competing proposals and
which manifest is authorized. No automatic union, duplicate shared owner, graph
write under a task claim alone, or promise of distributed exclusivity from a
process-local mutex. Independent non-overlapping proposals may continue only
when their own controls and exclusion requirements are proved.

**Crashes/retries.** Coordinator loss requires re-establishment of ordinary
ownership and reconciliation of admitted publication intents before another
manifest enters. Lost approval follows S3; ambiguous first mutation follows S4.
No tracker rollback or attempt cleanup applies to a proposal not admitted.

**Proposed test mapping.** T7 races review/publication admission using
controlled coordination; assert one admitted overlapping manifest, correct
revision binding, retained ambiguous prefix, cross-Run refusal and no child
creation by the loser.

### S8 — Parent is executing when the planner approves residual work

**Starting facts.** P's A is executing with original instructions, Base B, WIP,
claim and exact worktree. Approved Q1 would narrow P to coherence after C/D.
Adding blockers alone would leave A executing.

**Trigger and ordered calls.** Operator applies Run Pause; Dalph asks the
executor to suspend exact A and obtains its normalized safe report. Publisher
reads current P/Git/claim facts, records intent, edits P's instructions to the
reviewed residual scope, and reads the new fingerprint. Publisher records that
readback only in its authoring history; it cannot manufacture a Run-journal
instruction observation or apply Restart from it. After final graph proof,
Operator Unpauses. Ordinary Dalph reads current complete blockers and focused
instructions, records F2 in its Run journal, and exposes the exact F1/F2 choice.
A remains safely suspended: P's unfinished C/D blockers prohibit Resume even
before that choice is applied. Operator then explicitly chooses Restart for the
recorded pair. Applied Restart may wait while C/D execute and complete; it does
not immediately plan a successor. Once fresh tracker facts prove P eligible,
exact claim/Git reads authorize the ordinary atomic `PlannedAttemptReplaced`: A
ceases to be unsettled in the same record that plans successor A2. A2 gets its
own branch/worktree and ordinary current Base. A's old WIP/worktree remain
preserved. P's exact task claim is retained for ordinary successor coordination;
it is not an old-attempt claim that the publisher may release. Replacement
deletes neither resources nor the claim. Any later cleanup requires its own
exact disposition.

 **Visible and forbidden outcomes.** Maintainer sees preserved A/WIP, new
residual instructions and the exact choice required. Continue is not this
profile's handoff: choosing Continue requires replanning the residual overlap;
unfinished blockers still prohibit Resume. No further publication repair is
authorized meanwhile. Stop does not imply residual P success; it requires a
revised disposition/review. No hidden suspension from new blockers, no forced
cleanup, and no successor while old ownership or writers remain ambiguous.

**Crashes/retries.** Crash during suspension/edit/choice/cleanup uses those
exact ordinary protocols and current owning seams. Absent executor projection or
host loss retains A fail-closed. If A became terminal or integration crossed its
cutoff before Pause confirmation, finish/reconcile that existing responsibility
and review the split again against its actual result; do not rewrite integrated
work.

**Proposed test mapping.** T8 composes publisher with changed-task, Pause,
executor and Git disposition seams; assert suspension proof before edit, exact
old/new choice, immutable B/W, Run-journal F2 read after Unpause before choice,
replacement waiting for P eligibility, atomic predecessor settlement/successor
planning, preserved predecessor resources, no overlap or cleanup on unknown
writers, and explicit re-review for terminal/integration races. Also assert new
blockers alone do not suspend A, preserving the existing intermediate-edit
contract.

### S9 — Instructions, edges or ownership change after approval

**Starting facts.** Q1 approval names parent fingerprint F and separately read
graph/claim facts. A maintainer changes P's body, blockers, grouping, lifecycle,
or claim before or between publication mutations.

**Trigger and ordered calls.** Publisher's required focused read observes the
change. It records the observation/conflict, stops the suffix and preserves any
partial prefix under Pause. Planner rereads current facts, checks scope and
cycles, then rejects or records Q2 adopting exact already-created TaskIds and
revised relations. Any earlier ambiguous operation must first be reconciled; Q2
cannot hide it. New authorization then follows S1 against current facts.

**Visible and forbidden outcomes.** Maintainer sees stale approval and concrete
changed facts. Edge-only edits do not masquerade as TaskRevision changes. Do not
overwrite foreign edits, bypass unfinished prerequisites, move foreign children,
or treat a fingerprint as atomic CAS. Unobservable edits between read/mutation
remain a provider consistency limit: this profile's no-concurrent-author
agreement is a precondition, not a transactional guarantee.

**Crashes/retries.** Crash after conflict/revision append follows exact history
lookup. Crash after an already-issued mutation still requires S4/S5 readback. No
blind retry using Q1 approval; unreadable current facts authorize no suffix.

**Proposed test mapping.** T9 injects each fact-family change before and between
mutations at tracker/publisher seams; assert prefix retention, no unauthorized
suffix, graph evidence separate from instruction fingerprints, no mutation on
incomplete coverage, and explicit Q2 adoption without duplicate create.

### S10 — Shared interface changes after dependent children have plans

**Starting facts.** I delivered shared surface S; tracker success released C/D.
C has immutable plan AC at Base BC and is executing; D may be safely suspended.
Planner receives a new split revision requiring an incompatible S change.

**Trigger and ordered calls.** Planner reads tracker/Git and exact dependent
attempt reports, records that the earlier interface contract no longer suffices,
and names one new interface owner I2 with acceptance examples and migration
scope. Operator applies Run Pause and observes exact safe reports for C/D.
Publisher then records intent and authors I2, revised C/D instructions, and
explicit I2 prerequisites under the approved manifest; each effect receives
exact readback. A complete graph/specification proof precedes Operator Unpause.
Ordinary fresh focused reads then establish changed revisions in the Run journal
and expose exact Continue/Restart/Stop choices. Unfinished I2 prevents safely
suspended C/D from resuming during this choice wait. Restart is required where
the old work cannot meet the new contract; ordinary replacement waits for
eligibility and atomically settles the old attempt while planning its successor.
Old resources remain for separately authorized disposition; no cleanup is
prerequisite to replacement. Ordinary I2 delivery and fresh tracker success
precede new dependent plans/starts/resumes.

 **Visible and forbidden outcomes.** Maintainer sees one interface owner,
concrete compatibility/migration responsibilities and retained old attempts.
Independent file paths are not proof of independent interfaces. No planner-
written code is assumed, no in-place Base/contract rewrite, and no new blocker
used as proof that executing C stopped. No new I2→C→I2 cycle is permitted.

**Crashes/retries.** Publication cuts follow S4–S6 and attempt choices follow
S8. Unknown dependent reports keep their exact responsibilities. Git mutation or
cleanup is not performed by the proposal artifact; ordinary
integration/disposition protocols own any later effects.

**Proposed test mapping.** T10 at review, tracker and exact-attempt
reconciliation seams asserts one assigned owner per surface/version, explicit
edges, cycle rejection, immutable AC/BC, post-Unpause Run-journal revision reads
before choice, stopped-writer proof and atomic settlement/planning at
replacement, and no resume of safely suspended D through unfinished I2.

### S11 — Planner publishes a chain rather than parallel children

**Starting facts.** P is open in the Run closure with exact executing A, owned
claim K, Base B and worktree W. Q proposes X then Y then residual P; neither
child exists, and no integration responsibility exists. Operator and authorized
publisher can establish the S1 exclusion and confirmed Pause.

**Trigger and ordered calls.** Planner reviews Q's distinct scopes and approves
its exact revision. Operator safely pauses A as in S8. Publisher records and
observes separate creates for X/Y, grouping under P, Y→X and P→Y prerequisite
mutations, then residual P instructions. Fresh complete closure and focused
specification reads prove this chain before explicit Unpause. Ordinary reads
establish the changed parent choice; Restart and replacement follow S8. X's
fresh tracker success releases Y; Y's success releases residual P.

**Visible and forbidden outcomes.** Maintainer sees X, then Y, then P eligible.
Grouping is separate; no P→X→P cycle, transitive-success inference, inherited
parent claim, copied Base/worktree, or publisher-completed parent is allowed.
X/Y obtain their own ordinary exact claims and immutable attempts when admitted.

**Crashes/retries.** Every create/edge/observation cut follows S4–S6; parent
suspension and changed-choice cuts follow S8. A partial chain stays held and
reuses verified TaskIds. Cleanup is inapplicable to publication: it disposes no
Git resources or claims; later ordinary delivery has its own disposition rules.

**Proposed test mapping.** T11 composes T1/T8 with the chain closure, asserting
Y never begins before fresh X success and P never begins before fresh Y success,
with separate claims/plans and no duplicate creates after any partial prefix.

### S12 — Application Exit interrupts a held publication

**Starting facts.** Operator has confirmed Run Pause. Q is approved; I exists, C
creation may have crossed the tracker boundary with acknowledged external
publisher intent but no observation. A is safely suspended with exact plan,
worktree and task claim retained. The publisher is outside the Dalph host.

**Trigger and ordered calls.** Operator or supervisor requests application Exit.
Dalph applies its existing process-wide cutoff and bounded drain, retaining its
ordinary responsibilities. It starts no publisher work or fresh reconciliation
in that drain. The external publisher stops its suffix when it can no longer
prove the agreed hold/exclusion; an issued create may still apply. On later
startup Dalph reconstructs ordinary Run history, including applied Pause, and
uses the existing owning recovery protocols. Before publication continues, the
publisher separately re-establishes current Pause confirmation, authorization
and exclusion, reconciles exact C intent through tracker readback, and validates
the verified prefix. It then follows S4–S6 or reports unresolved publication.

**Visible and forbidden outcomes.** Maintainer sees a host Exit outcome and a
separate held/ambiguous publication. Exit success proves neither tracker outcome
nor publisher shutdown. No Run-journal Exit event, automatic Unpause, claim
release, worktree deletion, fabricated suspension or replayed create is allowed.
Dalph's five-second drain does not bound or govern the external publisher.

**Crashes/retries.** Host death before an Exit result is ordinary coordinator
loss, not graceful success. Publisher death before/after C applies follows S4;
missing external stopped-writer/exclusion evidence keeps the suffix blocked.
Exit itself is not replayed from Run history. No durable-resource cleanup is
part of this scenario; separately authorized cleanup must preserve its exact
intent and reconcile its outcome under its owning protocol.

**Proposed test mapping.** T12 composes the accepted Exit cutoff/drain and
paused startup with a controlled external publisher. Assert no fresh host
reconciliation during drain, preserved exact obligations/claims/resources, no
implied publisher cancellation, no suffix without renewed hold/exclusion, and no
duplicate C after applied-but-lost response. External publisher stop/fencing
remains D9 below.

## Future verification seams and present limits

T1–T12 are future test identifiers scoped to this document, not existing
filenames or passing evidence. Receipt/review/publisher seams require new
accepted contracts; linking existing owners below does not assert they implement
decomposition.

| Proposed seam | Existing owner to compose with after acceptance | Scenarios |
| --- | --- | --- |
| Advisory receipt, exact decision append and recovery | [Journal reconstruction](../architecture/journal-and-reconstruction.md) and [executor boundary](../ARCHITECTURE.md#planned-attempt-executor-boundary) | T1–T4, T6–T7, T9, T11–T12 |
| Authorized tracker authoring, exact operation lookup and readback | [Tracker graph/claims](../architecture/tracker-graph-and-claims.md); new creation/grouping/edge contracts required | T1, T3–T7, T9–T12 |
| Ordinary activation and control composition | [Reactive actions](../scenarios/run-reactive-delivery-actions.md), [Pause progress](../scenarios/observe-pause-progress.md), [intermediate edits](../scenarios/intermediate-tracker-edits.md) | T1, T5–T8, T10–T12 |
| Exact changed-attempt disposition, integration and Base | [Changed facts](../scenarios/reconcile-changed-task-facts.md), [clean Restart](../scenarios/clean-restart-changed-attempt.md), [ordinary Base](../scenarios/qualified-current-head-attempt.md) | T1, T8–T11 |

| Host Exit with separate publisher lifecycle | [Graceful Exit](../scenarios/graceful-application-exit.md); new external stop/fencing contract required | T12 |

Future tests must assert ordered calls, identities, durable prefixes and
forbidden effects, with deterministic lost responses, delayed application, crash
cuts and foreign edits. Dry-run, controlled tests and production must interpret
one accepted workflow algebra, with adapters substituted at boundaries. At least
T1, T5 and T8 need composed ordinary-host evidence beyond publisher unit tests;
receipt/review/recovery cuts need both memory and SQLite journal coverage. New
forbidden outcomes need accepted invariant mapping and any appropriate formal
obligations before implementation, not a claim that current models prove them.
No live bulk fixture is needed for this documentation task.

Scenarios with no publication (S2 and pre-append S3) have no tracker mutation
crash or Git cleanup effect; their append/reply cuts are the applicable
failures. Parent execution, resource changes and Git effects apply only where
stated in S1/S8/S10 or inherited ordinary delivery. Proposal receipt cannot
itself change Git or executor lifecycle. Each remaining scenario states the
applicable mutation, read, journal and control crash points; no blanket recovery
promise substitutes for its test mapping.

Present checks are documentation references and formatting under [check
selection](../development/checks.md#choosing-checks). They cannot prove semantic
acceptance, provider atomicity, operation lookup, authorization, or runtime
behavior. Broader runtime/model/coverage gates add no evidence for this prose-
only change and are deliberately unrun.

## Alternatives and maintainer decisions

| Alternative | Benefit | Cost or competing visible outcome |
| --- | --- | --- |
| External planner/manual tracker authoring (research A) | Keeps current generic executor/result and delivery boundaries unchanged | Human must retain/reconcile authoring evidence; intermediate children can run unless an explicit hold is established. Does not promise automated deduplication or safe yield. |
| Reviewed publisher with confirmed Run Pause (recommended external-publisher hybrid; research A/B) | One understandable recovery prefix; current controls prevent this Run admitting partial work | New authoring/receipt/review contracts; independent work pauses; unknown create can remain blocked; requires exclusion of other Runs/authors. |
| Per-child staging or transactional batch publication | Could preserve independent Run work and hide partial readiness | No current accepted tracker hold/atomic batch contract. Grouping or a readiness label alone is insufficient. Requires separately accepted admission semantics and provider proof. |
| Advisory split after parent completes | Avoids changing a live parent attempt | Cannot deliver gradual residual-parent decomposition during execution; review must account for already delivered work and current lifecycle. |

| Maintainer decision awaiting acceptance | Candidate choice and consequence |
| --- | --- |
| D1 Actors and authority | Explicitly delegated planner plus authorized publisher; existing Operator retains controls. Decide authentication/delegation transport; a task claim grants no graph-write permission. |
| D2 Artifact/request/revision identity | Run/parent-scoped request, immutable digest-bound revision and exact review; separate from DeliveryProposalId and Accepted. Decide storage/retention, separate external authoring journal scope, and receipt capability beside the coarse executor boundary; no paused-Run action exemption. |
| D3 Publication/exposure | Confirmed whole-Run Pause plus cooperative author exclusion. Accept interruption and partial tracker visibility, or design a separately accepted staging/fencing alternative before implementation. |
| D4 Creation ambiguity | Exact initial marker/readback; no retry without conclusive non-application/no late apply or provider idempotency. Decide provider capability and manual resolution evidence; accept blocked availability if proof is unavailable. |
| D5 Partial repair and concurrency | Resume verified prefix, no automatic deletion; serialize parent/shared surfaces and re-review competing proposals. Decide how exclusion is proved across Runs/processes; fail closed until it is. |
| D6 Parent disposition | Retain residual parent coherence with explicit blockers; safely suspend, change instructions and use exact Restart when replacing active scope. Continue/Stop require a revised overlap/disposition review; approval never closes P. |
| D7 Shared interfaces | Dedicated owner task and explicit prerequisites; incompatible revisions require dependent-attempt review and ordinary disposition. Decide compatibility examples and ownership review authority. |
| D9 External publisher lifecycle | Decide how publisher stop, loss of hold and exclusion renewal are observed across host Exit/death. Host Exit neither cancels it nor supplies fencing; until proved, no publication suffix is authorized. |
| D8 Acceptance evidence | Accept or amend S1–S12, provider limits, proposed test seams and invariant obligations before any implementation. Documentation-task completion is not this decision. |

Status remains **proposed, awaiting maintainer acceptance**. The [source-review
appendix](../../research/planner-reviewed-task-decomposition.md#review-appendix-scenario-reconciliation) records scenario evidence and limits; it neither
changes canonical policy nor schedules implementation.
