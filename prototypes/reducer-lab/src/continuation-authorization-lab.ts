import { Schema } from "effect"
import {
  plannedAttemptExecutorCorrelation,
  plannedTaskAttemptEquivalence,
  type AttemptId,
  type PlannedAttemptExecutorCorrelation,
  type PlannedTaskAttempt,
  type RunId
} from "@dalph/contracts"
import {
  evaluatePlannedAttemptContinuationAuthorization,
  JournalRecord as JournalRecordSchema,
  type JournalRecord,
  type PlannedAttemptContinuationWitness
} from "@dalph/orchestrator"
import type { JournalPosition } from "../../../packages/orchestrator/src/workflow-journal/identity.ts"
import type { OperationId } from "../../../packages/orchestrator/src/workflow/identity.ts"
import type { CassetteLabResult } from "./cassette-lab.ts"

const continuationCassetteKey = "authored:coordinatorProcessDeathContinues" as const

type ObservationPair = {
  readonly operationId: OperationId
  readonly intentPosition: JournalPosition
  readonly observationPosition: JournalPosition
}

export interface ContinuationAuthorizationWitnessPositions {
  readonly activeTask: {
    readonly graph: ObservationPair
    readonly specification: ObservationPair
    readonly claim: ObservationPair
  }
  readonly worktree: ObservationPair
}

export type ContinuationExecutorReport =
  | { readonly _tag: "Running"; readonly position: JournalPosition }
  | { readonly _tag: "Terminal"; readonly position: JournalPosition }

export type ContinuationExecutorBoundary =
  | { readonly _tag: "NoCommandIntent" }
  | { readonly _tag: "CommandIntentRecorded"; readonly position: JournalPosition }
  | { readonly _tag: "ExecutorReportObserved"; readonly position: JournalPosition }

interface ContinuationPrefixBase {
  readonly attemptId: AttemptId
  readonly authorizationPosition: JournalPosition | null
  readonly executorReport: ContinuationExecutorReport | null
  readonly runId: RunId
  readonly throughPosition: JournalPosition
  readonly witnesses: ContinuationAuthorizationWitnessPositions
}

export type ContinuationAuthorizationPrefix =
  | (ContinuationPrefixBase & { readonly _tag: "BeforeAuthorization"; readonly authorizationPosition: null; readonly executorReport: null })
  | (ContinuationPrefixBase & {
    readonly _tag: "AfterAuthorizationBeforeReport"
    readonly authorizationPosition: JournalPosition
    readonly executorReport: null
  })
  | (ContinuationPrefixBase & {
    readonly _tag: "AfterRunning"
    readonly authorizationPosition: JournalPosition
    readonly executorReport: Extract<ContinuationExecutorReport, { readonly _tag: "Running" }>
  })
  | (ContinuationPrefixBase & {
    readonly _tag: "AfterTerminal"
    readonly authorizationPosition: JournalPosition
    readonly executorReport: Extract<ContinuationExecutorReport, { readonly _tag: "Terminal" }>
  })

export interface ContinuationAuthorizationIdentity {
  /** Every planned executor attempt recorded for this Run, including later attempts. */
  readonly plannedAttemptCorrelations: ReadonlyArray<PlannedAttemptExecutorCorrelation>
  /** Every durable executor-work responsibility recorded for this Run. */
  readonly responsibilityCorrelations: ReadonlyArray<PlannedAttemptExecutorCorrelation>
  /** Every continuation authorization recorded for this Run. */
  readonly authorizationCorrelations: ReadonlyArray<PlannedAttemptExecutorCorrelation>
  /** Every executor report recorded for this Run, including Running and Terminal reports. */
  readonly reportCorrelations: ReadonlyArray<PlannedAttemptExecutorCorrelation>
  /** Number of durable executor-work responsibilities recorded for this Run. */
  readonly responsibilityCount: number
  /** Number of generic continuation authorizations recorded for this Run. */
  readonly authorizationCount: number
  /** Attempt identities found in all exact executor correlations for this Run. */
  readonly plannedAttemptIds: ReadonlyArray<AttemptId>
}

export interface ContinuationAuthorizationProjection {
  readonly _tag: "ContinuationAuthorizationProjection"
  readonly catalogKey: typeof continuationCassetteKey
  readonly runId: RunId
  readonly attemptId: AttemptId
  readonly plannedAttempt: PlannedTaskAttempt
  readonly authorization: {
    readonly position: JournalPosition
    readonly plannedAttempt: PlannedTaskAttempt
    readonly witness: PlannedAttemptContinuationWitness
  }
  readonly witnesses: ContinuationAuthorizationWitnessPositions
  readonly prefixes: ReadonlyArray<ContinuationAuthorizationPrefix>
  readonly executorBoundary: ContinuationExecutorBoundary
  readonly identity: ContinuationAuthorizationIdentity
}

const recordsBefore = (records: ReadonlyArray<JournalRecord>, position: JournalPosition): ReadonlyArray<JournalRecord> =>
  records.filter((record) => record.position < position)

const latestRecord = (
  records: ReadonlyArray<JournalRecord>,
  predicate: (record: JournalRecord) => boolean
): JournalRecord | undefined => records.findLast(predicate)

const operationPair = (
  records: ReadonlyArray<JournalRecord>,
  operationId: OperationId,
  intentTag: "ReadTrackerGraph" | "ReadTaskWorkSpecification" | "ReadTaskClaim" | "ReadTaskWorktree",
  observationTag: "TaskTrackerFactsObserved" | "PlannedAttemptWorktreeObserved"
): ObservationPair | undefined => {
  const intent = latestRecord(
    records,
    ({ event }) =>
      (event._tag === "TaskTrackerReadIntentRecorded" || event._tag === "GitReadIntentRecorded") &&
      event.operation._tag === intentTag &&
      event.operation.operationId === operationId
  )
  const observation = latestRecord(
    records,
    ({ event }) =>
      event._tag === observationTag &&
      event.operationId === operationId
  )
  if (intent === undefined || observation === undefined) return undefined
  return {
    operationId,
    intentPosition: intent.position,
    observationPosition: observation.position
  }
}

const continuationWitnessPositions = (
  records: ReadonlyArray<JournalRecord>,
  witness: PlannedAttemptContinuationWitness,
  through: JournalPosition
): ContinuationAuthorizationWitnessPositions | undefined => {
  const prefix = recordsBefore(records, through)
  const graph = operationPair(
    prefix,
    witness.activeTaskContinuationRead.graphObservationOperationId,
    "ReadTrackerGraph",
    "TaskTrackerFactsObserved"
  )
  const specification = operationPair(
    prefix,
    witness.activeTaskContinuationRead.taskWorkSpecificationObservationOperationId,
    "ReadTaskWorkSpecification",
    "TaskTrackerFactsObserved"
  )
  const claim = operationPair(
    prefix,
    witness.activeTaskContinuationRead.taskClaimObservationOperationId,
    "ReadTaskClaim",
    "TaskTrackerFactsObserved"
  )
  const worktree = operationPair(prefix, witness.worktreeObservationOperationId, "ReadTaskWorktree", "PlannedAttemptWorktreeObserved")
  if (graph === undefined || specification === undefined || claim === undefined || worktree === undefined) return undefined
  return { activeTask: { graph, specification, claim }, worktree }
}

const distinct = <T>(values: ReadonlyArray<T>): ReadonlyArray<T> => [...new Set(values)]

const identityOf = (
  records: ReadonlyArray<JournalRecord>,
  runId: RunId
): ContinuationAuthorizationIdentity => {
  const plannedAttemptCorrelations = records.flatMap(({ event, runId: recordRunId }) =>
    event._tag === "TaskAttemptPlanned" && recordRunId === runId
      ? [plannedAttemptExecutorCorrelation(event.operation.plannedAttempt)]
      : []
  )
  const responsibilityCorrelations = records.flatMap(({ event, runId: recordRunId }) =>
    event._tag === "PlannedAttemptExecutorWorkResponsibilityBegan" && recordRunId === runId
      ? [plannedAttemptExecutorCorrelation(event.plannedAttempt)]
      : []
  )
  const authorizationCorrelations = records.flatMap(({ event, runId: recordRunId }) =>
    event._tag === "PlannedAttemptContinuationAuthorized" && recordRunId === runId
      ? [plannedAttemptExecutorCorrelation(event.plannedAttempt)]
      : []
  )
  const reportCorrelations = records.flatMap(({ event, runId: recordRunId }) =>
    event._tag === "PlannedAttemptExecutorWorkReported" && recordRunId === runId
      ? [event.report.correlation]
      : []
  )
  const plannedAttemptIds = distinct([
    ...plannedAttemptCorrelations,
    ...responsibilityCorrelations,
    ...authorizationCorrelations,
    ...reportCorrelations
  ].map(({ attemptId }) => attemptId))
  return {
    plannedAttemptCorrelations,
    responsibilityCorrelations,
    authorizationCorrelations,
    reportCorrelations,
    responsibilityCount: responsibilityCorrelations.length,
    authorizationCount: authorizationCorrelations.length,
    plannedAttemptIds
  }
}

const executorReports = (
  records: ReadonlyArray<JournalRecord>,
  plannedAttempt: PlannedTaskAttempt,
  authorizationPosition: JournalPosition
): ReadonlyArray<ContinuationExecutorReport> => records.flatMap(({ event, position, runId }) => {
  if (
    event._tag !== "PlannedAttemptExecutorWorkReported" ||
    runId !== plannedAttempt.runId ||
    event.report.correlation.attemptId !== plannedAttempt.attemptId ||
    position <= authorizationPosition
  ) return []
  return event.report._tag === "Running" || event.report._tag === "Terminal"
    ? [{ _tag: event.report._tag, position }]
    : []
})

const prefixThrough = (records: ReadonlyArray<JournalRecord>, position: JournalPosition): JournalPosition | undefined =>
  records.filter((record) => record.position <= position).at(-1)?.position

const decodeJournalRecords = (result: CassetteLabResult): ReadonlyArray<JournalRecord> => {
  if (result._tag !== "Completed" || result.catalogKey !== continuationCassetteKey) return []
  return Schema.decodeUnknownSync(Schema.Array(JournalRecordSchema))(result.journalRecords)
}

/** Returns the production journal records for the maintained #171 recovery cassette. */
export const continuationAuthorizationJournalRecordsOf = (result: CassetteLabResult): ReadonlyArray<JournalRecord> =>
  decodeJournalRecords(result)

/** Projects only durable continuation facts; the Lab does not run a second reducer or cassette. */
export const continuationAuthorizationProjectionOf = (
  result: CassetteLabResult
): ContinuationAuthorizationProjection | null => {
  if (result._tag !== "Completed" || result.catalogKey !== continuationCassetteKey || result.runId === null) return null
  const records = decodeJournalRecords(result)
  const sorted = records.toSorted((left, right) => left.position - right.position)
  const responsibility = sorted.find(
    ({ event, runId }) => event._tag === "PlannedAttemptExecutorWorkResponsibilityBegan" && runId === result.runId
  )
  if (responsibility === undefined || responsibility.event._tag !== "PlannedAttemptExecutorWorkResponsibilityBegan") return null
  const plannedAttempt = responsibility.event.plannedAttempt
  const authorization = sorted.find(
    ({ event, runId }) =>
      event._tag === "PlannedAttemptContinuationAuthorized" &&
      runId === plannedAttempt.runId &&
      plannedTaskAttemptEquivalence(event.plannedAttempt, plannedAttempt)
  )
  if (authorization === undefined || authorization.event._tag !== "PlannedAttemptContinuationAuthorized") return null
  const witnesses = continuationWitnessPositions(sorted, authorization.event.witness, authorization.position)
  if (witnesses === undefined) return null
  const beforeThrough = sorted.findLast(({ position }) => position < authorization.position)?.position
  if (beforeThrough === undefined) return null
  const prefixes: Array<ContinuationAuthorizationPrefix> = [{
    _tag: "BeforeAuthorization",
    attemptId: plannedAttempt.attemptId,
    authorizationPosition: null,
    executorReport: null,
    runId: plannedAttempt.runId,
    throughPosition: beforeThrough,
    witnesses
  }, {
    _tag: "AfterAuthorizationBeforeReport",
    attemptId: plannedAttempt.attemptId,
    authorizationPosition: authorization.position,
    executorReport: null,
    runId: plannedAttempt.runId,
    throughPosition: authorization.position,
    witnesses
  }]
  for (const report of executorReports(sorted, plannedAttempt, authorization.position)) {
    const through = prefixThrough(sorted, report.position)
    if (through === undefined) continue
    if (report._tag === "Running") {
      prefixes.push({
        _tag: "AfterRunning",
        attemptId: plannedAttempt.attemptId,
        authorizationPosition: authorization.position,
        executorReport: report,
        runId: plannedAttempt.runId,
        throughPosition: through,
        witnesses
      })
    } else {
      prefixes.push({
        _tag: "AfterTerminal",
        attemptId: plannedAttempt.attemptId,
        authorizationPosition: authorization.position,
        executorReport: report,
        runId: plannedAttempt.runId,
        throughPosition: through,
        witnesses
      })
    }
  }
  return {
    _tag: "ContinuationAuthorizationProjection",
    catalogKey: continuationCassetteKey,
    runId: plannedAttempt.runId,
    attemptId: plannedAttempt.attemptId,
    plannedAttempt,
    authorization: {
      position: authorization.position,
      plannedAttempt: authorization.event.plannedAttempt,
      witness: authorization.event.witness
    },
    witnesses,
    prefixes,
    executorBoundary: executorBoundaryOf(sorted, plannedAttempt),
    identity: identityOf(sorted, plannedAttempt.runId)
  }
}

export type ContinuationAuthorizationContactDecision =
  | {
      readonly _tag: "ExecutorContactAvailable"
      readonly executorContact: "Available"
      readonly executorBoundary: ContinuationExecutorBoundary
      readonly evaluation: { readonly _tag: "Authorized" }
    }
  | {
      readonly _tag: "ExecutorContactUnavailable"
      readonly executorContact: "Unavailable"
      readonly executorBoundary: ContinuationExecutorBoundary
      readonly evaluation: Exclude<ReturnType<typeof evaluatePlannedAttemptContinuationAuthorization>, { readonly _tag: "Authorized" }>
    }

const executorBoundaryOf = (
  records: ReadonlyArray<JournalRecord>,
  plannedAttempt: PlannedTaskAttempt
): ContinuationExecutorBoundary => {
  const report = records.findLast(({ event, runId }) =>
    runId === plannedAttempt.runId &&
    event._tag === "PlannedAttemptExecutorWorkReported" &&
    event.report.correlation.runId === plannedAttempt.runId &&
    event.report.correlation.attemptId === plannedAttempt.attemptId
  )
  if (report !== undefined) return { _tag: "ExecutorReportObserved", position: report.position }
  const commandIntent = records.findLast(({ event, runId }) =>
    runId === plannedAttempt.runId &&
    event._tag === "PlannedAttemptExecutorCommandIntended" &&
    plannedTaskAttemptEquivalence(event.plannedAttempt, plannedAttempt)
  )
  if (commandIntent !== undefined) return { _tag: "CommandIntentRecorded", position: commandIntent.position }
  return { _tag: "NoCommandIntent" }
}

/** Applies the production causal gate to a Lab fixture without contacting an executor. */
export const continuationAuthorizationContactDecision = (
  records: ReadonlyArray<JournalRecord>,
  plannedAttempt: PlannedTaskAttempt,
  witness: PlannedAttemptContinuationWitness
): ContinuationAuthorizationContactDecision => {
  const evaluation = evaluatePlannedAttemptContinuationAuthorization(records, plannedAttempt, witness)
  const executorBoundary = executorBoundaryOf(records, plannedAttempt)
  return evaluation._tag === "Authorized"
    ? { _tag: "ExecutorContactAvailable", executorContact: "Available", executorBoundary, evaluation }
    : { _tag: "ExecutorContactUnavailable", executorContact: "Unavailable", executorBoundary, evaluation }
}
