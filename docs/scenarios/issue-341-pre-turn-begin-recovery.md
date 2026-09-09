# Restart finishes the original Begin on an exact empty thread

Accepted authority: [#341](https://github.com/dearlordylord/dalph/issues/341),
[#330](https://github.com/dearlordylord/dalph/issues/330), and
[the durable-association crash cut](issue-219-codex-app-server-executor.md).

## Chronology

A maintainer restarts Dalph after its coordinator dies. The Journal contains
one acknowledged, unsettled Begin intent at ordinal 1 for Run R and attempt
A1. Git still owns A1's exact planned worktree. The executor's private store
contains AssociatedPreTurn(A1,T), and no TurnIntentRecorded. Codex owns the
thread and its current contents. No tracker mutation or person choice is
needed: this finishes already-authorized work.

1. Ordinary recovery asks the executor to reconcile Begin for exact R/A1.
   The executor reads the durable private association and freshly reads exact
   T at its planned worktree. Only a present idle thread with no turn and a
   matching association yields BeginNotCrossed. Missing private state, NotFound,
   unavailable, unreadable, foreign, active, and turn-bearing state fail closed.
2. Dalph records the exact command projection. This history records a past
   observation; it cannot authorize a future activation by itself. Dalph
   reconstructs the original specification/request and redelivers Begin with
   the original intent and ordinal, without creating another attempt.
3. The executor rereads its private state and exact thread before sending work.
   It durably records TurnIntentRecorded before turn/start. The Begin response
   settles ordinal 1 as Executing. If the turn finishes immediately, its terminal
   result remains private until ordinary passive observation accepts it.
4. A crash after the projection requires fresh reconciliation on restart.
   A crash after TurnIntentRecorded, or a lost turn/start response, cannot
   produce BeginNotCrossed and cannot authorize another turn/start. Exact
   executing/terminal evidence follows ordinary command reconciliation.

The visible outcome is the original attempt executing, followed by its ordinary
terminal result. Begin is one semantic command, delivery is a distinct crossing
of the executor boundary, and a provider task-turn crossing is a third event.
The owned turn token correlates observations; it is not a provider idempotency
key. Generic NoReport, passive observation, Resume, and Suspend grant no Begin
redelivery permission. Exact absent-thread replacement belongs to #342.

## Model refinement and scenario-to-test mapping

The canonical plannedAttemptExecutor model and its evidence proof distinguish
one Begin intent, multiple deliveries, durable provider turn authorization,
and at most one first-turn crossing. The normal successful Begin action
abstracts the provider intent/call pair; the pre-turn path exposes both cuts.
No existing lifecycle rule changes: Begin still settles as Executing.

| Scenario | Required evidence |
| --- | --- |
| Idle association resumes R/A1/T with one semantic Begin | Provider/workflow recovery test; exactPreTurnBeginIsRedeliveredTest |
| Projection followed by crash needs a new read | Workflow interrupted-projection test; crashDiscardsBeginNotCrossedProofTest |
| NoReport or ambiguous turn intent grants nothing | Provider/contract negative matrix; absenceAndTurnIntentNeverAuthorizeBeginRedeliveryTest; authorizedTurnCannotProduceBeginNotCrossedTest |
| Turn/start intent precedes the sole provider call | Production provider boundary history/count assertions; preTurnRecoveryKeepsOneIntentAndCrossingTest |
| Stale proof and duplicate crossing are detected | staleBeginProofMutationIsDetectedTest; duplicateBeginTurnMutationIsDetectedTest; corresponding proof negative controls |
| Existing Begin settlement remains Executing | Immediate-completion provider test and existing firstAcceptedReportIsExecuting model obligation |

Development validation is recorded with the implementation handoff. This file
does not claim unexecuted tests or the #342 process-loss qualification.
