# Attempt Delivery and Integration

This page groups the protocols that begin around task delivery: pre-claim
remote-destination admission, immutable attempt planning, exact worktree
reconciliation, planned-attempt executor work, accepted-result admission, one
outer Integrator session, direct remote publication, and exact-head promotion.

Direct publication is the first remote-delivery slice. Its protected order is
remote proof, local promotion, tracker completion, and then the later complete
graph observation that can release dependants. The initial slice has finite
observation, push, session, and candidate-intent bounds. Automatic competing
head successors and local catch-up belong to #385, user-authorized additional
batches to #386, and retained-delivery resumption to #387; those extensions
must preserve this order and the exact identities below.

## Immutable planned attempt

Dalph records one immutable planned task attempt only after a current
eligibility observation matches the task identity and authored-content
fingerprint. The plan binds:

- `RunId`, `TaskId`, `TaskRevision`, and `AttemptId`;
- the exact declared Base commit;
- branch ref and worktree path;
- executor locator.

The Journal must acknowledge the plan before Dalph asks Git to create or
discover the worktree. A contradictory append leaves Git and the executor
untouched. Repeating the identical append is idempotent; changing an operation
identity cannot replace the attempt. Another attempt requires an explicit
earlier outcome that authorizes it.

Normal execution and recovery use the same plan and protocols. Before recovered
executor work continues, Dalph requires one exact earlier plan and the causal
worktree-reconciliation evidence for that attempt.

See [ADR 0002](../adr/0002-planned-task-attempt-admission.md).

## Exact worktree reconciliation

After plan acknowledgement and before executor work, Dalph records one exact
worktree-reconciliation intent. It reads Git's registered worktrees and the
planned branch. Only current facts allowed by the protocol may authorize
`git worktree add`.

For fresh preparation, current evidence that both the planned branch and
worktree are absent may authorize creation. After a previously prepared
worktree is missing, recovery records `AttemptWorktreeLost`; absence does not
authorize silent recreation.

Every create request is followed by a Git read. That observation supplies the
current registration, branch, `HEAD`, and ancestry facts used to establish that
the planned worktree is ready. After restart with an intent but no conclusive
result, Dalph enters the same read step before another create request.

Dalph proceeds only when Git proves the exact planned path and branch and that
the declared Base is an ancestor of current `HEAD`. A non-ancestral Base,
foreign registration, conflicting branch, duplicate registration, detached
worktree, malformed output, or missing registration remains a distinct typed
result. The protocol preserves every observed resource; it performs no repair,
reset, move, clean, prune, recreation, or deletion.

Recovery observes the planned worktree and configured target lineage as
separate journaled Git reads. A non-ready observation can constrain the exact
attempt and require safe executor suspension, but does not release the task
claim or silently dispose the worktree.

See [reconcile-git-facts.md](../scenarios/reconcile-git-facts.md).

## Planned-attempt executor boundary

The executor receives one exact planned attempt identified by the same `RunId`
and `AttemptId` used by the Journal. It reports:

- `ExecutorWorkExecuting`;
- `ExecutorWorkSafelySuspended`; or
- a terminal accepted, completed, or failed result.

The responsibility-began action, command intent, exact command-response
settlement, passive state observation, and accepted distinct lifecycle report
are separate facts. Dalph calls Begin once. While the report remains executing,
later Observe calls are read-only and do not append another report ordinal or
consume a command budget. Only an accepted safe suspension or terminal result
proves that no executor-owned activity for that attempt remains and allows its
task-work position to be released.

The generic boundary does not expose coding-agent, reviewer, handback, retry,
or session stages. Those belong inside a future production executor. The
current controlled executor shares Dalph's process lifetime, so its tests do
not prove adoption of an independently surviving agent session or restoration
of agent context plus every committed and uncommitted worktree layer.

See
[planned-attempt-executor-boundary.md](../scenarios/planned-attempt-executor-boundary.md).

## Existing-attempt observation and safe resumption after activation loss

If the coordinator activation ends after Dalph records
`PlannedAttemptExecutorWorkResponsibilityBegan`, the next activation retains
the exact planned attempt. It does not derive a replacement attempt from
volatile state or allocate another executor identity. Startup uses the same
Journal-backed Run establishment and recovery composition as every other
activation.

Recovery first reconciles an unsettled Begin, Resume, or Suspend command by
observing the exact executor projection. Otherwise, an executing attempt is
observed passively without reading tracker or Git facts as permission for the
executor to keep working.

Only an accepted `ExecutorWorkSafelySuspended` report can enter resumption
selection. Recovery then performs current task-tracker reads for the graph,
authored specification, and exact claim, followed by separate Git reads for
the exact planned worktree and compatible target lineage. One durable
`PlannedAttemptContinuationAuthorized` fact witnesses those five observation
identities and the exact `(RunId, AttemptId)` before Resume. Missing, stale,
superseded, or wrong-attempt witnesses fail before executor contact. The
scheduler that decides when to invoke later passive observations is owned by
issue 265.

## Accepted-result admission

An accepted executor result contains one immutable result commit. It does not
complete the tracker task or select an integration target. Dalph records a
separate exact integration obligation. Its journal position determines its
same-target FIFO order; no derived queue ordinal is persisted.

Runtime owns one process-local integration resource for each repository/ref
target. It is separate from task-work capacity. Starting integration acquires
that resource before recording the non-cancellable integration cutoff. Restart
begins without a runtime lease and reacquires one only after current facts
permit progress.

If a current tracker observation reports an unfinished prerequisite, the
accepted result and integration obligation remain. Runtime releases the target
resource while preserving same-target order. Another target may continue.

See
[queue-accepted-integration.md](../scenarios/queue-accepted-integration.md)
and the
[`acceptedResultIntegration` Quint model](../../specs/acceptedResultIntegration.qnt).

## Remote publication destination admission

The production host validates the complete direct-publication destination before
it claims a task, creates a task worktree, starts an executor, or opens an
Integrator session. It resolves exactly one credential-free repository endpoint
and one fully qualified existing branch ref, and proves that the local
integration target maps to that remote branch without a duplicate mapping. A
non-branch ref, ambiguous or missing endpoint, missing initial branch, changed
restart destination, or unfinished history without a pinned destination is a
typed admission failure with no task mutation or provider contact. Raw
credentials and provider diagnostics are never journal or status facts.

The destination is part of the initial `WorkflowRunBegan` fact and is carried
by the exact integration responsibility. Restart therefore either reuses that
same endpoint/ref or retains a typed destination constraint; it cannot infer a
new target or append a retargeting option after the Run has begun. One local
target owns each configured remote branch for process-local serialization, while
remote writers remain outside Dalph's ownership authority.

The initial remote observation is read-only, names the pinned endpoint/ref, and
obtains enough ancestry to qualify the current head. It has a 30-second bound.
An observed missing or unreadable target, insufficient ancestry, incompatible
history, authentication/policy denial, throttle, or unsafe local state retains
the exact responsibility with a typed safe detail. An ambiguous result is
separate from a conclusive denial. No automatic denied or throttled retry is
allowed; #387 owns the later retained-delivery request.

The #387 resume request is transport-neutral and identifies the exact Run,
integration responsibility, and request identity. Schema and subject mismatches
stop before a journal append or provider call; exact redelivery returns the
recorded result. After a conclusive recoverable denial, the ordinary publication
owner reuses the same candidate and remaining allowance after the required
intent and custody reconciliation. It does not create another task Begin or
Integrator call. A compatible competing head wakes the ordinary Run selector,
which routes the retained occurrence through #385's same-commit successor path
under the remaining cycle allowance; resume does not add another recovery
engine.
Throttling, Pause, Exit, and exhausted allowance remain blocking states, and a
settled Run returns its recorded status without work.

See [direct remote publication](../scenarios/direct-remote-publication.md) and
[D28a–D28f](../DELIVERY-INVARIANTS.md#integration-and-promotion) for the
chronology, bounds, and deferred issue boundaries.

## Integrator session and candidate

After current target-lineage evidence permits integration, Dalph records one
exact session intent and gives the integration-ready result C, fixed target
head H, and isolated candidate resource to the injected Integrator. The
Integrator owns merge construction, conflict resolution, repository checks,
review, and provider-private recovery. Dalph does not journal those internal
stages or invoke a separate repository-verification wrapper.

The Integrator may report one prepared candidate M. Dalph then asks Git about
that named object. It accepts the report only when Git proves complete ordered
direct parents exactly `[H, C]`; it never infers M from worktree HEAD, prose, or
process exit. A conclusive unsuccessful Integrator result or invalid reported
candidate enters quarantine under #68. Dalph restart instead returns an
unfinished session to the Integrator automatically.

The Integrator may not publish or promote the candidate itself. After Git
qualifies M, the direct-publication protocol records an exact intent and sends
one ordinary non-force explicit refspec to the pinned remote destination. The
candidate's task, session, fixed H, accepted C, endpoint, branch, and M remain
correlated across the boundary.

See [issue #222](https://github.com/dearlordylord/dalph/issues/222), [issue
#68](https://github.com/dearlordylord/dalph/issues/68), and ADR 0014. The
historical #57 candidate-agent and #59 target-verification scenarios record the
superseded split-stage design. The accepted-result integration model now uses
the outer Integrator, explicit result, and Git-qualification boundary.

## Exact-head promotion

After the remote-publication protocol records conclusive proof that exact M is
published, and a current tracker observation still permits progress, Dalph
records one deterministic local-promotion intent, then reads Git again. Only
exact H authorizes a numbered attempt before Dalph asks Git to atomically
replace H with exact candidate M. The request carries M's exact
prepared-candidate correlation and the evidence required by the corrected
Integrator contract. Git's atomic success or a later Git ancestry read—not
equivalent content, remote publication alone, or the intent alone—establishes
local promotion.

A stale compare-and-set result preserves M and selects candidate reconciliation;
there is no force-update, reset, or parent rewrite. After an ambiguous result,
Dalph reads Git before another request. Exact M ancestry records promotion,
exact H may begin the next numbered attempt, and another head records stale
reconciliation. One candidate permits three total attempts. If the third result
remains unresolved, a final exact-H or unreadable reconciliation records
non-convergence, preserves the candidate and evidence, and permits no fourth
request.

Every active boundary call owns only its exact process-local repository/ref
position and releases it when the action settles. The durable started
integration responsibility remains the same-target FIFO blocker for later
tracker completion and settlement, while work for another target can proceed.

## Publication, recovery, and finality order

The remote push uses the pinned endpoint and fully qualified branch with an
explicit refspec and no force, lease, mirror, tag, secondary-ref, or submodule
side effect. Before the push, Dalph acknowledges an intent naming exact M and a
monotonic candidate-publication ordinal. The receiving server's correlated
per-ref update or up-to-date result is the normal proof. If a safe reconciliation
read proves that the same remote branch contains M, that ancestry proof is also
publication proof. Exit code, dry-run output, equal content, upload progress,
and a cached remote-tracking ref are not proof.

The durable publication proof remains usable after restart, Pause, Exit, and a
lost tracker-completion response. Dalph does not re-read or re-push solely
because one of those lifecycle events occurred. A lost or ambiguous push
response remains unresolved until the owned sender is proven stopped and the
same safe push or a remote read settles it. A known later contrary remote head
is a new current constraint; it does not delete the historical proof or license
completion against current tracker facts.

The initial batch allows at most three Integrator sessions and three publication
intents for one candidate. The intent consumes its ordinal even if the process
dies before the send. A push has a 120-second bound, including no implicit
extension of the application Exit drain. When a bound is exhausted or a typed
denial is conclusive, Dalph retains the responsibility and releases its
process-local position. It starts no fourth action without the later issue-owned
authorization. #385 owns competing-head successors and catch-up, #386 owns
additional-batch grants, and #387 owns retained-delivery resumption.

### Automatic competing-head successor and local catch-up

When Git proves the pinned remote branch advanced compatibly beyond exact M
without containing M, the Journal first retains that publication result. A
separate Dalph-coordinator action then records automatic successor
authorization for the exact integration responsibility, predecessor session
and candidate, immutable attempt and Base, accepted C, pinned endpoint/ref, and
existing FIFO position. It cannot be represented by an Operator Full rerun
direction. Conclusive Integrator failure, denied or throttled publication,
incompatible history, and unproven writer custody do not authorize this action.

After current tracker, claim, and control facts permit progress, the successor
path records a fresh remote/local-baseline read for that authorization. It may
advance the local target only after Git proves the exact local head is an
ancestor of the advertised remote head and rechecks that the direct target ref
is unoccupied. The coordinator journals the exact local-to-remote
compare-and-set before calling Git. Git reports the applied, already-current,
rejected, or unavailable result; no reset, worktree repair, or cleanup is
implied. A following target-lineage read verifies the original planned Base is
an ancestor before Dalph fixes one deterministic successor session and
distinct candidate resource with parents `[Hn, C]`, where Hn is the head from
the latest completed baseline round.

The authorization continues to name the original competing head H2. If the
first baseline was Ready before a later activation begins, recovery records one
fresh baseline round under that same authorization before fixation, including
when the remote remains at H2. If a round is incomplete, recovery resumes its
existing read or catch-up intent before considering another round. The initial
round and this one refresh round are the maximum; a third read is not admitted.
One activation performs at most one fresh remote read, and a baseline completed
during that activation is used directly without another reread. Dalph fixes
against the latest Ready head only after a later target-lineage read confirms
the unchanged task Base is its ancestor. The original accepted C, Base, and
FIFO position do not change.

The new session consumes the existing three-session batch when its durable
fixation is recorded, even if the process stops before contacting the
Integrator. Each candidate keeps its own three publication-intent limit. At
either limit, Dalph retains the exact wait and starts no ungranted fourth
session or push. Predecessor session, candidate, and evidence remain until the
writer is proved stopped and the exact superseded-resource disposition permits
cleanup. Recovery reconstructs the pending authorization, exact catch-up, or
fixed session from Journal history in the same path used by normal activation;
it does not restart task execution or overlap provider writers.

Tracker completion is a separate boundary after publication proof and exact
local promotion. It requires fresh task, claim, revision, dependency, and
cleanup premises; a push acknowledgement or focused success cannot substitute
for it. A later complete graph observation, not the completion mutation, is the
authority that releases dependants. During the existing application Exit
cutoff, no new publication, reconciliation, successor, completion, or durable
cleanup action may begin; one already-admitted Git boundary may finish only
inside the fixed D50–D52 drain.

See
[the reported candidate reaching promotion](../scenarios/migrate-promotion-and-finality.md#the-reported-and-git-qualified-candidate-reaches-promotion)
and [ambiguous or stale promotion](../scenarios/migrate-promotion-and-finality.md#an-ambiguous-or-stale-promotion-preserves-the-exact-work).
