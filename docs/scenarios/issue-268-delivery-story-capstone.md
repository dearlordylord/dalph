# Compose the thirteen-beat delivery story through production boundaries

Owning issue: [#268](https://github.com/dearlordylord/dalph/issues/268)

Status: accepted #268 scenario refinement. The repository owner accepted this
chronology before implementation; the blocking #309 amendment named below is
still required before the complete capstone may be accepted as passing. Issue
#268 owns this capstone chronology and its cassette-driver settlement
boundaries; the closed #267 scenario remains evidence composed by this story,
not the owner of these new requirements.

## Governing behavior and blocking edge

When the Operator lowers capacity, this scenario preserves
[#54's append-before-use capacity rule](issue-54-resize-task-admission.md#the-operator-lowers-capacity-while-two-task-attempts-are-running),
[#54's restart reconstruction](issue-54-resize-task-admission.md#a-crash-reconstructs-the-applied-capacity-and-occupied-attempts),
[D13's non-evicting ceiling and D12's exact position release](../DELIVERY-INVARIANTS.md#admission-and-capacity),
and [D40's durable capacity reconstruction](../DELIVERY-INVARIANTS.md#run-boundaries).
The governing Quint laws are
`runActivation.existingHistoryUsesLatestDurablePolicy` and
`runActivation.everyDurableRetainedAttemptHasExactPosition`; the collected
`existingHistoryUsesLatestDurablePolicyTest` supplies their executable model
witness. The production test `restart reconstructs the latest applied capacity
and both unfinished task positions` in
`packages/orchestrator/src/control/task-work-capacity.test.ts` supplies the
ordinary runtime witness.
Issue #268 adds only an exact cassette settlement cut after that production
operation succeeds.

When C becomes safely suspended and the Operator later continues B, this
scenario preserves
[#265's changed-projection publication through the ordinary report protocol](issue-265-passive-executor-observation-through-restart.md#alice-sees-one-executing-attempt-finish-without-another-work-command),
[#266's active-work refresh chronology](issue-266-active-work-authority-refresh.md#alice-changes-b-while-a1-b1-and-c1-execute-autonomously),
and [#65's exact Continue application](issue-65-cancel-or-continue-attempt.md#alice-continues-the-existing-attempt-under-changed-instructions).
[D21 and D22](../DELIVERY-INVARIANTS.md#ambiguity-and-evidence) retain
intent/result ordering and reconcile-before-retry; [D49](../DELIVERY-INVARIANTS.md#operator-requests)
retains exact-once choice identity. The planned-attempt-executor executable
conformance laws retain exact report correlation and monotonic report ordinals.
The Quint laws `plannedAttemptExecutor.safeAndTerminalReleasePosition` and
`plannedAttemptExecutor.positionReleasesOnlyForSafeOrTerminalEvidence`, with
the collected `safeThenResumeSameWorkTest`, cover ordinal-two Safe acceptance
and exact position release. They constrain the production report protocol, not
cursor settlement.
Issue #268 does not make C's report production authority for B's choice; it
records the accepted capstone chronology in which Continue follows C's durable
Safe publication.

When the new process activates the unfinished Run, this scenario preserves
[#265's same-attempt restart attachment](issue-265-passive-executor-observation-through-restart.md#a-later-dalph-process-reattaches-to-the-exact-codex-attempt),
[#218's normal finality return](issue-218-reactivate-incomplete-runs.md#a-normal-finality-result-stops-or-retains-the-exact-run),
[D29-D31](../DELIVERY-INVARIANTS.md#process-and-durability), and D40.
`runActivation.onlyExactEstablishedRunActivates`,
`runActivation.existingHistoryUsesLatestDurablePolicy`, and
`runActivation.everyDurableRetainedAttemptHasExactPosition` constrain the real
activation. The cassette neither derives finality itself nor supplies a
replacement recovery path.

Implementation is blocked on repository-owner acceptance and implementation of
[#309](https://github.com/dearlordylord/dalph/issues/309)'s pending causal-group
amendment, drafted in `docs/scenarios/issue-309-concurrent-interaction-group.md`
on `work/issue-309-concurrent-interaction-group`. It owns two distinct bounded
authority cuts. The initial active cut remains its separate fourteen-node,
eleven-edge group: two independent six-node unchanged-task chains plus B's
two-node specification lane. The later post-hint active-refresh cut is a
different twelve-node, ten-edge group: independent six-node executing-task A
and D chains, with exactly `12! / (6! * 6!) = 924` legal sequential
topological orders. Within either six-node chain, the task's specification
selection and result precede its current-claim selection and result, then its
planned-worktree and target-lineage checks. One chain may reach its claim or
later read while the other chain's specification result is still pending.

Restart is not a third authority group. Committed characterization `bb40c4c8c`
shows the exact executing restart as a strict startup graph, A projection, C
projection, D projection, and next graph sequence before it returns
`RunMustRemainActive(UnsettledResponsibility)`. Committed characterization
`c305b3543` supports independent authority progress only for the later
post-hint active-refresh A/D cut used here. The #268 cassette must preserve
those distinct shapes and must not invent restart specification, claim,
worktree, or lineage reads. The pending #309 amendment owns the bounded
cassette language for the two actual authority groups. No Quint law governs
cursor playback; the production laws above constrain the facts that playback
must preserve.

This scenario refines only controlled cassette composition. It preserves every
linked production rule and adds no tracker, Git, executor, Journal, capacity,
choice, finality, or retry authority.

## One settlement rule at all three cassette cuts

The affected person is a Dalph maintainer running the maintained #268 cassette
through the ordinary production workflow algebra with controlled tracker, Git,
executor, Journal, and clock Layers. Alice is the Operator whose already-
authored capacity and Continue actions appear in that story. The cursor is a
test interpreter only; it cannot establish a production fact.

Each of the three cuts below follows the same two-phase rule:

1. Under the existing cursor permit, the controlled adapter identifies and
   reserves the exact current authored item without advancing the top-level
   cursor or publishing its occurrence. Reservation is process-local and is
   not authority. It releases the permit before starting production work, so a
   blocked provider or Journal operation cannot block an independent cursor
   claim by retaining the permit.
2. The adapter runs the named production Effect, or its owning-authority
   reconciliation read after ambiguity, interruptibly. For C2 this includes
   the executor call, report validation and append, and ordinary publication of
   the accepted Journal position. A production failure before that exact
   accepted publication exits the current run through its existing tagged
   production failure and the existing
   `AuthoredScenarioCassetteRunFailure` result channel, retaining its exact tag
   and payload. An interruption remains an Effect interrupted exit rather than
   being mislabeled as success or as a domain failure. Neither outcome settles
   the cursor.
3. After the exact result succeeds and ordinary delivery publishes its accepted
   Journal position, the result-to-cursor handoff becomes uninterruptible. For
   C2, that one handoff reads the published Journal prefix, proves the exact
   Run, attempt correlation, Safe report ordinal two, and accepted position,
   acquires the existing cursor permit, settles that exact reserved item, and
   publishes its one cassette occurrence. The Journal read is inside this
   handoff because publication has already made the durable fact visible and an
   interruption between reread and settlement would split one accepted
   occurrence from its cassette chronology. A typed Journal-read or exact-match
   failure still exits unchanged; uninterruptibility delays interruption, not
   failures. Interruption arriving during the read, permit acquisition, or
   occurrence publication is delayed until the handoff completes or fails and
   releases the permit; after success the caller observes the pending
   interruption only after exact settlement.
4. The adapter performs zero automatic retries in the current controlled run.
   A duplicate settlement attempt in a direct test fails through the existing
   `AuthoredCassetteInteractionMismatch` channel and cannot claim a different
   item. A workflow-trace mismatch retains its existing exact
   `TraceOutput.TraceOutputError` mapping. Only a new full harness run creates a
   fresh cursor and may replay the authored operation from the beginning.

Cursor state never overrides durable state. A Journal append may commit before
its caller receives a result. In that case the durable occurrence remains
applied even though the process-local cassette item is unsettled and the next
authored item remains unavailable in that run. A later run must reread and
reconcile the Journal before deciding whether any apply call is permitted. It
may settle the cassette item from the owning protocol's exact reconciled
result; it may not roll the Journal back, infer non-application from the lost
response, or append a duplicate merely to make cursor state agree.

### Stable and representative public failure surfaces

The driver preserves each existing failure's exact `_tag` and schema payload.
It does not collapse storage, lifecycle, protocol, or authored-interaction
failures into a generic cassette error.

In this table, `JournalReadError` is the closed union of
`JournalHistoryInvalid`, `JournalPositionGap`, `JournalRecordMismatch`,
`InRunJournalRunMismatch`, `JournalDataCorruption`,
`JournalHistoryCorruption`, `JournalSchemaIncompatible`,
`JournalStorageAccessDenied`, `JournalStorageCapacityExhausted`,
`JournalStorageLocked`, `JournalStorageUnavailable`, and
`JournalPartitionContradiction`. `JournalAppendError` is
`JournalHistoryInvalid`, `JournalPositionGap`, `JournalRecordMismatch`,
`InRunJournalRunMismatch`, `JournalStoreContradiction`, every storage/read
store error just listed, or `WorkflowRunAlreadyTerminated`. Tests preserve the
concrete member rather than asserting only the alias name.
`JournaledRunBootstrapError` is the existing closed union of
`JournalAppendError`, `JournalInitialHistoryInvalid`, `JournalError`,
`InRunJournalRunMismatch`, `InvalidWorkflowJournalHistory`,
`JournalStoreError`, `JournalStoreContradiction`, `StartupRecoveryBlocked`,
`WorkflowRunAlreadyBegan`, `WorkflowRunAlreadyTerminated`,
`WorkflowRunTerminationEvidenceInvalid`, `WorkflowRunIdentityAlreadyUsed`,
`WorkflowRunNotBegan`, and `WorkflowRunTargetMismatch`; the same concrete-tag
rule applies.

| Boundary | Existing public failures in this chronology |
|---|---|
| Capacity pre-read | `JournalReadError`, `InvalidWorkflowJournalHistory`, `WorkflowRunNotBegan`, `ApplicationExiting`, `JournaledRunIdentityMismatch`, or `JournaledRunNotActive` |
| Capacity direct apply | `JournalAppendError` with its exact constituent tag/payload, `InvalidWorkflowJournalHistory`, `SchemaError`, `TaskWorkCapacityPolicyRevisionConflict`, `WorkflowRunNotBegan`, `ApplicationExiting`, `JournaledRunIdentityMismatch`, or `JournaledRunNotActive` |
| C2 Suspend/report acceptance | The applicable part of the stable exported `DeliveryActionExecutionError`: `JournalReadError`, `JournalAppendError`, `PlannedAttemptExecutorCommandFailure`, `PlannedAttemptExecutorCorrelationMismatch`, `PlannedAttemptExecutorResponsibilityAbandoned`, `PlannedAttemptExecutorResponsibilityContradiction`, `PlannedAttemptExecutorResponsibilityMissing`, `PlannedAttemptExecutorSuspensionNotAuthorized`, `PlannedAttemptExecutorSuspensionLimitReached`, `PlannedAttemptExecutorWorkAlreadyTerminal`, `PlannedAttemptExecutorCommandReconciliationRequired`, `PlannedAttemptExecutorProjectionNoCurrentReport`, `PlannedAttemptExecutorProjectionTemporarilyUnavailable`, `PlannedAttemptExecutorProjectionUnreadable`, `PlannedAttemptExecutorProjectionCorrelationMismatch`, `PlannedAttemptExecutorInitializationCorrelationContradiction`, `PlannedAttemptExecutorInitialReportCausalityContradiction`, `PlannedAttemptExecutorLifecycleTransitionContradiction`, `PlannedAttemptExecutorTerminalReportContradiction`, `PlannedAttemptExecutorStateNoCurrentReport`, `PlannedAttemptExecutorStateTemporarilyUnavailable`, `PlannedAttemptExecutorStateUnreadable`, or `DeliveryRelationSourceError` (`TrackerGraphRelationError` or `DeliveryRelationReconciliationError`); `ApplicationExiting` may reject the admitted outer activation before this operation completes |
| Reconstructed ordinary activation/finality | Closed outer cases `ApplicationExiting`, `JournaledRunBootstrapError`, and `JournaledRunIdentityMismatch`; the activation program's generic error parameter remains open and transparently carries whichever typed tracker, Git, executor, Journal, delivery-runtime, or finality failure the supplied production program returns |

`JournaledRunNotActive` belongs to the two public capacity-control calls because
they acquire the installed Run's runtime controls. C2 Safe executes inside the
already-established activation with in-Run protocol services, and
`JournaledRunBootstrap.activate` does not include `JournaledRunNotActive` in its
public failure type, so neither later boundary may manufacture that tag.
`ApplicationExiting` remains explicit where the public composition can reject
new ownership; ordinary fiber interruption remains a Cause interruption, not a
fabricated `ApplicationExiting` value.

The C2 row deliberately excludes Begin-only
`PlannedAttemptExecutorAlreadyBegan` and
`PlannedAttemptExecutorBeginReportContradiction`, Resume-only authorization and
invalidation failures, task-specification errors already settled before this
cut, and integration/promotion/cleanup failures from unrelated action variants.
The three `PlannedAttemptExecutorState*` failures and
`PlannedAttemptExecutorResponsibilityMissing` apply when the composed
same-attempt passive/current publication is the source of C2's candidate;
direct Suspend-command fixtures need not fabricate that passive path.
`DeliveryRelationSourceError` applies while the accepted result is published
through the ordinary delivery relation. These are concrete path distinctions,
not a claim that every member of the much wider `DeliveryActionExecutionError`
union is reachable at C2.

`DeliveryActionProtocolAdmissionMissing` is also excluded from a valid C2
chronology. The closed delivery-transition policy classifies
`SuspendPlannedAttemptExecutorWork` as requiring the exact planned-attempt
protocol correlation, proposal derivation carries that requirement, and C2 may
execute only after the runtime returns an admitted reservation carrying the
matching `PlannedAttemptProtocolAdmission`. The error instead fails closed when
an action that declared `NoPlannedAttemptProtocol` nevertheless calls
`withPlannedAttemptProtocol`; a #268 fixture must not violate the admitted C2
proposal precondition merely to inject it. The existing runtime test `admits an
independently proposed suspension after one unchanged passive observation`
proves the production C2 admission path, while `rejects protocol work when the
admitted action owns no planned-attempt permit` proves the malformed path
returns the exact `DeliveryActionProtocolAdmissionMissing` tag and correlation /
proposal-id payload.

For capacity, the exported read/apply aliases are closed, so table-driven tests
cover each concrete member at the real composition seam. For C2, tests cover
each named applicable protocol family and both closed
`DeliveryRelationSourceError` members, respecting the direct-Suspend versus
passive-publication distinction above. For reconstructed activation, tests
cover the closed outer cases and injected representatives from at least the
tracker, Git, executor, Journal, delivery-relation, and finality program
families; they do not claim to exhaust the activation program's open generic
error parameter. Every case asserts the exact encoded tag and payload, one
boundary call (or zero when an earlier pre-read/admission failure prevents it),
zero in-process retries, and an unsettled cursor item and strict successor. An
authored duplicate or wrong item is separately
`AuthoredCassetteInteractionMismatch`; it is not a production failure.

This narrow uninterruptible region does not cover the executor/provider call,
the report append, or finality work. It does cover C2's post-publication Journal
reread because that reread and exact cursor settlement form one local
linearization boundary after the durable fact is already accepted. The
trade-off is that a pending interruption may be delayed by that Journal read
and the cursor permit/publication handoff. Releasing interruptibility earlier
would allow a durable successful result with no matching cassette occurrence
or let the next authored boundary overtake publication; both independent
reviewers judged that split outcome worse than delayed interruption. Extending
uninterruptibility across the earlier provider call or report append would
instead delay shutdown before a durable result exists and remains rejected.

## The capacity revision commits before process death is exposed

### Bootstrap identity and activation exclusion

`JournaledRunBootstrap` is installed for exact Run R. A well-formed public
capacity request may still carry foreign Run F, including when F has its own
valid Journal history. Whether R's runtime is active or inactive,
`readTaskWorkCapacity(F)` and `setTaskWorkCapacity(..., F)` fail exact
`JournaledRunIdentityMismatch(expectedRunId R, requestedRunId F)` before Dalph
leases R's runtime controls, reads either Run's Journal, or appends any event.
The caller observes one typed failure and zero runtime-control, raw-Journal,
or retry calls. A future API may remove the redundant Run argument entirely;
#268 preserves the current public shape and binds that capability to R instead
of allowing it to address another Run.

When R's runtime is inactive, its public capacity read or apply acquires the
existing activation permit and then the existing forward-progress owner before
reading or appending through the raw Journal control. It holds both until that
one control call succeeds, fails, or is interrupted. An activation arriving
while the Journal call is blocked cannot reconstruct policy concurrently. If a
pre-commit apply is interrupted, both owners release and the waiting activation
reconstructs revision one/capacity three. If revision two commits but its
response is lost, both owners still release; the waiting activation reconstructs
revision two/capacity two, and neither the failed caller nor activation appends
a duplicate capacity event. `RuntimeClosing` rejects the control call instead
of entering raw Journal control.

The repository owner and an independent reviewer both accepted the exact-Run
check and continuous exclusion as production correctness rules. The exclusion
trade-off is concrete: slow inactive Journal I/O delays activation. Allowing
activation to enter between the capacity read and append would instead let it
reconstruct revision one while revision two is being applied, creating live
policy that disagrees with durable policy; correctness wins over that
concurrency.

### Starting facts, trigger, and ordered boundaries

Run R began at capacity three and durable policy revision one. Exact attempts
A0, C2, and D3 have unfinished responsibilities and retain their task-work
positions. B1 is safely suspended and E4 has not started. Git and the tracker
change nothing during the capacity request.

Alice asks the existing local control boundary to set capacity two against
revision one. The cassette reserves exact `SetTaskExecutionCapacity(2)` but
does not yet expose `CoordinatorProcessDies`. The real
public composition first calls `readTaskWorkCapacity(R)` and then, only when it
returns revision one, calls `setTaskWorkCapacity` once. The direct apply reads
current policy, validates revision one, and appends exactly one
`TaskWorkCapacityChanged` action at revision two. After the append is
acknowledged and the public call returns policy revision two, the
uninterruptible handoff settles the capacity story item and publishes its
occurrence. Only then may the cursor expose process death.

The contraction does not evict A0, C2, or D3. Their three held positions may
temporarily exceed capacity two under D13. The maintained run must contain
the ordinary reduced latest policy at revision two and capacity two; it must
not report a later revision three.

### Failure, interruption, replay, and visible result

There are two distinct interruption cuts:

1. If the pre-read, validation, or append is interrupted or fails before the
   revision-two record commits, the Journal remains at revision one. The
   capacity cursor item remains unsettled, death remains unavailable, and the
   current run exits after one pre-read and at most one apply call with zero
   retry.
2. If the Journal commits revision two but the append acknowledgement or public
   apply response is lost, revision two remains the applied production fact.
   The process-local capacity cursor item nevertheless remains unsettled because
   no exact successful result crossed its settlement linearization point.
   Process death remains unavailable and the current run exits after exactly
   one apply call with zero retry. Cursor state neither rolls revision two back
   nor describes it as unapplied.

A new harness run starts with a fresh cursor and no inherited reservation but
may use the same durable Journal for reconciliation. Before any apply, it calls
`readTaskWorkCapacity(R)` once. The ordinary task-work-capacity reducer owns
complete Journal reading, validation, and reduction; the cassette receives no
Journal capability and inspects no event, actor, prior revision, or append
payload. If the ordinary result is exactly latest policy revision two and
capacity two, that is the complete reconciliation fact available to this
driver. It may enter the successful-result-to-cursor settlement without another
apply. If the ordinary result is revision one, the new run may make one
ordinary apply call. Any other returned revision/capacity pair fails the
authored boundary without an apply or settlement. An unreadable Journal remains
its exact `JournalReadError`; it does not authorize an apply.

The exact pre-read and direct-apply failure sets are the capacity rows in
[Stable and representative public failure surfaces](#stable-and-representative-public-failure-surfaces). Each exact tag
and payload ends the current run unchanged at this cursor cut. No failure is
converted to an authored success, retried in-process, or followed by the death
item.

The maintainer observes either one acknowledged revision-two application
followed by the authored death, one durable-but-unacknowledged revision-two
application with no death in that run, a pre-commit failure/interruption, or an
exact production failure. The cassette must not treat request decoding or
reservation as applied capacity, treat a committed unacknowledged append as
unapplied, expose death early, append twice, or persist its reservation.

## C Safe commits before Continue B is exposed

### Starting facts, trigger, and ordered boundaries

After restart, active-work authority proves C's current instructions require
the already-accepted Suspend path. C2 has accepted Executing report ordinal one;
B1 has an accepted Safe report and its exact changed-instruction choice is
available but has not been applied. Alice's exact Continue B request is already
authored after C's Safe boundary.

The controlled executor returns exact
`ExecutorWorkSafelySuspended(C2)` to the ordinary production report protocol.
That return is only a candidate. The report protocol validates the exact Run,
attempt, preceding command/intent, and current ordinal; appends the accepted C2
Safe report at exact ordinal two; and publishes that accepted journal position
to ordinary delivery. Only after that success does the uninterruptible handoff
settle the exact C Safe cassette item and publish its occurrence. The cursor may
then expose `OperatorContinuesAttempt(B1)` to #65's ordinary choice protocol.

The Run journal must contain exactly one C2 Safe report at ordinal two and no
second C2 Safe or ordinal three. Continue B remains independently authorized by
B1's exact F1/F2 facts and request identity; C2 supplies chronology, not B
authority.

### Choice availability remains a derived runtime projection

After C2 Safe settles, the Operator or a future #260 status/CLI consumer may
ask what can happen next for B1. Dalph does not answer that question by adding
`AttemptChoiceControl.readAvailable(RunId, AttemptId)`. The one current source
is the existing
`DeliveryRuntimeResources.runtimeObservation -> current.ticketDeliveries ->
PlannedAttemptExecutorFreshFacts -> TaskSpecificationChangeConstraint`
projection. `AttemptChoiceControl.read` remains the lookup for one already-
applied request identity, and `AttemptChoiceControl.apply` still revalidates an
exact proposed request at its owning boundary. A restart reconstructs and
rederives the runtime observation; it does not persist an available-choice
record or introduce another choice authority. A future #260 status/CLI may
thinly filter or present that observation without changing its ownership.

The repository owner recommended adding the new read API, while the independent
reviewer rejected it because it would duplicate a derived availability fact
behind a second control-shaped surface. Under the standing expert-rejection
rule, that named objection blocks the API. This decision changes no runtime
behavior in #268; it records the forbidden duplicate so the cassette chronology
cannot be mistaken for new choice authority.

### Failure, interruption, replay, and visible result

An exact existing report-protocol validation, append, contradiction, or
publication failure remains its tagged production failure. Failure or
interruption before accepted ordinal two leaves C Safe unsettled and Continue B
unavailable. The named reviewable surface is the C2 row in
[Stable and representative public failure surfaces](#stable-and-representative-public-failure-surfaces);
representative fixtures assert their encoded tag/payload, one Suspend command
at most, and zero in-process retries. If ordinal two commits but its
acknowledgement is lost before cursor linearization, ordinal two remains
durable, C Safe remains
unsettled, and Continue remains unavailable in that run. A new run reconciles
the exact pending/accepted report through the ordinary report protocol and
settles from that exact result without another Suspend or ordinal. Once an
exact accepted result enters cursor linearization, interruption during permit
or occurrence publication is delayed until C Safe settles exactly once. A
direct duplicate settlement fails `AuthoredCassetteInteractionMismatch`; the
adapter does not retry in-process. Only a new full harness run may replay.

The maintainer sees Continue B only after the accepted C2 Safe occurrence is
durable and published. Dalph must not advance on the provider return alone,
manufacture acceptance, append another report ordinal, cross-deliver another
attempt's report, or turn C's report into Continue authority.

## The ordinary restart return settles before later hints

### Starting facts and strict restart projections

The authored first process dies only after capacity revision two is durable.
Process-local cursor reservations, reactivation state, positions, fibers, and
hints disappear. Run R's journal retains revision two, unfinished A0, C2, and
D3 responsibilities, B1 Safe, their exact plans and reports, and no synthetic
death event. No person triggers restart.

A fresh process establishes R from the real journal and runs the actual
ordinary activation and finality composition. For these already-planned,
already-claimed, executing A0, C2, and D3 attempts, the observed restart is the
strict sequence `startup graph -> P_A -> P_C -> P_D -> next graph`, where each
`P` is the exact same-attempt executor projection. It performs no A/C/D
specification, claim, planned-worktree, or target-lineage authority chain at
this restart cut. Exact projection handling follows #265: each unchanged
Executing result is correlated to its requested attempt, is retained, and does
not append another report ordinal. A foreign, missing, unavailable, unreadable,
or out-of-position projection cannot be consumed as its strict neighbor.

The activation reconstructs capacity two and all three already-held positions.
A0, C2, and D3 remain unfinished, so the real finality computation returns exact
`RunMustRemainActive(UnsettledResponsibility)`. It cannot return
`RunnableTransition`, `TrackerTargetUnsettled`, or `RunMayTerminate` from these
facts.

### Return settlement, hints, failure, and visible result

The successful callback result is then handed to the cursor through the common
uninterruptible settlement cut. The cassette publishes exactly one
`CoordinatorActivationReturned` occurrence carrying
`RunMustRemainActive(UnsettledResponsibility)` before it exposes the later
`TrackerNotification` and `Timer` hints. Those hints may start the G2 active
refresh only afterward. That later cut, not restart, contains the independent
executing A and D specification-to-lineage authority chains. #309 must encode
them as the exact twelve-node, ten-edge, 924-order group described above; it
must not impose an all-specifications join or any other cross-task edge.

If actual ordinary activation or finality fails or is interrupted before the
decision returns, no callback-return item settles and no hint is exposed. The
closed outer cases and representative open-program families are identified in
the reconstructed-activation row of
[Stable and representative public failure surfaces](#stable-and-representative-public-failure-surfaces).
Each injected representative preserves its encoded tag/payload and observes
exactly one activation call or zero when establishment/admission rejects it,
with zero in-process retries.
If interruption arrives after the exact decision while permit/publication is
blocked, settlement completes once before interruption is observed. A wrong or
duplicate return fails through `AuthoredCassetteInteractionMismatch`. There is
no in-process activation retry; only a new full harness run may reconstruct R
and replay with a fresh cursor.

The maintainer observes one real reconstructed activation with the strict
graph/projection prefix, one exact finality return, then the hints and their
separate active-refresh authority group. The cassette must not supply a canned
decision, omit or delay the return until G2, let hints overtake it, add restart
authority reads, serialize the later independent A/D chains, persist a hint or
callback identity, or add a second recovery authority.

## Scenario-to-test mapping

Every concurrency test uses deterministic `Deferred` gates, the real
production seam named in the chronology, and direct cursor position/occurrence
assertions. Aggregate cassette totals do not substitute for these proofs.

| Chronological result | Required direct proof |
|---|---|
| Active and inactive public capacity reads/applies reject a well-formed foreign Run before runtime controls or either Run's Journal is touched | `packages/orchestrator/src/coordination/run/journaled-run-bootstrap.test.ts` — `rejects a foreign capacity Run before active or inactive runtime and Journal control` |
| An inactive capacity read or apply holds the existing activation permit and forward owner until its Journal boundary releases; `RuntimeClosing` fails rather than entering raw Journal control | `packages/orchestrator/src/coordination/run/journaled-run-bootstrap.test.ts` — `keeps activation out of inactive capacity read and apply until each Journal boundary releases` |
| Capacity application remains interruptible; while its real Journal append/result is blocked, process death is unavailable and interruption settles nothing | `packages/dalph/test/cassettes/cassette-residuals.test.ts` — `keeps authored process death unavailable before the production capacity result` |
| After revision two succeeds, interruption blocked on cursor permit/publication is delayed; capacity settles once, death becomes available, and a duplicate fails exact mismatch | `packages/dalph/test/cassettes/cassette-residuals.test.ts` — `settles one production capacity revision before delayed interruption and process death` |
| A pre-commit interruption releases both owners so activation reconstructs revision one/capacity three; a committed-but-unacknowledged append releases both owners so activation reconstructs revision two/capacity two, exposes no death in the interrupted run, and causes no duplicate apply or revision three | Exact story-capacity driver proof: `packages/dalph/test/cassettes/cassette-residuals.test.ts` — `distinguishes pre-commit interruption from a committed lost capacity response using only the reduced policy`; real inactive bootstrap owner-release and next-activation proofs: `packages/orchestrator/src/coordination/run/journaled-run-bootstrap.test.ts` — `interrupts inactive task-work capacity before append without changing policy` and `reconciles an inactive capacity append that committed before its response was lost` |
| Every capacity pre-read/direct-apply failure preserves exact tag/payload, leaves death unavailable, calls the prevented boundary zero times and the reached boundary once, and performs zero retry | `packages/dalph/test/cassettes/cassette-residuals.test.ts` — `preserves every public capacity failure without advancing or retrying` |
| The completed capacity run's ordinary reduced policy is exactly revision two/capacity two, with no later revision | `packages/dalph/test/cassettes/delivery-story-capstone.execution.test.ts` — `observes reduced capacity revision two before the authored restart cut` |
| C2 Safe remains interruptible before the real accepted report publication; Continue B is unavailable and failure/interruption creates no ordinal two | `packages/dalph/test/cassettes/authored-active-work-causal-sync.test.ts` — `keeps Continue B unavailable before the production C2 Safe publication` |
| After exact C2 ordinal two succeeds, interruption blocked on cursor permit/publication is delayed; Safe settles once, Continue becomes available, and duplicate settlement fails exact mismatch | `packages/dalph/test/cassettes/authored-active-work-causal-sync.test.ts` — `settles exact C2 Safe once before delayed interruption and Continue B` |
| Named applicable direct-Suspend and passive-publication failure representatives preserve exact tag/payload, call Suspend at most once, advance neither Safe nor Continue, and perform zero retry; both accepted-delivery relation-source failures return from the exact C2 runtime route after one execution and zero retry; committed ordinal-two ambiguity reconciles the exact Run/C2 correlation without another Suspend, Safe report, or ordinal before exact Continue B is exposed | `packages/dalph/test/cassettes/authored-active-work-causal-sync.test.ts` — `preserves named C2 Safe failure families and reconciles a committed lost response without retry`; `packages/orchestrator/src/coordination/delivery/run-delivery-runtime.test.ts` — `preserves both C2 delivery relation source failures after one admitted Suspend without retrying` |
| A valid C2 Suspend proposal requires and receives its matching planned-attempt protocol admission; the no-admission lease remains a separate fail-closed invariant check | `packages/orchestrator/src/coordination/delivery/run-delivery-runtime.test.ts` — `admits an independently proposed suspension after one unchanged passive observation`; `packages/orchestrator/src/coordination/delivery/delivery-runtime-observation.test.ts` — `rejects protocol work when the admitted action owns no planned-attempt permit` |
| The completed run has C2 Executing ordinal one and exactly one Safe ordinal two, with no ordinal three | `packages/dalph/test/cassettes/delivery-story-capstone.execution.test.ts` — `records exactly one C2 Safe ordinal before Continue B` |
| Available Continue choices remain the derived runtime-observation projection; applied-request lookup and apply-time validation remain separate, and restart persists no availability fact | Documentation-only decision in [Choice availability remains a derived runtime projection](#choice-availability-remains-a-derived-runtime-projection); existing runtime-observation, frontier, and attempt-choice tests retain their separate authorities, so #268 adds no behavior test |
| The executing restart reconstructs real journal facts, completes strict `startup graph -> P_A -> P_C -> P_D -> next graph` with three exact unchanged Executing projections and no A/C/D specification, claim, worktree, lineage, or executor command calls, then returns exact UnsettledResponsibility | Committed characterization `bb40c4c8c`, `packages/dalph/test/scenarios/production.test.ts` — `completes the startup graph read then serially reattaches A C and D before the next graph read`; `packages/dalph/test/cassettes/delivery-story-capstone.execution.test.ts` — `runs reconstructed ordinary activation through strict exact projections before returning unsettled responsibility` |
| Before the actual activation/finality result, failure/interruption settles no return and exposes no hint | `packages/dalph/test/cassettes/authored-reactivation-return.test.ts` — `keeps restart hints unavailable before the production finality result` |
| After the actual decision, interruption blocked on cursor permit/publication is delayed; the return settles once before hints and duplicate/wrong returns fail exact mismatch | `packages/dalph/test/cassettes/authored-reactivation-return.test.ts` — `settles the reconstructed restart return once before delayed interruption and later hints` |
| Closed outer activation failures and representative tracker/Git/executor/Journal/delivery-relation/finality program failures preserve exact tag/payload, call activation once or zero when rejected earlier, advance neither return nor hint, and perform zero retry | `packages/dalph/test/cassettes/authored-reactivation-return.test.ts` — `transparently preserves representative restart activation failures without advancing or retrying` |
| The initial active authority cut remains the separate fourteen-node, eleven-edge group and drains before its strict successor | Blocking #309 tests — `partitions all 84084 active-refresh orders by three canonical lane positions`; `consumes every active-refresh specification-to-lineage order before B Suspend` |
| After the restart return and hints, executing A and D use exactly two independent six-node authority chains: twelve nodes, ten edges, and 924 legal orders; either reaches claim while the other's specification result is blocked, and the group drains before its strict successor | Committed production premise `c305b3543`, `packages/dalph/src/application/production-reactivation.test.ts` — `allows one active-refresh authority lane to reach claim while independent specification reads remain in flight`; blocking #309 Deferred/group tests — `partitions all 924 post-hint active-refresh orders by two canonical lane positions`; `consumes every post-hint A D authority order before advancing`; then `packages/dalph/test/cassettes/delivery-story-capstone.execution.test.ts` — `preserves the post-hint A D authority group without weakening the thirteen-beat story` |
| DS-01 through DS-13 retain exact Run, attempts, Base SHA, claims, worktrees, capacity, held/retained states, and accepted outcomes through all three cuts | `packages/dalph/test/cassettes/delivery-story-capstone.execution.test.ts` — `emits the exact DS01 through DS13 delivery checkpoint table` |

The direct boundary tests must be red against the current cursor-before-result
drivers, then green through production-seam composition. The capstone and this
scenario remain blocked—not partially accepted—until the #309 amendment and all
mapped rows are implemented and reviewed.
