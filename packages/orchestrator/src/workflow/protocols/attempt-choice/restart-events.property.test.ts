import { it } from "@effect/vitest"
import {
  AttemptId,
  GitCommitSha,
  PlannedTaskAttempt,
  RunId,
  TaskBranchRef,
  TaskExecutorLocator,
  TaskId,
  TaskRevision,
  WorktreeLocator
} from "@dalph/contracts"
import { Effect } from "effect"
import fc from "fast-check"
import { expect } from "vitest"
import { PlannedWorktreeReady } from "../../../authorities/git/worktree.js"
import { ActiveTaskClaim } from "../../../authorities/task-tracker/claim-mutation.js"
import { ClaimOwner, ClaimToken } from "../../../authorities/task-tracker/claim.js"
import { FixtureTarget } from "../../../authorities/task-tracker/fixture/target.js"
import { decodeJournalEvent, encodeJournalEvent } from "../../../workflow-journal/event-codec.js"
import { OperationId } from "../../identity.js"
import { workflowJournalEventVersion } from "../../kernel/event.js"
import {
  makeTaskAttemptPlanOperation,
  makeTaskWorkSpecificationObservationOperation
} from "../../registry/operation.js"
import { PlannedAttemptExecutorReportOrdinal } from "../planned-attempt-executor-work/events.js"
import { AttemptChoiceRequestId } from "./events.js"
import {
  AttemptRestartTaskFactsReadFailure,
  PlannedAttemptReplacedEvent,
  PlannedAttemptReplacementWitness,
  restartAuthorityReadOperationMatches
} from "./replacement-events.js"

const runId = RunId.make("restart-event-property-run")
const taskId = TaskId.make("restart-event-property-task")
const p1 = PlannedTaskAttempt.make({
  attemptId: AttemptId.make("restart-event-property-P1"),
  baseSha: GitCommitSha.make("1".repeat(40)),
  branch: TaskBranchRef.make("refs/heads/dalph/restart-event-property-P1"),
  executor: TaskExecutorLocator.make("executor:restart-event-property"),
  runId,
  taskId,
  taskRevision: TaskRevision.make("restart-event-property-F1"),
  worktree: WorktreeLocator.make("/worktrees/restart-event-property-P1")
})
const p2 = PlannedTaskAttempt.make({
  ...p1,
  attemptId: AttemptId.make("restart-event-property-P2"),
  baseSha: GitCommitSha.make("2".repeat(40)),
  branch: TaskBranchRef.make("refs/heads/dalph/restart-event-property-P2"),
  taskRevision: TaskRevision.make("restart-event-property-F2"),
  worktree: WorktreeLocator.make("/worktrees/restart-event-property-P2")
})
const subject = { observedTaskRevision: p2.taskRevision, plannedAttempt: p1 }
const requestId = AttemptChoiceRequestId.make({ nonce: "restart-event-property-D1", runId })
const expectedClaim = ActiveTaskClaim.make({
  operationId: OperationId.make("restart-event-property-claim"),
  owner: ClaimOwner.make("restart-event-property-owner"),
  taskId,
  token: ClaimToken.make("restart-event-property-token")
})
const witness = PlannedAttemptReplacementWitness.make({
  claimObservationOperationId: OperationId.make("restart-event-property-current-claim"),
  expectedClaim,
  graphObservationOperationId: OperationId.make("restart-event-property-current-graph"),
  oldWorktreeObservationOperationId: OperationId.make("restart-event-property-current-W1"),
  oldWorktreeProof: PlannedWorktreeReady.make({
    baseSha: p1.baseSha,
    branch: p1.branch,
    headSha: GitCommitSha.make("3".repeat(40)),
    worktree: p1.worktree
  }),
  quiescenceProof: { _tag: "AcceptedReport", reportOrdinal: PlannedAttemptExecutorReportOrdinal.make(1) },
  specificationObservationOperationId: OperationId.make("restart-event-property-current-F2"),
  targetHeadSha: p2.baseSha,
  targetLineageObservationOperationId: OperationId.make("restart-event-property-current-H2")
})
const event = PlannedAttemptReplacedEvent.make({
  initiatedBy: { _tag: "DalphCoordinator" },
  occurrenceClassification: "InitiatedAction",
  requestId,
  subject,
  successorPlan: makeTaskAttemptPlanOperation({
    operationId: OperationId.make("restart-event-property-plan-P2"),
    plannedAttempt: p2,
    predecessorOperationIds: [
      witness.expectedClaim.operationId,
      witness.graphObservationOperationId,
      witness.specificationObservationOperationId,
      witness.claimObservationOperationId,
      witness.oldWorktreeObservationOperationId,
      witness.targetLineageObservationOperationId
    ]
  }),
  version: workflowJournalEventVersion,
  witness
})

it.effect("round-trips generated exact replacement identities and Git heads", () =>
  Effect.promise(() =>
    fc.assert(
      fc.asyncProperty(fc.integer({ min: 4, max: 10_000 }), async (identity) => {
        const suffix = identity.toString(16)
        const generatedTargetHead = GitCommitSha.make(suffix.padStart(40, "0"))
        const generatedP2 = PlannedTaskAttempt.make({
          ...p2,
          attemptId: AttemptId.make(`restart-event-P2-${identity}`),
          baseSha: generatedTargetHead,
          branch: TaskBranchRef.make(`refs/heads/dalph/restart-event-P2-${identity}`),
          worktree: WorktreeLocator.make(`/worktrees/restart-event-P2-${identity}`)
        })
        const generatedWitness = PlannedAttemptReplacementWitness.make({
          ...witness,
          claimObservationOperationId: OperationId.make(`restart-event-current-claim-${identity}`),
          graphObservationOperationId: OperationId.make(`restart-event-current-graph-${identity}`),
          oldWorktreeObservationOperationId: OperationId.make(`restart-event-current-W1-${identity}`),
          specificationObservationOperationId: OperationId.make(`restart-event-current-F2-${identity}`),
          targetHeadSha: generatedTargetHead,
          targetLineageObservationOperationId: OperationId.make(`restart-event-current-H2-${identity}`)
        })
        const generated = PlannedAttemptReplacedEvent.make({
          ...event,
          successorPlan: makeTaskAttemptPlanOperation({
            operationId: OperationId.make(`restart-event-plan-P2-${identity}`),
            plannedAttempt: generatedP2,
            predecessorOperationIds: [
              generatedWitness.expectedClaim.operationId,
              generatedWitness.graphObservationOperationId,
              generatedWitness.specificationObservationOperationId,
              generatedWitness.claimObservationOperationId,
              generatedWitness.oldWorktreeObservationOperationId,
              generatedWitness.targetLineageObservationOperationId
            ]
          }),
          witness: generatedWitness
        })

        await expect(Effect.runPromise(decodeJournalEvent(encodeJournalEvent(generated)))).resolves.toEqual(generated)
      })
    )
  )
)

it("matches only the generated task read that produced an exact Restart failure", () => {
  fc.assert(
    fc.property(fc.integer({ min: 1, max: 10_000 }), (identity) => {
      const target = FixtureTarget.make(`restart-event-target-${identity}`)
      const operation = makeTaskWorkSpecificationObservationOperation(
        OperationId.make(`restart-event-specification-${identity}`),
        target,
        taskId
      )
      const failure = AttemptRestartTaskFactsReadFailure.make({
        detail: "generated unreadable task facts",
        source: "FixtureReader.FixtureReadError",
        target
      })
      const wrongTaskOperation = makeTaskWorkSpecificationObservationOperation(
        OperationId.make(`restart-event-wrong-specification-${identity}`),
        target,
        TaskId.make(`restart-event-other-task-${identity}`)
      )

      expect(restartAuthorityReadOperationMatches(operation, failure, subject)).toBe(true)
      expect(restartAuthorityReadOperationMatches(wrongTaskOperation, failure, subject)).toBe(false)
    })
  )
})
