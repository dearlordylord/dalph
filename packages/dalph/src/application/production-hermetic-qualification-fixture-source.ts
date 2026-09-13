import { GitCommitSha, type TaskId } from "@dalph/contracts"
import {
  TrackerTask,
  WorkflowOperation,
  TrackerTarget,
  CompletionTaskClaim,
  CompletionTaskRequest,
  CompletionClaimReplacementRequest,
  CompletionClaimDeletionRequest,
  IntegratorRunCorrelation,
  IntegratorSessionCorrelation,
  IntegratorRunQualifiedCandidate,
  StartedIntegrationResponsibility,
  TargetLineageObservation,
  integratorCorrelationFor,
  completionClaimReplacementRequestFor,
  completionClaimDeletionRequestFor,
  completionTaskRequestFor,
  trackerRevisionFor,
  TaskDagWire,
  TaskTrackerFactsObservation,
  type TrackerRevision,
  type FocusedTaskCompletionFacts
} from "@dalph/orchestrator"
import { Effect, Schema } from "effect"
import {
  sourceRejected,
  strictSource,
  validateActiveClaim,
  validateClaimOperation,
  validateOperationId,
  validateWorkflowOperationId,
  validateSpecification,
  validatePlannedAttempt,
  validateTarget,
  type QualificationContext
} from "./production-hermetic-qualification-attempt-source.js"

export const validateTask = Effect.fn("HermeticQualification.validateTask")(function* (
  task: typeof TrackerTask.Type,
  context: QualificationContext
) {
  const decoded = yield* Schema.decodeUnknownEffect(
    TrackerTask,
    strictSource
  )(task).pipe(Effect.mapError(sourceRejected))
  if (
    decoded.id !== context.taskId ||
    decoded.parentTaskId !== null ||
    decoded.prerequisiteIds.length !== 0 ||
    decoded.lifecycle._tag === "TerminalWithoutSuccess"
  )
    return yield* sourceRejected()
  return decoded
})

export const validateGraph = Effect.fn("HermeticQualification.validateGraph")(function* (
  graph: TaskDagWire,
  context: QualificationContext
) {
  const original = yield* Schema.decodeUnknownEffect(
    TaskDagWire,
    strictSource
  )(graph).pipe(Effect.mapError(sourceRejected))
  if (original.tasks.length !== 1) return yield* sourceRejected()
  const tasks = yield* Effect.forEach(original.tasks, (task) => validateTask(task, context))
  if (original.revision !== trackerRevisionFor(tasks)) return yield* sourceRejected()
})

export const validateTrackerRevision = (revision: TrackerRevision, context: QualificationContext) =>
  ["Open", "CompletedSuccessfully"].some(
    (lifecycle) =>
      revision ===
      trackerRevisionFor([
        {
          id: context.taskId,
          lifecycle: lifecycle === "Open" ? { _tag: "Open" } : { _tag: "CompletedSuccessfully" },
          parentTaskId: null,
          prerequisiteIds: []
        }
      ])
  )
    ? Effect.void
    : Effect.fail(sourceRejected())

const validateTaskIds = (taskIds: ReadonlyArray<TaskId>, context: QualificationContext) =>
  taskIds.every((id) => id === context.taskId) ? Effect.void : Effect.fail(sourceRejected())

export const validateCompletionFacts = Effect.fn("HermeticQualification.validateCompletionFacts")(function* (
  facts: FocusedTaskCompletionFacts,
  context: QualificationContext
) {
  if (
    facts.taskId !== context.taskId ||
    facts.taskRevision !== context.specification.fingerprint ||
    facts.unfinishedPrerequisiteTaskIds.length !== 0 ||
    facts.targetMembership !== "Member" ||
    !Schema.toEquivalence(TrackerTarget)(facts.target, context.configuration.target)
  )
    return yield* sourceRejected()
  yield* validateTrackerRevision(facts.trackerRevision, context)
  yield* validateCompletionFactsClaim(facts.currentClaim, context)
})

const validateCompletionFactsClaim = Effect.fn("HermeticQualification.validateCompletionFactsClaim")(function* (
  claim: FocusedTaskCompletionFacts["currentClaim"],
  context: QualificationContext
) {
  if (claim._tag === "CompletionTaskClaim") yield* validateCompletionClaim(claim, context)
  else if (claim._tag === "ActiveTaskClaim") yield* validateActiveClaim(claim, context)
  else if (claim._tag !== "UnclaimedTask" || claim.taskId !== context.taskId) return yield* sourceRejected()
})

export const validateTrackerFacts = Effect.fn("HermeticQualification.validateTrackerFacts")(function* (
  facts: TaskTrackerFactsObservation,
  context: QualificationContext
) {
  yield* Schema.decodeUnknownEffect(
    TaskTrackerFactsObservation,
    strictSource
  )(facts).pipe(Effect.mapError(sourceRejected))
  if (!Schema.toEquivalence(TrackerTarget)(facts.target, context.configuration.target)) return yield* sourceRejected()
  if (facts._tag === "FocusedTaskCompletionFacts") {
    yield* validateCompletionRequest(facts.request, context)
    yield* validateCompletionFacts(facts.facts, context)
    return
  }
  yield* validateOperationId(facts.operationId)
  return yield* validateGraphOrFocusedTrackerFacts(facts, context)
})

const validateGraphOrFocusedTrackerFacts = Effect.fn("HermeticQualification.validateGraphOrFocusedTrackerFacts")(
  function* (
    facts: Exclude<TaskTrackerFactsObservation, { readonly _tag: "FocusedTaskCompletionFacts" }>,
    context: QualificationContext
  ) {
    if (facts._tag === "CompleteTaskTrackerFacts" || facts._tag === "UnchangedTaskTrackerFactsReconfirmed") {
      if (facts.rootTaskId !== undefined && facts.rootTaskId !== context.taskId) return yield* sourceRejected()
      yield* Effect.forEach(facts.factFamilies, (family) => validateGraphFactFamily(family, context))
      return
    }
    if (facts._tag === "FocusedTaskWorkSpecificationFacts") {
      const specification = facts.factFamily
      if (
        specification.coverage.taskId !== context.taskId ||
        specification.contentIdentity !== context.specification.fingerprint
      )
        return yield* sourceRejected()
      yield* validateSpecification(
        {
          taskId: specification.taskId,
          title: specification.title,
          body: specification.body,
          fingerprint: specification.fingerprint
        },
        context
      )
      return
    }
    if (facts._tag === "FocusedTaskClaimFacts") {
      if (facts.coverage.taskId !== context.taskId) return yield* sourceRejected()
      if (facts.observation._tag === "ActiveTaskClaim") yield* validateActiveClaim(facts.observation, context)
      else if (facts.observation.taskId !== context.taskId) return yield* sourceRejected()
      return
    }
    return yield* sourceRejected()
  }
)

type GraphFactFamily = Extract<
  TaskTrackerFactsObservation,
  { readonly _tag: "CompleteTaskTrackerFacts" | "UnchangedTaskTrackerFactsReconfirmed" }
>["factFamilies"][number]
const validateGraphFactFamily = Effect.fn("HermeticQualification.validateGraphFactFamily")(function* (
  family: GraphFactFamily,
  context: QualificationContext
) {
  yield* validateTrackerRevision(family.contentIdentity, context)
  yield* validateTaskIds(family.coverage.explicitlyCoveredTaskIds, context)
  if (!Schema.toEquivalence(TrackerTarget)(family.coverage.target, context.configuration.target))
    return yield* sourceRejected()
  if ("target" in family && !Schema.toEquivalence(TrackerTarget)(family.target, context.configuration.target))
    return yield* sourceRejected()
  if ("taskIds" in family) yield* validateTaskIds(family.taskIds, context)
  if ("subjectTaskIds" in family) yield* validateTaskIds(family.subjectTaskIds, context)
  if ("memberTaskIds" in family) yield* validateTaskIds(family.memberTaskIds, context)
  yield* validateGraphFactRows(family, context)
})

const validateGraphFactRows = Effect.fn("HermeticQualification.validateGraphFactRows")(function* (
  family: GraphFactFamily,
  context: QualificationContext
) {
  if ("lifecycles" in family)
    yield* Effect.forEach(family.lifecycles, (row) =>
      validateTask({ id: row.taskId, lifecycle: row.lifecycle, parentTaskId: null, prerequisiteIds: [] }, context)
    )
  if (
    "prerequisites" in family &&
    family.prerequisites.some((row) => row.taskId !== context.taskId || row.prerequisiteTaskIds.length !== 0)
  )
    return yield* sourceRejected()
  if (
    "groupings" in family &&
    family.groupings.some((row) => row.taskId !== context.taskId || row.parentTaskId !== null)
  )
    return yield* sourceRejected()
})

export const validateOperation = Effect.fn("HermeticQualification.validateOperation")(function* (
  operation: WorkflowOperation,
  context: QualificationContext
) {
  const original = yield* Schema.decodeUnknownEffect(
    WorkflowOperation,
    strictSource
  )(operation).pipe(Effect.mapError(sourceRejected))
  yield* Effect.forEach(original.predecessorOperationIds, (id) => validateWorkflowOperationId(id, context))
  if (original._tag === "AcquireTaskClaim") return yield* validateClaimOperation(original, context)
  if (original._tag === "ReleaseTaskClaim") {
    if (original.authority._tag !== "WorkflowClaimReleaseAuthority") return yield* sourceRejected()
    yield* validateActiveClaim(original.release.claim, context)
    yield* validateWorkflowOperationId(original.release.operationId, context)
    return
  }
  return yield* validateReadOrPlanOperation(original, context)
})

const validateReadOrPlanOperation = Effect.fn("HermeticQualification.validateReadOrPlanOperation")(function* (
  operation: Exclude<WorkflowOperation, { readonly _tag: "AcquireTaskClaim" | "ReleaseTaskClaim" }>,
  context: QualificationContext
) {
  if (operation._tag === "ReadCompletionTaskFacts") {
    // Its existing schema already reconstructs operationId from request and purpose.
    yield* validateCompletionRequest(operation.request, context)
  } else yield* validateWorkflowOperationId(operation.operationId, context)
  if ("plannedAttempt" in operation) yield* validatePlannedAttempt(operation.plannedAttempt, context)
  if ("integrationTarget" in operation) yield* validateTarget(operation.integrationTarget, context)
  return yield* validateTrackerReadOperation(operation, context)
})

const validateTrackerReadOperation = Effect.fn("HermeticQualification.validateTrackerReadOperation")(function* (
  operation: Exclude<WorkflowOperation, { readonly _tag: "AcquireTaskClaim" | "ReleaseTaskClaim" }>,
  context: QualificationContext
) {
  if ("taskId" in operation && operation.taskId !== context.taskId) return yield* sourceRejected()
  if ("target" in operation && !Schema.toEquivalence(TrackerTarget)(operation.target, context.configuration.target))
    return yield* sourceRejected()
  if (operation._tag !== "ReadTrackerGraph") return
  if (operation.readShape.explicitlyCoveredTaskIds.some((id) => id !== context.taskId)) return yield* sourceRejected()
  if (operation.cause._tag === "PostQuiescenceReconfirmation")
    yield* validateOperationId(operation.cause.quiescentGraphOperationId)
})

export const validateResponsibility = Effect.fn("HermeticQualification.validateResponsibility")(function* (
  responsibility: StartedIntegrationResponsibility,
  context: QualificationContext
) {
  const decoded = yield* Schema.decodeUnknownEffect(
    StartedIntegrationResponsibility,
    strictSource
  )(responsibility).pipe(Effect.mapError(sourceRejected))
  yield* validatePlannedAttempt(decoded.plannedAttempt, context)
  yield* validateTarget(decoded.integrationTarget, context)
  return decoded
})

export const validateRunCorrelation = Effect.fn("HermeticQualification.validateRunCorrelation")(function* (
  run: IntegratorRunCorrelation,
  context: QualificationContext
) {
  const decoded = yield* Schema.decodeUnknownEffect(
    IntegratorRunCorrelation,
    strictSource
  )(run).pipe(Effect.mapError(sourceRejected))
  yield* validateSessionCorrelation(decoded.session, context)
  return decoded
})

export const validateSessionCorrelation = Effect.fn("HermeticQualification.validateSessionCorrelation")(function* (
  correlation: IntegratorSessionCorrelation,
  context: QualificationContext
) {
  const session = yield* Schema.decodeUnknownEffect(
    IntegratorSessionCorrelation,
    strictSource
  )(correlation).pipe(Effect.mapError(sourceRejected))
  const responsibility = yield* validateResponsibility(
    StartedIntegrationResponsibility.make({
      acceptedResult: session.acceptedResult,
      integrationTarget: session.integrationTarget,
      plannedAttempt: session.plannedAttempt,
      queuedAt: session.queuedAt,
      startedAt: session.startedAt
    }),
    context
  )
  const expected = integratorCorrelationFor({
    responsibility,
    targetLineage: TargetLineageObservation.make({
      plannedBaseSha: context.configuration.plannedAttemptBaseSha,
      targetHeadSha: session.expectedTargetHead,
      plannedBaseIsAncestorOfTargetHead: true
    }),
    targetLineageObservedAt: session.targetLineageObservedAt
  })
  if (!Schema.toEquivalence(IntegratorSessionCorrelation)(session, expected)) return yield* sourceRejected()
  return expected
})

export const validateCandidate = Effect.fn("HermeticQualification.validateCandidate")(function* (
  candidate: IntegratorRunQualifiedCandidate,
  context: QualificationContext
) {
  const decoded = yield* Schema.decodeUnknownEffect(
    IntegratorRunQualifiedCandidate,
    strictSource
  )(candidate).pipe(Effect.mapError(sourceRejected))
  yield* validateRunCorrelation(decoded.run, context)
  const candidateCommit = yield* Schema.decodeUnknownEffect(
    GitCommitSha,
    strictSource
  )(decoded.candidateText).pipe(Effect.mapError(sourceRejected))
  if (candidateCommit !== decoded.candidateCommit) return yield* sourceRejected()
  return decoded
})

export const validateCompletionClaim = Effect.fn("HermeticQualification.validateCompletionClaim")(function* (
  claim: CompletionTaskClaim,
  context: QualificationContext
) {
  const decoded = yield* Schema.decodeUnknownEffect(
    CompletionTaskClaim,
    strictSource
  )(claim).pipe(Effect.mapError(sourceRejected))
  yield* validatePlannedAttempt(decoded.plannedAttempt, context)
  yield* validateCandidate(decoded.promotionCorrelation.qualifiedCandidate, context)
  yield* validateActiveClaim(decoded.originalClaim, context)
  return decoded
})

export const validateCompletionRequest = Effect.fn("HermeticQualification.validateCompletionRequest")(function* (
  request: CompletionTaskRequest,
  context: QualificationContext
) {
  const decoded = yield* Schema.decodeUnknownEffect(
    CompletionTaskRequest,
    strictSource
  )(request).pipe(Effect.mapError(sourceRejected))
  const claim = yield* validateCompletionClaim(decoded.claim, context)
  const expected = completionTaskRequestFor(claim)
  if (!Schema.toEquivalence(CompletionTaskRequest)(decoded, expected)) return yield* sourceRejected()
  return expected
})

export const validateReplacementRequest = Effect.fn("HermeticQualification.validateReplacementRequest")(function* (
  request: CompletionClaimReplacementRequest,
  context: QualificationContext
) {
  const decoded = yield* Schema.decodeUnknownEffect(
    CompletionClaimReplacementRequest,
    strictSource
  )(request).pipe(Effect.mapError(sourceRejected))
  const expected = completionClaimReplacementRequestFor(yield* validateCompletionClaim(decoded.claim, context))
  if (!Schema.toEquivalence(CompletionClaimReplacementRequest)(decoded, expected)) return yield* sourceRejected()
  return expected
})

export const validateDeletionRequest = Effect.fn("HermeticQualification.validateDeletionRequest")(function* (
  request: CompletionClaimDeletionRequest,
  context: QualificationContext
) {
  const decoded = yield* Schema.decodeUnknownEffect(
    CompletionClaimDeletionRequest,
    strictSource
  )(request).pipe(Effect.mapError(sourceRejected))
  const claim = yield* validateCompletionClaim(decoded.claim, context)
  const success = decoded.successObservation
  yield* validateWorkflowOperationId(success.operationId, context)
  if (
    !Schema.toEquivalence(TrackerTarget)(success.target, context.configuration.target) ||
    success.trackerRevision !==
      trackerRevisionFor([
        { id: context.taskId, lifecycle: { _tag: "CompletedSuccessfully" }, parentTaskId: null, prerequisiteIds: [] }
      ])
  )
    return yield* sourceRejected()
  const expected = completionClaimDeletionRequestFor(claim, success)
  if (!Schema.toEquivalence(CompletionClaimDeletionRequest)(decoded, expected)) return yield* sourceRejected()
  return expected
})
