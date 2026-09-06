import { RunId, type PlannedTaskAttempt, type TaskId } from "@dalph/contracts"
import { Effect } from "effect"
import {
  makeFreshTaskAdmissionBasis,
  projectFreshTaskAdmission,
  type FreshTaskAdmissionBasis,
  type FreshTaskAdmissionProjection,
  type FreshTaskCommitment,
  TaskAdmissionOccupancy
} from "../../src/coordination/admission/fresh-task-admission.js"
import { TaskWorkCapacity } from "../../src/coordination/admission/capacity.js"
import { ClaimOwner, ClaimToken } from "../../src/authorities/task-tracker/claim.js"
import { TaskClaimAcquisition } from "../../src/authorities/task-tracker/claim-mutation.js"
import { type OperationId } from "../../src/workflow/identity.js"
import { makeTaskClaimAcquisitionOperation } from "../../src/workflow/registry/operation.js"
import { InitialControlPolicy } from "../../src/control/policy.js"
import { FixtureTarget } from "../../src/authorities/task-tracker/fixture/target.js"
import { JournalPosition } from "../../src/workflow-journal/identity.js"
import { intentRecordKey } from "../../src/workflow-journal/record-key.js"
import { makeWorkflowRunBeganRecord } from "../../src/workflow-journal/run-lifecycle.js"
import type { JournalRecord } from "../../src/workflow-journal/store.js"
import { workflowJournalEventVersion } from "../../src/workflow/kernel/event.js"
import { TaskClaimAcquisitionIntendedEvent } from "../../src/workflow/registry/event.js"
import type { WorkflowOperation } from "../../src/workflow/registry/operation.js"

interface FreshTaskAdmissionTestFixtureInput {
  readonly acceptedAt?: JournalPosition | null
  readonly capacity: number | TaskWorkCapacity
  readonly held?: ReadonlyArray<PlannedTaskAttempt>
  /** Direct occupancy entries for tests that exercise commitment or candidate states. */
  readonly entries?: ReadonlyArray<TaskAdmissionOccupancy>
  readonly runId?: RunId
}

const defaultFreshTaskAdmissionTestRunId = RunId.make("fresh-task-admission-test-run")
const firstClaimIntentPosition = 2

type TaskSelectionClaimOperation = Extract<WorkflowOperation, { readonly _tag: "AcquireTaskClaim" }>

export const projectFreshTaskAdmissionForTest = (
  runId: RunId,
  operations: ReadonlyArray<TaskSelectionClaimOperation>
): FreshTaskAdmissionProjection => {
  const records: ReadonlyArray<JournalRecord> = [
    makeWorkflowRunBeganRecord(
      runId,
      FixtureTarget.make(`fresh-task-admission-test:${runId}`),
      InitialControlPolicy.make({ taskExecutionCapacity: TaskWorkCapacity.make(Math.max(1, operations.length)) })
    ),
    ...operations.map((operation, index) => ({
      event: TaskClaimAcquisitionIntendedEvent.make({ operation, version: workflowJournalEventVersion }),
      key: intentRecordKey(operation.acquisition.operationId),
      position: JournalPosition.make(index + firstClaimIntentPosition),
      runId
    }))
  ]
  const projection = projectFreshTaskAdmission(runId, records)
  if (projection._tag === "FreshTaskAdmissionProjectionInvalid") {
    return Effect.runSync(Effect.die(`test claim history was invalid: ${projection.issues.join("; ")}`))
  }
  return projection
}

const occupancyRunId = (occupancy: TaskAdmissionOccupancy): RunId =>
  occupancy._tag === "FreshEntryReserved"
    ? occupancy.candidate.runId
    : occupancy._tag === "FreshTaskCommitted"
      ? occupancy.commitment.runId
      : occupancy.plannedAttempt.runId

/** Builds a valid branded basis from exact task-work aggregates and occupancy entries. */
export const makeFreshTaskAdmissionTestBasis = (input: FreshTaskAdmissionTestFixtureInput): FreshTaskAdmissionBasis =>
  Effect.runSync(
    Effect.gen(function* () {
      const entries = input.entries ?? []
      const commitments = entries.flatMap((entry) => (entry._tag === "FreshTaskCommitted" ? [entry.commitment] : []))
      const projection =
        commitments.length === 0
          ? undefined
          : projectFreshTaskAdmissionForTest(
              input.runId ?? commitments[0]?.runId ?? defaultFreshTaskAdmissionTestRunId,
              commitments.map(({ operation }) => operation)
            )
      return yield* makeFreshTaskAdmissionBasis({
        ...(projection === undefined
          ? input.acceptedAt === undefined
            ? {}
            : { acceptedAt: input.acceptedAt }
          : { acceptedAt: projection.acceptedAt, projection }),
        capacity: typeof input.capacity === "number" ? TaskWorkCapacity.make(input.capacity) : input.capacity,
        entries: [
          ...entries.filter(
            (entry): entry is Exclude<TaskAdmissionOccupancy, { readonly _tag: "FreshTaskCommitted" }> =>
              entry._tag !== "FreshTaskCommitted"
          ),
          ...(input.held ?? []).map((plannedAttempt) => TaskAdmissionOccupancy.ExactAttemptHeld({ plannedAttempt }))
        ],
        runId:
          input.runId ??
          input.held?.[0]?.runId ??
          (input.entries?.[0] === undefined ? defaultFreshTaskAdmissionTestRunId : occupancyRunId(input.entries[0]))
      })
    })
  )

/** Builds exact test-only authority for one already accepted task-selection claim operation. */
export const makeFreshTaskAdmissionProjectionForTest = (
  taskId: TaskId,
  operationId: OperationId,
  runId: RunId = defaultFreshTaskAdmissionTestRunId
): FreshTaskAdmissionProjection => {
  const operation = makeTaskClaimAcquisitionOperation({
    acquisition: TaskClaimAcquisition.make({
      operationId,
      owner: ClaimOwner.make(`dalph:test:${operationId}`),
      taskId,
      token: ClaimToken.make(`test-token:${operationId}`)
    }),
    predecessorOperationIds: []
  })
  return projectFreshTaskAdmissionForTest(runId, [operation])
}

/** Builds one canonical test projection containing several independent fresh claim intents. */
export const makeFreshTaskAdmissionsProjectionForTest = (
  claims: ReadonlyArray<{ readonly operationId: OperationId; readonly taskId: TaskId }>,
  runId: RunId = defaultFreshTaskAdmissionTestRunId
): FreshTaskAdmissionProjection =>
  projectFreshTaskAdmissionForTest(
    runId,
    claims.map(({ operationId, taskId }) =>
      makeTaskClaimAcquisitionOperation({
        acquisition: TaskClaimAcquisition.make({
          operationId,
          owner: ClaimOwner.make(`dalph:test:${operationId}`),
          taskId,
          token: ClaimToken.make(`test-token:${operationId}`)
        }),
        predecessorOperationIds: []
      })
    )
  )

/** Builds exact test-only commitment evidence through the canonical Journal projector. */
export const makeFreshTaskCommitmentForTest = (
  taskId: TaskId,
  operationId: OperationId,
  runId: RunId = defaultFreshTaskAdmissionTestRunId
): FreshTaskCommitment => {
  const commitment = makeFreshTaskAdmissionProjectionForTest(taskId, operationId, runId).commitments[0]?.commitment
  if (commitment === undefined) return Effect.runSync(Effect.die("test task-selection claim must produce a commitment"))
  return commitment
}
