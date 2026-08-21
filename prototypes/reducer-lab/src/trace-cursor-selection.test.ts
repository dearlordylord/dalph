import { strict as assert } from "node:assert"
import {
  AuthoredObservationCaptureOrder,
  type AuthoredObservationMoment
} from "../../../packages/dalph/src/cassettes/authored-runner.ts"
import { RunId } from "../../../packages/contracts/src/workflow-identity.ts"
import { JournalPosition, OperationId, TraceAtCursor, TraceCursor } from "../../../packages/orchestrator/src/index.ts"
import {
  NextTraceCursorRequested,
  PreviousTraceCursorRequested,
  TraceCursorFollowingLive,
  TraceCursorSelected,
  auxiliaryTraceCorrelation,
  historyAtCursor,
  makeTraceCursorSelectionModel,
  projectTraceCursorSelection,
  resolveTraceCausalPredecessor,
  updateTraceCursorSelection
} from "./trace-cursor-selection.ts"

const runId = RunId.make("run:lab")
const first = TraceCursor.make({ position: JournalPosition.make(3), runId })
const second = TraceCursor.make({ position: JournalPosition.make(7), runId })
const unrelated = TraceCursor.make({ position: JournalPosition.make(11), runId })
const authoredStoryPosition = (value: number): AuthoredObservationMoment["storyPosition"] =>
  value as AuthoredObservationMoment["storyPosition"]

const model = makeTraceCursorSelectionModel(
  [unrelated, first, second],
  [
    auxiliaryTraceCorrelation(
      "AuthoredStoryOccurrence",
      AuthoredObservationCaptureOrder.make(99),
      authoredStoryPosition(4),
      first
    ),
    auxiliaryTraceCorrelation(
      "DeliveryRuntimeOwner",
      AuthoredObservationCaptureOrder.make(1),
      authoredStoryPosition(1),
      null
    )
  ]
)

assert.deepEqual(
  projectTraceCursorSelection(model).options.map(({ cursor }) => cursor.position),
  [3, 7, 11],
  "renderer options retain exact production journal positions"
)
assert.equal(projectTraceCursorSelection(model).cursor?.position, 11)

{
  const [history] = [updateTraceCursorSelection(model, TraceCursorSelected.make({ cursor: second }))]
  assert.equal(projectTraceCursorSelection(history).cursor?.position, 7)
  const previous = updateTraceCursorSelection(history, PreviousTraceCursorRequested.make({}))
  assert.equal(projectTraceCursorSelection(previous).cursor?.position, 3)
  const next = updateTraceCursorSelection(previous, NextTraceCursorRequested.make({}))
  assert.equal(projectTraceCursorSelection(next).cursor?.position, 7)
  const live = updateTraceCursorSelection(history, TraceCursorFollowingLive.make({}))
  assert.equal(projectTraceCursorSelection(live).cursor?.position, 11)
}

assert.deepEqual(
  projectTraceCursorSelection(model).auxiliary,
  [
    { _tag: "AuxiliaryTraceCorrelation", captureOrder: 99, kind: "AuthoredStoryOccurrence", nearestJournalCursor: first, storyPosition: 4 },
    { _tag: "AuxiliaryTraceCorrelation", captureOrder: 1, kind: "DeliveryRuntimeOwner", nearestJournalCursor: null, storyPosition: 1 }
  ],
  "story and runtime observations remain beside the exact cursor and do not become journal positions"
)

assert.equal(
  historyAtCursor(
    [{ cursor: first, value: "first" }, { cursor: second, value: "second" }],
    second
  )?.value,
  "second"
)

const predecessorOperationId = OperationId.make("operation:predecessor")
const successorOperationId = OperationId.make("operation:successor")
const traceAt = (
  cursor: typeof first,
  items: ReadonlyArray<unknown>,
  workflowCausalEdges: ReadonlyArray<unknown>
): typeof TraceAtCursor.Type => ({
  cursor,
  items,
  relationships: { workflowCausalEdges }
} as unknown as typeof TraceAtCursor.Type)
const predecessorHistory = traceAt(
  first,
  [{ identity: first, operationIds: [predecessorOperationId] }],
  [{ predecessorOperationId, successorOperationId }]
)
const successorHistory = traceAt(
  second,
  [{ identity: first, operationIds: [predecessorOperationId] }],
  [{ predecessorOperationId, successorOperationId }]
)
const resolvedPredecessor = resolveTraceCausalPredecessor(
  [predecessorHistory, successorHistory],
  successorHistory,
  successorOperationId,
  predecessorOperationId
)
assert.equal(resolvedPredecessor._tag, "Resolved")
if (resolvedPredecessor._tag === "Resolved") assert.deepEqual(resolvedPredecessor.cursor, first)
const notProjectedPredecessor = resolveTraceCausalPredecessor(
  [traceAt(second, [], [{ predecessorOperationId, successorOperationId }])],
  traceAt(second, [], [{ predecessorOperationId, successorOperationId }]),
  successorOperationId,
  predecessorOperationId
)
assert.equal(notProjectedPredecessor._tag, "Missing")
if (notProjectedPredecessor._tag === "Missing") assert.equal(notProjectedPredecessor.reason, "PredecessorNotProjected")

console.log("✓ navigates Lab history by production TraceCursor while keeping authored/runtime observations auxiliary")
