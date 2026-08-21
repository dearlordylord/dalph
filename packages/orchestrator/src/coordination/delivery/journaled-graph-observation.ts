import { Option } from "effect"
import type { TaskId } from "@dalph/contracts"
import type { TaskDagSnapshot } from "../../authorities/task-tracker/graph.js"
import type { TrackerRevision } from "../../authorities/task-tracker/task.js"
import type { JournalPosition } from "../../workflow-journal/identity.js"
import type { OperationId } from "../../workflow/identity.js"
import type {
  CompleteTaskTrackerFactsObserved,
  TaskTrackerFactsObservedEvent,
  UnchangedTaskTrackerFactsReconfirmed
} from "../../workflow/task-tracker-facts/observation.js"

/** Validated descriptive graph fields before the journal applies its private authority brand. */
export interface JournaledGraphObservationFields {
  readonly _tag: "JournaledTrackerGraphObservation"
  readonly snapshot: TaskDagSnapshot
  readonly operationId: OperationId
  readonly contentIdentity: TrackerRevision
  readonly recordedAt: JournalPosition
  readonly freshness: { readonly _tag: "ObservedDuringLogicalRead"; readonly operationId: OperationId }
  /** Exact explicit closure subjects carried by the journaled logical read. */
  readonly explicitlyCoveredTaskIds: ReadonlyArray<TaskId>
}

type JournaledGraphFacts = CompleteTaskTrackerFactsObserved | UnchangedTaskTrackerFactsReconfirmed
type JournaledGraphEvent = TaskTrackerFactsObservedEvent & { readonly observation: JournaledGraphFacts }

const isJournaledGraphEvent = (event: TaskTrackerFactsObservedEvent): event is JournaledGraphEvent =>
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

/** Validates a receipt projection without claiming journal authority. */
export const journaledGraphObservationFieldsFromReceipt = <Receipt>(
  receipt: Receipt,
  read: (receipt: Receipt) => {
    readonly event: TaskTrackerFactsObservedEvent
    readonly position: JournalPosition
    readonly snapshot: TaskDagSnapshot
  }
): Option.Option<JournaledGraphObservationFields> => {
  const { event, position, snapshot } = read(receipt)
  if (!isJournaledGraphEvent(event)) return Option.none()
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
        _tag: "JournaledTrackerGraphObservation",
        snapshot,
        operationId,
        contentIdentity,
        explicitlyCoveredTaskIds: firstFamily.coverage.explicitlyCoveredTaskIds,
        recordedAt: position,
        freshness: { _tag: "ObservedDuringLogicalRead", operationId }
      })
    : Option.none()
}
