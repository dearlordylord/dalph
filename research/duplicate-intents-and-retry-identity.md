# Duplicate intents and retry identity

Status: research result for
[Verify duplicate intents and retry identity](https://github.com/dearlordylord/dalph/issues/121)
under the
[bounded resumable and pausable graph-frontier map](https://github.com/dearlordylord/dalph/issues/114).
This document verifies the current implementation and accepted specifications.
It does not change the protocol, implementation, or tracker.

## Audit boundary

- Bootstrap source:
  [`docs/RESUMABLE-FRONTIER-PLANNING-MAP.md`](../docs/RESUMABLE-FRONTIER-PLANNING-MAP.md)
  at `5dc8f38c29d267b1aeabc88faa071c294e49818b`, especially the W7 question
  at [lines 550-565](../docs/RESUMABLE-FRONTIER-PLANNING-MAP.md#L550-L565).
- Current audited source: `master` at
  `a857e87f4e2391817c35435b71cc19331043fea9`. The only committed change after
  the bootstrap commit is the issue-116 research note; the implementation and
  accepted specification files audited here are unchanged between those
  commits.
- Accepted specifications:
  [`docs/CONTEXT.md`](../docs/CONTEXT.md),
  [`docs/ARCHITECTURE.md`](../docs/ARCHITECTURE.md), and
  [ADR 0002](../docs/adr/0002-planned-task-attempt-admission.md).
- Current implementation inspected: ordinary workflow selection, missing-stage
  continuation, unresolved-operation recovery, journaled interpreters, Git
  worktree reconciliation, task-work-session establishment, managed-history
  reduction, in-memory tests, and SQLite crash-reopening tests.

## Conclusion

Every **legal retry of a committed worktree-reconciliation or
task-work-session-establishment intent retains the original `OperationId`**.
No accepted current or future rule authorizes a second intent for the same
planned task attempt. Categorical duplicate rejection is therefore the correct
domain invariant.

There is one important distinction:

- If no intent was durably committed, restart may select the still-missing
  operation with a new `OperationId`. This is a first intent, not a retry of a
  committed intent and not a duplicate.
- Once an intent is committed, its `OperationId` owns every state-changing
  request, fresh result check, request repeat, recovery pass, and outcome for
  that exact boundary operation. The accepted definition of operation identity
  states this directly
  ([`docs/CONTEXT.md` lines 502-507](../docs/CONTEXT.md#L502-L507)).
- A second worktree or session-establishment intent for the equivalent planned
  attempt is invalid managed history
  ([`managed-history.ts` lines 674-705](../packages/orchestrator/src/managed-history.ts#L674-L705)).

The current boundary implementation does not fully enforce that invariant
before mutation. A direct caller can mechanically supply a different
`OperationId` for the same planned attempt, append a second intent under a
different journal key, and reach Git or the task-work provider. Full-history
reduction rejects the duplicate later. This is an enforcement-order gap, not a
legal retry path or an accepted authorization for another intent.

## Canonical rule and authorization

The concrete phenomenon is **create or rediscover the one exact execution
resource already bound to one immutable planned task attempt**:

- The planned attempt binds one exact worktree path, branch, Base SHA, executor,
  and task-work-session locator before either external resource is created
  ([`docs/ARCHITECTURE.md` lines 276-287](../docs/ARCHITECTURE.md#L276-L287)).
- Git reconciliation is authorized by the acknowledged plan. Dalph records one
  exact worktree intent, reads Git, conditionally asks Git to create the
  worktree, and rereads Git even after an uncertain command failure
  ([`docs/ARCHITECTURE.md` lines 316-339](../docs/ARCHITECTURE.md#L316-L339)).
- Session establishment is authorized by the acknowledged plan and exact ready
  worktree. A matching outcome must report one session for the stable
  `OperationId` and complete planned attempt
  ([`docs/CONTEXT.md` lines 541-549](../docs/CONTEXT.md#L541-L549)).

The causal rule is therefore:

> A committed boundary intent names one immutable operation. Every later
> request or observation that tries to establish that resource is evidence for
> that operation, not authorization to select another operation.

A changed external observation can authorize another fresh check, a wait,
isolation, repair followed by another check, or a separately specified
disposition. It does not authorize another create intent:

- A session lookup failure leaves establishment unresolved and authorizes only
  a later fresh result check
  ([`docs/CONTEXT.md` lines 482-487](../docs/CONTEXT.md#L482-L487)).
- A session correlation conflict remains unresolved under the existing
  `OperationId`; repair permits another lookup but not another creation request
  ([`docs/ARCHITECTURE.md` lines 146-151](../docs/ARCHITECTURE.md#L146-L151)).
- ADR 0002 preserves the exact attempt after coordinator death and says no
  current outcome authorizes replacement. Any future replacement attempt needs
  a separately specified authorization phenomenon and durable event
  ([`0002-planned-task-attempt-admission.md` lines 128-146](../docs/adr/0002-planned-task-attempt-admission.md#L128-L146)).

No accepted specification names a distinct resource-replacement phenomenon,
authorization outcome, causal predecessor, or boundary contract that could
legitimately select a second worktree or session-establishment operation for
the same planned attempt.

## Worktree path inventory

### W1. Ordinary first selection

After recording the immutable plan, the ordinary workflow allocates one
worktree `OperationId`, invokes reconciliation once, then makes that exact
operation a causal predecessor of session establishment
([`workflow-run.ts` lines 128-177](../packages/orchestrator/src/workflow-run.ts#L128-L177)).
This is the first intent, not a retry.

### W2. Restart finds a plan but no worktree intent

The reducer distinguishes absence of an intent (`TaskWorktreeReconciliationNeeded`)
from a committed intent without proof (`TaskWorktreeReconciliationUnresolved`).
The unresolved variant carries the recorded operation itself
([`managed-run-recovery-stage.ts` lines 104-122](../packages/orchestrator/src/managed-run-recovery-stage.ts#L104-L122)).

For the needed variant, recovery freshly checks eligibility and allocates the
first worktree operation
([`workflow-stage-recovery.ts` lines 177-210](../packages/orchestrator/src/workflow-stage-recovery.ts#L177-L210)).
If the coordinator stopped after selecting an ID in memory but before the
intent became durable, a later activation may select a different ID. Because
the journal contains no earlier worktree intent, this cannot create two legal
intents.

### W3. Intent append is repeated after an ambiguous journal return

The journaled interpreter appends the intent under
`operation:<OperationId>:intent` before calling Git
([`journaled-workflow-interpreter.ts` lines 163-198](../packages/orchestrator/src/journaled-workflow-interpreter.ts#L163-L198);
[`journal-record-key.ts` lines 4-8](../packages/orchestrator/src/journal-record-key.ts#L4-L8)).
Both journal implementations return the existing row when the key and payload
match and reject changed content under that key
([`journal-store.ts` lines 415-455](../packages/orchestrator/src/journal-store.ts#L415-L455);
[`sqlite-journal-store.ts` lines 290-360](../packages/orchestrator/src/sqlite-journal-store.ts#L290-L360)).
Thus a repeated append retains the operation identity and does not create a
second intent.

### W4. Git already reports the exact worktree

The reconciliation function first reads Git. An exact ready proof returns
without issuing `git worktree add`
([`git-worktree.ts` lines 159-194](../packages/orchestrator/src/git-worktree.ts#L159-L194)).
The ready outcome records the same operation identity as its intent
([`journaled-workflow-interpreter.ts` lines 180-195](../packages/orchestrator/src/journaled-workflow-interpreter.ts#L180-L195)).

### W5. Git reports an absent worktree or an existing planned branch

The same operation conditionally asks Git to add either a new planned branch or
the already-existing planned branch
([`node-git-worktree.ts` lines 208-249](../packages/orchestrator/src/node-git-worktree.ts#L208-L249)).
It then rereads the exact worktree. A ready reread succeeds even if the create
command returned failure; otherwise the command failure or acknowledged-but-
absent state remains typed failure
([`git-worktree.ts` lines 190-204](../packages/orchestrator/src/git-worktree.ts#L190-L204)).
The create call and reread are parts of the original reconciliation operation;
neither allocates an `OperationId`.

### W6. A read/create failure leaves the worktree intent unresolved

Recovery enumerates the durable intent object whose own `OperationId` lacks a
ready outcome and invokes the interpreter with that object unchanged
([`workflow-operation-recovery.ts` lines 73-96](../packages/orchestrator/src/workflow-operation-recovery.ts#L73-L96)).
The next pass rereads Git before deciding whether another create request is
safe. The focused test proves that crash recovery adds only the outcome and
that another recovery pass is idempotent
([`journaled-git-worktree.test.ts` lines 122-144](../packages/orchestrator/src/journaled-git-worktree.test.ts#L122-L144)).

### W7. Git reports a reconciliation conflict

Base mismatch, an untracked target path, a foreign or competing registration,
a detached worktree, or malformed Git evidence stops the operation and
preserves the resource
([`docs/ARCHITECTURE.md` lines 333-339](../docs/ARCHITECTURE.md#L333-L339)).
If an operator repairs the external state, the still-unresolved recorded
operation can perform a fresh reconciliation. No accepted outcome selects a
replacement operation.

## Task-work-session path inventory

### S1. Ordinary first selection

After exact worktree readiness, the ordinary workflow allocates one
`TaskWorkStartRequest.operationId`, builds one establishment operation, and
invokes it
([`workflow-run.ts` lines 160-178](../packages/orchestrator/src/workflow-run.ts#L160-L178)).
The operation constructor preserves the supplied request identity
([`workflow-operation.ts` lines 309-318](../packages/orchestrator/src/workflow-operation.ts#L309-L318)).

### S2. Restart finds a ready worktree but no session intent

The reducer distinguishes a missing establishment intent from an unresolved
one and carries the recorded operation in the unresolved variant
([`managed-run-recovery-stage.ts` lines 124-143](../packages/orchestrator/src/managed-run-recovery-stage.ts#L124-L143)).
Only the missing variant allocates the first session-establishment ID after a
fresh eligibility check
([`workflow-stage-recovery.ts` lines 212-236](../packages/orchestrator/src/workflow-stage-recovery.ts#L212-L236)).
As for worktrees, an ID selected only in lost process memory is not a committed
intent and does not prevent a later first selection.

### S3. Fresh intent sends the first start request, then checks the provider

The protocol uses `operation.request.operationId` for the lookup and sends the
same immutable `operation.request` for every start request. On a fresh intent,
it sends one request and then performs a fresh lookup regardless of whether the
request returned an acknowledgement or typed request failure
([`workflow.ts` lines 186-240](../packages/orchestrator/src/workflow.ts#L186-L240)).
Request acknowledgements and failures receive distinct provider observation
identities, but remain evidence under the same workflow operation
([`journaled-workflow-interpreter.ts` lines 312-349](../packages/orchestrator/src/journaled-workflow-interpreter.ts#L312-L349)).

### S4. Restart finds a committed intent without an outcome

The journaled interpreter detects the existing intent and passes
`requestBeforeFirstLookup = false`, so recovery observes before it can repeat a
request
([`journaled-workflow-interpreter.ts` lines 224-250 and 351-364](../packages/orchestrator/src/journaled-workflow-interpreter.ts#L224-L250)).
Unresolved-operation recovery supplies the exact recorded operation unchanged
([`workflow-operation-recovery.ts` lines 98-119](../packages/orchestrator/src/workflow-operation-recovery.ts#L98-L119)).

The SQLite crash matrix exercises interruption after intent, request crossing,
acknowledgement, absence, and matching-report boundaries. It reuses the same
operation after reopening and verifies the original request, predecessors, and
outcome identity
([`task-work-session-crash-matrix.test.ts` lines 240-280 and 419-452](../packages/orchestrator/src/task-work-session-crash-matrix.test.ts#L240-L280)).

### S5. The provider lookup is temporarily unreadable

A lookup failure selects `RetryLookup`; the bounded schedule performs at most
three fresh lookups without marking another request pending
([`task-work-session-recovery-decision.ts` lines 49-69](../packages/orchestrator/src/task-work-session-recovery-decision.ts#L49-L69);
[`workflow.ts` lines 227-257](../packages/orchestrator/src/workflow.ts#L227-L257)).
The test observes one initial request and three lookups, all under the original
operation
([`task-work-session-recovery.test.ts` lines 251-280](../packages/orchestrator/src/task-work-session-recovery.test.ts#L251-L280)).

### S6. Complete correlation metadata proves no matching session

Authoritative absence selects `RepeatRequest`. The next bounded pass sends the
same immutable request and checks again; it does not record another intent or
allocate another operation identity
([`task-work-session-recovery-decision.ts` lines 70-88](../packages/orchestrator/src/task-work-session-recovery-decision.ts#L70-L88);
[`workflow.ts` lines 238-257](../packages/orchestrator/src/workflow.ts#L238-L257)).
Persistent absence produces three requests and three lookups, then typed
non-convergence
([`task-work-session-recovery.test.ts` lines 282-310](../packages/orchestrator/src/task-work-session-recovery.test.ts#L282-L310)).

### S7. A matching session is reported

The provider report becomes `TaskWorkSessionEstablished` with the request's
original `OperationId`
([`task-work-session-recovery-decision.ts` lines 70-78](../packages/orchestrator/src/task-work-session-recovery-decision.ts#L70-L78)).
The journal records that exact identity as the outcome
([`journaled-workflow-interpreter.ts` lines 351-364](../packages/orchestrator/src/journaled-workflow-interpreter.ts#L351-L364)).
A later direct replay returns the durable outcome; later unresolved recovery
finds nothing to do
([`task-work-session-recovery.test.ts` lines 347-412](../packages/orchestrator/src/task-work-session-recovery.test.ts#L347-L412)).

### S8. Correlation evidence conflicts

A conflict fails immediately without marking another request pending
([`task-work-session-recovery-decision.ts` lines 70-87](../packages/orchestrator/src/task-work-session-recovery-decision.ts#L70-L87)).
The focused test observes one request and one lookup with no repeat
([`task-work-session-recovery.test.ts` lines 312-345](../packages/orchestrator/src/task-work-session-recovery.test.ts#L312-L345)).
Accepted architecture leaves the original operation unresolved and forbids
another creation request; repair authorizes only another lookup.

### S9. The establishment outcome is already durable

The journaled interpreter returns an existing outcome with the matching
operation identity before invoking the provider protocol
([`journaled-workflow-interpreter.ts` lines 243-250](../packages/orchestrator/src/journaled-workflow-interpreter.ts#L243-L250)).
This is replay, not a new intent or provider retry.

## Accepted pause, resume, and changed-world direction

The bootstrap map accepts that normal execution and restart share one operation
algebra and that crashes and pauses share reconstruction and reconciliation
([`RESUMABLE-FRONTIER-PLANNING-MAP.md` lines 121-132](../docs/RESUMABLE-FRONTIER-PLANNING-MAP.md#L121-L132)).
Its later reconciliation work may choose to accept changed knowledge, retry or
wait, reconcile an existing intent, relinquish responsibility, isolate a
resource, or fail history
([lines 526-548](../docs/RESUMABLE-FRONTIER-PLANNING-MAP.md#L526-L548)).
None of those choices currently authorizes a second worktree or session intent.

The map schedules same-session rework explicitly
([lines 501-520](../docs/RESUMABLE-FRONTIER-PLANNING-MAP.md#L501-L520)).
Accepted architecture likewise requires later implementer work to use the same
established session
([`docs/ARCHITECTURE.md` lines 414-430](../docs/ARCHITECTURE.md#L414-L430)).
Thus later task-execution operations may have new operation identities, but
they do not re-establish the session.

If future work wants to replace either resource while preserving the same
planned attempt, it must first specify all of the following, none of which
exists today:

1. A distinct domain phenomenon other than retry or reconciliation.
2. An explicit durable authorization outcome for that phenomenon.
3. A causal rule naming the exact prior terminal, relinquishment, or
   replacement decision.
4. An external boundary contract explaining why the original resource
   correlation no longer owns retries.
5. Updated managed-history semantics that make the two intents distinguishable
   rather than treating them as duplicates.

## Current enforcement gap

### Actor, action, and boundary

The actor is a direct caller of the journaled `WorkflowInterpreter`. The caller
can construct a worktree or session-establishment operation with a new
`OperationId` but the same equivalent planned attempt. The action is appending
that second intent and then invoking the external boundary. The affected
boundaries are Git worktree creation and task-work-provider session creation.

### Why the second intent can cross today

- Worktree reconciliation checks the acknowledged plan, appends the proposed
  operation under its identity-derived key, and calls Git. It does not first
  search history for another worktree intent for the same planned attempt
  ([`journaled-workflow-interpreter.ts` lines 163-198](../packages/orchestrator/src/journaled-workflow-interpreter.ts#L163-L198)).
- Session establishment checks the plan and ready-worktree predecessor, appends
  the proposed identity-derived intent, and then runs the request-first provider
  protocol for a newly seen identity. It does not first search for another
  session-establishment intent for the same planned attempt
  ([`journaled-workflow-interpreter.ts` lines 200-250 and 351-364](../packages/orchestrator/src/journaled-workflow-interpreter.ts#L200-L250)).
- Journal idempotency is scoped to the record key. A different `OperationId`
  produces a different key, so the journal correctly treats it as a new row
  rather than an unequal replay of the old row
  ([`journal-record-key.ts` lines 4-8](../packages/orchestrator/src/journal-record-key.ts#L4-L8);
  [`journal-store.ts` lines 426-452](../packages/orchestrator/src/journal-store.ts#L426-L452)).
- Full managed-history reduction later rejects multiple worktree or session
  intents for an equivalent planned attempt
  ([`managed-history.ts` lines 674-705](../packages/orchestrator/src/managed-history.ts#L674-L705)).
  Startup performs that reduction before its recovery phases
  ([`workflow-recovery.ts` lines 309-318](../packages/orchestrator/src/workflow-recovery.ts#L309-L318)),
  but direct live interpreter calls do not perform the same attempt-level
  duplicate check before mutation.

The focused reducer test confirms that both duplicate worktree and duplicate
session intents are invalid
([`managed-run-recovery-stage.test.ts` lines 241-286](../packages/orchestrator/src/managed-run-recovery-stage.test.ts#L241-L286)).
No focused test currently proves that the journaled interpreters reject a
second same-attempt intent before Git or provider mutation.

### Routing

Do not create a separate implementation ticket from this research result. Route
the accepted invariant and the fail-before-effect enforcement gap through the
map's existing strict sequence:

1. [Synthesize accepted specs and ADR changes, issue #124](https://github.com/dearlordylord/dalph/issues/124)
   places the invariant and boundary ordering in their canonical specification
   homes.
2. [Audit architecture against the accepted model, issue #125](https://github.com/dearlordylord/dalph/issues/125)
   decides whether the journaled interpreters and managed-history validation
   should be retained, refactored, or replaced to enforce attempt-level
   uniqueness before either external effect.
3. [Create implementation tickets and blocking edges, issue #126](https://github.com/dearlordylord/dalph/issues/126)
   turns the accepted specification and architecture decision into the
   appropriately scoped implementation and regression-test work.

This is the W10 → W11 → W12 ordering already required by the map
([`RESUMABLE-FRONTIER-PLANNING-MAP.md` lines 606-654](../docs/RESUMABLE-FRONTIER-PLANNING-MAP.md#L606-L654)).

## Decision

Retain categorical duplicate rejection:

> At most one committed `TaskWorktreeReconciliationIntended` and at most one
> committed `TaskWorkSessionEstablishmentIntentRecorded` may exist for one
> equivalent planned task attempt. Every legal retry or reconciliation reuses
> that intent's `OperationId`.

Treat a later selection after no durable intent as the first operation. Treat a
different identity after a durable intent as invalid history, even though the
current direct interpreter boundary needs stronger fail-before-effect
enforcement to uphold that rule locally.
