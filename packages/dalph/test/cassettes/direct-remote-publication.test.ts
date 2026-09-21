// @effect-diagnostics multipleEffectProvide:off
import {
  GitCommand,
  type GithubGraphqlRequest,
  JournalStore,
  OperationId,
  TrackerGraphReader,
  WorkflowOperation,
  deriveJournalResponsibilityFacts,
  freshWorkflowRunId,
  githubTrackerGraphReaderLayer,
  makeCompleteTaskTrackerFactsObserved,
  nodeGitCommandLayer,
  reduceWorkflowJournalHistory,
  sqliteJournalStoreLayer
} from "@dalph/orchestrator"
import { NodeCrypto, NodeServices } from "@effect/platform-node"
import { it } from "@effect/vitest"
import { Context, Duration, Effect, FileSystem, Layer, MutableList, Option, Schema } from "effect"
import { expect } from "vitest"
import { projectRecordedCassette } from "../../src/cassettes/recorded.js"
import { makeHermeticController } from "../../test-support/production-hermetic-controller.js"
import { createProductionPublicPublicationFixture } from "../../test-support/production-public-publication-fixture.js"
import { auditDirectPublicationSuccessToClose } from "../../test-support/direct-publication-git-audit.js"
import { hermeticGithubClientLayer } from "../../src/application/production-hermetic-provider-bridge.js"
import { contextFor } from "../../src/application/production-hermetic-qualification-attempt-source.js"
import {
  validateGraph,
  validateTrackerFacts
} from "../../src/application/production-hermetic-qualification-fixture-source.js"

class PublicPublicationTimeout extends Schema.TaggedError<PublicPublicationTimeout>()("PublicPublicationTimeout", {
  timeoutMillis: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0))
}) {}

const builtEntry = new URL("../../dist/bin/production-hermetic-qualification.js", import.meta.url).pathname
const fixtureLayer = nodeGitCommandLayer.pipe(Layer.provideMerge(NodeServices.layer), Layer.merge(NodeCrypto.layer))
const diagnosticPath = "/tmp/public-s1-timeout-diagnostic.json"
const diagnosticProviderPath = "/tmp/public-s1-timeout-provider.json"
const diagnosticAuditPath = "/tmp/public-s1-timeout-audit.json"
const githubProviderOperationTags = new Set<GithubGraphqlRequest["_tag"]>([
  "AddBlockedBy",
  "AddIssueComment",
  "AddSubIssue",
  "CloseIssue",
  "FindClaimLabel",
  "CreateClaimLabel",
  "CreateIssue",
  "DeleteIssue",
  "DeleteClaimLabel",
  "ReadIssueDetails",
  "ReadTaskWorkSpecification",
  "ReopenIssue",
  "ResolveRepository",
  "ResolveIssue",
  "ReadIssue",
  "ReadSubIssues",
  "ReadBlockedBy"
])

const awaitWithDiagnostic = <A, E, R, E1, R1, E2, R2, E3, R3, E4, R4>(
  awaited: Effect.Effect<A, E, R>,
  timeoutMillis: number,
  writePrimary: Effect.Effect<void, E1, R1>,
  writeProvider: Effect.Effect<void, E2, R2>,
  stopChild: Effect.Effect<void, E3, R3>,
  writeAudit: Effect.Effect<void, E4, R4>
) =>
  Effect.gen(function* () {
    const result = yield* awaited.pipe(Effect.timeoutOption(Duration.millis(timeoutMillis)))
    if (Option.isSome(result)) return result.value
    yield* writePrimary
    yield* writeProvider
    yield* stopChild
    yield* writeAudit
    return yield* new PublicPublicationTimeout({ timeoutMillis })
  })

const writeBoundedDiagnostic = (path: string, read: Effect.Effect<unknown, unknown, never>) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem
    const result = yield* read.pipe(Effect.timeoutOption(Duration.seconds(2)), Effect.result)
    yield* fs.writeFileString(
      path,
      JSON.stringify(
        result._tag === "Success" && Option.isSome(result.success)
          ? { _tag: "Available", value: result.success.value }
          : { _tag: "Unavailable" },
        null,
        2
      )
    )
  })

const writeDiagnosticsForFailedExit = Effect.fn("PublicS1.writeDiagnosticsForFailedExit")(function* <E, R>(
  childStatus: number,
  diagnostics: ReadonlyArray<Effect.Effect<void, E, R>>
) {
  if (childStatus === 0) return
  for (const diagnostic of diagnostics) yield* diagnostic
})

it.effect("the direct-publication fixture keeps local integration and bare publication Git targets separate", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem
      const git = yield* GitCommand
      const fixture = yield* createProductionPublicPublicationFixture(builtEntry)

      expect(fixture.repository).not.toBe(fixture.remoteRepository)
      expect(yield* fs.exists(fixture.repository)).toBe(true)
      expect(yield* fs.exists(fixture.manifest.commonDirectory)).toBe(true)
      expect(yield* fs.exists(fixture.remoteRepository)).toBe(true)
      expect(yield* fs.exists(fixture.journalDatabase)).toBe(true)
      expect(yield* fs.exists(fixture.configurationPath)).toBe(true)

      const localHead = yield* git.runInWorktree(fixture.repository, ["rev-parse", "HEAD"])
      const remoteHead = yield* git.run(fixture.remoteRepository, ["rev-parse", fixture.remoteRef])
      expect(localHead.exitCode).toBe(0)
      expect(remoteHead.exitCode).toBe(0)
      expect(localHead.stdout.trim()).toBe(fixture.baseSha)
      expect(remoteHead.stdout.trim()).toBe(fixture.baseSha)

      const localGitDirectory = yield* git.runInWorktree(fixture.repository, ["rev-parse", "--git-dir"])
      const remoteGitDirectory = yield* git.run(fixture.remoteRepository, ["rev-parse", "--git-dir"])
      expect(localGitDirectory.exitCode).toBe(0)
      expect(remoteGitDirectory.exitCode).toBe(0)
      expect(localGitDirectory.stdout.trim()).not.toBe(remoteGitDirectory.stdout.trim())
      expect(fixture.baseConfiguration).toMatchObject({
        integrationRef: fixture.remoteRef,
        journalDatabase: fixture.journalDatabase,
        plannedAttemptBaseSha: fixture.baseSha,
        repository: fixture.repository,
        remotePublicationTarget: { branch: fixture.remoteRef, endpoint: fixture.remoteRepository }
      })
    })
  ).pipe(Effect.provide(fixtureLayer))
)

it.live("writes timeout diagnostics before a failed audit and surfaces the timeout", () =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem
    const primary = "/tmp/public-s1-diagnostic-smoke.json"
    const audit = "/tmp/public-s1-diagnostic-smoke-audit.json"
    yield* fs.remove(primary, { force: true })
    yield* fs.remove(audit, { force: true })

    const failure = yield* awaitWithDiagnostic(
      Effect.never,
      10,
      fs.writeFileString(primary, JSON.stringify({ publicRecordTags: ["RunSelected"] })),
      Effect.void,
      Effect.void,
      writeBoundedDiagnostic(audit, Effect.fail("controlled audit failure"))
    ).pipe(Effect.flip)

    expect(failure).toBeInstanceOf(Error)
    expect(JSON.parse(yield* fs.readFileString(primary))).toEqual({ publicRecordTags: ["RunSelected"] })
    expect(JSON.parse(yield* fs.readFileString(audit))).toEqual({ _tag: "Unavailable" })
  }).pipe(Effect.provide(NodeServices.layer))
)

it.live("writes bounded diagnostics for an early failed child exit", () =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem
    const earlyExit = "/tmp/public-s1-diagnostic-early-exit.json"
    yield* fs.remove(earlyExit, { force: true })
    yield* writeDiagnosticsForFailedExit(1, [fs.writeFileString(earlyExit, JSON.stringify({ childStatus: 1 }))])
    expect(JSON.parse(yield* fs.readFileString(earlyExit))).toEqual({ childStatus: 1 })
  }).pipe(Effect.provide(NodeServices.layer))
)

it.effect("reads and qualifies the exact initial A/B graph through the production tracker adapter", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const fixture = yield* createProductionPublicPublicationFixture(builtEntry)
      const controller = yield* makeHermeticController(fixture, { _tag: "Unpaused" })
      const readerLayer = githubTrackerGraphReaderLayer.pipe(
        Layer.provide(hermeticGithubClientLayer(controller.endpoint, fixture.configuration))
      )
      const graph = yield* Effect.gen(function* () {
        return yield* (yield* TrackerGraphReader).read(fixture.configuration.target)
      }).pipe(Effect.provide(readerLayer))
      const context = yield* contextFor(
        fixture.manifest,
        fixture.configuration,
        yield* freshWorkflowRunId(fixture.configuration.target)
      )
      yield* validateGraph(graph.toWire(), context)
      const operation = WorkflowOperation.cases.ReadTrackerGraph.make({
        cause: { _tag: "WorkflowEstablishment" },
        operationId: OperationId.make("01990a72-38c0-7000-8000-000000000099"),
        predecessorOperationIds: [],
        readShape: { _tag: "CompleteTargetClosure", explicitlyCoveredTaskIds: [] },
        target: fixture.configuration.target
      })
      yield* validateTrackerFacts(makeCompleteTaskTrackerFactsObserved(operation, graph), context)

      expect(graph.rootTaskId).toBe(context.taskId)
      expect(graph.taskIds()).toEqual(expect.arrayContaining([context.taskId, context.dependantTaskId]))
      expect((yield* controller.providerSnapshot).operationCounts.length).toBeGreaterThan(0)
    })
  ).pipe(Effect.provide(fixtureLayer))
)

it.live(
  "publishes M before local promotion and task completion, then releases its dependant from a later complete graph",
  () =>
    Effect.scoped(
      Effect.gen(function* () {
        const git = yield* GitCommand
        const fixture = yield* createProductionPublicPublicationFixture(builtEntry)
        const controller = yield* makeHermeticController(fixture, { _tag: "Unpaused" })

        const child = yield* controller.startChild()
        const writePrimaryDiagnostic = Effect.gen(function* () {
          const fs = yield* FileSystem.FileSystem
          const publicRecords = MutableList.toArray(child.recordLog)
          const lastStatus = publicRecords.findLast((record) => record._tag === "CurrentStatus")
          const lastHistory = publicRecords.findLast((record) => record._tag === "HistoricalSnapshot")
          yield* fs.writeFileString(
            diagnosticPath,
            JSON.stringify(
              {
                boundaryTags: MutableList.toArray(controller.boundaryLog).map(({ _tag }) => _tag),
                historicalOccurrenceTags:
                  lastHistory?._tag === "HistoricalSnapshot"
                    ? lastHistory.snapshot.items.slice(-80).map(({ occurrence }) => occurrence._tag)
                    : [],
                publicRecordTags: publicRecords.slice(-40).map(({ _tag }) => _tag),
                statusEntries:
                  lastStatus?._tag === "CurrentStatus" && lastStatus.status._tag === "DeliveryStatusAvailable"
                    ? lastStatus.status.entries
                    : [],
                stderrTail: MutableList.toArray(child.stderrLog)
                  .map((bytes) => new TextDecoder().decode(bytes))
                  .join("")
                  .slice(-4_000)
              },
              null,
              2
            )
          )
        })
        const writeProviderDiagnostic = writeBoundedDiagnostic(
          diagnosticProviderPath,
          controller.providerSnapshot.pipe(Effect.map(({ operationCounts }) => ({ operationCounts })))
        )
        const writeAuditDiagnostic = writeBoundedDiagnostic(
          diagnosticAuditPath,
          Effect.scoped(
            Effect.gen(function* () {
              const journalContext = yield* Layer.build(sqliteJournalStoreLayer({ filename: fixture.journalDatabase }))
              const audit = yield* Context.get(journalContext, JournalStore).auditAll()
              const auditedRun = audit.runs[0]
              const records = auditedRun?.records ?? []
              const reconstructed =
                auditedRun === undefined ? undefined : reduceWorkflowJournalHistory(auditedRun.runId, records)
              return {
                baselineEvents: records.flatMap(({ event }) =>
                  event._tag === "RemoteBaselineReadIntended" || event._tag === "RemoteBaselineObserved" ? [event] : []
                ),
                publicationEvents: records.filter(({ event }) => event._tag.startsWith("RemotePublication")),
                issues: audit.issues,
                journalTags: records.map(({ event }) => event._tag),
                responsibilityFacts:
                  reconstructed?._tag === "ValidWorkflowJournalHistory"
                    ? deriveJournalResponsibilityFacts(reconstructed.runState).map(
                        ({ _tag, disposition, responsibility }) => ({
                          fact: _tag,
                          disposition: disposition._tag,
                          responsibility: responsibility._tag
                        })
                      )
                    : reconstructed,
                trackerReads: records.flatMap(({ event, position }) =>
                  event._tag === "TaskTrackerReadIntentRecorded"
                    ? [
                        {
                          ...(event.operation._tag === "ReadTrackerGraph" ? { cause: event.operation.cause } : {}),
                          operationId: event.operation.operationId,
                          position
                        }
                      ]
                    : []
                ),
                runCount: audit.runs.length
              }
            })
          )
        )
        const childStatus = yield* awaitWithDiagnostic(
          controller.awaitChild(child),
          45_000,
          writePrimaryDiagnostic,
          writeProviderDiagnostic,
          controller.killChild(child).pipe(Effect.asVoid),
          writeAuditDiagnostic
        )
        yield* writeDiagnosticsForFailedExit(childStatus, [
          writePrimaryDiagnostic,
          writeProviderDiagnostic,
          writeAuditDiagnostic
        ])
        const childStderr = MutableList.toArray(child.stderrLog)
          .map((bytes) => new TextDecoder().decode(bytes))
          .join("")
        const providerAfterChild = yield* controller.providerSnapshot
        const trackerAfterChild = yield* controller.finalTrackerFacts

        const journalContext = yield* Layer.build(sqliteJournalStoreLayer({ filename: fixture.journalDatabase }))
        const audit = yield* Context.get(journalContext, JournalStore).auditAll()
        expect(audit.issues).toEqual([])
        expect(
          audit.runs,
          `${childStderr}\nprovider counts: ${JSON.stringify(providerAfterChild.operationCounts)}`
        ).toHaveLength(1)
        const records = audit.runs[0]?.records ?? []
        const cassette = yield* projectRecordedCassette(records)
        const tags = cassette.entries.map((entry) => entry._tag)
        const trackerFactsDiagnostics = records.flatMap(({ event }) =>
          event._tag === "TaskTrackerFactsObserved" ? [JSON.stringify(event.observation)] : []
        )
        expect(
          childStatus,
          `${childStderr}\njournal tags: ${tags.join(", ")}\ntracker facts: ${trackerFactsDiagnostics.join(", ")}`
        ).toBe(0)

        expect(tags.filter((tag) => tag === "WorkflowRunBegan")).toHaveLength(1)
        expect(
          records.filter(
            ({ event }) =>
              event._tag === "PlannedAttemptExecutorWorkResponsibilityBegan" &&
              event.plannedAttempt.taskId === trackerAfterChild.graph.rootTaskId
          )
        ).toHaveLength(1)
        expect(
          records.filter(
            ({ event }) =>
              event._tag === "PlannedAttemptExecutorWorkResponsibilityBegan" &&
              event.plannedAttempt.taskId === trackerAfterChild.graph.dependantTaskId
          )
        ).toHaveLength(1)

        const publicationIndex = tags.indexOf("RemotePublicationSucceeded")
        const promotionIndex = tags.indexOf("TargetPromotionObservedSuccess")
        const completionIndex = tags.indexOf("IntegrationFinalitySettled")
        expect(publicationIndex).toBeGreaterThan(-1)
        expect(promotionIndex).toBeGreaterThan(publicationIndex)
        expect(completionIndex).toBeGreaterThan(promotionIndex)
        expect(
          tags.slice(publicationIndex + 1, promotionIndex).filter((tag) => tag === "TaskTrackerReadInitiated")
        ).toEqual([])

        const replacementIndex = tags.indexOf("CompletionClaimReplacementIntended")
        const closeIndex = tags.indexOf("CompletionTaskIntended")
        expect(replacementIndex).toBeGreaterThan(promotionIndex)
        expect(closeIndex).toBeGreaterThan(replacementIndex)

        const publication = records.find(
          ({ event }) =>
            event._tag === "RemotePublicationSucceeded" &&
            event.correlation.qualifiedCandidate.run.session.plannedAttempt.taskId ===
              trackerAfterChild.graph.rootTaskId
        )
        if (publication?.event._tag !== "RemotePublicationSucceeded")
          return yield* Effect.die("public S1 did not retain exact publication proof")
        const candidate = publication.event.correlation.qualifiedCandidate
        expect(publication.event.correlation.target).toEqual(fixture.configuration.remotePublicationTarget)
        expect(publication.event.proof).toEqual({
          _tag: "PushApplied",
          attemptOrdinal: 1,
          remoteHead: candidate.candidateCommit
        })
        expect(candidate.directParents).toEqual([
          candidate.run.session.expectedTargetHead,
          candidate.run.session.acceptedResult.commit
        ])
        expect(candidate.run.session.expectedTargetHead).toBe(fixture.baseSha)

        for (const taskId of [trackerAfterChild.graph.rootTaskId, trackerAfterChild.graph.dependantTaskId]) {
          const gitAudit = auditDirectPublicationSuccessToClose(records, taskId)
          expect(gitAudit._tag).toBe("Complete")
          if (gitAudit._tag !== "Complete") return yield* Effect.die(`public S1 lacks Git audit bounds for ${taskId}`)
          expect(gitAudit.boundaries.filter(({ kind }) => kind === "LocalTargetPromotion")).not.toEqual([])
          expect(gitAudit.boundaries.filter(({ kind }) => kind === "LocalCandidateAncestryRead")).not.toEqual([])
          expect(
            gitAudit.boundaries.filter(({ kind }) => kind === "RemotePublication" || kind === "RemoteRead")
          ).toEqual([])
        }

        const rootGitAudit = auditDirectPublicationSuccessToClose(records, trackerAfterChild.graph.rootTaskId)
        if (rootGitAudit._tag !== "Complete") return yield* Effect.die("public S1 lacks the root Git audit bounds")
        const prePublicationRemoteRead = records.find(
          ({ event }) =>
            event._tag === "RemotePublicationAdmissionReadIntended" || event._tag === "RemoteBaselineReadIntended"
        )
        if (prePublicationRemoteRead === undefined)
          return yield* Effect.die("public S1 lacks its controlled pre-publication remote read")
        const negativeControl = auditDirectPublicationSuccessToClose(
          records.toSpliced(rootGitAudit.closeIndex, 0, prePublicationRemoteRead),
          trackerAfterChild.graph.rootTaskId
        )
        expect(negativeControl._tag).toBe("Complete")
        if (negativeControl._tag !== "Complete")
          return yield* Effect.die("public S1 negative Git audit lost its bounds")
        expect(negativeControl.boundaries.filter(({ kind }) => kind === "RemoteRead")).not.toEqual([])

        const remoteHead = yield* git.run(fixture.remoteRepository, ["rev-parse", fixture.remoteRef])
        const localHead = yield* git.runInWorktree(fixture.repository, ["rev-parse", fixture.remoteRef])
        expect(remoteHead.exitCode).toBe(0)
        expect(localHead.exitCode).toBe(0)
        const lastPublication = records.findLast(({ event }) => event._tag === "RemotePublicationSucceeded")
        if (lastPublication?.event._tag !== "RemotePublicationSucceeded")
          return yield* Effect.die("public S1 did not retain final publication proof")
        expect(remoteHead.stdout.trim()).toBe(lastPublication.event.correlation.qualifiedCandidate.candidateCommit)
        expect(localHead.stdout.trim()).toBe(lastPublication.event.correlation.qualifiedCandidate.candidateCommit)

        for (const cleanupTag of [
          "WorktreeCleanupSettled",
          "BranchCleanupSettled",
          "IntegratorCandidateCleanupSettled"
        ] as const)
          expect(tags.indexOf(cleanupTag)).toBeGreaterThan(closeIndex)
        expect(tags.at(-1)).toBe("WorkflowRunTerminated")

        const laterCompletedGraphIndex = cassette.entries.findIndex((entry) => {
          if (
            entry._tag !== "TaskTrackerFactsObserved" ||
            (entry.evidence._tag !== "CompleteTaskTrackerFacts" &&
              entry.evidence._tag !== "UnchangedTaskTrackerFactsReconfirmed")
          )
            return false
          return entry.evidence.factFamilies.some(
            (family) =>
              "lifecycles" in family &&
              family.lifecycles.some(
                ({ lifecycle, taskId }) =>
                  taskId === trackerAfterChild.graph.rootTaskId && lifecycle._tag === "CompletedSuccessfully"
              )
          )
        })
        const dependantReleaseIndex = cassette.entries.findIndex(
          (entry) =>
            entry._tag === "TaskAttemptPlanned" &&
            entry.operation.plannedAttempt.taskId === trackerAfterChild.graph.dependantTaskId
        )
        expect(laterCompletedGraphIndex).toBeGreaterThan(completionIndex)
        expect(dependantReleaseIndex).toBeGreaterThan(laterCompletedGraphIndex)

        const provider = providerAfterChild
        const githubProviderTransportCount = provider.operationCounts.reduce(
          (total, operation) =>
            total +
            (githubProviderOperationTags.has(operation.tag as GithubGraphqlRequest["_tag"]) ? operation.count : 0),
          0
        )
        // The 140-request qualification circuit is only headroom for this controlled
        // two-task journey. Its terminal tracker traffic must stay close to the 120
        // ordinary-production default and cannot conceal a read/retry loop.
        expect(githubProviderTransportCount).toBeLessThanOrEqual(130)
        expect(provider.taskLifecycle).toBe("Completed")
        expect(provider.dependantTaskLifecycle).toBe("Completed")
        expect(provider.activeClaimCount).toBe(0)
        expect(provider.completeGraphObservationCount).toBeGreaterThan(0)
        expect(provider.dependantReadyAfterCompleteGraph).toBe(true)
        const completedGraphStart = provider.graphObservations.findIndex(
          (observation) => observation.rootLifecycle === "Completed"
        )
        expect(completedGraphStart).toBeGreaterThan(-1)
        expect(
          provider.graphObservations
            .slice(0, completedGraphStart)
            .every(({ rootLifecycle }) => rootLifecycle === "Open")
        ).toBe(true)
        expect(
          provider.graphObservations
            .slice(completedGraphStart)
            .every(({ rootLifecycle }) => rootLifecycle === "Completed")
        ).toBe(true)
        expect(MutableList.toArray(controller.boundaryLog).map((boundary) => boundary._tag)).toContain(
          "CompletionResponse"
        )
      })
    ).pipe(Effect.provide(fixtureLayer)),
  60_000
)
