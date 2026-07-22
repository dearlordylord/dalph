import { it } from "@effect/vitest"
import { defineDriver, ITFBigInt, ITFSet, stateCheck } from "@firfi/quint-connect/effect"
import { quintIt } from "@firfi/quint-connect/vitest"
import { Effect, Schema } from "effect"
import { makeTaskWorkSessionRecoveryTestControl } from "./task-work-session-recovery-test-control.js"

const actionSchema = {
  commitIntent: {},
  crash: {},
  init: {},
  lookupAbsent: {},
  lookupConflict: {},
  lookupContradictoryAbsence: {},
  lookupMatching: {},
  lookupUnreadable: {},
  recordLookup: {},
  recordOutcome: {},
  requestCreatesNothing: {},
  requestCreatesSession: {},
  restart: {},
  selectIdentity: {}
}

const SpecRecoveryProjection = Schema.Struct({
  state: Schema.Struct({
    authorization: Schema.Unknown,
    candidateSelected: Schema.Boolean,
    coordinatorRunning: Schema.Boolean,
    everCrashed: Schema.Boolean,
    intentCommitted: Schema.Boolean,
    lookupAttempts: ITFBigInt,
    matchingReportRecorded: Schema.Boolean,
    operationId: ITFBigInt,
    predecessorOperationIds: ITFSet(ITFBigInt),
    pendingEvidence: Schema.Unknown,
    providerHasSession: Schema.Boolean,
    recordedEvidence: Schema.Unknown,
    requestCount: ITFBigInt,
    requestOperationIds: ITFSet(ITFBigInt),
    requestPayloads: ITFSet(ITFBigInt),
    status: Schema.Unknown
  })
})

const variantTag = (value: unknown): string => {
  if (typeof value === "string") return value
  if (typeof value === "object" && value !== null && "tag" in value) {
    return String(value.tag)
  }
  return String(value)
}

const setsEqual = <A>(left: ReadonlySet<A>, right: ReadonlySet<A>): boolean =>
  left.size === right.size && [...left].every((value) => right.has(value))

/** Every generated Quint action calls one public deterministic test control. */
const recoveryConformanceDriver = defineDriver(
  actionSchema,
  makeTaskWorkSessionRecoveryTestControl
)

quintIt(it.effect, "replays the recovery model through the TypeScript boundary", {
  backend: "typescript",
  driverFactory: recoveryConformanceDriver,
  maxSteps: 40,
  nTraces: 25,
  seed: "41",
  spec: "specs/taskWorkSessionRecovery.qnt",
  stateCheck: stateCheck(
    (raw) =>
      Schema.decodeUnknownEffect(SpecRecoveryProjection)(raw).pipe(
        Effect.map(({ state }) => ({
          ...state,
          authorization: variantTag(state.authorization),
          pendingEvidence: variantTag(state.pendingEvidence),
          recordedEvidence: variantTag(state.recordedEvidence),
          status: variantTag(state.status)
        })),
        Effect.orDie
      ),
    (spec, implementation) =>
      spec.authorization === implementation.authorization
      && spec.candidateSelected === implementation.candidateSelected
      && spec.coordinatorRunning === implementation.coordinatorRunning
      && spec.everCrashed === implementation.everCrashed
      && spec.intentCommitted === implementation.intentCommitted
      && spec.lookupAttempts === implementation.lookupAttempts
      && spec.matchingReportRecorded === implementation.matchingReportRecorded
      && spec.operationId === implementation.operationId
      && setsEqual(spec.predecessorOperationIds, implementation.predecessorOperationIds)
      && spec.pendingEvidence === implementation.pendingEvidence
      && spec.providerHasSession === implementation.providerHasSession
      && spec.recordedEvidence === implementation.recordedEvidence
      && spec.requestCount === implementation.requestCount
      && setsEqual(spec.requestOperationIds, implementation.requestOperationIds)
      && setsEqual(spec.requestPayloads, implementation.requestPayloads)
      && spec.status === implementation.status
  )
})
