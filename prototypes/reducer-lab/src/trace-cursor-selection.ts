import { Schema } from "effect"
import {
  TraceCursor,
  type OperationId,
  type TraceAtCursor,
  type TraceCursor as TraceCursorType
} from "@dalph/orchestrator"
import type {
  AuthoredObservationCaptureOrder,
  AuthoredObservationMoment
} from "../../../packages/dalph/src/cassettes/authored-runner.ts"

/** Reuses the authored runner's branded story-position field without creating a second brand schema. */
type AuthoredStoryPosition = AuthoredObservationMoment["storyPosition"]

const noSelectedCursorIndex = -1

/** A cassette-only or current observation correlated beside, never inside, history. */
export interface AuxiliaryTraceCorrelation {
  readonly _tag: "AuxiliaryTraceCorrelation"
  readonly kind: "AuthoredStoryOccurrence" | "DeliveryRuntimeOwner"
  readonly captureOrder: AuthoredObservationCaptureOrder
  readonly storyPosition: AuthoredStoryPosition
  readonly nearestJournalCursor: TraceCursorType | null
}

export const auxiliaryTraceCorrelation = (
  kind: AuxiliaryTraceCorrelation["kind"],
  captureOrder: AuthoredObservationCaptureOrder,
  storyPosition: AuthoredStoryPosition,
  nearestJournalCursor: TraceCursorType | null
): AuxiliaryTraceCorrelation => ({
  _tag: "AuxiliaryTraceCorrelation",
  captureOrder,
  kind,
  nearestJournalCursor,
  storyPosition
})

const FollowingLive = Schema.TaggedStruct("FollowingLive", {})
const InspectingCursor = Schema.TaggedStruct("InspectingCursor", { cursor: TraceCursor })

export type TraceCursorSelectionPosition = typeof FollowingLive.Type | typeof InspectingCursor.Type

/**
 * Renderer-local navigation state. Production occurrence, graph, and causal
 * values stay in the trace-reader result; this type stores only exact cursor
 * selection and auxiliary presentation correlations.
 */
export interface TraceCursorSelectionModel {
  readonly _tag: "TraceCursorSelectionModel"
  readonly cursors: ReadonlyArray<TraceCursorType>
  readonly position: TraceCursorSelectionPosition
  readonly auxiliary: ReadonlyArray<AuxiliaryTraceCorrelation>
}

const sameCursor = (left: TraceCursorType, right: TraceCursorType): boolean =>
  left.runId === right.runId && left.position === right.position

export const makeTraceCursorSelectionModel = (
  cursors: ReadonlyArray<TraceCursorType>,
  auxiliary: ReadonlyArray<AuxiliaryTraceCorrelation> = []
): TraceCursorSelectionModel => {
  const ordered = [...cursors].sort((left, right) =>
    left.runId === right.runId ? left.position - right.position : left.runId.localeCompare(right.runId)
  )
  const duplicate = ordered.find((cursor, index) => {
    const previous = ordered[index - 1]
    return previous !== undefined && sameCursor(previous, cursor)
  })
  if (duplicate !== undefined) throw new Error(`duplicate production trace cursor at ${duplicate.runId}:${duplicate.position}`)
  return {
    _tag: "TraceCursorSelectionModel",
    auxiliary: [...auxiliary],
    cursors: ordered,
    position: FollowingLive.make({})
  }
}

export const TraceCursorSelected = Schema.TaggedStruct("TraceCursorSelected", { cursor: TraceCursor })
export const TraceCursorFollowingLive = Schema.TaggedStruct("TraceCursorFollowingLive", {})
export const PreviousTraceCursorRequested = Schema.TaggedStruct("PreviousTraceCursorRequested", {})
export const NextTraceCursorRequested = Schema.TaggedStruct("NextTraceCursorRequested", {})
export type TraceCursorSelectionMessage =
  | typeof TraceCursorSelected.Type
  | typeof TraceCursorFollowingLive.Type
  | typeof PreviousTraceCursorRequested.Type
  | typeof NextTraceCursorRequested.Type

const currentCursor = (model: TraceCursorSelectionModel): TraceCursorType | null => {
  if (model.cursors.length === 0) return null
  return model.position._tag === "FollowingLive"
    ? model.cursors[model.cursors.length - 1] ?? null
    : model.position.cursor
}

const inspect = (model: TraceCursorSelectionModel, cursor: TraceCursorType): TraceCursorSelectionModel => ({
  ...model,
  position: InspectingCursor.make({ cursor })
})

/** Moves only among exact production cursor identities; it never accepts a renderer index. */
export const updateTraceCursorSelection = (
  model: TraceCursorSelectionModel,
  message: TraceCursorSelectionMessage
): TraceCursorSelectionModel => {
  if (message._tag === "TraceCursorFollowingLive") return { ...model, position: FollowingLive.make({}) }
  if (message._tag === "TraceCursorSelected") {
    return model.cursors.some((cursor) => sameCursor(cursor, message.cursor)) ? inspect(model, message.cursor) : model
  }
  const current = currentCursor(model)
  if (current === null) return model
  const index = model.cursors.findIndex((cursor) => sameCursor(cursor, current))
  if (index < 0) return model
  const nextIndex = message._tag === "PreviousTraceCursorRequested" ? index - 1 : index + 1
  const next = model.cursors[nextIndex]
  return next === undefined ? model : inspect(model, next)
}

export interface TraceCursorSelectionOption {
  readonly cursor: TraceCursorType
  readonly label: string
  readonly selected: boolean
}

export interface TraceCursorSelectionProjection {
  readonly auxiliary: ReadonlyArray<AuxiliaryTraceCorrelation>
  readonly cursor: TraceCursorType | null
  readonly options: ReadonlyArray<TraceCursorSelectionOption>
  readonly followingLive: boolean
  readonly status: string
}

const cursorLabel = (cursor: TraceCursorType): string => `Run ${cursor.runId} · journal position ${cursor.position}`

export const projectTraceCursorSelection = (
  model: TraceCursorSelectionModel
): TraceCursorSelectionProjection => {
  const cursor = currentCursor(model)
  const selected = cursor === null
    ? noSelectedCursorIndex
    : model.cursors.findIndex((candidate) => sameCursor(candidate, cursor))
  return {
    auxiliary: model.auxiliary,
    cursor,
    followingLive: model.position._tag === "FollowingLive",
    options: model.cursors.map((candidate) => ({
      cursor: candidate,
      label: cursorLabel(candidate),
      selected: cursor !== null && sameCursor(candidate, cursor)
    })),
    status: cursor === null
      ? "0 journal positions · no production cursor"
      : `${selected + 1} / ${model.cursors.length} · ${cursorLabel(cursor)}${model.position._tag === "FollowingLive" ? " · live" : " · history"}`
  }
}

/** Looks up the production reader result by exact cursor; no prefix is folded locally. */
export const historyAtCursor = <History extends { readonly cursor: TraceCursorType }>(
  histories: ReadonlyArray<History>,
  cursor: TraceCursorType
): History | undefined => histories.find((history) => sameCursor(history.cursor, cursor))

export type TraceCausalPredecessorResolution =
  | {
      readonly _tag: "Resolved"
      readonly cursor: TraceCursorType
      readonly predecessorOperationId: OperationId
      readonly successorOperationId: OperationId
    }
  | {
      readonly _tag: "Missing"
      readonly predecessorOperationId: OperationId
      readonly reason: "CausalEdgeNotProven" | "PredecessorNotProjected" | "PredecessorCursorUnavailable"
      readonly successorOperationId: OperationId
    }

/** Resolves a displayed production causal edge to the predecessor's exact cursor. */
export const resolveTraceCausalPredecessor = (
  histories: ReadonlyArray<TraceAtCursor>,
  selected: TraceAtCursor,
  successorOperationId: OperationId,
  predecessorOperationId: OperationId
): TraceCausalPredecessorResolution => {
  const edge = selected.relationships.workflowCausalEdges.find(
    ({ predecessorOperationId: predecessor, successorOperationId: successor }) =>
      predecessor === predecessorOperationId && successor === successorOperationId
  )
  if (edge === undefined) {
    return {
      _tag: "Missing",
      predecessorOperationId,
      reason: "CausalEdgeNotProven",
      successorOperationId
    }
  }
  const predecessorItem = selected.items.find((item) => item.operationIds.includes(predecessorOperationId))
  if (predecessorItem === undefined) {
    return {
      _tag: "Missing",
      predecessorOperationId,
      reason: "PredecessorNotProjected",
      successorOperationId
    }
  }
  const predecessorCursor = TraceCursor.make({
    position: predecessorItem.identity.position,
    runId: predecessorItem.identity.runId
  })
  if (historyAtCursor(histories, predecessorCursor) === undefined) {
    return {
      _tag: "Missing",
      predecessorOperationId,
      reason: "PredecessorCursorUnavailable",
      successorOperationId
    }
  }
  return {
    _tag: "Resolved",
    cursor: predecessorCursor,
    predecessorOperationId,
    successorOperationId
  }
}
