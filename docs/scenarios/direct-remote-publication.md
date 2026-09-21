# Publish the integrated commit before completing the task

Issue: [Specify final remote publication before task completion](https://github.com/dearlordylord/dalph/issues/383).

**Status: accepted by the maintainer on 2026-09-19; the maintained capstone chronology repair and controlled S1/S7 checks are complete, but acceptance remains unproven.** The frozen full gate is `UNPROVEN` on repository-wide baseline and candidate controls. Issue #390's retained-run closure is complete; a fresh supervised disposable S1 dogfood remains required and must not repair the retained failed candidate.
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
| Competing remote work | #385 extends [successor fixation and recovery](recover-or-quarantine-integration-session.md#the-operator-requests-a-full-rerun) with a Dalph-authorized successor for a compatible competing remote advance. #384 preserves the wait and forbids an unowned successor; conclusive Integrator failure does not become automatically retryable. |
| Task completion | Extend [integration finality](../../specs/integrationFinality.qnt), especially `completionRequestUsesExactPremises`, with [D28c](../DELIVERY-INVARIANTS.md#integration-and-promotion) remote publication proof. Preserve `dependantReleaseRequiresLaterCompleteGraph` and `settledTaskRequiresExactCleanup`; after publication, `noReintegration` still forbids repeating integration merely to recover completion. |
| Ambiguity and custody | Apply [D28d](../DELIVERY-INVARIANTS.md#integration-and-promotion) with [D21–D24](../DELIVERY-INVARIANTS.md#ambiguity-and-evidence), [D16–D17](../DELIVERY-INVARIANTS.md#preservation), [D29–D32](../DELIVERY-INVARIANTS.md#process-and-durability), and [D41–D46](../DELIVERY-INVARIANTS.md#serialized-integration). Push discovery may perform the owning-system reread before retrying a ref update; a separate network read is not mandatory when Git already provides that reconciliation. Raw auth/provider diagnostics do not enter journal/status. |
| Bounds and Exit | Apply [D28e](../DELIVERY-INVARIANTS.md#integration-and-promotion), the [interruptible Git boundary](interruptible-tracker-git-exit.md), and [D50–D52](../DELIVERY-INVARIANTS.md#application-exit). No successor, grant, resume, or fresh work starts after Exit admission closes; the five-second drain is unchanged. |

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
| Compatible competing head H2; neither side contains the other | **Deferred to #385.** Record the precise competing-head wait in #384; #385 records automatic successor authorization for the same integration responsibility and C, preserves the predecessor, catches local Git up safely, and fixes one new session against H2. |
| Missing/unreadable target, insufficient ancestry, incompatible history, authentication/policy denial or throttle | Report the precise reason and retain work. Resume through the retained-delivery operation below after the relevant facts change. No inferred absence, automatic denied mutation, or throttled mutation retry. |

A remote advertisement names a commit; descendant proof additionally requires
that exact commit and sufficient ancestry from the same endpoint. Obtain that
evidence without moving task/target/foreign refs. No separate durable observation
resource is required; if the implementation creates one, its cleanup must follow
the existing exact ownership and disposition rules.

For the deferred successor, #385 retains the task Base/worktree, accepted C,
responsibility and FIFO position. It preserves predecessor
session/candidate/evidence until stopped writers and the specific superseded
disposition authorize cleanup, records the automatic authorization as Dalph's
action, and never fabricates an Operator choice. Before fixation it revalidates
current tracker, claim, remote and local Git facts, fixes one new S2 and
candidate resource at freshly qualified H2, and gives M2 parents `[H2, C]`.
At most one pre-fixation read occurs per activation; restart restores S2 or the
pending authorization without duplication. These are #385 seams, not #384
completion evidence.

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

For #384, the recovery matrix covers initial baseline catch-up, publication,
local promotion, completion, Exit, and conclusive-proof cuts. The successor-authorization,
additional-batch, and retained-resume rows remain parent requirements whose
implementation evidence belongs to #385, #386, and #387 respectively.

| Crash cut | Required continuation |
| --- | --- |
| Before/after push intent; applied or unapplied send; lost response; response before durable append | Preserve consumed ordinals; resolve ambiguous journal appends; reconcile using the same idempotent push or remote read. Never infer non-application or overlap local senders. |
| Automatic successor authorization before fixation | **Deferred to #385.** Refresh current permission and Git facts; fix at most one successor. No fabricated Operator direction. |
| Local catch-up applied before observation | Read local Git and settle the same intent before fixing/restoring the initial session; no blind reset. #385 applies the same rule to its successor catch-up. |
| Fixed session before provider contact or during execution | Restore the same session; never allocate another cycle solely because the host died. |
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
| **S2: Outside work advances remote H to H2 without M.** Exercise before push discovery, between discovery/update and after a lost response. Dalph prepares M2 and completes automatically; Alice does nothing. | **Deferred to #385.** Planned seam: `packages/orchestrator/src/workflow/protocols/integration-quarantine/successor.test.ts::reintegrates the same C after a competing push`; assert exact M2 parents, H2 retention, same task/queue, one successor/resource, no task rerun or Operator direction. The separate `catches up only a proven local ancestor` seam is also #385. |
| **S3: An identical push repeats or remote N already contains M.** Dalph reports publication, not failed delivery or new integration. | Planned seams: `packages/orchestrator/src/authorities/git/direct-publication.test.ts::pushes the exact candidate, recognizes up-to-date, and rejects stale non-fast-forward updates` and `packages/orchestrator/src/authorities/git/direct-publication.test.ts::observes exact current, both safe fast-forward directions, compatible competition, unrelated history, and a missing branch`. Assert exact repeat/up-to-date, safe fast-forward when the head differs from original H, and rejection of equal-content foreign commits, insufficient ancestry, dry-run proof, force, backward, or extra-ref mutation. |
| **S4: Repeated races or transport failures exhaust allowance.** Work remains retained after the finite batch. | Initial #384 seam: `packages/orchestrator/src/workflow/protocols/direct-publication/protocol-engine.test.ts::retains exact exhaustion without an ungranted fourth push intent`; assert three sessions, three intents, consumed-but-unsent ordinals, precise wait, and unrelated-target progress. **Deferred to #386:** duplicate grant, crash-after-grant, successor-generation exhaustion, and reuse of an already-published or publishable M. |
| **S5: Host dies at each initial publication/finality cut.** Replacement host continues the same Run and work. | Initial #384 seam: `packages/orchestrator/src/workflow/protocols/direct-publication/recovery.test.ts::recovers every initial remote delivery boundary`; exercise intent-before-send, applied/unapplied effects, lost response, ambiguous append, proof-before-promotion, promotion-before-observation, stopped-sender custody, and both stores. Initial catch-up uses `direct-publication/baseline-recovery.test.ts::recovers the initial remote baseline across memory and reopened SQLite journals`; real host death uses `packages/dalph/src/application/git-sender-custody.real-host.test.ts`. These tests do not substitute for promotion and tracker-close recovery. **Deferred:** successor cuts #385, grant cuts #386, and resume-after-receipt cuts #387. |
| **S6: Invalid configuration or real authority failure.** Initial mismatch starts no task work; later failure retains work. | Initial #384 seams: `packages/orchestrator/src/workflow/protocols/direct-publication/admission.test.ts::rejects a changed restart destination before appending or reading Git` and `packages/orchestrator/src/authorities/git/direct-publication.test.ts::keeps authentication and throttling denials distinct without returning diagnostics`. Cover wrong/multiple endpoint, non-branch ref, missing initial branch, changed restart destination, unfinished history without destination, duplicate mappings, missing ref/ancestry, unsafe local state, and no credentials/raw diagnostics in journal/status. **Deferred to #387:** `resumes retained publication after repaired credentials or connectivity`, including deduplicated request and crash-after-receipt recovery. |
| **Initial catch-up safety (S5/S6).** Git proves the target is behind before changing an unoccupied direct ref. | `direct-publication-git-characterization.test.ts`: `fast-forwards an unoccupied target and reconciles the applied intent without another mutation`; `rejects a checked-out target without changing its index or files (dirty=%s)` (clean and dirty linked worktrees); `rejects ambiguous worktree inventory and symbolic target ownership before mutation`; `refuses a backward catch-up before mutation`. |
| **Initial baseline cutoff (S7).** Pause or Exit arrives during the baseline read or catch-up. | `direct-publication-cutoff.test.ts`: `Pause during initial baseline observe/catch-up preserves its exact intent and forbids later Git work`; corresponding `Exit` cases retain unresolved intent, and `Exit-produced` cases persist a produced observation/result before releasing the owner. The same one-boundary engine is used in controlled tests and production; `baseline-recovery.test.ts` advances its next action explicitly. |
| **S7: Alice pauses or exits during publication/recovery.** Pause preserves work; Ctrl-C/SIGTERM reports actual Exit disposition. | Planned seam: `packages/dalph/test/scenarios/production.test.ts::retains remote delivery across Pause and Exit`. Assert no forward action while paused or after Exit cutoff, unchanged drain, exact stopped/unproven sender evidence, no remote-failure inference, and conclusive publication retained without a lifecycle-only read/push. |
| **S8: Completion permission changes or its response is lost.** After publication, introduce tracker blocker/revision/claim changes. | `packages/orchestrator/src/workflow/protocols/integration-finality/completion-task-protocol.test.ts::requires exact remote publication proof before a new tracker completion` preserves missing-proof rejection; `rejects malformed publication history before tracker completion without claiming a remote observation` distinguishes invalid journal history from external Git evidence. `direct-publication/recovery.test.ts::recovers every initial remote delivery boundary` proves committed success survives restart without remote calls. Independent tracker constraints block unsent mutations; applied close is not repeated/reopened or fabricated from task success. Both the event/ingress for genuine later remote contradiction evidence and the operation that obtains it are deferred; #384 does not claim supplied-evidence coverage or add a remote read before closure. #387 adds finality premises after retained resume. |
| **Deferred public recovery: Alice uses the shipped command after failure/exhaustion.** | #386/#387 internal controls precede a later public-control seam `resumes and grants one batch through the public entry`. Exact retained subject, idempotent request/result, loss/reconnect, same Run, no duplicate grant, and one task Begin must be proven separately; do not claim this from core-control tests. |
| **S1–S8: chronology and forbidden paths.** | `packages/dalph/test/cassettes/direct-remote-publication.test.ts::publishes M before local promotion and task completion, then releases its dependant from a later complete graph`, `packages/dalph/test/scenarios/production.test.ts::retains remote delivery across Pause and Exit`, and `packages/dalph/test/cassettes/capstone.execution.test.ts::maintained deliveryInvariantStoryCapstone executes all 22 beats in one exact Run` cover the maintained publication, lifecycle, cleanup, and finality transcripts. Conformance owners must retain negative controls for wrong candidate/destination, missing proof, unsafe mutation, duplicate successor/grant, reset budgets, early termination, and dependant release before the later complete graph. |
| **S1: one real disposable dogfood task.** | Built production CLI with a named Kimi or Codex profile. The run log must capture exact source/Base/C/M, task/Run/attempt, endpoint/ref, remote acknowledgement and independent hosted-head evidence, local promotion, GitHub confirmation, exact cleanup and termination. No controlled fixture, local-only success, hosted #388 qualification, or provider smoke prompt substitutes. |

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
creation; it performed no hosted mutation. Runtime/model test suites and full
gates are unrun because no executable or model changed; they cannot prove the
future behavior described here. Implementation remains outstanding. No GitHub
issue closure is claimed.
