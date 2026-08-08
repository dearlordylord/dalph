import { it } from "@effect/vitest"
import { defineDriver, ITFBigInt, ITFMap, stateCheck } from "@firfi/quint-connect/effect"
import { quintIt } from "@firfi/quint-connect/vitest"
import {
  AcceptedResult,
  AttemptId,
  GitCommitSha,
  GitRepositoryLocator,
  IntegrationTarget,
  IntegrationTargetRef,
  PlannedAttemptExecutorReport,
  PlannedTaskAttempt,
  RunId,
  TaskBranchRef,
  TaskExecutorLocator,
  TaskId,
  TaskRevision,
  WorktreeLocator
} from "@dalph/contracts"
import {
  CandidateContinuationLimit,
  CandidateCorrectionLimit,
  continueIntegrationCandidateConstruction,
  deriveIntegrationAdmission,
  deriveIntegrationCandidateConstruction,
  describeJournalEvent,
  InRunJournal,
  IntegrationCandidateAgent,
  IntegrationCandidateAgentReport,
  IntegrationCandidateCorrelation,
  IntegrationCandidateGit,
  IntegrationCandidateGitObservation,
  IntegrationCandidateGitReadFailure,
  IntegrationCandidateId,
  IntegrationCandidateResourceLocator,
  IntegrationSessionId,
  integrationCandidateCorrelationEquals,
  integrationCandidateHasExactParents,
  makeIntegrationTargetResourceController,
  PlannedAttemptExecutorReportOrdinal,
  PlannedAttemptExecutorWorkReportedEvent,
  PlannedAttemptExecutorWorkResponsibilityBeganEvent,
  queueAcceptedResultIntegrationResponsibility,
  selectStartableIntegrationResponsibilities,
  startQueuedIntegration,
  TargetLineageObservation,
  workflowJournalEventVersion,
  type IntegrationCandidateAgentReport as CandidateReport,
  type IntegrationCandidateGitObservation as CandidateGitObservation,
  type IntegrationCandidateConstructionState,
  type IntegrationTargetResourceController,
  type JournalRecord,
  type QueuedIntegrationResponsibility,
  type StartedIntegrationResponsibility
} from "@dalph/orchestrator"
import { Effect, Layer, Schema } from "effect"

const runId = RunId.make("accepted-result-integration-model-run")
const target = IntegrationTarget.make({
  repository: GitRepositoryLocator.make("/repositories/accepted-result-integration.git"),
  ref: IntegrationTargetRef.make("refs/heads/master")
})
const correctionLimit = CandidateCorrectionLimit.make(1)
const continuationLimit = CandidateContinuationLimit.make(2)

const commitOf = (value: bigint | number): GitCommitSha =>
  GitCommitSha.make(BigInt(value).toString(16).padStart(40, "0"))

const attempts = new Map(
  [1, 2].map((id) => [
    BigInt(id),
    PlannedTaskAttempt.make({
      attemptId: AttemptId.make(`accepted-result-integration-attempt-${id}`),
      baseSha: commitOf(id),
      branch: TaskBranchRef.make(`refs/heads/dalph/accepted-result-integration-${id}`),
      executor: TaskExecutorLocator.make("executor:model"),
      runId,
      taskId: TaskId.make(`accepted-result-integration-task-${id}`),
      taskRevision: TaskRevision.make(`accepted-result-integration-revision-${id}`),
      worktree: WorktreeLocator.make(`/worktrees/accepted-result-integration-${id}`)
    })
  ])
)

const acceptedResultOf = (id: bigint): AcceptedResult => AcceptedResult.make({ commit: commitOf(id + 20n) })

const SpecResult = Schema.Struct({
  acceptedResultCommit: ITFBigInt,
  continuationCount: ITFBigInt,
  correctionCount: ITFBigInt,
  expectedTargetHead: ITFBigInt,
  integrationSession: ITFBigInt,
  observedFirstParent: ITFBigInt,
  observedSecondParent: ITFBigInt,
  phase: Schema.Unknown,
  preIntegrationCancellation: Schema.Boolean,
  queuePosition: ITFBigInt,
  submittedCandidate: ITFBigInt,
  targetHeld: Schema.Boolean
})

const SpecProjection = Schema.Struct({
  state: Schema.Struct({
    nextJournalPosition: ITFBigInt,
    recovered: Schema.Boolean,
    results: ITFMap(ITFBigInt, SpecResult),
    trackerFactsCurrent: Schema.Boolean
  })
})

const variantTag = (value: unknown): string =>
  typeof value === "object" && value !== null && "tag" in value ? String(value.tag) : String(value)

const idFor = (value: bigint): PlannedTaskAttempt => {
  const attempt = attempts.get(value)
  return attempt === undefined ? Effect.runSync(Effect.die(`unknown model result ${value}`)) : attempt
}

const numericCommit = (sha: GitCommitSha | undefined): bigint => (sha === undefined ? 0n : BigInt(`0x${sha}`))

type Phase =
  | "NoAcceptedResult"
  | "AcceptedResult"
  | "Queued"
  | "Started"
  | "DependencyWait"
  | "CandidatePending"
  | "CorrectionRequired"
  | "CandidateReady"
  | "CorrectionLimitReached"
  | "ContinuationLimitReached"
  | "CorrelationContradiction"
  | "CorrelationContradictionReleased"

const phaseFor = (
  accepted: boolean,
  queued: QueuedIntegrationResponsibility | StartedIntegrationResponsibility | undefined,
  candidate: IntegrationCandidateConstructionState | undefined,
  dependencyWait: boolean,
  contradictionReleased: boolean
): Phase => {
  if (!accepted) return "NoAcceptedResult"
  if (queued === undefined) return "AcceptedResult"
  if (queued._tag === "QueuedIntegrationResponsibility") return "Queued"
  if (dependencyWait) return "DependencyWait"
  if (contradictionReleased) return "CorrelationContradictionReleased"
  switch (candidate?._tag) {
    case undefined:
    case "CandidateConstructionInProgress":
      return "Started"
    case "CandidateValidationPending":
      return "CandidatePending"
    case "CandidateCorrectionRequired":
      return "CorrectionRequired"
    case "CandidateConstructed":
      return "CandidateReady"
    case "CandidateCorrectionLimitReached":
      return "CorrectionLimitReached"
    case "CandidateContinuationLimitReached":
      return "ContinuationLimitReached"
    case "CandidateCorrelationContradiction":
      return "CorrelationContradiction"
  }
}

const acceptedResultIntegrationDriver = defineDriver(
  {
    acceptResultOne: {},
    acceptResultTwo: {},
    gitReadFailsOne: {},
    gitReadFailsTwo: {},
    init: {},
    observeExactCandidateOne: {},
    observeExactCandidateTwo: {},
    observeInvalidCandidateOne: {},
    observeInvalidCandidateTwo: {},
    observeTrackerFacts: {},
    queueAcceptedResultOne: {},
    queueAcceptedResultTwo: {},
    reacquireIntegrationTargetOne: {},
    reacquireIntegrationTargetTwo: {},
    recoverCoordinator: {},
    releaseForeignCorrelationTargetOne: {},
    releaseForeignCorrelationTargetTwo: {},
    reportForeignCorrelationOne: {},
    reportForeignCorrelationTwo: {},
    reportWithoutCandidateOne: {},
    reportWithoutCandidateTwo: {},
    startIntegrationOne: {},
    startIntegrationTwo: {},
    submitCandidateOne31: {},
    submitCandidateOne32: {},
    submitCandidateTwo31: {},
    submitCandidateTwo32: {},
    waitOnDependencyOne: {},
    waitOnDependencyTwo: {}
  },
  () => {
    let records: ReadonlyArray<JournalRecord> = []
    let nextAgentReport: CandidateReport | undefined
    let nextGitResult: CandidateGitObservation | IntegrationCandidateGitReadFailure | undefined
    let resources: IntegrationTargetResourceController | undefined
    let recovered = false
    let trackerFactsCurrent = true
    let dependencyWaits = new Set<bigint>()
    let releasedContradictions = new Set<bigint>()

    const append = InRunJournal.of({
      append: (_requestedRunId, key, event) =>
        Effect.sync(() => {
          const existing = records.find((record) => record.key === key)
          if (existing !== undefined) return existing
          const record = { event, key, position: records.length + 1, runId } as JournalRecord
          records = [...records, record]
          return record
        }),
      read: () => Effect.succeed(records)
    })
    const candidateAgent = IntegrationCandidateAgent.of({
      startOrContinue: () =>
        Effect.sync(() => {
          const report = nextAgentReport
          nextAgentReport = undefined
          if (report === undefined) throw new Error("model action did not provide an integration-agent report")
          return report
        })
    })
    const candidateGit = IntegrationCandidateGit.of({
      readSubmittedCommit: (_repository, _candidateCommit) =>
        Effect.suspend(() => {
          const result = nextGitResult
          nextGitResult = undefined
          if (result === undefined) return Effect.die("model action did not provide a Git observation")
          return result._tag === "IntegrationCandidateGitReadFailure" ? Effect.fail(result) : Effect.succeed(result)
        })
    })
    const candidateLayer = Layer.mergeAll(
      Layer.succeed(InRunJournal, append),
      Layer.succeed(IntegrationCandidateAgent, candidateAgent),
      Layer.succeed(IntegrationCandidateGit, candidateGit)
    )
    const journalLayer = Layer.succeed(InRunJournal, append)
    const requireResources = (): Effect.Effect<IntegrationTargetResourceController> =>
      resources === undefined ? Effect.die("integration resources must be initialized") : Effect.succeed(resources)
    const admission = () => deriveIntegrationAdmission(records)
    const responsibilityFor = (id: bigint): StartedIntegrationResponsibility => {
      const attempt = idFor(id)
      const responsibility = admission().responsibilities.find(
        (candidate) => candidate.plannedAttempt.attemptId === attempt.attemptId
      )
      if (responsibility?._tag !== "StartedIntegrationResponsibility") {
        return Effect.runSync(Effect.die(`result ${id} has no started integration responsibility`))
      }
      return responsibility
    }
    const lineageFor = (id: bigint) =>
      TargetLineageObservation.make({
        plannedBaseIsAncestorOfTargetHead: true,
        plannedBaseSha: idFor(id).baseSha,
        targetHeadSha: commitOf(id + 10n)
      })
    const continueCandidate = (id: bigint) =>
      continueIntegrationCandidateConstruction(
        responsibilityFor(id),
        lineageFor(id),
        correctionLimit,
        continuationLimit
      ).pipe(Effect.provide(candidateLayer), Effect.orDie)
    const correlationFor = (id: bigint) => {
      const responsibility = responsibilityFor(id)
      const state = deriveIntegrationCandidateConstruction(records, responsibility)
      if (state === undefined) {
        const candidateId = IntegrationCandidateId.make(
          `integration-candidate:${responsibility.plannedAttempt.runId}:${responsibility.plannedAttempt.attemptId}:${responsibility.startedAt}`
        )
        return IntegrationCandidateCorrelation.make({
          acceptedResultCommit: responsibility.acceptedResult.commit,
          attemptId: responsibility.plannedAttempt.attemptId,
          candidateId,
          candidateResource: IntegrationCandidateResourceLocator.make(`integration-candidate-resource:${candidateId}`),
          expectedTargetHead: commitOf(id + 10n),
          integrationSessionId: IntegrationSessionId.make(
            `integration-session:${responsibility.plannedAttempt.runId}:${responsibility.plannedAttempt.attemptId}:${responsibility.startedAt}`
          ),
          integrationTarget: responsibility.integrationTarget,
          runId: responsibility.plannedAttempt.runId
        })
      }
      return state._tag === "CandidateCorrelationContradiction" ? state.expected : state.correlation
    }
    const submit = (id: bigint, candidate: bigint) =>
      Effect.gen(function* () {
        const correlation = correlationFor(id)
        nextAgentReport = IntegrationCandidateAgentReport.cases.Submitted.make({
          candidateCommit: commitOf(candidate),
          correlation
        })
        nextGitResult = new IntegrationCandidateGitReadFailure({
          candidateCommit: commitOf(candidate),
          detail: "defer candidate observation to the next model action",
          repository: target.repository
        })
        yield* continueCandidate(id)
      })
    const observe = (id: bigint, exact: boolean) =>
      Effect.gen(function* () {
        const correlation = correlationFor(id)
        nextGitResult = IntegrationCandidateGitObservation.cases.Commit.make({
          directParents: exact
            ? [correlation.expectedTargetHead, correlation.acceptedResultCommit]
            : [commitOf(99), commitOf(98)]
        })
        const state = yield* continueCandidate(id)
        if (state._tag === "CandidateCorrectionLimitReached") {
          yield* (yield* requireResources()).release(responsibilityFor(id))
        }
      })
    const reportWithoutCandidate = (id: bigint) =>
      Effect.gen(function* () {
        const correlation = correlationFor(id)
        nextAgentReport = IntegrationCandidateAgentReport.cases.Working.make({ correlation })
        yield* continueCandidate(id)
        const reports = records.filter(
          ({ event }) =>
            event._tag === "IntegrationCandidateAgentReported" &&
            event.report._tag !== "Submitted" &&
            event.report.correlation.attemptId === idFor(id).attemptId
        ).length
        if (reports >= continuationLimit) {
          const state = yield* continueCandidate(id)
          if (state._tag === "CandidateContinuationLimitReached") {
            yield* (yield* requireResources()).release(responsibilityFor(id))
          }
        }
      })

    const acceptResult = (id: bigint) =>
      Effect.sync(() => {
        const attempt = idFor(id)
        const responsibility = PlannedAttemptExecutorWorkResponsibilityBeganEvent.make({
          plannedAttempt: attempt,
          version: workflowJournalEventVersion
        })
        const report = PlannedAttemptExecutorWorkReportedEvent.make({
          ordinal: PlannedAttemptExecutorReportOrdinal.make(1),
          report: PlannedAttemptExecutorReport.cases.Terminal.make({
            correlation: { attemptId: attempt.attemptId, runId },
            result: { _tag: "Accepted", acceptedResult: acceptedResultOf(id) }
          }),
          version: workflowJournalEventVersion
        })
        for (const event of [responsibility, report]) {
          records = [
            ...records,
            {
              event,
              key: describeJournalEvent(event).expectedKey,
              position: records.length + 1,
              runId
            } as JournalRecord
          ]
        }
      })
    const gitReadFails = (id: bigint) =>
      Effect.gen(function* () {
        const state = deriveIntegrationCandidateConstruction(records, responsibilityFor(id))
        if (state?._tag !== "CandidateValidationPending") return yield* Effect.die("candidate must be pending")
        nextGitResult = new IntegrationCandidateGitReadFailure({
          candidateCommit: state.candidateCommit,
          detail: "simulated ambiguous Git read",
          repository: target.repository
        })
        yield* continueCandidate(id)
      })
    const queueAcceptedResult = (id: bigint) =>
      queueAcceptedResultIntegrationResponsibility(idFor(id), acceptedResultOf(id), target).pipe(
        Effect.provide(journalLayer),
        Effect.orDie
      )
    const releaseForeignCorrelationTarget = (id: bigint) =>
      Effect.gen(function* () {
        const responsibility = responsibilityFor(id)
        yield* (yield* requireResources()).release(responsibility)
        releasedContradictions = new Set(releasedContradictions).add(id)
      })
    const reacquireIntegrationTarget = (id: bigint) =>
      Effect.gen(function* () {
        const responsibility = responsibilityFor(id)
        const controller = yield* requireResources()
        yield* controller.acquire(responsibility).pipe(Effect.orDie)
        yield* controller.publishAcceptedOwnership(responsibility)
      })
    const reportForeignCorrelation = (id: bigint) =>
      Effect.gen(function* () {
        const correlation = correlationFor(id)
        nextAgentReport = IntegrationCandidateAgentReport.cases.Working.make({
          correlation: {
            ...correlation,
            candidateId: IntegrationCandidateId.make(`${correlation.candidateId}:foreign`)
          }
        })
        yield* continueCandidate(id)
      })
    const startIntegration = (id: bigint) =>
      Effect.gen(function* () {
        const attempt = idFor(id)
        const controller = yield* requireResources()
        const snapshot = yield* controller.snapshot
        // Admission reconstruction deliberately preserves every historical
        // start. Current resource facts remove settled starts before applying
        // the production FIFO selector, as the delivery frontier does.
        const currentAdmission = {
          responsibilities: admission().responsibilities.filter(
            (responsibility) =>
              responsibility._tag === "QueuedIntegrationResponsibility" ||
              snapshot.heldResponsibilityPositions.has(responsibility.queuedAt)
          )
        }
        const queued = selectStartableIntegrationResponsibilities(currentAdmission).find(
          (responsibility) => responsibility.plannedAttempt.attemptId === attempt.attemptId
        )
        if (queued === undefined) return yield* Effect.die(`result ${id} is not startable`)
        yield* controller.acquire(queued).pipe(Effect.orDie)
        yield* controller.publishAcceptedOwnership(queued)
        yield* startQueuedIntegration(queued).pipe(Effect.provide(journalLayer), Effect.orDie)
      })
    const waitOnDependency = (id: bigint) =>
      Effect.gen(function* () {
        const responsibility = responsibilityFor(id)
        yield* (yield* requireResources()).release(responsibility)
        dependencyWaits = new Set(dependencyWaits).add(id)
      })

    return {
      acceptResultOne: () => acceptResult(1n),
      acceptResultTwo: () => acceptResult(2n),
      gitReadFailsOne: () => gitReadFails(1n),
      gitReadFailsTwo: () => gitReadFails(2n),
      getState: () =>
        Effect.gen(function* () {
          const controller = yield* requireResources()
          const snapshot = yield* controller.snapshot
          const currentAdmission = admission()
          const queuedPositions = currentAdmission.responsibilities
            .map(({ queuedAt }) => queuedAt)
            .toSorted((left, right) => left - right)
          const results = new Map(
            [...attempts].map(([id, attempt]) => {
              const accepted = records.some(
                ({ event }) =>
                  event._tag === "PlannedAttemptExecutorWorkReported" &&
                  event.report._tag === "Terminal" &&
                  event.report.result._tag === "Accepted" &&
                  event.report.correlation.attemptId === attempt.attemptId
              )
              const queued = currentAdmission.responsibilities.find(
                (responsibility) => responsibility.plannedAttempt.attemptId === attempt.attemptId
              )
              const candidate =
                queued?._tag === "StartedIntegrationResponsibility"
                  ? deriveIntegrationCandidateConstruction(records, queued)
                  : undefined
              const correlation =
                candidate === undefined && queued?._tag === "StartedIntegrationResponsibility"
                  ? correlationFor(id)
                  : candidate === undefined
                    ? undefined
                    : candidate._tag === "CandidateCorrelationContradiction"
                      ? candidate.expected
                      : candidate.correlation
              const observations = records.filter(
                ({ event }) =>
                  event._tag === "IntegrationCandidateGitObserved" && event.correlation.attemptId === attempt.attemptId
              )
              const invalidObservations = observations.filter(
                ({ event }) =>
                  event._tag === "IntegrationCandidateGitObserved" &&
                  correlation !== undefined &&
                  !integrationCandidateHasExactParents(event.observation, correlation)
              )
              const reports = records.filter(
                ({ event }) =>
                  event._tag === "IntegrationCandidateAgentReported" &&
                  event.expectedCorrelation.attemptId === attempt.attemptId
              )
              const submitted = reports.findLast(
                ({ event }) => event._tag === "IntegrationCandidateAgentReported" && event.report._tag === "Submitted"
              )
              const currentObservation = observations.findLast(
                ({ event }) =>
                  event._tag === "IntegrationCandidateGitObserved" && event.submissionAt === submitted?.position
              )?.event
              const parents =
                currentObservation?._tag === "IntegrationCandidateGitObserved" &&
                currentObservation.observation._tag === "Commit"
                  ? currentObservation.observation.directParents
                  : []
              const queueRank =
                queued === undefined ? 0 : queuedPositions.findIndex((position) => position === queued.queuedAt) + 1
              return [
                id,
                {
                  acceptedResultCommit: id + 20n,
                  continuationCount: BigInt(
                    reports.filter(
                      ({ event }) =>
                        event._tag === "IntegrationCandidateAgentReported" &&
                        event.report._tag !== "Submitted" &&
                        correlation !== undefined &&
                        integrationCandidateCorrelationEquals(event.report.correlation, correlation)
                    ).length
                  ),
                  correctionCount:
                    candidate?._tag === "CandidateCorrectionLimitReached"
                      ? BigInt(candidate.correctionCount)
                      : BigInt(invalidObservations.length),
                  expectedTargetHead: numericCommit(correlation?.expectedTargetHead),
                  integrationSession: correlation === undefined ? 0n : id,
                  observedFirstParent: numericCommit(parents[0]),
                  observedSecondParent: numericCommit(parents[1]),
                  phase:
                    candidate?._tag === "CandidateConstructionInProgress" && observations.length > 0
                      ? "CorrectionRequired"
                      : phaseFor(accepted, queued, candidate, dependencyWaits.has(id), releasedContradictions.has(id)),
                  preIntegrationCancellation: queued?._tag === "QueuedIntegrationResponsibility",
                  queuePosition: BigInt(queueRank),
                  submittedCandidate:
                    submitted?.event._tag === "IntegrationCandidateAgentReported" &&
                    submitted.event.report._tag === "Submitted"
                      ? numericCommit(submitted.event.report.candidateCommit)
                      : 0n,
                  targetHeld: queued === undefined ? false : snapshot.heldResponsibilityPositions.has(queued.queuedAt)
                }
              ] as const
            })
          )
          return {
            nextJournalPosition: BigInt(currentAdmission.responsibilities.length + 1),
            recovered,
            results,
            trackerFactsCurrent
          }
        }),
      init: () =>
        Effect.gen(function* () {
          records = []
          nextAgentReport = undefined
          nextGitResult = undefined
          resources = yield* makeIntegrationTargetResourceController()
          recovered = false
          trackerFactsCurrent = true
          dependencyWaits = new Set()
          releasedContradictions = new Set()
        }),
      observeExactCandidateOne: () => observe(1n, true),
      observeExactCandidateTwo: () => observe(2n, true),
      observeInvalidCandidateOne: () => observe(1n, false),
      observeInvalidCandidateTwo: () => observe(2n, false),
      observeTrackerFacts: () =>
        Effect.sync(() => {
          trackerFactsCurrent = true
        }),
      queueAcceptedResultOne: () => queueAcceptedResult(1n),
      queueAcceptedResultTwo: () => queueAcceptedResult(2n),
      reacquireIntegrationTargetOne: () => reacquireIntegrationTarget(1n),
      reacquireIntegrationTargetTwo: () => reacquireIntegrationTarget(2n),
      recoverCoordinator: () =>
        Effect.gen(function* () {
          resources = yield* makeIntegrationTargetResourceController()
          releasedContradictions = new Set()
          recovered = true
          trackerFactsCurrent = false
        }),
      releaseForeignCorrelationTargetOne: () => releaseForeignCorrelationTarget(1n),
      releaseForeignCorrelationTargetTwo: () => releaseForeignCorrelationTarget(2n),
      reportForeignCorrelationOne: () => reportForeignCorrelation(1n),
      reportForeignCorrelationTwo: () => reportForeignCorrelation(2n),
      reportWithoutCandidateOne: () => reportWithoutCandidate(1n),
      reportWithoutCandidateTwo: () => reportWithoutCandidate(2n),
      startIntegrationOne: () => startIntegration(1n),
      startIntegrationTwo: () => startIntegration(2n),
      submitCandidateOne31: () => submit(1n, 31n),
      submitCandidateOne32: () => submit(1n, 32n),
      submitCandidateTwo31: () => submit(2n, 31n),
      submitCandidateTwo32: () => submit(2n, 32n),
      waitOnDependencyOne: () => waitOnDependency(1n),
      waitOnDependencyTwo: () => waitOnDependency(2n)
    }
  }
)

quintIt(
  it.effect,
  "replays accepted-result integration through production journal and candidate protocols",
  {
    backend: "typescript",
    driverFactory: acceptedResultIntegrationDriver,
    maxSteps: 20,
    nTraces: 100,
    seed: "57",
    spec: "specs/acceptedResultIntegration.qnt",
    stateCheck: stateCheck(
      (raw) =>
        Schema.decodeUnknownEffect(SpecProjection)(raw).pipe(
          Effect.map(({ state }) => ({
            ...state,
            results: new Map(
              [...state.results].map(([id, result]) => [id, { ...result, phase: variantTag(result.phase) }])
            )
          })),
          Effect.orDie
        ),
      (spec, implementation) =>
        spec.nextJournalPosition === implementation.nextJournalPosition &&
        spec.recovered === implementation.recovered &&
        spec.trackerFactsCurrent === implementation.trackerFactsCurrent &&
        [...spec.results].every(([id, expected]) => {
          const actual = implementation.results.get(id)
          return (
            actual !== undefined &&
            expected.acceptedResultCommit === actual.acceptedResultCommit &&
            expected.continuationCount === actual.continuationCount &&
            expected.correctionCount === actual.correctionCount &&
            expected.expectedTargetHead === actual.expectedTargetHead &&
            expected.integrationSession === actual.integrationSession &&
            expected.observedFirstParent === actual.observedFirstParent &&
            expected.observedSecondParent === actual.observedSecondParent &&
            expected.phase === actual.phase &&
            expected.preIntegrationCancellation === actual.preIntegrationCancellation &&
            expected.queuePosition === actual.queuePosition &&
            expected.submittedCandidate === actual.submittedCandidate &&
            expected.targetHeld === actual.targetHeld
          )
        })
    )
  },
  30_000
)
