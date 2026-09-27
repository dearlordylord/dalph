# Publish the integrated commit before completing the task

Issue: [Specify final remote publication before task completion](https://github.com/dearlordylord/dalph/issues/383).

**Status: accepted by the maintainer on 2026-09-19; the maintained capstone chronology repair and controlled S1/S7 checks are recorded. An earlier candidate passed its exact-head full gate, but the current candidate still requires a frozen full gate. Acceptance also remains unproven because the fresh supervised disposable S1 dogfood has not reached publication, promotion, and closure.** Issue #390's retained-run closure is complete; the supervised S1 must be a fresh disposable run and must not repair the retained failed candidate.
Alice selected direct publication, remote-first order, ordinary non-force push,
and automatic integration recovery with user-authorized continuation after
exhaustion. This document consolidates those decisions and their acceptance tests.

The specification was established before runtime work at planning Base
`1f8cf021e129cb2590dcc9c4906ab44a3d806098`, in the fresh
`/workspace/typescript/dalph-worktrees/issue-384-fresh` worktree. That prerequisite
changed no runtime behavior. Tests below remain required implementation evidence;
the current work is tracked in the [development checkpoints](../postmortems/issue-384-supervised-dogfood-log.md#current-user-directed-orchestrator-method).

## Outcome and scope

Dalph delivers one GitHub task to one explicitly configured remote target branch,
for example remote `origin`, branch `refs/heads/master`. It validates and pins
that destination before task claim/provider work, prepares a candidate, pushes it
without force, records exact remote proof, promotes the local integration ref,
and only then completes the task. A normal competing push causes automatic
reintegration of the same accepted task commit; the task executor never reruns.

Issue #384 is the first direct-publication slice of this parent specification.
It owns pre-claim destination admission, the publication-before-promotion-
before-completion order, exact proof retention/reconciliation, initial finite
bounds, precise retained waits, and the existing Exit/finality premises. The
full parent chronology remains here so later slices can preserve one vocabulary
and one boundary order.

Success means the exact integrated commit was published, local promotion and
tracker confirmation succeeded, and existing cleanup/settlement obligations were
met. It does not mean hosted CI or deployment passed. PR workflows, force pushes,
branch-management commands, new reset interfaces, and multi-remote transactions
are outside scope. Automatic competing-head successors and their local catch-up
are implemented by #385. The initial remote baseline and its local catch-up belong
to #384, including the catch-up recovery required by its S5 acceptance criterion.
Additional-batch grants belong to #386, and the transport-neutral retained-delivery
operation belongs to #387. Those issues extend the retained waits
named here and do not change the initial publication order.

## Slice ownership and protected premises

The parent issue's S1–S8 chronologies remain the accepted behavior. The issue
owners below identify which implementation may cross each boundary in this
delivery sequence; a deferred owner is not evidence that #384 is complete.

| Boundary or scenario | Issue-384 seam | Deferred extension |
| --- | --- | --- |
| Destination admission | Validate one credential-free endpoint, one fully qualified existing branch, one local-to-remote mapping, and pin it in `WorkflowRunBegan` before claim/provider work. | None; unfinished history without the pin is a typed retained constraint. |
| S1 publication order | Publish exact M with an ordinary non-force explicit refspec, retain correlated per-ref proof, request the local exact-head compare-and-set only after that proof, then complete the task from fresh tracker premises after local promotion is observed. | The disposable hosted journey is a later qualification step; this document does not claim it ran. |
| S3 proof/reconciliation | Reuse exact M for up-to-date or same-endpoint descendant proof; reconcile ambiguous sends only after sender custody is stopped; retain work on typed denial/throttle. | #385 handles compatible competing heads; #387 handles repaired temporary authority. |
| S5 recovery cuts | Cover initial baseline catch-up, intent-before-send, applied/unapplied response, lost response, ambiguous append, proof-before-promotion, and promotion-before-observation in memory and SQLite. | #385 adds successor authorization and successor catch-up cuts; #386 adds grant-after-exhaustion cuts; #387 adds resume-after-receipt cuts. |
| Initial finite bounds | Enforce three Integrator sessions and three publication intents per candidate, 30-second remote observation, 120-second push, and precise retained exhaustion/denial waits. | #386 owns a new authorized batch; no ungranted fourth action is part of #384. |
| S7 Exit and S8 finality | Preserve conclusive publication proof through lifecycle interruption, block new work after Exit admission, and require proof plus local promotion plus current tracker premises for completion. | #387 reuses these premises after a retained-delivery request. |
| S2, S4, public recovery | Preserve the accepted parent chronology and its forbidden outcomes for later implementation. | #385 owns automatic successors/catch-up; #386 owns grants; #387 owns resume; public CLI control remains separately qualified. |

## Governing behavior and amendments

| Decision boundary | Preserved contract and explicit amendment |
| --- | --- |
| Task planning and candidate preparation | Preserve [immutable attempts](../architecture/attempt-delivery-and-integration.md#immutable-planned-attempt), [D26–D28](../DELIVERY-INVARIANTS.md#integration-and-promotion), and candidate parents `[H, C]`: H is the session's fixed integration head; C is the immutable accepted task commit. The [integration model](../../specs/acceptedResultIntegration.qnt) and [tests](../../specs/acceptedResultIntegration_test.qnt), including `exactGitParentsQualifyReportedCandidateTest`, continue to govern qualification. |
| Remote destination and publication | Apply [D28a–D28b](../DELIVERY-INVARIANTS.md#integration-and-promotion): pin one endpoint/ref in `WorkflowRunBegan` before claim/provider work, then record exact per-ref proof for M with an ordinary non-force explicit refspec. |
| Remote publication and local promotion | Amend [promotion/finality order](migrate-promotion-and-finality.md#the-reported-and-git-qualified-candidate-reaches-promotion) under [D28c](../DELIVERY-INVARIANTS.md#integration-and-promotion): publication precedes local promotion. Preserve the local exact-head protocol and `exactCandidatePromotesWithDirectCompareAndSetTest`; ordinary remote push is a separate boundary, not another use of local promotion proof. |
| Competing remote work | #385 extends [successor fixation and recovery](recover-or-quarantine-integration-session.md#the-operator-requests-a-full-rerun) with a distinct Dalph authorization for a compatible competing remote advance, journaled local catch-up, and one fresh-head successor. #384 preserves the wait until that authorization; conclusive Integrator failure does not become automatically retryable. |
| Task completion | Extend [integration finality](../../specs/integrationFinality.qnt), especially `completionRequestUsesExactPremises`, with [D28c](../DELIVERY-INVARIANTS.md#integration-and-promotion) remote publication proof. Preserve `dependantReleaseRequiresLaterCompleteGraph` and `settledTaskRequiresExactCleanup`; after publication, `noReintegration` still forbids repeating integration merely to recover completion. The completion-derived original claim release remains valid as a post-completion tracker wait in `packages/dalph/src/application/production-hermetic-qualification-source.test.ts::accepts a completion-derived original claim release in a post-completion tracker wait`; the full S8 publication-to-dependant chronology is exercised by `packages/dalph/test/cassettes/direct-remote-publication.test.ts::publishes M before local promotion and task completion, then releases its dependant from a later complete graph`. |
| Ambiguity and custody | Apply [D28d](../DELIVERY-INVARIANTS.md#integration-and-promotion) with [D21–D24](../DELIVERY-INVARIANTS.md#ambiguity-and-evidence), [D16–D17](../DELIVERY-INVARIANTS.md#preservation), [D29–D32](../DELIVERY-INVARIANTS.md#process-and-durability), and [D41–D46](../DELIVERY-INVARIANTS.md#serialized-integration). Push discovery may perform the owning-system reread before retrying a ref update; a separate network read is not mandatory when Git already provides that reconciliation. Raw auth/provider diagnostics do not enter journal/status. |
| Bounds and Exit | Apply [D28e–D28f](../DELIVERY-INVARIANTS.md#integration-and-promotion), the [interruptible Git boundary](interruptible-tracker-git-exit.md), and [D50–D52](../DELIVERY-INVARIANTS.md#application-exit). No successor, grant, resume, or fresh work starts after Exit admission closes; the five-second drain is unchanged. |

Acceptance must incorporate these amendments into the owning D invariants,
architecture, protected delivery-composition premises, and prior scenarios before
runtime implementation. Existing local-only models do not prove remote delivery.

## Normal delivery

**Starting facts.** Alice selects one fresh eligible open task A, capacity one,
an explicit executor profile, and one remote target. No claim, attempt, task
worktree, or Run exists for A. Local and remote target heads are compatible with
the declared task Base B. Git owns commits/refs, GitHub owns task facts, the
executor owns execution observations, and the Journal owns workflow history.

1. Validate configuration before task claim/provider work. Resolve one
   credential-free push endpoint and fully qualified branch; reads and pushes
   use that same repository. Initial admission requires the branch to exist.
   Pin this destination in workflow configuration. Restart cannot silently
   change it or infer a destination for old unfinished history.
2. Establish Run R; read and claim A; record the immutable attempt and exact B;
   prepare its worktree; begin the selected executor once. Preserve the existing
   claim, task revision, execution and accepted-result requirements. Its terminal
   accepted result supplies immutable commit C and releases task-work capacity.
3. Read current tracker/claim/control facts and journal a remote-read intent.
   Observe head H and obtain sufficient Git ancestry to qualify it. If local
   target L is behind H, separately journal a local catch-up intent, prove
   `L` is an ancestor of H, compare-and-set `L -> H`, and observe the result.
   Never reset a divergent/ahead target or disturb foreign/dirty work. Catch-up
   copies a remote baseline; it is not proof that C has been delivered.
   Before the compare-and-set, Git must report a direct target ref, an
   unambiguous worktree inventory with no checkout of that ref, and the same
   ancestor relation. An occupied target is refused even when clean; dirty
   files and indexes remain untouched. Each admitted baseline action performs
   one Git boundary and records its result before returning. The frontier
   re-derives catch-up under a fresh owner, so Pause or Exit can prevent that
   next action while preserving an already-produced result.
4. Record one session S fixed to H and C with its distinct candidate worktree.
   The Integrator performs its normal merge, review and repository checks and
   reports M. Git must prove exact ordered parents `[H, C]`. Neither provider
   may publish or promote outside Dalph's recorded workflow.
5. With current workflow permission, journal a numbered publication intent
   naming exact M, endpoint and branch. Invoke ordinary non-force push with an
   explicit refspec. Git discovers the remote and enforces its fast-forward
   rule; the remote head need not still equal original H. Forbid force flags,
   leases, leading `+`, mirror, implicit tags, secondary destinations and
   submodule pushes. Never push a moving local branch in place of exact M.
6. Record the exact per-ref successful update or up-to-date result as remote
   publication proof. No extra post-push workflow read is required. Upload
   progress, uncorrelated exit zero, dry-run output, equal contents and cached
   `origin/master` are not proof. If the result needs reconciliation, use the
   rules below before progressing.
7. Promote local H to M through the existing journaled local compare-and-set
   protocol. If publication is proved but local promotion is unfinished,
   recover that boundary rather than rerun the Integrator. A conflicting local
   edit retains an explicit local constraint, not permission to overwrite it.
8. Apply existing evidence rereads, completion-claim replacement, task closure,
   focused success confirmation, exact claim/resource cleanup and settlement.
   A later complete tracker graph read, not the push, releases dependants.
   Normal Run termination still requires every responsibility settled.

   Runtime phase boundary: when delivery records `IntegrationFinalitySettled`,
   stop admitting new delivery actions and drain the already admitted owners.
   Release phase resources, derive and execute exact worktree, branch and
   candidate cleanup from the accepted journal (rereading candidate evidence),
   and only then begin the next delivery phase. Pending or unproven cleanup
   keeps the Run active. A later phase must obtain the later complete graph and
   recompute its termination proof; a pre-cleanup proof cannot be reused.
   Regression mapping: `coordination/run/run.test.ts::rechecks cleanup created
   during delivery before accepting a later finality proof` covers interleaving;
   the public S1 cassette below covers all three real cleanup families, the
   graph/dependant ordering, and termination.

The destination ref is the configured remote branch, not a temporary work branch
or cached tracking ref. Credentials are excluded from journal/status. Journal
correlation binds R, task revision, attempt, C, S, H, M and destination; identities,
refs, ordinals and durations are branded at schema boundaries. Derived queues,
permits, counters and status are reconstructed from history, not stored as new
authorities. Dry-run, controlled tests and production interpret one workflow.

The shipped public CLI admits one repository-host configuration per process.
That supported input contains one local integration target and one remote
publication target, so two configured mappings for the same local target are
not constructible inside this host authority. A future multi-host assembly
must enforce the broader duplicate-mapping rejection before it enters either
host. Git URL rewrite ambiguity remains observable within one host and is
rejected by the publication adapter; rejection of an unrelated unknown field
is not evidence for the duplicate-mapping rule.

## Push results and automatic recovery

The initial #384 implementation owns exact update/up-to-date proof, same-endpoint
descendant reconciliation, safe reuse of M while its allowance remains, typed
denial/throttle retention, and the no-extra-read rule after conclusive proof.
The compatible competing-head row and its successor/catch-up chronology are the
accepted parent behavior but are implemented by #385; #384 records the precise
wait and never fabricates that successor.

| Evidence after a publication attempt | Next action |
| --- | --- |
| Successful exact update, or exact M already up to date | Record publication proof; proceed without another remote read. |
| Lost/ambiguous response, old local sender proved stopped | Repeat the same safe push within its allowance, or read the remote. Push discovery is reconciliation before mutation, not permission to assume the earlier push failed. |
| Rejection; fresh remote head N contains M | Prove ancestry and record publication. Do not push N backward or rerun integration. |
| Fresh remote head can fast-forward to M | Retry the same candidate under current permission and remaining allowance. No new integration cycle. |
| Compatible competing head H2; neither side contains the other | Record the precise competing-head wait, then #385 records a separate Dalph authorization for the same integration responsibility and C, preserves the predecessor, catches local Git up safely, and fixes one new session against freshly qualified H2. |
| Missing/unreadable target, insufficient ancestry, incompatible history, authentication/policy denial or throttle | Report the precise reason and retain work. Resume through the retained-delivery operation below after the relevant facts change. No inferred absence, automatic denied mutation, or throttled mutation retry. |

A remote advertisement names a commit; descendant proof additionally requires
that exact commit and sufficient ancestry from the same endpoint. Obtain that
evidence without moving task/target/foreign refs. No separate durable observation
resource is required; if the implementation creates one, its cleanup must follow
the existing exact ownership and disposition rules.

For a successor, #385 retains the task Base/worktree, accepted C,
responsibility and FIFO position. It preserves predecessor session/candidate/
evidence until stopped writers and the specific superseded disposition
authorize cleanup. Dalph records the automatic authorization as its action,
never as a fabricated Operator choice. Before fixation, it revalidates current
tracker, exact claim, control permission, remote head, and local Git state. The
remote read fixes one advertised H2 and proves its ancestry. Catch-up may
compare-and-set local L to H2 only after Git proves L is an ancestor of H2 and
proves the direct target ref is unoccupied. An ahead, divergent, dirty,
checked-out, foreign, symbolic, ambiguous, missing, unreadable, or
insufficiently proven target remains retained with its exact typed constraint;
it is never reset, cleaned, or overwritten. A later activation reads at most
one fresh remote head before fixation and, when it changed, uses that
observation under the same authorization. If round one was Ready before a later
activation begins, that activation first records one bounded refresh round
under the same authorization, even if the remote branch remains at H2. An
incomplete round resumes its exact read or catch-up intent. A catch-up read or
compare-and-set is one boundary per activation, not an inner
read-until-stable loop. Dalph fixes one new S2 and candidate resource at the
latest Ready head Hn; M2 must have parents `[Hn, C]`. A fixed S2 head never
changes. Restart restores the pending authorization, exact round, catch-up, or
S2 without duplication or overlapping provider writers.

The initial batch admits at most three Integrator sessions, including S1, and
at most three publication intents for each candidate. Fixing a successor
consumes one session even if Dalph crashes before provider contact. A race at
the limit retains the exact exhausted responsibility and never starts an
ungranted fourth session or fourth push for one candidate. The predecessor
remains evidence until its writer is proved stopped and a disposition specific
to supersession authorizes its exact candidate cleanup. These are #385 seams,
not #384 completion evidence.

## S2: Outside work advances the pinned remote branch

### Starting situation

Alice's task A has one exact planned attempt at immutable Base B, one accepted
task commit C, and one durable integration responsibility at its original
same-target FIFO position. Dalph called the task executor's Begin once. The
first Integrator session S1 is fixed to H and C; its isolated candidate M is a
Git-qualified commit with ordered parents `[H, C]`. The local target is H and
the pinned remote branch was H when S1 was fixed. No later same-target
responsibility may pass A. The S1 provider writer has settled before its
candidate is offered for publication.

### Dalph action and outside event

An outside contributor pushes compatible H2, which contains H but not M. That
push may occur before Dalph's first publication discovery, after discovery but
before Dalph's exact push, or while Dalph loses the response to an earlier
push. Dalph uses only the destination pinned in `WorkflowRunBegan` and ordinary
non-force Git operations.

1. Dalph records and attempts publication of exact M. Git may report a
   non-fast-forward rejection or, after an ambiguous response and stopped
   sender, read-only discovery may report the exact compatible competing head
   H2. Dalph records the correlated competing-head retention. It does not
   infer failure from a lost response and does not push H2 backward.
2. After a fresh tracker graph, exact claim, and current control permit allow
   progress, Dalph records one `IntegratorCompetingHeadSuccessorAuthorized`
   action naming the predecessor session, accepted C, exact competing-head
   publication occurrence, pinned destination, and original responsibility.
   This action is distinct from `IntegrationQuarantineDirectionApplied` and
   cannot be supplied by, or represented as, Operator Full rerun.
3. Dalph records one remote-baseline read intent for this authorization. Git
   reads the pinned branch H2 and local target L with sufficient ancestry. If
   L equals H2, catch-up is already current. If L is a proven ancestor of H2,
   Dalph records an exact L-to-H2 catch-up intent; Git rechecks the direct ref,
   unoccupied worktree inventory, and ancestry, then compare-and-sets only L to
   H2 and records the exact result. One observation or compare-and-set is
   admitted per activation.
4. A fresh target-lineage observation proves immutable Base B is an ancestor
   of the exact local target H2. Dalph fixes one deterministic S2 and distinct
   candidate resource for the same attempt, C, target, queue position, and
   integration responsibility. The successor's expected head is H2 and
   cannot change after fixation.
5. The Integrator receives H2 and existing C, then returns M2. Git accepts
   M2 only when its exact ordered parents are `[H2, C]`. Dalph publishes M2
   through the pinned destination, records exact per-ref proof, promotes the
   local target from H2 to M2, and completes A from fresh tracker/claim facts.
   A later complete graph observation releases A's dependant.

### Crash, retry, and lifecycle cuts

The Journal records automatic authorization before remote/local baseline reads,
catch-up intent before compare-and-set, and S2 fixation before provider
contact. If Dalph dies after authorization, replacement work resumes that
authorization after fresh tracker and claim reads. If it dies after a baseline
read, catch-up intent, catch-up application, or S2 fixation, the next activation
reconstructs the same occurrence from memory or reopened SQLite and performs
only its exact required reconciliation. It creates no second authorization,
baseline, catch-up, session, candidate resource, or task Begin. An ambiguous
Integrator call waits for exact provider-writer custody before resuming the
same S2 run ordinal; it never overlaps a replacement writer.

For the H2-to-H3 round-two catch-up, if another writer advances the local ref
from the exact expected H2 after Git observes H3 but before compare-and-set,
Git records `Rejected(CatchUpChanged)` with the exact observed local H4. Dalph
retains the responsibility at that baseline result, performs no mutation,
successor fixation, or provider start, and does not repeat the remote read in
that activation. A later activation must establish a fresh baseline before
another catch-up attempt. The focused test is
`packages/orchestrator/src/workflow/protocols/direct-publication/automatic-successor-baseline-recovery.test.ts::retains an H3 refresh when the exact local ref changes before the catch-up CAS`.
The frontier consumes that exact persisted result and releases the S2
responsibility without starting a successor in
`packages/orchestrator/src/coordination/frontier/integration-frontier-transitions.test.ts::releases the S2 responsibility after an H3 refresh catch-up CAS observes a changed local ref`.
If a newer target graph makes the existing lineage stale before authorization,
the frontier waits for a fresh lineage observation. If the H2-to-H3 catch-up
CAS succeeds but another writer advances the local target to H4 before that
fresh observation, the H4 lineage does not authorize an S2 fixed to H3; the
frontier releases the S2 responsibility without fixation or provider start.
Both controls are asserted alongside the exact H2-to-H3 authorization flow in
`packages/orchestrator/src/coordination/frontier/integration-frontier-transitions.test.ts::retains the exact compatible-head wait after the third automatic successor`.

For one concrete S2 result cut, the fixed S2 provider returns `NotPrepared`.
The Journal commits `IntegratorRunResultRecorded` for that exact S2 run, but
its append acknowledgement is lost before Dalph records quarantine. Dalph
stops and restarts. On activation it reads the same authorization, automatic
S2 fixed-session event, run start, and committed result; it validates those
exact records and appends one conclusive quarantine whose evidence points to
the committed result position. The test exercises this chronology in memory
and after reopening SQLite. Alice sees the conclusive retained integration
wait. Dalph does not call the provider again, start another writer, fix another
S2, or read candidate Git evidence for `NotPrepared`.

Pause prevents later reads, catch-up, fixation, publication, promotion, and
completion while retaining exact durable results. Exit admits no successor
action after its cutoff; an already-admitted Git boundary may return and record
its produced result only within the existing five-second drain. Restart uses
the normal activation and current-facts path.

### Visible and forbidden results

Alice sees automatic delivery continue under the same queued task after
ordinary competing remote work. The task executor still has one Begin. Dalph
preserves B, C, the task worktree, same-target FIFO position, predecessor
session/candidate/evidence, and pinned destination. It does not fabricate
Operator Full rerun, rerun the task, change candidate parents, force-push,
overwrite local work, delete a predecessor before stopped-writer proof, retry a
throttled or conclusively denied mutation, exceed three sessions or three
publication intents per candidate in the authorized batch, or read until
stable.

### Acceptance-test mapping

The focused implementation evidence currently covers these S2 outcomes:

The canonical automatic-successor proof model is replayed from the accepted
S1 publication-retained-at-H2 journal prefix. Initial publication intent,
outside push, and compatible-head discovery are fixture preconditions in this
adapter; the direct-publication production tests above own those boundaries.
From automatic authorization onward,
`specs/acceptedResultIntegration_automaticSuccessor_conformance.qnt::automaticSuccessorProductionConformanceTest`
is paired action by action with the positive case
`packages/dalph/test/conformance/automatic-successor.mbt.test.ts::replays the canonical automatic-successor trace through the journal fixation seam`
and the negative control in that test module,
`rejects a model fixation when the journaled Git lineage result is not descended from the planned Base`:
the accepted S1 prefix ends at the exact compatible-head retention occurrence;
initial publication intent, the outside push, and that discovery remain explicit
preconditions owned by the direct-publication production tests above. The
adapter derives the successor authorization from that retained occurrence and
persists it through the production delivery action. It derives the first
baseline correlation from the newly appended authorization, records the read
intent through the production journal helper, and obtains the local-ancestor
observation through `establishRemoteBaseline` and its Git port. The catch-up
intent and result use the production journal helpers around a stateful Git
boundary control that permits exactly one compare-and-set from the observed
local head to the observed remote head. Fresh target lineage is read as a
`ReadTargetLineage` operation through
`journaledWorkflowInterpreterLayer`, which persists the production Git intent
and observed result; the adapter does not copy future fixture events into the
history. On the positive trace, model projections compare authorization/read/catch-up/lineage counts,
action positions, exact heads and the final successor witness after every model
action. The negative trace reports and persists a controlled concurrent ref
movement to an unrelated Git head through the same lineage seam. Production
fixation is attempted with that observed input and deferred as stale; the replay
then compares and rejects the lineage mismatch before any fixed-session event,
alongside
`specs/acceptedResultIntegration_automaticSuccessor_proof_negative_test.qnt::staleH2FixationBeforeRequiredRefreshIsDetectedTest`.
The positive model path maps to
`specs/acceptedResultIntegration_automaticSuccessor_proof_test.qnt::beforeDiscoveryCatchesUpExactAncestorAndFixesOneSuccessorTest`
and the exact S2 acceptance path below.

- **H2 changes to compatible H3 before fixation:** the first baseline read observes H3 under the original H2 authorization and catches up only its exact local ancestor: `packages/orchestrator/src/workflow/protocols/direct-publication/automatic-successor-baseline-recovery.test.ts::uses the first automatic-successor baseline read after remote H3 advances under the same authorization`. If round one was Ready before activation entry, the frontier schedules one round two read under that same authorization: `packages/orchestrator/src/coordination/frontier/integration-frontier-transitions.test.ts::schedules one bounded baseline refresh when Ready H2 predates activation entry`. A compatible H3 refresh catches local H2 up and fixes one successor at H3; it does not schedule a third read in the same activation: `packages/orchestrator/src/coordination/frontier/integration-frontier-transitions.test.ts::retains the exact compatible-head wait after the third automatic successor` and `packages/orchestrator/src/workflow/protocols/direct-publication/automatic-successor-baseline-recovery.test.ts::refreshes Ready H2 to H3 under one authorization and reopens the exact successor in memory and SQLite`. A process that stops after the H3 catch-up CAS reuses the exact round-two intent and authorization in memory and reopened SQLite without another remote read: `packages/orchestrator/src/workflow/protocols/direct-publication/automatic-successor-baseline-recovery.test.ts::reconciles the same H3 refresh catch-up after memory and reopened SQLite process loss without another read`. A third baseline round is contradictory and leaves automatic successor preparation unavailable: `packages/orchestrator/src/workflow/protocols/direct-publication/automatic-successor-baseline-recovery.test.ts::rejects an automatic-successor baseline refresh beyond the two-round bound`; historical projection also rejects a third read after a valid ready round two, without fixing a successor, in `packages/orchestrator/src/workflow/registry/occurrence-projection.test.ts::rejects a third automatic successor baseline round after the ready refresh`. A round-two read before round-one completion is contradictory: `packages/orchestrator/src/workflow/protocols/direct-publication/automatic-successor-baseline-recovery.test.ts::contradicts a round-two read intent that predates the ready round-one completion`. A refresh appended after successor fixation is rejected by `packages/orchestrator/src/workflow/protocols/direct-publication/automatic-successor-baseline-recovery.test.ts::rejects a fresh automatic-successor baseline round after session fixation`.

  Historical occurrence projection also accepts Ready H2 followed by a same-authorization round-two H3 observation, exact local catch-up, fresh H3 lineage, and one successor fixation: `packages/orchestrator/src/workflow/registry/occurrence-projection.test.ts::projects an H2-ready automatic successor refresh through H3 catch-up and fresh fixation`.

  Formal positive paths: `specs/acceptedResultIntegration_automaticSuccessor_proof_test.qnt::compatibleH3BeforeBaselineFixesUnderSameAuthorizationTest`, `compatibleH3AfterBaselineAndSQLiteRestartFixesUnderSameAuthorizationTest`, and `recoveredReadyBaselineRefreshesSameHeadOnceTest`; negative controls: `specs/acceptedResultIntegration_automaticSuccessor_proof_negative_test.qnt::staleH2FixationBeforeRequiredRefreshIsDetectedTest`, `incompatibleH3StaysInOriginalRetainedWaitTest`, `duplicateAuthorizationForOneOccurrenceIsDetectedTest`, and the existing `secondPreFixationGitReadInOneActivationIsDetectedTest`. Runtime evidence covers the first H3 read, recovery-entry refresh, refreshed fixation, pending catch-up recovery, and post-fixation rejection. The complete production publication/promotion/finality suffix still relies on the separate S2/S7 tests below.

- Authorization, exact competing-head correlation, one pre-fixation Git boundary per activation, no Operator Full rerun, and retained FIFO/Base/C: `packages/orchestrator/src/coordination/frontier/integration-frontier-transitions.test.ts::authorizes one automatic successor for a compatible competing remote head without Operator direction`. The correlation type requires the `Initial` or `AutomaticCompetingHead` tagged variant and an explicit round for automatic reads, including round one: `packages/orchestrator/src/workflow/protocols/direct-publication/baseline-state.test.ts::tags initial and automatic baseline rounds in correlation identity and record keys`.
- Journal-first authorization, authorization-scoped baseline, stale-prefix refusal with no Git call, and exact baseline/catch-up intent plus CAS order: `packages/orchestrator/src/coordination/delivery/integration-delivery-action-adapter.test.ts::appends automatic successor authorization before baseline and catch-up CAS and defers stale-prefix authorization without Git`. The negative control `packages/orchestrator/src/coordination/delivery/integration-delivery-action-adapter.test.ts::rejects a foreign S2 authorization record returned by conditional append` requires an `Appended` result carrying a foreign authorization event; it raises `IntegratorJournalContradiction` before baseline observation, catch-up, successor fixation, provider start, or other Git work. A separate fixation append control, `packages/orchestrator/src/coordination/delivery/integration-delivery-action-adapter.test.ts::rejects a foreign fixed-session record returned by automatic S2 fixation append`, returns the requested key with a same-tag event carrying foreign session/resource identity; it raises `IntegratorJournalContradiction` after one fixation CAS and before any provider action.
- Authorization append failure before commit produces no Git read, baseline intent, catch-up, successor fixation or provider start; after retry, the same append commits and loses its acknowledgement, then memory/reopened-SQLite replay accepts one exact event without a duplicate append or Git read: `packages/orchestrator/src/coordination/delivery/automatic-successor-authorization-recovery.test.ts::recovers a lost automatic authorization acknowledgement without another Git read across memory and reopened SQLite`.
- The authorization-scoped LocalAncestor observation commits before its acknowledgement is lost; reopen reconstructs CatchUpRequired without another remote read, then performs one exact catch-up boundary in memory and reopened SQLite: `packages/orchestrator/src/workflow/protocols/direct-publication/automatic-successor-baseline-recovery.test.ts::recovers the exact automatic-successor baseline observation after a lost acknowledgement and then catches up once`.
- **H3 refresh catch-up crash cuts:** round two observes H3, the exact H2-to-H3 catch-up intent commits, the process stops before CAS, reopened memory/SQLite recovery gets `ResponseDeadline` with no CAS, and a later activation reconciles the same old H2/H3 intent and applies one CAS without another read: `packages/orchestrator/src/workflow/protocols/direct-publication/automatic-successor-baseline-recovery.test.ts::reconciles a pending H3 refresh catch-up through ResponseDeadline before one CAS in memory and reopened SQLite`.
- Read-intent append failure before commit produces no Git read; observation append failure before commit retains only the exact pending intent, and a later activation performs one new read to persist the exact result in memory and reopened SQLite without another authorization/session or duplicate intent: `packages/orchestrator/src/workflow/protocols/direct-publication/automatic-successor-baseline-recovery.test.ts::recovers precommit automatic-successor baseline intent and observation failures with one read per activation`.
- The authorization-scoped H→H2 catch-up CAS applies before its observation is durable; restart reconciles the same intent as AlreadyCurrent without another CAS/read or new authorization/session in memory and reopened SQLite: `packages/orchestrator/src/workflow/protocols/direct-publication/automatic-successor-baseline-recovery.test.ts::reconciles one applied automatic-successor catch-up CAS after memory and reopened SQLite process loss`.
- The exact catch-up result append commits before its acknowledgement is lost; memory recovery and reopened SQLite accept that result as Ready without another reconcile, CAS, remote read, authorization, session, or append: `packages/orchestrator/src/workflow/protocols/direct-publication/automatic-successor-baseline-recovery.test.ts::replays a committed automatic-successor catch-up result after lost acknowledgement without another Git boundary`.
- The exact catch-up intent commits before the host stops ahead of CAS. A `ResponseDeadline` from reconciliation is ambiguous, does not prove the CAS was unapplied, and leaves the same intent pending with zero confirmed CAS; a later activation reconciles exact old H and applies one CAS without another remote read, authorization, or session in memory and reopened SQLite: `packages/orchestrator/src/workflow/protocols/direct-publication/automatic-successor-baseline-recovery.test.ts::keeps an ambiguous ResponseDeadline catch-up pending until a later activation reconciles the exact old head`.
- The exact catch-up-intent append commits but loses its acknowledgement; reopening memory and SQLite recovers the same intent, does not repeat baseline observation or the initial CAS, and performs one Git reconciliation without another authorization/session or duplicate intent: `packages/orchestrator/src/workflow/protocols/direct-publication/automatic-successor-baseline-recovery.test.ts::recovers a committed automatic-successor catch-up intent after lost acknowledgement with one reconciliation`.
- One deterministic successor at freshly observed H2 with the same accepted C, immutable Base, queue/start positions, and one automatic fixation; the same test rejects a foreign predecessor and validates the exact lineage chronology: `packages/orchestrator/src/workflow/protocols/integrator/automatic-successor-session.test.ts::projects and fixes one automatic successor after the exact competing-head catch-up and fresh lineage`. Duplicate keys and a foreign fixed event at the deterministic key are rejected during recovery: `packages/orchestrator/src/workflow/protocols/integrator/automatic-successor-session.test.ts::rejects duplicate and foreign fixed-event keys during automatic successor recovery`.
- Automatic fixation requires its accepted authorization, one exact fixed predecessor, and remaining responsibility capacity; boundary checks cover stale authorization, absent fixed predecessor, and exhausted three-session capacity: `packages/orchestrator/src/workflow/protocols/integrator/automatic-successor-session.test.ts::requires the exact fixed predecessor and rejects successor preparation at exhausted capacity`.
- The delivery-action fixation seam commits one exact S2 fixed-session event before its acknowledgement is lost, then replays it without appending a duplicate; it also defers when a real accepted Run Pause advances the conditional prefix before fixation. The latter retains the Pause and appends no fixed session. This maps the S2 recovery chronology and S7 Pause-before-fixation cut to `packages/orchestrator/src/coordination/delivery/integration-delivery-action-adapter.test.ts::replays exact S2 fixation after a lost acknowledgement and defers a concurrent Run Pause prefix`. When the same authorization has already completed its bounded round-two H3 refresh, a previously proposed H2 fixation is stale; `packages/orchestrator/src/coordination/delivery/integration-delivery-action-adapter.test.ts::defers an H2 fixation proposal after the accepted H3 refresh supersedes its baseline` requires deferral with no additional append, baseline read, or catch-up.
- Automatic fixation append failure before commit in memory and SQLite leaves the accepted authorization prefix at GitQualifiedPrepared; restart derives the exact same key/event and fixes one session, while the provider-route negative control proves that RunIntegrator cannot reach the provider before this fixed record exists: `packages/orchestrator/src/workflow/protocols/integrator/automatic-successor-session.test.ts::retries a precommit automatic successor fixation from the exact authorization before provider eligibility` and `packages/orchestrator/src/coordination/delivery/delivery-proposal-routes.test.ts::routes automatic S2 through exact provider custody and quarantine recovery`.
- Fixed-session append loss and exact replay after in-memory process loss and reopened SQLite process loss, with no duplicate S2: `packages/orchestrator/src/workflow/protocols/integrator/automatic-successor-session.test.ts::recovers a fixed successor append after memory and reopened SQLite process loss without a duplicate session`.
- The `IntegratorRunStarted` append boundary has two recovery cuts: a precommit failure leaves no start record, provider contact, or writer; a lost acknowledgement reuses the exact committed start after restart. The same test then records one ambiguous provider contact and waits for exact activity-absent evidence before quarantining, without an overlapping writer; it exercises memory and reopened SQLite: `packages/orchestrator/src/coordination/delivery/delivery-proposal-routes.test.ts::recovers an automatic S2 provider start after lost acknowledgement without overlapping or replacing its run`.
- The `PreparedCandidate` result record commits before its append acknowledgement is lost. After in-memory process loss and reopened SQLite process loss, the same fixed automatic S2 session and result resume without another provider call or writer, then the exact `[H2, C]` candidate proof is recorded once: `packages/orchestrator/src/coordination/delivery/delivery-proposal-routes.test.ts::recovers a committed automatic S2 provider result after process loss across memory and reopened SQLite`.
- The `NotPrepared` result record commits before its append acknowledgement is lost. After in-memory process loss and reopened SQLite process loss, Dalph reuses the same fixed S2 and result, records one conclusive quarantine tied to that result, and makes no second provider call or writer: `packages/orchestrator/src/coordination/delivery/delivery-proposal-routes.test.ts::recovers a committed automatic S2 NotPrepared result after process loss across memory and reopened SQLite`.
- A committed `IntegratorRunCandidateGitObserved` record proves that the exact `PreparedCandidate` is invalid; after its acknowledgement is lost, memory and reopened-SQLite recovery derives one conclusive `InvalidCandidate` quarantine from that stored observation without a second provider call or candidate read: `packages/orchestrator/src/coordination/delivery/delivery-proposal-routes.test.ts::recovers a committed automatic S2 CandidateRejected result after process loss across memory and reopened SQLite`.
- Ambiguous provider outcome, no fabricated absence or Q, and the explicit provider-activity-absent to Q path for the exact automatic S2 run: `packages/orchestrator/src/coordination/delivery/delivery-proposal-routes.test.ts::routes automatic S2 through exact provider custody and quarantine recovery`.
- An ambiguous provider call records neither `IntegrationProviderRunActivityAbsent` nor `IntegrationQuarantined`; only exact provider-confirmed absence commits the former. The test then exercises the following `IntegrationQuarantined` append failing before commit and committing with a lost acknowledgement; after process loss, memory and reopened SQLite replay the exact absence and Q without another provider boundary: `packages/orchestrator/src/coordination/delivery/delivery-proposal-routes.test.ts::recovers automatic S2 provider-absence quarantine append cuts after process loss across memory and reopened SQLite`.
- The canonical provenance boundary proves provider-activity absence for an exact S1→S2→S3 predecessor chain through both raw-array and indexed Journal evidence. The same test rejects missing, duplicate, malformed, or foreign-owner automatic S2 evidence; missing, wrongly keyed, or wrongly owned direct S1 evidence; absent S1 lineage; indexed malformed S2 ancestry; and duplicate indexed S3 fixation: `packages/orchestrator/src/workflow/protocols/integration-quarantine/provider-failure.test.ts::covers exact fixed-session, run-start, and provider-evidence boundary contradictions`. This S3 case validates absence only; the S2 route and append-cut cases above prove the shared quarantine append and memory/reopened-SQLite reconciliation suffix.
- A separately authorized FullRerun S2 that later encounters a compatible competing head may be the exact predecessor for same-C automatic S3. The fixture reaches FullRerun through the existing conclusive provider-failure Q/D/fresh-lineage path, then records the S2 candidate, competing-head authorization, catch-up, fresh lineage, and S3 fixation. The provider-absence boundary accepts this exact chain through raw and indexed Journal evidence and rejects it if the exact S1 fixation or FullRerun disposition record is absent; it does not synthesize FullRerun or exercise #386 exhaustion-grant lifecycle: `packages/orchestrator/src/workflow/protocols/integration-quarantine/provider-failure.test.ts::validates automatic S3 after an independently authorized FullRerun S2`.
- Ordinary Operator Retry after automatic S2 itself reaches a conclusive Q starts ordinal two only after exact Operator D and fresh same-head L. The restarted route test proves no provider call or run start without D, then records the actual ordinal-two start; state reconstruction binds it to the exact automatically fixed S2 and its own auth/predecessor chain: `packages/orchestrator/src/coordination/delivery/delivery-proposal-routes.test.ts::restarts into an explicitly authorized Retry route for automatic S2's own conclusive quarantine` and `packages/orchestrator/src/workflow/protocols/integrator/automatic-successor-session.test.ts::authorizes ordinary Retry only from the exact automatically fixed S2 and its own quarantine`. The formal positive and missing-Operator-D negative controls are `specs/acceptedResultIntegration_automaticSuccessor_proof_test.qnt::exactOperatorRetryOfAutomaticS2AfterConclusiveQTest` and `specs/acceptedResultIntegration_automaticSuccessor_proof_negative_test.qnt::automaticSuccessorRunTwoCannotStartWithoutExactOperatorRetryTest`; the FullRerun ordinal-one-only boundary remains covered by `packages/orchestrator/src/workflow/protocols/integrator/reconstruction.test.ts::promotes only one chronologically complete FullRerun successor`.
- Ordinary Operator Retry also applies to automatic S3 after its own conclusive Q. The exact S1→S2→S3 automatic-fixation chain, S3-bound Operator D and fresh same-head L authorize one ordinal-two run for S3; the route test asserts both automatic authorizations, baseline reads, and successor fixations occur once, and the retry contacts the Integrator once with S3's exact identity: `packages/orchestrator/src/coordination/delivery/delivery-proposal-routes.test.ts::retries exact automatic S3 after its own quarantine without duplicating successor effects`.
- Superseded predecessor cleanup derives a distinct exact S2 disposition, preserves when a controlled provider boundary reports `LiveWriter`, and permits Remove only after a controlled exact-owner/quiescent observation followed by post-removal Absent evidence: `packages/orchestrator/src/workflow/protocols/disposition-cleanup/integrator-candidate.test.ts::preserves an automatically superseded candidate until provider custody proves its writer stopped`. Production SQLite cleanup retains the exact automatic-S2 predecessor while its writer is live, removes it once after quiescent exact-owner evidence, and reconciles one lost deletion response after reopening without a duplicate remove: `packages/orchestrator/src/workflow/protocols/disposition-cleanup/production.test.ts::production SQLite cleanup preserves an automatic S2 predecessor while its writer is live and reconciles one lost deletion response after reopen`. The Codex provider boundary likewise retains an automatically superseded candidate while Codex reports live owned activity and removes it only after writer-stop evidence: `packages/dalph/src/application/codex-integrator-cleanup.test.ts::keeps an automatically superseded candidate until Codex proves the writer stopped`.
- Finality cleanup derives a separate `Settled` authorization for the exact automatically fixed S2 session, candidate, `[H2, C]` parents, and deletion operation while retaining the predecessor's distinct supersession authorization: `packages/orchestrator/src/workflow/protocols/disposition-cleanup/activation.test.ts::derives finality cleanup for an exact automatically fixed S2 candidate`.
- Historical trace exposes the Dalph authorization, exact auto-fixed session and predecessor preservation without emitting the FullRerun disposition: `packages/orchestrator/src/presentation/trace-reader.test.ts::projects automatic S2 authorization and predecessor preservation as distinct coordinator facts`.
- Outside work advances the remote head before discovery; the formal recovery oracle is `specs/acceptedResultIntegration_automaticSuccessor_proof_test.qnt::beforeDiscoveryCatchesUpExactAncestorAndFixesOneSuccessorTest`.
- Fresh activation reuses exact H2 lineage only when its pinned Git target and same-attempt evidence remain eligible; a newer graph requires exact claim refresh, a graph after that claim, then fresh lineage before publication: `packages/orchestrator/src/coordination/run/recovery-activation.test.ts::reuses exact H2 lineage after fresh activation and publishes the qualified automatic successor` and `packages/orchestrator/src/coordination/run/recovery-activation.test.ts::requires fresh lineage and blocks successor publication after a newer target graph observation`. These are projection tests; they do not prove a real-Git race placement.
- The real-Git runtime placements are before publication discovery (`packages/dalph/test/scenarios/hermetic-mvp.test.ts::recovers a competing remote head found before publication discovery through the automatic S2 full suffix`), between discovery and update (`packages/dalph/test/scenarios/hermetic-mvp.test.ts::recovers a competing remote head advanced between publication discovery and update through the automatic S2 full suffix`), and after a lost push response (`packages/dalph/test/scenarios/hermetic-mvp.test.ts::recovers a competing remote head advanced after a lost publication response through the automatic S2 full suffix`). In the lost-response placement, after Dalph enters the M-push adapter boundary, the fixture advances the bare remote to H2 and calls one real `gitAuthority.push` for M against H2. Git returns `RejectedNonFastForward`; the wrapper suppresses that response as ambiguous `ResponseDeadline` and verifies the remote ref remains at H2, so the test claims no M publication for that attempt. The next workflow activation performs real-Git discovery of H2, then the same-C `[H2, C]` successor reaches publication, local promotion, fresh tracker finality, exact cleanup, and termination with one task Begin.
- Outside work advances the remote head between discovery and push; the formal recovery oracle is `specs/acceptedResultIntegration_automaticSuccessor_proof_test.qnt::betweenDiscoveryAndPushUsesSameHeadAndProviderRunAfterRecoveryTest`.
- The competing push response is lost before authorization recovery; the formal recovery oracle is `specs/acceptedResultIntegration_automaticSuccessor_proof_test.qnt::lostPushResponseAndAuthorizationCutRecoverFromReopenedSQLiteTest`.
- One shared session-capacity rule counts both predecessor and successor identities and excludes foreign responsibilities: `packages/orchestrator/src/workflow/protocols/integrator/automatic-successor-session.test.ts::counts predecessor and successor identities together against the shared session capacity`. The frontier projection derives `FrontierExplanation.BoundedRetainedWait` and retains the exact compatible-head wait after the third automatic successor: `packages/orchestrator/src/coordination/frontier/integration-frontier-transitions.test.ts::retains the exact compatible-head wait after the third automatic successor`. Separately, the formal bound oracle models the third session and third publication intent exhausting the initial batch without a fourth: `specs/acceptedResultIntegration_automaticSuccessor_proof_test.qnt::thirdSessionAndThirdPushExhaustWithoutUnrequestedFourthSessionTest`. A production workflow run now advances the real bare remote through H2, H3, and H4, retains H4 after one initial and two automatic successor sessions, and proves three candidate push intents with no fourth session, push, promotion, or task completion: `packages/dalph/test/scenarios/hermetic-mvp.test.ts::retains the exact third competing head without an ungranted fourth automatic session or push`.
- Controlled unsafe automatic-S2 catch-up retains typed evidence without moving the target or fixing a successor: `packages/orchestrator/src/workflow/protocols/direct-publication/automatic-successor-baseline-recovery.test.ts::retains unsafe automatic S2 catch-up evidence without moving the target or fixing a successor`. Real-Git catch-up safety then exercises seven authorized-S2 local states using `packages/orchestrator/src/workflow/protocols/direct-publication/automatic-successor-real-git-safety.test.ts::automatic S2 real-Git catch-up safety::retains exact authorized S2 without changing Git state when $name`: local target ahead of H2, local target diverges from H2, clean local target checked out, dirty checked-out target retaining staged/unstaged/file state, target ref resolving through symbolic ownership, target branch checked out in a foreign linked worktree, and ambiguous worktree inventory. Every case retains the exact S2 authorization, leaves local and remote target refs and worktree state unchanged, fixes no successor, and performs no `update-ref`; the formal safety oracle is `specs/acceptedResultIntegration_automaticSuccessor_proof_test.qnt::unsafeLocalWorkKeepsTypedDispositionAndNoCatchUpTest`.
- Production Run activation receives Pause or Exit immediately after exact automatic-S2 authorization and performs no baseline read, catch-up, successor fixation/provider start, publication, promotion, or tracker mutation; Pause retains FIFO and Exit preserves its cutoff: `packages/dalph/test/scenarios/publication-composition.test.ts::Pause after automatic S2 authorization retains FIFO without baseline or successor effects` and `packages/dalph/test/scenarios/publication-composition.test.ts::Exit at automatic S2 authorization preserves the cutoff without starting a successor`.
- Pause retains the authorized S2 without later effects; the formal lifecycle oracle is `specs/acceptedResultIntegration_automaticSuccessor_proof_test.qnt::pauseRetainsAuthorizedSuccessorWithoutForwardEffectsTest`.
- Exit retains the authorized S2 at the cutoff; the formal lifecycle oracle is `specs/acceptedResultIntegration_automaticSuccessor_proof_test.qnt::exitRetainsAuthorizedSuccessorAtCutoffTest`.
- The independent negative control proves a second pre-fixation Git read in one activation violates the accepted bound: `specs/acceptedResultIntegration_automaticSuccessor_proof_negative_test.qnt::secondPreFixationGitReadInOneActivationIsDetectedTest`.

The provider absence-to-quarantine append cut is mapped above. A ResponseDeadline while reconciling a committed catch-up intent is covered as pending and retried only on a later activation; it is not evidence of conclusive non-application. The controlled cleanup test proves the journaled exact predecessor relation and fail-closed custody protocol, not provider-specific behavior. The named authorization and fixed-session tests cover authorization append failure before commit, append-commit loss and exact replay in memory and reopened SQLite, plus fixation append failure before commit; the named baseline tests separately cover precommit read-intent/observation failure and retry, a catch-up CAS before result durability, a LocalAncestor observation before its acknowledgement is lost, a catch-up-intent append whose acknowledgement is lost and exact one-boundary recovery, a committed catch-up result before its acknowledgement is lost, and the ResponseDeadline-before-later-CAS recovery path. The generic initial-baseline characterization and Quint projection are supporting evidence and do not close these S2 runtime edges.

Not applicable to S2 authorization: there is no Operator request or task-executor Begin/Resume command. The same existing accepted task attempt remains the unit of work; its tracker facts and Git lineage are reread through their owning authorities before fixation and delivery.

Ordinary non-force push can recreate its explicitly named branch if that branch
vanishes during the invocation. We retain ordinary Git semantics: initial
admission and an observed missing-ref result stop, but there is no additional
atomic no-recreation guarantee. No other branch or deletion is authorized.
Git reference behavior is documented in [git-push](https://git-scm.com/docs/git-push);
per-ref success comes from the receiving server's
[status report](https://git-scm.com/docs/pack-protocol#_report_status).

## Bounds and user-authorized continuation

Issue #384 fixes the initial finite allowance at **three Integrator sessions per
batch**, including the first, and **three publication intents per candidate per
batch**. Fixing a session consumes one cycle even if the process dies before
provider contact. Restoring it, observing Git, or retrying its exact push does
not consume another cycle. Automatic preparation failures retain existing
quarantine rules. Repeated pre-fixation reads use bounded reactivation, not a
new provider session or a tight loop.

Allow at most **three push intents per candidate per authorized batch**. An
intent consumes allowance even if the process dies before sending. Ordinals
remain globally increasing for that request; a batch grant never rewrites them.
Use 30 seconds for a remote observation including ancestry retrieval and
120 seconds for a push. Existing Integrator limits remain unchanged. Timeout
interrupts local waiting and requires sender cleanup/custody evidence; it does
not prove that the remote update failed or that the server stopped processing.

After either allowance is exhausted, reconcile read-only if needed and record
an exhaustion reason against the retained integration session using the existing
quarantine control path. Keep all required work; stop automatic sends and
successors; release process-local permits. An unsettled responsibility prevents
completed Run termination, while unrelated targets remain eligible. The initial
slice reports this precise retained wait and starts no ungranted fourth action.

Issue #386 owns the later Operator **Full rerun** direction for an exact
publication-exhaustion occurrence and the rules for one new bounded batch. #384
does not edit counters, fabricate a grant, or use a grant to reuse a candidate.
The prior history, consumed ordinals, candidate, and integration responsibility
remain available for that later issue; unrelated targets remain eligible.

## Resume retained delivery after a temporary failure

Issue #387 owns the transport-neutral **resume retained delivery** operation.
Its subject is the exact Run and integration responsibility, with a request
identity for deduplication. Acceptance means the request was recorded, not that
publication or task completion succeeded. Exact redelivery returns the recorded
result without authorizing another mutation. It adds no budget, overrides no
Pause, and creates no task attempt. Issue #384 supplies the retained waits and
proofs that this operation must later consume.

Alice repairs credentials, connectivity, policy or the missing Git facts, then
requests resumption. Dalph reads the retained history, reconciles unfinished
intents and local writer custody, and refreshes only facts needed by the next
unfinished boundary. It then selects the existing action:

- Publication already proved: keep the proof and continue local promotion or
  tracker finality, subject to current permission and any known contradiction.
- Publication uncertain: reconcile by the same safe push or a remote read.
- Candidate still publishable: reuse M and the remaining push allowance.
- Compatible competing head: integrate the same C under remaining cycle allowance.
- Budget exhausted or a constraint remains: report that precise wait; do not
  manufacture a grant or start another task.

This also handles ordinary recovery after a transient read failure. Restart or
timer wake alone does not authorize retry of a conclusively denied mutation;
authentication/policy denial needs the explicit resumption request and refreshed
facts. A still-denied attempt stops again. Throttled mutations remain prohibited
from retry under this specification, including through resume or a budget grant.
Future recoverable causes extend this same decision table and their tests,
rather than adding provider-specific retry commands or a second recovery engine.

If Dalph dies after recording resume but before activation, restart consumes the
same recorded request through the ordinary owner. Actual push/session intents
and outcomes govern effects; neither repeating resume nor process loss permits
duplicate work or resets allowance. A settled subject returns its actual settled
status and starts no work. Schema/identity mismatches fail before mutation.

### Lower-priority public control exposure

The shipped CLI currently exposes `run`, not Full rerun or the retained-delivery
operation. #386 and #387 own the internal controls first; a later public-control
follow-up must expose a minimal public way to select the exact retained subject
and submit/read its idempotent request. Command spelling and transport wiring
belong to that follow-up; the semantic contracts and core tests remain scoped to
their owning issues.

This does not block the first uninterrupted disposable dogfood delivery or
controlled proof of these operations. It does block claiming that an operator
can recover a real failed/exhausted run through the shipped CLI. Until the public
path exists, report that limitation; do not instruct Alice to edit the Journal
or invoke an undocumented private script. No separate counter-reset interface
or broad remote-control milestone is required.

## Crash, completion and Exit rules

Intent must be acknowledged before every uncertain push, catch-up, promotion or
tracker mutation. The result is then recorded. Recovery selects the same R and
reconciles each owning boundary; it never records a synthetic crash event.

A conclusive non-fast-forward response records
`RemotePublicationAttemptRejectedNonFastForward` with the exact request and
consumed ordinal before returning to the publication wait. Restart retains that
known rejection; it still proves stopped sender custody and obtains the required
fresh remote observation before considering the next ordinal. It must neither
reuse that ordinal nor manufacture publication proof. A lost result remains
ambiguous. `direct-publication/state.test.ts` covers orphan, duplicate,
wrong-ordinal and contradictory results; `direct-publication/recovery.test.ts`
covers a crash immediately after this append in memory and reopened SQLite;
`direct-publication/protocol-engine.test.ts` retains the three-intent/no-fourth
bound. Successful push handling remains unchanged and adds no remote read.

For #384, the recovery matrix covers initial baseline catch-up, publication,
local promotion, completion, Exit, and conclusive-proof cuts. The successor-authorization,
additional-batch, and retained-resume rows remain parent requirements whose
implementation evidence belongs to #385, #386, and #387 respectively.

| Crash cut | Required continuation |
| --- | --- |
| Before/after push intent; applied or unapplied send; lost response; response before durable append | Preserve consumed ordinals; resolve ambiguous journal appends; reconcile using the same idempotent push or remote read. Never infer non-application or overlap local senders. |
| Automatic successor authorization before fixation | Dalph records its own exact competing-head authorization before the baseline Git boundary and recovers a post-commit lost acknowledgement without a duplicate event or Git read: `packages/orchestrator/src/coordination/delivery/automatic-successor-authorization-recovery.test.ts::recovers a lost automatic authorization acknowledgement without another Git read across memory and reopened SQLite`. Remaining authorization crash cuts are listed in the S2 acceptance mapping below. |
| Local catch-up intent/effect/result cuts | A committed #385 intent survives a pre-CAS stop as CatchUpPending after ambiguous `ResponseDeadline`; a later activation reconciles exact old H and applies one CAS. The same intent, zero CAS at the deadline, one later CAS, one remote read, and unchanged authorization/session are verified in memory and reopened SQLite by `automatic-successor-baseline-recovery.test.ts::keeps an ambiguous ResponseDeadline catch-up pending until a later activation reconciles the exact old head`. A conclusive `Rejected` (unapplied) result instead reduces to retained divergence and is not treated as pending or retried: `baseline-state.test.ts::rejects a catch-up result that does not bind its exact observed heads`. If CAS applies before result append, restart settles the same intent; if result append commits but its acknowledgement is lost, replay accepts exact Ready history with no new Git boundary: `automatic-successor-baseline-recovery.test.ts::reconciles one applied automatic-successor catch-up CAS after memory and reopened SQLite process loss`; `automatic-successor-baseline-recovery.test.ts::replays a committed automatic-successor catch-up result after lost acknowledgement without another Git boundary`. A completed H2 round refreshed to H3 uses one new round under the exact H2 authorization; after its CAS applies but before result observation, memory and reopened SQLite reconcile the same round-two intent without another remote read: `automatic-successor-baseline-recovery.test.ts::reconciles the same H3 refresh catch-up after memory and reopened SQLite process loss without another read`. |
| Fixed session before provider contact or during execution | Restore the same session; never allocate another cycle solely because the host died. #385 covers precommit fixed-session recovery in `packages/orchestrator/src/workflow/protocols/integrator/automatic-successor-session.test.ts::retries a precommit automatic successor fixation from the exact authorization before provider eligibility`, and provider-start precommit/commit-lost-ack recovery plus one exact provider call and no overlapping replacement writer in memory and reopened SQLite in `packages/orchestrator/src/coordination/delivery/delivery-proposal-routes.test.ts::recovers an automatic S2 provider start after lost acknowledgement without overlapping or replacing its run`. The adjacent exact custody, ambiguous-response and ProviderActivityAbsent-to-Q continuation is `packages/orchestrator/src/coordination/delivery/delivery-proposal-routes.test.ts::routes automatic S2 through exact provider custody and quarantine recovery`. |
| Remote proof before local promotion, or local promotion before observation | Retain conclusive remote proof and reconcile local promotion; no remote read or reintegration solely because the process restarted. |
| Full rerun grant committed before new work | **Deferred to #386.** Resume the one granted batch with unchanged history; no repeated user request required. |
| Resume request recorded before activation | **Deferred to #387.** Resume the same recorded request; ordinary boundary intents prevent duplicate effects, and allowance is unchanged. |
| Completion request applied or unapplied before response | Reconcile exact GitHub completion first. Record applied success without another close, push or reopen; retry an unapplied close only with fresh permission. |

Durably recorded successful publication remains proof across restart, wait,
Pause and completion retry. These events alone require no remote containment
read or repeated push. Reconcile uncertain publication by safe push or remote
read; resolve a known contrary observation before new completion. Historical
proof is retained, not erased by the contradiction. Existing current local Git,
revision/claim/dependency requirements remain independent. Human early closure
is tracker evidence, never publication proof, and cannot silently settle an
outstanding publication responsibility.

Git and GitHub closure are separate transactions. Neither a push acknowledgement
nor a subsequent read prevents an outside rewrite before closure applies or
after delivery settles. Report known contradictions without inventing atomicity,
force-pushing, reopening successful tasks, or promising perpetual monitoring.

On 2026-09-20 the maintainer reaffirmed the no-extra-read rule for #384:
after Git confirms publication, Dalph does not add a remote check before closing
the task. The current supported workflow has no later remote observation before
that close. Adding a trigger to detect a subsequent branch rewrite is follow-up
work; #384 must not claim that detection from malformed journal history or a
synthetic observation. Historical proof and current tracker permission remain
separate requirements.

On Ctrl-C/SIGTERM, the existing Exit cutoff forbids fresh pushes, reconciliation,
successors, completion or durable cleanup. Within the existing drain, record
already-produced results and stop owned local writers. Report the actual Exit
result and retain R; uncertain custody cannot be reported as stopped. Restart
uses the table above. Publication timeouts do not extend the Exit drain.

## Scenario-to-test mapping

Each scenario below specializes the normal starting facts or names its override.
The normal chronology plus these variants supplies actors, triggers, ordered
boundaries, crash/retry outcomes and forbidden effects. Every named test is a
required implementation seam. Prove forbidden outcomes under the governing
D invariants and extended models, not solely by replaying a successful cassette.

| Scenario and visible outcome | Required test owner/name and decisive evidence |
| --- | --- |
| **S1: Alice starts one fresh task; delivery succeeds.** Execute the normal chronology with no crash/retry. She sees separate remote publication, local promotion and confirmed closure. | Planned seams: `packages/orchestrator/src/workflow/protocols/direct-publication/admission.test.ts::admits one pinned endpoint and branch before claim and restores the prior admission without another Git read`; `packages/dalph/test/cassettes/direct-remote-publication.test.ts::publishes M before local promotion and task completion`. Real Git plus a distinct bare remote, SQLite and controlled providers must assert exact order and identities, one Begin, zero redundant post-push workflow reads, independent remote ancestry, and no premature claim replacement/close/cleanup/dependant release. |
| **S2: Outside work advances remote H to H2 without M.** Exercise before push discovery, between discovery/update and after a lost response. Dalph prepares M2 and completes automatically; Alice does nothing. | Implemented focused seams: `packages/orchestrator/src/coordination/frontier/integration-frontier-transitions.test.ts::authorizes one automatic successor for a compatible competing remote head without Operator direction`; `packages/orchestrator/src/coordination/delivery/integration-delivery-action-adapter.test.ts::appends automatic successor authorization before baseline and catch-up CAS and defers stale-prefix authorization without Git`; `packages/orchestrator/src/coordination/delivery/automatic-successor-authorization-recovery.test.ts::recovers a lost automatic authorization acknowledgement without another Git read across memory and reopened SQLite`; `packages/orchestrator/src/coordination/frontier/integration-frontier-transitions.test.ts::reuses one successor authorization when a compatible resume receipt follows authorization before fixation`; `packages/orchestrator/src/workflow/protocols/direct-publication/automatic-successor-baseline-recovery.test.ts::recovers precommit automatic-successor baseline intent and observation failures with one read per activation`; `packages/orchestrator/src/workflow/protocols/direct-publication/automatic-successor-baseline-recovery.test.ts::recovers the exact automatic-successor baseline observation after a lost acknowledgement and then catches up once`; `packages/orchestrator/src/workflow/protocols/direct-publication/automatic-successor-baseline-recovery.test.ts::reconciles one applied automatic-successor catch-up CAS after memory and reopened SQLite process loss`; `packages/orchestrator/src/workflow/protocols/direct-publication/automatic-successor-baseline-recovery.test.ts::keeps an ambiguous ResponseDeadline catch-up pending until a later activation reconciles the exact old head`; `packages/orchestrator/src/workflow/protocols/direct-publication/automatic-successor-baseline-recovery.test.ts::recovers a committed automatic-successor catch-up intent after lost acknowledgement with one reconciliation`; `packages/orchestrator/src/workflow/protocols/direct-publication/automatic-successor-baseline-recovery.test.ts::replays a committed automatic-successor catch-up result after lost acknowledgement without another Git boundary`; `packages/orchestrator/src/workflow/protocols/integrator/automatic-successor-session.test.ts::projects and fixes one automatic successor after the exact competing-head catch-up and fresh lineage`; `packages/orchestrator/src/workflow/protocols/integrator/automatic-successor-session.test.ts::retries a precommit automatic successor fixation from the exact authorization before provider eligibility`; `packages/orchestrator/src/workflow/protocols/integrator/automatic-successor-session.test.ts::recovers a fixed successor append after memory and reopened SQLite process loss without a duplicate session`; `packages/orchestrator/src/coordination/delivery/delivery-proposal-routes.test.ts::recovers an automatic S2 provider start after lost acknowledgement without overlapping or replacing its run`; `packages/orchestrator/src/coordination/delivery/delivery-proposal-routes.test.ts::recovers a committed automatic S2 provider result after process loss across memory and reopened SQLite`; `packages/orchestrator/src/coordination/delivery/delivery-proposal-routes.test.ts::recovers a committed automatic S2 NotPrepared result after process loss across memory and reopened SQLite`; `packages/orchestrator/src/coordination/delivery/delivery-proposal-routes.test.ts::recovers a committed automatic S2 CandidateRejected result after process loss across memory and reopened SQLite`; `packages/orchestrator/src/coordination/delivery/delivery-proposal-routes.test.ts::routes automatic S2 through exact provider custody and quarantine recovery`; `packages/orchestrator/src/coordination/delivery/delivery-proposal-routes.test.ts::recovers automatic S2 provider-absence quarantine append cuts after process loss across memory and reopened SQLite`; `packages/orchestrator/src/workflow/protocols/disposition-cleanup/activation.test.ts::derives finality cleanup for an exact automatically fixed S2 candidate`; `packages/orchestrator/src/workflow/protocols/disposition-cleanup/production.test.ts::production SQLite cleanup preserves an automatic S2 predecessor while its writer is live and reconciles one lost deletion response after reopen`; `packages/dalph/src/application/codex-integrator-cleanup.test.ts::keeps an automatically superseded candidate until Codex proves the writer stopped`; `packages/dalph/test/scenarios/publication-composition.test.ts::Pause after automatic S2 authorization retains FIFO without baseline or successor effects`; `packages/dalph/test/scenarios/publication-composition.test.ts::Exit at automatic S2 authorization preserves the cutoff without starting a successor`; the unsafe-catch-up retention test (`packages/orchestrator/src/workflow/protocols/direct-publication/automatic-successor-baseline-recovery.test.ts::retains unsafe automatic S2 catch-up evidence without moving the target or fixing a successor`), and the projection-only lineage cases named above. Cleanup, Retry, trace, formal projection outcomes, the bounded-read negative control, the three real-Git placements below, and production three-session/three-push exhaustion (`packages/dalph/test/scenarios/hermetic-mvp.test.ts::retains the exact third competing head without an ungranted fourth automatic session or push`) are named above. |
| **S3: An identical push repeats or remote N already contains M.** Dalph reports publication, not failed delivery or new integration. | Planned seams: `packages/orchestrator/src/authorities/git/direct-publication.test.ts::pushes the exact candidate, recognizes up-to-date, and rejects stale non-fast-forward updates` and `packages/orchestrator/src/authorities/git/direct-publication.test.ts::observes exact current, both safe fast-forward directions, compatible competition, unrelated history, and a missing branch`. Assert exact repeat/up-to-date, safe fast-forward when the head differs from original H, and rejection of equal-content foreign commits, insufficient ancestry, dry-run proof, force, backward, or extra-ref mutation. |
| **S4: Repeated races or transport failures exhaust allowance.** Work remains retained after the finite batch. | Initial #384 seam: `packages/orchestrator/src/workflow/protocols/direct-publication/protocol-engine.test.ts::retains exact exhaustion without an ungranted fourth push intent`; assert three sessions, three intents, consumed-but-unsent ordinals, precise wait, and unrelated-target progress. **Deferred to #386:** duplicate grant, crash-after-grant, successor-generation exhaustion, and reuse of an already-published or publishable M. |
| **S5: Host dies at each initial publication/finality cut.** Replacement host continues the same Run and work. | Initial #384 seam: `packages/orchestrator/src/workflow/protocols/direct-publication/recovery.test.ts::recovers every initial remote delivery boundary`; exercise intent-before-send, applied/unapplied effects, lost response, ambiguous append, proof-before-promotion, promotion-before-observation, stopped-sender custody, and both stores. Initial catch-up uses `direct-publication/baseline-recovery.test.ts::recovers the initial remote baseline across memory and reopened SQLite journals`; real host death uses `packages/dalph/src/application/git-sender-custody.real-host.test.ts`. #387 adds `packages/orchestrator/src/workflow/protocols/direct-publication/resume.test.ts::recovers the same retained resume receipt after restart with memory and reopened SQLite journals` for a crash after receipt and before activation, plus `::reconciles the active receipt after an ambiguous push before any later push` to prove custody and pinned-head observation precede a later push. The incompatible-lineage continuation is covered by `::keeps unchanged incompatible lineage retained with no push in memory and reopened SQLite` and `::uses repaired compatible facts to prove the same candidate in memory and reopened SQLite`: reopening preserves the same receipt and C/S history, while unchanged facts require no custody preparation or push and fresh candidate-current proof follows the existing path. For the post-receipt crash cut after `RemotePublicationRetained(CompatibleCompetingHead)` commits and before selector wake, #387 adds `packages/orchestrator/src/workflow/protocols/direct-publication/resume.test.ts::replays the exact compatible-head continuation after restart from memory and reopened SQLite journals`, `packages/orchestrator/src/coordination/delivery/integration-delivery-action-adapter.test.ts::replays the retained compatible head through the ordinary Run selector after restart`, and `packages/orchestrator/src/coordination/frontier/integration-frontier-transitions.test.ts::reuses one successor authorization when a compatible resume receipt follows authorization before fixation`. These prove the exact request/C/target/mergeBase/head retained occurrence and ordinary-frontier reactivation after restart. The concrete same-commit successor authorization and recovery remain owned by #385. `packages/orchestrator/src/workflow/protocols/direct-publication/state.test.ts::accepts only exact reconciled proof from the active resume receipt and its latest retained attempt` verifies durable reduction of proof completed directly from a resume receipt. `packages/orchestrator/src/coordination/delivery/integration-delivery-action-adapter.test.ts::ordinary Run replay leaves the exact compatible head for the normal frontier selector` exercises the production action boundary and exact handoff; the concrete #385 owner remains an integration dependency. These tests do not substitute for promotion and tracker-close recovery. **Deferred:** successor cuts #385 and grant cuts #386. |
| **S5 successor recovery: host dies during the automatic H3 refresh catch-up.** Replacement host continues the same Run and work. | Initial #384 seam: `packages/orchestrator/src/workflow/protocols/direct-publication/recovery.test.ts::recovers every initial remote delivery boundary`; exercise intent-before-send, applied/unapplied effects, lost response, ambiguous append, proof-before-promotion, promotion-before-observation, stopped-sender custody, and both stores. Initial catch-up uses `direct-publication/baseline-recovery.test.ts::recovers the initial remote baseline across memory and reopened SQLite journals`; its focused CAS-race check is `baseline-recovery.test.ts::retains a catch-up ref race and requires a fresh baseline before another attempt`, with the same controlled race also exercised in both memory and reopened SQLite. The raced ref remains untouched; durable `Rejected` evidence retains the exact expected local, observed local, and remote heads as `CatchUpChanged`. It is not classified as divergence without ancestry proof or reclassified as ambiguous pending. Real host death uses `packages/dalph/src/application/git-sender-custody.real-host.test.ts`. #385's exact H3 refresh catch-up cut is `packages/orchestrator/src/workflow/protocols/direct-publication/automatic-successor-baseline-recovery.test.ts::reconciles a pending H3 refresh catch-up through ResponseDeadline before one CAS in memory and reopened SQLite`: round two's exact H2-to-H3 intent survives stop-before-CAS and reopened recovery, `ResponseDeadline` leaves the intent pending with no CAS, and a later activation reconciles that exact old H2 and performs one CAS without another read. Other successor cuts remain in the S2 mapping; grant cuts #386 and resume-after-receipt cuts #387 remain deferred. These tests do not substitute for promotion and tracker-close recovery. |
| **S6: Invalid configuration or real authority failure.** Initial mismatch starts no task work; later failure retains work. | Initial #384 seams: `packages/orchestrator/src/workflow/protocols/direct-publication/admission.test.ts::rejects a changed restart destination before appending or reading Git` and `packages/orchestrator/src/authorities/git/direct-publication.test.ts::keeps authentication and throttling denials distinct without returning diagnostics`. Cover wrong/multiple endpoint, non-branch ref, missing initial branch, changed restart destination, unfinished history without destination, duplicate mappings, missing ref/ancestry, unsafe local state, and no credentials/raw diagnostics in journal/status. #387 adds `packages/orchestrator/src/workflow/protocols/direct-publication/resume.test.ts::rejects resume schema and exact Run or responsibility mismatches before journal mutation`, `::deduplicates one resume identity and allows a later distinct repair request within the same allowance`, `::a persistent denial stops at the accepted attempt limit and cannot be resumed again`, `::does not retry a throttled publication through a retained resume request`, and `::resumes a pre-existing compatible-head wait through the ordinary Run frontier`, with `specs/acceptedResultIntegration_test.qnt::resumePreExistingCompatibleHeadWakesOrdinaryFrontierWithoutMintingWorkTest` covering exact Run/responsibility/request identity, one ordinary-frontier dispatch, unchanged C/session/Integrator counts, and the zero-push compatible-head allowance. The ordinary-frontier regression `packages/orchestrator/src/coordination/frontier/integration-frontier-transitions.test.ts::reuses one successor authorization when a compatible resume receipt follows authorization before fixation` now proves that a compatible competing head remains a precise retained wait with the exact merge base and remote head until the existing #385 successor path is available. Incompatible ancestry adds `packages/orchestrator/src/workflow/protocols/direct-publication/resume.test.ts::keeps unchanged incompatible lineage retained with no push in memory and reopened SQLite` and `::uses repaired compatible facts to prove the same candidate in memory and reopened SQLite`; the paired Quint cases are `specs/acceptedResultIntegration_test.qnt::incompatiblePublicationResumeKeepsUnchangedFactsRetainedWithoutWorkTest` and `::incompatiblePublicationResumeUsesOnlyFreshCandidateCurrentProofTest`; `specs/acceptedResultIntegration_test.qnt::resumeAfterAuthorizedRetryPreservesExistingIntegratorHistoryTest` composes the explicitly authorized same-session Retry with a later retained incompatible-publication wait and asserts the pre-existing second Integrator invocation, exact C/S/responsibility identities, and zero publication ordinals remain unchanged through resume; `specs/acceptedResultIntegration_negative_test.qnt::publicationResumeCannotMintIntegratorWorkAfterAuthorizedRetryTest` proves a third invocation violates the no-mint invariant. The paired incompatible-lineage cases assert a zero-attempt receipt, unchanged incompatibility remaining retained without push, and fresh compatible proof retaining exact C/session/responsibility under the existing ordinal bound. The production `runWorkflow` regression `packages/dalph/test/scenarios/production.test.ts::retains Pause and Exit delivery and quiesces on a compatible-head wait` exercises the receipt-authorized compatible-head case over reopened SQLite and proves the exact retained wait returns without remote Git calls, another attempt, Begin, or Integrator session. The selector-only adapter checks remain narrower. `packages/orchestrator/src/coordination/delivery/integration-delivery-action-adapter.test.ts::ordinary Run replay leaves the exact compatible head for the normal frontier selector` and `::replays the retained compatible head through the ordinary Run selector after restart`; `::ordinary publication replay preserves settled success and conclusive denial without provider work` proves no Begin, Integrator start, attempt, or Git call for settled success and conclusive denial. `packages/dalph/test/conformance/accepted-result-integration.mbt.test.ts::maps core resume admission receipt and exact redelivery into Quint fields` calls the production admission helper used by the Operator control, activates through the ordinary publication runner, and maps receipt-before-attempt-2, same-C/S proof, and exact redelivery into the model projection. |
| **Initial catch-up safety (S5/S6).** Git proves the target is behind before changing an unoccupied direct ref. | `direct-publication-git-characterization.test.ts`: `fast-forwards an unoccupied target and reconciles the applied intent without another mutation`; `rejects a checked-out target without changing its index or files (dirty=%s)` (clean and dirty linked worktrees); `rejects ambiguous worktree inventory and symbolic target ownership before mutation`; `refuses a backward catch-up before mutation`. |
| **Initial baseline cutoff (S7).** Pause or Exit arrives during the baseline read or catch-up. | `direct-publication-cutoff.test.ts`: `Pause during initial baseline observe/catch-up preserves its exact intent and forbids later Git work`; corresponding `Exit` cases retain unresolved intent, and `Exit-produced` cases persist a produced observation/result before releasing the owner. The same one-boundary engine is used in controlled tests and production; `baseline-recovery.test.ts` advances its next action explicitly. |
| **S7: Alice pauses or exits during publication/recovery.** Pause preserves work; Ctrl-C/SIGTERM reports actual Exit disposition. | #387 `packages/orchestrator/src/coordination/delivery/integration-delivery-action-adapter.test.ts::a paused retained Run stops before custody, head observation, or publication boundaries` exercises the ordinary Run action with durable Pause and asserts no sender-custody reconciliation, remote-head observation, preparation, push, journal append, new Run, or new attempt. `packages/orchestrator/src/workflow/protocols/direct-publication/resume.test.ts::application Exit interrupts resume before observation or a new publication attempt` proves Exit interrupts before fresh Git observation or an attempt. `packages/dalph/test/scenarios/production.test.ts::retains Pause and Exit delivery and quiesces on a compatible-head wait` covers the production lifecycle. The protocol-engine tests `::a permitted reconciliation phase retains the same attempt when the sender phase is interrupted` and `::a permitted reconciliation phase records exact proof without preparing or sending` exercise explicitly injected transport-neutral phase permissions; they do not define production Pause behavior. Existing `direct-publication-cutoff.test.ts` owns the boundary-level cutoff evidence. |
| **S8: Current completion premises change after resume.** Starting facts: one Run R already owns task A, accepted task commit C, exact published candidate M, target, and a retained-delivery receipt; no local promotion or task completion has yet been recorded. After the receipt and reconciled publication proof, an outside tracker actor adds an open prerequisite to A, changes A's task revision, or replaces Dalph's claim with another claim. Ordinary `runWorkflow` resumes the same receipt, preserves M's publication proof, promotes that exact candidate locally, then reads the current tracker graph/specification and task-local completion facts at the finality boundary. No process crash is needed for these changes; the established crash/retry rule still covers the separate lost completion response. The person sees the same responsibility retained for a tracker wait: an unfinished prerequisite or changed revision forbids a close, and a foreign claim forbids claim replacement or close. Dalph keeps R/A/C/M/target and the exact candidate resource; it does not begin another task attempt, start another Integrator session, repeat publication, complete the tracker task, release a foreign claim, or clean up the candidate before finality settles. Publication proof alone does not settle the responsibility: exact resume continues ordinary Run while local promotion or tracker finality remains, and accepted `IntegrationFinalitySettled` evidence gates the no-dispatch final status. | `packages/dalph/test/scenarios/production.test.ts::ordinary production Run retains resumed finality when a dependency becomes unfinished`, `::ordinary production Run retains resumed finality when the task revision changes`, and `::ordinary production Run retains resumed finality when its claim is replaced` use ordinary `runWorkflow` with the integrated production interpreter. The dependency case records the fresh complete graph and focused unfinished prerequisite; the revision case records the fresh changed task fingerprint; the claim case observes and preserves the foreign active claim before replacement. All three require exact resumed Run/proof/candidate/promotion identities, no completion attempt or acknowledgement, no finality settlement or candidate cleanup, and no duplicate Begin/session/publication/executor/provider work. The unchanged-premise/lost-response sibling is `::ordinary production Run retries resumed finality after a lost completion response and returns status after settlement and termination`; it reconciles the exact request as `NotApplied`, retries once, and records one applied completion without publication or integration work. Its Operator boundary assertions observe a real `IntegrationFinalitySettled` append, pause the next tracker graph read while the Run remains active, and prove a fresh exact request returns `RemotePublicationResumeStatus` with the same proof and no journal change, owner wake, Git call, publication retry, allowance, session, or task Begin. Releasing the graph-read barrier lets ordinary production write `WorkflowRunTerminated`; a second fresh exact request returns the same status without receipt, wake, or work. The same test also checks the lower-level accepted-result endpoint's `ContinueFinality` dispatch while finality is pending and no dispatch after settlement. These S8 cases refine [D28c](../DELIVERY-INVARIANTS.md#integration-and-promotion) and `completionRequestUsesExactPremises` in [integrationFinality.qnt](../../specs/integrationFinality.qnt): current tracker premises independently gate completion while recorded publication proof remains intact. `packages/orchestrator/src/workflow/protocols/integration-finality/completion-task-protocol.test.ts::rejects changed focused task facts before another tracker completion mutation` and its missing/foreign/prerequisite cases remain narrower protocol checks. Public CLI recovery remains deferred. |
| **Deferred public recovery: Alice uses the shipped command after failure/exhaustion.** | #386/#387 internal controls precede a later public-control seam `resumes and grants one batch through the public entry`. Exact retained subject, idempotent request/result, loss/reconnect, same Run, no duplicate grant, and one task Begin must be proven separately; do not claim this from core-control tests. |
| **S1–S8: chronology and forbidden paths.** | `packages/dalph/test/cassettes/direct-remote-publication.test.ts::publishes M before local promotion and task completion, then releases its dependant from a later complete graph`, `packages/dalph/test/scenarios/production.test.ts::retains remote delivery across Pause and Exit`, and `packages/dalph/test/cassettes/capstone.execution.test.ts::maintained deliveryInvariantStoryCapstone executes all 22 beats in one exact Run` cover the maintained publication, lifecycle, cleanup, and finality transcripts. Conformance owners must retain negative controls for wrong candidate/destination, missing proof, unsafe mutation, duplicate successor/grant, reset budgets, early termination, and dependant release before the later complete graph. |
| **S1: one real disposable dogfood task.** | Built production CLI with a named Kimi or Codex profile. The run log must capture exact source/Base/C/M, task/Run/attempt, endpoint/ref, remote acknowledgement and independent hosted-head evidence, local promotion, GitHub confirmation, exact cleanup and termination. No controlled fixture, local-only success, hosted #388 qualification, or provider smoke prompt substitutes. |

### Resume-specific model and conformance mapping

The #387 model and conformance evidence for the four affected chronologies is:

The exact core Operator entry is
`JournaledRunBootstrap.operatorControl.applyRemotePublicationResume(request)`.
It accepts only the transport-neutral request schema (Run, integration
responsibility, request identity, schema version); it derives the current
retained candidate and pinned target from accepted Run history. No caller may
choose a different candidate or target. A schema, Run, or responsibility
mismatch fails before append. A new accepted request returns its durable
receipt position, distinct from any publication or task-completion result.
Exact redelivery returns that same receipt result even after a later request
changes publication state. Only the newly recorded receipt publishes
`WorkflowProgress` to the active Run owner; exact redelivery returns the saved
receipt without another wake or reauthorization of the current request. The
control creates no task Begin, Integrator call, attempt allowance, or successor
authorization.

- **S5, receipt survives a crash before activation:**
  `specs/acceptedResultIntegration_test.qnt::resumeAfterDeniedPublicationUsesSameRunCandidateAndRemainingAllowanceTest`
  records the exact receipt, crosses `recoverCoordinator`, and redelivers it
  before activation while preserving the same candidate, session, Run,
  responsibility, and attempt count. The memory and reopened-SQLite crash cut
  is owned by `packages/orchestrator/src/workflow/protocols/direct-publication/resume.test.ts::recovers the same retained resume receipt after restart with memory and reopened SQLite journals`;
  endpoint-to-model correspondence is checked by
  `packages/dalph/test/conformance/accepted-result-integration.mbt.test.ts::maps core resume admission receipt and exact redelivery into Quint fields`.
  The production admission seams are
  `packages/orchestrator/src/coordination/run/journaled-run-bootstrap.test.ts::records an exact retained-resume request and wakes the ordinary Run only for the first receipt`
  for the inactive stored journal and
  `::does not wake the active Run owner for receipt A after a later resume request B`
  for an established Run activation, proving two newly recorded receipts wake
  the owner while replay of A leaves B's owner signal unchanged. Its controlled
  chronology consumes A through a definite denial and retained A authorization,
  then consumes B through a definite denial and retained B authorization before
  replaying A; the replay causes no third owner wake or Git call;
  the memory and reopened-SQLite crash test calls the same core admission helper
  used by this Operator control before restart, rather than seeding a receipt as
  its only acceptance path.
- **S6, exact subject, repair, and bounded continuation:** the accepted-result
  model cases `resumePreExistingCompatibleHeadWakesOrdinaryFrontierWithoutMintingWorkTest`,
  `incompatiblePublicationResumeKeepsUnchangedFactsRetainedWithoutWorkTest`,
  `incompatiblePublicationResumeUsesOnlyFreshCandidateCurrentProofTest`,
  `throttleResumeRecordsStatusButCannotRetryMutationTest`, and
  `settledDeliveryResumeReturnsStatusWithoutWorkTest` are paired with the exact
  runtime/store and endpoint conformance owners in the S6 row above. Negative
  controls are
  `specs/acceptedResultIntegration_negative_test.qnt::publicationResumeCannotChangeItsRunOrResponsibilityTest`,
  `::publicationResumeCannotAcceptWrongSchemaTest`,
  `::publicationResumeCannotMintIntegratorWorkAfterAuthorizedRetryTest`, and
  `::throttledPublicationCannotBeRetriedThroughResumeTest`.
  `packages/orchestrator/src/coordination/run/journaled-run-bootstrap.test.ts::rejects a wrong Run or responsibility before appending a resume receipt`
  owns core-entry schema/subject rejection, while
  `packages/orchestrator/src/workflow/protocols/direct-publication/resume.test.ts::returns the first exact request result after a later distinct resume succeeds`
  and `::keeps resume request identity Run-wide across a different candidate correlation in memory and reopened SQLite`
  own request-result chronology and storage-level Run-wide identity uniqueness.
  The different-correlation test proves same-key rejection before append in both
  stores. The composed #385/#387 path is also required: one Run owns task A,
  accepted commit C, and its exact FIFO integration responsibility; publication
  is retained for compatible competing head H2. Alice submits an exact retained-
  delivery resume request. The #387 control appends or replays its receipt and
  wakes the ordinary Run owner only for a new receipt; the receipt itself creates
  no Integrator authorization or session. The ordinary frontier must then
  reconcile the latest compatible retained occurrence with any prior automatic
  authorization for that same publication correlation. If the receipt is
  recorded before authorization, Dalph records at most one authorization for
  that correlation. If it is recorded after authorization but before successor
  fixation, Dalph reuses that authorization and fixes at most one S2 at H2. A
  crash/reopen at the latter cut restores the same authorization before fixing
  the same successor. Exact receipt replay adds no wake, authorization, session,
  successor, or task Begin. Every path retains the same Run, A, C, Base B, pinned
  target, and FIFO position; it does not convert the receipt into Operator Full
  rerun, mint a new publication correlation, pass A, or perform a duplicate
  successor mutation.

  If the first retained compatible occurrence reports H2 and Dalph records its
  authorization before Alice's exact resume receipt, the resumed Git read may
  report a later compatible H3 at the same merge base. The ordinary frontier
  reuses the authorization whose deterministic identity is tied to the exact
  earlier H2 occurrence, then selects the latest H3 as the baseline. It does
  not authorize H3 a second time or create another Integrator session. If the
  first H3 baseline observation requires local catch-up, Dalph records that
  deferral for the exact baseline action. Unrelated accepted Journal work may
  advance and unrelated proposals may run during the same activation, but the
  H3 baseline action does not read or compare-and-set again until a fresh Run
  activation evaluates the accepted prefix.

  The focused receipt-after-authorization composition is implemented by
  `packages/orchestrator/src/coordination/frontier/integration-frontier-transitions.test.ts::reuses one successor authorization when a compatible resume receipt follows authorization before fixation`.
  Its H2-to-H3 extension proves the R1 authorization is reused after the exact
  Operator receipt and compatible R2, with the latest H3 selected for baseline
  work and no second authorization.
  The activation-local boundary is owned by
  `packages/orchestrator/src/coordination/delivery/run-delivery-runtime.test.ts::holds a pending H3 baseline action across unrelated accepted work until the next activation while allowing unrelated proposals`.
  It proves one `RemoteBaselineReconciliationPending` result prevents a second
  baseline attempt in that activation even when the accepted prefix advances,
  while a distinct proposal still runs.
  Three additional seams remain planned in
  `packages/orchestrator/src/coordination/delivery/automatic-successor-authorization-recovery.test.ts`:
  `records one successor authorization when a compatible resume receipt precedes authorization`,
  `reconstructs the same successor authorization after receipt-before-fixation crash and reopen`, and
  `replays the exact resume receipt without another authorization or successor`.
  These planned crash/replay cases compose with the #387 ordinary-frontier and
  receipt-recovery cases above, particularly
  `packages/orchestrator/src/workflow/protocols/direct-publication/resume.test.ts::replays the exact compatible-head continuation after restart from memory and reopened SQLite journals`.
  The production Operator no-retry boundary is also covered by
  `packages/dalph/test/scenarios/production.test.ts::ordinary production Run retries resumed finality after a lost completion response and returns status after settlement and termination`:
  fresh exact requests after real finality settlement and after Run termination
  return the preserved proof as status with no receipt, owner wake, or work.
- **S7, Pause and Exit:**
  `specs/acceptedResultIntegration_test.qnt::pauseDoesNotGetOverriddenByAcceptedResumeTest`
  and `::exitDoesNotGetOverriddenByAcceptedResumeTest` exercise the model
  guards; `specs/acceptedResultIntegration_negative_test.qnt::pausedRunCannotExecuteAcceptedPublicationResumeTest`
  is the negative control. The production and boundary tests remain the owners
  named in the S7 row.
  `packages/orchestrator/src/coordination/run/journaled-run-bootstrap.test.ts::an accepted resume request preserves Run Pause and Exit boundaries`
  verifies that the core receipt cannot admit publication work past either
  lifecycle boundary.
- **S8, changed finality premises after resume:**
  `specs/integrationFinality_test.qnt::blockerAfterPromotionPreservesTheSameProofTest`,
  `::s3RevisionCompletionConflictIsTaskLocalTest`, and
  `::s3ForeignCompletionConflictIsTaskLocalTest` cover the independent
  prerequisite, revision, and claim premises; the negative control is
  `specs/integrationFinality_negative_test.qnt::localPromotionOnlyCannotDeriveCompletionClaimTest`.
  `packages/dalph/test/conformance/integration-finality.mbt.test.ts::replays promoted-task completion settlement through production claim protocols and Run finality`
  is the model-linked finality conformance owner and uses
  `integrationFinalityConformanceStep`, which keeps the accepted completion
  claim/finality transitions in the production driver while leaving the
  optional current-remote contradiction observation outside that driver's
  input boundary. The full `step` still includes the contradiction action;
  `specs/integrationFinality_test.qnt::publicationProofSurvivesPauseRestartAndContradictionTest`
  and `specs/integrationFinality_negative_test.qnt::contradictionCannotAuthorizeCompletionTest`
  retain its positive and negative model evidence. The S8 production cases prove
  that ordinary Run composes those current premises with the exact retained
  publication proof and candidate.
  `packages/dalph/test/conformance/accepted-result-integration.mbt.test.ts::maps core resume admission receipt and exact redelivery into Quint fields`
  maps the production admission helper used by the core Operator control into
  the acceptance model, including a new exact receipt after `RemotePublicationSucceeded`,
  proof preservation, exact receipt replay, and no additional publication
  attempt or Integrator call. The corresponding model seam is
  `specs/acceptedResultIntegration_test.qnt::recordProvedPublicationResumeRequestOne`;
  `settledDeliveryResumeReturnsStatusWithoutWorkTest` keeps settled delivery
  read-only. The bootstrap Operator seam
  `packages/orchestrator/src/coordination/run/journaled-run-bootstrap.test.ts::records a post-proof finality continuation and wakes the owner without another publication attempt`
  checks the active-owner wake, unchanged publication proof, no push/new
  attempt/session, and exact replay without a second wake. It also projects the
  accepted history and asserts the exact receipt A → publication proof → receipt
  B order, with both receipts bound to the same candidate; replay of B adds no
  third receipt. A matching
  `IntegrationFinalitySettled` makes a later request status-only; a
  `WorkflowRunTerminated` cutoff continues to reject fresh receipts. The
  finality conformance driver remains limited to supported finality actions.

The provider lifecycle handoff repair is recorded in `eee7243f0`
(`fix(codex): serialize lifecycle attachment with commands`), merged into the
candidate by `8051f891e`. The observed initial attach/Begin race allowed a
passive lifecycle attachment to project the attempt while that attempt's
`Begin` was still in flight. The repair gives the lifecycle projection and
executor commands one per-attempt gate. Its regression test
`serializes the initial lifecycle projection with an in-flight Begin` holds
`turn/start`, starts `Begin` and `attach` concurrently, and proves attachment
cannot settle until `Begin` releases; the focused command passed with 1 test
passed and 178 skipped. This repair changes provider-local sequencing only;
the no-extra-remote-read decision is unchanged. The fresh supervised
disposable S1 journey remains pending.

## Implementation and acceptance boundary

The maintainer accepted this amended chronology on 2026-09-19. Before runtime
work, #384 updates the owning invariants and architecture premises for initial
destination admission, exact publication proof, publication-before-promotion-
before-finality order, initial bounds, retained waits, and Exit/finality
composition. It extends implementation conformance with positive reachability
and independent negative controls through the named seams above. The same
operations must use Effect V4 and one workflow algebra, with existing exact
custody, FIFO ordering, and disposition-typed cleanup. One local target owns
each configured remote branch; local exclusion does not pretend to lock out
remote writers.

#385 owns automatic competing-head successors and successor catch-up; #386 owns
additional-batch grants; #387 owns retained-delivery resumption. Their
acceptance evidence must preserve the #384 facts and order. Automatic successors
need an explicit cleanup disposition; no issue may fabricate Full rerun to reuse
that code. Public control exposure retains the qualification limit stated above.

Use focused scenario tests and `pnpm check:fast`, then the required frozen full
gate for the implementation candidate. Finally run one fresh supervised
disposable S1 dogfood journey after the #390 retained-run closure; do not repair
the retained failed candidate. Record expected
duration and wall-clock stop time before long operations; reconcile retained
Runs before retry, preserve failed evidence and unexecuted suffixes, and never
retry throttled mutations.

The Astra review identified public control exposure, temporary-failure
resumption, mandatory revalidation of conclusive proof, and a prescribed
observation-resource lifecycle. Public wiring, competing-head successors,
additional grants, and retained resumption remain explicitly assigned to their
owning issues. Conclusive proof survives restart; resource cleanup is
conditional on creating a resource. Relative links/headings, whitespace, and
test mappings are checked for the documentation handoff. A disposable local
Git characterization confirmed exact repeat/up-to-date, rejection without
overwriting a descendant, ordinary safe fast-forward, and missing-branch
creation; it performed no hosted mutation. The exact candidate passed the
frozen full gate in run
`24e9c9ee-1302-4b57-a1dd-0b533332148d` against Base
`309a94e87ab7898e45cc81cc5240e64ae5b4092a` at HEAD
`a29737d9b00612d407d6b7eb5c7de10fdb2bb29a`. That result does not qualify the
current candidate. Its frozen full gate and the fresh supervised disposable
S1 journey remain unproven acceptance boundaries. No GitHub issue closure is
claimed.
