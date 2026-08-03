import { Option } from "effect"
import type { TaskDagSnapshot } from "../../authorities/task-tracker/graph.js"
import type { TrackerRevision } from "../../authorities/task-tracker/task.js"
import type { JournalPosition } from "../../workflow-journal/identity.js"
import type { OperationId } from "../../workflow/identity.js"
import type {
  CompleteTaskTrackerFactsObserved,
  TaskTrackerFactsObservedEvent,
  UnchangedTaskTrackerFactsReconfirmed
} from "../../workflow/task-tracker-facts/observation.js"

const AcceptedTrackerGraphObservationTypeId: unique symbol = Symbol("AcceptedTrackerGraphObservation")

/**
 * One accepted complete or unchanged graph observation. The private brand means
 * only the accepted journal boundary can place graph authority into delivery.
 */
export interface AcceptedTrackerGraphObservation {
  readonly [AcceptedTrackerGraphObservationTypeId]: typeof AcceptedTrackerGraphObservationTypeId
  readonly _tag: "AcceptedTrackerGraphObservation"
  readonly snapshot: TaskDagSnapshot
  readonly operationId: OperationId
  readonly contentIdentity: TrackerRevision
  readonly acceptedAt: JournalPosition
  readonly freshness: { readonly _tag: "ObservedDuringLogicalRead"; readonly operationId: OperationId }
}

type AcceptedGraphFacts = CompleteTaskTrackerFactsObserved | UnchangedTaskTrackerFactsReconfirmed
type AcceptedGraphEvent = TaskTrackerFactsObservedEvent & { readonly observation: AcceptedGraphFacts }

const isAcceptedGraphEvent = (event: TaskTrackerFactsObservedEvent): event is AcceptedGraphEvent =>
  event.observation._tag === "CompleteTaskTrackerFacts" ||
  event.observation._tag === "UnchangedTaskTrackerFactsReconfirmed"

const completeSnapshotMatchesFacts = (
  observation: CompleteTaskTrackerFactsObserved,
  snapshot: TaskDagSnapshot
): boolean => {
  const [identities, lifecycles, prerequisites, groupings] = observation.factFamilies
  const expectedTasks = snapshot.toWire().tasks
  const observedTasks = identities.taskIds
    .toSorted()
    .map((taskId) => ({
      id: taskId,
      lifecycle: lifecycles.lifecycles.find(({ taskId: candidate }) => candidate === taskId)?.lifecycle,
      parentTaskId: groupings.groupings.find(({ taskId: candidate }) => candidate === taskId)?.parentTaskId,
      prerequisiteIds: prerequisites.prerequisites
        .find(({ taskId: candidate }) => candidate === taskId)
        ?.prerequisiteTaskIds.toSorted()
    }))
  return JSON.stringify(expectedTasks) === JSON.stringify(observedTasks)
}

/**
 * Validates a gateway-owned complete/reconfirmed receipt projection and mints
 * graph authority only when all cross-boundary facts agree.
 */
export const acceptedTrackerGraphObservationFromAcceptedReceipt = <Receipt>(
  receipt: Receipt,
  read: (receipt: Receipt) => {
    readonly event: TaskTrackerFactsObservedEvent
    readonly position: JournalPosition
    readonly snapshot: TaskDagSnapshot
  }
): Option.Option<AcceptedTrackerGraphObservation> => {
  const { event, position, snapshot } = read(receipt)
  if (!isAcceptedGraphEvent(event)) return Option.none()
  const { observation } = event
  const firstFamily = observation.factFamilies[0]
  const contentIdentity = firstFamily.contentIdentity
  const operationId = observation.operationId
  const familiesMatch = observation.factFamilies.every(
    (family) => family.contentIdentity === contentIdentity && family.freshness.operationId === operationId
  )
  const snapshotMatches =
    observation._tag === "UnchangedTaskTrackerFactsReconfirmed" || completeSnapshotMatchesFacts(observation, snapshot)
  return event.operationId === operationId &&
    familiesMatch &&
    snapshot.revision === contentIdentity &&
    position >= 1 &&
    snapshotMatches
    ? Option.some({
        [AcceptedTrackerGraphObservationTypeId]: AcceptedTrackerGraphObservationTypeId,
        _tag: "AcceptedTrackerGraphObservation",
        snapshot,
        operationId,
        contentIdentity,
        acceptedAt: position,
        freshness: { _tag: "ObservedDuringLogicalRead", operationId }
      })
    : Option.none()
}
