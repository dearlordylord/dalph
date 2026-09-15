import {
  IntegrationTarget,
  makeTaskWorkSpecification,
  PlannedTaskAttempt,
  TaskWorkSpecification,
  type RunId
} from "@dalph/contracts"
import {
  decodeFreshWorkflowRunIdForDiagnostics,
  githubTaskIdFor,
  PlannedTaskAttemptOrdinal,
  TrackerTarget,
  WorkflowOperation,
  ActiveTaskClaim,
  type OperationId
} from "@dalph/orchestrator"
import { Effect, Schema } from "effect"
import {
  hermeticQualificationPublicTaskSpecification,
  hermeticQualificationTrackerIdentity,
  type HermeticFixtureManifest
} from "./production-hermetic-contract.js"
import {
  deriveProductionPlannedAttemptLocations,
  productionExecutorLocator,
  type ProductionRepositoryHostConfiguration
} from "./production-configuration.js"

/** A qualification source or its expected-record registration failed before public presentation. */
export class HermeticQualificationSourceRejected extends Schema.TaggedError<HermeticQualificationSourceRejected>()(
  "HermeticQualificationSourceRejected",
  {}
) {}

export const sourceRejected = () => new HermeticQualificationSourceRejected()
const workflowOperationUuidVersion = 7
const workflowOperationUuid = Schema.String.check(Schema.isUUID(workflowOperationUuidVersion))
export const strictSource = { onExcessProperty: "error", reportInput: false } as const
export type QualificationContext = {
  readonly configuration: ProductionRepositoryHostConfiguration
  readonly runId: RunId
  readonly taskId: ReturnType<typeof githubTaskIdFor>
  readonly specification: TaskWorkSpecification
  readonly derivedOperationIds: ReadonlyArray<OperationId>
}

export const validateOperationId = (operationId: OperationId) =>
  Schema.decodeUnknownEffect(workflowOperationUuid, strictSource)(operationId).pipe(Effect.mapError(sourceRejected))

export const validateWorkflowOperationId = (operationId: OperationId, context: QualificationContext) =>
  Schema.is(workflowOperationUuid)(operationId) || context.derivedOperationIds.includes(operationId)
    ? Effect.void
    : Effect.fail(sourceRejected())

export const validateSpecification = Effect.fn("HermeticQualification.validateSpecification")(function* (
  specification: TaskWorkSpecification,
  context: QualificationContext
) {
  const decoded = yield* Schema.decodeUnknownEffect(
    TaskWorkSpecification,
    strictSource
  )(specification).pipe(Effect.mapError(sourceRejected))
  if (!Schema.toEquivalence(TaskWorkSpecification)(decoded, context.specification)) return yield* sourceRejected()
  return context.specification
})

/** The fixed qualification fixture uses the ordinary planner's first task-local plan, ordinal zero. */
export const qualificationPlannedAttemptFor = (context: QualificationContext): PlannedTaskAttempt =>
  PlannedTaskAttempt.make({
    ...deriveProductionPlannedAttemptLocations(
      context.configuration.plannedAttemptWorktreeRoot,
      context.runId,
      context.taskId,
      PlannedTaskAttemptOrdinal.make(0)
    ),
    baseSha: context.configuration.plannedAttemptBaseSha,
    executor: productionExecutorLocator(context.configuration),
    runId: context.runId,
    taskId: context.taskId,
    taskRevision: context.specification.fingerprint
  })

export const validatePlannedAttempt = Effect.fn("HermeticQualification.validatePlannedAttempt")(function* (
  plannedAttempt: PlannedTaskAttempt,
  context: QualificationContext
) {
  const decoded = yield* Schema.decodeUnknownEffect(
    PlannedTaskAttempt,
    strictSource
  )(plannedAttempt).pipe(Effect.mapError(sourceRejected))
  const expected = qualificationPlannedAttemptFor(context)
  if (!Schema.toEquivalence(PlannedTaskAttempt)(decoded, expected)) return yield* sourceRejected()
  return expected
})

export const validateTarget = Effect.fn("HermeticQualification.validateTarget")(function* (
  target: IntegrationTarget,
  context: QualificationContext
) {
  const decoded = yield* Schema.decodeUnknownEffect(
    IntegrationTarget,
    strictSource
  )(target).pipe(Effect.mapError(sourceRejected))
  const expected = IntegrationTarget.make({
    repository: context.configuration.repository,
    ref: context.configuration.integrationRef
  })
  if (!Schema.toEquivalence(IntegrationTarget)(decoded, expected)) return yield* sourceRejected()
  return expected
})

export const contextFor = Effect.fn("HermeticQualification.contextFor")(function* (
  manifest: HermeticFixtureManifest,
  configuration: ProductionRepositoryHostConfiguration,
  runId: RunId
) {
  const identity = yield* decodeFreshWorkflowRunIdForDiagnostics(runId).pipe(Effect.mapError(sourceRejected))
  if (
    !Schema.toEquivalence(TrackerTarget)(identity.target, configuration.target) ||
    manifest.repository !== configuration.repository ||
    manifest.commonDirectory !== configuration.commonDirectory ||
    manifest.integrationRef !== configuration.integrationRef ||
    manifest.baseSha !== configuration.plannedAttemptBaseSha ||
    manifest.attemptWorktreeRoot !== configuration.plannedAttemptWorktreeRoot
  )
    return yield* sourceRejected()
  const taskId = githubTaskIdFor(
    hermeticQualificationTrackerIdentity.repositoryNodeId,
    hermeticQualificationTrackerIdentity.issueNodeId
  )
  const derivedOperationIds: ReadonlyArray<OperationId> = []
  return {
    configuration,
    runId,
    taskId,
    specification: makeTaskWorkSpecification({ taskId, ...hermeticQualificationPublicTaskSpecification }),
    derivedOperationIds
  }
})

export const validateClaimOperation = Effect.fn("HermeticQualification.validateClaimOperation")(function* (
  operation: typeof WorkflowOperation.cases.AcquireTaskClaim.Type,
  context: QualificationContext
) {
  const decoded = yield* Schema.decodeUnknownEffect(
    WorkflowOperation.cases.AcquireTaskClaim,
    strictSource
  )(operation).pipe(Effect.mapError(sourceRejected))
  if (
    decoded.authority._tag !== "TaskSelectionAuthority" ||
    decoded.acquisition.taskId !== context.taskId ||
    decoded.acquisition.owner !== context.configuration.claimOwner
  )
    return yield* sourceRejected()
  yield* validateOperationId(decoded.acquisition.operationId)
  yield* Schema.decodeUnknownEffect(
    workflowOperationUuid,
    strictSource
  )(decoded.acquisition.token).pipe(Effect.mapError(sourceRejected))
  yield* Effect.forEach(decoded.predecessorOperationIds, validateOperationId)
  return decoded
})

export const validateActiveClaim = Effect.fn("HermeticQualification.validateActiveClaim")(function* (
  claim: ActiveTaskClaim,
  context: QualificationContext
) {
  const original = yield* Schema.decodeUnknownEffect(
    ActiveTaskClaim,
    strictSource
  )(claim).pipe(Effect.mapError(sourceRejected))
  if (original.taskId !== context.taskId || original.owner !== context.configuration.claimOwner)
    return yield* sourceRejected()
  yield* validateOperationId(original.operationId)
  yield* Schema.decodeUnknownEffect(
    workflowOperationUuid,
    strictSource
  )(original.token).pipe(Effect.mapError(sourceRejected))
})
