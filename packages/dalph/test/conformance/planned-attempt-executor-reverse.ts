/* eslint-disable import/no-nodejs-modules -- The checker reads repository-owned provenance only. */
/* eslint-disable max-lines -- Projection decoding and the bounded checker are one auditable boundary. */
/* eslint-disable functional/no-throw-statements -- Invalid observations fail closed. */
/* eslint-disable functional/immutable-data -- Frontier scratch is invocation-local. */
/* eslint-disable no-restricted-globals -- The checker reports bounded CPU and wall measurements. */
/* eslint-disable no-magic-numbers -- Trace protocol versions and checker units are explicit constants. */
import type { QuintEx } from "@informalsystems/quint"
import { version as quintVersion } from "@informalsystems/quint/dist/src/version.js"
import {
  AttemptId,
  PlannedAttemptExecutorBeginDelivery,
  PlannedAttemptExecutorCorrelation,
  PlannedAttemptExecutorObservationPurpose,
  PlannedAttemptExecutorProjection,
  PlannedAttemptExecutorReport,
  PlannedAttemptExecutorRequest,
  PlannedTaskAttempt,
  RunId
} from "@dalph/contracts"
import {
  isSafeContinuationRevalidationEligibility,
  type SafeContinuationRevalidationEligibility
} from "../../../orchestrator/src/coordination/frontier/fresh-facts.js"
import { PlannedAttemptContinuationWitness } from "../../../orchestrator/src/workflow/protocols/planned-attempt-continuation/events.js"
import { JournalRecord } from "../../../orchestrator/src/workflow-journal/store.js"
import { JournalPosition, JournalRecordKey } from "../../../orchestrator/src/workflow-journal/identity.js"
import {
  PlannedAttemptExecutorCommandOrdinal,
  PlannedAttemptExecutorCommandProjectionOrdinal,
  PlannedAttemptExecutorResumeRedeliveryOrdinal
} from "../../../orchestrator/src/workflow/protocols/planned-attempt-executor-work/events.js"
import { Schema } from "effect"
import {
  attemptPlanRecordKey,
  plannedAttemptExecutorCommandIntendedRecordKey,
  plannedAttemptExecutorCommandProjectionObservedRecordKey,
  plannedAttemptExecutorCommandResponseContradictedRecordKey,
  plannedAttemptExecutorCommandResponseObservedRecordKey,
  plannedAttemptExecutorResumeRedeliveryIntendedRecordKey,
  plannedAttemptExecutorStateObservedRecordKey,
  plannedAttemptExecutorWorkReportedRecordKey,
  plannedAttemptExecutorWorkResponsibilityBeganRecordKey
} from "../../../orchestrator/src/workflow-journal/record-key.js"
import { currentSourceInputDigest, repositoryHead } from "./gate-run-identity-adapter.js"
import {
  loadResumeRedeliveryOracle,
  type ModelTransition,
  type FrontierNode,
  type OracleLoadMeasurement
} from "./quint-evaluator-frontier.js"

export const reverseTraceVersion = 2 as const
export const reverseModelSourceSha256 = "ba1869b69d4536cd5883064c477bad6c678795e1c32bb2d25a4c30d571adc710"
export const reverseModelStep = "resumeRedeliveryMbtStep"
export const reverseProjectionId = "planned-attempt-executor.SpecProjection"
export const reverseProjectionVersion = 1 as const
export const reverseProjectionFieldManifest = [
  "resumeRecovery.projectionOrdinal",
  "resumeRecovery.totalRedeliveryIntents",
  "resumeRecovery.redeliveryCallCount",
  "commandCallCount",
  "beginTurnCrossingCount",
  "commandIntentCount",
  "commandResponseEvidenceCount",
  "commandResponseSettlementCount",
  "commandSettlementCount",
  "commandState",
  "evidence",
  "nextCommandOrdinal",
  "positionHeld",
  "reconciliationProjectionsThisActivation",
  "recoveryCount",
  "responseAmbiguous",
  "beginIntentsSinceSafeSuspension",
  "resumeIntentsSinceSafeSuspension",
  "acceptedReportOrdinal",
  "observationCount",
  "durableObservationCount",
  "proposalIdentityCount",
  "status",
  "suspendIntentsSinceExecuting",
  "terminalReportEverAccepted"
] as const

type ReverseProjection = {
  readonly resumeRecovery: {
    readonly projectionOrdinal: bigint
    readonly totalRedeliveryIntents: bigint
    readonly redeliveryCallCount: bigint
  }
  readonly commandCallCount: bigint
  readonly beginTurnCrossingCount: bigint
  readonly commandIntentCount: bigint
  readonly commandResponseEvidenceCount: bigint
  readonly commandResponseSettlementCount: bigint
  readonly commandSettlementCount: bigint
  readonly commandState: string
  readonly evidence: string
  readonly nextCommandOrdinal: bigint
  readonly positionHeld: boolean
  readonly reconciliationProjectionsThisActivation: bigint
  readonly recoveryCount: bigint
  readonly responseAmbiguous: boolean
  readonly beginIntentsSinceSafeSuspension: bigint
  readonly resumeIntentsSinceSafeSuspension: bigint
  readonly acceptedReportOrdinal: bigint
  readonly observationCount: bigint
  readonly durableObservationCount: bigint
  readonly proposalIdentityCount: bigint
  readonly status: string
  readonly suspendIntentsSinceExecuting: bigint
  readonly terminalReportEverAccepted: boolean
}

type ReverseBoundary =
  | "initialization"
  | "responsibility"
  | "intent"
  | "call"
  | "response"
  | "projection"
  | "settlement"
  | "witness"
  | "crash"
  | "stutter"

export type ReverseOutcome = "completed" | "crashed"
type ReverseRefinement = "direct-model-step" | "hidden-model-choice" | "reviewed-stutter"

export type ReverseJournalObservation = {
  /** The complete record returned by the production Journal append/read seam. */
  readonly record: JournalRecord
  readonly key: JournalRecord["key"]
  readonly position: JournalPosition
  readonly event: JournalRecord["event"]["_tag"]
  readonly runId: JournalRecord["runId"]
  readonly attemptId: AttemptId | undefined
  readonly commandOrdinal: PlannedAttemptExecutorCommandOrdinal | undefined
  readonly existing: boolean
}

type ReverseExecutorArguments =
  | readonly []
  | readonly [PlannedAttemptExecutorRequest, PlannedAttemptExecutorBeginDelivery]
  | readonly [PlannedTaskAttempt]
  | readonly [PlannedAttemptExecutorRequest]
  | readonly [PlannedAttemptExecutorCorrelation, PlannedAttemptExecutorObservationPurpose]

type ReverseExecutorResult = PlannedAttemptExecutorProjection | PlannedAttemptExecutorReport | undefined

export type ReverseExecutorObservation = {
  readonly operation: "begin" | "requestSuspension" | "resume" | "observe"
  readonly phase: "call" | "return" | "interrupted"
  readonly correlation: PlannedAttemptExecutorCorrelation
  /** Exact production boundary arguments/return; scalar fields below are diagnostics only. */
  readonly arguments: ReverseExecutorArguments
  readonly result: ReverseExecutorResult
  readonly request: "Begin" | "Resume" | "Suspend" | undefined
  readonly report: PlannedAttemptExecutorReport["_tag"] | PlannedAttemptExecutorProjection["_tag"] | undefined
}

export type ReverseTraceEvent = {
  readonly index: number
  readonly implementationAction: string
  readonly refinement: ReverseRefinement
  readonly correlation: PlannedAttemptExecutorCorrelation
  readonly commandOrdinal: PlannedAttemptExecutorCommandOrdinal | undefined
  readonly projectionOrdinal: PlannedAttemptExecutorCommandProjectionOrdinal | undefined
  readonly redeliveryOrdinal: PlannedAttemptExecutorResumeRedeliveryOrdinal | undefined
  readonly preProjection: ReverseProjection | undefined
  readonly postProjection: ReverseProjection
  readonly eligibility: ReadonlyArray<SafeContinuationRevalidationEligibility>
  readonly witnesses: ReadonlyArray<PlannedAttemptContinuationWitness>
  readonly durableBoundary: ReverseBoundary
  readonly outcome: ReverseOutcome
  readonly journal: ReadonlyArray<ReverseJournalObservation>
  readonly executor: ReadonlyArray<ReverseExecutorObservation>
}

export type ReverseTrace = {
  readonly version: number
  readonly model: {
    readonly specification: string
    readonly step: string
    readonly quintVersion: string
    readonly checker: string
    readonly sourceSha256: string
  }
  readonly implementation: {
    readonly driver: string
    readonly version: string
    readonly head: string
    readonly sourceInputDigest: string
  }
  readonly projection: { readonly id: string; readonly version: number; readonly fieldManifest: ReadonlyArray<string> }
  readonly schedule: { readonly id: string; readonly seed: string; readonly faults: ReadonlyArray<string> }
  readonly events: ReadonlyArray<ReverseTraceEvent>
  readonly terminal: { readonly outcome: ReverseOutcome; readonly finalAction: string; readonly finalStatus: string }
}

const reverseProjectionSchema = Schema.Struct({
  resumeRecovery: Schema.Struct({
    projectionOrdinal: Schema.BigInt,
    totalRedeliveryIntents: Schema.BigInt,
    redeliveryCallCount: Schema.BigInt
  }),
  commandCallCount: Schema.BigInt,
  beginTurnCrossingCount: Schema.BigInt,
  commandIntentCount: Schema.BigInt,
  commandResponseEvidenceCount: Schema.BigInt,
  commandResponseSettlementCount: Schema.BigInt,
  commandSettlementCount: Schema.BigInt,
  commandState: Schema.String,
  evidence: Schema.String,
  nextCommandOrdinal: Schema.BigInt,
  positionHeld: Schema.Boolean,
  reconciliationProjectionsThisActivation: Schema.BigInt,
  recoveryCount: Schema.BigInt,
  responseAmbiguous: Schema.Boolean,
  beginIntentsSinceSafeSuspension: Schema.BigInt,
  resumeIntentsSinceSafeSuspension: Schema.BigInt,
  acceptedReportOrdinal: Schema.BigInt,
  observationCount: Schema.BigInt,
  durableObservationCount: Schema.BigInt,
  proposalIdentityCount: Schema.BigInt,
  status: Schema.String,
  suspendIntentsSinceExecuting: Schema.BigInt,
  terminalReportEverAccepted: Schema.Boolean
})

const reverseExecutorArgumentsSchema = Schema.Union([
  Schema.Tuple([]),
  Schema.Tuple([PlannedAttemptExecutorRequest, PlannedAttemptExecutorBeginDelivery]),
  Schema.Tuple([PlannedTaskAttempt]),
  Schema.Tuple([PlannedAttemptExecutorRequest]),
  Schema.Tuple([PlannedAttemptExecutorCorrelation, PlannedAttemptExecutorObservationPurpose])
])

const reverseExecutorObservationSchema = Schema.Struct({
  operation: Schema.Literals(["begin", "requestSuspension", "resume", "observe"]),
  phase: Schema.Literals(["call", "return", "interrupted"]),
  correlation: PlannedAttemptExecutorCorrelation,
  arguments: reverseExecutorArgumentsSchema,
  result: Schema.optional(Schema.Union([PlannedAttemptExecutorProjection, PlannedAttemptExecutorReport])),
  request: Schema.optional(Schema.Literals(["Begin", "Resume", "Suspend"])),
  report: Schema.optional(
    Schema.Literals([
      "ExecutorWorkExecuting",
      "ExecutorWorkSafelySuspended",
      "ExecutorWorkTerminal",
      "Exact",
      "BeginNotCrossed",
      "NoReport",
      "TemporarilyUnavailable",
      "Unreadable",
      "InitializationCorrelationContradiction",
      "CorrelationContradiction"
    ])
  )
})

const reverseJournalObservationSchema = Schema.Struct({
  record: JournalRecord,
  key: JournalRecordKey,
  position: JournalPosition,
  event: Schema.String,
  runId: RunId,
  attemptId: Schema.optional(AttemptId),
  commandOrdinal: Schema.optional(PlannedAttemptExecutorCommandOrdinal),
  existing: Schema.Boolean
})

const reverseTraceSchema = Schema.Struct({
  version: Schema.Literal(reverseTraceVersion),
  model: Schema.Struct({
    specification: Schema.String,
    step: Schema.String,
    quintVersion: Schema.String,
    checker: Schema.String,
    sourceSha256: Schema.String
  }),
  implementation: Schema.Struct({
    driver: Schema.String,
    version: Schema.String,
    head: Schema.String,
    sourceInputDigest: Schema.String
  }),
  projection: Schema.Struct({
    id: Schema.String,
    version: Schema.Literal(reverseProjectionVersion),
    fieldManifest: Schema.Array(Schema.String)
  }),
  schedule: Schema.Struct({ id: Schema.String, seed: Schema.String, faults: Schema.Array(Schema.String) }),
  events: Schema.Array(
    Schema.Struct({
      index: Schema.Int,
      implementationAction: Schema.String,
      refinement: Schema.Literals(["direct-model-step", "hidden-model-choice", "reviewed-stutter"]),
      correlation: PlannedAttemptExecutorCorrelation,
      commandOrdinal: Schema.optional(PlannedAttemptExecutorCommandOrdinal),
      projectionOrdinal: Schema.optional(PlannedAttemptExecutorCommandProjectionOrdinal),
      redeliveryOrdinal: Schema.optional(PlannedAttemptExecutorResumeRedeliveryOrdinal),
      preProjection: Schema.optional(reverseProjectionSchema),
      postProjection: reverseProjectionSchema,
      // The eligibility is intentionally process-local and carries a private
      // issuance brand; the typed checker validates its identity and witness
      // relation after this envelope decode.
      eligibility: Schema.Array(Schema.Unknown),
      witnesses: Schema.Array(PlannedAttemptContinuationWitness),
      durableBoundary: Schema.String,
      outcome: Schema.Literals(["completed", "crashed"]),
      journal: Schema.Array(reverseJournalObservationSchema),
      executor: Schema.Array(reverseExecutorObservationSchema)
    })
  ),
  terminal: Schema.Struct({
    outcome: Schema.Literals(["completed", "crashed"]),
    finalAction: Schema.String,
    finalStatus: Schema.String
  })
})

const decodeSerializedReverseTrace = (value: unknown): void => {
  Schema.decodeUnknownSync(reverseTraceSchema)(value)
}

export const modelTransitionSemanticIdentity = (transition: ModelTransition): string =>
  JSON.stringify(
    { branchIr: transition.branchIr, nondetPicks: transition.nondetPicks, postState: transition.postState },
    (_, value) => (typeof value === "bigint" ? `${value}n` : value)
  )

export const modelPathSemanticIdentity = (path: ReadonlyArray<ModelTransition>): string =>
  JSON.stringify(path.map(modelTransitionSemanticIdentity))

type ReversePathSummary = {
  readonly pathIdentity: string
  readonly fullStateIdentity: string
  readonly path: ReadonlyArray<ModelTransition>
}

export type ReverseCollection =
  | { readonly _tag: "Completed"; readonly trace: ReverseTrace }
  | {
      readonly _tag: "Cancelled"
      readonly reason: string
      readonly prefix: ReadonlyArray<ReverseTraceEvent>
      readonly stopped: true
    }
  | {
      readonly _tag: "TimedOut"
      readonly elapsedMs: number
      readonly deadlineMs: number
      readonly timeoutCause: "ClockDeadlineExceeded"
      readonly prefix: ReadonlyArray<ReverseTraceEvent>
      readonly stopped: true
    }
  | {
      readonly _tag: "Truncated"
      readonly reason: string
      readonly prefix: ReadonlyArray<ReverseTraceEvent>
      readonly stopped: true
    }

type ReverseCheckResult = {
  readonly accepted: true
  readonly finalFrontierSize: number
  readonly frontierSizes: ReadonlyArray<number>
  readonly inferredPicks: ReadonlyArray<{
    readonly eventIndex: number
    readonly branchIndex: number
    readonly choiceVector: ReadonlyArray<bigint>
  }>
  readonly inferredModelActions: ReadonlyArray<string>
  readonly completePaths: number
  readonly paths: ReadonlyArray<ReversePathSummary>
  readonly perEvent: ReadonlyArray<{
    readonly eventIndex: number
    readonly paths: number
    readonly distinctFullStates: number
  }>
  readonly oracleLoad: OracleLoadMeasurement
  readonly frontierWallMs: number
  readonly frontierCpuMs: number
}

type QuintData =
  | boolean
  | bigint
  | string
  | ReadonlyArray<QuintData>
  | { readonly tag: string; readonly value: QuintData }
  | { readonly [key: string]: QuintData }
type QuintRecord = { readonly [key: string]: QuintData }

const isQuintRecord = (value: unknown): value is QuintRecord =>
  typeof value === "object" && value !== null && !Array.isArray(value) && !("tag" in value)

const decodeQuintData = (expression: QuintEx): QuintData => {
  switch (expression.kind) {
    case "bool":
      return expression.value
    case "int":
      return expression.value
    case "str":
      return expression.value
    case "app":
      switch (expression.opcode) {
        case "Rec": {
          const record: Record<string, QuintData> = {}
          for (let index = 0; index < expression.args.length; index += 2) {
            const key = expression.args[index]
            const value = expression.args[index + 1]
            if (key?.kind !== "str" || value === undefined) throw new Error("Quint record is not ground")
            record[key.value] = decodeQuintData(value)
          }
          return record
        }
        case "variant": {
          const tag = expression.args[0]
          const value = expression.args[1]
          if (tag?.kind !== "str" || value === undefined) throw new Error("Quint variant is not ground")
          return { tag: tag.value, value: decodeQuintData(value) }
        }
        case "Tup":
        case "List":
        case "Set":
        case "Map":
          return expression.args.map(decodeQuintData)
        default:
          throw new Error(`unsupported Quint state constructor: ${expression.opcode}`)
      }
    case "lambda":
    case "let":
    case "name":
      throw new Error(`Quint state is not ground: ${expression.kind}`)
  }
}

const field = (record: QuintRecord, key: string, label: string): QuintData => {
  const value = record[key]
  if (value === undefined) throw new Error(`${label} has no ${key} field`)
  return value
}
const asRecord = (value: QuintData, label: string): QuintRecord => {
  if (!isQuintRecord(value)) throw new Error(`${label} is not a record`)
  return value
}
const asBigInt = (value: QuintData, label: string): bigint => {
  if (typeof value !== "bigint") throw new Error(`${label} is not an integer`)
  return value
}
const asBoolean = (value: QuintData, label: string): boolean => {
  if (typeof value !== "boolean") throw new Error(`${label} is not a boolean`)
  return value
}
const asTag = (value: QuintData, label: string): string => {
  if (typeof value !== "object" || Array.isArray(value) || !("tag" in value))
    throw new Error(`${label} is not a variant`)
  const tag = value.tag
  if (typeof tag !== "string") throw new Error(`${label} is not a variant`)
  return tag
}

const projectModelRecord = (root: QuintRecord): ReverseProjection => {
  const recovery = asRecord(field(root, "resumeRecovery", "state"), "resumeRecovery")
  return {
    resumeRecovery: {
      projectionOrdinal: asBigInt(field(recovery, "projectionOrdinal", "resumeRecovery"), "projectionOrdinal"),
      totalRedeliveryIntents: asBigInt(
        field(recovery, "totalRedeliveryIntents", "resumeRecovery"),
        "totalRedeliveryIntents"
      ),
      redeliveryCallCount: asBigInt(field(recovery, "redeliveryCallCount", "resumeRecovery"), "redeliveryCallCount")
    },
    commandCallCount: asBigInt(field(root, "commandCallCount", "state"), "commandCallCount"),
    beginTurnCrossingCount: asBigInt(field(root, "beginTurnCrossingCount", "state"), "beginTurnCrossingCount"),
    commandIntentCount: asBigInt(field(root, "commandIntentCount", "state"), "commandIntentCount"),
    commandResponseEvidenceCount: asBigInt(
      field(root, "commandResponseEvidenceCount", "state"),
      "commandResponseEvidenceCount"
    ),
    commandResponseSettlementCount: asBigInt(
      field(root, "commandResponseSettlementCount", "state"),
      "commandResponseSettlementCount"
    ),
    commandSettlementCount: asBigInt(field(root, "commandSettlementCount", "state"), "commandSettlementCount"),
    commandState: asTag(field(root, "commandState", "state"), "commandState"),
    evidence: asTag(field(root, "evidence", "state"), "evidence"),
    nextCommandOrdinal: asBigInt(field(root, "nextCommandOrdinal", "state"), "nextCommandOrdinal"),
    positionHeld: asBoolean(field(root, "positionHeld", "state"), "positionHeld"),
    reconciliationProjectionsThisActivation: asBigInt(
      field(root, "reconciliationProjectionsThisActivation", "state"),
      "reconciliationProjectionsThisActivation"
    ),
    recoveryCount: asBigInt(field(root, "recoveryCount", "state"), "recoveryCount"),
    responseAmbiguous: asBoolean(field(root, "responseAmbiguous", "state"), "responseAmbiguous"),
    beginIntentsSinceSafeSuspension: asBigInt(
      field(root, "beginIntentsSinceSafeSuspension", "state"),
      "beginIntentsSinceSafeSuspension"
    ),
    resumeIntentsSinceSafeSuspension: asBigInt(
      field(root, "resumeIntentsSinceSafeSuspension", "state"),
      "resumeIntentsSinceSafeSuspension"
    ),
    acceptedReportOrdinal: asBigInt(field(root, "acceptedReportOrdinal", "state"), "acceptedReportOrdinal"),
    observationCount: asBigInt(field(root, "observationCount", "state"), "observationCount"),
    durableObservationCount: asBigInt(field(root, "durableObservationCount", "state"), "durableObservationCount"),
    proposalIdentityCount: asBigInt(field(root, "proposalIdentityCount", "state"), "proposalIdentityCount"),
    status: asTag(field(root, "status", "state"), "status"),
    suspendIntentsSinceExecuting: asBigInt(
      field(root, "suspendIntentsSinceExecuting", "state"),
      "suspendIntentsSinceExecuting"
    ),
    terminalReportEverAccepted: asBoolean(
      field(root, "terminalReportEverAccepted", "state"),
      "terminalReportEverAccepted"
    )
  }
}

export const projectModelEnvironment = (environment: QuintEx): ReverseProjection => {
  const root = asRecord(decodeQuintData(environment), "environment")
  return projectModelRecord(asRecord(field(root, "state", "environment"), "state"))
}

const isUnknownRecord = (value: unknown): value is Readonly<Record<string, unknown>> =>
  typeof value === "object" && value !== null && !Array.isArray(value)
const unknownRecord = (value: unknown, label: string): Readonly<Record<string, unknown>> => {
  if (!isUnknownRecord(value)) throw new Error(`${label} is not a record`)
  return value
}
const unknownField = (record: Readonly<Record<string, unknown>>, key: string, label: string): unknown => {
  const value = record[key]
  if (value === undefined) throw new Error(`${label} has no ${key} field`)
  return value
}
const unknownBigInt = (value: unknown, label: string): bigint => {
  if (typeof value !== "bigint") throw new Error(`${label} is not an integer`)
  return value
}
const unknownBoolean = (value: unknown, label: string): boolean => {
  if (typeof value !== "boolean") throw new Error(`${label} is not a boolean`)
  return value
}
const unknownString = (value: unknown, label: string): string => {
  if (typeof value !== "string") throw new Error(`${label} is not a string`)
  return value
}

export const decodeReverseProjection = (value: unknown): ReverseProjection => {
  const root = unknownRecord(value, "projection")
  const recovery = unknownRecord(unknownField(root, "resumeRecovery", "projection"), "resumeRecovery")
  return {
    resumeRecovery: {
      projectionOrdinal: unknownBigInt(
        unknownField(recovery, "projectionOrdinal", "resumeRecovery"),
        "projectionOrdinal"
      ),
      totalRedeliveryIntents: unknownBigInt(
        unknownField(recovery, "totalRedeliveryIntents", "resumeRecovery"),
        "totalRedeliveryIntents"
      ),
      redeliveryCallCount: unknownBigInt(
        unknownField(recovery, "redeliveryCallCount", "resumeRecovery"),
        "redeliveryCallCount"
      )
    },
    commandCallCount: unknownBigInt(unknownField(root, "commandCallCount", "projection"), "commandCallCount"),
    beginTurnCrossingCount: unknownBigInt(
      unknownField(root, "beginTurnCrossingCount", "projection"),
      "beginTurnCrossingCount"
    ),
    commandIntentCount: unknownBigInt(unknownField(root, "commandIntentCount", "projection"), "commandIntentCount"),
    commandResponseEvidenceCount: unknownBigInt(
      unknownField(root, "commandResponseEvidenceCount", "projection"),
      "commandResponseEvidenceCount"
    ),
    commandResponseSettlementCount: unknownBigInt(
      unknownField(root, "commandResponseSettlementCount", "projection"),
      "commandResponseSettlementCount"
    ),
    commandSettlementCount: unknownBigInt(
      unknownField(root, "commandSettlementCount", "projection"),
      "commandSettlementCount"
    ),
    commandState: unknownString(unknownField(root, "commandState", "projection"), "commandState"),
    evidence: unknownString(unknownField(root, "evidence", "projection"), "evidence"),
    nextCommandOrdinal: unknownBigInt(unknownField(root, "nextCommandOrdinal", "projection"), "nextCommandOrdinal"),
    positionHeld: unknownBoolean(unknownField(root, "positionHeld", "projection"), "positionHeld"),
    reconciliationProjectionsThisActivation: unknownBigInt(
      unknownField(root, "reconciliationProjectionsThisActivation", "projection"),
      "reconciliationProjectionsThisActivation"
    ),
    recoveryCount: unknownBigInt(unknownField(root, "recoveryCount", "projection"), "recoveryCount"),
    responseAmbiguous: unknownBoolean(unknownField(root, "responseAmbiguous", "projection"), "responseAmbiguous"),
    beginIntentsSinceSafeSuspension: unknownBigInt(
      unknownField(root, "beginIntentsSinceSafeSuspension", "projection"),
      "beginIntentsSinceSafeSuspension"
    ),
    resumeIntentsSinceSafeSuspension: unknownBigInt(
      unknownField(root, "resumeIntentsSinceSafeSuspension", "projection"),
      "resumeIntentsSinceSafeSuspension"
    ),
    acceptedReportOrdinal: unknownBigInt(
      unknownField(root, "acceptedReportOrdinal", "projection"),
      "acceptedReportOrdinal"
    ),
    observationCount: unknownBigInt(unknownField(root, "observationCount", "projection"), "observationCount"),
    durableObservationCount: unknownBigInt(
      unknownField(root, "durableObservationCount", "projection"),
      "durableObservationCount"
    ),
    proposalIdentityCount: unknownBigInt(
      unknownField(root, "proposalIdentityCount", "projection"),
      "proposalIdentityCount"
    ),
    status: unknownString(unknownField(root, "status", "projection"), "status"),
    suspendIntentsSinceExecuting: unknownBigInt(
      unknownField(root, "suspendIntentsSinceExecuting", "projection"),
      "suspendIntentsSinceExecuting"
    ),
    terminalReportEverAccepted: unknownBoolean(
      unknownField(root, "terminalReportEverAccepted", "projection"),
      "terminalReportEverAccepted"
    )
  }
}

const equalValue = (left: unknown, right: unknown): boolean => {
  if (typeof left === "bigint" || typeof right === "bigint") return left === right
  if (Array.isArray(left) && Array.isArray(right))
    return left.length === right.length && left.every((value, index) => equalValue(value, right[index]))
  if (isUnknownRecord(left) && isUnknownRecord(right)) {
    const keys = Object.keys(left)
    return keys.length === Object.keys(right).length && keys.every((key) => equalValue(left[key], right[key]))
  }
  return left === right
}

const actionPrefix = (action: string): string => {
  const delimiter = action.indexOf("(")
  return delimiter < 0 ? action : action.slice(0, delimiter)
}
const boundaryFor = (action: string): ReverseBoundary => {
  if (action === "init") return "initialization"
  if (action === "beginResponsibility") return "responsibility"
  if (action === "recordPreTurnThreadRead") return "stutter"
  if (action.includes("Intent")) return "intent"
  if (action.startsWith("call")) return "call"
  if (action.startsWith("receive")) return "response"
  if (action.startsWith("recordCommandProjection")) return "projection"
  if (action.startsWith("settle")) return "settlement"
  if (action === "readResumeContinuationWitness") return "witness"
  if (action === "crashResumeDelivery") return "crash"
  throw new Error(`unknown observed implementation boundary ${action}`)
}
const sameCorrelation = (left: PlannedAttemptExecutorCorrelation, right: PlannedAttemptExecutorCorrelation): boolean =>
  left.runId === right.runId && left.attemptId === right.attemptId

const validateTraceProvenance = (
  trace: ReverseTrace,
  expectedModelSourceSha256: string = reverseModelSourceSha256,
  strictFaultSchedule = true
): void => {
  if (trace.version !== reverseTraceVersion) throw new Error("unsupported reverse trace version")
  if (
    trace.model.specification !== "specs/plannedAttemptExecutor.qnt" ||
    trace.model.step !== reverseModelStep ||
    trace.model.checker !== "typescript-evaluator-frontier" ||
    trace.model.sourceSha256 !== expectedModelSourceSha256 ||
    trace.model.quintVersion !== quintVersion
  )
    throw new Error("reverse trace model provenance is not repository-owned")
  if (
    trace.implementation.driver !== "executorConformanceDriver" ||
    trace.implementation.version.length === 0 ||
    trace.implementation.head.length === 0 ||
    trace.implementation.sourceInputDigest.length === 0
  )
    throw new Error("reverse trace implementation provenance is incomplete")
  if (trace.implementation.head !== repositoryHead(process.cwd()))
    throw new Error("reverse trace implementation HEAD is not the current repository HEAD")
  if (trace.implementation.sourceInputDigest !== currentSourceInputDigest(process.cwd()))
    throw new Error("reverse trace implementation source inputs changed")
  if (
    trace.projection.id !== reverseProjectionId ||
    trace.projection.version !== reverseProjectionVersion ||
    !equalValue(trace.projection.fieldManifest, reverseProjectionFieldManifest)
  )
    throw new Error("reverse trace projection provenance is incomplete")
  if (trace.schedule.id.length === 0 || trace.schedule.seed.length === 0)
    throw new Error("reverse trace schedule provenance is incomplete")
  if (strictFaultSchedule) {
    if (
      trace.schedule.faults.length !== 2 ||
      trace.schedule.faults[0] !== "initial-resume-crash" ||
      trace.schedule.faults[1] !== "first-redelivery-crash"
    )
      throw new Error("reverse trace omits its independent fault schedule")
  } else if (trace.schedule.faults.length === 0) throw new Error("reverse trace omits its fault schedule")
  if ("digest" in trace.implementation || "digest" in trace.schedule)
    throw new Error("self-referential provenance digest")
}

const expectedExecutorRecordKey = (
  record: JournalRecord,
  subjectAttemptId: AttemptId
): JournalRecord["key"] | undefined => {
  const event = record.event
  if (event._tag === "TaskAttemptPlanned") return attemptPlanRecordKey(event.operation.plannedAttempt.attemptId)
  if (event._tag === "PlannedAttemptExecutorWorkResponsibilityBegan")
    return plannedAttemptExecutorWorkResponsibilityBeganRecordKey(event.plannedAttempt.attemptId)
  if (event._tag === "PlannedAttemptExecutorCommandIntended")
    return plannedAttemptExecutorCommandIntendedRecordKey(event.plannedAttempt.attemptId, event.ordinal)
  if (event._tag === "PlannedAttemptExecutorResumeRedeliveryIntended")
    return plannedAttemptExecutorResumeRedeliveryIntendedRecordKey(
      event.plannedAttempt.attemptId,
      event.commandOrdinal,
      event.redeliveryOrdinal
    )
  if (event._tag === "PlannedAttemptExecutorCommandProjectionObserved")
    return plannedAttemptExecutorCommandProjectionObservedRecordKey(
      event.plannedAttempt.attemptId,
      event.commandOrdinal,
      event.projectionOrdinal
    )
  if (event._tag === "PlannedAttemptExecutorCommandResponseContradicted")
    return plannedAttemptExecutorCommandResponseContradictedRecordKey(
      event.plannedAttempt.attemptId,
      event.commandOrdinal
    )
  if (event._tag === "PlannedAttemptExecutorCommandResponseObserved")
    return plannedAttemptExecutorCommandResponseObservedRecordKey(event.plannedAttempt.attemptId, event.commandOrdinal)
  if (event._tag === "PlannedAttemptExecutorStateObserved")
    return plannedAttemptExecutorStateObservedRecordKey(event.plannedAttempt.attemptId, event.ordinal)
  if (event._tag === "PlannedAttemptExecutorWorkReported")
    return plannedAttemptExecutorWorkReportedRecordKey(subjectAttemptId, event.ordinal)
  return undefined
}

const journalAttemptId = (event: JournalRecord["event"], subjectAttemptId: AttemptId): AttemptId | undefined => {
  if (event._tag === "TaskAttemptPlanned") return event.operation.plannedAttempt.attemptId
  if (
    event._tag === "PlannedAttemptExecutorWorkResponsibilityBegan" ||
    event._tag === "PlannedAttemptExecutorCommandIntended" ||
    event._tag === "PlannedAttemptExecutorResumeRedeliveryIntended" ||
    event._tag === "PlannedAttemptExecutorCommandProjectionObserved" ||
    event._tag === "PlannedAttemptExecutorCommandResponseContradicted" ||
    event._tag === "PlannedAttemptExecutorCommandResponseObserved" ||
    event._tag === "PlannedAttemptExecutorStateObserved"
  )
    return event.plannedAttempt.attemptId
  if (event._tag === "PlannedAttemptExecutorWorkReported") return subjectAttemptId
  return undefined
}

const journalCommandOrdinal = (event: JournalRecord["event"]): PlannedAttemptExecutorCommandOrdinal | undefined => {
  if (event._tag === "PlannedAttemptExecutorCommandIntended") return event.ordinal
  if (
    event._tag === "PlannedAttemptExecutorResumeRedeliveryIntended" ||
    event._tag === "PlannedAttemptExecutorCommandProjectionObserved" ||
    event._tag === "PlannedAttemptExecutorCommandResponseContradicted" ||
    event._tag === "PlannedAttemptExecutorCommandResponseObserved"
  )
    return event.commandOrdinal
  return undefined
}

const validateJournalReportCorrelation = (
  report: PlannedAttemptExecutorReport,
  correlation: PlannedAttemptExecutorCorrelation,
  label: string,
  expectedSubject: boolean
): void => {
  if (expectedSubject) validateSubjectAttempt(report.correlation, correlation, label)
  else if (sameCorrelation(report.correlation, correlation))
    throw new Error(`${label} did not preserve a foreign subject`)
}

const validateJournalExecutorCorrelations = (
  event: JournalRecord["event"],
  correlation: PlannedAttemptExecutorCorrelation
): void => {
  if (event._tag === "PlannedAttemptExecutorCommandProjectionObserved") {
    if (event.observation._tag === "ExactExecutorReport")
      validateJournalReportCorrelation(event.observation.report, correlation, "journal projection report", true)
    else if (event.observation._tag === "ExecutorReportContradiction")
      validateJournalReportCorrelation(
        event.observation.observed,
        correlation,
        "journal projection contradiction",
        false
      )
    return
  }
  if (event._tag === "PlannedAttemptExecutorCommandResponseObserved") {
    validateJournalReportCorrelation(event.report, correlation, "journal command response", true)
    return
  }
  if (event._tag === "PlannedAttemptExecutorCommandResponseContradicted") {
    validateJournalReportCorrelation(event.observed, correlation, "journal command contradiction", false)
    return
  }
  if (event._tag === "PlannedAttemptExecutorStateObserved") {
    const observation = event.observation
    if (observation._tag === "ExactExecutorReport")
      validateJournalReportCorrelation(observation.report, correlation, "journal state report", true)
    else if (
      observation._tag === "ExecutorReportContradiction" ||
      observation._tag === "ExecutorInitialReportCausalityContradiction"
    )
      validateJournalReportCorrelation(observation.observed, correlation, "journal state contradiction", false)
    else if (observation._tag === "ExecutorLifecycleTransitionContradiction") {
      validateJournalReportCorrelation(observation.accepted, correlation, "journal accepted report", true)
      validateJournalReportCorrelation(observation.observed, correlation, "journal observed report", false)
    }
    return
  }
  if (event._tag === "PlannedAttemptExecutorWorkReported")
    validateJournalReportCorrelation(event.report, correlation, "journal work report", true)
}

const validateJournal = (trace: ReverseTrace): void => {
  const correlation = trace.events[0]?.correlation
  if (correlation === undefined) throw new Error("reverse trace has no correlation")
  let previousNewPosition: JournalPosition | undefined
  const records = new Map<JournalRecord["key"], ReverseJournalObservation>()
  const requiredJournalActions = new Set([
    "init",
    "beginResponsibility",
    "recordBeginIntent",
    "receiveCommandResponse",
    "settleCommandResponse",
    "recordSuspendIntent",
    "settleCommandProjection",
    "recordResumeIntent",
    "recordCommandProjection",
    "readResumeContinuationWitness",
    "recordResumeRedeliveryIntent"
  ])
  trace.events.forEach((event) => {
    if (!sameCorrelation(event.correlation, correlation))
      throw new Error(`event ${event.index} changes subject identity`)
    if (requiredJournalActions.has(actionPrefix(event.implementationAction)) && event.journal.length === 0)
      throw new Error(`event ${event.index} omits its durable journal evidence`)
    let previousEventPosition: JournalPosition | undefined
    event.journal.forEach((record) => {
      if (record.record.event._tag !== record.event)
        throw new Error(`event ${event.index} changes the typed journal event tag`)
      if (record.record.key !== record.key || record.record.position !== record.position)
        throw new Error(`event ${event.index} changes the complete journal record identity`)
      if (record.record.runId !== record.runId)
        throw new Error(`event ${event.index} changes the complete journal record run`)
      const expectedKey = expectedExecutorRecordKey(record.record, correlation.attemptId)
      if (expectedKey !== undefined && expectedKey !== record.key)
        throw new Error(`event ${event.index} changes an executor journal key schema`)
      const expectedAttemptId = journalAttemptId(record.record.event, correlation.attemptId)
      if (expectedAttemptId !== record.attemptId)
        throw new Error(`event ${event.index} changes a journal attempt identity`)
      const expectedCommandOrdinal = journalCommandOrdinal(record.record.event)
      if (expectedCommandOrdinal !== record.commandOrdinal)
        throw new Error(`event ${event.index} changes a journal command ordinal fact`)
      validateJournalExecutorCorrelations(record.record.event, correlation)
      if (record.runId !== correlation.runId) throw new Error(`event ${event.index} has a foreign journal run`)
      if (record.attemptId !== undefined && record.attemptId !== correlation.attemptId)
        throw new Error(`event ${event.index} has a foreign journal attempt`)
      if (record.position < 1) throw new Error(`event ${event.index} has an invalid journal position`)
      if (previousEventPosition !== undefined && record.position < previousEventPosition)
        throw new Error(`event ${event.index} reorders journal observations`)
      previousEventPosition = record.position
      if (
        record.record.event._tag === "PlannedAttemptExecutorCommandProjectionObserved" &&
        BigInt(record.record.event.projectionOrdinal) !== event.postProjection.resumeRecovery.projectionOrdinal
      )
        throw new Error(`event ${event.index} changes a projection journal ordinal`)
      if (
        record.record.event._tag === "PlannedAttemptExecutorResumeRedeliveryIntended" &&
        BigInt(record.record.event.redeliveryOrdinal) !== event.postProjection.resumeRecovery.totalRedeliveryIntents
      )
        throw new Error(`event ${event.index} changes a redelivery journal ordinal`)
      const prior = records.get(record.key)
      if (record.existing) {
        if (prior === undefined || !equalValue(prior, record))
          throw new Error(`event ${event.index} repeats an unknown journal record`)
      } else {
        if (prior !== undefined) throw new Error(`event ${event.index} duplicates a new journal key`)
        if (previousNewPosition !== undefined && record.position <= previousNewPosition)
          throw new Error(`event ${event.index} does not advance durable journal position`)
        previousNewPosition = record.position
        records.set(record.key, record)
      }
    })
  })
}

const validateEvent = (
  event: ReverseTraceEvent,
  index: number,
  correlation: ReverseTraceEvent["correlation"]
): void => {
  if (event.index !== index) throw new Error(`reverse event index ${event.index} is not chronological`)
  if (!sameCorrelation(event.correlation, correlation)) throw new Error(`event ${event.index} changes subject identity`)
  if (event.implementationAction.length === 0) throw new Error(`event ${event.index} has no implementation action`)
  if (boundaryFor(event.implementationAction) !== event.durableBoundary)
    throw new Error(`event ${event.index} has an unobserved durable boundary`)
  if (index > 0 && event.preProjection === undefined) throw new Error(`event ${event.index} omits its pre-projection`)
  if (event.outcome === "crashed" && event.implementationAction !== "crashResumeDelivery")
    throw new Error(`event ${event.index} reports a crash at a non-process-cut boundary`)
  if (event.implementationAction === "crashResumeDelivery" && event.outcome !== "crashed")
    throw new Error(`event ${event.index} omits its crash outcome`)
  const action = actionPrefix(event.implementationAction)
  const readsContinuationFacts = action === "readResumeContinuationWitness"
  if (
    readsContinuationFacts &&
    (event.eligibility.length !== 1 ||
      event.witnesses.length !== 1 ||
      !isSafeContinuationRevalidationEligibility(event.eligibility[0]))
  )
    throw new Error(`event ${event.index} does not capture one eligibility and witness fact`)
  if (!readsContinuationFacts && (event.eligibility.length !== 0 || event.witnesses.length !== 0))
    throw new Error(`event ${event.index} carries eligibility or witness facts outside their read boundary`)
  const requiresOrdinal =
    (action.startsWith("record") && action !== "recordPreTurnThreadRead") ||
    action.startsWith("call") ||
    action.startsWith("receive") ||
    action.startsWith("settle") ||
    action === "crashResumeDelivery"
  if (requiresOrdinal) {
    const expected = event.postProjection.nextCommandOrdinal - 1n
    if (event.commandOrdinal === undefined || BigInt(event.commandOrdinal) !== expected)
      throw new Error(`event ${event.index} has an unproven command ordinal`)
  }
  if (
    event.projectionOrdinal !== undefined &&
    BigInt(event.projectionOrdinal) !== event.postProjection.resumeRecovery.projectionOrdinal
  )
    throw new Error(`event ${event.index} has a stale projection ordinal`)
  if (
    event.redeliveryOrdinal !== undefined &&
    BigInt(event.redeliveryOrdinal) !== event.postProjection.resumeRecovery.totalRedeliveryIntents
  )
    throw new Error(`event ${event.index} has an unproven redelivery ordinal`)
  if (event.refinement === "reviewed-stutter") {
    if (event.implementationAction !== "recordPreTurnThreadRead" || event.preProjection === undefined)
      throw new Error(`event ${event.index} has an invalid reviewed stutter`)
    if (!equalValue(event.preProjection, event.postProjection))
      throw new Error(`event ${event.index} stutters with a state change`)
  }
  const executorOperations = new Set(event.executor.map((observation) => observation.operation))
  const executorCalls = event.executor.filter((observation) => observation.phase === "call")
  const executorReturns = event.executor.filter((observation) => observation.phase === "return")
  if (
    action === "callBegin" &&
    (!executorOperations.has("begin") ||
      !executorCalls.some(({ operation, request }) => operation === "begin" && request !== undefined))
  )
    throw new Error(`event ${event.index} lacks begin request evidence`)
  if (
    action === "callSuspend" &&
    (!executorOperations.has("requestSuspension") ||
      !executorCalls.some(({ operation, request }) => operation === "requestSuspension" && request === "Suspend"))
  )
    throw new Error(`event ${event.index} lacks suspension evidence`)
  if (
    (action === "callResume" || action === "callResumeRedelivery") &&
    (!executorOperations.has("resume") ||
      !executorCalls.some(({ operation, request }) => operation === "resume" && request === "Resume"))
  )
    throw new Error(`event ${event.index} lacks resume evidence`)
  if (action === "receiveCommandResponse" && !executorReturns.some(({ report }) => report !== undefined))
    throw new Error(`event ${event.index} lacks executor response evidence`)
}

const validateSubjectAttempt = (
  value: PlannedAttemptExecutorCorrelation,
  correlation: ReverseTraceEvent["correlation"],
  label: string
): void => {
  if (value.runId !== correlation.runId || value.attemptId !== correlation.attemptId)
    throw new Error(`${label} carries a foreign subject`)
}

const validateContinuationAuthorizations = (trace: ReverseTrace): void => {
  let latestProjectionPosition: JournalPosition | undefined
  let latestWitness: PlannedAttemptContinuationWitness | undefined
  for (const event of trace.events) {
    const action = actionPrefix(event.implementationAction)
    if (action === "recordCommandProjection") {
      const projection = event.journal.find(
        ({ record }) => record.event._tag === "PlannedAttemptExecutorCommandProjectionObserved"
      )
      if (projection === undefined) throw new Error(`event ${event.index} omitted its typed projection record`)
      latestProjectionPosition = projection.position
    }
    if (action === "readResumeContinuationWitness") {
      const witness = event.witnesses[0]
      if (witness === undefined) throw new Error(`event ${event.index} omitted its continuation witness`)
      latestWitness = witness
    }
    if (action !== "recordResumeRedeliveryIntent") continue
    const redelivery = event.journal.find(
      ({ record }) => record.event._tag === "PlannedAttemptExecutorResumeRedeliveryIntended"
    )
    if (redelivery?.record.event._tag !== "PlannedAttemptExecutorResumeRedeliveryIntended")
      throw new Error(`event ${event.index} omitted its typed redelivery intent`)
    if (latestWitness === undefined || !equalValue(redelivery.record.event.authorization.witness, latestWitness))
      throw new Error(`event ${event.index} redelivers with a stale continuation witness`)
    if (
      latestProjectionPosition === undefined ||
      redelivery.record.event.authorization.safeProjectionObservedAt !== latestProjectionPosition
    )
      throw new Error(`event ${event.index} redelivers with a stale Safe projection authorization`)
  }
}

const validateExecutorCallArguments = (
  observation: ReverseExecutorObservation,
  correlation: ReverseTraceEvent["correlation"]
): void => {
  const args = observation.arguments
  switch (observation.operation) {
    case "begin": {
      if (args.length !== 2) throw new Error("begin observation has an incomplete argument tuple")
      const request = args[0]
      if (!Schema.is(PlannedAttemptExecutorRequest)(request))
        throw new Error("begin observation has an invalid request")
      validateSubjectAttempt(
        { runId: request.plannedAttempt.runId, attemptId: request.plannedAttempt.attemptId },
        correlation,
        "begin request"
      )
      const delivery = args[1]
      if (!Schema.is(PlannedAttemptExecutorBeginDelivery)(delivery))
        throw new Error("begin observation has an invalid delivery")
      break
    }
    case "resume": {
      if (args.length !== 1) throw new Error("resume observation has an incomplete argument tuple")
      const request = args[0]
      if (!Schema.is(PlannedAttemptExecutorRequest)(request))
        throw new Error("resume observation has an invalid request")
      validateSubjectAttempt(
        { runId: request.plannedAttempt.runId, attemptId: request.plannedAttempt.attemptId },
        correlation,
        "resume request"
      )
      break
    }
    case "requestSuspension": {
      if (args.length !== 1) throw new Error("suspension observation has an incomplete argument tuple")
      const attempt = args[0]
      if (!Schema.is(PlannedTaskAttempt)(attempt)) throw new Error("suspension observation has an invalid attempt")
      validateSubjectAttempt({ runId: attempt.runId, attemptId: attempt.attemptId }, correlation, "suspension attempt")
      break
    }
    case "observe": {
      if (args.length !== 2) throw new Error("observe observation has an incomplete argument tuple")
      const observedCorrelation = args[0]
      if (!Schema.is(PlannedAttemptExecutorCorrelation)(observedCorrelation))
        throw new Error("observe observation has an invalid correlation")
      validateSubjectAttempt(observedCorrelation, correlation, "observe correlation")
      const purpose = args[1]
      if (!Schema.is(PlannedAttemptExecutorObservationPurpose)(purpose))
        throw new Error("observe observation has an invalid purpose")
      break
    }
  }
}

const validateExecutorReturn = (
  observation: ReverseExecutorObservation,
  correlation: ReverseTraceEvent["correlation"]
): void => {
  if (observation.arguments.length !== 0 || observation.result === undefined)
    throw new Error(`executor ${observation.operation} return omitted its complete result`)
  const result = observation.result
  const resultTag = result._tag
  if (observation.operation === "observe") {
    if (resultTag === "Exact") {
      if (!("report" in result)) throw new Error("observe Exact result omitted its report")
      validateSubjectAttempt(result.report.correlation, correlation, "observe report")
    } else if (resultTag === "CorrelationContradiction") {
      if (!("expected" in result) || !("observed" in result))
        throw new Error("observe contradiction omitted its complete reports")
      validateSubjectAttempt(result.expected, correlation, "observe expected")
      if (sameCorrelation(result.observed.correlation, correlation))
        throw new Error("observe contradiction did not preserve a foreign observed correlation")
    } else {
      if (!("correlation" in result)) throw new Error("observe result omitted its correlation")
      validateSubjectAttempt(result.correlation, correlation, "observe result")
    }
    return
  }
  if (
    resultTag !== "ExecutorWorkExecuting" &&
    resultTag !== "ExecutorWorkSafelySuspended" &&
    resultTag !== "ExecutorWorkTerminal"
  )
    throw new Error(`executor ${observation.operation} returned an unknown report variant`)
  if (!("correlation" in result)) throw new Error("executor report omitted its correlation")
  validateSubjectAttempt(result.correlation, correlation, "executor report")
}

const validateExecutorObservations = (trace: ReverseTrace, correlation: ReverseTraceEvent["correlation"]): void => {
  let outstanding: ReverseExecutorObservation["operation"] | undefined
  for (const event of trace.events) {
    for (const observation of event.executor) {
      if (!sameCorrelation(observation.correlation, correlation))
        throw new Error(`event ${event.index} has executor evidence for a foreign subject`)
      if (observation.phase === "call") {
        if (outstanding !== undefined) throw new Error(`event ${event.index} overlaps executor calls`)
        validateExecutorCallArguments(observation, correlation)
        outstanding = observation.operation
      } else if (observation.phase === "return") {
        if (outstanding !== observation.operation)
          throw new Error(`event ${event.index} returns an unobserved executor call`)
        validateExecutorReturn(observation, correlation)
        outstanding = undefined
      } else {
        if (outstanding !== observation.operation)
          throw new Error(`event ${event.index} interrupts an unobserved executor call`)
        if (observation.arguments.length !== 0 || observation.result !== undefined)
          throw new Error(`event ${event.index} interrupt carries an invented executor result`)
        outstanding = undefined
      }
    }
  }
  if (outstanding !== undefined) throw new Error(`reverse trace ends with an outstanding ${outstanding} call`)
}

const refinementFor = (transition: ModelTransition): ReverseRefinement =>
  transition.choiceVector.length === 0 ? "direct-model-step" : "hidden-model-choice"

const advanceObservedEvent = (
  oracle: Awaited<ReturnType<typeof loadResumeRedeliveryOracle>>,
  frontier: ReadonlyArray<FrontierNode>,
  event: ReverseTraceEvent,
  reverseEnumeration = false
): { readonly nodes: ReadonlyArray<FrontierNode>; readonly transitions: ReadonlyArray<ModelTransition> } => {
  const next: Array<FrontierNode> = []
  const transitions: Array<ModelTransition> = []
  for (const node of frontier) {
    if (event.preProjection === undefined || !equalValue(projectModelEnvironment(node.state), event.preProjection))
      continue
    const successors = reverseEnumeration
      ? oracle.enumerateSuccessorsForActionReversed(node.state, actionPrefix(event.implementationAction))
      : oracle.enumerateSuccessorsForAction(node.state, actionPrefix(event.implementationAction))
    for (const transition of successors) {
      if (!equalValue(projectModelEnvironment(transition.postState), event.postProjection)) continue
      if (refinementFor(transition) !== event.refinement) continue
      transitions.push(transition)
      next.push({ state: transition.postState, path: [...node.path, transition] })
    }
  }
  const unique = new Map<string, FrontierNode>()
  for (const node of next) {
    const key = JSON.stringify({ state: node.state, path: modelPathSemanticIdentity(node.path) }, (_, value) =>
      typeof value === "bigint" ? `${value}n` : value
    )
    if (!unique.has(key)) unique.set(key, node)
  }
  return { nodes: [...unique.values()], transitions }
}

const checkReverseTraceWithLoadedOracle = async (
  trace: ReverseTrace,
  oracle: Awaited<ReturnType<typeof loadResumeRedeliveryOracle>>,
  reverseEnumeration = false
): Promise<ReverseCheckResult> => {
  decodeSerializedReverseTrace(trace)
  if (trace.events.length === 0) throw new Error("empty reverse trace")
  if (trace.terminal.outcome !== "completed") throw new Error("reverse trace is not terminal-complete")
  validateJournal(trace)
  const correlation = trace.events[0]?.correlation
  if (correlation === undefined) throw new Error("reverse trace has no subject")
  trace.events.forEach((event, index) => validateEvent(event, index, correlation))
  validateContinuationAuthorizations(trace)
  validateExecutorObservations(trace, correlation)
  if (!equalValue(projectModelEnvironment(oracle.initialState), trace.events[0]?.postProjection))
    throw new Error("reverse trace does not begin at Quint init")
  let frontier: ReadonlyArray<FrontierNode> = [{ state: oracle.initialState, path: [] }]
  const frontierSizes = [frontier.length]
  const perEvent: Array<{ readonly eventIndex: number; readonly paths: number; readonly distinctFullStates: number }> =
    [
      {
        eventIndex: 0,
        paths: frontier.length,
        distinctFullStates: new Set(
          frontier.map((node) =>
            JSON.stringify(node.state, (_, value) => (typeof value === "bigint" ? `${value}n` : value))
          )
        ).size
      }
    ]
  const inferredPicks: Array<{
    readonly eventIndex: number
    readonly branchIndex: number
    readonly choiceVector: ReadonlyArray<bigint>
  }> = []
  const inferredModelActions: Array<string> = []
  let crashReconciliation: "projection" | "settlement" | "witness" | undefined
  const startedWall = performance.now()
  const startedCpu = process.cpuUsage()
  for (const [index, event] of trace.events.entries()) {
    if (index === 0) {
      if (event.implementationAction !== "init" || event.refinement !== "direct-model-step")
        throw new Error("reverse trace must begin with observed init")
      continue
    }
    if (crashReconciliation === "projection" && actionPrefix(event.implementationAction) !== "recordCommandProjection")
      throw new Error(`event ${event.index} skips crash reconciliation projection`)
    if (crashReconciliation === "settlement" && actionPrefix(event.implementationAction) !== "settleCommandProjection")
      throw new Error(`event ${event.index} skips crash reconciliation settlement`)
    if (
      crashReconciliation === "witness" &&
      actionPrefix(event.implementationAction) !== "readResumeContinuationWitness"
    )
      throw new Error(`event ${event.index} skips fresh continuation witness`)
    if (event.implementationAction === "crashResumeDelivery") crashReconciliation = "projection"
    else if (crashReconciliation === "projection") crashReconciliation = "settlement"
    else if (crashReconciliation === "settlement") crashReconciliation = "witness"
    else if (crashReconciliation === "witness") crashReconciliation = undefined
    if (event.refinement === "reviewed-stutter") {
      if (
        !event.preProjection ||
        !frontier.some((node) => equalValue(projectModelEnvironment(node.state), event.preProjection))
      )
        throw new Error(`event ${event.index} stutters outside the model frontier`)
      frontierSizes.push(frontier.length)
      perEvent.push({
        eventIndex: index,
        paths: frontier.length,
        distinctFullStates: new Set(
          frontier.map((node) =>
            JSON.stringify(node.state, (_, value) => (typeof value === "bigint" ? `${value}n` : value))
          )
        ).size
      })
      continue
    }
    const result = advanceObservedEvent(oracle, frontier, event, reverseEnumeration)
    frontier = result.nodes
    frontierSizes.push(frontier.length)
    perEvent.push({
      eventIndex: index,
      paths: frontier.length,
      distinctFullStates: new Set(
        frontier.map((node) =>
          JSON.stringify(node.state, (_, value) => (typeof value === "bigint" ? `${value}n` : value))
        )
      ).size
    })
    if (frontier.length === 0) throw new Error(`no complete Quint successor for reverse event ${event.index}`)
    result.transitions.forEach((transition) => {
      inferredPicks.push({
        eventIndex: index,
        branchIndex: transition.branchIndex,
        choiceVector: transition.choiceVector
      })
      inferredModelActions.push(...transition.actionNames)
    })
  }
  if (crashReconciliation !== undefined) throw new Error("reverse trace ends before crash reconciliation is durable")
  const finalNode = frontier[0]
  if (finalNode === undefined || projectModelEnvironment(finalNode.state).status !== trace.terminal.finalStatus)
    throw new Error("reverse trace terminal status does not match Quint")
  const last = trace.events.at(-1)
  if (last === undefined || trace.terminal.finalAction !== last.implementationAction)
    throw new Error("reverse trace terminal action does not match its last observation")
  if (last.implementationAction !== "settleCommandResponse" || trace.terminal.finalStatus !== "StatusExecuting")
    throw new Error("reverse trace does not finish with Executing")
  const usage = process.cpuUsage(startedCpu)
  const paths = frontier.map((node) => ({
    pathIdentity: modelPathSemanticIdentity(node.path),
    fullStateIdentity: JSON.stringify(node.state, (_, value) => (typeof value === "bigint" ? `${value}n` : value)),
    path: node.path
  }))
  return {
    accepted: true,
    finalFrontierSize: frontier.length,
    frontierSizes,
    inferredPicks,
    inferredModelActions,
    completePaths: frontier.length,
    paths,
    perEvent,
    oracleLoad: oracle.loadMeasurement,
    frontierWallMs: performance.now() - startedWall,
    frontierCpuMs: (usage.user + usage.system) / 1000
  }
}

export const checkReverseTrace = async (trace: ReverseTrace): Promise<ReverseCheckResult> => {
  validateTraceProvenance(trace)
  return checkReverseTraceWithLoadedOracle(trace, await loadResumeRedeliveryOracle())
}

/** Test-only checker for a separately loaded, typechecked mutation oracle. */
export const checkReverseTraceWithOracle = async (
  trace: ReverseTrace,
  oracle: Awaited<ReturnType<typeof loadResumeRedeliveryOracle>>,
  strictFaultSchedule = false
): Promise<ReverseCheckResult> => {
  validateTraceProvenance(trace, oracle.sourceSha256, strictFaultSchedule)
  return checkReverseTraceWithLoadedOracle(trace, oracle)
}

/** Test-only order-invariance control for the evaluator frontier. */
export const checkReverseTraceWithReversedEnumeration = async (trace: ReverseTrace): Promise<ReverseCheckResult> => {
  validateTraceProvenance(trace)
  return checkReverseTraceWithLoadedOracle(trace, await loadResumeRedeliveryOracle(), true)
}

export const checkReverseCollection = async (collection: ReverseCollection): Promise<ReverseCheckResult> => {
  if (collection._tag !== "Completed") throw new Error(`reverse collection is ${collection._tag}, not Completed`)
  return checkReverseTrace(collection.trace)
}
