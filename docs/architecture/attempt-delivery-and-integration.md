# Attempt Delivery and Integration

This page groups the protocols that begin after a task is eligible and claimed:
immutable attempt planning, exact worktree reconciliation, planned-attempt
executor work, accepted-result admission, one outer Integrator session, and
exact-head promotion.

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

See [issue-139-reconcile-git-facts.md](../scenarios/issue-139-reconcile-git-facts.md).

## Planned-attempt executor boundary

The executor receives one exact planned attempt identified by the same `RunId`
and `AttemptId` used by the Journal. It reports:

- `Running`;
- `SafelySuspended`; or
- a terminal accepted, completed, or failed result.

The responsibility-began action is distinct from the first executor report.
Recording intent proves that Dalph assumed responsibility; it does not prove
that the executor accepted or started work. Safe suspension and terminal
results prove that no executor-owned activity for that attempt remains running
and allow its task-work position to be released.

The generic boundary does not expose coding-agent, reviewer, handback, retry,
or session stages. Those belong inside a future production executor. The
current controlled executor shares Dalph's process lifetime, so its tests do
not prove adoption of an independently surviving agent session or restoration
of agent context plus every committed and uncommitted worktree layer.

See
[planned-attempt-executor-boundary.md](../scenarios/planned-attempt-executor-boundary.md).

## Existing-attempt continuation after activation loss

If the coordinator activation ends after Dalph records
`PlannedAttemptExecutorWorkResponsibilityBegan`, the next activation retains
the exact planned attempt. It does not derive a replacement attempt from
volatile state or allocate another executor identity. Startup uses the same
Journal-backed Run establishment and recovery composition as every other
activation.

Before the retained attempt contacts the executor, recovery performs the
ordinary current task-tracker reads for the graph, authored specification, and
exact claim. A comparable unchanged graph is represented by the compact
`UnchangedTaskTrackerFactsReconfirmed` observation. It then performs a separate
Git read for the exact planned worktree. One generic durable
`PlannedAttemptContinuationAuthorized` fact witnesses the four operation
identities and the exact `(RunId, AttemptId)`; it is not a recovery event and
does not enter the occurrence projection. Missing, stale, later, or
wrong-attempt witnesses fail before executor contact. The later executor
report remains a report for the retained attempt.

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
[issue-56-queue-accepted-integration.md](../scenarios/issue-56-queue-accepted-integration.md)
and the
[`acceptedResultIntegration` Quint model](../../specs/acceptedResultIntegration.qnt).

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

See [issue #222](https://github.com/dearlordylord/dalph/issues/222), [issue
#68](https://github.com/dearlordylord/dalph/issues/68), and ADR 0014. The
historical #57 candidate-agent scenario, #59 target-verification scenario, and current
accepted-result integration model still encode the superseded split-stage
design and must not be used as implementation authority until replaced.

## Exact-head promotion

After a current tracker observation still permits progress, Dalph records one
deterministic promotion intent, then reads Git again. Only exact H authorizes a
numbered attempt before Dalph asks Git to atomically replace H with exact
candidate M. The request carries M's exact prepared-candidate correlation and
the evidence required by the corrected Integrator contract. Git's atomic
success or a later Git ancestry read—not equivalent content and not the intent
alone—establishes promotion.

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

See
[issue-60-promote-or-reconcile.md](../scenarios/issue-60-promote-or-reconcile.md).
