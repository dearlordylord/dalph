import { Schema } from "effect"
import {
  plannedTaskAttemptEquivalence,
  type AttemptId,
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
  /** One durable executor-work responsibility remains associated with one exact Run/attempt pair. */
  readonly responsibilityCount: number
  /** The generic authorization is one journal fact, not a replacement responsibility. */
  readonly authorizationCount: number
  /** Attempt identities found in the continuation responsibility and its reports. */
  readonly plannedAttemptIds: ReadonlyArray<AttemptId>
  /** No executor-invocation identity is introduced by coordinator death. */
  readonly executorInvocationIds: ReadonlyArray<string>
  /** No recovery/death occurrence is added to the workflow journal. */
  readonly recoveryEventTags: ReadonlyArray<string>
  readonly coarseResponsibilityCorrelations: ReadonlyArray<string>
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

const scalarIdentityValues = (value: unknown): ReadonlyArray<string> => {
  if (typeof value !== "object" || value === null) return []
  if (Array.isArray(value)) return value.flatMap(scalarIdentityValues)
  return Object.entries(value).flatMap(([key, nested]) => {
    const own = key === "executorInvocationId" || key === "invocationId"
      ? typeof nested === "string" ? [nested] : []
      : []
    return [...own, ...scalarIdentityValues(nested)]
  })
}

const identityOf = (
  records: ReadonlyArray<JournalRecord>,
  plannedAttempt: PlannedTaskAttempt,
  authorizationPosition: JournalPosition
): ContinuationAuthorizationIdentity => {
  const responsibilityRecords = records.filter(
    ({ event, runId }) =>
      event._tag === "PlannedAttemptExecutorWorkResponsibilityBegan" &&
      runId === plannedAttempt.runId &&
      plannedTaskAttemptEquivalence(event.plannedAttempt, plannedAttempt)
  )
  const authorizationRecords = records.filter(
    ({ event, runId }) =>
      event._tag === "PlannedAttemptContinuationAuthorized" &&
      runId === plannedAttempt.runId &&
      plannedTaskAttemptEquivalence(event.plannedAttempt, plannedAttempt)
  )
  const reportAttemptIds = records.flatMap(({ event, runId }) =>
    event._tag === "PlannedAttemptExecutorWorkReported" && runId === plannedAttempt.runId
      ? [event.report.correlation.attemptId]
      : []
  )
  const plannedAttemptIds = distinct([
    ...responsibilityRecords.flatMap(({ event }) =>
      event._tag === "PlannedAttemptExecutorWorkResponsibilityBegan" ? [event.plannedAttempt.attemptId] : []
    ),
    ...authorizationRecords.flatMap(({ event }) =>
      event._tag === "PlannedAttemptContinuationAuthorized" ? [event.plannedAttempt.attemptId] : []
    ),
    ...reportAttemptIds
  ])
  const executorInvocationIds = distinct(records.flatMap(({ event }) => scalarIdentityValues(event)))
  const recoveryEventTags = distinct(
    records
      .map(({ event }) => event._tag)
      .filter((tag) => /recovery|death/iu.test(tag))
  )
  return {
    responsibilityCount: responsibilityRecords.length,
    authorizationCount: authorizationRecords.filter(({ position }) => position <= authorizationPosition).length,
    plannedAttemptIds,
    executorInvocationIds,
    recoveryEventTags,
    coarseResponsibilityCorrelations: distinct(
      responsibilityRecords.map(({ runId, event }) =>
        event._tag === "PlannedAttemptExecutorWorkResponsibilityBegan" ? `${runId}/${event.plannedAttempt.attemptId}` : ""
      )
    ).filter((value) => value.length > 0)
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
    identity: identityOf(sorted, plannedAttempt, authorization.position)
  }
}

export type ContinuationAuthorizationContactDecision =
  | {
      readonly _tag: "ExecutorContactAvailable"
      readonly executorContact: "Available"
      readonly evaluation: { readonly _tag: "Authorized" }
    }
  | {
      readonly _tag: "ExecutorContactUnavailable"
      readonly executorContact: "Unavailable"
      readonly evaluation: Exclude<ReturnType<typeof evaluatePlannedAttemptContinuationAuthorization>, { readonly _tag: "Authorized" }>
    }

/** Applies the production causal gate to a Lab fixture without contacting an executor. */
export const continuationAuthorizationContactDecision = (
  records: ReadonlyArray<JournalRecord>,
  plannedAttempt: PlannedTaskAttempt,
  witness: PlannedAttemptContinuationWitness
): ContinuationAuthorizationContactDecision => {
  const evaluation = evaluatePlannedAttemptContinuationAuthorization(records, plannedAttempt, witness)
  return evaluation._tag === "Authorized"
    ? { _tag: "ExecutorContactAvailable", executorContact: "Available", evaluation }
    : { _tag: "ExecutorContactUnavailable", executorContact: "Unavailable", evaluation }
}
