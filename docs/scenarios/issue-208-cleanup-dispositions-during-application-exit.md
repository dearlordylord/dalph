# Preserve exact cleanup dispositions during application Exit

Issue: [#208 Preserve exact cleanup dispositions during application Exit](https://github.com/dearlordylord/dalph/issues/208)

This file specializes the accepted cleanup chronology in
[`issue-169-graceful-application-exit.md`](issue-169-graceful-application-exit.md).
It does not authorize a new cleanup operation or an Exit-specific disposition.

## A supervisor exits after an exact claim-release request was sent

There is no person at the trigger instant. Run R has one admitted delivery
action deleting task A's exact tracker claim. The Run journal already contains
`TaskClaimReleaseIntended`, including the release `OperationId`, the exact
claim's task, owner, token, and acquisition `OperationId`, and either ordinary
workflow cleanup authority or one exact stopped-attempt disposition authority.
The task tracker may have deleted the claim, but Dalph has not recorded
`TaskClaimReleased`.

The process supervisor requests graceful Exit. The application closes its
forward-progress cutoff. The live owner retains the task-tracker cleanup family,
exact claim locator, unchanged disposition authority, release identity, and
acknowledged-intent state. If the tracker response is already available, Dalph
records `TaskClaimReleased` for that same release and stops before another
delivery action. If the local wait is interrupted first, Dalph leaves the owner
behind the acknowledged intent as recoverable ambiguity and records no release
result. It does not change a stopped-attempt release into ordinary cleanup or
vice versa.

The supervisor sees application success only after the local owner releases;
success means the Run remains recoverable, not that the claim is absent. Dalph
must not infer deletion, release another owner/token claim, start a claim read
or retry during Exit, or call process-local owner/permit release durable claim
cleanup.

If Dalph dies after the intent but before the result, a later application enters
the Run normally. The ordinary claim-release recovery projection presents the
same release `OperationId`. Dalph checks the tracker before retry and records
the authoritative outcome under the original intent. The application restores
no Exit cutoff or alternate cleanup mode.

### Acceptance-test mapping

- `records an available exact claim-release result under Exit without changing its disposition`
- `preserves and reopens interrupted exact claim cleanup in authored and Run-journal cassettes` preserves
  the interrupted exact cleanup as recoverable ambiguity, then reopens it
  through ordinary Run entry and records the authoritative result.

## Exit arrives while Dalph deletes an exact completion claim

Run R has already recorded the exact promotion-bound completion claim, focused
task-completion success, deletion intent, and one deletion-attempt intent. The
task tracker is deleting that exact completion claim. The request retains its
deletion `OperationId`, focused-success observation, and the earlier replacement
`OperationId`; these facts are its cleanup disposition and authorization.

The Operator requests Exit. If the tracker has returned, Dalph records the
already-produced deletion and settlement before releasing the owner, then
starts no later cleanup retry or read. If the tracker has not returned, the
local wait is interrupted behind the deletion-attempt intent. No deletion or
absence is inferred. Ordinary later activation rereads the tracker through the
same bounded protocol before deciding whether another exact attempt is allowed.

If Exit instead arrives after a cleanup read recorded an exact still-present
claim but before the deletion call starts, the next call cannot enter the
owner: the cutoff wins, so the attempt intent and deletion remain absent.
Process death preserves whichever prefix was durably appended and creates no
Exit-specific recovery mode.

### Acceptance-test mapping

- `records an already-produced completion-claim cleanup result under Exit and starts no later retry`
- `preserves an interrupted completion-claim deletion behind its exact attempt intent`
- `starts no completion-claim deletion after Exit closes between its read and delete`
- `later activation discovers deletion success after three ambiguous requests without request four`
- `fails closed when exhausted deletion reconciliation observes another completion claim`

## Exit closes before a proposed cleanup call begins

Run R may already contain the evidence from which its next delivery evaluation
would propose claim release, but no action owner or `TaskClaimReleaseIntended`
record exists. The Operator requests Exit first. The application closes
admission, rejects the proposal when it reaches the shared boundary, and never
sends a tracker release. Because no cleanup intent was acknowledged, Dalph
cannot call the rejected proposal ambiguous and cannot append a release result.

The Operator sees the shared application Exit result. The exact tracker claim
and every durable resource remain unchanged for ordinary later delivery.

### Acceptance-test mapping

- `starts no task-claim cleanup after the application Exit cutoff`

## Applicable cleanup-family inventory

The current production workflow has two durable-resource cleanup boundaries:

| Cleanup family | External owner | Exact resource locator | Exact disposition | Exit treatment |
| --- | --- | --- | --- | --- |
| Task-claim release | Task tracker | task, claim owner, token, acquisition `OperationId`, and release `OperationId` | `WorkflowClaimReleaseAuthority` or `StoppedAttemptClaimReleaseAuthority` with its request and observation identities | interruptible tracker call; record an available result or preserve acknowledged ambiguity |
| Completion-claim deletion | Task tracker | exact promotion-bound completion claim, deletion `OperationId`, focused-success observation, and replacement `OperationId` | deletion after exact focused task-completion success | each read or delete is interruptible; its attempt intent precedes deletion, an available result is recorded, and Exit starts no later read, retry, or settlement phase |

The remaining issue examples cannot be live cleanup families in this repository
yet. Git exposes worktree creation/observation but no worktree removal; candidate
construction/promotion exposes no candidate disposal; evidence has no deletion
operation; task completion is a tracker lifecycle mutation rather than resource
removal. Issue #208 adds none of those destructive operations. Consequently, no cleanup-specific
non-interruptible atomic section can be stuck at Exit; integration and evidence
atomic sections belong to #207 and are not reclassified as cleanup here.

Process-local delivery reservations, task-work positions, protocol permits,
fibers, and the coordinator lock may be released during Exit, but they are not
durable-resource cleanup and carry no cleanup disposition.

## Formal-model mapping

No `applicationExit` transition changes. The production owner projects this
cleanup request through the existing acknowledged interruptible-owner actions.
The unchanged model and production-backed MBT retain:

- `recoverableAmbiguityRequiresAcknowledgedExactIntent`;
- `knownBoundaryObservationRequiresItsAcknowledgedIntent`;
- `onlyEnumeratedQuickDrainActionsBeginAfterCutoff`;
- `successfulExitRequiresRecoverableBoundary`; and
- `exitNeverDisposesDurableWorkflowResources`.

The focused tests add the cleanup-specific resource and disposition equality
that the generic model intentionally abstracts away.
