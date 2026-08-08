import { it } from "@effect/vitest"
import { defineDriver, stateCheck } from "@firfi/quint-connect/effect"
import { quintIt } from "@firfi/quint-connect/vitest"
import {
  AttemptId,
  GitCommitSha,
  PlannedTaskAttempt,
  RunId,
  TaskBranchRef,
  TaskExecutorLocator,
  TaskId,
  TaskRevision,
  WorktreeLocator
} from "@dalph/contracts"
import {
  ActiveTaskClaim,
  ClaimOwner,
  ClaimToken,
  deriveRunnableFrontier,
  JournalPosition,
  makeTaskClaimReleaseOperation,
  OperationId,
  ResponsibilityDisposition,
  TaskClaimReacquisitionRequestId
} from "@dalph/orchestrator"
import { Effect, Schema } from "effect"

const plannedAttempt = PlannedTaskAttempt.make({
  attemptId: AttemptId.make("task-facts-attempt"),
  baseSha: GitCommitSha.make("2".repeat(40)),
  branch: TaskBranchRef.make("refs/heads/dalph/task-facts-attempt"),
  executor: TaskExecutorLocator.make("executor:model"),
  runId: RunId.make("task-facts-run"),
  taskId: TaskId.make("task-facts-task"),
  taskRevision: TaskRevision.make("planned-fingerprint"),
  worktree: WorktreeLocator.make("/worktrees/task-facts-attempt")
})
const responsibility = {
  _tag: "PlannedAttemptExecutorWorkResponsibility" as const,
  beganAt: JournalPosition.make(1),
  plannedAttempt
}
const acceptedProgress = { _tag: "ExecutorResponsibilityBegan" as const, acceptedAt: responsibility.beganAt }
const independentTask = {
  taskId: TaskId.make("task-facts-independent-C"),
  taskRevision: TaskRevision.make("independent-fingerprint")
}
const exactClaim = ActiveTaskClaim.make({
  operationId: OperationId.make("acquire-task-facts-claim"),
  owner: ClaimOwner.make("task-facts-owner"),
  taskId: plannedAttempt.taskId,
  token: ClaimToken.make("task-facts-token")
})
const exactRelease = makeTaskClaimReleaseOperation({
  predecessorOperationIds: [exactClaim.operationId],
  release: { claim: exactClaim, operationId: OperationId.make("release-task-facts-claim") }
})

type Constraint =
  | "NoConstraint"
  | "MembershipConstraint"
  | "LifecycleConstraint"
  | "SpecificationConstraint"
  | "ExternalSuccessConstraint"
  | "MissingClaimConstraint"
  | "ForeignClaimConstraint"
  | "UnreadableClaimConstraint"
type Status = "Running" | "SafelySuspended"
type ClaimState = "ExactClaim" | "MissingClaim" | "ForeignClaim" | "UnreadableClaim" | "ReplacementClaim"

const SpecProjection = Schema.Struct({
  state: Schema.Struct({
    constraint: Schema.Unknown,
    claimState: Schema.Unknown,
    decision: Schema.Unknown,
    dependantsReleasedByFreshGraph: Schema.Boolean,
    duplicateDeliveryPrevented: Schema.Boolean,
    exactClaimHeld: Schema.Boolean,
    lastClaimMutationTarget: Schema.Unknown,
    independentTaskEligible: Schema.Boolean,
    independentTaskSelected: Schema.Boolean,
    originalClaimIdentity: Schema.Unknown,
    currentClaimIdentity: Schema.Unknown,
    positionHeld: Schema.Boolean,
    reacquisitionDirectionApplied: Schema.Boolean,
    replacementIntentRecorded: Schema.Boolean,
    status: Schema.Unknown,
    wipPreserved: Schema.Boolean
  })
})

const variantTag = (value: unknown): string =>
  typeof value === "object" && value !== null && "tag" in value ? String(value.tag) : String(value)

const quintInt = (value: unknown): number =>
  typeof value === "object" && value !== null && "#bigint" in value ? Number(value["#bigint"]) : Number(value)

const decisionFromProductionFrontier = (
  constraint: Constraint,
  status: Status,
  exactClaimHeld: boolean,
  reacquisitionDirectionApplied: boolean,
  replacementIntentRecorded: boolean
): string => {
  if (replacementIntentRecorded && constraint === "MissingClaimConstraint") return "ObserveReplacementClaim"
  const disposition =
    status === "Running" && constraint !== "NoConstraint"
      ? ResponsibilityDisposition.PlannedAttemptExecutorSuspensionRequested()
      : constraint === "MissingClaimConstraint" && reacquisitionDirectionApplied
        ? ResponsibilityDisposition.AppliedTaskClaimReacquisitionDirection({
            requestId: TaskClaimReacquisitionRequestId.make("task-facts-reacquisition")
          })
        : constraint === "NoConstraint"
          ? { _tag: "Ready" as const, acceptedProgress }
          : constraint === "MembershipConstraint"
            ? ResponsibilityDisposition.TaskMembershipConstraint()
            : constraint === "LifecycleConstraint"
              ? ResponsibilityDisposition.TaskLifecycleConstraint({ lifecycle: "TerminalWithoutSuccess" })
              : constraint === "SpecificationConstraint"
                ? ResponsibilityDisposition.TaskSpecificationChangeConstraint({
                    observedFingerprint: TaskRevision.make("observed-fingerprint"),
                    plannedFingerprint: plannedAttempt.taskRevision
                  })
                : constraint === "MissingClaimConstraint"
                  ? ResponsibilityDisposition.TaskClaimMissingConstraint()
                  : constraint === "ForeignClaimConstraint"
                    ? ResponsibilityDisposition.TaskForeignClaimIsolation()
                    : constraint === "UnreadableClaimConstraint"
                      ? ResponsibilityDisposition.TaskClaimUnreadableWait()
                      : exactClaimHeld
                        ? ResponsibilityDisposition.TaskExternalSuccessReleaseNeeded({ operation: exactRelease })
                        : ResponsibilityDisposition.TaskExternalSuccessSettled()
  const frontier = deriveRunnableFrontier({
    freshEligibleTasks: [],
    responsibility: { entries: [responsibility] },
    responsibilityFacts: [{ _tag: "PlannedAttemptExecutorFreshFacts", disposition, responsibility }]
  })
  const transition = frontier.transitions[0]
  if (transition?._tag === "ContinuePlannedAttemptExecutorWork") return "ContinueWork"
  if (transition?._tag === "SuspendPlannedAttemptExecutorWork") return "RequestSafeSuspension"
  if (transition?._tag === "ReleaseExternallyCompletedTaskClaim") return "ReleaseExactClaim"
  if (transition?._tag === "CommitTaskClaimReacquisitionIntent") return "AllocateReplacementClaim"
  const explanation = frontier.explanations[0]
  if (explanation?._tag === "PlannedAttemptTaskMembershipConstraint") return "MembershipWait"
  if (explanation?._tag === "PlannedAttemptTaskLifecycleConstraint") return "LifecycleWait"
  if (explanation?._tag === "PlannedAttemptTaskSpecificationChangeConstraint") {
    if (
      explanation.availableResolutions.join(",") !==
      "ContinueExistingAttempt,RestartTaskImplementation,StopTaskImplementation"
    ) {
      throw new Error("production frontier did not expose the three exact specification-change choices")
    }
    return "SpecificationChoices"
  }
  if (explanation?._tag === "PlannedAttemptTaskExternalSuccessSettled") return "ExternalSuccessSettled"
  if (explanation?._tag === "PlannedAttemptTaskClaimConstraint") {
    if (explanation.claimState === "Missing") return "MissingClaimWait"
    if (explanation.claimState === "Foreign") return "ForeignClaimWait"
    return "UnreadableClaimWait"
  }
  throw new Error("production frontier did not derive one task-fact reconciliation decision")
}

const taskFactReconciliationDriver = defineDriver(
  {
    init: {},
    observeExternalSuccess: {},
    observeFreshLifecycleReopen: {},
    observeIncompleteMembershipRead: {},
    observeMissingClaim: {},
    observeForeignClaim: {},
    observeUnreadableClaim: {},
    observeLifecycleClosure: {},
    observeMembershipLoss: {},
    observeSpecificationChange: {},
    observeExactReplacementClaim: {},
    planReplacementClaim: {},
    applyForeignClaimReacquisitionDirection: {},
    applyMissingClaimReacquisitionDirection: {},
    rejectForeignClaimReacquisition: {},
    requestOwnedClaimMutation: {},
    releaseExactClaim: {},
    reportSafelySuspended: {},
    selectIndependentTask: {}
  },
  () => {
    let constraint: Constraint = "NoConstraint"
    let status: Status = "Running"
    let exactClaimHeld = true
    let dependantsReleasedByFreshGraph = false
    let duplicateDeliveryPrevented = false
    let claimState: ClaimState = "ExactClaim"
    let reacquisitionDirectionApplied = false
    let replacementIntentRecorded = false
    let lastClaimMutationTarget = "NoClaimMutation"
    let independentTaskSelected = false
    let currentClaimIdentity = 1
    const observe = (next: Exclude<Constraint, "NoConstraint">) =>
      Effect.sync(() => {
        constraint = next
        if (next === "ExternalSuccessConstraint") {
          dependantsReleasedByFreshGraph = true
          duplicateDeliveryPrevented = true
        }
      })
    return {
      init: () =>
        Effect.sync(() => {
          constraint = "NoConstraint"
          status = "Running"
          exactClaimHeld = true
          dependantsReleasedByFreshGraph = false
          duplicateDeliveryPrevented = false
          claimState = "ExactClaim"
          reacquisitionDirectionApplied = false
          replacementIntentRecorded = false
          lastClaimMutationTarget = "NoClaimMutation"
          independentTaskSelected = false
          currentClaimIdentity = 1
        }),
      observeExternalSuccess: () => observe("ExternalSuccessConstraint"),
      observeFreshLifecycleReopen: () =>
        Effect.sync(() => {
          constraint = "NoConstraint"
        }),
      observeIncompleteMembershipRead: () => Effect.void,
      observeMissingClaim: () =>
        Effect.sync(() => {
          constraint = "MissingClaimConstraint"
          claimState = "MissingClaim"
          exactClaimHeld = false
        }),
      observeForeignClaim: () =>
        Effect.sync(() => {
          constraint = "ForeignClaimConstraint"
          claimState = "ForeignClaim"
          exactClaimHeld = false
          lastClaimMutationTarget = "NoClaimMutation"
        }),
      observeUnreadableClaim: () =>
        Effect.sync(() => {
          constraint = "UnreadableClaimConstraint"
          claimState = "UnreadableClaim"
        }),
      observeLifecycleClosure: () => observe("LifecycleConstraint"),
      observeMembershipLoss: () => observe("MembershipConstraint"),
      observeSpecificationChange: () => observe("SpecificationConstraint"),
      observeExactReplacementClaim: () =>
        Effect.sync(() => {
          constraint = "NoConstraint"
        }),
      planReplacementClaim: () =>
        Effect.sync(() => {
          claimState = "ReplacementClaim"
          exactClaimHeld = true
          replacementIntentRecorded = true
          currentClaimIdentity = 2
        }),
      applyForeignClaimReacquisitionDirection: () =>
        Effect.sync(() => {
          reacquisitionDirectionApplied = true
        }),
      applyMissingClaimReacquisitionDirection: () =>
        Effect.sync(() => {
          reacquisitionDirectionApplied = true
        }),
      rejectForeignClaimReacquisition: () => Effect.void,
      requestOwnedClaimMutation: () =>
        Effect.sync(() => {
          lastClaimMutationTarget = "OwnedClaimMutation"
        }),
      releaseExactClaim: () =>
        Effect.sync(() => {
          exactClaimHeld = false
        }),
      reportSafelySuspended: () =>
        Effect.sync(() => {
          status = "SafelySuspended"
        }),
      selectIndependentTask: () =>
        Effect.sync(() => {
          const disposition =
            constraint === "MissingClaimConstraint"
              ? ResponsibilityDisposition.TaskClaimMissingConstraint()
              : constraint === "ForeignClaimConstraint"
                ? ResponsibilityDisposition.TaskForeignClaimIsolation()
                : ResponsibilityDisposition.TaskClaimUnreadableWait()
          const frontier = deriveRunnableFrontier({
            freshEligibleTasks: [independentTask],
            responsibility: { entries: [responsibility] },
            responsibilityFacts: [{ _tag: "PlannedAttemptExecutorFreshFacts", disposition, responsibility }]
          })
          independentTaskSelected = frontier.transitions.some(
            (transition) =>
              transition._tag === "CommitFreshTaskClaimIntent" && transition.taskId === independentTask.taskId
          )
        }),
      getState: () =>
        Effect.sync(() => ({
          constraint,
          claimState,
          decision: decisionFromProductionFrontier(
            constraint,
            status,
            exactClaimHeld,
            reacquisitionDirectionApplied,
            replacementIntentRecorded
          ),
          dependantsReleasedByFreshGraph,
          duplicateDeliveryPrevented,
          exactClaimHeld,
          lastClaimMutationTarget,
          independentTaskEligible: true,
          independentTaskSelected,
          originalClaimIdentity: 1,
          currentClaimIdentity,
          positionHeld: status === "Running",
          reacquisitionDirectionApplied,
          replacementIntentRecorded,
          status,
          wipPreserved: true
        }))
    }
  }
)

quintIt(
  it.effect,
  "replays changed task facts through the production frontier decision",
  {
    backend: "typescript",
    driverFactory: taskFactReconciliationDriver,
    maxSteps: 16,
    nTraces: 100,
    seed: "136",
    spec: "specs/taskFactReconciliation.qnt",
    stateCheck: stateCheck(
      (raw) =>
        Schema.decodeUnknownEffect(SpecProjection)(raw).pipe(
          Effect.map(({ state }) => ({
            ...state,
            claimState: variantTag(state.claimState),
            constraint: variantTag(state.constraint),
            currentClaimIdentity: quintInt(state.currentClaimIdentity),
            decision: variantTag(state.decision),
            lastClaimMutationTarget: variantTag(state.lastClaimMutationTarget),
            originalClaimIdentity: quintInt(state.originalClaimIdentity),
            status: variantTag(state.status)
          })),
          Effect.orDie
        ),
      (spec, implementation) =>
        spec.constraint === implementation.constraint &&
        spec.claimState === implementation.claimState &&
        spec.decision === implementation.decision &&
        spec.dependantsReleasedByFreshGraph === implementation.dependantsReleasedByFreshGraph &&
        spec.duplicateDeliveryPrevented === implementation.duplicateDeliveryPrevented &&
        spec.exactClaimHeld === implementation.exactClaimHeld &&
        spec.lastClaimMutationTarget === implementation.lastClaimMutationTarget &&
        spec.independentTaskEligible === implementation.independentTaskEligible &&
        spec.independentTaskSelected === implementation.independentTaskSelected &&
        spec.originalClaimIdentity === implementation.originalClaimIdentity &&
        spec.currentClaimIdentity === implementation.currentClaimIdentity &&
        spec.positionHeld === implementation.positionHeld &&
        spec.reacquisitionDirectionApplied === implementation.reacquisitionDirectionApplied &&
        spec.replacementIntentRecorded === implementation.replacementIntentRecorded &&
        spec.status === implementation.status &&
        spec.wipPreserved === implementation.wipPreserved
    )
  },
  30_000
)
