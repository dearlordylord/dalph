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
  RunnableFrontierTransitionTag,
  TrackerTarget,
  WorkflowOperation,
  ActiveTaskClaim,
  type OperationId
} from "@dalph/orchestrator"
import { Effect, Option, Schema } from "effect"
import {
  hermeticQualificationDependantTaskSpecification,
  hermeticQualificationPublicTaskSpecification,
  hermeticQualificationTrackerIdentity,
  type HermeticFixtureManifest
} from "./production-hermetic-contract.js"
import {
  deriveProductionPlannedAttemptLocations,
  productionExecutorLocator,
  type ProductionRepositoryHostConfiguration
} from "./production-configuration.js"

const qualificationSourceDiagnosticTags = Schema.Literals([
  // Journal occurrences and their nested events.
  "GitReadInitiated",
  "TaskAttemptPlanned",
  "TaskClaimAcquisitionInitiated",
  "TaskClaimAcquired",
  "TaskTrackerReadInitiated",
  "TaskTrackerFactsObserved",
  "TaskWorktreeReconciliationInitiated",
  "TaskWorktreeReady",
  "PlannedAttemptExecutorWorkResponsibilityBegan",
  "PlannedAttemptExecutorWorkReported",
  "PlannedAttemptWorktreeObserved",
  "IntegrationResponsibilityBegan",
  "IntegrationStarted",
  "TargetLineageObserved",
  "IntegratorSessionFixed",
  "IntegratorRunStarted",
  "IntegratorRunResultRecorded",
  "IntegratorCandidateQualificationInitiated",
  "IntegratorCandidateQualificationObserved",
  "RemotePublicationAdmissionReadInitiated",
  "RemotePublicationAdmissionObserved",
  "RemoteBaselineReadInitiated",
  "RemoteBaselineObserved",
  "LocalTargetCatchUpInitiated",
  "LocalTargetCatchUpObserved",
  "RemotePublicationRequested",
  "RemotePublicationAttemptRequested",
  "RemotePublicationSucceeded",
  "TargetPromotionRequested",
  "TargetPromotionAttemptRequested",
  "TargetPromotionSucceeded",
  "TargetPromotionStale",
  "IntegrationQuarantined",
  "TaskClaimReleaseInitiated",
  "TaskClaimReleased",
  "IntegrationClaimReplacementOccurred",
  "IntegrationClaimDeletionOccurred",
  "IntegrationFinalitySettledOccurred",
  "IntegrationFocusedCompletionOccurred",
  "WorktreeCleanupOccurred",
  "BranchCleanupOccurred",
  "IntegratorCandidateCleanupOccurred",
  "CompletionClaimDeletionReadObserved",
  "CompletionClaimMarkerAbsent",
  "CompletionTaskAcknowledged",
  "CompletionTaskAttemptIntended",
  "CompletionTaskCandidateAncestryObserved",
  "CompletionTaskCandidateAncestryReadIntended",
  "CompletionTaskRejected",
  "CompletionTaskRequestLookupIntended",
  "CompletionTaskRequestLookupObserved",
  "IntegratorCandidateCleanupMutationIntended",
  "IntegratorCandidateCleanupObservationIntended",
  "IntegratorCandidateCleanupObserved",
  "PlannedWorktreeReady",
  "PostPromotionBlockerCandidateAncestryObserved",
  "PostPromotionBlockerCandidateAncestryReadIntended",
  "TaskTrackerFactsReadFailed",
  "WorktreeCleanupAuthorized",
  // Proposal routes, steps, actions, and transitions.
  "TrackerGraphReadRoute",
  "ReadCurrentTaskGraph",
  "AcquireTaskClaim",
  "ReadPostClaimGraph",
  "ReadTaskWorkSpecification",
  "RecordTaskAttemptPlan",
  "ReconcileTaskWorktree",
  "BeginPlannedAttemptExecutorWork",
  "ObservePlannedAttemptExecutorWork",
  "ReadRejectedTaskClaim",
  "ReadTargetLineage",
  "ReadTaskClaim",
  "ReadTaskWorktree",
  "ReadTrackerGraph",
  "CheckTaskClaim",
  "ReconcileTaskClaimRelease",
  "QueueAcceptedResultIntegrationResponsibility",
  "StartQueuedIntegration",
  "AcquireStartedIntegrationTarget",
  "ReconcilePlannedAttemptExecutorWork",
  "RunIntegrator",
  "EstablishRemoteBaseline",
  "RunRemotePublication",
  "RunTargetPromotion",
  "RecordPromotionStaleIntegrationQuarantine",
  "ReplacePromotedTaskClaim",
  "CompletePromotedTask",
  "ObserveFocusedTaskCompletion",
  "DeleteCompletedTaskCompletionClaim",
  "ReleaseStartedIntegrationTarget",
  // Status entries whose diagnostics do not resolve to an owning proposal.
  "ProposedDeliveryAction",
  "DependencyWait",
  "LiveDeliveryAction",
  "AcceptedFactPublicationWait",
  "TrackerFactWait",
  "IntegrationTargetWait",
  "EvidenceUnavailable",
  "Settlement"
])
const HermeticQualificationDiagnosticTag = Schema.Union([
  qualificationSourceDiagnosticTags,
  RunnableFrontierTransitionTag
])
type HermeticQualificationDiagnosticTag = typeof HermeticQualificationDiagnosticTag.Type

/** A qualification source or its expected-record registration failed before public presentation. */
export class HermeticQualificationSourceRejected extends Schema.TaggedError<HermeticQualificationSourceRejected>()(
  "HermeticQualificationSourceRejected",
  {
    /** Closed internal transition tag; safe diagnostic context contains no provider or task data. */
    transitionTag: Schema.optional(HermeticQualificationDiagnosticTag),
    /** Runtime diagnostic operation mirrors the same closed, safe tag. */
    operation: Schema.optional(HermeticQualificationDiagnosticTag)
  }
) {}

export const sourceRejected = () => new HermeticQualificationSourceRejected()

const diagnosticTag = (value: string): HermeticQualificationDiagnosticTag | undefined =>
  Schema.decodeUnknownOption(HermeticQualificationDiagnosticTag)(value).pipe(Option.getOrUndefined)

export const sourceRejectedWithTag = (transitionTag: HermeticQualificationDiagnosticTag) =>
  new HermeticQualificationSourceRejected({ operation: transitionTag, transitionTag })

/** Adds only a closed workflow tag when a lower-level source check has not already identified one. */
export const sourceRejectedAt = (transitionTag: string) => (rejection: HermeticQualificationSourceRejected) => {
  const safeTag = rejection.transitionTag ?? diagnosticTag(transitionTag)
  return safeTag === undefined ? rejection : sourceRejectedWithTag(safeTag)
}
const workflowOperationUuidVersion = 7
const workflowOperationUuid = Schema.String.check(Schema.isUUID(workflowOperationUuidVersion))
export const strictSource = { onExcessProperty: "error", reportInput: false } as const
export type QualificationContext = {
  readonly configuration: ProductionRepositoryHostConfiguration
  readonly runId: RunId
  readonly taskId: ReturnType<typeof githubTaskIdFor>
  readonly dependantTaskId: ReturnType<typeof githubTaskIdFor>
  readonly specification: TaskWorkSpecification
  readonly dependantSpecification: TaskWorkSpecification
  readonly derivedOperationIds: ReadonlyArray<OperationId>
}

export const isQualificationTaskId = (taskId: QualificationContext["taskId"], context: QualificationContext) =>
  taskId === context.taskId || taskId === context.dependantTaskId

export const qualificationSpecificationFor = (
  taskId: QualificationContext["taskId"],
  context: QualificationContext
): TaskWorkSpecification | undefined =>
  taskId === context.taskId
    ? context.specification
    : taskId === context.dependantTaskId
      ? context.dependantSpecification
      : undefined

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
  const expected = qualificationSpecificationFor(decoded.taskId, context)
  if (expected === undefined || !Schema.toEquivalence(TaskWorkSpecification)(decoded, expected))
    return yield* sourceRejected()
  return expected
})

/** The fixed qualification fixture uses the ordinary planner's first task-local plan, ordinal zero. */
export const qualificationPlannedAttemptFor = (
  context: QualificationContext,
  taskId: QualificationContext["taskId"] = context.taskId
): PlannedTaskAttempt => {
  const specification = qualificationSpecificationFor(taskId, context) ?? context.specification
  return PlannedTaskAttempt.make({
    ...deriveProductionPlannedAttemptLocations(
      context.configuration.plannedAttemptWorktreeRoot,
      context.runId,
      taskId,
      PlannedTaskAttemptOrdinal.make(0)
    ),
    baseSha: context.configuration.plannedAttemptBaseSha,
    executor: productionExecutorLocator(context.configuration),
    runId: context.runId,
    taskId,
    taskRevision: specification.fingerprint
  })
}

export const validatePlannedAttempt = Effect.fn("HermeticQualification.validatePlannedAttempt")(function* (
  plannedAttempt: PlannedTaskAttempt,
  context: QualificationContext
) {
  const decoded = yield* Schema.decodeUnknownEffect(
    PlannedTaskAttempt,
    strictSource
  )(plannedAttempt).pipe(Effect.mapError(sourceRejected))
  const expected = qualificationPlannedAttemptFor(context, decoded.taskId)
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
  const dependantTaskId = githubTaskIdFor(
    hermeticQualificationTrackerIdentity.repositoryNodeId,
    hermeticQualificationTrackerIdentity.dependantIssueNodeId
  )
  const derivedOperationIds: ReadonlyArray<OperationId> = []
  return {
    configuration,
    runId,
    taskId,
    dependantTaskId,
    specification: makeTaskWorkSpecification({ taskId, ...hermeticQualificationPublicTaskSpecification }),
    dependantSpecification: makeTaskWorkSpecification({
      taskId: dependantTaskId,
      ...hermeticQualificationDependantTaskSpecification
    }),
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
    !isQualificationTaskId(decoded.acquisition.taskId, context) ||
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
  if (!isQualificationTaskId(original.taskId, context) || original.owner !== context.configuration.claimOwner)
    return yield* sourceRejected()
  yield* validateOperationId(original.operationId)
  yield* Schema.decodeUnknownEffect(
    workflowOperationUuid,
    strictSource
  )(original.token).pipe(Effect.mapError(sourceRejected))
})
