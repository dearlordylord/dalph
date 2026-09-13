/* eslint-disable import/no-nodejs-modules -- Qualification selects an exact artifact outside Q and measures the actual source/lockfile locations. */
import nodePath from "node:path"
import { createHash } from "node:crypto"
import { NodeCrypto, NodeServices } from "@effect/platform-node"
import { it } from "@effect/vitest"
import { GitCommitSha, GitRepositoryLocator, makeTaskWorkSpecification } from "@dalph/contracts"
import {
  GitCommand,
  githubTaskIdFor,
  CompletionTaskRequest,
  JournalDatabaseLocator,
  JournalStore,
  nodeGitCommandLayer,
  sqliteJournalStoreLayer
} from "@dalph/orchestrator"
import { Clock, Context, Crypto, Effect, FileSystem, Layer, MutableList, Queue, Schema } from "effect"
import { githubClaimLabelNameFor } from "../../../orchestrator/src/authorities/task-tracker/github/claim-mutation.js"
import { expect } from "vitest"
import { createHermeticFixture } from "../../test-support/production-hermetic-fixture.js"
import {
  makeHermeticController,
  type HermeticController,
  type HermeticControllerFixture,
  type HermeticPublicChild
} from "../../test-support/production-hermetic-controller.js"
import { disposeHermeticFixture } from "../../test-support/production-hermetic-fixture-cleanup.js"
import { cleanupDisposableGithubQualification } from "../../test-support/disposable-github-qualification-cleanup.js"
import {
  hermeticQualificationPublicTaskSpecification,
  hermeticQualificationTrackerIdentity
} from "./production-hermetic-contract.js"
import {
  completeQualificationEvidence,
  ProductionMvpQualificationEvidence,
  QualificationArtifactLocator
} from "../../test-support/production-mvp-qualification-evidence.js"
import { encodeProductionCliRecord } from "./production-cli.js"

const builtEntry = new URL("../../dist/bin/production-hermetic-qualification.js", import.meta.url).pathname
const fixtureLayer = nodeGitCommandLayer.pipe(Layer.provideMerge(NodeServices.layer), Layer.merge(NodeCrypto.layer))
const sourceBaseSha = GitCommitSha.make("06d1661f8a2af9a65022e3807643e3f58b5ab969")

const publishEvidence = Effect.fn("HermeticQualification.publishEvidence")(function* (
  fixture: HermeticControllerFixture,
  controller: HermeticController,
  scenario: ProductionMvpQualificationEvidence["scenario"],
  startedAt: string,
  children: ReadonlyArray<HermeticPublicChild>
) {
  const child = children.at(-1)
  if (child === undefined) return yield* Effect.die("qualification requires its actual owned child")
  const artifact = QualificationArtifactLocator.make(
    nodePath.join(nodePath.dirname(fixture.container), `${nodePath.basename(fixture.container)}.qualification.json`)
  )
  const fs = yield* FileSystem.FileSystem
  const git = yield* GitCommand
  const sourceRepository = GitRepositoryLocator.make(
    nodePath.resolve(new URL("../../../../", import.meta.url).pathname)
  )
  const lockfile = new URL("../../../../pnpm-lock.yaml", import.meta.url).pathname
  const sourceHead = yield* git.runInWorktree(sourceRepository, ["rev-parse", "HEAD"])
  expect(sourceHead.exitCode).toBe(0)
  const digestOriginalFile = (locator: string) =>
    fs.readFile(locator).pipe(Effect.map((bytes) => createHash("sha256").update(bytes).digest("hex")))
  const originalDigests = {
    builtEntryDigest: yield* digestOriginalFile(fixture.manifest.builtEntry),
    lockfileDigest: yield* digestOriginalFile(lockfile),
    configurationDigest: yield* digestOriginalFile(fixture.configurationPath)
  }
  const journal = yield* readJournal(fixture, child)
  const finalRecord = journal.at(-1)
  if (finalRecord === undefined) return yield* Effect.die("qualification requires its original committed journal")
  const selected = yield* selectedOf(child)
  const plans = journal.flatMap(({ event }) =>
    event._tag === "TaskAttemptPlanned" ? [event.operation.plannedAttempt] : []
  )
  const firstPlan = plans[0]
  if (firstPlan === undefined) return yield* Effect.die("qualification requires its original task attempt")
  const termination = journal.findLast(({ event }) => event._tag === "WorkflowRunTerminated")
  const acceptedResults = journal.flatMap(({ event }) =>
    event._tag === "PlannedAttemptExecutorWorkReported" &&
    event.report._tag === "ExecutorWorkTerminal" &&
    event.report.result._tag === "Accepted"
      ? [{ attemptId: event.report.correlation.attemptId, commit: event.report.result.acceptedResult.commit }]
      : []
  )
  const sessions = journal.flatMap(({ event }) => (event._tag === "IntegratorSessionFixed" ? [event.correlation] : []))
  const integratorRuns = journal.flatMap(({ event }) => (event._tag === "IntegratorRunStarted" ? [event.run] : []))
  const promotions = journal.flatMap(({ event }) =>
    event._tag === "TargetPromotionIntended" ? [event.correlation] : []
  )
  const originalTracker = yield* controller.finalTrackerFacts
  const originalCreation = yield* controller.providerCreationManifest
  const originalProcesses = yield* controller.processOutcomes
  const originalBoundaries = MutableList.toArray(controller.boundaryLog)
  const originalRecords = children.flatMap((owned) => MutableList.toArray(owned.recordLog))
  const originalTranscriptDigest = createHash("sha256")
    .update(originalRecords.map((record) => `${encodeProductionCliRecord(record)}\n`).join(""))
    .digest("hex")
  const originalTarget = yield* git.runInWorktree(fixture.manifest.repository, [
    "rev-parse",
    fixture.manifest.integrationRef
  ])
  expect(originalTarget.exitCode).toBe(0)
  const outcome = yield* completeQualificationEvidence(fixture, controller, {
    scenario,
    startedAt,
    sourceRepository,
    lockfile,
    children,
    journal,
    artifact
  })
  if (outcome._tag === "PublicationFailed")
    return yield* Effect.die(new Error(`qualification publication failed: ${outcome.failure.operation}`))
  expect(outcome._tag).toBe("Published")
  const evidence = outcome.evidence
  const published = yield* Schema.decodeUnknownEffect(Schema.fromJsonString(ProductionMvpQualificationEvidence), {
    reportInput: false,
    onExcessProperty: "error"
  })(yield* fs.readFileString(artifact))
  expect(published).toEqual(evidence)
  expect(published.build.sourceSha).toBe(sourceHead.stdout.trim())
  expect(published.build).toMatchObject(originalDigests)
  expect(published.fixture).toEqual(fixture.manifest)
  expect(published.taskId).toBe(firstPlan.taskId)
  expect(published.plannedAttempts).toEqual(plans)
  expect(published.runs).toEqual([
    termination?.event._tag === "WorkflowRunTerminated"
      ? { _tag: "Terminated", runId: selected.runId, disposition: termination.event.disposition }
      : { _tag: "Unfinished", runId: selected.runId }
  ])
  expect(published.processes).toEqual(originalProcesses)
  expect(published.transcript).toEqual({ records: originalRecords, digest: originalTranscriptDigest })
  expect(published.executor).toEqual(
    acceptedResults.length === 0
      ? { _tag: "NotReached", reason: "NoAcceptedExecutorResult" }
      : { _tag: "Accepted", results: acceptedResults }
  )
  expect(published.integration).toEqual(
    sessions.length === 0
      ? { _tag: "NotReached", reason: "NoIntegratorSession" }
      : { _tag: "Observed", sessions, runs: integratorRuns }
  )
  expect(published.promotion).toEqual(
    promotions.length === 0
      ? { _tag: "NotReached", reason: "NoPromotionRequest" }
      : { _tag: "Observed", requests: promotions }
  )
  expect(published.journal).toEqual({
    cursor: { runId: selected.runId, position: finalRecord.position },
    positions: journal.map(({ position }) => position)
  })
  expect(published.boundaries).toEqual(originalBoundaries)
  expect(published.finalTargetHead).toBe(originalTarget.stdout.trim())
  expect(published.finalTracker).toEqual({
    original: originalCreation,
    issuePresent: originalTracker.issuePresent,
    lifecycle: originalTracker.taskLifecycle,
    claims: originalTracker.claims
  })
  expect(published.cleanupDisposition).toEqual(outcome.cleanupDisposition)
  if (published.localCleanup._tag === "RetainedFixture") {
    expect(outcome.cleanupDisposition._tag).toBe("QualificationCleanupIncomplete")
    if (outcome.cleanupDisposition._tag === "QualificationCleanupIncomplete") {
      expect(outcome.cleanupDisposition.github).toEqual(published.githubCleanup)
      expect(outcome.cleanupDisposition.local).toEqual(published.localCleanup)
      expect(outcome.cleanupDisposition.localInspectionCommands.map(({ resource }) => resource)).toEqual(
        published.localCleanup.retained
      )
      for (const { command, resource } of outcome.cleanupDisposition.localInspectionCommands) {
        expect(fixture.creation.createdResources).toContainEqual(resource)
        expect(command).toContain("lstatSync(process.argv[1])")
        expect(command).toContain(`-- '${resource.locator}'`)
      }
    }
  } else {
    expect(outcome.cleanupDisposition).toEqual({
      _tag: "QualificationCleanupComplete",
      retainedContainer: fixture.container,
      reason: "EmptyDisposableContainerIntentionallyRetained"
    })
  }
  expect(evidence.build.sourceBaseSha).toBe(sourceBaseSha)
  expect(evidence.build.sourceSha).not.toBe(fixture.manifest.baseSha)
  expect(evidence.formal).toEqual({ _tag: "NotSupplied", reason: "LocalHermeticInvocation" })
  expect(evidence.githubCleanup.retained).toEqual([])
  expect(evidence.githubCleanup.removed.some((resource) => resource._tag === "Issue")).toBe(true)
  expect(yield* controller.activeRequestCount).toBe(0)
  expect(yield* controller.activeRegistrationCount).toBe(0)
  return evidence.localCleanup
})

const selectedOf = Effect.fn("HermeticQualification.selectedRun")(function* (child: HermeticPublicChild) {
  const selected = MutableList.toArray(child.recordLog).find((record) => record._tag === "RunSelected")
  if (selected === undefined) return yield* Effect.die("the actual child must select a Run")
  return selected
})

const readJournal = Effect.fn("HermeticQualification.readJournal")(function* (
  fixture: HermeticControllerFixture,
  child: HermeticPublicChild
) {
  return yield* Effect.scoped(
    Effect.gen(function* () {
      const storage = yield* Layer.build(
        sqliteJournalStoreLayer({ filename: JournalDatabaseLocator.make(fixture.manifest.journalDatabase) })
      )
      return yield* Context.get(storage, JournalStore).read((yield* selectedOf(child)).runId)
    })
  )
})

const awaitWaitingStatus = Effect.fn("HermeticQualification.awaitWaitingStatus")(function* (
  child: HermeticPublicChild
) {
  for (;;) {
    const record = yield* Queue.take(child.records)
    if (record._tag !== "CurrentStatus" || record.status._tag !== "DeliveryStatusAvailable") continue
    if (record.status.entries.some(({ classification }) => classification === "Waiting")) return record.status
  }
})

const closeCount = (counts: ReadonlyArray<{ readonly tag: string; readonly count: number }>) =>
  counts.find(({ tag }) => tag === "CloseIssue")?.count ?? 0

it.live(
  "rejects the changed original tracker source before unsafe publication and retains its changed creation identity after joined teardown",
  () =>
    Effect.scoped(
      Effect.gen(function* () {
        const fixture = yield* createHermeticFixture(builtEntry, sourceBaseSha)
        const controller = yield* makeHermeticController(fixture, { _tag: "Unpaused" })
        const original = yield* controller.providerCreationManifest
        const specification = makeTaskWorkSpecification({
          taskId: githubTaskIdFor(
            hermeticQualificationTrackerIdentity.repositoryNodeId,
            hermeticQualificationTrackerIdentity.issueNodeId
          ),
          title: hermeticQualificationPublicTaskSpecification.title,
          body: "qualification-private-source-sentinel"
        })
        yield* controller.setPublicTaskSpecification(specification)
        const child = yield* controller.startChild()
        expect(yield* controller.awaitChild(child).pipe(Effect.timeout("20 seconds"))).toBe(1)
        const records = MutableList.toArray(child.recordLog)
        expect(JSON.stringify(records).includes(specification.body)).toBe(false)
        expect(JSON.stringify(records).includes(specification.fingerprint)).toBe(false)
        expect(records.some((record) => record._tag === "Failure")).toBe(false)
        const stderr = MutableList.toArray(child.stderrLog)
          .map((bytes) => new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes))
          .join("")
        expect(stderr === "Dalph failed because of an unexpected runtime defect.\n").toBe(true)
        yield* controller.stopTransport
        expect(yield* controller.ownedChildrenStopped).toBe(true)
        expect(yield* controller.activeRequestCount).toBe(0)
        expect(yield* controller.activeRegistrationCount).toBe(0)
        const journal = yield* readJournal(fixture, child)
        expect(journal.some(({ event }) => event._tag === "WorkflowRunTerminated")).toBe(false)
        const created = yield* controller.providerCreationManifest
        expect(created.invocationId).toBe(original.invocationId)
        expect(created.repository).toStrictEqual(original.repository)
        expect(created.resources.filter((resource) => resource._tag === "Issue")).toStrictEqual(original.resources)
        const labels = created.resources.filter((resource) => resource._tag === "Label")
        const claims = journal.flatMap(({ event }) => (event._tag === "TaskClaimAcquired" ? [event.claim] : []))
        expect(labels).toHaveLength(1)
        expect(claims).toHaveLength(1)
        const label = labels[0]
        const claim = claims[0]
        if (label === undefined || claim === undefined)
          return yield* Effect.die("qualification requires its successful original claim creation")
        expect(label.nodeId).toBe(`hermetic-label:${claim.operationId}`)
        expect(label.name).toBe(yield* githubClaimLabelNameFor(yield* Crypto.Crypto, claim.taskId))
        expect(label.fingerprint).toBe(
          createHash("sha256").update(["1", claim.operationId, claim.owner, claim.token].join("|")).digest("hex")
        )
        expect((yield* controller.finalTrackerFacts).claims).toStrictEqual(labels)
        expect(
          (yield* controller.providerSnapshot).operationCounts.find(({ tag }) => tag === "CreateClaimLabel")?.count
        ).toBe(1)
        const githubCleanup = yield* cleanupDisposableGithubQualification(
          created,
          { invocationId: fixture.manifest.invocationId, repository: original.repository },
          controller.githubCleanupAdapter
        )
        const issue = original.resources.find((resource) => resource._tag === "Issue")
        expect(issue).toBeDefined()
        const retainedIssue = githubCleanup.retained.filter(({ resource }) => resource._tag === "Issue")
        expect(retainedIssue).toHaveLength(1)
        expect(retainedIssue[0]?.resource).toStrictEqual(issue)
        expect(retainedIssue[0]?.reason).toBe("ChangedIdentity")
        expect(githubCleanup.removed.some((resource) => resource._tag === "Issue")).toBe(false)
        expect((yield* controller.finalTrackerFacts).issuePresent).toBe(true)
        expect(githubCleanup.removed).toStrictEqual(labels)
        expect(githubCleanup.alreadyAbsent).toStrictEqual([])
        expect(yield* controller.providerCreationManifest).toStrictEqual(created)
        expect((yield* controller.finalTrackerFacts).claims).toStrictEqual([])
        const localCleanup = yield* disposeHermeticFixture(fixture, controller)
        expect(localCleanup).toEqual({
          _tag: "RetainedFixture",
          cause: { _tag: "UnfinishedRun" },
          retained: fixture.creation.createdResources,
          removed: [],
          retainedContainer: fixture.container
        })
        expect(yield* controller.processOutcomes).toEqual([{ _tag: "Exit", processId: child.handle.pid, status: 1 }])
        const counts = (yield* controller.providerSnapshot).operationCounts
        expect(counts.find(({ tag }) => tag === "QualificationReadIssue")?.count).toBe(1)
        expect(counts.find(({ tag }) => tag === "QualificationDeleteIssue")).toBeUndefined()
        expect(counts.find(({ tag }) => tag === "QualificationDeleteLabel")?.count).toBe(1)
        expect(counts.find(({ tag }) => tag === "QualificationReadLabel")?.count).toBe(2)
        expect(counts.find(({ tag }) => tag === "CodexStartTurn")).toBeUndefined()
      })
    ).pipe(Effect.provide(fixtureLayer)),
  { timeout: 60_000 }
)

it.live(
  "artifact write failure after actual cleanup retains the original Run, process and exact cleanup receipts without retry",
  () =>
    Effect.scoped(
      Effect.gen(function* () {
        const startedAt = yield* Clock.currentTimeMillis.pipe(Effect.map((millis) => new Date(millis).toISOString()))
        const fixture = yield* createHermeticFixture(builtEntry, sourceBaseSha)
        const controller = yield* makeHermeticController(fixture, { _tag: "Unpaused" })
        const child = yield* controller.startChild()
        expect(yield* controller.awaitChild(child).pipe(Effect.timeout("20 seconds"))).toBe(0)
        const journal = yield* readJournal(fixture, child)
        const selected = yield* selectedOf(child)
        const snapshot = yield* controller.providerSnapshot
        const artifact = QualificationArtifactLocator.make(
          nodePath.join(
            nodePath.dirname(fixture.container),
            `${fixture.manifest.invocationId}-missing`,
            "qualification.json"
          )
        )
        const fs = yield* FileSystem.FileSystem
        expect(yield* fs.exists(nodePath.dirname(artifact))).toBe(false)
        const outcome = yield* completeQualificationEvidence(fixture, controller, {
          scenario: "ProductionHappy",
          startedAt,
          sourceRepository: GitRepositoryLocator.make(
            nodePath.resolve(new URL("../../../../", import.meta.url).pathname)
          ),
          lockfile: new URL("../../../../pnpm-lock.yaml", import.meta.url).pathname,
          children: [child],
          journal,
          artifact
        })
        expect(outcome._tag).toBe("PublicationFailed")
        expect(Object.hasOwn(outcome, "artifact")).toBe(false)
        expect(outcome.cleanupDisposition._tag).toBe("QualificationCleanupIncomplete")
        if (outcome.cleanupDisposition._tag === "QualificationCleanupIncomplete") {
          expect(outcome.cleanupDisposition.github).toEqual(outcome.evidence.githubCleanup)
          expect(outcome.cleanupDisposition.local).toEqual(outcome.evidence.localCleanup)
          expect(outcome.cleanupDisposition.localInspectionCommands.map(({ resource }) => resource)).toEqual(
            fixture.creation.createdResources
          )
        }
        if (outcome._tag === "PublicationFailed") {
          expect(outcome.failure.operation).toBe("WriteArtifact")
          expect(JSON.parse(JSON.stringify(outcome.failure))).toEqual({
            operation: "WriteArtifact",
            _tag: "QualificationEvidenceFailure"
          })
        }
        expect(yield* fs.exists(artifact)).toBe(false)
        expect(outcome.evidence.runs).toEqual([{ _tag: "Terminated", runId: selected.runId, disposition: "Completed" }])
        expect(outcome.evidence.processes).toEqual([{ _tag: "Exit", processId: child.handle.pid, status: 0 }])
        expect(outcome.evidence.githubCleanup.removed.filter((resource) => resource._tag === "Issue")).toHaveLength(1)
        expect(outcome.evidence.githubCleanup.retained).toEqual([])
        expect(outcome.evidence.localCleanup).toEqual({
          _tag: "RetainedFixture",
          cause: {
            _tag: "ChangedIdentity",
            resource: { _tag: "PrivateStore", locator: fixture.manifest.privateStore }
          },
          retained: fixture.creation.createdResources,
          removed: [],
          retainedContainer: fixture.container
        })
        const after = yield* controller.providerSnapshot
        expect(closeCount(after.operationCounts)).toBe(closeCount(snapshot.operationCounts))
        expect(after.operationCounts.find(({ tag }) => tag === "QualificationDeleteIssue")?.count).toBe(1)
        expect(after.operationCounts.find(({ tag }) => tag === "QualificationReadIssue")?.count).toBe(2)
        expect(yield* controller.providerSnapshot).toEqual(after)
        expect(yield* controller.activeRequestCount).toBe(0)
        expect(yield* controller.activeRegistrationCount).toBe(0)
        expect(yield* controller.ownedChildrenStopped).toBe(true)
      })
    ).pipe(Effect.provide(fixtureLayer)),
  { timeout: 60_000 }
)

it.live(
  "built hermetic production CLI uses real SQLite and local Git with controlled outer providers",
  () =>
    Effect.scoped(
      Effect.gen(function* () {
        const startedAt = yield* Clock.currentTimeMillis.pipe(Effect.map((millis) => new Date(millis).toISOString()))
        const fixture = yield* createHermeticFixture(builtEntry, sourceBaseSha)
        const controller = yield* makeHermeticController(fixture, {
          _tag: "PauseAt",
          boundary: "PromotionCompareAndSet"
        })
        const child = yield* controller.startChild()
        const boundary = yield* controller
          .awaitBoundary("PromotionCompareAndSet", child)
          .pipe(Effect.timeout("20 seconds"))
        expect(boundary._tag).toBe("PromotionCompareAndSet")
        if (boundary._tag !== "PromotionCompareAndSet") return yield* Effect.die("wrong concrete promotion boundary")
        expect(yield* controller.activeRequestCount).toBeGreaterThan(0)
        const liveDisposal = yield* disposeHermeticFixture(fixture, controller)
        expect(liveDisposal._tag).toBe("RetainedFixture")
        if (liveDisposal._tag === "RetainedFixture") {
          expect(liveDisposal.cause._tag).toBe("ChildrenRunning")
          expect(liveDisposal.retained).toEqual(fixture.creation.createdResources)
          expect(liveDisposal.removed).toEqual([])
        }
        const git = yield* GitCommand
        const before = yield* git.runInWorktree(fixture.manifest.repository, [
          "rev-parse",
          fixture.manifest.integrationRef
        ])
        expect(before.stdout.trim()).toBe(boundary.expectedTargetHead)
        expect(boundary.expectedTargetHead).toBe(fixture.manifest.baseSha)
        const parents = yield* git.runInWorktree(fixture.manifest.repository, [
          "show",
          "-s",
          "--format=%P",
          boundary.candidateCommit
        ])
        expect(parents.stdout.trim().split(" ")).toHaveLength(2)
        expect(parents.stdout.trim().split(" ")[0]).toBe(fixture.manifest.baseSha)
        yield* controller.releaseBoundary()
        const exitCode = yield* controller.awaitChild(child).pipe(Effect.timeout("20 seconds"))
        expect(exitCode).toBe(0)
        const after = yield* git.runInWorktree(fixture.manifest.repository, [
          "rev-parse",
          fixture.manifest.integrationRef
        ])
        expect(after.stdout.trim()).toBe(boundary.candidateCommit)
        const records = MutableList.toArray(child.recordLog)
        expect(records.some((record) => record._tag === "CurrentStatus")).toBe(true)
        expect((yield* controller.providerSnapshot).taskLifecycle).toBe("Completed")
        const journal = yield* readJournal(fixture, child)
        expect(journal.filter(({ event }) => event._tag === "WorkflowRunBegan")).toHaveLength(1)
        expect(journal.filter(({ event }) => event._tag === "TargetPromotionObservedSuccess")).toHaveLength(1)
        const acceptedCommits = journal.flatMap(({ event }) =>
          event._tag === "PlannedAttemptExecutorWorkReported" &&
          event.report._tag === "ExecutorWorkTerminal" &&
          event.report.result._tag === "Accepted"
            ? [event.report.result.acceptedResult.commit]
            : []
        )
        expect(acceptedCommits).toHaveLength(1)
        expect(parents.stdout.trim().split(" ")).toEqual([fixture.manifest.baseSha, acceptedCommits[0]])
        const disposal = yield* publishEvidence(fixture, controller, "ProductionHappy", startedAt, [child])
        expect(yield* controller.activeRequestCount).toBe(0)
        expect(disposal._tag).toBe("RetainedFixture")
        if (disposal._tag === "RetainedFixture") {
          expect(disposal.cause._tag).toBe("ChangedIdentity")
          if (disposal.cause._tag === "ChangedIdentity") expect(disposal.cause.resource._tag).toBe("PrivateStore")
          expect(disposal.retained).toEqual(fixture.creation.createdResources)
        }
      })
    ).pipe(Effect.provide(fixtureLayer)),
  { timeout: 60_000 }
)

it.live(
  "completion-response cut kills P1 and recovers the same Run with parent provider state",
  () =>
    Effect.scoped(
      Effect.gen(function* () {
        const startedAt = yield* Clock.currentTimeMillis.pipe(Effect.map((millis) => new Date(millis).toISOString()))
        const fixture = yield* createHermeticFixture(builtEntry, sourceBaseSha)
        const controller = yield* makeHermeticController(fixture, { _tag: "PauseAt", boundary: "CompletionResponse" })
        const first = yield* controller.startChild()
        const boundary = yield* controller.awaitBoundary("CompletionResponse", first).pipe(Effect.timeout("20 seconds"))
        expect(boundary._tag).toBe("CompletionResponse")
        const before = yield* controller.providerSnapshot
        expect(yield* controller.activeRequestCount).toBeGreaterThan(0)
        expect(before.taskLifecycle).toBe("Completed")
        expect(closeCount(before.operationCounts)).toBe(1)
        const original = yield* selectedOf(first)
        yield* controller.killChild(first)
        yield* controller.releaseBoundary()
        const second = yield* controller.startChild()
        expect(yield* controller.awaitChild(second).pipe(Effect.timeout("20 seconds"))).toBe(0)
        expect(yield* selectedOf(second)).toMatchObject({ runId: original.runId, selection: "Recovered" })
        expect(closeCount((yield* controller.providerSnapshot).operationCounts)).toBe(1)
        const journal = yield* readJournal(fixture, second)
        expect(journal.filter(({ event }) => event._tag === "WorkflowRunBegan")).toHaveLength(1)
        expect(journal.filter(({ event }) => event._tag === "TargetPromotionObservedSuccess")).toHaveLength(1)
        expect(
          (yield* publishEvidence(fixture, controller, "CompletionResponse", startedAt, [first, second]))._tag
        ).toBe("RetainedFixture")
        expect(yield* controller.activeRequestCount).toBe(0)
      })
    ).pipe(Effect.provide(fixtureLayer)),
  { timeout: 60_000 }
)

it.live(
  "promotion-CAS cut preserves a real foreign head and waits until graceful Exit",
  () =>
    Effect.scoped(
      Effect.gen(function* () {
        const startedAt = yield* Clock.currentTimeMillis.pipe(Effect.map((millis) => new Date(millis).toISOString()))
        const fixture = yield* createHermeticFixture(builtEntry, sourceBaseSha)
        const controller = yield* makeHermeticController(fixture, {
          _tag: "PauseAt",
          boundary: "PromotionCompareAndSet"
        })
        const child = yield* controller.startChild()
        const boundary = yield* controller
          .awaitBoundary("PromotionCompareAndSet", child)
          .pipe(Effect.timeout("20 seconds"))
        if (boundary._tag !== "PromotionCompareAndSet") return yield* Effect.die("wrong concrete CAS cut")
        const git = yield* GitCommand
        const foreign = yield* git.runInWorktree(fixture.manifest.repository, [
          "commit-tree",
          `${fixture.manifest.baseSha}^{tree}`,
          "-p",
          fixture.manifest.baseSha,
          "-m",
          "foreign head"
        ])
        expect(foreign.exitCode).toBe(0)
        const foreignHead = GitCommitSha.make(foreign.stdout.trim())
        const moved = yield* git.runInWorktree(fixture.manifest.repository, [
          "update-ref",
          fixture.manifest.integrationRef,
          foreignHead,
          fixture.manifest.baseSha
        ])
        expect(moved.exitCode).toBe(0)
        yield* controller.releaseBoundary()
        const stale = yield* Effect.gen(function* () {
          for (;;) {
            const record = yield* Queue.take(child.records)
            if (record._tag !== "HistoricalSnapshot") continue
            const observed = record.snapshot.items.find(({ occurrence }) => occurrence._tag === "TargetPromotionStale")
            if (observed !== undefined) return observed
          }
        }).pipe(Effect.timeout("20 seconds"))
        expect(stale.occurrence).toMatchObject({
          observation: { _tag: "CompareAndSetRejected", observedHeadSha: foreignHead }
        })
        expect(yield* child.handle.isRunning).toBe(true)
        yield* controller.terminateChild(child)
        expect(yield* controller.awaitChild(child).pipe(Effect.timeout("20 seconds"))).toBe(0)
        const journal = yield* readJournal(fixture, child)
        expect(journal.find(({ event }) => event._tag === "TargetPromotionStale")?.position).toBe(
          stale.identity.position
        )
        expect(journal.some(({ event }) => event._tag === "WorkflowRunTerminated")).toBe(false)
        const original = yield* selectedOf(child)
        const second = yield* controller.startChild()
        const waiting = yield* awaitWaitingStatus(second).pipe(Effect.timeout("20 seconds"))
        expect(waiting.subject).toEqual({ _tag: "Run", runId: original.runId })
        expect(yield* selectedOf(second)).toMatchObject({ runId: original.runId, selection: "Recovered" })
        yield* controller.terminateChild(second)
        expect(yield* controller.awaitChild(second).pipe(Effect.timeout("20 seconds"))).toBe(0)
        const after = yield* git.runInWorktree(fixture.manifest.repository, [
          "rev-parse",
          fixture.manifest.integrationRef
        ])
        expect(after.stdout.trim()).toBe(foreignHead)
        expect(closeCount((yield* controller.providerSnapshot).operationCounts)).toBe(0)
        expect(
          (yield* publishEvidence(fixture, controller, "PromotionCompareAndSet", startedAt, [child, second]))._tag
        ).toBe("RetainedFixture")
      })
    ).pipe(Effect.provide(fixtureLayer)),
  { timeout: 60_000 }
)

it.live(
  "completion-throttle cut uses production HTTP429 classification and preserves unfinished Run",
  () =>
    Effect.scoped(
      Effect.gen(function* () {
        const startedAt = yield* Clock.currentTimeMillis.pipe(Effect.map((millis) => new Date(millis).toISOString()))
        const fixture = yield* createHermeticFixture(builtEntry, sourceBaseSha)
        const controller = yield* makeHermeticController(fixture, { _tag: "PauseAt", boundary: "CompletionThrottle" })
        yield* controller.setCompletionResponse("Throttled")
        const first = yield* controller.startChild()
        expect(
          (yield* controller.awaitBoundary("CompletionThrottle", first).pipe(Effect.timeout("20 seconds")))._tag
        ).toBe("CompletionThrottle")
        yield* controller.releaseBoundary()
        expect(yield* controller.awaitChild(first).pipe(Effect.timeout("20 seconds"))).toBe(1)
        expect(MutableList.toArray(first.recordLog).find((record) => record._tag === "Failure")).toMatchObject({
          code: "delivery.provider_throttled"
        })
        expect(
          MutableList.toArray(first.recordLog).some((record) => record._tag === "ApplicationExitDisposition")
        ).toBe(false)
        expect(closeCount((yield* controller.providerSnapshot).operationCounts)).toBe(1)
        const journal = yield* readJournal(fixture, first)
        expect(journal.filter(({ event }) => event._tag === "WorkflowRunBegan")).toHaveLength(1)
        expect(journal.some(({ event }) => event._tag === "WorkflowRunTerminated")).toBe(false)
        const last = journal.at(-1)
        if (last === undefined) return yield* Effect.die("the throttled Run must retain its journal prefix")
        const original = yield* selectedOf(first)
        const beforeRecovery = yield* controller.providerSnapshot
        const second = yield* controller.startChild()
        const observedLookup = yield* Effect.gen(function* () {
          for (;;) {
            const record = yield* Queue.take(second.records)
            if (record._tag !== "HistoricalSnapshot") continue
            const observed = record.snapshot.items.find(
              ({ occurrence }) =>
                occurrence._tag === "IntegrationFocusedCompletionOccurred" &&
                occurrence.event._tag === "CompletionTaskRequestLookupObserved"
            )
            if (observed !== undefined) return observed
          }
        }).pipe(Effect.timeout("20 seconds"))
        expect(observedLookup.occurrence).toMatchObject({
          event: { lookup: { _tag: "Unreadable" }, attemptOrdinal: 1 }
        })
        const waiting = yield* awaitWaitingStatus(second).pipe(Effect.timeout("20 seconds"))
        expect(waiting.subject).toEqual({ _tag: "Run", runId: original.runId })
        expect(yield* selectedOf(second)).toMatchObject({ runId: original.runId, selection: "Recovered" })
        expect(
          MutableList.toArray(second.recordLog).some(
            (record) =>
              record._tag === "CurrentStatus" &&
              record.status._tag === "DeliveryStatusAvailable" &&
              record.status.subject._tag === "Run" &&
              record.status.subject.runId === original.runId
          )
        ).toBe(true)
        expect(yield* second.handle.isRunning).toBe(true)
        yield* controller.terminateChild(second)
        expect(yield* controller.awaitChild(second).pipe(Effect.timeout("20 seconds"))).toBe(0)
        expect(
          MutableList.toArray(second.recordLog).filter((record) => record._tag === "ApplicationExitDisposition")
        ).toEqual([
          {
            _tag: "ApplicationExitDisposition",
            disposition: { _tag: "Succeeded", requestedStatus: 0 },
            runId: original.runId,
            version: 1
          }
        ])
        const recovered = yield* readJournal(fixture, second)
        const afterRecovery = yield* controller.providerSnapshot
        const attempts = recovered.filter(({ event }) => event._tag === "CompletionTaskAttemptIntended")
        expect(closeCount(afterRecovery.operationCounts)).toBe(attempts.length)
        const newAttempts = attempts.filter(({ position }) => position > last.position)
        expect(newAttempts).toHaveLength(0)
        expect(closeCount(afterRecovery.operationCounts)).toBe(1)
        const originalAttempt = journal.find(({ event }) => event._tag === "CompletionTaskAttemptIntended")
        const lookup = recovered.find(({ position }) => position === observedLookup.identity.position)
        if (
          originalAttempt?.event._tag !== "CompletionTaskAttemptIntended" ||
          lookup?.event._tag !== "CompletionTaskRequestLookupObserved"
        )
          return yield* Effect.die("missing original completion attempt or exact lookup observation")
        expect(lookup.event.attemptOrdinal).toBe(originalAttempt.event.attemptOrdinal)
        expect(Schema.toEquivalence(CompletionTaskRequest)(lookup.event.request, originalAttempt.event.request)).toBe(
          true
        )
        expect(lookup.event.lookup._tag).toBe("Unreadable")
        const lookupOperationId = lookup.event.operationId
        expect(
          Schema.toEquivalence(CompletionTaskRequest)(lookup.event.lookup.request, originalAttempt.event.request)
        ).toBe(true)
        const lookupIntent = recovered.find(
          ({ event }) => event._tag === "CompletionTaskRequestLookupIntended" && event.operationId === lookupOperationId
        )
        if (lookupIntent?.event._tag !== "CompletionTaskRequestLookupIntended")
          return yield* Effect.die("missing exact completion lookup intent")
        expect(lookupIntent.event.attemptOrdinal).toBe(originalAttempt.event.attemptOrdinal)
        expect(
          Schema.toEquivalence(CompletionTaskRequest)(lookupIntent.event.request, originalAttempt.event.request)
        ).toBe(true)
        const lifecycleRead = recovered.find(
          ({ event, position }) =>
            position > last.position &&
            event._tag === "TaskTrackerReadIntentRecorded" &&
            event.operation._tag === "ReadCompletionTaskFacts"
        )
        if (lifecycleRead === undefined) return yield* Effect.die("missing recovery lifecycle read")
        expect(lifecycleRead.position).toBeLessThan(lookupIntent.position)
        expect(lookupIntent.position).toBeGreaterThan(last.position)
        expect(lookup.position).toBeGreaterThan(lookupIntent.position)
        expect(recovered.filter(({ event }) => event._tag === "TaskClaimReleased")).toHaveLength(
          journal.filter(({ event }) => event._tag === "TaskClaimReleased").length
        )
        expect(afterRecovery.operationCounts.find(({ tag }) => tag === "CodexStartTurn")).toEqual(
          beforeRecovery.operationCounts.find(({ tag }) => tag === "CodexStartTurn")
        )
        expect(recovered.filter(({ event }) => event._tag === "WorkflowRunBegan")).toHaveLength(1)
        expect(recovered.some(({ event }) => event._tag === "WorkflowRunTerminated")).toBe(false)
        const disposal = yield* publishEvidence(fixture, controller, "CompletionThrottle", startedAt, [first, second])
        expect(disposal._tag).toBe("RetainedFixture")
        if (disposal._tag === "RetainedFixture") expect(disposal.cause._tag).toBe("UnfinishedRun")
        expect(yield* controller.activeRequestCount).toBe(0)
      })
    ).pipe(Effect.provide(fixtureLayer)),
  { timeout: 60_000 }
)
