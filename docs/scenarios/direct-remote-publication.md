# Publish the integrated commit before completing the task

Issue: [Specify final remote publication before task completion](https://github.com/dearlordylord/dalph/issues/383).

**Status: accepted by the maintainer on 2026-09-19; not implemented.**
Alice selected direct publication, remote-first order, ordinary non-force push,
and automatic integration recovery with user-authorized continuation after
exhaustion. This document consolidates those decisions and their acceptance tests.

This is a prose-only change at planning Base
`beb3c9bb68c7a8b56f1b9e5ee999cfa1b43603ad`, on `master` in
`/workspace/typescript/dalph`. It changes no executable, schema, model, or runtime
behavior. Tests below are required implementation evidence, not passing claims.

## Outcome and scope

Dalph delivers one GitHub task to one explicitly configured remote target branch,
for example remote `origin`, branch `refs/heads/master`. It prepares a candidate,
pushes it without force, records remote success, promotes the local integration
ref, and only then completes the task. A normal competing push causes automatic
reintegration of the same accepted task commit; the task executor never reruns.

Success means the exact integrated commit was published, local promotion and
tracker confirmation succeeded, and existing cleanup/settlement obligations were
met. It does not mean hosted CI or deployment passed. PR workflows, force pushes,
branch-management commands, new reset interfaces, and multi-remote transactions
are outside scope.

## Governing behavior and amendments

| Decision boundary | Preserved contract and explicit amendment |
| --- | --- |
| Task planning and candidate preparation | Preserve [immutable attempts](../architecture/attempt-delivery-and-integration.md#immutable-planned-attempt), [D26–D28](../DELIVERY-INVARIANTS.md#integration-and-promotion), and candidate parents `[H, C]`: H is the session's fixed integration head; C is the immutable accepted task commit. The [integration model](../../specs/acceptedResultIntegration.qnt) and [tests](../../specs/acceptedResultIntegration_test.qnt), including `exactGitParentsQualifyReportedCandidateTest`, continue to govern qualification. |
| Remote publication and local promotion | Amend [promotion/finality order](migrate-promotion-and-finality.md#the-reported-and-git-qualified-candidate-reaches-promotion): publication precedes local promotion. Preserve the local exact-head protocol and `exactCandidatePromotesWithDirectCompareAndSetTest`; ordinary remote push is a separate boundary, not another use of local promotion proof. |
| Competing remote work | Extend [successor fixation and recovery](recover-or-quarantine-integration-session.md#the-operator-requests-a-full-rerun) with a Dalph-authorized successor for a compatible competing remote advance. Existing Operator-only authorization is amended narrowly; conclusive Integrator failure does not become automatically retryable. |
| Task completion | Extend [integration finality](../../specs/integrationFinality.qnt), especially `completionRequestUsesExactPremises`, with remote publication proof. Preserve `dependantReleaseRequiresLaterCompleteGraph` and `settledTaskRequiresExactCleanup`; after publication, `noReintegration` still forbids repeating integration merely to recover completion. |
| Ambiguity and custody | Preserve [D21–D24](../DELIVERY-INVARIANTS.md#ambiguity-and-evidence), [D16–D17](../DELIVERY-INVARIANTS.md#preservation), [D29–D32](../DELIVERY-INVARIANTS.md#process-and-durability), and [D41–D46](../DELIVERY-INVARIANTS.md#serialized-integration). For this idempotent Git operation, push discovery may perform the owning-system reread before retrying a ref update; a separate network read is not mandatory when Git already provides that reconciliation. This refinement of D22 needs adapter and conformance evidence. |
| Exit | Preserve the [interruptible Git boundary](interruptible-tracker-git-exit.md) and [D50–D52](../DELIVERY-INVARIANTS.md#application-exit). No successor work starts after Exit admission closes; the five-second drain is unchanged. |

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

## Push results and automatic recovery

| Evidence after a publication attempt | Next action |
| --- | --- |
| Successful exact update, or exact M already up to date | Record publication proof; proceed without another remote read. |
| Lost/ambiguous response, old local sender proved stopped | Repeat the same safe push within its allowance, or read the remote. Push discovery is reconciliation before mutation, not permission to assume the earlier push failed. |
| Rejection; fresh remote head N contains M | Prove ancestry and record publication. Do not push N backward or rerun integration. |
| Fresh remote head can fast-forward to M | Retry the same candidate under current permission and remaining allowance. No new integration cycle. |
| Compatible competing head H2; neither side contains the other | Record automatic successor authorization for the same integration responsibility and C. Preserve the predecessor; use fresh facts to catch local Git up safely and fix one new session against H2. |
| Missing/unreadable target, insufficient ancestry, incompatible history, authentication/policy denial or throttle | Report the precise reason and retain work. Resume through the retained-delivery operation below after the relevant facts change. No inferred absence, automatic denied mutation, or throttled mutation retry. |

A remote advertisement names a commit; descendant proof additionally requires
that exact commit and sufficient ancestry from the same endpoint. Obtain that
evidence without moving task/target/foreign refs. No separate durable observation
resource is required; if the implementation creates one, its cleanup must follow
the existing exact ownership and disposition rules.

For a successor, retain the task Base/worktree, accepted C, responsibility and
FIFO position. Preserve predecessor session/candidate/evidence until stopped
writers and the specific superseded disposition authorize cleanup. Record the
automatic authorization as Dalph's action, never as a fabricated Operator choice.
Before fixation, revalidate current tracker, claim, remote and local Git facts.
Fix one new S2 and candidate resource at the freshly qualified H2; M2 must have
parents `[H2, C]`. If the head changed before fixation, use the new qualified
observation under the same pending authorization, with at most one such read per
activation. There is no inner read-until-stable loop. Once S2 is fixed, its H2
cannot change. Restart restores S2 or the pending authorization without duplication.

Ordinary non-force push can recreate its explicitly named branch if that branch
vanishes during the invocation. We retain ordinary Git semantics: initial
admission and an observed missing-ref result stop, but there is no additional
atomic no-recreation guarantee. No other branch or deletion is authorized.
Git reference behavior is documented in [git-push](https://git-scm.com/docs/git-push);
per-ref success comes from the receiving server's
[status report](https://git-scm.com/docs/pack-protocol#_report_status).

## Bounds and user-authorized continuation

Default automatic allowance: **three Integrator sessions per batch**, including
the first. Fixing a session consumes one cycle even if the process dies before
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
quarantine control path. Keep all required work; stop automatic sends/successors;
release process-local permits. An unsettled responsibility prevents completed
Run termination, while unrelated targets remain eligible.

An Operator **Full rerun** direction for that exact exhaustion occurrence grants
one new bounded batch. This is an internal control contract; public command
wiring is the lower-priority follow-up below. Extend the existing successor-
generation restriction for publication exhaustion so a later exhausted batch
can receive a new grant; retain the old restriction for unrelated quarantine
reasons. There is no counter-edit API. Preserve earlier history and derive
usage since the grant. Duplicate delivery grants once; restart resumes that grant;
a later exhaustion needs a new authorization. Before using it, reconcile uncertain
pushes and refresh permission. If M is published, finish. If M can still safely
publish, reuse it under the renewed push allowance. Otherwise prepare a successor
from the same C using the renewed cycle allowance. Do not rerun task execution.
The grant cannot waive Pause, foreign claims, authentication/policy failure,
throttling, incompatible lineage or unproven writer custody. Other quarantine
reasons retain their existing Retry/Full rerun semantics.

## Resume retained delivery after a temporary failure

Use one transport-neutral operation: **resume retained delivery**. Its subject
is the exact Run and integration responsibility, with a request identity for
deduplication. It schedules ordinary delivery activation; acceptance means the
request was recorded, not that publication or task completion succeeded. Exact
redelivery returns the recorded result without authorizing another mutation.
It adds no budget, overrides no Pause, and creates no task attempt.

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
operation. A follow-up under this specification must expose a minimal public
way to select the exact retained subject and submit/read its idempotent resume
or exhaustion-grant request. Command spelling and transport wiring belong to
that follow-up; the semantic contracts and core tests above belong here.

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

| Crash cut | Required continuation |
| --- | --- |
| Before/after push intent; applied or unapplied send; lost response; response before durable append | Preserve consumed ordinals; resolve ambiguous journal appends; reconcile using the same idempotent push or remote read. Never infer non-application or overlap local senders. |
| Automatic successor authorization before fixation | Refresh current permission and Git facts; fix at most one successor. No fabricated Operator direction. |
| Local catch-up applied before observation | Read local Git, settle the same intent, then fix/restore the successor; no blind reset. |
| Fixed session before provider contact or during execution | Restore the same session; never allocate another cycle solely because the host died. |
| Remote proof before local promotion, or local promotion before observation | Retain conclusive remote proof and reconcile local promotion; no remote read or reintegration solely because the process restarted. |
| Full rerun grant committed before new work | Resume the one granted batch with unchanged history; no repeated user request required. |
| Resume request recorded before activation | Resume the same recorded request; ordinary boundary intents prevent duplicate effects, and allowance is unchanged. |
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
| **S1: Alice starts one fresh task; delivery succeeds.** Execute the normal chronology with no crash/retry. She sees separate remote publication, local promotion and confirmed closure. | Public production CLI: `publishes M before local promotion and task completion`. Real Git plus distinct bare remote, SQLite and controlled providers; exact order and identities, one Begin, zero redundant post-push workflow reads, independent fixture assertion of remote ancestry, no premature claim replacement/close/cleanup/dependant release. |
| **S2: Outside work advances remote H to H2 without M.** Exercise before push discovery, between discovery/update and after lost response. Dalph prepares M2 and completes automatically; Alice does nothing. | Integration runtime: `reintegrates the same C after a competing push`. Exact M2 parents, H2 retained, same task/queue, one successor/resource, no task rerun or Operator direction; complete publication/local/finality suffix. Separately `catches up only a proven local ancestor` checks intent/CAS/observation and preservation of dirty, ahead, divergent or foreign work. |
| **S3: An identical push repeats or remote N already contains M.** Dalph reports publication, not failed delivery or new integration. | Real Git adapter: `reconciles publication through push or ancestry`. Exact repeat/up-to-date; reject then prove descendant; permit safe fast-forward even when head differs from original H; reject equal-content foreign commits, insufficient ancestry and dry-run proof. No force or backward/extra-ref mutation. |
| **S4: Repeated races or transport failures exhaust allowance.** The core control receives the same Operator grant twice, then the host dies after grant; work remains retained. | Runtime plus both stores: `continues one exhausted integration with one new batch`. Three sessions; three pushes per candidate/batch; zero ungranted fourth; quiet wait and independent-target progress; one grant after duplicate delivery/restart, including a grant after successor-generation exhaustion; finish already-published M, repush reusable M or integrate same C as appropriate. New exhaustion needs new permission; no history reset or task Begin. |
| **S5: Host dies at each cut in the recovery table.** Replacement host continues the same Run and work. | Publication/successor/finality protocols with memory and SQLite: `recovers every remote delivery boundary`. Exercise every listed cut, both applied/unapplied remote and local outcomes, ambiguous appends, fixed/pending successor, and consumed-but-unsent intents. Same IDs, no overlapping writers, duplicate sessions or forged success. |
| **S6: Invalid configuration or real authority failure.** Initial mismatch starts no task work; later failure retains work. Alice repairs a temporary cause and requests resume through the core operation. | Bootstrap/Git adapter: `preserves work when publication cannot be authorized`. Wrong/multiple endpoint, non-branch ref, changed restart destination, old unfinished history without destination, duplicate local-target mappings; auth/policy/throttle, missing ref/ancestry and foreign local changes. No retargeting, credentials, forced/extra-ref writes, automatic denied retries or cleanup. Add `resumes retained publication after repaired credentials or connectivity`: same Run/C/M, deduplicated request and crash-after-receipt recovery, no new allowance/Begin, no Integrator call unless competing work requires it, persistent denial and throttle still stop. Characterize plain-push concurrent deletion semantics. |
| **S7: Alice pauses or exits during publication/recovery.** Pause preserves work; Ctrl-C/SIGTERM reports actual Exit disposition. | Public process fixture: `retains remote delivery across Pause and Exit`. No forward action while paused or after Exit cutoff, unchanged drain, exact stopped/unproven sender evidence and no remote-failure inference. On resumption/restart, refresh required permission before progress; retain conclusive publication with zero read/push solely caused by restart or Pause. |
| **S8: Completion permission changes or its response is lost.** After publication, introduce tracker blocker/revision/claim changes or a genuine later contrary remote observation; exercise restart with conclusive versus uncertain proof, both lost-close outcomes and human early close. | Finality: `keeps remote proof distinct from tracker completion`. Conclusive proof survives interruption/retry without mandatory remote reads; unknown publication is reconciled; known contradictions and independent tracker constraints block unsent mutations; actual applied close is not repeated/reopened; no fabricated publication from task success or hidden retained obligation. |
| **Deferred public recovery: Alice uses the shipped command after failure/exhaustion.** | Public control follow-up: `resumes and grants one batch through the public entry`. Exact retained subject, idempotent request/result, loss/reconnect, same Run, no duplicate grant and one task Begin; do not claim this evidence from core-control tests. |
| **S1–S8: chronology and forbidden paths.** | Maintained cassette/public status plus model/conformance owners: separate push results, remote proof, catch-up, local promotion, automatic/user authorizations, exhaustion and tracker state. Reach each success/recovery/wait and retain negative controls for wrong candidate/destination, missing proof, unsafe mutation, duplicate successor/grant, reset budgets and early termination. |
| **S1: one real disposable dogfood task.** | Built production CLI with named Kimi or Codex profile. Exact source/Base/C/M, task/Run/attempt, endpoint/ref, remote acknowledgement and independent hosted-head evidence, local promotion, GitHub confirmation, exact cleanup and termination. No controlled fixture, local-only success or provider smoke prompt substitutes. |

## Implementation and acceptance boundary

The maintainer accepted this amended chronology on 2026-09-19. Update its owning invariants and
architecture premises. Extend publication/integration/finality models and
conformance with reachability and independent negative controls. Implement the
same operations through Effect V4 and one workflow algebra, with existing exact
custody, FIFO ordering and disposition-typed cleanup. Automatic successors need
an explicit cleanup disposition; never fabricate Full rerun to reuse its code.
The core resume and exhaustion-grant contracts are in scope; the public control
follow-up has the explicit qualification limit stated above.
One local target owns each configured remote branch; local exclusion does not
pretend to lock out remote writers.

Use focused scenario tests and `pnpm check:fast`, then the required frozen full
gate. Finally run the single disposable S1 dogfood journey after controlled S2
passes. Record expected duration and wall-clock stop time before long operations;
reconcile retained Runs before retry, preserve failed evidence and unexecuted
suffixes, and never retry throttled mutations.

The Astra review identified public control exposure, temporary-failure resumption,
mandatory revalidation of conclusive proof, and a prescribed observation-resource
lifecycle. Public wiring is explicitly deferred with its qualification limit;
core resumption now has a recovery/test contract; conclusive proof survives
restart; resource cleanup is conditional on creating a resource. These changes
preserve domain/authority separation and the accepted delivery order. Relative
links/headings, whitespace and test mappings are checked for the documentation
handoff. A disposable local Git characterization confirmed exact repeat/up-to-date,
rejection without overwriting a descendant, ordinary safe fast-forward, and
missing-branch creation; it performed no hosted mutation. Runtime/model test
suites and full gates are unrun because no executable or
model changed; they cannot prove the future behavior described here. Implementation remains outstanding. No GitHub issue closure is claimed.
