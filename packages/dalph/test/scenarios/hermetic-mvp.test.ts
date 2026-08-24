// @effect-diagnostics multipleEffectProvide:off
import {
  AcceptedResultEvidenceManifest,
  AttemptId,
  type EvidenceReference,
  GitCommitSha,
  GitRepositoryLocator,
  IntegrationTarget,
  IntegrationTargetRef,
  makeTaskWorkSpecification,
  PlannedAttemptExecutor,
  PlannedAttemptExecutorProjection,
  PlannedAttemptExecutorReport,
  plannedAttemptExecutorCorrelation,
  PlannedTaskAttempt,
  RunId,
  TaskBranchRef,
  TaskExecutorLocator,
  TaskId,
  WorktreeLocator
} from "@dalph/contracts"
import { NodeServices } from "@effect/platform-node"
import { it } from "@effect/vitest"
import {
  ActiveTaskClaim,
  AllocatedWorkflowRunId,
  ClaimOwner,
  ClaimToken,
  CompletionTaskAcknowledgement,
  type CompletionTaskClaim,
  CompletionTaskRequestLookup,
  CoordinatorOwnership,
  EvidenceStore,
  EvidenceStoreLocator,
  FixtureTarget,
  GitCommand,
  GitCommonDirectoryTarget,
  InitialControlPolicy,
  IntegratorCandidateText,
  IntegratorResult,
  isExactTaskClaim,
  JournalDatabaseLocator,
  JournalStore,
  nodeEvidenceStoreLayer,
  nodeGitCommandLayer,
  nodeGitTargetPromotionLayer,
  OperationId,
  OperationIdAllocator,
  PlannedTaskAttemptPlanner,
  productionCoordinatorOwnershipLayer,
  projectTrackerSnapshot,
  runWorkflow,
  sqliteJournalTestLayer,
  TargetPromotionGit,
  TaskClaimAcquisitionPlanner,
  TaskWorkCapacity,
  TrackerGraphReader,
  TrackerMutation,
  TrackerRevision,
  UnclaimedTask,
  unavailableIntegratorCandidateProviderAuthority,
  WorkflowTrace,
  completionTaskClaimEquals,
  type completionTaskRequestFor,
  type CompletionClaimBoundaryService,
  type CompletionTaskBoundaryService,
  type IntegratorService
} from "@dalph/orchestrator"
import { ChildProcess, ChildProcessSpawner } from "effect/unstable/process"
import { ConfigProvider, Deferred, Effect, FileSystem, Fiber, Layer, Option, Ref, Schema } from "effect"
import { expect } from "vitest"
import { productionWorkflowInterpreterLayer } from "../../src/application/production.js"
import { acceptedManifestBytes, runInGitDirectory, runInWorktree } from "./hermetic-support.js"

type TrackerClaim = ActiveTaskClaim | CompletionTaskClaim | UnclaimedTask
const maxActivationPasses = 64

const runHermeticMvpJourney = (crashAfterPromotion: boolean) =>
  Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem
    const git = yield* GitCommand
    const childProcesses = yield* ChildProcessSpawner.ChildProcessSpawner
    const root = yield* fileSystem.makeTempDirectory({ prefix: "dalph-hermetic-mvp-" })

    yield* Effect.gen(function* () {
      const repository = `${root}/repository`
      const bareRemote = `${root}/target.git`
      const evidenceDirectory = `${root}/evidence`
      const worktree = WorktreeLocator.make(`${root}/task-A`)
      const journalFilename = JournalDatabaseLocator.make(`${root}/journal.sqlite`)
      yield* fileSystem.makeDirectory(repository)
      yield* fileSystem.makeDirectory(evidenceDirectory)
      yield* runInWorktree(git, repository, ["init", "--initial-branch=master"], "initialize source repository")
      yield* runInWorktree(git, repository, ["config", "user.email", "dalph@example.invalid"], "configure email")
      yield* runInWorktree(git, repository, ["config", "user.name", "Dalph MVP"], "configure name")
      yield* fileSystem.writeFileString(`${repository}/README.md`, "hermetic Dalph MVP\n")
      yield* runInWorktree(git, repository, ["add", "README.md"], "stage initial tree")
      yield* runInWorktree(git, repository, ["commit", "-m", "initial"], "commit initial tree")
      yield* runInWorktree(git, root, ["init", "--bare", bareRemote], "initialize bare remote")
      yield* runInGitDirectory(
        git,
        bareRemote,
        ["config", "user.email", "dalph@example.invalid"],
        "configure bare email"
      )
      yield* runInGitDirectory(git, bareRemote, ["config", "user.name", "Dalph MVP"], "configure bare name")
      yield* runInWorktree(git, repository, ["remote", "add", "target", bareRemote], "add bare remote")
      yield* runInWorktree(git, repository, ["push", "target", "master:master"], "publish initial target")
      const baseSha = GitCommitSha.make(
        yield* runInWorktree(git, repository, ["rev-parse", "HEAD"], "read initial commit")
      )
      yield* runInWorktree(git, repository, ["branch", "unrelated", baseSha], "create unrelated branch")

      const runId = RunId.make("hermetic-mvp-run")
      const target = FixtureTarget.make("hermetic-mvp-target")
      const taskId = TaskId.make("A")
      const specification = makeTaskWorkSpecification({ body: "Create RESULT.md.", taskId, title: "Complete A" })
      const plannedAttempt = PlannedTaskAttempt.make({
        attemptId: AttemptId.make("hermetic-mvp-attempt-A"),
        baseSha,
        branch: TaskBranchRef.make("refs/heads/dalph/hermetic-mvp-A"),
        executor: TaskExecutorLocator.make("executor:hermetic-child"),
        runId,
        taskId,
        taskRevision: specification.fingerprint,
        worktree
      })
      const integrationTarget = IntegrationTarget.make({
        repository: GitRepositoryLocator.make(bareRemote),
        ref: IntegrationTargetRef.make("refs/heads/master")
      })
      const lifecycle = yield* Ref.make<"Open" | "CompletedSuccessfully">("Open")
      const trackerClaim = yield* Ref.make<TrackerClaim>(UnclaimedTask.make({ taskId }))
      const completedRequest = yield* Ref.make<Option.Option<ReturnType<typeof completionTaskRequestFor>>>(
        Option.none()
      )
      const integratorCandidate = yield* Ref.make<Option.Option<GitCommitSha>>(Option.none())
      const targetPromotionCompareAndSetCalls = yield* Ref.make(0)
      const executorReport = yield* Ref.make<Option.Option<PlannedAttemptExecutorReport>>(Option.none())
      const acceptedEvidence = yield* Ref.make<Option.Option<EvidenceReference>>(Option.none())
      const childHandle = yield* Ref.make<Option.Option<ChildProcessSpawner.ChildProcessHandle>>(Option.none())
      const operationCounter = yield* Ref.make(0)
      const executorStarts = yield* Ref.make(0)
      const integratorCalls = yield* Ref.make(0)
      const promotionAppliedWithoutResponse = yield* Deferred.make<void>()

      const evidenceStore = yield* EvidenceStore.pipe(
        Effect.provide(nodeEvidenceStoreLayer(EvidenceStoreLocator.make(evidenceDirectory)))
      )
      const targetPromotionGit = yield* TargetPromotionGit.pipe(
        Effect.provide(nodeGitTargetPromotionLayer),
        Effect.provideService(GitCommand, git)
      )

      const trackerMutation = TrackerMutation.of({
        acquireTaskClaim: (acquisition) =>
          Ref.modify(trackerClaim, (current) => {
            if (current._tag === "UnclaimedTask") {
              const claim = ActiveTaskClaim.make(acquisition)
              return [Effect.succeed(claim), claim] as const
            }
            if (current._tag === "ActiveTaskClaim" && isExactTaskClaim(current, ActiveTaskClaim.make(acquisition))) {
              return [Effect.succeed(current), current] as const
            }
            return [Effect.die("hermetic tracker found a conflicting claim"), current] as const
          }).pipe(Effect.flatten),
        readTaskClaim: () =>
          Ref.get(trackerClaim).pipe(
            Effect.flatMap((current) =>
              current._tag === "CompletionTaskClaim"
                ? Effect.die("ordinary claim read cannot represent a completion claim")
                : Effect.succeed(current)
            )
          ),
        releaseTaskClaim: (release) =>
          Ref.modify(trackerClaim, (current) =>
            current._tag === "ActiveTaskClaim" && isExactTaskClaim(current, release.claim)
              ? ([Effect.void, UnclaimedTask.make({ taskId })] as const)
              : ([Effect.die("hermetic tracker refused a non-exact release"), current] as const)
          ).pipe(Effect.flatten)
      })

      const completionClaim: CompletionClaimBoundaryService = {
        readTaskClaim: () => Ref.get(trackerClaim),
        replaceTaskClaim: (request) =>
          Ref.modify(trackerClaim, (current) =>
            current._tag === "ActiveTaskClaim" && isExactTaskClaim(current, request.claim.originalClaim)
              ? ([Effect.succeed(request.claim), request.claim] as const)
              : ([Effect.die("completion claim replacement lacked the exact active claim"), current] as const)
          ).pipe(Effect.flatten),
        deleteTaskClaim: (request) =>
          Ref.modify(trackerClaim, (current) =>
            current._tag === "CompletionTaskClaim" && completionTaskClaimEquals(current, request.claim)
              ? ([Effect.void, UnclaimedTask.make({ taskId })] as const)
              : ([Effect.die("completion claim deletion lacked the exact completion claim"), current] as const)
          ).pipe(Effect.flatten)
      }

      const completionTask: CompletionTaskBoundaryService = {
        readFocusedTaskCompletion: (_taskId, focusedTarget, operationId) =>
          Effect.gen(function* () {
            const currentClaim = yield* Ref.get(trackerClaim)
            if (currentClaim._tag !== "CompletionTaskClaim") {
              return yield* Effect.die("focused completion read lacked the exact completion claim")
            }
            return {
              currentClaim,
              lifecycle: yield* Ref.get(lifecycle),
              operationId,
              target: focusedTarget,
              targetMembership: "Member" as const,
              taskId,
              taskRevision: specification.fingerprint,
              trackerRevision: TrackerRevision.make(`hermetic-focused:${operationId}`),
              unfinishedPrerequisiteTaskIds: []
            }
          }),
        completeTask: (request) =>
          Effect.gen(function* () {
            const candidate = yield* Ref.get(integratorCandidate)
            if (Option.isNone(candidate)) return yield* Effect.die("tracker completion preceded Integrator output")
            const currentTarget = GitCommitSha.make(
              yield* runInGitDirectory(
                git,
                bareRemote,
                ["rev-parse", "refs/heads/master"],
                "prove promotion before tracker completion"
              )
            )
            if (currentTarget !== candidate.value) {
              return yield* Effect.die("tracker completion preceded exact candidate promotion")
            }
            yield* Ref.set(completedRequest, Option.some(request))
            yield* Ref.set(lifecycle, "CompletedSuccessfully")
            return CompletionTaskAcknowledgement.make({ operationId: request.operationId, taskId })
          }).pipe(Effect.orDie),
        readCompletionRequest: (request) =>
          Ref.get(completedRequest).pipe(
            Effect.map((stored) =>
              Option.isSome(stored) && stored.value.operationId === request.operationId
                ? CompletionTaskRequestLookup.cases.Applied.make({ request })
                : CompletionTaskRequestLookup.cases.NotApplied.make({ request })
            )
          )
      }

      const trackerGraphReader = TrackerGraphReader.of({
        read: () =>
          Ref.get(lifecycle).pipe(
            Effect.flatMap((currentLifecycle) => {
              const projection = projectTrackerSnapshot({
                revision: `hermetic-mvp:${currentLifecycle}`,
                rootTaskId: taskId,
                tasks: [{ id: taskId, lifecycle: { _tag: currentLifecycle }, parentTaskId: null, prerequisiteIds: [] }]
              })
              return projection._tag === "Valid"
                ? Effect.succeed(projection.snapshot)
                : Effect.die("hermetic tracker graph must be valid")
            })
          ),
        readTaskWorkSpecification: () => Effect.succeed(specification)
      })

      const executor = PlannedAttemptExecutor.of({
        project: (correlation) =>
          Ref.get(executorReport).pipe(
            Effect.map(
              Option.match({
                onNone: () => PlannedAttemptExecutorProjection.cases.NoReport.make({ correlation }),
                onSome: (report) => PlannedAttemptExecutorProjection.cases.Exact.make({ report })
              })
            )
          ),
        requestSuspension: () => Effect.die("the no-crash journey never requests suspension"),
        startOrContinue: (request) =>
          Effect.scoped(
            Effect.gen(function* () {
              const existing = yield* Ref.get(executorReport)
              if (Option.isSome(existing)) return existing.value
              yield* Ref.update(executorStarts, (starts) => starts + 1)
              const handle = yield* childProcesses.spawn(
                ChildProcess.make(
                  "node",
                  ["-e", "require('node:fs').writeFileSync('RESULT.md', 'implemented by hermetic child\\n')"],
                  { cwd: request.plannedAttempt.worktree }
                )
              )
              yield* Ref.set(childHandle, Option.some(handle))
              const exitCode = yield* handle.exitCode
              if (exitCode !== 0) return yield* Effect.die(`hermetic executor child exited ${exitCode}`)
              yield* runInWorktree(git, request.plannedAttempt.worktree, ["add", "RESULT.md"], "stage task result")
              yield* runInWorktree(
                git,
                request.plannedAttempt.worktree,
                ["commit", "-m", "complete A"],
                "commit task result"
              )
              const commit = GitCommitSha.make(
                yield* runInWorktree(
                  git,
                  request.plannedAttempt.worktree,
                  ["rev-parse", "HEAD"],
                  "read accepted commit"
                )
              )
              yield* runInWorktree(
                git,
                request.plannedAttempt.worktree,
                ["push", bareRemote, `${commit}:refs/dalph/transfer-A`],
                "transfer accepted commit to target object database"
              )
              const evidenceManifest = yield* evidenceStore.put(acceptedManifestBytes(request.plannedAttempt, commit))
              yield* Ref.set(acceptedEvidence, Option.some(evidenceManifest))
              const report = PlannedAttemptExecutorReport.cases.Terminal.make({
                correlation: plannedAttemptExecutorCorrelation(request.plannedAttempt),
                result: { _tag: "Accepted", acceptedResult: { commit, evidenceManifest } }
              })
              yield* Ref.set(executorReport, Option.some(report))
              return report
            })
          ).pipe(Effect.orDie)
      })

      const integrator: IntegratorService = {
        prepare: (request) =>
          Effect.gen(function* () {
            yield* Ref.update(integratorCalls, (calls) => calls + 1)
            const acceptedCommit = request.correlation.acceptedResult.commit
            const tree = yield* runInGitDirectory(
              git,
              bareRemote,
              ["rev-parse", `${acceptedCommit}^{tree}`],
              "read accepted tree"
            )
            const candidate = GitCommitSha.make(
              yield* runInGitDirectory(
                git,
                bareRemote,
                [
                  "commit-tree",
                  tree,
                  "-p",
                  request.correlation.expectedTargetHead,
                  "-p",
                  acceptedCommit,
                  "-m",
                  "integrate A"
                ],
                "create explicit integration candidate"
              )
            )
            yield* Ref.set(integratorCandidate, Option.some(candidate))
            yield* runInGitDirectory(
              git,
              bareRemote,
              ["update-ref", "-d", "refs/dalph/transfer-A", acceptedCommit],
              "remove private transfer ref"
            )
            return IntegratorResult.cases.PreparedCandidate.make({
              candidateText: IntegratorCandidateText.make(candidate),
              correlation: request.correlation
            })
          }).pipe(Effect.orDie)
      }

      const application = productionWorkflowInterpreterLayer(
        runId,
        GitCommonDirectoryTarget.make(`${repository}/.git`),
        integrationTarget,
        Layer.succeed(TrackerMutation, trackerMutation),
        Layer.succeed(PlannedAttemptExecutor, executor),
        unavailableIntegratorCandidateProviderAuthority,
        {
          acceptedResultEvidenceStore: evidenceStore,
          completionTask,
          integrationFinality: completionClaim,
          integrator,
          targetPromotion: {
            git: {
              compareAndSet: (request) =>
                Effect.gen(function* () {
                  const call = yield* Ref.updateAndGet(targetPromotionCompareAndSetCalls, (calls) => calls + 1)
                  const result = yield* targetPromotionGit.compareAndSet(request)
                  if (crashAfterPromotion && call === 1) {
                    yield* Deferred.succeed(promotionAppliedWithoutResponse, undefined)
                    return yield* Effect.die("simulated coordinator death after target promotion")
                  }
                  return result
                }),
              read: targetPromotionGit.read
            }
          }
        }
      ).pipe(
        Layer.provide(Layer.succeed(TrackerGraphReader, trackerGraphReader)),
        Layer.provide(Layer.succeed(WorkflowTrace, WorkflowTrace.of({ emit: () => Effect.void })))
      )

      const activate = runWorkflow(
        target,
        Effect.succeed(InitialControlPolicy.make({ taskExecutionCapacity: TaskWorkCapacity.make(1) })),
        AllocatedWorkflowRunId.make(runId)
      ).pipe(
        Effect.provideService(
          OperationIdAllocator,
          OperationIdAllocator.of({
            allocate: () =>
              Ref.getAndUpdate(operationCounter, (value) => value + 1).pipe(
                Effect.map((value) => OperationId.make(`hermetic-mvp-operation-${value}`))
              )
          })
        ),
        Effect.provideService(
          TaskClaimAcquisitionPlanner,
          TaskClaimAcquisitionPlanner.of({
            plan: (operationId) =>
              Effect.succeed({
                operationId,
                owner: ClaimOwner.make("dalph"),
                taskId,
                token: ClaimToken.make("hermetic-mvp-claim")
              })
          })
        ),
        Effect.provideService(
          PlannedTaskAttemptPlanner,
          PlannedTaskAttemptPlanner.of({ plan: () => Effect.succeed(plannedAttempt) })
        )
      )
      const terminated = yield* Ref.make(false)
      const activationDriver = Effect.forEach(
        Array.from({ length: maxActivationPasses }),
        () =>
          Ref.get(terminated).pipe(
            Effect.flatMap((done) =>
              done
                ? Effect.void
                : activate.pipe(
                    Effect.flatMap((decision) =>
                      decision._tag === "RunMayTerminate" ? Ref.set(terminated, true) : Effect.void
                    )
                  )
            )
          ),
        { discard: true }
      ).pipe(
        Effect.provide(application),
        Effect.provide(ConfigProvider.layer(ConfigProvider.fromUnknown({ DALPH_JOURNAL_DATABASE: journalFilename })))
      )

      if (crashAfterPromotion) {
        yield* Effect.scoped(
          Effect.gen(function* () {
            const firstCoordinator = yield* activationDriver.pipe(Effect.forkScoped)
            yield* Deferred.await(promotionAppliedWithoutResponse)
            yield* Fiber.await(firstCoordinator)
          })
        )
        const recordsAtCrash = yield* Effect.gen(function* () {
          return yield* (yield* JournalStore).read(runId)
        }).pipe(Effect.provide(sqliteJournalTestLayer({ filename: journalFilename })))
        expect(recordsAtCrash.filter(({ event }) => event._tag === "TargetPromotionAttemptIntended")).toHaveLength(1)
        expect(recordsAtCrash.some(({ event }) => event._tag === "TargetPromotionObservedSuccess")).toBe(false)
        expect(recordsAtCrash.some(({ event }) => event._tag === "CompletionTaskAttemptIntended")).toBe(false)
        const candidateAtCrash = Option.getOrThrow(yield* Ref.get(integratorCandidate))
        expect(
          GitCommitSha.make(
            yield* runInGitDirectory(
              git,
              bareRemote,
              ["rev-parse", "refs/heads/master"],
              "prove the target moved before the lost response"
            )
          )
        ).toBe(candidateAtCrash)
        expect(yield* Ref.get(lifecycle)).toBe("Open")
        expect((yield* Ref.get(trackerClaim))._tag).toBe("ActiveTaskClaim")
        expect(yield* fileSystem.exists(worktree)).toBe(true)
      }

      yield* activationDriver
      if (!(yield* Ref.get(terminated))) {
        const stalledRecords = yield* Effect.gen(function* () {
          return yield* (yield* JournalStore).read(runId)
        }).pipe(Effect.provide(sqliteJournalTestLayer({ filename: journalFilename })))
        return yield* Effect.die(
          `hermetic MVP did not converge; latest records: ${stalledRecords
            .slice(-12)
            .map(({ event }) => event._tag)
            .join(",")}`
        )
      }

      const targetHead = GitCommitSha.make(
        yield* runInGitDirectory(git, bareRemote, ["rev-parse", "refs/heads/master"], "read promoted target")
      )
      const targetParents = (yield* runInGitDirectory(
        git,
        bareRemote,
        ["show", "-s", "--format=%P", targetHead],
        "read target parents"
      )).split(" ")
      const promotedResult = yield* git.run(bareRemote, ["show", `${targetHead}:RESULT.md`])
      const records = yield* Effect.gen(function* () {
        return yield* (yield* JournalStore).read(runId)
      }).pipe(Effect.provide(sqliteJournalTestLayer({ filename: journalFilename })))
      const evidenceReference = Option.getOrThrow(yield* Ref.get(acceptedEvidence))
      const evidenceBytes = yield* evidenceStore.read(evidenceReference)
      const decodedEvidence = yield* Schema.decodeUnknownEffect(AcceptedResultEvidenceManifest)(
        JSON.parse(new TextDecoder().decode(evidenceBytes))
      )
      const eventTags = records.map(({ event }) => event._tag)
      const qualificationAt = eventTags.indexOf("IntegratorRunCandidateGitObserved")
      const promotionAttemptAt = eventTags.indexOf("TargetPromotionAttemptIntended")
      const promotionSucceededAt = eventTags.indexOf("TargetPromotionObservedSuccess")
      const completionAttemptAt = eventTags.indexOf("CompletionTaskAttemptIntended")
      const qualificationRecords = records.filter(({ event }) => event._tag === "IntegratorRunCandidateGitObserved")
      const promotionAttemptRecords = records.filter(({ event }) => event._tag === "TargetPromotionAttemptIntended")
      const promotionSuccessRecords = records.filter(({ event }) => event._tag === "TargetPromotionObservedSuccess")
      const runBeginningRecords = records.filter(({ event }) => event._tag === "WorkflowRunBegan")
      const runTerminationRecords = records.filter(({ event }) => event._tag === "WorkflowRunTerminated")

      expect(targetParents).toEqual([baseSha, decodedEvidence.commit])
      expect(promotedResult).toMatchObject({ exitCode: 0, stdout: "implemented by hermetic child\n" })
      expect(yield* Ref.get(lifecycle)).toBe("CompletedSuccessfully")
      expect(yield* Ref.get(trackerClaim)).toEqual(UnclaimedTask.make({ taskId }))
      expect(qualificationRecords).toHaveLength(1)
      expect(qualificationRecords[0]?.event).toMatchObject({
        _tag: "IntegratorRunCandidateGitObserved",
        observation: { _tag: "Commit", directParents: [baseSha, decodedEvidence.commit] }
      })
      expect(qualificationAt).toBeGreaterThanOrEqual(0)
      expect(promotionAttemptAt).toBeGreaterThan(qualificationAt)
      expect(promotionSucceededAt).toBeGreaterThan(promotionAttemptAt)
      expect(completionAttemptAt).toBeGreaterThan(promotionSucceededAt)
      expect(promotionAttemptRecords).toHaveLength(1)
      expect(promotionSuccessRecords).toHaveLength(1)
      expect(yield* Ref.get(targetPromotionCompareAndSetCalls)).toBe(1)
      expect(yield* Ref.get(executorStarts)).toBe(1)
      expect(yield* Ref.get(integratorCalls)).toBe(1)
      expect(eventTags.filter((tag) => tag === "TaskAttemptPlanned")).toHaveLength(1)
      expect(eventTags.filter((tag) => tag === "TaskWorktreeReady")).toHaveLength(1)
      expect(eventTags.filter((tag) => tag === "PlannedAttemptExecutorWorkReported")).toHaveLength(1)
      expect(eventTags.filter((tag) => tag === "IntegratorSessionFixed")).toHaveLength(1)
      expect(eventTags.filter((tag) => tag === "IntegratorRunStarted")).toHaveLength(1)
      expect(eventTags.filter((tag) => tag === "IntegratorRunResultRecorded")).toHaveLength(1)
      if (crashAfterPromotion) {
        expect(promotionSuccessRecords[0]?.event).toMatchObject({
          _tag: "TargetPromotionObservedSuccess",
          basis: { _tag: "AfterAttempt", attemptOrdinal: 1 }
        })
      }
      expect(runBeginningRecords).toHaveLength(1)
      expect(runTerminationRecords).toHaveLength(1)
      expect(runTerminationRecords[0]?.event).toMatchObject({ _tag: "WorkflowRunTerminated", disposition: "Completed" })
      expect(records.at(-1)?.event).toEqual(runTerminationRecords[0]?.event)
      expect(records.some(({ event }) => event._tag === "IntegrationFinalitySettled")).toBe(true)
      expect(records.some(({ event }) => event._tag === "WorktreeCleanupSettled")).toBe(false)
      expect(records.some(({ event }) => event._tag === "BranchCleanupSettled")).toBe(false)
      expect(yield* fileSystem.exists(worktree)).toBe(true)
      expect((yield* git.runInWorktree(repository, ["show-ref", "--verify", plannedAttempt.branch])).exitCode).toBe(0)
      expect((yield* git.runInWorktree(repository, ["show-ref", "--verify", "refs/heads/unrelated"])).exitCode).toBe(0)
      expect((yield* git.run(bareRemote, ["show-ref", "--verify", "refs/dalph/transfer-A"])).exitCode).not.toBe(0)
      expect(yield* Option.getOrThrow(yield* Ref.get(childHandle)).isRunning).toBe(false)

      yield* Effect.scoped(
        CoordinatorOwnership.pipe(
          Effect.provide(productionCoordinatorOwnershipLayer(GitCommonDirectoryTarget.make(`${repository}/.git`)))
        )
      )
    }).pipe(Effect.ensuring(fileSystem.remove(root, { recursive: true }).pipe(Effect.orDie)))

    expect(yield* fileSystem.exists(root)).toBe(false)
  }).pipe(Effect.provide(nodeGitCommandLayer), Effect.provide(NodeServices.layer))

it.effect(
  "runs one task through real local production boundaries and tears down only its owned resources",
  () => runHermeticMvpJourney(false),
  120_000
)

it.effect(
  "restarts after Git promotes A without returning and does not repeat A integration or promotion",
  () => runHermeticMvpJourney(true),
  120_000
)
