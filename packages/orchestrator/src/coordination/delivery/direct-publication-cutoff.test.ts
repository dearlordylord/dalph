import type { DeliveryActionProposal, IdentityFreeDeliveryProposal } from "./delivery-action-proposal.js"
import { it, expect } from "@effect/vitest"
import { makeTaskWorkSpecification } from "@dalph/contracts"
import { Cause, Deferred, Effect, Fiber, HashSet, Ref } from "effect"
import { completionTaskRequestFor } from "../../workflow/protocols/integration-finality/events.js"
import { integrationFinalityFixture } from "../../workflow/protocols/integration-finality/fixtures.js"
import { integratorCorrelationFor } from "../../workflow/protocols/integrator/session.js"
import { makeAcceptedIntegrationHistory } from "../../../test/support/accepted-integration-history.js"
import { makePromotedIntegrationHistory } from "../../../test/support/promoted-integration-history.js"
import { remotePublicationTargetForTest } from "../../../test/support/direct-publication.js"
import { makeFreshTaskAdmissionTestBasis } from "../../../test/support/fresh-task-admission.js"
import {
  RemotePublicationGit,
  RemotePublicationGitObservation,
  RemotePublicationPushResult
} from "../../workflow/protocols/direct-publication/events.js"
import {
  RemoteBaselineGit,
  RemoteBaselineObservation,
  LocalTargetCatchUpResult,
  remoteBaselineCorrelationFor
} from "../../workflow/protocols/direct-publication/baseline-events.js"
import { integratorResponsibilityFactsFor } from "../../workflow/protocols/integrator/state.js"
import { establishRemoteBaseline } from "../../workflow/protocols/direct-publication/baseline-protocol-engine.js"
import { StartedIntegrationResponsibility } from "../../workflow/protocols/integration-admission/protocol.js"
import { plannedAttemptProtocolControllerLayer } from "../../workflow/protocols/planned-attempt-executor-work/protocol-controller.js"
import { makeApplicationExitLifecycle } from "../application-exit/lifecycle.js"
import { makeIntegrationTargetResourceController } from "../admission/integration-target-resource.js"
import { RunnableFrontierTransition } from "../frontier/frontier.js"
import { makeDeliveryRuntimeAdmissionController } from "./delivery-runtime-admission.js"
import { deliveryProposalsOf } from "./delivery-proposal.js"
import { executeIntegrationAction } from "./integration-delivery-action-adapter.js"
import { liveJournalTestLayer } from "./live-journal-test-layer.js"
import { Journal } from "./journal.js"
import { reduceWorkflowJournalHistory } from "../reconstruction/history.js"
import { filterFrontierForActivePauses } from "../run/recovery-activation.js"
import {
  ControlDirectionApplication,
  controlDirectionApplicationLayer
} from "../../workflow/protocols/control-direction-application/protocol.js"
import type { DeliveryActionExecutionLease } from "./delivery-action-executor.js"

const isIdentityFreeProposal = (proposal: DeliveryActionProposal): proposal is IdentityFreeDeliveryProposal =>
  proposal.actionIdentity._tag === "NoWorkflowOperationIdentity"

const fixture = integrationFinalityFixture
const specification = makeTaskWorkSpecification({
  body: "Recover one exact direct publication across process loss.",
  taskId: fixture.taskId,
  title: "Direct publication recovery"
})
const plannedAttempt = { ...fixture.plannedAttempt, taskRevision: specification.fingerprint }
const accepted = makeAcceptedIntegrationHistory({
  acceptedResult: fixture.qualifiedCandidate.run.session.acceptedResult,
  activeClaim: fixture.activeClaim,
  integrationTarget: fixture.integrationTarget,
  plannedAttempt,
  runId: fixture.runId,
  targetHeadSha: fixture.qualifiedCandidate.run.session.expectedTargetHead,
  taskSpecification: specification,
  trackerTarget: fixture.target
})
const qualified = makePromotedIntegrationHistory({
  candidateCommit: fixture.qualifiedCandidate.candidateCommit,
  candidateText: fixture.qualifiedCandidate.candidateText,
  originalClaim: accepted.activeClaim,
  records: accepted.records,
  session: integratorCorrelationFor(accepted)
})
const candidate = qualified.qualifiedCandidate
const runId = candidate.run.session.plannedAttempt.runId
const target = remotePublicationTargetForTest

const responsibility = StartedIntegrationResponsibility.make({
  acceptedResult: candidate.run.session.acceptedResult,
  integrationTarget: fixture.integrationTarget,
  plannedAttempt,
  queuedAt: candidate.run.session.queuedAt,
  startedAt: candidate.run.session.startedAt
})

for (const cutoff of ["Exit", "Pause"] as const) {
  for (const boundary of ["observe", "observe-applied", "push"] as const) {
    it.effect(`${cutoff} during publication ${boundary} preserves produced proof and forbids subsequent work`, () =>
      Effect.gen(function* () {
        const entered = yield* Deferred.make<void>()
        const finish = yield* Deferred.make<void>()
        const calls = yield* Ref.make<ReadonlyArray<string>>([])
        const lifecycle = yield* makeApplicationExitLifecycle()
        const integrationTargets = yield* makeIntegrationTargetResourceController()
        yield* integrationTargets.acquire(responsibility)
        yield* integrationTargets.publishAcceptedOwnership(responsibility)
        const admission = yield* makeDeliveryRuntimeAdmissionController(
          makeFreshTaskAdmissionTestBasis({ capacity: 1 }),
          integrationTargets,
          lifecycle.admission
        )
        const transition = RunnableFrontierTransition.RunRemotePublication({ candidate, responsibility, target })
        const proposals = deliveryProposalsOf({
          acceptedOperationIds: HashSet.empty(),
          fresh: [],
          integrationResponsibilities: [responsibility],
          responsibilities: [],
          runId,
          transitions: [transition]
        })
        const proposal = [...proposals.ticketDelivery, ...proposals.deliverySettlement][0]
        if (proposal === undefined || !isIdentityFreeProposal(proposal))
          return yield* Effect.die("missing publication proposal")
        const admitted = yield* admission.tryReserve(proposal)
        if (admitted._tag === "Deferred") return yield* Effect.die(`publication deferred: ${admitted.reason}`)
        const owner = admitted.reservation.forwardOwner
        if (owner.kind !== "AtomicBoundary")
          return yield* Effect.die("publication must have its production atomic owner")
        const lease: DeliveryActionExecutionLease = {
          acceptIntegrationTargetOwnership: Effect.void,
          bindPlannedAttemptPosition: () => Effect.void,
          forwardBoundary: { _tag: "AtomicBoundary", execution: owner },
          integrationTargets,
          recordIntent: () => Effect.void,
          releasePlannedAttemptPosition: () => Effect.void,
          withPlannedAttemptProtocol: () => Effect.die("publication does not use attempt protocol")
        }
        const git = RemotePublicationGit.of({
          admit: () => Effect.die("already admitted"),
          observe: () =>
            Ref.update(calls, (xs) => [...xs, "observe"]).pipe(
              Effect.andThen(
                boundary !== "push"
                  ? Deferred.succeed(entered, undefined).pipe(Effect.andThen(Deferred.await(finish)))
                  : Effect.void
              ),
              Effect.as(
                boundary === "observe-applied"
                  ? RemotePublicationGitObservation.cases.CandidateCurrent.make({
                      remoteHead: candidate.candidateCommit
                    })
                  : RemotePublicationGitObservation.cases.RemoteAncestorOfCandidate.make({
                      remoteHead: candidate.run.session.expectedTargetHead
                    })
              )
            ),
          prepareSenderCustody: () => Ref.update(calls, (xs) => [...xs, "prepare"]),
          reconcileSenderCustody: () => Ref.update(calls, (xs) => [...xs, "reconcile"]),
          push: () =>
            Ref.update(calls, (xs) => [...xs, "push"]).pipe(
              Effect.andThen(
                boundary === "push"
                  ? Deferred.succeed(entered, undefined).pipe(Effect.andThen(Deferred.await(finish)))
                  : Effect.void
              ),
              Effect.as(RemotePublicationPushResult.cases.Applied.make({ remoteHead: candidate.candidateCommit }))
            )
        })
        const action = yield* executeIntegrationAction(
          { _tag: "IdentityFreeAction", proposal },
          transition,
          lease,
          fixture.target
        ).pipe(
          Effect.provideService(RemotePublicationGit, git),
          Effect.provideService(
            RemoteBaselineGit,
            RemoteBaselineGit.of({
              observe: () => Effect.die("unused"),
              catchUp: () => Effect.die("unused"),
              reconcileCatchUp: () => Effect.die("unused")
            })
          ),
          Effect.exit,
          Effect.forkChild
        )
        yield* Deferred.await(entered).pipe(
          Effect.raceFirst(
            Fiber.join(action).pipe(
              Effect.flatMap((exit) =>
                Effect.die(
                  `publication ended before boundary: ${exit._tag === "Failure" ? Cause.pretty(exit.cause) : "success"}`
                )
              )
            )
          )
        )
        if (cutoff === "Exit") yield* lifecycle.requestExit
        else {
          const control = yield* ControlDirectionApplication
          const applied = yield* control.apply({ direction: "Pause", subject: { _tag: "Run", runId } })
          expect(applied.event._tag).toBe("ControlDirectionApplied")
        }
        yield* Deferred.succeed(finish, undefined)
        yield* Fiber.join(action)
        yield* admission.complete(admitted.reservation)
        if (cutoff === "Exit") yield* lifecycle.awaitForwardOwnersReleased
        expect(yield* Ref.get(calls)).toEqual(
          boundary === "observe"
            ? ["observe"]
            : boundary === "observe-applied"
              ? ["observe", "prepare"]
              : ["observe", "prepare", "push"]
        )
        const journal = yield* Journal
        const records = yield* journal.read(runId)
        expect(records.filter(({ event }) => event._tag === "RemotePublicationAttemptIntended")).toHaveLength(
          boundary === "observe" ? 0 : 1
        )
        expect(records.filter(({ event }) => event._tag === "RemotePublicationSucceeded")).toHaveLength(
          boundary === "observe" ? 0 : 1
        )
        expect(
          records.some(
            ({ event }) => event._tag === "TargetPromotionIntended" || event._tag === "CompletionTaskAttemptIntended"
          )
        ).toBe(false)
        if (cutoff === "Exit") expect((yield* admission.tryReserve(proposal).pipe(Effect.exit))._tag).toBe("Failure")
        else {
          const history = reduceWorkflowJournalHistory(runId, records)
          if (history._tag === "InvalidWorkflowJournalHistory") return yield* Effect.die("invalid post-cutoff history")
          const publication = records.findLast(({ event }) => event._tag === "RemotePublicationSucceeded")?.event
          const successors =
            publication?._tag === "RemotePublicationSucceeded"
              ? [
                  transition,
                  RunnableFrontierTransition.RunTargetPromotion({ candidate, responsibility, publication }),
                  RunnableFrontierTransition.CompletePromotedTask({
                    responsibility,
                    request: completionTaskRequestFor(fixture.claim)
                  })
                ]
              : [transition]
          const selected = filterFrontierForActivePauses(
            { transitions: successors, explanations: [] },
            history.runState,
            undefined,
            new Set(),
            new Set()
          )
          expect(selected.transitions).toEqual([])
        }
      }).pipe(
        Effect.provide(controlDirectionApplicationLayer),
        Effect.provide(liveJournalTestLayer({ runId, target: fixture.target, records: qualified.qualifiedRecords })),
        Effect.provide(plannedAttemptProtocolControllerLayer)
      )
    )
  }
}

for (const cutoff of ["Exit", "Exit-produced", "Pause"] as const) {
  for (const boundary of ["observe", "catch-up"] as const) {
    it.effect(
      `${cutoff} during initial baseline ${boundary} preserves its exact intent and forbids later Git work`,
      () =>
        Effect.gen(function* () {
          const entered = yield* Deferred.make<void>()
          const finish = yield* Deferred.make<void>()
          const calls = yield* Ref.make<ReadonlyArray<string>>([])
          const lifecycle = yield* makeApplicationExitLifecycle()
          const integrationTargets = yield* makeIntegrationTargetResourceController()
          yield* integrationTargets.acquire(responsibility)
          yield* integrationTargets.publishAcceptedOwnership(responsibility)
          const admission = yield* makeDeliveryRuntimeAdmissionController(
            makeFreshTaskAdmissionTestBasis({ capacity: 1 }),
            integrationTargets,
            lifecycle.admission
          )
          const correlation = remoteBaselineCorrelationFor(
            runId,
            integratorResponsibilityFactsFor(responsibility),
            responsibility.integrationTarget,
            target
          )
          const observed = RemoteBaselineObservation.cases.LocalAncestor.make({
            localHead: candidate.run.session.expectedTargetHead,
            remoteHead: candidate.candidateCommit
          })
          if (boundary === "catch-up") {
            const seeded = yield* establishRemoteBaseline(correlation).pipe(
              Effect.provideService(
                RemoteBaselineGit,
                RemoteBaselineGit.of({
                  observe: () => Effect.succeed(observed),
                  catchUp: () => Effect.die("one observation per activation"),
                  reconcileCatchUp: () => Effect.die("unexpected reconciliation")
                })
              )
            )
            expect(seeded._tag).toBe("CatchUpRequired")
          }
          const transition = RunnableFrontierTransition.EstablishRemoteBaseline({ correlation, responsibility })
          const proposals = deliveryProposalsOf({
            acceptedOperationIds: HashSet.empty(),
            fresh: [],
            integrationResponsibilities: [responsibility],
            responsibilities: [],
            runId,
            transitions: [transition]
          })
          const proposal = [...proposals.ticketDelivery, ...proposals.deliverySettlement][0]
          if (proposal === undefined || !isIdentityFreeProposal(proposal))
            return yield* Effect.die("missing baseline proposal")
          const admitted = yield* admission.tryReserve(proposal)
          if (admitted._tag === "Deferred") return yield* Effect.die(`baseline deferred: ${admitted.reason}`)
          const owner = admitted.reservation.forwardOwner
          if (owner.kind !== "InterruptibleBoundary") return yield* Effect.die("baseline requires interruptible owner")
          const lease: DeliveryActionExecutionLease = {
            acceptIntegrationTargetOwnership: Effect.void,
            bindPlannedAttemptPosition: () => Effect.void,
            forwardBoundary: {
              _tag: "InterruptibleBoundary",
              execution: {
                run: (intent, call, recordResult) =>
                  owner.run(intent, call, (result) =>
                    cutoff === "Exit-produced"
                      ? lifecycle.requestExit.pipe(Effect.andThen(recordResult(result)))
                      : recordResult(result)
                  )
              }
            },
            integrationTargets,
            recordIntent: () => Effect.void,
            releasePlannedAttemptPosition: () => Effect.void,
            withPlannedAttemptProtocol: () => Effect.die("unused attempt protocol")
          }
          const wait = Ref.update(calls, (xs) => [...xs, boundary]).pipe(
            Effect.andThen(Deferred.succeed(entered, undefined)),
            Effect.andThen(Deferred.await(finish))
          )
          const git = RemoteBaselineGit.of({
            observe: () =>
              boundary === "observe" ? wait.pipe(Effect.as(observed)) : Effect.die("repeated observation"),
            catchUp: () =>
              boundary === "catch-up"
                ? wait.pipe(
                    Effect.as(LocalTargetCatchUpResult.cases.Applied.make({ newHead: candidate.candidateCommit }))
                  )
                : Effect.die("started catch-up after observation"),
            reconcileCatchUp: () => Effect.die("unexpected reconciliation")
          })
          const action = yield* executeIntegrationAction(
            { _tag: "IdentityFreeAction", proposal },
            transition,
            lease,
            fixture.target
          ).pipe(
            Effect.provideService(RemoteBaselineGit, git),
            Effect.provideService(
              RemotePublicationGit,
              RemotePublicationGit.of({
                admit: () => Effect.die("unused"),
                observe: () => Effect.die("unused"),
                push: () => Effect.die("unused"),
                prepareSenderCustody: () => Effect.die("unused"),
                reconcileSenderCustody: () => Effect.die("unused")
              })
            ),
            Effect.exit,
            Effect.forkChild
          )
          yield* Deferred.await(entered).pipe(
            Effect.raceFirst(
              Fiber.join(action).pipe(Effect.flatMap((exit) => Effect.die(`baseline ended early: ${exit._tag}`)))
            )
          )
          if (cutoff === "Exit") yield* lifecycle.requestExit
          else if (cutoff === "Pause")
            yield* (yield* ControlDirectionApplication).apply({ direction: "Pause", subject: { _tag: "Run", runId } })
          if (cutoff !== "Exit") yield* Deferred.succeed(finish, undefined)
          const completed = yield* Fiber.join(action)
          expect(completed._tag).toBe(cutoff !== "Pause" ? "Failure" : "Success")
          yield* admission.complete(admitted.reservation)
          if (cutoff !== "Pause") yield* lifecycle.awaitForwardOwnersReleased
          expect(yield* Ref.get(calls)).toEqual([boundary])
          const records = yield* (yield* Journal).read(runId)
          expect(records.filter(({ event }) => event._tag === "RemoteBaselineReadIntended")).toHaveLength(1)
          expect(records.filter(({ event }) => event._tag === "RemoteBaselineObserved")).toHaveLength(
            boundary === "catch-up" || cutoff !== "Exit" ? 1 : 0
          )
          expect(records.filter(({ event }) => event._tag === "LocalTargetCatchUpIntended")).toHaveLength(
            boundary === "catch-up" ? 1 : 0
          )
          expect(records.filter(({ event }) => event._tag === "LocalTargetCatchUpObserved")).toHaveLength(
            boundary === "catch-up" && cutoff !== "Exit" ? 1 : 0
          )
          expect(
            records.some(
              ({ event }) =>
                event._tag === "RemotePublicationAttemptIntended" || event._tag === "TargetPromotionIntended"
            )
          ).toBe(false)
          if (cutoff === "Pause") {
            const history = reduceWorkflowJournalHistory(runId, records)
            if (history._tag === "InvalidWorkflowJournalHistory")
              return yield* Effect.die("invalid baseline cutoff history")
            expect(
              filterFrontierForActivePauses(
                { transitions: [transition], explanations: [] },
                history.runState,
                undefined,
                new Set(),
                new Set()
              ).transitions
            ).toEqual([])
          }
        }).pipe(
          Effect.provide(controlDirectionApplicationLayer),
          Effect.provide(liveJournalTestLayer({ runId, target: fixture.target, records: accepted.records })),
          Effect.provide(plannedAttemptProtocolControllerLayer)
        )
    )
  }
}
