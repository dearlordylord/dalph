# Publish the integrated commit before completing the task

Issue: [Specify final remote publication before task completion](https://github.com/dearlordylord/dalph/issues/383).

**Status: accepted by the maintainer on 2026-09-19; controlled S1–S8 checks,
competing-push S2, and their scoped reviews are recorded. One fresh supervised
hosted S1 completed on 2026-10-01 with publication, promotion, tracker
completion, cleanup, and workflow termination proven; the evidence ledger is in
the [#388 acceptance audit](../ISSUE-386-ACCEPTANCE-AUDIT.md#hosted-s1-workflow-acceptance--2026-10-01).
The CLI returned exit 1 while closing the Codex app server. A separate
reproduction supports a configured-wrapper/observed-executable identity
mismatch at that launcher boundary; this is a launcher follow-up, not a missing
publication criterion. The exact live-run argv was not persisted. The separate
seven-task delivery capstone remains open manual, and public recovery controls
remain deferred and are not claimed by this journey. An earlier
candidate passed its exact-head full gate, but no full gate has been run on the
current candidate; local `check:all` is optional under current policy. Issue
#390's retained-run closure is complete.**
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
| S1 publication order | Publish exact M with an ordinary non-force explicit refspec, retain correlated per-ref proof, request the local exact-head compare-and-set only after that proof, then complete the task from fresh tracker premises after local promotion is observed. | The fresh supervised hosted journey completed 2026-10-01; the retained evidence and checklist disposition are in the linked #388 audit. |
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
| Task completion | Extend [integration finality](../../specs/integrationFinality.qnt), especially `completionRequestUsesExactPremises`, with [D28c](../DELIVERY-INVARIANTS.md#integration-and-promotion) remote publication proof. Preserve `dependantReleaseRequiresLaterCompleteGraph` and `settledTaskRequiresExactCleanup`; after publication, `noReintegration` still forbids repeating integration merely to recover completion. The completion-derived original claim release remains valid as a post-completion tracker wait in `packages/dalph/src/application/production-hermetic-qualification-source.test.ts::accepts a completion-derived original claim release in a post-completion tracker wait`; the full S8 publication-to-dependant chronology is exercised by `packages/dalph/test/integration/direct-remote-publication.integration.test.ts::publishes M before local promotion and task completion, then releases its dependant from a later complete graph`. |
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

### S5/#387: An accepted-journal read fails during initial selection or before publication observation

**Starting facts.** Run R owns task A, accepted commit C, the exact same-target
integration responsibility, and retained publication facts for the pinned
target. For the resumed variant, the Journal contains one exact retained-resume
receipt. The ordinary Run selector proposes the existing
`RunRemotePublication` continuation. Earlier publication evidence, if any,
remains part of the retained history.

**Trigger and boundary.** `AcceptedJournalReader.readAccepted(R)` returns its
declared `JournalError` or `InRunJournalRunMismatch` during initial in-permit
selection, or at the publication-phase read immediately before remote
observation. These are the two tested pre-observation read sites. They do not
cover reads during a sender phase or claim that no Git observation occurred in
an earlier activation.

**Visible and forbidden results.** The action returns that exact typed failure
to its caller. Dalph preserves R, A, C, the responsibility, receipt, and all
previous publication evidence. At these two pre-observation sites, the failing
action starts no Git/provider boundary and performs no catch-up, push, append,
new authorization, successor session, or completion/finality action. It does
not turn journal history failure into a defect, success, or an inferred
provider outcome.

**Crash and retry.** The read failure itself does not create an ambiguous
remote effect at these pre-observation cut points; any earlier publication
result remains governed by its retained evidence. After a correct live Run
reader is restored, an ordinary fresh activation rereads the same accepted
history and follows the existing receipt/authorization path. A Run-identity
mismatch requires correcting the reader binding before retry; the mismatch
itself is not a retryable remote result. No new receipt or Integrator session
is created solely because the read failed.

The adapter controls are
`packages/orchestrator/src/coordination/delivery/integration-delivery-action-adapter.test.ts::preserves a typed accepted-journal read failure before retained-resume selection`
and
`packages/orchestrator/src/coordination/delivery/integration-delivery-action-adapter.test.ts::preserves a typed accepted-journal read failure at the publication boundary`.

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
- A result append that fails before commit leaves the exact automatic S2 run start but no result or candidate Git-read intent. A fresh activation reuses that fixed S2 session and run; the controlled provider returns the same completed result without starting another writer, then Dalph records one result and one candidate proof with direct parents `[H2, C]`. Memory and reopened SQLite retain exactly one task Begin and one fixed S2 session, with no push: `packages/orchestrator/src/workflow/protocols/integrator/automatic-successor-result-recovery.test.ts::recovers an automatic S2 result append failure before commit across memory and reopened SQLite`.
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

### S4: Alice grants one bounded batch to the exact exhausted delivery

**Starting facts.** Alice is the Operator for Run R, which remains open for
task attempt A, accepted commit C, exact integration responsibility Q, FIFO
position P, and publication candidate M with its target, remote lineage, and
predecessor history. The current claim and task revision remain in the task
tracker. The task executor
has already run once and released task-work capacity. A separate eligible task
B can progress. Batch 1 has reached one exact retained exhaustion occurrence O;
its cause is either the exhausted three-session allowance or the exhausted
three-intent allowance for the exact candidate. These are distinct histories:
for publication-intent exhaustion, use the real
`PublicationRetained(AttemptsExhausted)` result from
`packages/orchestrator/src/workflow/protocols/direct-publication/protocol-engine.test.ts::retains exact exhaustion without an ungranted fourth push intent`;
for successor-generation exhaustion, retain the exact third-session occurrence
and its predecessor evidence. Neither path may seed a fabricated exhaustion
record. All committed session and intent history, consumed ordinals, candidate
identity, and released process-local permits remain intact. No grant for O
exists. Retained history establishes whether exact proof or promotion has
already been recorded; any unresolved boundary uses fresh post-Unpause facts.
The exhaustion and grant prove neither.

Alice selects the internal **Full rerun** direction for O. Dalph validates
R, A, Q, P, C, and the exact candidate/session/ordinal evidence that identifies
O; the request identity makes a committed request replayable. Grant uniqueness
is keyed to (R, Q, O), so a later same-C successor candidate selected through
the authorized batch does not need a second grant. A different Run,
responsibility, position, commit, or exhaustion occurrence cannot use this
grant, and foreign candidate evidence cannot stand in for O.
Here Full rerun is the Operator-facing choice; the durable publication-batch
grant is distinct from `IntegrationQuarantineDirectionApplied`, which records
a direction for one quarantine occurrence.

**Ordered boundaries.**

1. Dalph reads the accepted Run and retained journal prefix, confirms that O is
   still the exact exhausted occurrence, reconstructs the prior allowance and
   confirms that no grant already authorizes a later batch. An unrelated
   quarantine, incompatible history, or mismatched subject is rejected without
   changing history.
2. Dalph appends one durable grant receipt before any newly authorized session
   or publication intent. Exact redelivery returns the committed result. A
   different request identity for the same (R, Q, O) cannot append another
   grant or authorize another batch; the required invariant is one grant for
   that exhaustion, while the response shape for that different identity is
   unspecified. A later exact exhaustion O2 needs a new direction.
3. Before a new provider or Git boundary, ordinary activation reconstructs the
   grant and history, reads current Run control and task claim/revision, proves
   prior sender custody, checks authentication and policy, and reads only the
   Git facts needed for the selected action. These are fresh owning-system
   observations, not snapshots retained from before the grant. This is one
   bounded activation, not a read-until-stable loop. If Pause is active, step 2
   is allowed but this step and all batch work wait for Unpause as specified in
   S7.
4. Dalph follows the branch justified by those facts. Retained exact
   publication proof proceeds to ordinary finality with no duplicate push or
   Integrator session. A candidate that remains safely publishable may be
   reused under the new push allowance. If compatible current remote history
   makes M unsafe, Dalph may prepare one fresh successor for the same C through
   the established #385 automatic-successor path; it does not rerun the
   task executor. If current permission, claims, custody, authentication,
   policy, throttling, or lineage still blocks the next action, Dalph retains
   that precise wait and starts no session or push.
5. The grant authorizes one later bounded batch: at most three newly fixed
   Integrator sessions and at most three publication intents per candidate.
   Fixation consumes a session cycle before provider contact. A committed push
   intent consumes allowance even if Git is never called. Existing history and
   ordinals remain immutable and monotonic; no counter is edited or reset. A
   successor candidate has its own exact publication correlation. If Batch 2
   exhausts, Dalph records O2 and returns to the retained wait; it does not
   authorize Batch 3.

**Visible and forbidden results.** Alice sees the exact retained exhaustion,
one grant for that occurrence, and then either branch-specific delivery
progress or the exact current wait. B remains eligible while R is unsettled.
The task completes only through the existing proof, promotion, current
permission, cleanup, and finality sequence in S8. Dalph must not count a
committed-but-unsent intent as free, recycle an ordinal, authorize an ungranted
fourth operation, use one grant for two batches, broaden FullRerun to unrelated
quarantine, overlap uncertain senders, rerun task execution, infer publication
from a grant or intent, block B, or terminate R with unsettled work.

**Not applicable.** This grant does not create a task selection, claim, task
attempt, Begin/Resume, target reconfiguration, force push, public CLI command,
hosted CI result, or deployment result. Tracker facts are reread for permission
and later finality; the grant changes none of them.

### S5: A replacement host recovers the exact committed grant

**Starting facts and trigger.** The Full rerun receipt for exact O has committed
in R's journal, but the host stops before its acknowledgement is recorded or
before any newly authorized boundary. The memory case starts a fresh activation over the retained in-memory layer;
the SQLite case closes and reopens the persisted journal after host restart. The grant is history-derived;
there is no separate authoritative batch counter.

**Recovery boundaries and cuts.** A replacement host reads the accepted prefix,
recovers the exact receipt once. If Pause P remains applied, it returns the
same receipt without a custody query or batch boundary; Unpause is still
required. After Unpause, current permission, claims, writer custody, and exact
Git facts are refreshed before the S4 branch is selected.

- A crash before the grant append commits leaves no grant. A retry validates O
  again and appends only if it remains the exact current occurrence.
- A crash after commit but before acknowledgement replays the same receipt and
  does not append another grant or start a second batch.
- A crash after a new session fixation restores that exact session and its
  consumed cycle; it does not spend another cycle solely because the host died.
- A crash after a committed publication intent preserves its ordinal. If Git
  was not called, the intent is still consumed. If the outcome is ambiguous,
  Dalph reconciles the exact owner and pinned remote before any later mutation;
  process death is not proof of non-application.

**Visible and forbidden results.** Restart continues R and Q with the same
receipt and prior history, then reaches ordinary finality or remains at the
precise unresolved constraint. It does not duplicate the direction, replay the
task, discard history, reset the allowance, overlap senders, or treat a missing
response as proof that an external effect did not occur.

**Not applicable.** Recovery does not create a new Operator choice, public
request protocol, task attempt, or task execution. Pause/Exit and finality rules
remain those in S7 and S8.

**Acceptance-test mapping.**
`packages/orchestrator/src/workflow/protocols/direct-publication/batch-grant.test.ts::retries an exact paused grant after a precommit crash in memory`
and
`::replays an exact batch grant from a reopened SQLite journal after lost acknowledgement`
cover the precommit and commit-before-ack cuts. The reopened case must retain P
and the receipt, prove no duplicate append or batch effects before Unpause,
then resume only after fresh activation. Extend the direct-publication recovery
and production tests for committed session/push intents under the same grant;
assert consumed cycles and ordinals, exact reconciliation, and no task Begin.
The existing
`packages/orchestrator/src/workflow/protocols/integrator/successor-session.test.ts::recovers a recorded full rerun without creating a second successor`
remains the ordinary one-successor predecessor control; it does not prove
publication-grant recovery or another batch.

### S7: Alice records a grant during Pause and defers every batch effect

**Starting facts and trigger.** R retains Q at P after exact exhaustion O. The
batch-one session and intent history is intact, process-local permits are
released, no grant for O exists, and no Exit cutoff has closed admission. Alice
applies Pause to R first, then submits the exact internal Full rerun request.
This order is part of the accepted behavior.

**Ordered boundaries.** Dalph reads the accepted Run, Pause, and publication
history and the candidate/session evidence that identifies O; then appends
one durable grant receipt while Pause remains applied. For Q, this receipt is
the only permitted Journal append during this cut; exact replay may read the
committed receipt. It is visible, but no subsequent Q-owned append or forward
effect occurs while Pause remains applied. Dalph starts no Integrator session,
Git or remote read, catch-up, push, promotion, tracker mutation, or task
execution for Q. A same-request replay returns the recorded
result; a different request identity cannot authorize another batch. R remains
active and cannot terminate while Q is unsettled; unrelated eligible B may
progress.

Unpause is the next activation trigger for batch work. Dalph rereads current
control, claim/revision, sender custody, permission/policy, and the Git facts
needed for the selected S4 branch. Facts observed before Pause do not authorize
post-Unpause work. A still-current constraint remains a precise wait. The grant
does not prescribe one fixed session/push shape.

Exit closes admission. If it closes before the grant append commits, Dalph
rejects the unapplied grant. If the grant committed first, the receipt and
usage remain in history, but Exit starts no session or push during the drain.
Already-produced results are recorded according to the existing Exit boundary;
uncertain sender custody remains unproven. Restart still requires normal owner
and custody checks and cannot infer another grant.

**Visible and forbidden results.** Alice sees the exact grant receipt while R
remains paused, then branch-specific progress or a precise wait after Unpause.
No batch effect occurs during Pause or after the Exit cutoff. Dalph must not
hide the accepted receipt, start a forward boundary under Pause, use the grant
to bypass Exit, reset usage, duplicate a grant, or stop unrelated target B.

**Acceptance-test plan.** Extend
`packages/dalph/test/scenarios/production.test.ts` with
`holds an exact exhaustion grant through Pause and enforces the Exit cutoff`.
Use real exhaustion and actual Pause/grant calls. Assert one durable receipt
while paused and zero Q-owned sessions, Git/provider calls, pushes, promotion,
tracker mutation, or task execution until Unpause; assert fresh reads before
Q resumes; cover Exit-before-append and Exit-after-commit. Extend the memory and
reopened-SQLite recovery test above with Pause before the grant append, reopen
with the same Pause and receipt, exact replay, zero batch effects, then Unpause.
The existing ordinary-delivery Pause test is a control, not proof of grant
ordering.

**Not applicable.** Pause does not renew the allowance for O, waive claims,
custody, authentication, policy, incompatible-history, or throttle constraints,
or expose a public control command.

### S4 completion refinement: an exact app-server notification precedes Integrator completion

#### Governing behavior

When the Codex app-server reports that the active Integrator turn completed,
Dalph uses the accepted [Codex terminal-seal chronology](codex-app-server-qualification.md#scenario-to-test-mapping)
and [D24: No inferred completion across boundaries](../DELIVERY-INVARIANTS.md#ambiguity-and-evidence).
The [planned-attempt executor model](../../specs/plannedAttemptExecutor.qnt)
keeps terminal-report acceptance distinct from an executing report
(`terminalAcceptedStatusIsAbsorbing`); the executable Codex chronology owns
the provider and private-store boundary. This refinement adds exact
`threadId`/`turnId` routing to that boundary. It does not create a completion
poll or alter publication bounds, proof, promotion, or tracker finality.

#### Starting facts and trigger

Task A has an accepted commit C and one fixed Integrator session S1 at remote
head H. Its candidate worktree W and private Integrator record belong to S1.
The record retains the owned thread X, its private thread token, the initial
run's owned-turn token K, and exact turn T from one `turn/start`. T was returned
as `inProgress` and durably recorded as `TurnObserved`; the private run is not
sealed and no candidate M is eligible for publication. The same Integrator
session, W, X, K, and T remain authoritative across process loss.

No person triggers the next event. Codex finishes T and sends one JSON-RPC
`turn/completed` notification whose `params.threadId` is X and whose
`params.turn.id` is T. The notification's thread and turn identifiers are
required, branded IDs at the app-server boundary. A missing, malformed, or
contradictory identifier makes the notification unusable; it cannot wake a
lifecycle read or supply terminal evidence.

#### Ordered boundary calls

1. The app-server adapter attaches the exact completion subscription for X
   before Dalph calls `turn/start`. Dalph persists the provider-run crossing,
   calls `turn/start` once with X, W, the Integrator request, and K, verifies
   the returned owned token, then stores exact T as `TurnObserved`. It binds T
   to the subscription after that durable association; a matching event that
   arrived before the start response remains buffered until this binding.
2. The app-server adapter decodes `turn/completed` and publishes a typed hint
   containing only exact X and T. Dalph waits for that pair. A hint for another
   thread or turn is consumed without a lifecycle read; notification payloads
   and an unqualified global wake are not retained.
3. Only the matching hint triggers a fresh read of the exact thread X in W.
   Dalph validates the private thread token, the exact T/K association, and a
   terminal status, then reads the complete owned-activity census. An active,
   unreadable, contradictory, or incomplete observation leaves the private
   Integrator run unsealed.
4. If the exact reread reports T terminal and the complete owned-activity
   census is `Absent`, Dalph seals the private run and returns its exact
   Integrator result. Only then may candidate validation and existing
   publication steps continue in their accepted order. There is no
   timeout-based success or terminal polling fallback.

#### Crash and reopen

If Dalph exits after `TurnObserved` is stored but before the private run is
sealed, the successor reads the same private Integrator record, thread X,
tokens K, and T. It does not allocate a thread, call another `turn/start`, or
change S1, W, the candidate, or publication history. The successor subscribes
for exact X/T before any recovery read that could observe lifecycle state. If
Codex replays or later delivers the exact notification, the successor performs
the exact reread above.

This refinement starts after `turn/start` returned T with status `inProgress`
and Dalph durably retained T. A lost `turn/start` response before that exact
association exists remains under the existing S4 intent-reconciliation rule;
this refinement does not infer T from a notification or seal from a
pre-association completion event.

The app-server protocol does not guarantee notification replay after a client
disconnect. Therefore, if T completes while Dalph is disconnected and no
matching X/T notification arrives after reopen, the Integrator run remains
pending indefinitely. A fresh terminal read and absent activity cannot seal
the private run without the matching hint. The user accepted this no-replay
outcome. Dalph adds no timeout, polling, synthetic replay, duplicate
turn/start, candidate, or replacement session to escape it.

Before the initial `turn/start` response supplies T, the adapter retains at most
64 completion notifications in arrival order, including repeated IDs. It
discards later notifications without replacing retained ones. Binding T
publishes each retained exact match into the scoped queue and discards
unrelated IDs; if no matching notification was retained, lifecycle observation
stays pending unless a later exact X/T notification arrives. The scoped queue
also holds at most 64 notifications and slides out its oldest queued notification
when full. After T is bound, each later matching notification enters that bounded
queue. If the fresh exact reread still reports T active, the Integrator remains
`TurnObserved` and waits for another matching notification, which must trigger
another fresh exact reread. A queued hint never proves completion. The fixed
`turn/start` response deadline does not bound message rate, so the two finite
buffers keep memory bounded while overflow fails closed and preserves the
newest exact wake.

#### Visible and forbidden results

While T is active, Alice sees the retained Integrator responsibility with no
candidate result. A wrong-thread or wrong-turn hint produces no lifecycle read
and no public change. A matching hint can produce an Integrator result only
after fresh exact thread/token/turn evidence and an `Absent` owned-activity
census. If activity remains live, the private run stays unsealed. After
process loss without a replayed matching hint, Alice sees the same pending
Integrator responsibility until that exact condition is met.

Dalph must not reread lifecycle state because of an unrelated or malformed
hint; treat a timeout, missing hint, process loss, terminal `turn/start`
response, or terminal read alone as success; seal while owned activity remains;
issue a duplicate turn, thread, candidate, or push; or use another turn's
notification to advance this Integrator responsibility. Tracker completion
remains downstream of the existing exact remote proof, promotion, and fresh
tracker checks.

#### Acceptance-test map

| Outcome | Required test evidence |
| --- | --- |
| The adapter preserves exact wire IDs, retains a completion delivered before the `turn/start` response, and rejects malformed or missing IDs without publishing a hint. | `packages/dalph/src/application/codex-app-server-protocol.test.ts::traces real turn/completed ingress and hint publication without retaining notification payload`; `::preserves exact completion IDs emitted before the turn/start response`; `::ignores malformed completion notification IDs without publishing a hint` |
| The adapter retains an exact matching identity from a pre-response burst, rejects overflow identities without replacing retained candidates, and does not publish a matching ID that arrived after the 64-entry bound. | `packages/dalph/src/application/codex-app-server-protocol.test.ts::retains the exact matching identity from a pre-response burst without unrelated hints overwriting it`; `::fails closed when the pre-response identity buffer is full before the matching turn hint` |
| Repeated notifications count toward the bounded pre-response queue; after T binds, two matching X/T notifications pass through the production JSON-RPC router. | `packages/dalph/src/application/codex-app-server-protocol.test.ts::routes repeated exact completion notifications after the turn ID is bound`; retained pre-response burst and overflow controls above |
| The Integrator subscribes before `turn/start`, buffers a matching completion delivered before the start response, and consumes it only after T is durably retained. | Existing passing evidence: `packages/dalph/src/application/codex-integrator.test.ts::subscribes before an Integrator turn start and seals after its exact completion hint`; adapter control `packages/dalph/src/application/codex-app-server-protocol.test.ts::preserves exact completion IDs emitted before the turn/start response`. |
| Wrong-thread and wrong-turn hints cause no provider lifecycle or activity read; only exact X/T authorizes the fresh thread, private-token, turn, and activity reads. | `packages/dalph/src/application/codex-integrator.test.ts::ignores unrelated Integrator completion hints without reading lifecycle` waits until T is durably stored and the subscription is bound, then injects wrong-thread and wrong-turn hints directly into the bound Integrator subscription stream (bypassing the fake's pre-bind filter). It asserts activity and resume counters remain unchanged after each hint; only the later exact X/T proceeds to the terminal reread. |
| Without exact identity attachment, the executor does not use the legacy global wake stream. | `packages/dalph/src/application/codex-planned-attempt-executor.test.ts::does not fall back to the legacy global completion stream without exact identity attachment` |
| A matching terminal hint does not seal while owned activity is live, unreadable, or failed; sealing follows a complete `Absent` census. | The Integrator control `packages/dalph/src/application/codex-integrator.test.ts::ignores unrelated Integrator completion hints without reading lifecycle` asserts a matching hint followed by `ExactLive` activity leaves `TurnObserved` unsealed; `::keeps the Integrator run unsealed when the exact terminal read has unreadable or failed activity census` covers both an `Unreadable` projection and a failed census effect after exact terminal evidence. `::subscribes before an Integrator turn start and seals after its exact completion hint` proves the absent-activity seal. The planned-attempt boundary remains covered by `packages/dalph/src/application/codex-planned-attempt-executor.test.ts::starts held terminal activity cadence after a completion hint discovers exact live activity`. |
| Neither terminal provider state nor a terminal `turn/start` response substitutes for the matching hint. A reopened `TurnObserved` Integrator run with terminal provider state stays pending when the notification was not replayed. | Existing passing evidence: `packages/dalph/src/application/codex-integrator.test.ts::keeps a completed Integrator turn pending after reopen when its matching notification was not replayed`; the separate planned-attempt path remains covered by `packages/dalph/src/application/codex-planned-attempt-executor.test.ts::does not read or seal a terminal turn when its matching completion hint is absent`, `::keeps a terminal turn start response pending without its exact completion hint`, `::keeps a completed turn pending when suspension sees no exact completion hint`, and `::keeps a completed Safe Resume pending without its exact completion hint`. |
| Reopen reuses X, K, and T and never sends a second turn; without a replayed matching hint it remains pending despite terminal provider state, while a later exact hint triggers the exact reread. | Existing passing evidence: `packages/dalph/src/application/codex-integrator.test.ts::keeps a completed Integrator turn pending after reopen when its matching notification was not replayed` and `::seals after the exact Integrator completion hint arrives after reopen`; the planned-attempt path remains covered by `packages/dalph/src/application/codex-planned-attempt-executor.test.ts::keeps a completed turn pending after reopen when its matching notification was not replayed` and `::seals after the exact completion hint arrives after reopen`. |
| A matching X/T hint whose exact reread still finds the turn active leaves durable `TurnObserved` pending with no seal or duplicate turn; only a later matching hint triggers a second fresh reread and terminal+Absent sealing. | Pending/no-seal control: `packages/dalph/src/application/codex-integrator.test.ts::rejects foreign resumed-thread tokens and correlated turns while an active turn remains pending`; active→terminal control: `::keeps the exact Integrator turn pending after an active reread until a later matching hint`; production router control: `packages/dalph/src/application/codex-app-server-protocol.test.ts::routes repeated exact completion notifications after the turn ID is bound`. |
| Publication and tracker finality remain behind a terminal executor report and the existing proof/promotion protocol. | Retain the S1 publication cassette `packages/dalph/test/integration/direct-remote-publication.integration.test.ts::publishes M before local promotion and task completion, then releases its dependant from a later complete graph`; its assertions remain required and are not replaced by executor-only tests. |

### S8: A grant or intent does not prove publication or settle finality

**Starting facts and trigger.** R still owns A/Q/P and exact C. A grant may be
recorded and a batch may have started, but local promotion, current tracker
permission, task completion, cleanup, or dependant release may remain
unfinished. Git and the task tracker remain independent authorities.

**Ordered finality boundary.** Dalph first reconciles the retained publication
history and any uncertain sender using S4/S5. A committed grant or push intent
is not publication proof. With exact remote proof, Dalph continues the existing
local-promotion and completion protocols. Before tracker mutation it reads
current task revision, claim, dependencies, and control facts. A changed
revision, foreign or missing claim, new prerequisite, Pause, or closed/ineligible
task retains the precise constraint. Only exact remote proof, observed local
promotion, fresh permission, confirmed tracker completion, and required cleanup
can settle Q; a later complete graph may then release dependants and allow R to
terminate.

**Visible and forbidden results.** Grant acceptance remains distinct from
publication and task completion. Dalph does not close Q from a grant, intent,
task success, or malformed/foreign proof; use stale claims; repeat an applied
close; release a dependant from a partial graph; or terminate R while Q is
unsettled. Restart or grant replay alone does not trigger a new remote read or
fabricate proof.

**Acceptance-test mapping.**
`packages/orchestrator/src/workflow/protocols/direct-publication/batch-grant.test.ts::records and replays one exact Full rerun grant during Pause, then executes one bounded batch after Unpause`
tests the grant-only completion rejection; the independent
`packages/orchestrator/src/workflow/protocols/integration-finality/completion-task-protocol.test.ts::requires exact remote publication proof before a new tracker completion`
tests the ordinary missing-proof boundary.
Assert no tracker completion or finality settlement from the grant alone. Add
the matching formal negative
`specs/directPublicationBatchGrant_negative_test.qnt::detectsGrantReceiptUsedAsPublicationProofTest`;
retain the normal S8 cassette
`packages/dalph/test/integration/direct-remote-publication.integration.test.ts::publishes M before local promotion and task completion, then releases its dependant from a later complete graph`.
These are focused checks of the grant/proof boundary, not a substitute for
current tracker-fact and cleanup conformance.

**Not applicable.** This scenario adds no remote monitor, force-push, new
completion command, or claim policy.

### #386 acceptance-test plan

The rows preserve the accepted outcomes and identify existing or planned tests. Tests use
the real exhaustion path and chronological journal prefixes; none hand-appends
an exhaustion, receipt, or provider/Git result to manufacture a branch.
The [candidate-specific row audit](../ISSUE-386-ACCEPTANCE-AUDIT.md) corrects
stale test paths and titles, records passing evidence for each implemented seam,
and names the still-blocking proof gaps without changing these requirements.

| Beat | Test owner and decisive evidence |
| --- | --- |
| **S4: Initial and later batch bounds.** | Keep `packages/orchestrator/src/workflow/protocols/direct-publication/protocol-engine.test.ts::retains exact exhaustion without an ungranted fourth push intent` and `specs/acceptedResultIntegration_automaticSuccessor_proof_test.qnt::thirdSessionAndThirdPushExhaustWithoutUnrequestedFourthSessionTest` as initial-batch controls only. For the exact third-session exhaustion, use `packages/orchestrator/src/workflow/protocols/integrator/automatic-successor-session.test.ts::reconstructs a fourth automatic successor only after its exact publication batch grant`, `specs/directPublicationBatchGrant_test.qnt::thirdSessionExhaustionRetainsExactCauseWithoutPushIntentTest`, and `::nextExactExhaustionRequiresFreshGrantWithoutResettingOrdinalsTest`. For the exact candidate-intent exhaustion, use `specs/directPublicationBatchGrant_test.qnt::thirdPushIntentExhaustionCanBeGrantedWithoutAnotherSessionTest` and `::nextExactExhaustionRequiresFreshGrantWithoutResettingOrdinalsTest`. Reach the retained occurrences through the real bound; count a committed unsent intent, preserve monotonic ordinals, and keep O2 retained until its own grant. |
| **S4: Grant identity and replay.** | Use `packages/orchestrator/src/workflow/protocols/direct-publication/batch-grant.test.ts::records and replays one exact Full rerun grant during Pause, then executes one bounded batch after Unpause`; the same test asserts one durable grant and batch authorization when a different Full rerun request ID submits the same exhaustion. `batch-grant.test.ts::rejects wrong Run, responsibility, queue position, commit, and candidate at exact grant admission` submits each wrong subject at admission and asserts no new grant or batch authorization; the commit and candidate are journal-owned parts of O, so strict decoding rejects extra request fields, while `::rejects a superseded exhaustion occurrence after a later successor candidate becomes current` checks stale candidate O. `::rejects a publication batch grant for an unrelated quarantine occurrence` covers the foreign quarantine. Bind R/Q/O and request identity; preserve unspecified response shape for a different identity while asserting no second grant or batch. The Operator-facing direction remains Full rerun, while the durable grant is not `IntegrationQuarantineDirectionApplied`. |
| **S4: Post-Unpause outcomes.** | Model distinct outcomes with `specs/directPublicationBatchGrant_test.qnt::exactPublicationProofAndFinalityRequireFreshBoundariesTest`, `::safelyReusableCandidateUsesPushWithoutNewSessionTest`, and `::sameCommitSuccessorUsesOneTaskAttemptAndExactParentsTest`. Runtime tests `batch-grant.test.ts::resumes exact already-published M toward finality after Unpause without another session or push`, `::retains exact post-Unpause authentication, throttle, custody, and lineage waits without retrying forward work`, and `::keeps a granted responsibility waiting after Unpause when tracker permission or its exact claim is absent` cover the named focused branches. `packages/dalph/test/scenarios/production.test.ts::production Run defers a real exhausted publication batch through Pause until Unpause` exercises ordinary Run with fresh terminal permission and foreign claim observations, then separately resumes already-published M to target promotion with no new session or push. Existing runtime tests cover safely reusable M, policy wait, and same-C successor through the established #385 automatic-successor path. Assert exact branch effects and no task rerun. The S7 row below maps the complete fresh-read order. |
| **S4: Independent progress.** | Add `packages/dalph/test/scenarios/hermetic-mvp.test.ts::continues one exhausted publication responsibility through exactly one granted batch while an unrelated target progresses` and `packages/dalph/test/scenarios/hermetic-mvp.test.ts::fixes a same-commit fourth successor only after the exact third-session exhaustion grant`; retain B progress, one Begin, Q unsettled until S8, and exact O/O2. |
| **S5: Grant and intent recovery.** | Use `packages/orchestrator/src/workflow/protocols/direct-publication/batch-grant.test.ts::retries an exact paused grant after a precommit crash in memory` and `::replays an exact batch grant from a reopened SQLite journal after lost acknowledgement` for precommit and commit-before-ack cuts. The formal model also covers crash after session fixation in `specs/directPublicationBatchGrant_test.qnt::crashAfterSessionFixationResumesSameSessionWithoutRepetitionTest` and crash after committed intent in `::crashAfterCommittedGrantIntentReconcilesOriginalOrdinalTest`; both resume the retained ordinal without another session or intent. Use `batch-grant.test.ts::reconciles an applied granted push after its response is lost without another push` and `::reconciles an applied granted push from reopened SQLite without another push` for runtime session/push-intent cuts; assert no duplicate mutation, reset, second grant, or task Begin. `packages/dalph/test/conformance/accepted-result-integration.mbt.test.ts::publication exhaustion grant consumes one batch consistently in memory and SQLite` drives actual exhaustion, Pause, a real committed grant with lost acknowledgement, rebuilt memory and reopened SQLite, exact replay, Unpause, ordinal-four push, and publication success. It compares visible outcomes and directly asserts one grant, proof, session, task Begin, and resumed push in each store. |
| **S7: Pause and Exit.** | `packages/dalph/test/scenarios/production.test.ts::production Run defers a real exhausted publication batch through Pause until Unpause` exercises Pause-before-grant, receipt append during Pause, exact replay, no Q-owned forward effect until Unpause, and both Exit cutoffs. On ordinary post-Unpause Run it counts and orders fresh control/policy reconstruction, remote destination admission, current tracker graph revision/permission, exact claim, local and remote Git reads, and sender custody before the first new publication intent and push. The journal suffix places the exact Unpause fact, current graph revision, claim, and target-lineage observation before the intent; a failed graph read and terminal-permission/foreign-claim waits make no new intent or push. Formal guard-removal controls are `specs/directPublicationBatchGrant_negative_test.qnt::detectsGuardRemovedSessionStartDuringPauseTest`, `::detectsGuardRemovedIntentCommitDuringPauseTest`, `::detectsGuardRemovedSessionStartAfterExitTest`, and `::detectsGuardRemovedIntentCommitAfterExitTest`; each starts from real exhaustion and records a forbidden forward boundary. `packages/orchestrator/src/coordination/delivery/integration-delivery-action-adapter.test.ts::a paused retained Run stops before custody, head observation, or publication boundaries` remains an ordinary-delivery control, not proof of grant ordering. |
| **S8: Proof and finality.** | `batch-grant.test.ts::records and replays one exact Full rerun grant during Pause, then executes one bounded batch after Unpause` calls the ordinary Run finality selector on a grant-only prefix and asserts `RunMustRemainActive`, zero `IntegrationFinalitySettled` appends, and Q unsettled. Use the focused completion protocol regression and formal negative above; retain exact proof, local promotion, current tracker permission, cleanup, and later complete-graph requirements. A successful grant-only model or cassette cannot settle Q. |
| **S4/S5/S7/S8: Formal chronology.** | Add `specs/directPublicationBatchGrant.qnt`, positive `specs/directPublicationBatchGrant_test.qnt::recordsExactPausedGrantAndDefersOneBoundedBatchUntilUnpauseTest` and `::exactGrantReplayBeforeAcknowledgementEnablesOneBatchTest`, and negative controls `::detectsReplayBeforeAcknowledgementMustAdvanceGrantPhaseTest`, `::detectsDuplicateOrMismatchedGrantMintingSecondBatchTest`, `::detectsDifferentRequestIdMintingSecondGrantForSameExhaustionTest`, `::detectsUnrelatedQuarantineFullRerunGrantTest`, `::detectsBudgetResetAndNonmonotonicOrdinalTest`, `::detectsGrantStartingTaskExecutionTest`, and `::detectsGrantReceiptUsedAsPublicationProofTest`. The positive model includes already-published, reusable, same-C successor, and still-blocked post-Unpause branches; branch-specific effects remain distinct. |

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
| Resume request recorded before activation | #387 resumes the same recorded receipt without another request effect: `packages/orchestrator/src/workflow/protocols/direct-publication/resume.test.ts::recovers the same retained resume receipt after restart with memory and reopened SQLite journals`. The production composition cases below assert that the receipt adds no duplicate authorization, successor, publication attempt, or task Begin. |
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
| **S1: Alice starts one fresh task; delivery succeeds.** Execute the normal chronology with no crash/retry. She sees separate remote publication, local promotion and confirmed closure. | Planned seams: `packages/orchestrator/src/workflow/protocols/direct-publication/admission.test.ts::admits one pinned endpoint and branch before claim and restores the prior admission without another Git read`; `packages/dalph/test/integration/direct-remote-publication.integration.test.ts::publishes M before local promotion and task completion`. Real Git plus a distinct bare remote, SQLite and controlled providers must assert exact order and identities, one Begin, zero redundant post-push workflow reads, independent remote ancestry, and no premature claim replacement/close/cleanup/dependant release. |
| **S2: Outside work advances remote H to H2 without M.** Exercise before push discovery, between discovery/update and after a lost response. Dalph prepares M2 and completes automatically; Alice does nothing. | Implemented focused seams: `packages/orchestrator/src/coordination/frontier/integration-frontier-transitions.test.ts::authorizes one automatic successor for a compatible competing remote head without Operator direction`; `packages/orchestrator/src/coordination/delivery/integration-delivery-action-adapter.test.ts::appends automatic successor authorization before baseline and catch-up CAS and defers stale-prefix authorization without Git`; `packages/orchestrator/src/coordination/delivery/automatic-successor-authorization-recovery.test.ts::recovers a lost automatic authorization acknowledgement without another Git read across memory and reopened SQLite`; `packages/orchestrator/src/coordination/frontier/integration-frontier-transitions.test.ts::reuses one successor authorization when a compatible resume receipt follows authorization before fixation`; `packages/orchestrator/src/workflow/protocols/direct-publication/automatic-successor-baseline-recovery.test.ts::recovers precommit automatic-successor baseline intent and observation failures with one read per activation`; `packages/orchestrator/src/workflow/protocols/direct-publication/automatic-successor-baseline-recovery.test.ts::recovers the exact automatic-successor baseline observation after a lost acknowledgement and then catches up once`; `packages/orchestrator/src/workflow/protocols/direct-publication/automatic-successor-baseline-recovery.test.ts::reconciles one applied automatic-successor catch-up CAS after memory and reopened SQLite process loss`; `packages/orchestrator/src/workflow/protocols/direct-publication/automatic-successor-baseline-recovery.test.ts::keeps an ambiguous ResponseDeadline catch-up pending until a later activation reconciles the exact old head`; `packages/orchestrator/src/workflow/protocols/direct-publication/automatic-successor-baseline-recovery.test.ts::recovers a committed automatic-successor catch-up intent after lost acknowledgement with one reconciliation`; `packages/orchestrator/src/workflow/protocols/direct-publication/automatic-successor-baseline-recovery.test.ts::replays a committed automatic-successor catch-up result after lost acknowledgement without another Git boundary`; `packages/orchestrator/src/workflow/protocols/integrator/automatic-successor-session.test.ts::projects and fixes one automatic successor after the exact competing-head catch-up and fresh lineage`; `packages/orchestrator/src/workflow/protocols/integrator/automatic-successor-session.test.ts::retries a precommit automatic successor fixation from the exact authorization before provider eligibility`; `packages/orchestrator/src/workflow/protocols/integrator/automatic-successor-session.test.ts::recovers a fixed successor append after memory and reopened SQLite process loss without a duplicate session`; `packages/orchestrator/src/coordination/delivery/delivery-proposal-routes.test.ts::recovers an automatic S2 provider start after lost acknowledgement without overlapping or replacing its run`; `packages/orchestrator/src/coordination/delivery/delivery-proposal-routes.test.ts::recovers a committed automatic S2 provider result after process loss across memory and reopened SQLite`; `packages/orchestrator/src/coordination/delivery/delivery-proposal-routes.test.ts::recovers a committed automatic S2 NotPrepared result after process loss across memory and reopened SQLite`; `packages/orchestrator/src/coordination/delivery/delivery-proposal-routes.test.ts::recovers a committed automatic S2 CandidateRejected result after process loss across memory and reopened SQLite`; `packages/orchestrator/src/coordination/delivery/delivery-proposal-routes.test.ts::routes automatic S2 through exact provider custody and quarantine recovery`; `packages/orchestrator/src/coordination/delivery/delivery-proposal-routes.test.ts::recovers automatic S2 provider-absence quarantine append cuts after process loss across memory and reopened SQLite`; `packages/orchestrator/src/workflow/protocols/disposition-cleanup/activation.test.ts::derives finality cleanup for an exact automatically fixed S2 candidate`; `packages/orchestrator/src/workflow/protocols/disposition-cleanup/production.test.ts::production SQLite cleanup preserves an automatic S2 predecessor while its writer is live and reconciles one lost deletion response after reopen`; `packages/dalph/src/application/codex-integrator-cleanup.test.ts::keeps an automatically superseded candidate until Codex proves the writer stopped`; `packages/dalph/test/scenarios/publication-composition.test.ts::Pause after automatic S2 authorization retains FIFO without baseline or successor effects`; `packages/dalph/test/scenarios/publication-composition.test.ts::Exit at automatic S2 authorization preserves the cutoff without starting a successor`; the unsafe-catch-up retention test (`packages/orchestrator/src/workflow/protocols/direct-publication/automatic-successor-baseline-recovery.test.ts::retains unsafe automatic S2 catch-up evidence without moving the target or fixing a successor`), and the projection-only lineage cases named above. Cleanup, Retry, trace, formal projection outcomes, the bounded-read negative control, the three real-Git placements below, and production three-session/three-push exhaustion (`packages/dalph/test/scenarios/hermetic-mvp.test.ts::retains the exact third competing head without an ungranted fourth automatic session or push`) are named above. |
| **S3: An identical push repeats or remote N already contains M.** Dalph reports publication, not failed delivery or new integration. | Planned seams: `packages/orchestrator/src/authorities/git/direct-publication.test.ts::pushes the exact candidate, recognizes up-to-date, and rejects stale non-fast-forward updates` and `packages/orchestrator/src/authorities/git/direct-publication.test.ts::observes exact current, both safe fast-forward directions, compatible competition, unrelated history, and a missing branch`. Assert exact repeat/up-to-date, safe fast-forward when the head differs from original H, and rejection of equal-content foreign commits, insufficient ancestry, dry-run proof, force, backward, or extra-ref mutation. |
| **S4: Repeated races or transport failures exhaust allowance.** Work remains retained after the finite batch. | Initial #384 seam: `packages/orchestrator/src/workflow/protocols/direct-publication/protocol-engine.test.ts::retains exact exhaustion without an ungranted fourth push intent`; assert three sessions, three intents, consumed-but-unsent ordinals, precise wait, and unrelated-target progress. **Deferred to #386:** duplicate grant, crash-after-grant, successor-generation exhaustion, and reuse of an already-published or publishable M. |
| **S5: Host dies at each initial publication/finality cut.** Replacement host continues the same Run and work. | Initial #384 seam: `packages/orchestrator/src/workflow/protocols/direct-publication/recovery.test.ts::recovers every initial remote delivery boundary`; exercise intent-before-send, applied/unapplied effects, lost response, ambiguous append, proof-before-promotion, promotion-before-observation, stopped-sender custody, and both stores. Initial catch-up uses `direct-publication/baseline-recovery.test.ts::recovers the initial remote baseline across memory and reopened SQLite journals`; real host death uses `packages/dalph/src/application/git-sender-custody.real-host.test.ts`. #387 adds `packages/orchestrator/src/workflow/protocols/direct-publication/resume.test.ts::recovers the same retained resume receipt after restart with memory and reopened SQLite journals` for a crash after receipt and before activation, plus `::reconciles the active receipt after an ambiguous push before any later push` to prove custody and pinned-head observation precede a later push. The incompatible-lineage continuation is covered by `::keeps unchanged incompatible lineage retained with no push in memory and reopened SQLite` and `::uses repaired compatible facts to prove the same candidate in memory and reopened SQLite`: reopening preserves the same receipt and C/S history, while unchanged facts require no custody preparation or push and fresh candidate-current proof follows the existing path. For the post-receipt crash cut after `RemotePublicationRetained(CompatibleCompetingHead)` commits and before selector wake, #387 adds `packages/orchestrator/src/workflow/protocols/direct-publication/resume.test.ts::replays the exact compatible-head continuation after restart from memory and reopened SQLite journals`, `packages/orchestrator/src/coordination/delivery/integration-delivery-action-adapter.test.ts::replays the retained compatible head through the ordinary Run selector after restart`, and `packages/orchestrator/src/coordination/frontier/integration-frontier-transitions.test.ts::reuses one successor authorization when a compatible resume receipt follows authorization before fixation`. These prove the exact request/C/target/mergeBase/head retained occurrence and ordinary-frontier reactivation after restart. Production composition adds `packages/dalph/test/scenarios/publication-composition.test.ts::composes ReopenAfterReceipt through production continuation and exact replay in Memory` and `::composes ReopenAfterReceipt through production continuation and exact replay in SQLite`; both assert exact receipt replay after S2 without journal changes or another authorization/session. The concrete same-commit successor authorization and recovery remain owned by #385. `packages/orchestrator/src/workflow/protocols/direct-publication/state.test.ts::accepts only exact reconciled proof from the active resume receipt and its latest retained attempt` verifies durable reduction of proof completed directly from a resume receipt. These tests do not substitute for promotion and tracker-close recovery. **Deferred:** grant cuts #386. |
| **S5/#387: Accepted Journal read fails during initial selection or immediately before publication observation.** The same Run and retained receipt remain authoritative; these two cut points start no Git/provider boundary. | `packages/orchestrator/src/coordination/delivery/integration-delivery-action-adapter.test.ts::preserves a typed accepted-journal read failure before retained-resume selection` injects `JournalError` at initial in-permit selection; `::preserves a typed accepted-journal read failure at the publication boundary` injects `InRunJournalRunMismatch` at the pre-observation publication-phase read. Both require the exact typed failure and unchanged accepted history. They make no claim about sender-phase reads or earlier Git activity. |
| **S5 successor recovery: host dies during the automatic H3 refresh catch-up.** Replacement host continues the same Run and work. | Initial #384 seam: `packages/orchestrator/src/workflow/protocols/direct-publication/recovery.test.ts::recovers every initial remote delivery boundary`; exercise intent-before-send, applied/unapplied effects, lost response, ambiguous append, proof-before-promotion, promotion-before-observation, stopped-sender custody, and both stores. Initial catch-up uses `direct-publication/baseline-recovery.test.ts::recovers the initial remote baseline across memory and reopened SQLite journals`; its focused CAS-race check is `baseline-recovery.test.ts::retains a catch-up ref race and requires a fresh baseline before another attempt`, with the same controlled race also exercised in both memory and reopened SQLite. The raced ref remains untouched; durable `Rejected` evidence retains the exact expected local, observed local, and remote heads as `CatchUpChanged`. It is not classified as divergence without ancestry proof or reclassified as ambiguous pending. Real host death uses `packages/dalph/src/application/git-sender-custody.real-host.test.ts`. #385's exact H3 refresh catch-up cut is `packages/orchestrator/src/workflow/protocols/direct-publication/automatic-successor-baseline-recovery.test.ts::reconciles a pending H3 refresh catch-up through ResponseDeadline before one CAS in memory and reopened SQLite`: round two's exact H2-to-H3 intent survives stop-before-CAS and reopened recovery, `ResponseDeadline` leaves the intent pending with no CAS, and a later activation reconciles that exact old H2 and performs one CAS without another read. Other successor cuts remain in the S2 mapping; #387 receipt/replay cuts are mapped in the S5 and production-composition rows above. Grant cuts #386 remain deferred. These tests do not substitute for promotion and tracker-close recovery. |
| **S6: Invalid configuration or real authority failure.** Initial mismatch starts no task work; later failure retains work. | Initial #384 seams: `packages/orchestrator/src/workflow/protocols/direct-publication/admission.test.ts::rejects a changed restart destination before appending or reading Git` and `packages/orchestrator/src/authorities/git/direct-publication.test.ts::keeps authentication and throttling denials distinct without returning diagnostics`. Cover wrong/multiple endpoint, non-branch ref, missing initial branch, changed restart destination, unfinished history without destination, duplicate mappings, missing ref/ancestry, unsafe local state, and no credentials/raw diagnostics in journal/status. #387 adds `packages/orchestrator/src/workflow/protocols/direct-publication/resume.test.ts::rejects resume schema and exact Run or responsibility mismatches before journal mutation`, `::deduplicates one resume identity and allows a later distinct repair request within the same allowance`, `::a persistent denial stops at the accepted attempt limit and cannot be resumed again`, `::does not retry a throttled publication through a retained resume request`, and `::resumes a pre-existing compatible-head wait through the ordinary Run frontier`, with `specs/acceptedResultIntegration_test.qnt::resumePreExistingCompatibleHeadWakesOrdinaryFrontierWithoutMintingWorkTest` covering exact Run/responsibility/request identity, one ordinary-frontier dispatch, unchanged C/session/Integrator counts, and the zero-push compatible-head allowance. The ordinary-frontier regression `packages/orchestrator/src/coordination/frontier/integration-frontier-transitions.test.ts::reuses one successor authorization when a compatible resume receipt follows authorization before fixation` now proves that a compatible competing head remains a precise retained wait with the exact merge base and remote head until the existing #385 successor path is available. Incompatible ancestry adds `packages/orchestrator/src/workflow/protocols/direct-publication/resume.test.ts::keeps unchanged incompatible lineage retained with no push in memory and reopened SQLite` and `::uses repaired compatible facts to prove the same candidate in memory and reopened SQLite`; the paired Quint cases are `specs/acceptedResultIntegration_test.qnt::incompatiblePublicationResumeKeepsUnchangedFactsRetainedWithoutWorkTest` and `::incompatiblePublicationResumeUsesOnlyFreshCandidateCurrentProofTest`; `specs/acceptedResultIntegration_test.qnt::resumeAfterAuthorizedRetryPreservesExistingIntegratorHistoryTest` composes the explicitly authorized same-session Retry with a later retained incompatible-publication wait and asserts the pre-existing second Integrator invocation, exact C/S/responsibility identities, and zero publication ordinals remain unchanged through resume; `specs/acceptedResultIntegration_negative_test.qnt::publicationResumeCannotMintIntegratorWorkAfterAuthorizedRetryTest` proves a third invocation violates the no-mint invariant. The paired incompatible-lineage cases assert a zero-attempt receipt, unchanged incompatibility remaining retained without push, and fresh compatible proof retaining exact C/session/responsibility under the existing ordinal bound. The production `runWorkflow` regression `packages/dalph/test/scenarios/publication-composition.test.ts::composes ReceiptAfterAuthorization through production continuation and exact replay in SQLite` exercises the receipt-authorized compatible-head case over reopened SQLite and proves the exact retained wait returns without remote Git calls, another attempt, Begin, or Integrator session. The selector-only adapter checks remain narrower. `packages/orchestrator/src/coordination/delivery/integration-delivery-action-adapter.test.ts::ordinary Run replay leaves the exact compatible head for the normal frontier selector` and `::replays the retained compatible head through the ordinary Run selector after restart`; `::ordinary publication replay preserves settled success and conclusive denial without provider work` proves no Begin, Integrator start, attempt, or Git call for settled success and conclusive denial. `packages/dalph/test/conformance/accepted-result-integration.mbt.test.ts::maps core resume admission receipt and exact redelivery into Quint fields` calls the production admission helper used by the Operator control, activates through the ordinary publication runner, and maps receipt-before-attempt-2, same-C/S proof, and exact redelivery into the model projection. |
| **Initial catch-up safety (S5/S6).** Git proves the target is behind before changing an unoccupied direct ref. | `direct-publication-git-characterization.test.ts`: `fast-forwards an unoccupied target and reconciles the applied intent without another mutation`; `rejects a checked-out target without changing its index or files (dirty=%s)` (clean and dirty linked worktrees); `rejects ambiguous worktree inventory and symbolic target ownership before mutation`; `refuses a backward catch-up before mutation`. |
| **Initial baseline cutoff (S7).** Pause or Exit arrives during the baseline read or catch-up. | `direct-publication-cutoff.test.ts`: `Pause during initial baseline observe/catch-up preserves its exact intent and forbids later Git work`; corresponding `Exit` cases retain unresolved intent, and `Exit-produced` cases persist a produced observation/result before releasing the owner. The same one-boundary engine is used in controlled tests and production; `baseline-recovery.test.ts` advances its next action explicitly. |
| **S7: Alice pauses or exits during publication/recovery.** Pause preserves work; Ctrl-C/SIGTERM reports actual Exit disposition. | #387 `packages/orchestrator/src/coordination/delivery/integration-delivery-action-adapter.test.ts::a paused retained Run stops before custody, head observation, or publication boundaries` exercises the ordinary Run action with durable Pause and asserts no sender-custody reconciliation, remote-head observation, preparation, push, journal append, new Run, or new attempt. `packages/orchestrator/src/workflow/protocols/direct-publication/resume.test.ts::application Exit interrupts resume before observation or a new publication attempt` proves Exit interrupts before fresh Git observation or an attempt. `packages/dalph/test/scenarios/publication-composition.test.ts::composes PauseAfterReceipt through production continuation and exact replay in Memory`, `::composes PauseAfterReceipt through production continuation and exact replay in SQLite`, `::composes ExitAfterReceipt through production continuation and exact replay in Memory`, and `::composes ExitAfterReceipt through production continuation and exact replay in SQLite` cover lifecycle cuts after the exact receipt. The protocol-engine tests `::a permitted reconciliation phase retains the same attempt when the sender phase is interrupted` and `::a permitted reconciliation phase records exact proof without preparing or sending` exercise explicitly injected transport-neutral phase permissions; they do not define production Pause behavior. Existing `direct-publication-cutoff.test.ts` owns the boundary-level cutoff evidence. |
| **S8: Current completion premises change after resume.** Starting facts: one Run R already owns task A, accepted task commit C, exact published candidate M, target, and a retained-delivery receipt; no local promotion or task completion has yet been recorded. After the receipt and reconciled publication proof, an outside tracker actor adds an open prerequisite to A, changes A's task revision, or replaces Dalph's claim with another claim. Ordinary `runWorkflow` resumes the same receipt, preserves M's publication proof, promotes that exact candidate locally, then reads the current complete graph, current task-work specification, and exact task claim at the finality boundary. A decisive changed prerequisite, task revision, or foreign claim retains a wait before `CompletionClaimReplaced`; the task-local `FocusedTaskCompletionFacts` read occurs only after the exact promotion-bound claim exists. The unchanged-premise path reaches that task-local read before a completion mutation. No process crash is needed for these changes; the established crash/retry rule still covers the separate lost completion response. The person sees the same responsibility retained for a tracker wait: an unfinished prerequisite or changed revision forbids a close, and a foreign claim forbids claim replacement or close. Dalph keeps R/A/C/M/target and the exact candidate resource; it does not begin another task attempt, start another Integrator session, repeat publication, complete the tracker task, replace or release a task claim, or clean up the candidate before finality settles. Publication proof alone does not settle the responsibility: exact resume continues ordinary Run while local promotion or tracker finality remains, and accepted `IntegrationFinalitySettled` evidence gates the no-dispatch final status. | `packages/dalph/test/scenarios/production.test.ts::S8 dependency blocks finality`, `::S8 changed revision blocks finality`, and `::S8 foreign claim blocks finality` use ordinary `runWorkflow` with the integrated production interpreter. All three record a complete post-promotion graph, exact current task-work specification, and exact current task claim. The dependency case proves the open prerequisite from graph facts; the revision case proves the changed current task fingerprint; the claim case observes and preserves the foreign active claim. Each decisive changed premise stops before claim replacement and before `FocusedTaskCompletionFacts`, which is only read after the promotion-bound claim exists. All three require exact resumed Run/proof/candidate/promotion identities, no completion attempt or acknowledgement, no finality settlement or candidate cleanup, and no duplicate Begin/session/publication/executor/provider work. The unchanged-premise/lost-response sibling is `::ordinary production Run retries resumed finality after a lost completion response and returns status after settlement and termination`; it reconciles the exact request as `NotApplied`, retries once, and records one applied completion without publication or integration work. Its Operator boundary assertions observe a real `IntegrationFinalitySettled` append, pause the next tracker graph read while the Run remains active, and prove a fresh exact request returns `RemotePublicationResumeStatus` with the same proof and no journal change, owner wake, Git call, publication retry, allowance, session, or task Begin. Releasing the graph-read barrier lets ordinary production write `WorkflowRunTerminated`; a second fresh exact request returns the same status without receipt, wake, or work. The same test also checks the lower-level accepted-result endpoint's `ContinueFinality` dispatch while finality is pending and no dispatch after settlement. These S8 cases refine [D28c](../DELIVERY-INVARIANTS.md#integration-and-promotion) and `completionRequestUsesExactPremises` in [integrationFinality.qnt](../../specs/integrationFinality.qnt): current tracker premises independently gate completion while recorded publication proof remains intact. `packages/orchestrator/src/workflow/protocols/integration-finality/completion-task-protocol.test.ts::rejects changed focused task facts before another tracker completion mutation` and its missing/foreign/prerequisite cases remain narrower protocol checks. Public CLI recovery remains deferred. |
| **Deferred public recovery: Alice uses the shipped command after failure/exhaustion.** | #386/#387 internal controls precede a later public-control seam `resumes and grants one batch through the public entry`. Exact retained subject, idempotent request/result, loss/reconnect, same Run, no duplicate grant, and one task Begin must be proven separately; do not claim this from core-control tests. |
| **S1–S8: chronology and forbidden paths.** | `packages/dalph/test/integration/direct-remote-publication.integration.test.ts::publishes M before local promotion and task completion, then releases its dependant from a later complete graph`, `packages/dalph/test/scenarios/production.test.ts::retains remote delivery across Pause and Exit`, and `packages/dalph/test/scenarios/production.test.ts` cases `ordinary production Run retries resumed finality after a lost completion response and returns status after settlement and termination`, `S8 dependency blocks finality`, `S8 changed revision blocks finality`, and `S8 foreign claim blocks finality` cover the maintained publication, lifecycle, cleanup, and finality transcripts. Conformance owners must retain negative controls for wrong candidate/destination, missing proof, unsafe mutation, duplicate successor/grant, reset budgets, early termination, and dependant release before the later complete graph. |
| **S1: one real disposable dogfood task.** | Built production CLI with a named Kimi or Codex profile. The run log must capture exact source/Base/C/M, task/Run/attempt, endpoint/ref, remote acknowledgement and independent hosted-head evidence, local promotion, GitHub confirmation, exact cleanup and termination. A controlled loopbackActions qualification, local-only success, or provider smoke prompt does not substitute for the hosted remote S1. The actual disposable GitHub remote execution recorded in the #388 audit is valid hosted S1 evidence. |

The seven-task `deliveryInvariantStoryCapstone` remains a separate accepted delivery story under [the delivery capstone scenario](delivery-capstone.md). Its explicit `pnpm test:integration:capstone` proof is currently open. This amendment removes that broad composition from the blocking S1–S8 publication mapping while retaining the controlled publication/dependant, lifecycle, finality-positive, and finality-negative checks above. It reduces seven-task composition coverage for this parent; it changes no production behavior and does not claim the separate capstone passed.

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
  The activation-local H2 boundary is owned by
  `packages/orchestrator/src/coordination/delivery/run-delivery-runtime.test.ts::holds a pending baseline reconciliation across unrelated accepted work until the next activation while allowing unrelated proposals`.
  Its `makeSuccessorPrefix` fixture covers the round-one baseline; it proves
  one `RemoteBaselineReconciliationPending` result prevents a second baseline
  attempt in that activation even when the accepted prefix advances, while a
  distinct proposal still runs. It does not claim an H3 observation.

  The production composition fixture covers receipt-before-authorization in
  `packages/dalph/test/scenarios/publication-composition.test.ts::composes ReceiptBeforeAuthorization through production continuation and exact replay in Memory`
  and `::composes ReceiptBeforeAuthorization through production continuation and exact replay in SQLite`.
  Production composition exercises `ReopenAfterReceipt` with both a Memory
  provision and reopened SQLite storage:
  `::composes ReopenAfterReceipt through production continuation and exact replay in Memory`
  and `::composes ReopenAfterReceipt through production continuation and exact replay in SQLite`.
  The Memory case is a separate application provision over the same memory
  layer; the SQLite case reopens its durable store. These composition fixtures
  do not substitute for a host crash/restart, which remains covered by the core
  resume tests above.
  Exact old-receipt replay after S2 is asserted by the `exact replay` checks in
  each production composition case, including the receipt-after-authorization
  case `::composes ReceiptAfterAuthorization through production continuation and exact replay in Memory`
  and `::composes ReceiptAfterAuthorization through production continuation and exact replay in SQLite`.
  These tests require unchanged journal history and no duplicate authorization,
  successor session, or task Begin. The separate #387 resume tests continue to
  own receipt redelivery and owner-wake counts.
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
the no-extra-remote-read decision is unchanged. At this 2026-09-30 repair
checkpoint, the fresh supervised disposable S1 remained pending; the later
2026-10-01 hosted S1 evidence is recorded in the [#388 acceptance audit](../ISSUE-386-ACCEPTANCE-AUDIT.md#hosted-s1-workflow-acceptance--2026-10-01).

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

For any fresh supervised hosted S1, require passing evidence from the controlled
S1–S8 checks and the competing-push S2 check. Also run focused tests mapped to
each changed accepted scenario and `pnpm check:fast` for integration readiness.
Run a fresh supervised disposable S1 only after the #390 retained-run closure;
do not repair the retained failed candidate. Before long operations, record the
expected duration and wall-clock stop; reconcile retained Runs before retry,
preserve failed evidence and unexecuted suffixes, and never retry throttled
mutations. For the 2026-10-01 S1, these prerequisites were met; the retained
#388 evidence records the predeclared bound, one disposable execution, exact
remote and local identities, and postflight reconciliation. Local `check:all`
remains an optional maintainer/release diagnostic, not a prerequisite for each
implementation attempt. This documentation-only update changes no Dalph
runtime workflow or provider operation. The separate seven-task capstone
remains open manual.

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
`a29737d9b00612d407d6b7eb5c7de10fdb2bb29a`. That historical result does not
qualify the current candidate. No frozen full gate has been run for the current
candidate; local `check:all` is an optional maintainer/release diagnostic under
current policy. At the time of this earlier implementation checkpoint, the
required fresh supervised hosted S1 remained unproven; the 2026-10-01 hosted S1
is documented in the [#388 acceptance audit](../ISSUE-386-ACCEPTANCE-AUDIT.md#hosted-s1-workflow-acceptance--2026-10-01).
No GitHub issue closure is claimed by this scenario document.

## Public retained-publication control (#389)

The Operator observes an unfinished Run whose exact candidate and publication
attempt are retained. `publication-subjects` acquires only coordinator and
Journal custody, validates Hot history, and returns the current retained
subject's RunId, responsibility `queuedAt`, retained position, cause, and
candidate. It starts no provider, executor, Integrator, or delivery Run. An
earlier retained occurrence superseded by a later attempt, receipt, grant, or
success is not offered as current. A fresh target returns an empty subject
list and never allocates a Run.

The Operator copies that exact subject into a versioned JSON request and adds
a stable request ID. `publication-resume` or `publication-grant` establishes
the same unfinished Run, applies the existing core control contract, emits
the durable receipt or current status separately from delivery status, and
continues ordinary activation. Lost output or restart permits redelivery of
the same body and ID; changed body fails closed. The core checks pause,
retained cause, grant allowance, sender custody, and the pinned candidate
before any renewed external effect. A receipt does not assert publication,
promotion, tracker closure, or Run termination.

Focused mapping: `production-cli.test.ts::public publication commands report
exact control receipts before ordinary Run disposition` proves the public
transport and ordering. Core `direct-publication/resume.test.ts`,
`batch-grant.test.ts`, and `journaled-run-bootstrap.test.ts` retain the exact
duplicate, restart, exhausted, and no-hidden-retry cuts. The #418 macOS
same-Run recovery is the production-backed retained push cut. The read-only
subject command is checked against that retained Journal before submission.
