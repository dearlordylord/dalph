# Attempt Delivery and Integration

This page groups the protocols that begin after a task is eligible and claimed:
immutable attempt planning, exact worktree reconciliation, planned-attempt
executor work, accepted-result admission, and integration candidate
construction.

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

## Integration candidate

After current target-lineage evidence permits integration, Dalph records the
candidate-construction intent before asking the integration agent to start or
continue one fixed session. The candidate resource is distinct from the
planned task worktree and is identified by the intent.

The integration agent submits one candidate commit. Git validates the object
directly from the configured repository. A valid two-parent candidate has
ordered direct parents exactly `[H, C]`, where `H` is the target head fixed by
the intent and `C` is the accepted result commit.

Missing objects, non-commit objects, and wrong parents return concrete
correction work to the same session. Unreadable Git records a typed validation
failure and preserves the exact submission for a later read. Correlation
contradictions stop before Git. Same-session correction and automatic
continuation have separate positive limits. Production supplies both
explicitly; neither has a default, and construction waits while either is
missing. Exhausting either limit preserves the accepted result and isolated
work and releases the process-local target resource.

Constructing a candidate does not prove verification, accepted-head promotion,
tracker completion, or cleanup. Those require their own established facts
before delivery can call the integration obligation settled.

See
[issue-57-build-two-parent-integration-candidate.md](../scenarios/issue-57-build-two-parent-integration-candidate.md)
and the
[`acceptedResultIntegration` Quint model](../../specs/acceptedResultIntegration.qnt).
