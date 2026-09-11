/* eslint-disable import/no-nodejs-modules, max-lines -- This qualification controls real Node processes over the shipped composition. */
import nodeProcess from "node:process"
import { NodeCrypto, NodeServices } from "@effect/platform-node"
import { it } from "@effect/vitest"
import {
  AcceptedJournalReader,
  appendReplacementProvenance,
  freshWorkflowRunId,
  GitCommand,
  GithubIssueNumber,
  GithubRepositoryName,
  GithubRepositoryOwner,
  GithubIssueTarget,
  InitialControlPolicy,
  JournalDatabaseLocator,
  journalLayer,
  JournalStore,
  nodeGitCommandLayer,
  reduceWorkflowJournalHistory,
  sqliteJournalStoreLayer,
  TaskWorkCapacity
} from "@dalph/orchestrator"
import {
  AttemptId,
  GitCommitSha,
  PlannedTaskAttempt,
  TaskBranchRef,
  TaskExecutorLocator,
  TaskId,
  WorktreeLocator,
  encodeTaskRevisionFingerprint
} from "@dalph/contracts"
import { ChildProcess, ChildProcessSpawner } from "effect/unstable/process"
import { Context, Effect, Fiber, FileSystem, Layer, Path, Queue, Ref, Schema, Stream } from "effect"
import { expect } from "vitest"
import { ProductionCliRecord, type ProductionCliRecord as ProductionCliRecordType } from "./production-cli.js"

type CurrentStatusRecord = Extract<ProductionCliRecordType, { readonly _tag: "CurrentStatus" }>
type ClosedStatus = Extract<CurrentStatusRecord["status"], { readonly _tag: "DeliveryStatusClosed" }>

interface AvailableStatusEvidence {
  readonly entryCount: number
  readonly liveProposalIds: ReadonlyArray<string>
  readonly subject: CurrentStatusRecord["status"]["subject"]
}

const availableStatusEvidence = (
  subject: CurrentStatusRecord["status"]["subject"],
  entries: ReadonlyArray<{ readonly _tag: string; readonly proposalId?: unknown }>
): AvailableStatusEvidence => ({
  entryCount: entries.length,
  liveProposalIds: entries.flatMap((entry) =>
    entry._tag === "LiveDeliveryAction" && typeof entry.proposalId === "string" ? [entry.proposalId] : []
  ),
  subject
})

const availableStatusOf = (record: ProductionCliRecordType): ReadonlyArray<AvailableStatusEvidence> => {
  if (record._tag !== "CurrentStatus") return []
  if (record.status._tag === "DeliveryStatusAvailable") {
    return [availableStatusEvidence(record.status.subject, record.status.entries)]
  }
  if (record.status._tag !== "DeliveryStatusClosed" || record.status.final?._tag !== "DeliveryStatusAvailable")
    return []
  return [availableStatusEvidence(record.status.final.subject, record.status.final.entries)]
}

const isClosedStatusRecord = (
  record: ProductionCliRecordType
): record is CurrentStatusRecord & { readonly status: ClosedStatus } =>
  record._tag === "CurrentStatus" && record.status._tag === "DeliveryStatusClosed"

const dalphPackageDirectory = new URL("../../", import.meta.url).pathname
const qualificationExecutable = new URL("../../dist/bin/production-public-recovery-qualification.js", import.meta.url)
  .pathname
const codexFixture = new URL("../../dist/bin/production-public-recovery-codex-fixture.js", import.meta.url).pathname
const gitFixture = new URL("../../dist/bin/production-public-recovery-git-fixture.js", import.meta.url).pathname
const fixturePrefix = "DALPH_PUBLIC_RECOVERY_FIXTURE "
const target = "github:octo/dalph#42"

class InvalidPublicStdoutRecord extends Schema.TaggedError<InvalidPublicStdoutRecord>()("InvalidPublicStdoutRecord", {
  cause: Schema.Defect(),
  line: Schema.NonEmptyString
}) {}

const FixtureEvent = Schema.Union([
  Schema.TaggedStruct("CodexFixtureStarted", {}),
  Schema.TaggedStruct("CreateClaimLabelStarted", {
    description: Schema.NonEmptyString,
    labelName: Schema.NonEmptyString,
    operationId: Schema.NonEmptyString
  }),
  Schema.TaggedStruct("FindClaimLabelStarted", { labelName: Schema.NonEmptyString }),
  Schema.TaggedStruct("ReadIssueStarted", {
    issueNodeId: Schema.NonEmptyString,
    mode: Schema.Literals(["first", "recovered", "terminal", "exit-during-attachment"])
  }),
  Schema.TaggedStruct("ReadIssueReturned", {
    issueNodeId: Schema.NonEmptyString,
    state: Schema.Literals(["OPEN", "CLOSED"])
  })
])
type FixtureEvent = typeof FixtureEvent.Type

const CleanupGitObservation = Schema.TaggedStruct("CleanupGitObservationStarted", {
  cleanupWorktree: Schema.NonEmptyString,
  commonDirectory: Schema.NonEmptyString
})

interface PublicProcess {
  readonly events: Queue.Queue<FixtureEvent>
  readonly handle: ChildProcessSpawner.ChildProcessHandle
  readonly eventLog: Ref.Ref<ReadonlyArray<FixtureEvent>>
  readonly recordLog: Ref.Ref<ReadonlyArray<ProductionCliRecordType>>
  readonly records: Queue.Queue<ProductionCliRecordType>
  readonly stderrFiber: Fiber.Fiber<void, unknown>
  readonly stdoutFiber: Fiber.Fiber<void, unknown>
}

const takeMatching = <A>(queue: Queue.Queue<A>, predicate: (value: A) => boolean): Effect.Effect<A> =>
  Effect.gen(function* () {
    for (;;) {
      const value = yield* Queue.take(queue)
      if (predicate(value)) return value
    }
  })

const spawnPublicProcess = Effect.fn("ProductionPublicRecovery.spawn")(function* (
  config: string,
  claimState: string,
  cleanupObservation: string,
  cleanupRelease: string,
  cleanupWorktree: string,
  commonDirectory: string,
  gitFixtureDirectory: string,
  mode: "first" | "recovered" | "terminal" | "exit-during-attachment"
) {
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner
  const command = ChildProcess.make(
    nodeProcess.execPath,
    [qualificationExecutable, "run", target, "--production", "--config", config],
    {
      cwd: dalphPackageDirectory,
      env: {
        ...nodeProcess.env,
        DALPH_CODEX_PROVIDER_CREDENTIAL: "controlled-codex-credential",
        DALPH_QUALIFICATION_CLAIM_STATE: claimState,
        DALPH_QUALIFICATION_CLEANUP_OBSERVATION: cleanupObservation,
        DALPH_QUALIFICATION_CLEANUP_RELEASE: cleanupRelease,
        DALPH_QUALIFICATION_CLEANUP_WORKTREE: cleanupWorktree,
        DALPH_QUALIFICATION_COMMON_DIRECTORY: commonDirectory,
        DALPH_QUALIFICATION_MODE: mode,
        GITHUB_TOKEN: "controlled-github-token",
        PATH: `${gitFixtureDirectory}:${nodeProcess.env["PATH"] ?? ""}`
      }
    }
  )
  const handle = yield* spawner.spawn(command)
  const records = yield* Queue.unbounded<ProductionCliRecordType>()
  const events = yield* Queue.unbounded<FixtureEvent>()
  const recordLog = yield* Ref.make<ReadonlyArray<ProductionCliRecordType>>([])
  const eventLog = yield* Ref.make<ReadonlyArray<FixtureEvent>>([])
  const stdoutFiber = yield* handle.stdout.pipe(
    Stream.decodeText(),
    Stream.splitLines,
    Stream.filter((line) => line.length > 0),
    Stream.mapEffect((line) =>
      Schema.decodeUnknownEffect(Schema.fromJsonString(ProductionCliRecord))(line).pipe(
        Effect.mapError((cause) => new InvalidPublicStdoutRecord({ cause, line }))
      )
    ),
    Stream.runForEach((record) =>
      Effect.all([Queue.offer(records, record), Ref.update(recordLog, (current) => [...current, record])], {
        discard: true
      })
    ),
    Effect.forkScoped
  )
  const stderrFiber = yield* handle.stderr.pipe(
    Stream.decodeText(),
    Stream.splitLines,
    Stream.filter((line) => line.startsWith(fixturePrefix)),
    Stream.map((line) => line.slice(fixturePrefix.length)),
    Stream.mapEffect((line) => Schema.decodeUnknownEffect(Schema.fromJsonString(FixtureEvent))(line)),
    Stream.runForEach((event) =>
      Effect.all([Queue.offer(events, event), Ref.update(eventLog, (current) => [...current, event])], {
        discard: true
      })
    ),
    Effect.forkScoped
  )
  return { eventLog, events, handle, recordLog, records, stderrFiber, stdoutFiber } satisfies PublicProcess
})

const stopAbruptly = (process: PublicProcess) =>
  Effect.gen(function* () {
    yield* Effect.sync(() => nodeProcess.kill(process.handle.pid, "SIGKILL"))
    const processExit = yield* Effect.exit(process.handle.exitCode)
    yield* Effect.all([Fiber.join(process.stdoutFiber), Fiber.join(process.stderrFiber)])
    return processExit
  })

const awaitGraceful = (process: PublicProcess) =>
  Effect.gen(function* () {
    const exitCode = yield* process.handle.exitCode
    yield* Effect.all([Fiber.join(process.stdoutFiber), Fiber.join(process.stderrFiber)])
    return exitCode
  })

const publicFixture = Effect.gen(function* () {
  const fileSystem = yield* FileSystem.FileSystem
  const path = yield* Path.Path
  const git = yield* GitCommand
  const root = yield* fileSystem.makeTempDirectoryScoped({ prefix: "dalph-public-recovery-" })
  const repository = path.join(root, "repository")
  yield* fileSystem.makeDirectory(repository, { recursive: true })
  yield* git.runInWorktree(repository, ["init"])
  yield* git.runInWorktree(repository, ["config", "user.email", "dalph@example.invalid"])
  yield* git.runInWorktree(repository, ["config", "user.name", "Dalph Test"])
  yield* git.runInWorktree(repository, ["commit", "--allow-empty", "-m", "initial"])
  yield* git.runInWorktree(repository, ["branch", "-M", "master"])
  const baseSha = GitCommitSha.make((yield* git.runInWorktree(repository, ["rev-parse", "HEAD"])).stdout.trim())
  const directories = ["codex", "evidence", "planned-attempts", "integrator-candidates"]
  yield* Effect.forEach(directories, (directory) => fileSystem.makeDirectory(path.join(root, directory)))
  yield* fileSystem.chmod(path.join(root, "codex"), 0o700)
  const journalDatabase = path.join(root, "journal.sqlite")
  const config = path.join(root, "production.json")
  const claimState = path.join(root, "claim.json")
  const cleanupObservation = path.join(root, "cleanup-observation.json")
  const cleanupRelease = path.join(root, "cleanup-release")
  const cleanupWorktree = path.join(root, "cleanup-worktree")
  const commonDirectory = path.join(repository, ".git")
  const codexExecutable = path.join(root, "codex-fixture")
  yield* fileSystem.writeFileString(codexExecutable, yield* fileSystem.readFileString(codexFixture))
  yield* fileSystem.chmod(codexExecutable, 0o700)
  const gitFixtureDirectory = path.join(root, "git-fixture-bin")
  yield* fileSystem.makeDirectory(gitFixtureDirectory)
  const gitExecutable = path.join(gitFixtureDirectory, "git")
  yield* fileSystem.writeFileString(gitExecutable, yield* fileSystem.readFileString(gitFixture))
  yield* fileSystem.chmod(gitExecutable, 0o700)
  yield* fileSystem.writeFileString(
    config,
    JSON.stringify({
      activationInterval: "1 minute",
      claimOwner: "dalph:public-recovery",
      codexClientName: "dalph",
      codexClientVersion: "0.0.0",
      codexExecutable,
      codexProvider: "openai",
      codexStateDirectory: path.join(root, "codex"),
      commonDirectory,
      evidenceStoreRoot: path.join(root, "evidence"),
      failureCooldown: "5 seconds",
      integrationRef: "refs/heads/master",
      integratorCandidateWorktreeRoot: path.join(root, "integrator-candidates"),
      integratorPrivateStore: path.join(root, "integrator-private.json"),
      journalDatabase,
      plannedAttemptBaseSha: baseSha,
      plannedAttemptExecutor: "codex:production",
      plannedAttemptWorktreeRoot: path.join(root, "planned-attempts"),
      repository,
      taskWorkCapacity: 1
    })
  )
  return {
    baseSha,
    claimState,
    cleanupObservation,
    cleanupRelease,
    cleanupWorktree,
    commonDirectory,
    config,
    gitFixtureDirectory,
    journalDatabase
  }
}).pipe(Effect.provide(nodeGitCommandLayer), Effect.provide(NodeServices.layer))

it.effect("the shipped binary and recovery qualification select the same CLI and host composition", () =>
  Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem
    const binary = yield* fileSystem.readFileString(new URL("../../bin/dalph.ts", import.meta.url).pathname)
    const qualification = yield* fileSystem.readFileString(
      new URL("../../bin/production-public-recovery-qualification.ts", import.meta.url).pathname
    )
    const composition = yield* fileSystem.readFileString(new URL("./live-cli.ts", import.meta.url).pathname)
    expect(binary).toContain('import { productionCliApplication } from "../src/application/live-cli.js"')
    expect(binary).toContain("runDalphNodeMain(productionCliApplication)")
    expect(composition).toContain("productionCliApplication = makeProductionCliApplication()")
    expect(composition).toContain("withDecodedProductionRepositoryHost(input, productionRepositoryHostGraph(adapters)")
    expect(qualification).toContain('import { makeProductionCliApplication } from "../src/application/live-cli.js"')
    expect(qualification).toContain("makeProductionCliApplication({ githubClient: () => publicRecoveryGithubLayer })")
  }).pipe(Effect.provide(NodeServices.layer))
)

it.live(
  "unfinished SQLite public restart reports the same recovered Run and no second beginning",
  () =>
    Effect.scoped(
      Effect.gen(function* () {
        const fixture = yield* publicFixture
        const first = yield* spawnPublicProcess(
          fixture.config,
          fixture.claimState,
          fixture.cleanupObservation,
          fixture.cleanupRelease,
          fixture.cleanupWorktree,
          fixture.commonDirectory,
          fixture.gitFixtureDirectory,
          "first"
        )
        const allocated = yield* takeMatching(first.records, (record) => record._tag === "RunSelected")
        expect(allocated).toMatchObject({ _tag: "RunSelected", selection: "Allocated" })
        if (allocated._tag !== "RunSelected") return
        const createdClaimOrExit = yield* Effect.raceFirst(
          takeMatching(first.events, (event) => event._tag === "CreateClaimLabelStarted").pipe(
            Effect.map((event) => ({ _tag: "Claim" as const, event }))
          ),
          first.handle.exitCode.pipe(Effect.map((exitCode) => ({ _tag: "Exited" as const, exitCode })))
        )
        if (createdClaimOrExit._tag === "Exited") {
          yield* awaitGraceful(first)
          expect.fail(
            `the allocated command exited with status ${createdClaimOrExit.exitCode} before claim creation: ${JSON.stringify(yield* Ref.get(first.recordLog))}`
          )
        }
        const createdClaim = createdClaimOrExit.event
        if (createdClaim._tag !== "CreateClaimLabelStarted") return
        const heldClaimOwner = yield* takeMatching(
          first.records,
          (record) =>
            record._tag === "CurrentStatus" &&
            record.status._tag === "DeliveryStatusAvailable" &&
            record.status.entries.some(
              (entry) => entry._tag === "LiveDeliveryAction" && entry.operationId === createdClaim.operationId
            )
        )
        expect(heldClaimOwner).toMatchObject({
          _tag: "CurrentStatus",
          status: { _tag: "DeliveryStatusAvailable", subject: { _tag: "Run", runId: allocated.runId } }
        })
        const firstExit = yield* stopAbruptly(first)
        expect(firstExit._tag).toBe("Failure")
        expect(yield* Ref.get(first.recordLog)).not.toContainEqual(expect.objectContaining({ _tag: "RunDisposition" }))

        const second = yield* spawnPublicProcess(
          fixture.config,
          fixture.claimState,
          fixture.cleanupObservation,
          fixture.cleanupRelease,
          fixture.cleanupWorktree,
          fixture.commonDirectory,
          fixture.gitFixtureDirectory,
          "recovered"
        )
        const recovered = yield* takeMatching(second.records, (record) => record._tag === "RunSelected")
        expect(recovered).toEqual({ _tag: "RunSelected", runId: allocated.runId, selection: "Recovered", version: 1 })
        const recoveredClaimRead = yield* takeMatching(second.events, (event) => event._tag === "FindClaimLabelStarted")
        expect(recoveredClaimRead).toEqual({ _tag: "FindClaimLabelStarted", labelName: createdClaim.labelName })
        const coherentOrExit = yield* Effect.raceFirst(
          takeMatching(
            second.records,
            (record) =>
              record._tag === "CurrentStatus" &&
              record.status._tag === "DeliveryStatusAvailable" &&
              record.status.entries.length > 0 &&
              record.status.entries.every(({ _tag }) => _tag !== "LiveDeliveryAction")
          ).pipe(Effect.map((record) => ({ _tag: "Coherent" as const, record }))),
          second.handle.exitCode.pipe(Effect.map((exitCode) => ({ _tag: "Exited" as const, exitCode })))
        )
        if (coherentOrExit._tag === "Exited") {
          yield* awaitGraceful(second)
          expect.fail(
            `the recovered command exited with status ${coherentOrExit.exitCode} before a coherent status: ${JSON.stringify(yield* Ref.get(second.recordLog))}`
          )
        }
        const coherent = coherentOrExit.record
        expect(coherent).toMatchObject({
          _tag: "CurrentStatus",
          status: { _tag: "DeliveryStatusAvailable", subject: { _tag: "Run", runId: allocated.runId } }
        })
        const history = yield* takeMatching(second.records, (record) => record._tag === "HistoricalSnapshot")
        expect(history).toMatchObject({ _tag: "HistoricalSnapshot", snapshot: { cursor: { runId: allocated.runId } } })
        const secondExit = yield* stopAbruptly(second)
        expect(secondExit._tag).toBe("Failure")

        const secondEvents = yield* Ref.get(second.eventLog)
        expect(secondEvents.filter(({ _tag }) => _tag === "CreateClaimLabelStarted")).toHaveLength(0)
        const recoveredRecords = yield* Ref.get(second.recordLog)
        const coherentIndex = recoveredRecords.indexOf(coherent)
        expect(coherentIndex).toBeGreaterThanOrEqual(0)
        const firstInformativeIndex = recoveredRecords.findIndex(
          (record) =>
            record._tag === "CurrentStatus" &&
            record.status._tag === "DeliveryStatusAvailable" &&
            record.status.entries.length > 0
        )
        expect(firstInformativeIndex).toBeGreaterThanOrEqual(0)
        const informativeRecovery = recoveredRecords
          .slice(firstInformativeIndex, coherentIndex + 1)
          .flatMap(availableStatusOf)
        expect(informativeRecovery.length).toBeGreaterThan(0)
        for (const status of informativeRecovery) {
          expect(status.entryCount).toBeGreaterThan(0)
          expect(status.subject).toEqual({ _tag: "Run", runId: allocated.runId })
        }
        const reconstructedOwnerProposalIds = informativeRecovery.flatMap(({ liveProposalIds }) => liveProposalIds)
        expect(reconstructedOwnerProposalIds.every((proposalId) => proposalId.includes(createdClaim.operationId))).toBe(
          true
        )
        expect(informativeRecovery.at(-1)?.liveProposalIds).toEqual([])

        const journalContext = yield* Layer.build(
          sqliteJournalStoreLayer({ filename: JournalDatabaseLocator.make(fixture.journalDatabase) })
        )
        const records = yield* Context.get(journalContext, JournalStore).read(allocated.runId)
        expect(records.filter(({ event }) => event._tag === "WorkflowRunBegan")).toHaveLength(1)
        const claimIntents = records.filter(({ event }) => event._tag === "TaskClaimAcquisitionIntended")
        expect(claimIntents).toHaveLength(1)
        expect(claimIntents[0]?.event).toMatchObject({
          operation: { acquisition: { operationId: createdClaim.operationId } }
        })
        expect(createdClaim.description).toContain(createdClaim.operationId)
      }).pipe(Effect.provide(NodeServices.layer))
    ),
  60_000
)

it.live(
  "already-terminal tracker state exits the public command once without active-refresh reactivation",
  () =>
    Effect.scoped(
      Effect.gen(function* () {
        const fixture = yield* publicFixture
        const child = yield* spawnPublicProcess(
          fixture.config,
          fixture.claimState,
          fixture.cleanupObservation,
          fixture.cleanupRelease,
          fixture.cleanupWorktree,
          fixture.commonDirectory,
          fixture.gitFixtureDirectory,
          "terminal"
        )
        const selectedOrExit = yield* Effect.raceFirst(
          takeMatching(child.records, ({ _tag }) => _tag === "RunSelected").pipe(
            Effect.map((record) => ({ _tag: "Selected" as const, record }))
          ),
          child.handle.exitCode.pipe(Effect.map((exitCode) => ({ _tag: "Exited" as const, exitCode })))
        )
        expect(selectedOrExit._tag).toBe("Selected")
        if (selectedOrExit._tag !== "Selected") return
        const selected = selectedOrExit.record
        const exitCode = yield* awaitGraceful(child)
        const records = yield* Ref.get(child.recordLog)
        expect(exitCode).toBe(0)
        if (selected._tag !== "RunSelected") return
        expect(records.filter(({ _tag }) => _tag === "RunDisposition")).toHaveLength(1)
        expect(records.filter(({ _tag }) => _tag === "ApplicationExitDisposition")).toHaveLength(0)
        const closed = records.filter(isClosedStatusRecord)
        expect(closed).toHaveLength(1)
        expect(closed[0]).toMatchObject({
          _tag: "CurrentStatus",
          status: { _tag: "DeliveryStatusClosed", final: { subject: { _tag: "Run", runId: selected.runId } } }
        })
        const selectedIndex = records.findIndex(({ _tag }) => _tag === "RunSelected")
        const firstStatusIndex = records.findIndex(({ _tag }) => _tag === "CurrentStatus")
        const closedIndex = records.findIndex(
          (record) => record._tag === "CurrentStatus" && record.status._tag === "DeliveryStatusClosed"
        )
        const dispositionIndex = records.findIndex(({ _tag }) => _tag === "RunDisposition")
        expect(selectedIndex).toBeLessThan(firstStatusIndex)
        expect(firstStatusIndex).toBeLessThan(closedIndex)
        expect(closedIndex).toBeLessThan(dispositionIndex)
        const events = yield* Ref.get(child.eventLog)
        expect(events.filter(({ _tag }) => _tag === "CreateClaimLabelStarted")).toHaveLength(0)
        expect(events).toContainEqual({
          _tag: "ReadIssueReturned",
          issueNodeId: "production-public-recovery-issue",
          state: "CLOSED"
        })
        const journalContext = yield* Layer.build(
          sqliteJournalStoreLayer({ filename: JournalDatabaseLocator.make(fixture.journalDatabase) })
        )
        const journal = yield* Context.get(journalContext, JournalStore).read(selected.runId)
        expect(journal.filter(({ event }) => event._tag === "WorkflowRunBegan")).toHaveLength(1)
      }).pipe(Effect.provide(NodeServices.layer))
    ),
  60_000
)

it.live(
  "application Exit during recovered Git cleanup closes the attached public status without claiming Run completion",
  () =>
    Effect.scoped(
      Effect.gen(function* () {
        const fixture = yield* publicFixture
        const fileSystem = yield* FileSystem.FileSystem
        const trackerTarget = GithubIssueTarget.make({
          issueNumber: GithubIssueNumber.make(42),
          owner: GithubRepositoryOwner.make("octo"),
          repository: GithubRepositoryName.make("dalph")
        })
        const runId = yield* freshWorkflowRunId(trackerTarget)
        const cleanupTaskRevision = encodeTaskRevisionFingerprint(
          JSON.stringify({ body: "cleanup provenance predecessor", title: "cleanup provenance predecessor" })
        )
        const plannedAttempt = PlannedTaskAttempt.make({
          attemptId: AttemptId.make("issue-300-closed-null"),
          baseSha: fixture.baseSha,
          branch: TaskBranchRef.make("refs/heads/task/issue-300-closed-null"),
          executor: TaskExecutorLocator.make("codex:issue-300-closed-null"),
          runId,
          taskId: TaskId.make("issue-300-closed-null"),
          taskRevision: cleanupTaskRevision,
          worktree: WorktreeLocator.make(fixture.cleanupWorktree)
        })
        const successorAttempt = PlannedTaskAttempt.make({
          ...plannedAttempt,
          attemptId: AttemptId.make("issue-300-closed-null-successor"),
          branch: TaskBranchRef.make("refs/heads/task/issue-300-closed-null-successor"),
          taskRevision: encodeTaskRevisionFingerprint(
            JSON.stringify({ body: "cleanup provenance witness", title: "cleanup provenance witness" })
          ),
          worktree: WorktreeLocator.make(`${fixture.cleanupWorktree}-successor`)
        })
        yield* Effect.scoped(
          Effect.gen(function* () {
            const storageContext = yield* Layer.build(
              sqliteJournalStoreLayer({ filename: JournalDatabaseLocator.make(fixture.journalDatabase) })
            )
            const storage = Context.get(storageContext, JournalStore)
            yield* storage.beginRun(
              runId,
              trackerTarget,
              InitialControlPolicy.make({ taskExecutionCapacity: TaskWorkCapacity.make(1) })
            )
            const initial = reduceWorkflowJournalHistory(runId, yield* storage.read(runId))
            if (initial._tag === "InvalidWorkflowJournalHistory") {
              return yield* Effect.die(
                `replacement fixture initial history is invalid: ${JSON.stringify(initial.issues)}`
              )
            }
            const journalContext = yield* Layer.build(journalLayer(runId, trackerTarget, initial, storage))
            yield* appendReplacementProvenance(plannedAttempt, successorAttempt, "StartupValid").pipe(
              Effect.provide(journalContext)
            )
            yield* Context.get(journalContext, AcceptedJournalReader).readAccepted(runId)
            const reduced = reduceWorkflowJournalHistory(runId, yield* storage.read(runId))
            expect(reduced._tag).toBe("ValidWorkflowJournalHistory")
          })
        )

        const child = yield* spawnPublicProcess(
          fixture.config,
          fixture.claimState,
          fixture.cleanupObservation,
          fixture.cleanupRelease,
          fixture.cleanupWorktree,
          fixture.commonDirectory,
          fixture.gitFixtureDirectory,
          "exit-during-attachment"
        )
        const selectedOrExit = yield* Effect.raceFirst(
          takeMatching(child.records, ({ _tag }) => _tag === "RunSelected").pipe(
            Effect.map((record) => ({ _tag: "Selected" as const, record }))
          ),
          child.handle.exitCode.pipe(Effect.map((exitCode) => ({ _tag: "Exited" as const, exitCode })))
        )
        if (selectedOrExit._tag !== "Selected") {
          yield* awaitGraceful(child)
          expect.fail(
            `the recovered command exited with status ${selectedOrExit.exitCode} before RunSelected: ${JSON.stringify(yield* Ref.get(child.recordLog))}`
          )
        }
        const selected = selectedOrExit.record
        expect(selected).toMatchObject({ runId, selection: "Recovered" })
        while (!(yield* fileSystem.exists(fixture.cleanupObservation))) {
          yield* Effect.sleep("10 millis")
        }
        const cleanupStarted = yield* Schema.decodeUnknownEffect(Schema.fromJsonString(CleanupGitObservation))(
          yield* fileSystem.readFileString(fixture.cleanupObservation)
        )
        expect(cleanupStarted).toEqual({
          _tag: "CleanupGitObservationStarted",
          cleanupWorktree: fixture.cleanupWorktree,
          commonDirectory: fixture.commonDirectory
        })
        yield* takeMatching(
          child.records,
          (record) => record._tag === "CurrentStatus" && record.status._tag === "DeliveryStatusNotReady"
        )
        yield* Effect.sync(() => nodeProcess.kill(child.handle.pid, "SIGTERM"))
        yield* fileSystem.writeFileString(fixture.cleanupRelease, "release after application Exit request")
        const exitCode = yield* awaitGraceful(child)
        expect(exitCode).toBe(0)
        if (selected._tag !== "RunSelected") return
        const records = yield* Ref.get(child.recordLog)
        expect(records.filter(({ _tag }) => _tag === "RunDisposition")).toHaveLength(0)
        expect(records.filter(({ _tag }) => _tag === "ApplicationExitDisposition")).toEqual([
          {
            _tag: "ApplicationExitDisposition",
            disposition: { _tag: "Succeeded", requestedStatus: 0 },
            runId: selected.runId,
            version: 1
          }
        ])
        const closed = records.filter(isClosedStatusRecord)
        expect(closed).toHaveLength(1)
        expect(closed[0]).toMatchObject({
          _tag: "CurrentStatus",
          status: {
            _tag: "DeliveryStatusClosed",
            final: { _tag: "DeliveryStatusAvailable", subject: { _tag: "Run", runId: selected.runId } },
            subject: { _tag: "Run", runId: selected.runId }
          },
          version: 1
        })
        if (closed[0]?.status.final?._tag !== "DeliveryStatusAvailable") return
        expect(closed[0].status.final.entries.length).toBeGreaterThan(0)
        expect(closed[0].status.final.entries.filter(({ _tag }) => _tag === "LiveDeliveryAction")).toEqual([])
        const notReadyIndex = records.findIndex(
          (record) => record._tag === "CurrentStatus" && record.status._tag === "DeliveryStatusNotReady"
        )
        const closedIndex = records.findIndex(
          (record) => record._tag === "CurrentStatus" && record.status._tag === "DeliveryStatusClosed"
        )
        const exitIndex = records.findIndex(({ _tag }) => _tag === "ApplicationExitDisposition")
        expect(notReadyIndex).toBeLessThan(closedIndex)
        expect(closedIndex).toBeLessThan(exitIndex)
      }).pipe(Effect.provide(NodeCrypto.layer), Effect.provide(NodeServices.layer))
    ),
  60_000
)
