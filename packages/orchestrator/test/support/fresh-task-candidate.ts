import { compareTaskIds, type RunId } from "@dalph/contracts"
import { Effect, Option } from "effect"
import { FixtureTarget } from "../../src/authorities/task-tracker/fixture/target.js"
import { projectTrackerSnapshot } from "../../src/authorities/task-tracker/graph.js"
import { TaskLifecycle, type Task } from "../../src/authorities/task-tracker/task.js"
import { TaskWorkCapacity } from "../../src/coordination/admission/capacity.js"
import { initialRunPolicyRevision, RunControlPolicy } from "../../src/control/policy.js"
import type { CurrentDeliveryFrame } from "../../src/coordination/run/current-delivery-frame.js"
import { RunActivationOpportunity } from "../../src/coordination/run/run-activation-opportunity.js"
import type { AcceptedFreshTaskAdmission } from "../../src/coordination/delivery/delivery-runtime-admission.js"
import { deliveryProposalOfAcceptedFreshTask } from "../../src/coordination/delivery/delivery-proposal-derivation.js"
import {
  deriveFreshTaskCandidateEvaluation,
  type FreshTaskCandidateFrontier,
  type FreshTaskEntryDecision
} from "../../src/coordination/delivery/fresh-task-candidate.js"
import { JournalPosition } from "../../src/workflow-journal/identity.js"
import { intentRecordKey, outcomeRecordKey } from "../../src/workflow-journal/record-key.js"
import type { JournalRecord } from "../../src/workflow-journal/store.js"
import { makeTrackerGraphObservationOperation } from "../../src/workflow/registry/operation.js"
import {
  makeCompleteTaskTrackerFactsObserved,
  taskTrackerFactsObservedEvent
} from "../../src/workflow/task-tracker-facts/observation.js"
import { taskTrackerReadIntent } from "../../src/workflow/registry/event.js"
import { OperationId } from "../../src/workflow/identity.js"

const target = FixtureTarget.make("controlled-test-frontier-authority")
const acceptedGraphReadRecordCount = 2

const completedPrerequisitesFor = (decisions: ReadonlyArray<FreshTaskEntryDecision>): ReadonlyArray<Task> => {
  const candidateTaskIds = new Set(decisions.map(({ step }) => step.task.id))
  return [
    ...new Set(decisions.flatMap(({ step }) => step.task.prerequisiteIds).filter((id) => !candidateTaskIds.has(id)))
  ].map((id) => ({
    id,
    lifecycle: TaskLifecycle.cases.CompletedSuccessfully.make({}),
    parentTaskId: null,
    prerequisiteIds: []
  }))
}

const acceptedGraphReadRecords = (
  operation: ReturnType<typeof makeTrackerGraphObservationOperation>,
  snapshot: CurrentDeliveryFrame["currentGraph"],
  position: number,
  runId: RunId
): ReadonlyArray<JournalRecord> => [
  {
    event: taskTrackerReadIntent(operation),
    key: intentRecordKey(operation.operationId),
    position: JournalPosition.make(position),
    runId
  },
  {
    event: taskTrackerFactsObservedEvent(
      operation.operationId,
      makeCompleteTaskTrackerFactsObserved(operation, snapshot)
    ),
    key: outcomeRecordKey(operation.operationId),
    position: JournalPosition.make(position + 1),
    runId
  }
]

/**
 * Test-only derivation of genuine production frontier authority from a complete
 * graph and accepted graph-read history. It cannot copy or manufacture the
 * module-private frontier identity.
 */
export const makeFreshTaskCandidateFrontierForTest = (input: {
  readonly acceptedAt?: JournalPosition | null
  readonly decisions: ReadonlyArray<FreshTaskEntryDecision>
  readonly runId: RunId
}): FreshTaskCandidateFrontier => {
  const tasks = [...input.decisions.map(({ step }) => step.task), ...completedPrerequisitesFor(input.decisions)]
  const projected = projectTrackerSnapshot({
    revision: `controlled-frontier:${input.runId}:${tasks.map(({ id }) => id).join(",") || "empty"}`,
    tasks
  })
  if (projected._tag === "Invalid") {
    return Effect.runSync(Effect.die(`controlled frontier graph is invalid: ${JSON.stringify(projected.issues)}`))
  }
  const readCurrentDecision = input.decisions.find(({ step }) => step._tag === "ReadCurrentTaskGraph")
  const globalOperationId =
    readCurrentDecision?.step.predecessorOperationId ?? OperationId.make("controlled-global-graph")
  const globalOperation = makeTrackerGraphObservationOperation(
    { _tag: "WorkflowEstablishment" },
    globalOperationId,
    target,
    [],
    []
  )
  const focusedOperations = input.decisions.flatMap(({ step }) =>
    step._tag === "AcquireTaskClaim"
      ? [
          makeTrackerGraphObservationOperation(
            { _tag: "WorkflowEstablishment" },
            step.predecessorOperationId,
            target,
            [],
            [step.task.id]
          )
        ]
      : []
  )
  const records = [globalOperation, ...focusedOperations].flatMap((operation, index) =>
    acceptedGraphReadRecords(operation, projected.snapshot, index * acceptedGraphReadRecordCount + 1, input.runId)
  )
  const frame: CurrentDeliveryFrame = {
    acceptedAt: JournalPosition.make(records.length),
    currentGraph: projected.snapshot,
    currentGraphOperationId: globalOperation.operationId,
    pause: { run: { _tag: "RunUnpaused" }, tasks: { _tag: "NoTaskPauses" } },
    responsibility: { entries: [] },
    runId: input.runId,
    runControlPolicy: RunControlPolicy.make({
      revision: initialRunPolicyRevision,
      taskExecutionCapacity: TaskWorkCapacity.make(Math.max(1, input.decisions.length))
    }),
    workflowHistory: { records }
  }
  const frontier = Effect.runSync(
    deriveFreshTaskCandidateEvaluation({
      acceptedAt: input.acceptedAt ?? null,
      activeRefreshBoundaryReached: false,
      frame,
      opportunity: RunActivationOpportunity.OrdinaryRunEntry(),
      recoveredAttemptIds: new Set(),
      runId: input.runId,
      target
    })
  ).frontier
  const expected = input.decisions
    .map(({ step }) => [step.task.id, step._tag] as const)
    .toSorted(([left], [right]) => compareTaskIds(left, right))
  const actual = frontier.candidates.map(({ decision, taskId }) => [taskId, decision.step._tag] as const)
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    return Effect.runSync(
      Effect.die(`production frontier differs from controlled decisions: ${JSON.stringify({ actual, expected })}`)
    )
  }
  return frontier
}

/** Test-only proposal at the boundary immediately after runtime accepted a graph-read candidate. */
export const makeFreshTaskGraphReadProposalForTest = (input: {
  readonly predecessorOperationId: OperationId
  readonly runId: RunId
  readonly task: Task
}) => {
  const frontier = makeFreshTaskCandidateFrontierForTest({
    decisions: [
      {
        step: { _tag: "ReadCurrentTaskGraph", predecessorOperationId: input.predecessorOperationId, task: input.task },
        transition: {
          _tag: "ContinueFreshWorkflowOperation",
          operationId: input.predecessorOperationId,
          taskId: input.task.id
        }
      }
    ],
    runId: input.runId
  })
  const candidate = Option.getOrThrow(Option.fromUndefinedOr(frontier.candidates[0]))
  // oxlint-disable-next-line dalph/no-type-assertion -- isolated test stand-in for runtime's opaque proof.
  const accepted = { candidate } as unknown as AcceptedFreshTaskAdmission
  return deliveryProposalOfAcceptedFreshTask(accepted)
}
