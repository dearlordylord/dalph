// @effect-diagnostics multipleEffectProvide:off
import {
  AcceptedResultEvidenceManifest,
  AttemptId,
  evidenceReferenceEquals,
  type EvidenceReference,
  GitCommitSha,
  GitRepositoryLocator,
  IntegrationTarget,
  IntegrationTargetRef,
  makeTaskWorkSpecification,
  plannedTaskAttemptEquivalence,
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
  type JournalRecord,
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
  type TargetPromotionGitRequest,
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
  type IntegratorRequestType,
  type IntegratorService
} from "@dalph/orchestrator"
import { ChildProcess, ChildProcessSpawner } from "effect/unstable/process"
import { ConfigProvider, Deferred, Effect, FileSystem, Fiber, Layer, Option, Ref, Schema, Stream } from "effect"
import { expect } from "vitest"
import { productionWorkflowInterpreterLayer } from "../../src/application/production.js"
import { acceptedManifestBytes, runInGitDirectory, runInWorktree } from "./hermetic-support.js"

type TaskKey = "A" | "B" | "D"
type TrackerClaim = ActiveTaskClaim | CompletionTaskClaim | UnclaimedTask
type Lifecycle = "Open" | "CompletedSuccessfully"

const taskKeys: ReadonlyArray<TaskKey> = ["A", "B", "D"]
const maxActivationPasses = 96

const taskValue = <A>(values: ReadonlyMap<TaskKey, A>, task: TaskKey): A => {
  return Option.getOrThrow(Option.fromUndefinedOr(values.get(task)))
}

// Keep semantic fixture labels A/B/D while making their persisted identities
// deliberately non-lexical. Responsibility order must be supplied by the
// accepted-result barrier, never inferred by sorting task IDs.
const taskIdentityByKey: Readonly<Record<TaskKey, string>> = { A: "task-zeta", B: "task-alpha", D: "task-delta" }

const taskIdOf = (key: TaskKey): TaskId => TaskId.make(taskIdentityByKey[key])

const integrationTargetEquals = (left: IntegrationTarget, right: IntegrationTarget): boolean =>
  left.repository === right.repository && left.ref === right.ref

type JournalEvent = JournalRecord["event"]
type JournalEventTag = JournalEvent["_tag"]
type JournalRecordOf<Tag extends JournalEventTag> = JournalRecord & {
  readonly event: Extract<JournalEvent, { readonly _tag: Tag }>
}

const recordsOfTag = <Tag extends JournalEventTag>(
  records: ReadonlyArray<JournalRecord>,
  tag: Tag
): ReadonlyArray<JournalRecordOf<Tag>> =>
  records.filter((record): record is JournalRecordOf<Tag> => record.event._tag === tag)

const barrierChildScript = [
  "const fs=require('node:fs');",
  "const task=process.argv[1];",
  "process.stdout.write('READY:'+task+'\\n');",
  "process.stdin.resume();",
  "process.stdin.once('data',()=>{fs.writeFileSync('RESULT-'+task+'.md','implemented '+task+'\\n');process.stdout.write('WORK_FINISHED:'+task+'\\n');process.exit(0);});"
].join("")

const immediateChildScript = [
  "const fs=require('node:fs');",
  "const task=process.argv[1];",
  "fs.writeFileSync('RESULT-'+task+'.md','implemented '+task+'\\n');",
  "process.stdout.write('WORK_FINISHED:'+task+'\\n');"
].join("")

const sendChildRelease = (handle: ChildProcessSpawner.ChildProcessHandle) =>
  Stream.run(Stream.succeed(new TextEncoder().encode("release\n")), handle.stdin)

it.effect(
  "runs two ready tasks concurrently, serializes same-target integration, and waits for a later complete graph before starting their dependant",
  () =>
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem
      const git = yield* GitCommand
      const childProcesses = yield* ChildProcessSpawner.ChildProcessSpawner
      const root = yield* fileSystem.makeTempDirectory({ prefix: "dalph-hermetic-concurrency-" })

      yield* Effect.gen(function* () {
        const repository = `${root}/repository`
        const bareRemote = `${root}/target.git`
        const evidenceDirectory = `${root}/evidence`
        const journalFilename = JournalDatabaseLocator.make(`${root}/journal.sqlite`)
        yield* fileSystem.makeDirectory(repository)
        yield* fileSystem.makeDirectory(evidenceDirectory)
        yield* runInWorktree(git, repository, ["init", "--initial-branch=master"], "initialize source repository")
        yield* runInWorktree(git, repository, ["config", "user.email", "dalph@example.invalid"], "configure email")
        yield* runInWorktree(git, repository, ["config", "user.name", "Dalph concurrency fixture"], "configure name")
        yield* fileSystem.writeFileString(`${repository}/README.md`, "hermetic Dalph concurrency\n")
        yield* runInWorktree(git, repository, ["add", "README.md"], "stage initial tree")
        yield* runInWorktree(git, repository, ["commit", "-m", "initial"], "commit initial tree")
        yield* runInWorktree(git, root, ["init", "--bare", bareRemote], "initialize bare remote")
        yield* runInGitDirectory(
          git,
          bareRemote,
          ["config", "user.email", "dalph@example.invalid"],
          "configure bare email"
        )
        yield* runInGitDirectory(
          git,
          bareRemote,
          ["config", "user.name", "Dalph concurrency fixture"],
          "configure bare name"
        )
        yield* runInWorktree(git, repository, ["remote", "add", "target", bareRemote], "add bare remote")
        yield* runInWorktree(git, repository, ["push", "target", "master:master"], "publish initial target")
        const baseSha = GitCommitSha.make(
          yield* runInWorktree(git, repository, ["rev-parse", "HEAD"], "read initial commit")
        )

        const runId = RunId.make("hermetic-concurrency-run")
        const target = FixtureTarget.make("hermetic-concurrency-target")
        const integrationTarget = IntegrationTarget.make({
          repository: GitRepositoryLocator.make(bareRemote),
          ref: IntegrationTargetRef.make("refs/heads/master")
        })
        const worktrees = new Map<TaskKey, WorktreeLocator>(
          taskKeys.map((task) => [task, WorktreeLocator.make(`${root}/task-${task}`)])
        )
        const specifications = new Map(
          taskKeys.map((task) => [
            task,
            makeTaskWorkSpecification({
              body: `Create RESULT-${task}.md.`,
              taskId: taskIdOf(task),
              title: `Complete ${task}`
            })
          ])
        )
        const plannedAttempts = new Map(
          taskKeys.map((task) => [
            task,
            PlannedTaskAttempt.make({
              attemptId: AttemptId.make(`hermetic-concurrency-attempt-${task}`),
              baseSha,
              branch: TaskBranchRef.make(`refs/heads/dalph/hermetic-concurrency-${task}`),
              executor: TaskExecutorLocator.make(`executor:hermetic-child-${task}`),
              runId,
              taskId: taskIdOf(task),
              taskRevision: taskValue(specifications, task).fingerprint,
              worktree: taskValue(worktrees, task)
            })
          ])
        )
        const lifecycle = yield* Ref.make(new Map<TaskKey, Lifecycle>(taskKeys.map((task) => [task, "Open"])))
        const claims = yield* Ref.make(
          new Map<TaskKey, TrackerClaim>(taskKeys.map((task) => [task, UnclaimedTask.make({ taskId: taskIdOf(task) })]))
        )
        const completedRequests = yield* Ref.make(new Map<TaskKey, ReturnType<typeof completionTaskRequestFor>>())
        const acceptedEvidence = yield* Ref.make(new Map<TaskKey, EvidenceReference>())
        const executorReports = yield* Ref.make(new Map<TaskKey, PlannedAttemptExecutorReport>())
        const childHandles = yield* Ref.make(new Map<TaskKey, ChildProcessSpawner.ChildProcessHandle>())
        const operationCounter = yield* Ref.make(0)
        const targetPromotionCompareAndSetRequests = yield* Ref.make<ReadonlyArray<TargetPromotionGitRequest>>([])
        const integratorRequests = yield* Ref.make<ReadonlyArray<IntegratorRequestType>>([])
        const promotionCandidates = yield* Ref.make(new Map<TaskKey, GitCommitSha>())
        const integratorCalls = yield* Ref.make<ReadonlyArray<TaskKey>>([])
        const integratorActive = yield* Ref.make(0)
        const integratorMaximumActive = yield* Ref.make(0)
        const graphSnapshots = yield* Ref.make<ReadonlyArray<ReadonlyMap<TaskKey, Lifecycle>>>([])
        const childReleaseOrder = yield* Ref.make<ReadonlyArray<TaskKey>>([])
        const childWorkFinishedOrder = yield* Ref.make<ReadonlyArray<TaskKey>>([])
        const childTerminalOrder = yield* Ref.make<ReadonlyArray<TaskKey>>([])
        const childReady = new Map<TaskKey, Deferred.Deferred<void>>()
        for (const task of taskKeys) childReady.set(task, yield* Deferred.make<void>())
        const childWorkFinished = new Map<TaskKey, Deferred.Deferred<void>>()
        for (const task of taskKeys) childWorkFinished.set(task, yield* Deferred.make<void>())
        const childTerminal = new Map<TaskKey, Deferred.Deferred<void>>()
        for (const task of taskKeys) childTerminal.set(task, yield* Deferred.make<void>())
        const accepted = new Map<TaskKey, Deferred.Deferred<void>>()
        for (const task of taskKeys) accepted.set(task, yield* Deferred.make<void>())
        const integratorStarted = new Map<TaskKey, Deferred.Deferred<void>>()
        for (const task of taskKeys) integratorStarted.set(task, yield* Deferred.make<void>())
        const allowBReport = yield* Deferred.make<void>()
        const releaseIntegratorA = yield* Deferred.make<void>()
        const releaseIntegratorB = yield* Deferred.make<void>()
        const graphACompletedWhileBOpen = yield* Deferred.make<void>()
        const graphBothCompleted = yield* Deferred.make<void>()
        const dStartedAfterGraph = yield* Deferred.make<void>()
        const dStarted = yield* Ref.make(false)

        const evidenceStore = yield* EvidenceStore.pipe(
          Effect.provide(nodeEvidenceStoreLayer(EvidenceStoreLocator.make(evidenceDirectory)))
        )
        const targetPromotionGit = yield* TargetPromotionGit.pipe(
          Effect.provide(nodeGitTargetPromotionLayer),
          Effect.provideService(GitCommand, git)
        )

        const trackerMutation = TrackerMutation.of({
          acquireTaskClaim: (acquisition) =>
            Ref.modify(claims, (current) => {
              const task = taskKeys.find((candidate) => taskIdOf(candidate) === acquisition.taskId)
              if (task === undefined)
                return [Effect.die("hermetic tracker received an unknown task claim"), current] as const
              const existing = current.get(task)
              const requested = ActiveTaskClaim.make(acquisition)
              if (existing?._tag === "UnclaimedTask")
                return [Effect.succeed(requested), new Map(current).set(task, requested)] as const
              if (existing?._tag === "ActiveTaskClaim" && isExactTaskClaim(existing, requested)) {
                return [Effect.succeed(existing), current] as const
              }
              return [Effect.die(`hermetic tracker found a conflicting claim for ${task}`), current] as const
            }).pipe(Effect.flatten),
          readTaskClaim: (taskId) =>
            Ref.get(claims).pipe(
              Effect.flatMap((current) => {
                const task = taskKeys.find((candidate) => taskId === taskIdOf(candidate))
                const claim = task === undefined ? undefined : current.get(task)
                return claim?._tag === "CompletionTaskClaim"
                  ? Effect.die("ordinary claim read cannot represent a completion claim")
                  : claim === undefined
                    ? Effect.die(`hermetic tracker has no claim for ${taskId}`)
                    : Effect.succeed(claim)
              })
            ),
          releaseTaskClaim: (release) =>
            Ref.modify(claims, (current) => {
              const task = taskKeys.find((candidate) => taskIdOf(candidate) === release.claim.taskId)
              const existing = task === undefined ? undefined : current.get(task)
              return task !== undefined &&
                existing?._tag === "ActiveTaskClaim" &&
                isExactTaskClaim(existing, release.claim)
                ? [Effect.void, new Map(current).set(task, UnclaimedTask.make({ taskId: taskIdOf(task) }))]
                : [Effect.die("hermetic tracker refused a non-exact release"), current]
            }).pipe(Effect.flatten)
        })

        const completionClaim: CompletionClaimBoundaryService = {
          readTaskClaim: (request) =>
            Ref.get(claims).pipe(
              Effect.flatMap((current) => {
                const task = taskKeys.find((candidate) => request.taskId === taskIdOf(candidate))
                const claim = task === undefined ? undefined : current.get(task)
                return claim === undefined
                  ? Effect.die(`hermetic tracker has no completion claim for ${request.taskId}`)
                  : Effect.succeed(claim)
              })
            ),
          replaceTaskClaim: (request) =>
            Ref.modify(claims, (current) => {
              const task = taskKeys.find((candidate) => taskIdOf(candidate) === request.claim.plannedAttempt.taskId)
              const existing = task === undefined ? undefined : current.get(task)
              return task !== undefined &&
                existing?._tag === "ActiveTaskClaim" &&
                isExactTaskClaim(existing, request.claim.originalClaim)
                ? [Effect.succeed(request.claim), new Map(current).set(task, request.claim)]
                : [Effect.die("completion claim replacement lacked exact active claim"), current]
            }).pipe(Effect.flatten),
          deleteTaskClaim: (request) =>
            Ref.modify(claims, (current) => {
              const task = taskKeys.find((candidate) => taskIdOf(candidate) === request.claim.plannedAttempt.taskId)
              const existing = task === undefined ? undefined : current.get(task)
              return task !== undefined &&
                existing?._tag === "CompletionTaskClaim" &&
                completionTaskClaimEquals(existing, request.claim)
                ? [Effect.void, new Map(current).set(task, UnclaimedTask.make({ taskId: taskIdOf(task) }))]
                : [Effect.die("completion claim deletion lacked exact completion claim"), current]
            }).pipe(Effect.flatten)
        }

        const completionTask: CompletionTaskBoundaryService = {
          readFocusedTaskCompletion: (taskId, focusedTarget, operationId) =>
            Effect.gen(function* () {
              const task = taskKeys.find((candidate) => taskId === taskIdOf(candidate))
              if (task === undefined) return yield* Effect.die(`unknown focused task ${taskId}`)
              const currentClaim = yield* Ref.get(claims).pipe(
                Effect.map((current) => current.get(task)),
                Effect.flatMap((claim) =>
                  claim === undefined ? Effect.die(`missing focused claim for ${task}`) : Effect.succeed(claim)
                )
              )
              if (currentClaim._tag !== "CompletionTaskClaim") {
                return yield* Effect.die(`focused completion read lacked completion claim for ${task}`)
              }
              const specification = specifications.get(task)
              if (specification === undefined) return yield* Effect.die(`missing specification for ${task}`)
              return {
                currentClaim,
                lifecycle: yield* Ref.get(lifecycle).pipe(Effect.map((current) => current.get(task) ?? "Open")),
                operationId,
                target: focusedTarget,
                targetMembership: "Member" as const,
                taskId,
                taskRevision: specification.fingerprint,
                trackerRevision: TrackerRevision.make(`hermetic-focused:${task}:${operationId}`),
                unfinishedPrerequisiteTaskIds:
                  task === "D"
                    ? [...(yield* Ref.get(lifecycle)).entries()].flatMap(([candidate, state]) =>
                        candidate !== "D" && state === "Open" ? [taskIdOf(candidate)] : []
                      )
                    : []
              }
            }),
          completeTask: (request) =>
            Effect.gen(function* () {
              const task = taskKeys.find((candidate) => taskIdOf(candidate) === request.taskId)
              if (task === undefined) return yield* Effect.die(`unknown completion task ${request.taskId}`)
              const candidate = yield* Ref.get(promotionCandidates).pipe(Effect.map((current) => current.get(task)))
              if (candidate === undefined)
                return yield* Effect.die(`completion for ${task} preceded candidate promotion`)
              const promoted = GitCommitSha.make(
                yield* runInGitDirectory(
                  git,
                  bareRemote,
                  ["rev-parse", "refs/heads/master"],
                  `prove promotion before ${task} completion`
                )
              )
              if (promoted !== candidate)
                return yield* Effect.die(`completion for ${task} preceded exact candidate promotion`)
              yield* Ref.update(completedRequests, (current) => new Map(current).set(task, request))
              yield* Ref.update(lifecycle, (current) => new Map(current).set(task, "CompletedSuccessfully"))
              return CompletionTaskAcknowledgement.make({ operationId: request.operationId, taskId: request.taskId })
            }).pipe(Effect.orDie),
          readCompletionRequest: (request) =>
            Ref.get(completedRequests).pipe(
              Effect.map((current) => {
                const task = taskKeys.find((candidate) => taskIdOf(candidate) === request.taskId)
                const stored = task === undefined ? undefined : current.get(task)
                return stored !== undefined && stored.operationId === request.operationId
                  ? CompletionTaskRequestLookup.cases.Applied.make({ request })
                  : CompletionTaskRequestLookup.cases.NotApplied.make({ request })
              })
            )
        }

        const trackerGraphReader = TrackerGraphReader.of({
          read: () =>
            Ref.get(lifecycle).pipe(
              Effect.flatMap((currentLifecycle) => {
                const snapshot = new Map(currentLifecycle)
                const projection = projectTrackerSnapshot({
                  revision: `hermetic-concurrency:${[...snapshot.values()].join(":")}`,
                  rootTaskId: taskIdOf("A"),
                  tasks: [
                    {
                      id: taskIdOf("A"),
                      lifecycle: { _tag: snapshot.get("A") ?? "Open" },
                      parentTaskId: null,
                      prerequisiteIds: []
                    },
                    {
                      id: taskIdOf("B"),
                      lifecycle: { _tag: snapshot.get("B") ?? "Open" },
                      parentTaskId: null,
                      prerequisiteIds: []
                    },
                    {
                      id: taskIdOf("D"),
                      lifecycle: { _tag: snapshot.get("D") ?? "Open" },
                      parentTaskId: null,
                      prerequisiteIds: [taskIdOf("A"), taskIdOf("B")]
                    }
                  ]
                })
                if (projection._tag !== "Valid") return Effect.die("hermetic concurrency graph must be valid")
                return Effect.gen(function* () {
                  yield* Ref.update(graphSnapshots, (current) => [...current, snapshot])
                  if (snapshot.get("A") === "CompletedSuccessfully" && snapshot.get("B") === "Open") {
                    yield* Deferred.succeed(graphACompletedWhileBOpen, undefined)
                  }
                  if (snapshot.get("A") === "CompletedSuccessfully" && snapshot.get("B") === "CompletedSuccessfully") {
                    yield* Deferred.succeed(graphBothCompleted, undefined)
                  }
                  return projection.snapshot
                })
              })
            ),
          readTaskWorkSpecification: (_target, taskId) => {
            const task = taskKeys.find((candidate) => taskId === taskIdOf(candidate))
            const specification = task === undefined ? undefined : specifications.get(task)
            return specification === undefined
              ? Effect.die(`missing task specification for ${taskId}`)
              : Effect.succeed(specification)
          }
        })

        const executor = PlannedAttemptExecutor.of({
          project: (correlation) =>
            Ref.get(executorReports).pipe(
              Effect.map((current) => {
                const report = [...current.values()].find(
                  (candidate) =>
                    candidate.correlation.attemptId === correlation.attemptId &&
                    candidate.correlation.runId === correlation.runId
                )
                return report === undefined
                  ? PlannedAttemptExecutorProjection.cases.NoReport.make({ correlation })
                  : PlannedAttemptExecutorProjection.cases.Exact.make({ report })
              })
            ),
          requestSuspension: () => Effect.die("the concurrency journey never requests suspension"),
          startOrContinue: (request) =>
            Effect.scoped(
              Effect.gen(function* () {
                const task = taskKeys.find((candidate) => request.plannedAttempt.taskId === taskIdOf(candidate))
                if (task === undefined)
                  return yield* Effect.die(`unknown planned attempt ${request.plannedAttempt.taskId}`)
                const existing = yield* Ref.get(executorReports).pipe(Effect.map((current) => current.get(task)))
                if (existing !== undefined) return existing
                if (task === "D") {
                  yield* Ref.set(dStarted, true)
                  if (Option.isNone(yield* Deferred.poll(graphBothCompleted))) {
                    return yield* Effect.die("D executor started before the later complete graph")
                  }
                  yield* Deferred.succeed(dStartedAfterGraph, undefined)
                }
                const handle = yield* childProcesses.spawn(
                  ChildProcess.make("node", ["-e", task === "D" ? immediateChildScript : barrierChildScript, task], {
                    cwd: request.plannedAttempt.worktree
                  })
                )
                yield* Ref.update(childHandles, (current) => new Map(current).set(task, handle))
                const ready = taskValue(childReady, task)
                const collector = yield* handle.stdout.pipe(
                  Stream.decodeText(),
                  Stream.splitLines,
                  Stream.runForEach((line) => {
                    if (line === `READY:${task}`) return Deferred.succeed(ready, undefined)
                    if (line === `WORK_FINISHED:${task}`) {
                      return Ref.update(childWorkFinishedOrder, (current) => [...current, task]).pipe(
                        Effect.andThen(Deferred.succeed(taskValue(childWorkFinished, task), undefined))
                      )
                    }
                    return Effect.void
                  }),
                  Effect.forkScoped
                )
                void collector
                const exitCode = yield* handle.exitCode
                if (exitCode !== 0) return yield* Effect.die(`hermetic child ${task} exited ${exitCode}`)
                yield* Ref.update(childTerminalOrder, (current) => [...current, task])
                yield* Deferred.succeed(taskValue(childTerminal, task), undefined)
                if (task === "B") yield* Deferred.await(allowBReport)
                yield* runInWorktree(
                  git,
                  request.plannedAttempt.worktree,
                  ["add", `RESULT-${task}.md`],
                  `stage ${task} result`
                )
                yield* runInWorktree(
                  git,
                  request.plannedAttempt.worktree,
                  ["commit", "-m", `complete ${task}`],
                  `commit ${task} result`
                )
                const commit = GitCommitSha.make(
                  yield* runInWorktree(
                    git,
                    request.plannedAttempt.worktree,
                    ["rev-parse", "HEAD"],
                    `read ${task} commit`
                  )
                )
                yield* runInWorktree(
                  git,
                  request.plannedAttempt.worktree,
                  ["push", bareRemote, `${commit}:refs/dalph/transfer-${task}`],
                  `transfer ${task} commit`
                )
                const evidenceManifest = yield* evidenceStore.put(acceptedManifestBytes(request.plannedAttempt, commit))
                yield* Ref.update(acceptedEvidence, (current) => new Map(current).set(task, evidenceManifest))
                const report = PlannedAttemptExecutorReport.cases.Terminal.make({
                  correlation: plannedAttemptExecutorCorrelation(request.plannedAttempt),
                  result: { _tag: "Accepted", acceptedResult: { commit, evidenceManifest } }
                })
                yield* Ref.update(executorReports, (current) => new Map(current).set(task, report))
                yield* Deferred.succeed(taskValue(accepted, task), undefined)
                return report
              })
            ).pipe(Effect.orDie)
        })

        const integrator: IntegratorService = {
          prepare: (request) =>
            Effect.gen(function* () {
              const correlation = request.correlation
              const acceptedCommit = correlation.acceptedResult.commit
              const plannedTask = taskKeys.find(
                (candidate) => plannedAttempts.get(candidate)?.attemptId === correlation.plannedAttempt.attemptId
              )
              if (plannedTask === undefined) return yield* Effect.die("Integrator received unknown accepted result")
              const expectedAttempt = taskValue(plannedAttempts, plannedTask)
              const expectedReport = (yield* Ref.get(executorReports)).get(plannedTask)
              if (expectedReport?._tag !== "Terminal" || expectedReport.result._tag !== "Accepted") {
                return yield* Effect.die(`Integrator received a non-accepted report for ${plannedTask}`)
              }
              const expectedTargetHead =
                plannedTask === "A"
                  ? baseSha
                  : taskValue(yield* Ref.get(promotionCandidates), plannedTask === "B" ? "A" : "B")
              if (
                !plannedTaskAttemptEquivalence(correlation.plannedAttempt, expectedAttempt) ||
                correlation.acceptedResult.commit !== expectedReport.result.acceptedResult.commit ||
                !evidenceReferenceEquals(
                  correlation.acceptedResult.evidenceManifest,
                  expectedReport.result.acceptedResult.evidenceManifest
                ) ||
                correlation.expectedTargetHead !== expectedTargetHead ||
                !integrationTargetEquals(correlation.integrationTarget, integrationTarget)
              ) {
                return yield* Effect.die(`Integrator received a swapped correlation for ${plannedTask}`)
              }
              const previousRequests = yield* Ref.get(integratorRequests)
              if (
                previousRequests.some(
                  ({ correlation: previous }) =>
                    previous.sessionId === correlation.sessionId ||
                    previous.candidateResource === correlation.candidateResource
                )
              ) {
                return yield* Effect.die(`Integrator reused a session or candidate resource for ${plannedTask}`)
              }
              yield* Ref.update(integratorRequests, (current) => [...current, request])
              yield* Ref.update(integratorActive, (current) => current + 1)
              const active = yield* Ref.get(integratorActive)
              yield* Ref.update(integratorMaximumActive, (current) => Math.max(current, active))
              yield* Ref.update(integratorCalls, (current) => [...current, plannedTask])
              yield* Deferred.succeed(taskValue(integratorStarted, plannedTask), undefined)
              return yield* Effect.gen(function* () {
                if (plannedTask === "A") yield* Deferred.await(releaseIntegratorA)
                if (plannedTask === "B") yield* Deferred.await(releaseIntegratorB)
                const tree = yield* runInGitDirectory(
                  git,
                  bareRemote,
                  ["merge-tree", "--write-tree", correlation.expectedTargetHead, acceptedCommit],
                  `merge ${plannedTask} accepted tree with the expected target`
                )
                const candidate = GitCommitSha.make(
                  yield* runInGitDirectory(
                    git,
                    bareRemote,
                    [
                      "commit-tree",
                      tree,
                      "-p",
                      correlation.expectedTargetHead,
                      "-p",
                      acceptedCommit,
                      "-m",
                      `integrate ${plannedTask}`
                    ],
                    `create ${plannedTask} integration candidate`
                  )
                )
                yield* Ref.update(promotionCandidates, (current) => new Map(current).set(plannedTask, candidate))
                yield* runInGitDirectory(
                  git,
                  bareRemote,
                  ["update-ref", "-d", `refs/dalph/transfer-${plannedTask}`, acceptedCommit],
                  `remove ${plannedTask} transfer ref`
                )
                return IntegratorResult.cases.PreparedCandidate.make({
                  candidateText: IntegratorCandidateText.make(candidate),
                  correlation
                })
              }).pipe(Effect.ensuring(Ref.update(integratorActive, (current) => current - 1)))
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
                  Ref.update(targetPromotionCompareAndSetRequests, (requests) => [...requests, request]).pipe(
                    Effect.andThen(targetPromotionGit.compareAndSet(request))
                  ),
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
          Effect.succeed(InitialControlPolicy.make({ taskExecutionCapacity: TaskWorkCapacity.make(2) })),
          AllocatedWorkflowRunId.make(runId)
        ).pipe(
          Effect.provideService(
            OperationIdAllocator,
            OperationIdAllocator.of({
              allocate: () =>
                Ref.getAndUpdate(operationCounter, (value) => value + 1).pipe(
                  Effect.map((value) => OperationId.make(`hermetic-concurrency-operation-${value}`))
                )
            })
          ),
          Effect.provideService(
            TaskClaimAcquisitionPlanner,
            TaskClaimAcquisitionPlanner.of({
              plan: (operationId, taskId) =>
                Effect.succeed({
                  operationId,
                  owner: ClaimOwner.make("dalph"),
                  taskId,
                  token: ClaimToken.make(`hermetic-concurrency-claim-${taskId}`)
                })
            })
          ),
          Effect.provideService(
            PlannedTaskAttemptPlanner,
            PlannedTaskAttemptPlanner.of({
              plan: (request) => {
                const task = taskKeys.find((candidate) => request.specification.taskId === taskIdOf(candidate))
                const plannedAttempt = task === undefined ? undefined : plannedAttempts.get(task)
                return plannedAttempt === undefined
                  ? Effect.die(`missing planned attempt for ${request.specification.taskId}`)
                  : Effect.succeed(plannedAttempt)
              }
            })
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
        const activationFiber = yield* activationDriver.pipe(Effect.forkScoped)
        yield* Deferred.await(taskValue(childReady, "A"))
        yield* Deferred.await(taskValue(childReady, "B"))
        const handlesAfterOverlap = yield* Ref.get(childHandles)
        expect(handlesAfterOverlap.has("A")).toBe(true)
        expect(handlesAfterOverlap.has("B")).toBe(true)
        const handleA = taskValue(handlesAfterOverlap, "A")
        const handleB = taskValue(handlesAfterOverlap, "B")
        expect(yield* handleA.isRunning).toBe(true)
        expect(yield* handleB.isRunning).toBe(true)

        const releaseChild = (task: TaskKey, handle: ChildProcessSpawner.ChildProcessHandle) =>
          Ref.update(childReleaseOrder, (current) => [...current, task]).pipe(Effect.andThen(sendChildRelease(handle)))

        // B writes and terminates first, but its accepted report is held at a
        // test-only barrier. A's report can therefore become the first queue
        // responsibility without changing the production executor boundary.
        yield* releaseChild("B", handleB)
        yield* Deferred.await(taskValue(childWorkFinished, "B"))
        yield* Deferred.await(taskValue(childTerminal, "B"))
        expect(yield* handleB.isRunning).toBe(false)
        expect(yield* Ref.get(childWorkFinishedOrder)).toEqual(["B"])
        expect(yield* Ref.get(childTerminalOrder)).toEqual(["B"])

        yield* releaseChild("A", handleA)
        yield* Deferred.await(taskValue(childWorkFinished, "A"))
        yield* Deferred.await(taskValue(childTerminal, "A"))
        yield* Deferred.await(taskValue(accepted, "A"))
        expect(yield* Ref.get(childWorkFinishedOrder)).toEqual(["B", "A"])
        expect(yield* Ref.get(childTerminalOrder)).toEqual(["B", "A"])
        expect((yield* Ref.get(executorReports)).has("B")).toBe(false)

        // This is the explicit A report barrier: only now may B return its
        // terminal executor report. Both accepted reports are therefore
        // durable in A-before-B order before integration begins.
        yield* Deferred.succeed(allowBReport, undefined)
        yield* Deferred.await(taskValue(accepted, "B"))
        yield* Deferred.await(taskValue(integratorStarted, "A"))
        const callsWhileAIntegratorHeld = yield* Ref.get(integratorCalls)
        expect(callsWhileAIntegratorHeld).toEqual(["A"])
        expect(yield* Ref.get(integratorMaximumActive)).toBe(1)
        expect(yield* Ref.get(integratorCalls)).toEqual(["A"])
        yield* Deferred.succeed(releaseIntegratorA, undefined)
        yield* Deferred.await(taskValue(integratorStarted, "B"))
        expect(yield* Ref.get(integratorMaximumActive)).toBe(1)

        yield* Deferred.await(graphACompletedWhileBOpen)
        expect(yield* Ref.get(dStarted)).toBe(false)
        yield* Deferred.succeed(releaseIntegratorB, undefined)
        yield* Deferred.await(graphBothCompleted)
        yield* Deferred.await(dStartedAfterGraph)
        yield* Fiber.join(activationFiber)
        expect(yield* Ref.get(terminated)).toBe(true)

        const records = yield* Effect.gen(function* () {
          return yield* (yield* JournalStore).read(runId)
        }).pipe(Effect.provide(sqliteJournalTestLayer({ filename: journalFilename })))
        const reports = yield* Ref.get(executorReports)
        const acceptedCommitFor = (task: TaskKey): GitCommitSha => {
          const report = taskValue(reports, task)
          const result = report._tag === "Terminal" ? report.result : undefined
          return Option.getOrThrow(
            result?._tag === "Accepted" ? Option.some(result.acceptedResult.commit) : Option.none()
          )
        }
        const targetHead = GitCommitSha.make(
          yield* runInGitDirectory(git, bareRemote, ["rev-parse", "refs/heads/master"], "read final promoted target")
        )
        const targetParents = (yield* runInGitDirectory(
          git,
          bareRemote,
          ["show", "-s", "--format=%P", targetHead],
          "read final target parents"
        )).split(" ")
        const promotedResults = yield* Effect.forEach(taskKeys, (task) =>
          git
            .run(bareRemote, ["show", `${targetHead}:RESULT-${task}.md`])
            .pipe(Effect.map((result) => [task, result] as const))
        )
        const eventTags = records.map(({ event }) => event._tag)
        const responsibilityRecords = recordsOfTag(records, "IntegrationResponsibilityBegan")
        const integrationStartedRecords = recordsOfTag(records, "IntegrationStarted")
        const integratorRunRecords = recordsOfTag(records, "IntegratorRunStarted")
        const qualificationRecords = recordsOfTag(records, "IntegratorRunCandidateGitObserved")
        const promotionRecords = recordsOfTag(records, "TargetPromotionObservedSuccess")
        const promotionAttemptRecords = recordsOfTag(records, "TargetPromotionAttemptIntended")
        const completionRecords = recordsOfTag(records, "CompletionTaskAcknowledged")
        const graphRecords = recordsOfTag(records, "TaskTrackerFactsObserved")
        const lineageRecords = recordsOfTag(records, "TargetLineageObserved")
        const executorReportRecords = recordsOfTag(records, "PlannedAttemptExecutorWorkReported")
        const terminationRecords = recordsOfTag(records, "WorkflowRunTerminated")

        for (const task of taskKeys) yield* Deferred.await(taskValue(childWorkFinished, task))
        for (const task of taskKeys) yield* Deferred.await(taskValue(childTerminal, task))
        expect(yield* Ref.get(childReleaseOrder)).toEqual(["B", "A"])
        expect(yield* Ref.get(childWorkFinishedOrder)).toEqual(["B", "A", "D"])
        expect(yield* Ref.get(childTerminalOrder)).toEqual(["B", "A", "D"])

        expect(promotedResults).toEqual(
          taskKeys.map((task) => [task, expect.objectContaining({ exitCode: 0, stdout: `implemented ${task}\n` })])
        )
        expect(targetParents).toEqual([taskValue(yield* Ref.get(promotionCandidates), "B"), acceptedCommitFor("D")])
        expect(responsibilityRecords.map(({ event }) => event.plannedAttempt.taskId)).toEqual([
          taskIdOf("A"),
          taskIdOf("B"),
          taskIdOf("D")
        ])
        expect(responsibilityRecords.map(({ position }) => position)).toEqual(
          [...responsibilityRecords].map(({ position }) => position).sort((left, right) => left - right)
        )
        expect(responsibilityRecords.map(({ event }) => event.plannedAttempt.taskId)).not.toEqual(
          (yield* Ref.get(childWorkFinishedOrder)).map(taskIdOf)
        )
        expect(responsibilityRecords.map(({ event }) => event.plannedAttempt.taskId)).not.toEqual(
          [...taskKeys].map(taskIdOf).sort((left, right) => left.localeCompare(right))
        )
        const acceptedExecutorReportFor = (task: TaskKey) =>
          executorReportRecords.find(
            ({ event }) =>
              event.report._tag === "Terminal" &&
              event.report.result._tag === "Accepted" &&
              event.report.correlation.attemptId === taskValue(plannedAttempts, task).attemptId
          )
        const acceptedAReport = acceptedExecutorReportFor("A")
        const acceptedBReport = acceptedExecutorReportFor("B")
        expect(acceptedAReport).toBeDefined()
        expect(acceptedBReport).toBeDefined()
        if (acceptedAReport === undefined || acceptedBReport === undefined) {
          return yield* Effect.die("integration started without both accepted executor reports")
        }
        const aIntegrationResponsibility = responsibilityRecords.find(
          ({ event }) => event.plannedAttempt.taskId === taskIdOf("A")
        )
        const bIntegrationResponsibility = responsibilityRecords.find(
          ({ event }) => event.plannedAttempt.taskId === taskIdOf("B")
        )
        const firstIntegratorRun = integratorRunRecords[0]
        expect(aIntegrationResponsibility).toBeDefined()
        expect(bIntegrationResponsibility).toBeDefined()
        expect(firstIntegratorRun).toBeDefined()
        if (
          aIntegrationResponsibility === undefined ||
          bIntegrationResponsibility === undefined ||
          firstIntegratorRun === undefined
        ) {
          return yield* Effect.die("accepted executor reports had no following integration")
        }
        expect(acceptedAReport.position).toBeLessThan(aIntegrationResponsibility.position)
        expect(acceptedBReport.position).toBeLessThan(bIntegrationResponsibility.position)
        expect(aIntegrationResponsibility.position).toBeLessThan(acceptedBReport.position)
        expect(aIntegrationResponsibility.position).toBeLessThan(bIntegrationResponsibility.position)
        expect(acceptedAReport.position).toBeLessThan(firstIntegratorRun.position)
        expect(acceptedBReport.position).toBeLessThan(firstIntegratorRun.position)
        expect(integratorRunRecords.map(({ event }) => event.run.session.plannedAttempt.taskId)).toEqual([
          taskIdOf("A"),
          taskIdOf("B"),
          taskIdOf("D")
        ])
        const qualificationRecordFor = (task: TaskKey) =>
          qualificationRecords.find(({ event }) => event.run.session.plannedAttempt.taskId === taskIdOf(task))
        const qualificationFor = (task: TaskKey) => qualificationRecordFor(task)?.event
        const aQualification = qualificationFor("A")
        const bQualification = qualificationFor("B")
        const dQualification = qualificationFor("D")
        if (aQualification?.observation._tag !== "Commit") return yield* Effect.die("A candidate was not a Git commit")
        if (bQualification?.observation._tag !== "Commit") return yield* Effect.die("B candidate was not a Git commit")
        if (dQualification?.observation._tag !== "Commit") return yield* Effect.die("D candidate was not a Git commit")
        expect(aQualification.observation.directParents).toEqual([baseSha, acceptedCommitFor("A")])
        expect(bQualification.observation.directParents).toEqual([
          aQualification.observation.commit,
          acceptedCommitFor("B")
        ])
        expect(dQualification.observation.directParents).toEqual([
          bQualification.observation.commit,
          acceptedCommitFor("D")
        ])
        expect((yield* Ref.get(promotionCandidates)).get("A")).toBe(aQualification.observation.commit)
        expect((yield* Ref.get(promotionCandidates)).get("B")).toBe(bQualification.observation.commit)
        expect((yield* Ref.get(promotionCandidates)).get("D")).toBe(dQualification.observation.commit)
        const recordedIntegratorRequests = yield* Ref.get(integratorRequests)
        const integratorRequestFor = (task: TaskKey) =>
          recordedIntegratorRequests.find(({ correlation }) => correlation.plannedAttempt.taskId === taskIdOf(task))
        const lineageRecordFor = (task: TaskKey) => {
          const request = integratorRequestFor(task)
          return request === undefined
            ? undefined
            : lineageRecords.find(({ position }) => position === request.correlation.targetLineageObservedAt)
        }
        const sessionIds = recordedIntegratorRequests.map(({ correlation }) => correlation.sessionId)
        const candidateResources = recordedIntegratorRequests.map(({ correlation }) => correlation.candidateResource)
        expect(recordedIntegratorRequests).toHaveLength(3)
        expect(recordedIntegratorRequests.map(({ correlation }) => correlation.plannedAttempt.taskId)).toEqual([
          taskIdOf("A"),
          taskIdOf("B"),
          taskIdOf("D")
        ])
        expect(new Set(sessionIds).size).toBe(3)
        expect(new Set(candidateResources).size).toBe(3)
        for (const task of taskKeys) {
          const responsibility = responsibilityRecords.find(
            ({ event }) => event.plannedAttempt.taskId === taskIdOf(task)
          )
          const started = integratorRunRecords.find(
            ({ event }) => event.run.session.plannedAttempt.taskId === taskIdOf(task)
          )
          const integrationStarted = integrationStartedRecords.find(
            ({ event }) => event.plannedAttempt.taskId === taskIdOf(task)
          )
          const qualification = qualificationRecordFor(task)
          const request = integratorRequestFor(task)
          const lineage = lineageRecordFor(task)
          expect(request).toBeDefined()
          expect(responsibility).toBeDefined()
          expect(integrationStarted).toBeDefined()
          expect(started).toBeDefined()
          expect(qualification).toBeDefined()
          expect(lineage).toBeDefined()
          if (
            request === undefined ||
            responsibility === undefined ||
            integrationStarted === undefined ||
            started === undefined ||
            qualification === undefined ||
            lineage === undefined
          ) {
            return yield* Effect.die(`missing full Integrator correlation for ${task}`)
          }
          expect(responsibility.event.plannedAttempt).toEqual(plannedAttempts.get(task))
          expect(responsibility.event.acceptedResult.commit).toBe(acceptedCommitFor(task))
          expect(started.event.run.ordinal).toBe(1)
          expect(started.event.run.session.plannedAttempt).toEqual(plannedAttempts.get(task))
          expect(started.event.run.session.acceptedResult.commit).toBe(acceptedCommitFor(task))
          expect(request.correlation.plannedAttempt).toEqual(responsibility.event.plannedAttempt)
          expect(request.correlation.acceptedResult).toEqual(responsibility.event.acceptedResult)
          expect(request.correlation.integrationTarget).toEqual(responsibility.event.integrationTarget)
          expect(request.correlation.queuedAt).toBe(responsibility.position)
          expect(request.correlation.startedAt).toBe(integrationStarted.position)
          expect(integrationStarted.event.responsibilityBeganAt).toBe(responsibility.position)
          expect(request.correlation.targetLineageObservedAt).toBeGreaterThan(integrationStarted.position)
          expect(request.correlation.targetLineageObservedAt).toBeLessThan(started.position)
          expect(started.position).toBeGreaterThan(integrationStarted.position)
          expect(started.event.run.session).toEqual(request.correlation)
          expect(qualification.event.run).toEqual(started.event.run)
          expect(qualification.position).toBeGreaterThan(started.position)
          expect(lineage.event.plannedAttempt).toEqual(request.correlation.plannedAttempt)
          expect(lineage.event.observation.targetHeadSha).toBe(request.correlation.expectedTargetHead)
        }
        expect(qualificationRecords).toHaveLength(3)
        expect(promotionRecords).toHaveLength(3)
        expect(promotionAttemptRecords).toHaveLength(3)
        expect(completionRecords).toHaveLength(3)
        expect(eventTags.filter((tag) => tag === "WorkflowRunBegan")).toHaveLength(1)
        expect(terminationRecords).toHaveLength(1)
        expect(terminationRecords[0]?.event).toMatchObject({ _tag: "WorkflowRunTerminated", disposition: "Completed" })
        expect(records.at(-1)?.event).toEqual(terminationRecords[0]?.event)
        expect(eventTags.some((tag) => tag === "WorktreeCleanupAuthorized")).toBe(false)
        expect(eventTags.some((tag) => tag === "WorktreeCleanupSettled")).toBe(false)
        expect(eventTags.some((tag) => tag === "BranchCleanupAuthorized")).toBe(false)
        expect(eventTags.some((tag) => tag === "BranchCleanupSettled")).toBe(false)
        expect(graphRecords.length).toBeGreaterThanOrEqual(2)
        expect(
          (yield* Ref.get(graphSnapshots)).some(
            (snapshot) => snapshot.get("A") === "CompletedSuccessfully" && snapshot.get("B") === "Open"
          )
        ).toBe(true)
        expect(
          (yield* Ref.get(graphSnapshots)).some(
            (snapshot) => snapshot.get("A") === "CompletedSuccessfully" && snapshot.get("B") === "CompletedSuccessfully"
          )
        ).toBe(true)
        expect(yield* Ref.get(integratorMaximumActive)).toBe(1)
        expect(yield* Ref.get(integratorCalls)).toEqual(["A", "B", "D"])
        expect(yield* Ref.get(targetPromotionCompareAndSetRequests)).toEqual([
          { candidateCommit: aQualification.observation.commit, expectedTargetHead: baseSha, integrationTarget },
          {
            candidateCommit: bQualification.observation.commit,
            expectedTargetHead: aQualification.observation.commit,
            integrationTarget
          },
          {
            candidateCommit: dQualification.observation.commit,
            expectedTargetHead: bQualification.observation.commit,
            integrationTarget
          }
        ])
        expect(yield* Ref.get(lifecycle)).toEqual(
          new Map<TaskKey, Lifecycle>([
            ["A", "CompletedSuccessfully"],
            ["B", "CompletedSuccessfully"],
            ["D", "CompletedSuccessfully"]
          ])
        )
        expect(yield* Ref.get(claims)).toEqual(
          new Map<TaskKey, TrackerClaim>(taskKeys.map((task) => [task, UnclaimedTask.make({ taskId: taskIdOf(task) })]))
        )
        expect(yield* fileSystem.exists(journalFilename)).toBe(true)
        expect(yield* fileSystem.exists(evidenceDirectory)).toBe(true)
        expect(yield* fileSystem.exists(repository)).toBe(true)
        expect(yield* fileSystem.exists(bareRemote)).toBe(true)
        const completePrerequisitesGraph = graphRecords.find(({ event }) => {
          if (event.observation._tag !== "CompleteTaskTrackerFacts") return false
          const lifecycles = event.observation.factFamilies[1].lifecycles
          return (
            lifecycles.some(
              ({ lifecycle, taskId }) => taskId === taskIdOf("A") && lifecycle._tag === "CompletedSuccessfully"
            ) &&
            lifecycles.some(
              ({ lifecycle, taskId }) => taskId === taskIdOf("B") && lifecycle._tag === "CompletedSuccessfully"
            ) &&
            lifecycles.some(({ lifecycle, taskId }) => taskId === taskIdOf("D") && lifecycle._tag === "Open")
          )
        })
        const focusedCompletionRecordFor = (task: TaskKey) =>
          graphRecords
            .filter(
              ({ event }) =>
                event.observation._tag === "FocusedTaskCompletionFacts" &&
                event.observation.facts.taskId === taskIdOf(task)
            )
            .at(-1)
        const focusedACompletion = focusedCompletionRecordFor("A")
        const focusedBCompletion = focusedCompletionRecordFor("B")
        const dResponsibility = responsibilityRecords.find(({ event }) => event.plannedAttempt.taskId === taskIdOf("D"))
        const dIntegratorStart = integratorRunRecords.find(
          ({ event }) => event.run.session.plannedAttempt.taskId === taskIdOf("D")
        )
        expect(completePrerequisitesGraph).toBeDefined()
        expect(focusedACompletion).toBeDefined()
        expect(focusedBCompletion).toBeDefined()
        expect(dResponsibility).toBeDefined()
        expect(dIntegratorStart).toBeDefined()
        if (
          completePrerequisitesGraph === undefined ||
          focusedACompletion === undefined ||
          focusedBCompletion === undefined ||
          dResponsibility === undefined ||
          dIntegratorStart === undefined
        ) {
          return yield* Effect.die("D started without the durable completed prerequisite graph")
        }
        expect(focusedACompletion.event.observation._tag).toBe("FocusedTaskCompletionFacts")
        expect(focusedBCompletion.event.observation._tag).toBe("FocusedTaskCompletionFacts")
        if (
          focusedACompletion.event.observation._tag !== "FocusedTaskCompletionFacts" ||
          focusedBCompletion.event.observation._tag !== "FocusedTaskCompletionFacts"
        ) {
          return yield* Effect.die("focused completion observation was not task-local")
        }
        expect(focusedACompletion.event.observation.facts.taskId).toBe(taskIdOf("A"))
        expect(focusedBCompletion.event.observation.facts.taskId).toBe(taskIdOf("B"))
        expect(completePrerequisitesGraph.position).toBeGreaterThan(focusedACompletion.position)
        expect(completePrerequisitesGraph.position).toBeGreaterThan(focusedBCompletion.position)
        expect(completePrerequisitesGraph.position).toBeLessThan(dResponsibility.position)
        expect(completePrerequisitesGraph.position).toBeLessThan(dIntegratorStart.position)
        for (const task of taskKeys) {
          const evidenceReference = (yield* Ref.get(acceptedEvidence)).get(task)
          expect(evidenceReference).toBeDefined()
          if (evidenceReference === undefined) return yield* Effect.die(`missing accepted evidence for ${task}`)
          const bytes = yield* evidenceStore.read(evidenceReference)
          const decoded = yield* Schema.decodeUnknownEffect(AcceptedResultEvidenceManifest)(
            JSON.parse(new TextDecoder().decode(bytes))
          )
          expect(decoded.correlation.attemptId).toBe(taskValue(plannedAttempts, task).attemptId)
          expect(decoded.correlation.runId).toBe(runId)
          const taskWorktree = taskValue(worktrees, task)
          const plannedAttempt = taskValue(plannedAttempts, task)
          expect(yield* fileSystem.exists(taskWorktree)).toBe(true)
          expect(yield* fileSystem.readFileString(`${taskWorktree}/RESULT-${task}.md`)).toBe(`implemented ${task}\n`)
          expect((yield* git.runInWorktree(repository, ["show-ref", "--verify", plannedAttempt.branch])).exitCode).toBe(
            0
          )
          expect(
            (yield* git.run(bareRemote, ["show-ref", "--verify", `refs/dalph/transfer-${task}`])).exitCode
          ).not.toBe(0)
          const currentChildHandles = yield* Ref.get(childHandles)
          expect(yield* taskValue(currentChildHandles, task).isRunning).toBe(false)
        }

        const lockReacquired = yield* Effect.scoped(
          CoordinatorOwnership.pipe(
            Effect.provide(productionCoordinatorOwnershipLayer(GitCommonDirectoryTarget.make(`${repository}/.git`))),
            Effect.as(true)
          )
        )
        expect(lockReacquired).toBe(true)
      }).pipe(Effect.ensuring(fileSystem.remove(root, { recursive: true }).pipe(Effect.orDie)))

      expect(yield* fileSystem.exists(root)).toBe(false)
    }).pipe(Effect.provide(nodeGitCommandLayer), Effect.provide(NodeServices.layer)),
  120_000
)
