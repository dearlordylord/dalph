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
  ResponsibilityDisposition
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
type Status = "Running" | "SafelySuspended"

const SpecProjection = Schema.Struct({
  state: Schema.Struct({
    constraint: Schema.Unknown,
    decision: Schema.Unknown,
    dependantsReleasedByFreshGraph: Schema.Boolean,
    duplicateDeliveryPrevented: Schema.Boolean,
    exactClaimHeld: Schema.Boolean,
    positionHeld: Schema.Boolean,
    status: Schema.Unknown,
    wipPreserved: Schema.Boolean
  })
})

const variantTag = (value: unknown): string =>
  typeof value === "object" && value !== null && "tag" in value ? String(value.tag) : String(value)

const decisionFromProductionFrontier = (constraint: Constraint, status: Status, exactClaimHeld: boolean): string => {
  const disposition =
    status === "Running" && constraint !== "NoConstraint"
      ? ResponsibilityDisposition.PlannedAttemptExecutorSuspensionRequested()
      : constraint === "NoConstraint"
        ? ResponsibilityDisposition.Ready()
        : constraint === "MembershipConstraint"
          ? ResponsibilityDisposition.TaskMembershipConstraint()
          : constraint === "LifecycleConstraint"
            ? ResponsibilityDisposition.TaskLifecycleConstraint({ lifecycle: "TerminalWithoutSuccess" })
            : constraint === "SpecificationConstraint"
              ? ResponsibilityDisposition.TaskSpecificationChangeConstraint({
                  observedFingerprint: TaskRevision.make("observed-fingerprint"),
                  plannedFingerprint: plannedAttempt.taskRevision
                })
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
  throw new Error("production frontier did not derive one task-fact reconciliation decision")
}

const taskFactReconciliationDriver = defineDriver(
  {
    init: {},
    observeExternalSuccess: {},
    observeFreshLifecycleReopen: {},
    observeIncompleteMembershipRead: {},
    observeLifecycleClosure: {},
    observeMembershipLoss: {},
    observeSpecificationChange: {},
    releaseExactClaim: {},
    reportSafelySuspended: {}
  },
  () => {
    let constraint: Constraint = "NoConstraint"
    let status: Status = "Running"
    let exactClaimHeld = true
    let dependantsReleasedByFreshGraph = false
    let duplicateDeliveryPrevented = false
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
        }),
      observeExternalSuccess: () => observe("ExternalSuccessConstraint"),
      observeFreshLifecycleReopen: () =>
        Effect.sync(() => {
          constraint = "NoConstraint"
        }),
      observeIncompleteMembershipRead: () => Effect.void,
      observeLifecycleClosure: () => observe("LifecycleConstraint"),
      observeMembershipLoss: () => observe("MembershipConstraint"),
      observeSpecificationChange: () => observe("SpecificationConstraint"),
      releaseExactClaim: () =>
        Effect.sync(() => {
          exactClaimHeld = false
        }),
      reportSafelySuspended: () =>
        Effect.sync(() => {
          status = "SafelySuspended"
        }),
      getState: () =>
        Effect.sync(() => ({
          constraint,
          decision: decisionFromProductionFrontier(constraint, status, exactClaimHeld),
          dependantsReleasedByFreshGraph,
          duplicateDeliveryPrevented,
          exactClaimHeld,
          positionHeld: status === "Running",
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
            constraint: variantTag(state.constraint),
            decision: variantTag(state.decision),
            status: variantTag(state.status)
          })),
          Effect.orDie
        ),
      (spec, implementation) =>
        spec.constraint === implementation.constraint &&
        spec.decision === implementation.decision &&
        spec.dependantsReleasedByFreshGraph === implementation.dependantsReleasedByFreshGraph &&
        spec.duplicateDeliveryPrevented === implementation.duplicateDeliveryPrevented &&
        spec.exactClaimHeld === implementation.exactClaimHeld &&
        spec.positionHeld === implementation.positionHeld &&
        spec.status === implementation.status &&
        spec.wipPreserved === implementation.wipPreserved
    )
  },
  30_000
)
