/* eslint-disable import/no-nodejs-modules -- Qualification measures its actual process/toolchain and exact artifact location. */
import nodeProcess from "node:process"
import {
  AttemptId,
  EvidenceDigest,
  GitCommitSha,
  PlannedTaskAttempt,
  RunId,
  TaskId,
  type GitRepositoryLocator
} from "@dalph/contracts"
import {
  GitCommand,
  IntegratorRunCorrelation,
  IntegratorSessionCorrelation,
  type JournalRecord,
  JournalPosition,
  RunTerminationDisposition,
  TargetPromotionCorrelation,
  TraceCursor
} from "@dalph/orchestrator"
import { DateTime, Effect, MutableList, Schema } from "effect"
import {
  measureQualificationBuild,
  QualificationBuild,
  QualificationEvidenceFailure,
  QualificationFormalProvenance,
  qualificationFormalProvenance
} from "../src/qualification/qualification-provenance.js"
import {
  qualificationTranscriptDigest,
  type QualificationArtifactLocator,
  writeQualificationArtifact
} from "../src/qualification/qualification-artifact.js"
import type {
  HermeticControllerFixture,
  HermeticPublicChild,
  makeHermeticController
} from "./production-hermetic-controller.js"
import { HermeticFixtureContainer } from "./production-hermetic-controller.js"
import {
  BoundaryReached,
  HermeticFixtureManifest,
  HermeticFixtureResource,
  HermeticInvocationId
} from "../src/application/production-hermetic-contract.js"
import { ProductionCliRecord } from "../src/application/production-cli.js"
import { disposeHermeticFixture, HermeticFixtureDisposal } from "./production-hermetic-fixture-cleanup.js"
import {
  cleanupDisposableGithubQualification,
  DisposableGithubQualificationCleanup,
  DisposableGithubQualificationManifest,
  DisposableGithubQualificationResource
} from "../src/qualification/disposable-github-qualification-cleanup.js"

const qualificationEvidenceVersion = 1
const InvocationTimestamp = Schema.String.check(Schema.isPattern(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u))
const ExecutionResultEvidence = Schema.TaggedUnion({
  NotReached: { reason: Schema.Literal("NoAcceptedExecutorResult") },
  Accepted: { results: Schema.NonEmptyArray(Schema.Struct({ attemptId: AttemptId, commit: GitCommitSha })) }
})
const IntegrationEvidence = Schema.TaggedUnion({
  NotReached: { reason: Schema.Literal("NoIntegratorSession") },
  Observed: {
    sessions: Schema.NonEmptyArray(IntegratorSessionCorrelation),
    runs: Schema.Array(IntegratorRunCorrelation)
  }
})
const PromotionEvidence = Schema.TaggedUnion({
  NotReached: { reason: Schema.Literal("NoPromotionRequest") },
  Observed: { requests: Schema.NonEmptyArray(TargetPromotionCorrelation) }
})
const RunOutcomeEvidence = Schema.TaggedUnion({
  Unfinished: { runId: RunId },
  Terminated: { runId: RunId, disposition: RunTerminationDisposition }
})
const ProcessOutcomeEvidence = Schema.TaggedUnion({
  Exit: {
    processId: Schema.Int.check(Schema.isGreaterThan(0)),
    status: Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 255 }))
  },
  ControllerKilled: { processId: Schema.Int.check(Schema.isGreaterThan(0)), signal: Schema.Literal("SIGKILL") }
})

/** Reports cleanup independently of publication; retaining an empty container alone is expected. */
export const QualificationCleanupDisposition = Schema.TaggedUnion({
  QualificationCleanupComplete: {
    retainedContainer: HermeticFixtureContainer,
    reason: Schema.Literal("EmptyDisposableContainerIntentionallyRetained")
  },
  QualificationCleanupIncomplete: {
    github: DisposableGithubQualificationCleanup,
    local: HermeticFixtureDisposal,
    localInspectionCommands: Schema.Array(
      Schema.Struct({ resource: HermeticFixtureResource, command: Schema.NonEmptyString })
    )
  }
})
export type QualificationCleanupDisposition = typeof QualificationCleanupDisposition.Type

const localInspectionCommand = (resource: HermeticFixtureResource) => {
  const quote = (value: string) => `'${value.replaceAll("'", "'\\''")}'`
  const script =
    "const fs=require('node:fs');const s=fs.lstatSync(process.argv[1]);console.log(JSON.stringify({file:s.isFile(),directory:s.isDirectory(),symlink:s.isSymbolicLink(),dev:s.dev,ino:s.ino}));"
  return { resource, command: `${quote(nodeProcess.execPath)} --eval ${quote(script)} -- ${quote(resource.locator)}` }
}

export const qualificationCleanupDisposition = (
  github: DisposableGithubQualificationCleanup,
  local: HermeticFixtureDisposal
): QualificationCleanupDisposition =>
  github.retained.length === 0 && local._tag === "RemovedResources"
    ? QualificationCleanupDisposition.cases.QualificationCleanupComplete.make({
        retainedContainer: local.retainedContainer,
        reason: "EmptyDisposableContainerIntentionallyRetained"
      })
    : QualificationCleanupDisposition.cases.QualificationCleanupIncomplete.make({
        github,
        local,
        localInspectionCommands: local._tag === "RetainedFixture" ? local.retained.map(localInspectionCommand) : []
      })

/** Measured qualification facts and original validated public records, not a second workflow authority. */
export const ProductionMvpQualificationEvidence = Schema.Struct({
  schemaVersion: Schema.Literal(qualificationEvidenceVersion),
  scenario: Schema.Literals(["ProductionHappy", "CompletionResponse", "PromotionCompareAndSet", "CompletionThrottle"]),
  mode: Schema.Literal("Hermetic"),
  invocationId: HermeticInvocationId,
  startedAt: InvocationTimestamp,
  endedAt: InvocationTimestamp,
  build: QualificationBuild,
  fixture: HermeticFixtureManifest,
  taskId: TaskId,
  runs: Schema.NonEmptyArray(RunOutcomeEvidence),
  processes: Schema.NonEmptyArray(ProcessOutcomeEvidence),
  plannedAttempts: Schema.Array(PlannedTaskAttempt),
  executor: ExecutionResultEvidence,
  integration: IntegrationEvidence,
  promotion: PromotionEvidence,
  journal: Schema.Struct({ cursor: TraceCursor, positions: Schema.NonEmptyArray(JournalPosition) }),
  boundaries: Schema.Array(BoundaryReached),
  operationCounts: Schema.Array(
    Schema.Struct({ tag: Schema.NonEmptyString, count: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)) })
  ),
  finalTargetHead: GitCommitSha,
  finalTracker: Schema.Struct({
    original: DisposableGithubQualificationManifest,
    issuePresent: Schema.Boolean,
    lifecycle: Schema.Literals(["Open", "Completed"]),
    claims: Schema.Array(DisposableGithubQualificationResource)
  }),
  transcript: Schema.Struct({ records: Schema.NonEmptyArray(ProductionCliRecord), digest: EvidenceDigest }),
  formal: QualificationFormalProvenance,
  githubCleanup: DisposableGithubQualificationCleanup,
  localCleanup: HermeticFixtureDisposal,
  cleanupDisposition: QualificationCleanupDisposition
})
export type ProductionMvpQualificationEvidence = typeof ProductionMvpQualificationEvidence.Type

export type QualificationPublicationOutcome =
  | {
      readonly _tag: "Published"
      readonly evidence: ProductionMvpQualificationEvidence
      readonly artifact: QualificationArtifactLocator
      readonly cleanupDisposition: QualificationCleanupDisposition
    }
  | {
      readonly _tag: "PublicationFailed"
      readonly evidence: ProductionMvpQualificationEvidence
      readonly failure: QualificationEvidenceFailure
      readonly cleanupDisposition: QualificationCleanupDisposition
    }

type QualificationController = Effect.Success<ReturnType<typeof makeHermeticController>>

/** Captures final owning-authority facts once after the original children are joined, then cleans and publishes once. */
export const completeQualificationEvidence = Effect.fn("Qualification.completeEvidence")(function* (
  fixture: HermeticControllerFixture,
  controller: QualificationController,
  input: {
    readonly scenario: ProductionMvpQualificationEvidence["scenario"]
    readonly startedAt: string
    readonly sourceRepository: GitRepositoryLocator
    readonly lockfile: string
    readonly children: ReadonlyArray<HermeticPublicChild>
    readonly journal: ReadonlyArray<JournalRecord>
    readonly artifact: QualificationArtifactLocator
  }
) {
  if (!(yield* controller.ownedChildrenStopped))
    return yield* new QualificationEvidenceFailure({ operation: "ValidateEvidence" })
  yield* controller.stopTransport
  if ((yield* controller.activeRequestCount) !== 0 || (yield* controller.activeRegistrationCount) !== 0)
    return yield* new QualificationEvidenceFailure({ operation: "ValidateEvidence" })
  const build = yield* measureQualificationBuild(input.sourceRepository, fixture.manifest.sourceBaseSha, {
    builtEntry: fixture.manifest.builtEntry,
    lockfile: input.lockfile,
    configuration: fixture.configurationPath
  })
  const records = input.children.flatMap((child) => MutableList.toArray(child.recordLog))
  const processes = yield* controller.processOutcomes
  if (processes.length !== input.children.length)
    return yield* new QualificationEvidenceFailure({ operation: "ValidateEvidence" })
  const finalTracker = yield* controller.finalTrackerFacts
  const original = yield* controller.providerCreationManifest
  const providerSnapshot = yield* controller.providerSnapshot
  const git = yield* GitCommand
  const head = yield* git.runInWorktree(fixture.manifest.repository, ["rev-parse", fixture.manifest.integrationRef])
  if (head.exitCode !== 0) return yield* new QualificationEvidenceFailure({ operation: "ValidateEvidence" })
  const facts = qualificationJournalFacts(input.journal)
  const finalRecord = input.journal[input.journal.length - 1]
  const plannedAttempt = facts.plannedAttempts[0]
  if (finalRecord === undefined || plannedAttempt === undefined)
    return yield* new QualificationEvidenceFailure({ operation: "ValidateEvidence" })
  const githubCleanup = yield* cleanupDisposableGithubQualification(
    original,
    { invocationId: fixture.manifest.invocationId, repository: original.repository },
    controller.githubCleanupAdapter
  )
  const localCleanup = yield* disposeHermeticFixture(fixture, controller)
  const cleanupDisposition = qualificationCleanupDisposition(githubCleanup, localCleanup)
  const evidence = yield* Schema.decodeUnknownEffect(ProductionMvpQualificationEvidence, {
    reportInput: false,
    onExcessProperty: "error"
  })({
    schemaVersion: qualificationEvidenceVersion,
    scenario: input.scenario,
    mode: "Hermetic",
    invocationId: fixture.manifest.invocationId,
    startedAt: input.startedAt,
    endedAt: DateTime.formatIso(yield* DateTime.now),
    build,
    fixture: fixture.manifest,
    ...journalEvidenceFields(input.journal, facts, finalRecord, plannedAttempt),
    processes,
    boundaries: MutableList.toArray(controller.boundaryLog),
    operationCounts: providerSnapshot.operationCounts,
    finalTargetHead: head.stdout.trim(),
    finalTracker: {
      original,
      issuePresent: finalTracker.issuePresent,
      lifecycle: finalTracker.taskLifecycle,
      claims: finalTracker.claims
    },
    transcript: { records, digest: yield* qualificationTranscriptDigest(records) },
    formal: yield* qualificationFormalProvenance(build.sourceSha, { _tag: "LocalHermetic" }),
    githubCleanup,
    localCleanup,
    cleanupDisposition
  }).pipe(Effect.mapError(() => new QualificationEvidenceFailure({ operation: "ValidateEvidence" })))
  return yield* publishQualificationEvidence(fixture.container, input.artifact, evidence).pipe(
    Effect.match({
      onFailure: (failure): QualificationPublicationOutcome => ({
        _tag: "PublicationFailed",
        evidence,
        failure,
        cleanupDisposition
      }),
      onSuccess: (artifact): QualificationPublicationOutcome => ({
        _tag: "Published",
        evidence,
        artifact,
        cleanupDisposition
      })
    })
  )
})

/** Reads only durable correlation/result fields, never executor prompts, provider reports or private-store identifiers. */
export const qualificationJournalFacts = (records: ReadonlyArray<JournalRecord>) => {
  const plannedAttempts = records.flatMap(({ event }) =>
    event._tag === "TaskAttemptPlanned" ? [event.operation.plannedAttempt] : []
  )
  const acceptedResults = records.flatMap(({ event }) =>
    event._tag === "PlannedAttemptExecutorWorkReported" &&
    event.report._tag === "ExecutorWorkTerminal" &&
    event.report.result._tag === "Accepted"
      ? [{ attemptId: event.report.correlation.attemptId, commit: event.report.result.acceptedResult.commit }]
      : []
  )
  const sessions = records.flatMap(({ event }) => (event._tag === "IntegratorSessionFixed" ? [event.correlation] : []))
  const runs = records.flatMap(({ event }) => (event._tag === "IntegratorRunStarted" ? [event.run] : []))
  const requests = records.flatMap(({ event }) => (event._tag === "TargetPromotionIntended" ? [event.correlation] : []))
  return { plannedAttempts, acceptedResults, sessions, runs, requests }
}

const journalEvidenceFields = (
  records: ReadonlyArray<JournalRecord>,
  facts: ReturnType<typeof qualificationJournalFacts>,
  finalRecord: JournalRecord,
  plannedAttempt: PlannedTaskAttempt
) => {
  const terminated = records.findLast(({ event }) => event._tag === "WorkflowRunTerminated")
  return {
    taskId: plannedAttempt.taskId,
    runs: [
      terminated?.event._tag === "WorkflowRunTerminated"
        ? { _tag: "Terminated", runId: finalRecord.runId, disposition: terminated.event.disposition }
        : { _tag: "Unfinished", runId: finalRecord.runId }
    ],
    plannedAttempts: facts.plannedAttempts,
    executor:
      facts.acceptedResults.length === 0
        ? { _tag: "NotReached", reason: "NoAcceptedExecutorResult" }
        : { _tag: "Accepted", results: facts.acceptedResults },
    integration:
      facts.sessions.length === 0
        ? { _tag: "NotReached", reason: "NoIntegratorSession" }
        : { _tag: "Observed", sessions: facts.sessions, runs: facts.runs },
    promotion:
      facts.requests.length === 0
        ? { _tag: "NotReached", reason: "NoPromotionRequest" }
        : { _tag: "Observed", requests: facts.requests },
    journal: {
      cursor: { runId: finalRecord.runId, position: finalRecord.position },
      positions: records.map(({ position }) => position)
    }
  }
}

/** Publication validates the complete artifact before the single outside-Q write; failure never retries qualification or cleanup. */
export const publishQualificationEvidence = Effect.fn("Qualification.publishEvidence")(function* (
  container: HermeticFixtureContainer,
  locator: QualificationArtifactLocator,
  input: ProductionMvpQualificationEvidence
) {
  const evidence = yield* Schema.decodeUnknownEffect(ProductionMvpQualificationEvidence, {
    reportInput: false,
    onExcessProperty: "error"
  })(input).pipe(Effect.mapError(() => new QualificationEvidenceFailure({ operation: "ValidateEvidence" })))
  const transcriptDigest = yield* qualificationTranscriptDigest(evidence.transcript.records).pipe(
    Effect.mapError(() => new QualificationEvidenceFailure({ operation: "ValidateEvidence" }))
  )
  if (
    evidence.invocationId !== evidence.fixture.invocationId ||
    evidence.build.sourceBaseSha !== evidence.fixture.sourceBaseSha ||
    evidence.build.builtEntryDigest !== evidence.fixture.builtEntryDigest ||
    !Schema.toEquivalence(QualificationCleanupDisposition)(
      evidence.cleanupDisposition,
      qualificationCleanupDisposition(evidence.githubCleanup, evidence.localCleanup)
    ) ||
    evidence.transcript.records.some(
      (record) => record._tag === "Failure" && record.code !== "delivery.provider_throttled"
    ) ||
    evidence.transcript.digest !== transcriptDigest
  )
    return yield* new QualificationEvidenceFailure({ operation: "ValidateEvidence" })
  const encoded = yield* Schema.encodeUnknownEffect(ProductionMvpQualificationEvidence)(evidence).pipe(
    Effect.mapError(() => new QualificationEvidenceFailure({ operation: "ValidateEvidence" }))
  )
  yield* writeQualificationArtifact(container, locator, JSON.stringify(encoded))
  return locator
})
