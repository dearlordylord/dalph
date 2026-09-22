/* eslint-disable max-lines -- Qualification checks keep the exact controlled fixture allowlist auditable in one module. */

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
  githubFocusedCompletionRevisionFor,
  TaskDagWire,
  TaskTrackerFactsObservation,
  type TrackerRevision,
  type DeliveryActionProposal,
  type FocusedTaskCompletionFacts
} from "@dalph/orchestrator"
import { Effect, Schema } from "effect"
import {
  sourceRejected,
  sourceRejectedBecause,
  strictSource,
  validateActiveClaim,
  isQualificationTaskId,
  qualificationSpecificationFor,
  validateClaimOperation,
  validateOperationId,
  validateWorkflowOperationId,
  validateSpecification,
  validatePlannedAttempt,
  validateTarget,
  type QualificationContext
} from "./production-hermetic-qualification-attempt-source.js"

export const validateTask = Effect.fn("HermeticQualification.validateTask")(function* (
  task: TrackerTask,
  context: QualificationContext
) {
  const decoded = yield* Schema.decodeUnknownEffect(
    TrackerTask,
    strictSource
  )(task).pipe(Effect.mapError(sourceRejectedBecause("InvalidTask")))
  const root = decoded.id === context.taskId && decoded.parentTaskId === null && decoded.prerequisiteIds.length === 0
  const dependant =
    decoded.id === context.dependantTaskId &&
    decoded.parentTaskId === context.taskId &&
    decoded.prerequisiteIds.length === 1 &&
    decoded.prerequisiteIds[0] === context.taskId
  if ((!root && !dependant) || decoded.lifecycle._tag === "TerminalWithoutSuccess")
    return yield* sourceRejectedBecause("TaskMismatch")()
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
  const rootOnlyTaskCount = 1
  const rootAndDependantTaskCount = 2
  if (original.tasks.length !== rootOnlyTaskCount && original.tasks.length !== rootAndDependantTaskCount)
    return yield* sourceRejected()
  const tasks = yield* Effect.forEach(original.tasks, (task) => validateTask(task, context))
  if (
    !tasks.some(({ id }) => id === context.taskId) ||
    (tasks.length === rootAndDependantTaskCount && !tasks.some(({ id }) => id === context.dependantTaskId))
  )
    return yield* sourceRejected()
  if (original.revision !== trackerRevisionFor(tasks)) return yield* sourceRejected()
})

const validateTrackerRevision = (revision: TrackerRevision, context: QualificationContext) =>
  [
    ["Open", "Open"],
    ["CompletedSuccessfully", "Open"],
    ["CompletedSuccessfully", "CompletedSuccessfully"]
  ].some(([rootLifecycle, dependantLifecycle]) => {
    const root = TrackerTask.make({
      id: context.taskId,
      lifecycle: rootLifecycle === "Open" ? { _tag: "Open" } : { _tag: "CompletedSuccessfully" },
      parentTaskId: null,
      prerequisiteIds: []
    })
    const dependant = TrackerTask.make({
      id: context.dependantTaskId,
      lifecycle: dependantLifecycle === "Open" ? { _tag: "Open" } : { _tag: "CompletedSuccessfully" },
      parentTaskId: context.taskId,
      prerequisiteIds: [context.taskId]
    })
    return revision === trackerRevisionFor([root]) || revision === trackerRevisionFor([root, dependant])
  })
    ? Effect.void
    : Effect.fail(sourceRejected())

const validateTaskIds = (taskIds: ReadonlyArray<TaskId>, context: QualificationContext) =>
  new Set(taskIds).size === taskIds.length &&
  taskIds.every((id) => id === context.taskId || id === context.dependantTaskId)
    ? Effect.void
    : Effect.fail(sourceRejected())

export const validateCompletionFacts = Effect.fn("HermeticQualification.validateCompletionFacts")(function* (
  facts: FocusedTaskCompletionFacts,
  context: QualificationContext
) {
  const expectedSpecification = qualificationSpecificationFor(facts.taskId, context)
  if (
    expectedSpecification === undefined ||
    facts.taskRevision !== expectedSpecification.fingerprint ||
    facts.unfinishedPrerequisiteTaskIds.length !== 0 ||
    facts.targetMembership !== "Member" ||
    !Schema.toEquivalence(TrackerTarget)(facts.target, context.configuration.target)
  )
    return yield* sourceRejected()
  yield* validateCompletionFactsClaim(facts.currentClaim, context)
  if (facts.lifecycle === "TerminalWithoutSuccess") return yield* sourceRejected()
  const revision = yield* githubFocusedCompletionRevisionFor({
    currentClaim: facts.currentClaim,
    lifecycle: facts.lifecycle,
    target: facts.target,
    targetMembership: facts.targetMembership,
    taskId: facts.taskId,
    taskRevision: facts.taskRevision,
    unfinishedPrerequisiteTaskIds: facts.unfinishedPrerequisiteTaskIds
  }).pipe(Effect.mapError(sourceRejected))
  if (facts.trackerRevision !== revision) return yield* sourceRejected()
})

const validateCompletionFactsClaim = Effect.fn("HermeticQualification.validateCompletionFactsClaim")(function* (
  claim: FocusedTaskCompletionFacts["currentClaim"],
  context: QualificationContext
) {
  /* v8 ignore next -- @preserve CompletionTaskFacts schema binds every completion claim to the task before this boundary. */
  if (claim._tag === "CompletionTaskClaim") yield* validateCompletionClaim(claim, context)
  /* v8 ignore next -- @preserve CompletionTaskFacts schema binds every active claim to the task before this boundary. */ else if (
    claim._tag === "ActiveTaskClaim"
  )
    yield* validateActiveClaim(claim, context)
  else if (claim._tag !== "UnclaimedTask" || !isQualificationTaskId(claim.taskId, context))
    return yield* sourceRejected()
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
      /* v8 ignore next -- @preserve Complete graph schema rejects a root outside its observed task identities. */
      if (facts.rootTaskId !== undefined && facts.rootTaskId !== context.taskId) return yield* sourceRejected()
      yield* Effect.forEach(facts.factFamilies, (family) => validateGraphFactFamily(family, context))
      return
    }
    if (facts._tag === "FocusedTaskWorkSpecificationFacts")
      return yield* validateFocusedSpecificationFacts(facts, context)
    if (facts._tag === "FocusedTaskClaimFacts") return yield* validateFocusedClaimFacts(facts, context)
    return yield* sourceRejected()
  }
)

const validateFocusedSpecificationFacts = Effect.fn("HermeticQualification.validateFocusedSpecificationFacts")(
  function* (
    facts: Extract<TaskTrackerFactsObservation, { readonly _tag: "FocusedTaskWorkSpecificationFacts" }>,
    context: QualificationContext
  ) {
    const specification = facts.factFamily
    const expected = qualificationSpecificationFor(specification.coverage.taskId, context)
    if (expected === undefined || specification.contentIdentity !== expected.fingerprint) return yield* sourceRejected()
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
)

const validateFocusedClaimFacts = Effect.fn("HermeticQualification.validateFocusedClaimFacts")(function* (
  facts: Extract<TaskTrackerFactsObservation, { readonly _tag: "FocusedTaskClaimFacts" }>,
  context: QualificationContext
) {
  /* v8 ignore next -- @preserve Focused claim schema binds coverage to the decoded claim observation before this boundary. */
  if (!isQualificationTaskId(facts.coverage.taskId, context)) return yield* sourceRejected()
  if (facts.observation._tag === "ActiveTaskClaim") {
    /* v8 ignore next -- @preserve Focused claim schema already proves active observation and coverage task identity equal. */
    if (facts.observation.taskId !== facts.coverage.taskId) return yield* sourceRejected()
    yield* validateActiveClaim(facts.observation, context)
    /* v8 ignore start -- @preserve Focused claim schema already proves unclaimed observation and coverage task identity equal. */
  } else if (facts.observation.taskId !== facts.coverage.taskId) return yield* sourceRejected()
  /* v8 ignore stop -- @preserve */
  return
})

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
  /* v8 ignore next -- @preserve Complete graph schema rejects coverage targets that differ from the observed target. */
  if (!Schema.toEquivalence(TrackerTarget)(family.coverage.target, context.configuration.target))
    return yield* sourceRejected()
  /* v8 ignore next -- @preserve Complete graph schema rejects identity or membership family target substitution. */
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
  if ("lifecycles" in family) {
    /* v8 ignore next -- @preserve Complete graph schema rejects duplicate lifecycle subjects before fixture validation. */
    if (new Set(family.lifecycles.map(({ taskId }) => taskId)).size !== family.lifecycles.length)
      return yield* sourceRejected()
    yield* Effect.forEach(family.lifecycles, (row) => {
      if (row.taskId === context.taskId)
        return validateTask(
          { id: row.taskId, lifecycle: row.lifecycle, parentTaskId: null, prerequisiteIds: [] },
          context
        )
      return validateTask(
        { id: row.taskId, lifecycle: row.lifecycle, parentTaskId: context.taskId, prerequisiteIds: [context.taskId] },
        context
      )
    })
  }
  /* v8 ignore next -- @preserve Complete graph schema rejects duplicate prerequisite rows before fixture validation. */
  if (
    "prerequisites" in family &&
    new Set(family.prerequisites.map(({ taskId }) => taskId)).size !== family.prerequisites.length
  )
    return yield* sourceRejected()
  if (
    "prerequisites" in family &&
    family.prerequisites.some(
      (row) =>
        (row.taskId === context.taskId && row.prerequisiteTaskIds.length !== 0) ||
        (row.taskId === context.dependantTaskId &&
          (row.prerequisiteTaskIds.length !== 1 || row.prerequisiteTaskIds[0] !== context.taskId)) ||
        (row.taskId !== context.taskId && row.taskId !== context.dependantTaskId)
    )
  )
    return yield* sourceRejected()
  /* v8 ignore next -- @preserve Complete graph schema rejects duplicate grouping rows before fixture validation. */
  if ("groupings" in family && new Set(family.groupings.map(({ taskId }) => taskId)).size !== family.groupings.length)
    return yield* sourceRejected()
  if (
    "groupings" in family &&
    family.groupings.some(
      (row) =>
        (row.taskId === context.taskId && row.parentTaskId !== null) ||
        (row.taskId === context.dependantTaskId && row.parentTaskId !== context.taskId) ||
        (row.taskId !== context.taskId && row.taskId !== context.dependantTaskId)
    )
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
    /* v8 ignore next -- @preserve ReleaseTaskClaim schema admits only its workflow release authority. */
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
  if ("taskId" in operation && !isQualificationTaskId(operation.taskId, context)) return yield* sourceRejected()
  if ("target" in operation && !Schema.toEquivalence(TrackerTarget)(operation.target, context.configuration.target))
    return yield* sourceRejected()
  if (operation._tag !== "ReadTrackerGraph") return
  if (operation.readShape.explicitlyCoveredTaskIds.some((id) => !isQualificationTaskId(id, context)))
    return yield* sourceRejected()
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

export const completionClaimOfProposal = (
  proposal: DeliveryActionProposal
):
  | Extract<
      Extract<DeliveryActionProposal["route"], { readonly _tag: "IdentityFreeWorkflowRoute" }>["transition"],
      { readonly _tag: "CompletePromotedTask" }
    >["request"]["claim"]
  | null => {
  if (proposal.route._tag !== "IdentityFreeWorkflowRoute") return null
  const transition = proposal.route.transition
  if (
    transition._tag === "ReplacePromotedTaskClaim" ||
    transition._tag === "CompletePromotedTask" ||
    transition._tag === "ObserveFocusedTaskCompletion" ||
    transition._tag === "DeleteCompletedTaskCompletionClaim"
  )
    return transition.request.claim
  return null
}

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
  /* v8 ignore next -- @preserve CompletionTaskRequest schema reconstructs its exact immutable identity before this comparison. */
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
  if (!Schema.toEquivalence(TrackerTarget)(success.target, context.configuration.target)) return yield* sourceRejected()
  const revision = yield* githubFocusedCompletionRevisionFor({
    currentClaim: claim,
    lifecycle: success.lifecycle,
    target: success.target,
    targetMembership: "Member",
    taskId: success.taskId,
    taskRevision: success.taskRevision,
    unfinishedPrerequisiteTaskIds: []
  }).pipe(Effect.mapError(sourceRejected))
  if (success.trackerRevision !== revision) return yield* sourceRejected()
  const expected = completionClaimDeletionRequestFor(claim, success)
  if (!Schema.toEquivalence(CompletionClaimDeletionRequest)(decoded, expected)) return yield* sourceRejected()
  return expected
})
