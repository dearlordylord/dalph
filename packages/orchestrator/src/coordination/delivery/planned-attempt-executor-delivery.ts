import type { plannedAttemptExecutorCorrelation } from "@dalph/contracts"
import { Effect } from "effect"
import {
  acceptPendingPlannedAttemptExecutorObservationWithPermit,
  type observePlannedAttemptExecutorStateResultWithPermit,
  type PlannedAttemptExecutorObservationResult,
  reconcileOrObservePlannedAttemptExecutorStateResultWithPermit
} from "../../workflow/protocols/planned-attempt-executor-work/protocol.js"
import {
  resumePlannedAttemptExecutorWorkWithPermit,
  requestPlannedAttemptExecutorSuspensionWithPermit
} from "../../workflow/protocols/planned-attempt-executor-work/suspension-commands.js"
import { authorizePlannedAttemptContinuationWithPermit } from "../../workflow/protocols/planned-attempt-continuation/protocol.js"
import { runPlannedAttemptExecutorResumeRedelivery } from "../../workflow/protocols/planned-attempt-executor-work/resume-redelivery.js"
import {
  PassivePlannedAttemptObserver,
  PassivePlannedAttemptProjectionPublication
} from "../run/passive-planned-attempt-observer.js"
import type { PlannedAttemptProtocolPermit } from "../../workflow/protocols/planned-attempt-executor-work/protocol-controller.js"
import type { SafeContinuationRevalidationEligibility } from "../frontier/fresh-facts.js"
import type {
  DeliveryActionExecutionLease,
  DeliveryActionProtocolAdmissionMissing
} from "./delivery-action-executor.js"
import type { ExecutorTransition } from "./planned-attempt-delivery-action-adapter.js"

type ExecutorReportProtocolEffect =
  | ReturnType<typeof authorizePlannedAttemptContinuationWithPermit>
  | ReturnType<typeof observeOrAttachPassiveOwner>
  | ReturnType<typeof reconcileOrObservePlannedAttemptExecutorStateResultWithPermit>
  | ReturnType<typeof resumePlannedAttemptExecutorWorkWithPermit>
  | ReturnType<typeof runPlannedAttemptExecutorResumeRedelivery>

type ExecutorReportEffect = Effect.Effect<
  PlannedAttemptExecutorObservationResult,
  Effect.Error<ExecutorReportProtocolEffect> | DeliveryActionProtocolAdmissionMissing,
  Effect.Services<ExecutorReportProtocolEffect>
>

export const observeOrAttachPassiveOwner = Effect.fn("DeliveryAction.observeOrAttachPassiveOwner")(function* (
  permit: PlannedAttemptProtocolPermit,
  plannedAttempt: Parameters<typeof observePlannedAttemptExecutorStateResultWithPermit>[1]
) {
  const observer = yield* PassivePlannedAttemptObserver
  const pending = yield* acceptPendingPlannedAttemptExecutorObservationWithPermit(permit, plannedAttempt)
  if (pending !== undefined) return pending
  const publication = yield* PassivePlannedAttemptProjectionPublication
  return yield* observer.attach({
    plannedAttempt,
    publishCurrent: (projection) => publication.publishWithPermit(permit, plannedAttempt, projection),
    publishChange: (projection) => publication.publish(plannedAttempt, projection).pipe(Effect.asVoid)
  })
})

const suspendAndObserveIfExecuting = Effect.fn("DeliveryAction.suspendAndObserveIfExecuting")(function* (
  permit: PlannedAttemptProtocolPermit,
  plannedAttempt: Parameters<typeof requestPlannedAttemptExecutorSuspensionWithPermit>[1]
) {
  const report = yield* requestPlannedAttemptExecutorSuspensionWithPermit(permit, plannedAttempt)
  if (report._tag !== "ExecutorWorkExecuting") return report
  return (yield* observeOrAttachPassiveOwner(permit, plannedAttempt)).report
})

export const executorReportFor = (
  transition: ExecutorTransition,
  correlation: ReturnType<typeof plannedAttemptExecutorCorrelation>,
  lease: DeliveryActionExecutionLease,
  eligibility: SafeContinuationRevalidationEligibility | undefined
): ExecutorReportEffect =>
  transition._tag === "ResumePlannedAttemptExecutorWorkAfterCurrentFacts"
    ? lease.withPlannedAttemptProtocol(correlation, (permit) =>
        Effect.gen(function* () {
          const report = yield* eligibility?.basis._tag === "ReconciledResumeStillSafe"
            ? runPlannedAttemptExecutorResumeRedelivery(
                permit,
                transition.plannedAttempt,
                eligibility,
                transition.witness,
                (receipt) => lease.bindPlannedAttemptPosition(transition.plannedAttempt, undefined, receipt)
              )
            : authorizePlannedAttemptContinuationWithPermit(permit, transition.plannedAttempt, transition.witness).pipe(
                Effect.andThen(
                  resumePlannedAttemptExecutorWorkWithPermit(
                    permit,
                    transition.plannedAttempt,
                    undefined,
                    eligibility === undefined
                      ? undefined
                      : (receipt) => lease.bindPlannedAttemptPosition(transition.plannedAttempt, undefined, receipt)
                  )
                )
              )
          return { acceptedFacts: "Changed" as const, report }
        })
      )
    : transition._tag === "ObservePlannedAttemptExecutorWork"
      ? lease.withPlannedAttemptProtocol(correlation, (permit) =>
          observeOrAttachPassiveOwner(permit, transition.plannedAttempt)
        )
      : transition._tag === "ReconcilePlannedAttemptExecutorWork"
        ? lease.withPlannedAttemptProtocol(correlation, (permit) =>
            reconcileOrObservePlannedAttemptExecutorStateResultWithPermit(permit, transition.plannedAttempt)
          )
        : lease.withPlannedAttemptProtocol(correlation, (permit) =>
            suspendAndObserveIfExecuting(permit, transition.plannedAttempt).pipe(
              Effect.map((report) => ({ acceptedFacts: "Changed" as const, report }))
            )
          )
