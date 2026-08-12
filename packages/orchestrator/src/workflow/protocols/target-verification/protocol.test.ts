import { it } from "@effect/vitest"
import { acceptedResultFixture, evidenceReferenceFixture } from "../../../../test/support/evidence.js"
import { NodeServices } from "@effect/platform-node"
import { Deferred, Effect, Fiber, Layer, Ref } from "effect"
import { expect } from "vitest"
import {
  AttemptId,
  GitCommitSha,
  GitRepositoryLocator,
  IntegrationTarget,
  IntegrationTargetRef,
  PlannedTaskAttempt,
  RunId,
  TaskBranchRef,
  TaskExecutorLocator,
  TaskId,
  TaskRevision,
  WorktreeLocator
} from "@dalph/contracts"
import { JournalPosition, JournalRecordKey } from "../../../workflow-journal/identity.js"
import { InRunJournal, type JournalRecord } from "../../../workflow-journal/store.js"
import { workflowJournalEventVersion } from "../../kernel/event.js"
import {
  IntegrationCandidateConstructedEvent,
  IntegrationCandidateId,
  IntegrationCandidateResourceLocator,
  IntegrationSessionId
} from "../integration-candidate-construction/events.js"
import {
  EvidenceDigest,
  EvidenceReference,
  EvidenceStore,
  EvidenceStoreFailure,
  memoryEvidenceStoreLayer
} from "./evidence-store.js"
import {
  TargetVerificationArtifactName,
  TargetVerificationBoundary,
  TargetVerificationBoundaryFailure,
  TargetVerificationCorrelationContradictedEvent,
  TargetVerificationIntendedEvent,
  TargetVerificationPlanId,
  TargetVerificationPlan,
  TargetVerificationTerminal,
  targetVerificationCorrelationFor,
  type TargetVerificationCandidate
} from "./events.js"
import { decodeTargetVerificationManifest } from "./manifest.js"
import { runTargetVerification } from "./protocol.js"
import {
  type IntegrationHistoryIndexes,
  validateIntegrationHistoryRecord
} from "../../../coordination/reconstruction/integration-history.js"
import { makeTargetPromotionHistoryIndexes } from "../../../coordination/reconstruction/target-promotion-history.js"
import { StartedIntegrationResponsibility } from "../integration-admission/protocol.js"
import { makeIntegrationTargetResourceController } from "../../../coordination/admission/integration-target-resource.js"
import { defaultTaskWorkCapacity } from "../../../coordination/admission/capacity.js"
import { makeApplicationExitLifecycle } from "../../../coordination/application-exit/lifecycle.js"
import { RunnableFrontierTransition } from "../../../coordination/frontier/frontier.js"
import { deliveryProposalsOf } from "../../../coordination/delivery/delivery-proposal-derivation.js"
import { executeIntegrationAction } from "../../../coordination/delivery/integration-delivery-action-adapter.js"
import { makeDeliveryRuntimeAdmissionController } from "../../../coordination/delivery/delivery-runtime-admission.js"
import {
  makeDeliveryRuntimeLiveOwner,
  makeObservedDeliveryActionLease
} from "../../../coordination/delivery/delivery-runtime-observation.js"
import { plannedAttemptProtocolControllerLayer } from "../planned-attempt-executor-work/protocol-controller.js"
import { TargetVerificationRuntime } from "./runtime.js"
import type {
  DeliveryActionProposal,
  IdentityFreeDeliveryProposal
} from "../../../coordination/delivery/delivery-action-proposal.js"
import { FixtureTarget } from "../../../authorities/task-tracker/fixture/target.js"
const runId = RunId.make("verification-run")
const trackerTarget = FixtureTarget.make("verification-tracker-target")
const target = IntegrationTarget.make({
  repository: GitRepositoryLocator.make("/repositories/verification.git"),
  ref: IntegrationTargetRef.make("refs/heads/master")
})
const planId = TargetVerificationPlanId.make("repository-public-plan")
const plan = TargetVerificationPlan.make({ planId, target })
const plannedAttempt = PlannedTaskAttempt.make({
  attemptId: AttemptId.make("verification-attempt"),
  baseSha: GitCommitSha.make("1".repeat(40)),
  branch: TaskBranchRef.make("refs/heads/dalph/verification"),
  executor: TaskExecutorLocator.make("executor:verification"),
  runId,
  taskId: TaskId.make("verification-task"),
  taskRevision: TaskRevision.make("verification-revision"),
  worktree: WorktreeLocator.make("/worktrees/verification")
})
const candidate: TargetVerificationCandidate = {
  candidateCommit: GitCommitSha.make("4".repeat(40)),
  constructedAt: JournalPosition.make(11),
  correlation: {
    acceptanceManifest: evidenceReferenceFixture,
    acceptedResultCommit: GitCommitSha.make("3".repeat(40)),
    attemptId: AttemptId.make("verification-attempt"),
    candidateId: IntegrationCandidateId.make("verification-candidate"),
    candidateResource: IntegrationCandidateResourceLocator.make("/candidate/verification"),
    expectedTargetHead: GitCommitSha.make("2".repeat(40)),
    integrationSessionId: IntegrationSessionId.make("verification-session"),
    integrationTarget: target,
    runId
  },
  reviewManifest: evidenceReferenceFixture
}
const correlation = targetVerificationCorrelationFor(candidate, planId)
const responsibility = StartedIntegrationResponsibility.make({
  acceptedResult: acceptedResultFixture(candidate.correlation.acceptedResultCommit),
  integrationTarget: target,
  plannedAttempt,
  queuedAt: JournalPosition.make(8),
  startedAt: JournalPosition.make(9)
})
const artifact = (name: string, contents: string) => ({
  bytes: new TextEncoder().encode(contents),
  name: TargetVerificationArtifactName.make(name)
})

const constructedRecord: JournalRecord = {
  event: IntegrationCandidateConstructedEvent.make({
    candidateCommit: candidate.candidateCommit,
    correlation: candidate.correlation,
    gitObservationAt: JournalPosition.make(10),
    reviewManifest: candidate.reviewManifest,
    version: workflowJournalEventVersion
  }),
  key: JournalRecordKey.make("fixture:candidate-constructed"),
  position: candidate.constructedAt,
  runId
}

const testJournalLayer = (records: Ref.Ref<ReadonlyArray<JournalRecord>>) =>
  Layer.succeed(
    InRunJournal,
    InRunJournal.of({
      append: (requestedRunId, key, event) =>
        Ref.modify(records, (current) => {
          const existing = current.find((record) => record.key === key)
          if (existing !== undefined) return [Effect.succeed(existing), current] as const
          const record: JournalRecord = {
            event,
            key,
            position: JournalPosition.make(current.length + 12),
            runId: requestedRunId
          }
          return [Effect.succeed(record), [...current, record]] as const
        }).pipe(Effect.flatten),
      read: () => Ref.get(records)
    })
  )

const harness = <A, E>(
  boundary: Parameters<typeof TargetVerificationBoundary.of>[0],
  use: (
    records: Ref.Ref<ReadonlyArray<JournalRecord>>
  ) => Effect.Effect<A, E, InRunJournal | TargetVerificationBoundary | EvidenceStore>,
  evidenceLayer: Layer.Layer<EvidenceStore> = memoryEvidenceStoreLayer.pipe(Layer.provide(NodeServices.layer))
) =>
  Effect.gen(function* () {
    const records = yield* Ref.make<ReadonlyArray<JournalRecord>>([constructedRecord])
    return yield* use(records).pipe(
      Effect.provide(
        Layer.mergeAll(
          testJournalLayer(records),
          Layer.succeed(TargetVerificationBoundary, TargetVerificationBoundary.of(boundary)),
          evidenceLayer
        )
      )
    )
  }).pipe(Effect.provide(NodeServices.layer))

const isIdentityFreeProposal = (proposal: DeliveryActionProposal): proposal is IdentityFreeDeliveryProposal =>
  proposal.actionIdentity._tag === "NoWorkflowOperationIdentity"

const verificationActionFor = (started: StartedIntegrationResponsibility) => {
  const transition = RunnableFrontierTransition.RunTargetVerification({ candidate, plan, responsibility: started })
  const contributions = deliveryProposalsOf({
    acceptedOperationIds: new Set(),
    fresh: [],
    integrationResponsibilities: [started],
    runId,
    transitions: [transition]
  })
  const proposal = contributions.deliverySettlement[0] ?? contributions.ticketDelivery[0]
  if (proposal === undefined || !isIdentityFreeProposal(proposal)) {
    throw new Error("verification must derive one identity-free proposal")
  }
  return { action: { _tag: "IdentityFreeAction" as const, proposal }, transition }
}

it.effect("keeps another target usable while exact M verifies and releases only M's target when it settles", () =>
  Effect.gen(function* () {
    const invoked = yield* Deferred.make<void>()
    const finish = yield* Deferred.make<void>()
    yield* harness(
      {
        runOrResume: (request) =>
          Deferred.succeed(invoked, undefined).pipe(
            Effect.andThen(Deferred.await(finish)),
            Effect.as(
              TargetVerificationTerminal.cases.Passed.make({
                artifacts: [artifact("verification.log", "passed")],
                correlation: request
              })
            )
          )
      },
      () =>
        Effect.scoped(
          Effect.gen(function* () {
            const resources = yield* makeIntegrationTargetResourceController()
            const boundary = yield* TargetVerificationBoundary
            const evidenceStore = yield* EvidenceStore
            yield* resources.acquire(responsibility)
            yield* resources.publishAcceptedOwnership(responsibility)
            const { action, transition } = verificationActionFor(responsibility)
            expect(
              (yield* executeIntegrationAction(
                action,
                transition,
                {
                  acceptIntegrationTargetOwnership: Effect.void,
                  bindPlannedAttemptPosition: () => Effect.void,
                  forwardBoundary: { _tag: "AtomicBoundary", execution: { run: (effect) => effect } },
                  integrationTargets: resources,
                  recordIntent: () => Effect.void,
                  releasePlannedAttemptPosition: () => Effect.void,
                  withPlannedAttemptProtocol: () => Effect.die("unused planned-attempt protocol")
                },
                trackerTarget
              ).pipe(Effect.flip))._tag
            ).toBe("TargetVerificationRuntimeUnavailable")
            const running = yield* executeIntegrationAction(
              action,
              transition,
              {
                acceptIntegrationTargetOwnership: Effect.void,
                bindPlannedAttemptPosition: () => Effect.void,
                forwardBoundary: { _tag: "AtomicBoundary", execution: { run: (effect) => effect } },
                integrationTargets: resources,
                recordIntent: () => Effect.void,
                releasePlannedAttemptPosition: () => Effect.void,
                withPlannedAttemptProtocol: () => Effect.die("unused planned-attempt protocol")
              },
              trackerTarget
            ).pipe(
              Effect.provideService(
                TargetVerificationRuntime,
                TargetVerificationRuntime.of({ boundary, evidenceStore, plan })
              ),
              Effect.forkScoped
            )
            yield* Deferred.await(invoked)

            const otherTarget = IntegrationTarget.make({
              repository: GitRepositoryLocator.make("/repositories/other.git"),
              ref: IntegrationTargetRef.make("refs/heads/main")
            })
            const other = StartedIntegrationResponsibility.make({
              ...responsibility,
              integrationTarget: otherTarget,
              queuedAt: JournalPosition.make(20),
              startedAt: JournalPosition.make(21)
            })
            yield* resources.acquire(other)
            yield* resources.publishAcceptedOwnership(other)
            const laterSameTarget = StartedIntegrationResponsibility.make({
              ...responsibility,
              queuedAt: JournalPosition.make(30),
              startedAt: JournalPosition.make(31)
            })
            expect((yield* resources.acquire(laterSameTarget).pipe(Effect.flip))._tag).toBe(
              "IntegrationTargetResourceUnavailable"
            )

            yield* Deferred.succeed(finish, undefined)
            yield* Fiber.join(running)
            const snapshot = yield* resources.snapshot
            expect(snapshot.heldResponsibilityPositions.has(responsibility.queuedAt)).toBe(false)
            expect(snapshot.heldResponsibilityPositions.has(other.queuedAt)).toBe(true)
          })
        )
    )
  })
)

it.effect("replays the authored verification Exit cassette through production admission without a successor", () =>
  Effect.gen(function* () {
    const authored = [
      "VerificationBoundaryEntered",
      "ExitCutoffClosed",
      "TargetVerificationEvidenceSealed",
      "OwnerReleasedWithoutSuccessor"
    ] as const
    const recorded = yield* Ref.make<ReadonlyArray<(typeof authored)[number]>>([])
    const record = (entry: (typeof authored)[number]) => Ref.update(recorded, (entries) => [...entries, entry])
    const verificationEntered = yield* Deferred.make<void>()
    const verificationMayReturn = yield* Deferred.make<void>()
    return yield* harness(
      {
        runOrResume: (request) =>
          Effect.gen(function* () {
            yield* record("VerificationBoundaryEntered")
            yield* Deferred.succeed(verificationEntered, undefined)
            yield* Deferred.await(verificationMayReturn)
            return TargetVerificationTerminal.cases.Passed.make({
              artifacts: [artifact("exit-verification.log", "passed before the drain limit")],
              correlation: request
            })
          })
      },
      (records) =>
        Effect.scoped(
          Effect.gen(function* () {
            const resources = yield* makeIntegrationTargetResourceController()
            yield* resources.acquire(responsibility)
            yield* resources.publishAcceptedOwnership(responsibility)
            const lifecycle = yield* makeApplicationExitLifecycle()
            const admission = yield* makeDeliveryRuntimeAdmissionController(
              { capacity: defaultTaskWorkCapacity, held: [] },
              resources,
              lifecycle.admission
            ).pipe(Effect.provide(plannedAttemptProtocolControllerLayer))
            const { action, transition } = verificationActionFor(responsibility)
            const admitted = yield* admission.tryReserve(action.proposal)
            if (admitted._tag !== "Admitted") return yield* Effect.die("verification proposal was not admitted")
            expect(admitted.reservation.forwardOwner.kind).toBe("AtomicBoundary")
            const owner = yield* makeDeliveryRuntimeLiveOwner(admitted.reservation)
            const lease = makeObservedDeliveryActionLease(admission, resources, owner, Effect.void)
            const successors = yield* Ref.make(0)
            const boundary = yield* TargetVerificationBoundary
            const evidenceStore = yield* EvidenceStore
            const running = yield* executeIntegrationAction(action, transition, lease, trackerTarget).pipe(
              Effect.provideService(
                TargetVerificationRuntime,
                TargetVerificationRuntime.of({ boundary, evidenceStore, plan })
              ),
              Effect.andThen(Ref.update(successors, (count) => count + 1)),
              Effect.ensuring(owner.settle.pipe(Effect.andThen(admission.complete(admitted.reservation)))),
              Effect.forkScoped
            )

            yield* Deferred.await(verificationEntered)
            yield* lifecycle.requestExit
            yield* record("ExitCutoffClosed")
            yield* Deferred.succeed(verificationMayReturn, undefined)

            expect((yield* Fiber.await(running))._tag).toBe("Failure")
            expect(
              (yield* Ref.get(records)).some(({ event }) => event._tag === "TargetVerificationEvidenceSealed")
            ).toBe(true)
            yield* record("TargetVerificationEvidenceSealed")
            expect(yield* Ref.get(successors)).toBe(0)
            yield* lifecycle.awaitForwardOwnersReleased
            yield* record("OwnerReleasedWithoutSuccessor")
            expect(yield* Ref.get(recorded)).toEqual(authored)
          })
        )
    )
  })
)

it.effect("runs only the selected public wrapper and seals passing evidence for exact M", () =>
  harness(
    {
      runOrResume: () =>
        Effect.succeed(
          TargetVerificationTerminal.cases.Passed.make({
            artifacts: [artifact("z-verification.log", "all checks passed"), artifact("a-summary.txt", "passed")],
            correlation
          })
        )
    },
    (records) =>
      Effect.gen(function* () {
        const result = yield* runTargetVerification(candidate, plan)
        expect(result._tag).toBe("VerificationPassed")
        const history = yield* Ref.get(records)
        expect(history.map(({ event }) => event._tag)).toEqual([
          "IntegrationCandidateConstructed",
          "TargetVerificationIntended",
          "TargetVerificationEvidenceSealed"
        ])
        if (result._tag === "VerificationPassed") {
          const evidence = yield* EvidenceStore
          const manifest = yield* evidence.read(result.manifest)
          const decoded = yield* decodeTargetVerificationManifest(manifest, correlation.requestId)
          expect(decoded.correlation).toEqual(correlation)
          expect(decoded.outcome).toBe("Passed")
          expect(decoded.artifacts.map(({ name }) => name)).toEqual(["a-summary.txt", "z-verification.log"])
        }
      })
  )
)

it.effect("orders manifest artifacts independently of the host locale", () =>
  harness(
    {
      runOrResume: () =>
        Effect.succeed(
          TargetVerificationTerminal.cases.Passed.make({
            artifacts: [artifact("ä.log", "umlaut"), artifact("z.log", "zed"), artifact("a.log", "aye")],
            correlation
          })
        )
    },
    () =>
      Effect.gen(function* () {
        const result = yield* runTargetVerification(candidate, plan)
        if (result._tag !== "VerificationPassed") return yield* Effect.die("verification fixture did not pass")
        const evidence = yield* EvidenceStore
        const manifest = yield* evidence.read(result.manifest)
        const decoded = yield* decodeTargetVerificationManifest(manifest, correlation.requestId)
        expect(decoded.artifacts.map(({ name }) => name)).toEqual(["a.log", "z.log", "ä.log"])
      })
  )
)

it.effect("seals failed killed partial and timed-out diagnostics without passing evidence", () =>
  Effect.forEach(["Failed", "Killed", "Partial", "TimedOut"] as const, (outcome) =>
    harness(
      {
        runOrResume: () =>
          Effect.succeed(
            TargetVerificationTerminal.cases[outcome].make({
              artifacts: [artifact("diagnostic.log", outcome)],
              correlation
            })
          )
      },
      () =>
        Effect.gen(function* () {
          const result = yield* runTargetVerification(candidate, plan)
          expect(result._tag).toBe("VerificationStopped")
          if (result._tag === "VerificationStopped") expect(result.outcome).toBe(outcome)
        })
    )
  ).pipe(Effect.asVoid)
)

it.effect("reconciles a lost verification response by the same request identity", () =>
  Effect.gen(function* () {
    const calls = yield* Ref.make(0)
    yield* harness(
      {
        runOrResume: () =>
          Ref.getAndUpdate(calls, (value) => value + 1).pipe(
            Effect.flatMap((call) =>
              call === 0
                ? Effect.fail(
                    new TargetVerificationBoundaryFailure({
                      detail: "response lost after the wrapper settled",
                      requestId: correlation.requestId
                    })
                  )
                : Effect.succeed(
                    TargetVerificationTerminal.cases.Passed.make({
                      artifacts: [artifact("verification.log", "settled once")],
                      correlation
                    })
                  )
            )
          )
      },
      (records) =>
        Effect.gen(function* () {
          yield* Effect.exit(runTargetVerification(candidate, plan))
          const recovered = yield* runTargetVerification(candidate, plan)
          expect(recovered._tag).toBe("VerificationPassed")
          const settledAgain = yield* runTargetVerification(candidate, plan)
          expect(settledAgain._tag).toBe("VerificationPassed")
          expect(yield* Ref.get(calls)).toBe(2)
          expect(
            (yield* Ref.get(records)).filter(({ event }) => event._tag === "TargetVerificationIntended")
          ).toHaveLength(1)
        })
    )
  })
)

it.effect("records a contradiction and fails closed for a foreign wrapper result", () => {
  const foreign = { ...correlation, candidateCommit: GitCommitSha.make("5".repeat(40)) }
  return harness(
    {
      runOrResume: () =>
        Effect.succeed(
          TargetVerificationTerminal.cases.Passed.make({
            artifacts: [artifact("foreign.log", "wrong candidate")],
            correlation: foreign
          })
        )
    },
    (records) =>
      Effect.gen(function* () {
        const result = yield* runTargetVerification(candidate, plan)
        expect(result._tag).toBe("VerificationContradicted")
        expect((yield* Ref.get(records)).at(-1)?.event._tag).toBe("TargetVerificationCorrelationContradicted")
      })
  )
})

it.effect("fails closed when referenced evidence cannot be reread", () => {
  const unavailable = Layer.succeed(
    EvidenceStore,
    EvidenceStore.of({
      put: () => Effect.succeed(EvidenceReference.make({ byteLength: 1, digest: EvidenceDigest.make("a".repeat(64)) })),
      read: () =>
        Effect.fail(
          new EvidenceStoreFailure({ detail: "evidence object disappeared", operation: "EvidenceStore.read" })
        )
    })
  )
  return harness(
    {
      runOrResume: () =>
        Effect.succeed(
          TargetVerificationTerminal.cases.Passed.make({
            artifacts: [artifact("verification.log", "pass")],
            correlation
          })
        )
    },
    (records) =>
      Effect.gen(function* () {
        const resources = yield* makeIntegrationTargetResourceController()
        const boundary = yield* TargetVerificationBoundary
        const evidenceStore = yield* EvidenceStore
        yield* resources.acquire(responsibility)
        yield* resources.publishAcceptedOwnership(responsibility)
        const { action, transition } = verificationActionFor(responsibility)
        const failure = yield* executeIntegrationAction(
          action,
          transition,
          {
            acceptIntegrationTargetOwnership: Effect.void,
            bindPlannedAttemptPosition: () => Effect.void,
            forwardBoundary: { _tag: "AtomicBoundary", execution: { run: (effect) => effect } },
            integrationTargets: resources,
            recordIntent: () => Effect.void,
            releasePlannedAttemptPosition: () => Effect.void,
            withPlannedAttemptProtocol: () => Effect.die("unused planned-attempt protocol")
          },
          trackerTarget
        ).pipe(
          Effect.provideService(
            TargetVerificationRuntime,
            TargetVerificationRuntime.of({ boundary, evidenceStore, plan })
          ),
          Effect.flip
        )
        expect(failure).toBeInstanceOf(EvidenceStoreFailure)
        expect((yield* resources.snapshot).heldResponsibilityPositions.has(responsibility.queuedAt)).toBe(false)
        expect((yield* Ref.get(records)).some(({ event }) => event._tag === "TargetVerificationEvidenceSealed")).toBe(
          false
        )
      }),
    unavailable
  )
})

it.effect("fails closed when a reread manifest differs from the bytes Dalph stored", () => {
  const inconsistent = Layer.effect(
    EvidenceStore,
    Effect.gen(function* () {
      const objects = yield* Ref.make<ReadonlyMap<string, Uint8Array>>(new Map())
      const nextId = yield* Ref.make(0)
      return EvidenceStore.of({
        put: (bytes) =>
          Ref.getAndUpdate(nextId, (value) => value + 1).pipe(
            Effect.flatMap((id) => {
              const digest = EvidenceDigest.make((id + 1).toString(16).padStart(64, "0"))
              return Ref.update(objects, (current) => new Map(current).set(digest, bytes.slice())).pipe(
                Effect.as(EvidenceReference.make({ byteLength: bytes.byteLength, digest }))
              )
            })
          ),
        read: (reference) =>
          Ref.get(objects).pipe(
            Effect.map((current) => {
              const bytes = current.get(reference.digest)
              if (bytes === undefined) return new Uint8Array()
              const text = new TextDecoder().decode(bytes)
              if (!text.includes('"formatVersion":1')) return bytes.slice()
              return new TextEncoder().encode(text.replace('"outcome":"Passed"', '"outcome":"Failed"'))
            })
          )
      })
    })
  )
  return harness(
    {
      runOrResume: () =>
        Effect.succeed(
          TargetVerificationTerminal.cases.Passed.make({
            artifacts: [artifact("verification.log", "pass")],
            correlation
          })
        )
    },
    () =>
      Effect.gen(function* () {
        const failure = yield* runTargetVerification(candidate, plan).pipe(Effect.flip)
        expect(failure._tag).toBe("TargetVerificationManifestInvalid")
      }),
    inconsistent
  )
})

it.effect("rejects duplicate artifact names before sealing a manifest", () =>
  harness(
    {
      runOrResume: () =>
        Effect.succeed(
          TargetVerificationTerminal.cases.Passed.make({
            artifacts: [artifact("same.log", "one"), artifact("same.log", "two")],
            correlation
          })
        )
    },
    (records) =>
      Effect.gen(function* () {
        const failure = yield* runTargetVerification(candidate, plan).pipe(Effect.flip)
        expect(failure._tag).toBe("TargetVerificationArtifactNamesContradict")
        expect((yield* Ref.get(records)).some(({ event }) => event._tag === "TargetVerificationEvidenceSealed")).toBe(
          false
        )
      })
  )
)

it.effect("rejects a plan for another target before invoking the public wrapper", () =>
  harness({ runOrResume: () => Effect.die("a mismatched target must not invoke verification") }, () =>
    Effect.gen(function* () {
      const mismatched = TargetVerificationPlan.make({
        planId,
        target: IntegrationTarget.make({
          repository: target.repository,
          ref: IntegrationTargetRef.make("refs/heads/release")
        })
      })
      const failure = yield* runTargetVerification(candidate, mismatched).pipe(Effect.flip)
      expect(failure._tag).toBe("TargetVerificationPlanTargetMismatch")
    })
  )
)

it.effect("rejects changed plan and candidate correlation after a durable intent", () =>
  Effect.forEach(
    [
      {
        expected: "TargetVerificationPlanChanged",
        plan: TargetVerificationPlan.make({ planId: TargetVerificationPlanId.make("replacement-plan"), target }),
        recorded: correlation
      },
      {
        expected: "TargetVerificationIntentContradiction",
        plan,
        recorded: { ...correlation, candidateCommit: GitCommitSha.make("6".repeat(40)) }
      }
    ] as const,
    ({ expected, plan: selectedPlan, recorded }) =>
      harness({ runOrResume: () => Effect.die("a contradictory intent must not invoke verification") }, (records) =>
        Effect.gen(function* () {
          yield* Ref.set(records, [
            constructedRecord,
            {
              event: TargetVerificationIntendedEvent.make({
                correlation: recorded,
                version: workflowJournalEventVersion
              }),
              key: JournalRecordKey.make(`fixture:intent:${expected}`),
              position: JournalPosition.make(12),
              runId
            }
          ])
          const failure = yield* runTargetVerification(candidate, selectedPlan).pipe(Effect.flip)
          expect(failure._tag).toBe(expected)
        })
      )
  ).pipe(Effect.asVoid)
)

it.effect("rejects malformed and schema-invalid manifest bytes", () =>
  Effect.forEach(
    [new TextEncoder().encode("{"), new TextEncoder().encode(JSON.stringify({ formatVersion: 2 }))],
    (bytes) =>
      Effect.gen(function* () {
        const failure = yield* decodeTargetVerificationManifest(bytes, correlation.requestId).pipe(Effect.flip)
        expect(failure._tag).toBe("TargetVerificationManifestInvalid")
      })
  ).pipe(Effect.asVoid)
)

it("rejects duplicate verification intent, false contradiction, and foreign-run bindings", () => {
  const constructedEvent = constructedRecord.event
  if (constructedEvent._tag !== "IntegrationCandidateConstructed") throw new Error("constructed fixture changed")
  const indexes: IntegrationHistoryIndexes = {
    acceptedExecutorResults: new Map(),
    executorResponsibilitiesBegan: new Map(),
    integrationResponsibilitiesBegan: new Map(),
    integrationStarted: new Map(),
    integrationCandidateIntents: new Map(),
    integrationCandidateIntentsByStartedAt: new Map(),
    integrationCandidateSubmissions: new Map(),
    integrationCandidateGitObservations: new Map(),
    integrationCandidatesConstructed: new Map([[candidate.constructedAt, constructedEvent]]),
    targetPromotionHistory: makeTargetPromotionHistoryIndexes(),
    targetVerificationIntents: new Map(),
    targetVerificationTerminals: new Set()
  }
  const identityIssues: Array<string> = []
  const semanticIssues: Array<string> = []
  const validate = (record: JournalRecord) =>
    validateIntegrationHistoryRecord(
      record,
      runId,
      indexes,
      (detail) => identityIssues.push(detail),
      (detail) => semanticIssues.push(detail)
    )
  const intendedRecord = (recorded: typeof correlation, position: number): JournalRecord => ({
    event: TargetVerificationIntendedEvent.make({ correlation: recorded, version: workflowJournalEventVersion }),
    key: JournalRecordKey.make(`fixture:validation-intent:${position}`),
    position: JournalPosition.make(position),
    runId
  })
  validate(intendedRecord(correlation, 12))
  validate(
    intendedRecord(
      { ...correlation, planId: TargetVerificationPlanId.make("different-plan-for-the-same-candidate") },
      13
    )
  )
  validate({
    event: TargetVerificationCorrelationContradictedEvent.make({
      expected: correlation,
      received: correlation,
      version: workflowJournalEventVersion
    }),
    key: JournalRecordKey.make("fixture:false-contradiction"),
    position: JournalPosition.make(14),
    runId
  })
  const foreignRun = RunId.make("foreign-verification-run")
  const foreignCorrelation = {
    ...correlation,
    candidateCorrelation: { ...correlation.candidateCorrelation, runId: foreignRun }
  }
  validate(intendedRecord(foreignCorrelation, 15))
  validate({
    event: TargetVerificationCorrelationContradictedEvent.make({
      expected: foreignCorrelation,
      received: correlation,
      version: workflowJournalEventVersion
    }),
    key: JournalRecordKey.make("fixture:foreign-contradiction"),
    position: JournalPosition.make(16),
    runId
  })

  expect(semanticIssues).toHaveLength(4)
  expect(identityIssues).toHaveLength(2)
})
