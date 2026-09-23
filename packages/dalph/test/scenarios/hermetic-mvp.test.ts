// @effect-diagnostics multipleEffectProvide:off
import {
  AcceptedResultEvidenceManifest,
  AttemptId,
  type EvidenceReference,
  GitCommitSha,
  GitRepositoryLocator,
  IntegrationTarget,
  IntegrationTargetRef,
  RemotePublicationBranchRef,
  RemotePublicationEndpoint,
  RemotePublicationTarget,
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
  CompletionClaimMarkerAbsent,
  CompletionTaskAcknowledgement,
  type CompletionTaskClaim,
  CompletionTaskRequestLookup,
  CoordinatorOwnership,
  DeliveryRuntimeObservationObserver,
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
  nodeGitDirectPublicationLayer,
  nodeGitCommandLayer,
  nodeGitRemoteBaselineLayer,
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
  WorkflowTrace,
  completionTaskClaimEquals,
  type completionTaskRequestFor,
  type CompletionClaimBoundaryService,
  type CompletionTaskBoundaryService,
  type IntegratorService,
  type WorkflowJournalEvent
} from "@dalph/orchestrator"
import { ChildProcess, ChildProcessSpawner } from "effect/unstable/process"
import { ConfigProvider, Deferred, Effect, Exit, FileSystem, Fiber, Layer, Option, Ref, Schema, Scope } from "effect"
import { expect } from "vitest"
import { productionWorkflowInterpreterLayer } from "../../src/application/production.js"
import { fileGitSenderCustodyLayer } from "../../src/application/git-sender-custody.js"
import { controlledSynchronousPlannedAttemptExecutorLayer } from "../../test-support/controlled-synchronous-planned-attempt-executor.js"
import {
  acceptedManifestBytes,
  hermeticCandidateProviderAuthority,
  remoteBaselineGitLayerForCurrentHead,
  runInGitDirectory,
  runInWorktree
} from "./hermetic-support.js"
import {
  remotePublicationGitLayerForProductionTest,
  remotePublicationTargetForTest
} from "../../../orchestrator/test/support/direct-publication.js"
import { RemotePublicationGit } from "../../../orchestrator/src/workflow/protocols/direct-publication/events.js"

type TrackerClaim = ActiveTaskClaim | UnclaimedTask
const hasEventTag =
  <Tag extends WorkflowJournalEvent["_tag"]>(tag: Tag) =>
  <Record extends { readonly event: WorkflowJournalEvent }>(
    record: Record
  ): record is Record & { readonly event: Extract<WorkflowJournalEvent, { readonly _tag: Tag }> } =>
    record.event._tag === tag
const maxActivationPasses = 64
const runHermeticMvpJourney = (
  crashAfterPromotion: boolean,
  competingHeadBeforeDiscovery = false,
  competingHeadBetweenDiscoveryAndPush = false
) =>
  Effect.gen(function* () {
    const competingHeadRace = competingHeadBeforeDiscovery || competingHeadBetweenDiscoveryAndPush
    const fileSystem = yield* FileSystem.FileSystem
    const git = yield* GitCommand
    const childProcesses = yield* ChildProcessSpawner.ChildProcessSpawner
    const root = yield* fileSystem.makeTempDirectory({ prefix: "dalph-hermetic-mvp-" })
    const executorScope = yield* Scope.make()

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
      const integrationRef = IntegrationTargetRef.make(
        competingHeadRace ? "refs/heads/integration-target" : "refs/heads/master"
      )
      if (competingHeadRace) {
        yield* runInWorktree(
          git,
          repository,
          ["branch", integrationRef.slice("refs/heads/".length), baseSha],
          "create unoccupied local integration target"
        )
      }
      const competingHead = yield* Effect.gen(function* () {
        if (!competingHeadRace) return undefined
        const outsideWorktree = `${root}/outside-H2`
        yield* runInWorktree(
          git,
          repository,
          ["worktree", "add", "--detach", outsideWorktree, baseSha],
          "create outside H2 worktree"
        )
        yield* fileSystem.writeFileString(`${outsideWorktree}/OUTSIDE.md`, "compatible outside change\n")
        yield* runInWorktree(git, outsideWorktree, ["add", "OUTSIDE.md"], "stage outside change")
        yield* runInWorktree(git, outsideWorktree, ["commit", "-m", "outside H2"], "commit outside H2")
        const head = GitCommitSha.make(
          yield* runInWorktree(git, outsideWorktree, ["rev-parse", "HEAD"], "read outside H2")
        )
        yield* runInWorktree(
          git,
          repository,
          ["worktree", "remove", "--force", outsideWorktree],
          "remove outside H2 worktree"
        )
        return head
      })
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
        repository: GitRepositoryLocator.make(competingHeadRace ? repository + "/.git" : bareRemote),
        ref: integrationRef
      })
      const remotePublicationTarget = competingHeadRace
        ? RemotePublicationTarget.make({
            branch: RemotePublicationBranchRef.make("refs/heads/master"),
            endpoint: RemotePublicationEndpoint.make(bareRemote)
          })
        : remotePublicationTargetForTest
      const lifecycle = yield* Ref.make<"Open" | "CompletedSuccessfully">("Open")
      const trackerClaim = yield* Ref.make<TrackerClaim>(UnclaimedTask.make({ taskId }))
      const completionMarker = yield* Ref.make<Option.Option<CompletionTaskClaim>>(Option.none())
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
      const runtimeTrace = yield* Ref.make<ReadonlyArray<string>>([])
      const runtimeObservation = DeliveryRuntimeObservationObserver.of({
        observe: ({ evaluation, liveOwners }) => {
          type ProposedAction = Extract<
            typeof evaluation.proposedActions,
            { readonly _tag: "DeliveryProposalsAvailable" }
          >["proposals"][number]
          const routeTag = (proposal: ProposedAction) =>
            "transition" in proposal.route ? proposal.route.transition._tag : proposal.route._tag
          const proposals =
            evaluation.proposedActions._tag === "DeliveryProposalsAvailable"
              ? evaluation.proposedActions.proposals.map((proposal) => `${proposal.owner}:${routeTag(proposal)}`)
              : [`${evaluation.proposedActions._tag}`]
          const owners = liveOwners.map((owner) => `${owner._tag}:${routeTag(owner.proposal)}`)
          const entry = `acceptedAt=${evaluation.acceptedAt ?? "null"} proposals=${proposals.join(",")} owners=${owners.join(",")}`
          return Ref.update(runtimeTrace, (entries) => [...entries.slice(-19), entry])
        }
      })
      const promotionAppliedWithoutResponse = yield* Deferred.make<void>()
      const terminalProjectionReady = yield* Deferred.make<void>()

      const evidenceStore = yield* EvidenceStore.pipe(
        Effect.provide(nodeEvidenceStoreLayer(EvidenceStoreLocator.make(evidenceDirectory)))
      )
      const targetPromotionGit = yield* TargetPromotionGit.pipe(
        Effect.provide(nodeGitTargetPromotionLayer),
        Effect.provideService(GitCommand, git)
      )
      const publicationObserved = yield* Ref.make(false)
      const publicationPushed = yield* Ref.make(false)
      const outsideHeadPublished = yield* Ref.make(false)
      const remotePublicationGitLayer = yield* Effect.gen(function* () {
        if (!competingHeadRace) return remotePublicationGitLayerForProductionTest
        const publicationGitCommand = yield* GitCommand.pipe(
          Effect.provide(
            nodeGitCommandLayer.pipe(
              Layer.provide(fileGitSenderCustodyLayer(GitCommonDirectoryTarget.make(`${repository}/.git`))),
              Layer.provide(NodeServices.layer),
              Layer.fresh
            )
          )
        )
        const gitAuthority = yield* RemotePublicationGit.pipe(
          Effect.provide(
            nodeGitDirectPublicationLayer(GitRepositoryLocator.make(repository + "/.git")).pipe(
              Layer.provide(Layer.succeed(GitCommand, publicationGitCommand))
            )
          )
        )
        return Layer.succeed(
          RemotePublicationGit,
          RemotePublicationGit.of({
            ...gitAuthority,
            observe: (request) =>
              Effect.gen(function* () {
                const alreadyObserved = yield* Ref.getAndSet(publicationObserved, true)
                if (!alreadyObserved && competingHeadBeforeDiscovery) {
                  if (competingHead === undefined) return yield* Effect.die("automatic S2 lacked outside H2")
                  yield* runInWorktree(
                    git,
                    repository,
                    ["push", "target", `${competingHead}:refs/heads/master`],
                    "publish outside H2 before publication discovery"
                  )
                  yield* Ref.set(outsideHeadPublished, true)
                }
                return yield* gitAuthority.observe(request)
              }),
            push: (request, attemptOrdinal) =>
              Effect.gen(function* () {
                const alreadyPushed = yield* Ref.getAndSet(publicationPushed, true)
                if (!alreadyPushed && competingHeadBetweenDiscoveryAndPush) {
                  if (competingHead === undefined) return yield* Effect.die("automatic S2 lacked outside H2")
                  if (!(yield* Ref.get(publicationObserved))) {
                    return yield* Effect.die("between-discovery S2 race must follow the publication discovery read")
                  }
                  yield* runInWorktree(
                    git,
                    repository,
                    ["push", "target", `${competingHead}:refs/heads/master`],
                    "publish outside H2 between discovery and publication update"
                  )
                  yield* Ref.set(outsideHeadPublished, true)
                }
                return yield* gitAuthority.push(request, attemptOrdinal)
              })
          })
        )
      })
      const remoteBaselineLayer = competingHeadRace
        ? nodeGitRemoteBaselineLayer.pipe(Layer.provide(Layer.succeed(GitCommand, git)))
        : remoteBaselineGitLayerForCurrentHead(git)

      const trackerMutation = TrackerMutation.of({
        acquireTaskClaim: (acquisition) =>
          Ref.modify(trackerClaim, (current) => {
            if (current._tag === "UnclaimedTask") {
              const claim = ActiveTaskClaim.make(acquisition)
              return [Effect.succeed(claim), claim] as const
            }
            if (isExactTaskClaim(current, ActiveTaskClaim.make(acquisition))) {
              return [Effect.succeed(current), current] as const
            }
            return [Effect.die("hermetic tracker found a conflicting claim"), current] as const
          }).pipe(Effect.flatten),
        readTaskClaim: () => Ref.get(trackerClaim),
        releaseTaskClaim: (release) =>
          Ref.modify(trackerClaim, (current) =>
            current._tag === "ActiveTaskClaim" && isExactTaskClaim(current, release.claim)
              ? ([Effect.void, UnclaimedTask.make({ taskId })] as const)
              : ([Effect.die("hermetic tracker refused a non-exact release"), current] as const)
          ).pipe(Effect.flatten)
      })

      const completionClaim: CompletionClaimBoundaryService = {
        readCompletionClaimMarker: () =>
          Ref.get(completionMarker).pipe(
            Effect.map((marker) =>
              Option.isSome(marker) ? marker.value : CompletionClaimMarkerAbsent.make({ taskId })
            )
          ),
        readOriginalTaskClaim: () => Ref.get(trackerClaim),
        readTaskClaim: () =>
          Effect.gen(function* () {
            const marker = yield* Ref.get(completionMarker)
            return Option.isSome(marker) ? marker.value : yield* Ref.get(trackerClaim)
          }),
        replaceTaskClaim: (request) =>
          Ref.get(trackerClaim).pipe(
            Effect.flatMap((current) =>
              current._tag === "ActiveTaskClaim" && isExactTaskClaim(current, request.claim.originalClaim)
                ? Ref.set(completionMarker, Option.some(request.claim)).pipe(Effect.as(request.claim))
                : Effect.die("completion claim replacement lacked the exact active claim")
            )
          ),
        releaseOriginalTaskClaim: trackerMutation.releaseTaskClaim,
        deleteTaskClaim: (request) =>
          Ref.modify(completionMarker, (current) =>
            Option.isSome(current) && completionTaskClaimEquals(current.value, request.claim)
              ? ([Effect.void, Option.none()] as const)
              : ([Effect.die("completion claim deletion lacked the exact completion claim"), current] as const)
          ).pipe(Effect.flatten)
      }

      const completionTask: CompletionTaskBoundaryService = {
        readFocusedTaskCompletion: (readRequest) =>
          Effect.gen(function* () {
            const currentClaim = yield* Ref.get(completionMarker)
            if (Option.isNone(currentClaim)) {
              return yield* Effect.die("focused completion read lacked the exact completion claim")
            }
            return {
              currentClaim: currentClaim.value,
              lifecycle: yield* Ref.get(lifecycle),
              operationId: readRequest.operationId,
              target: readRequest.target,
              targetMembership: "Member" as const,
              taskId,
              taskRevision: specification.fingerprint,
              trackerRevision: TrackerRevision.make(`hermetic-focused:${readRequest.operationId}`),
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
        observe: (correlation) =>
          Ref.get(executorReport).pipe(
            Effect.map(
              Option.match({
                onNone: () => PlannedAttemptExecutorProjection.cases.NoReport.make({ correlation }),
                onSome: (report) => PlannedAttemptExecutorProjection.cases.Exact.make({ report })
              })
            )
          ),
        requestSuspension: () => Effect.die("the no-crash journey never requests suspension"),
        resume: () => Effect.die("the no-crash journey never resumes executor work"),
        begin: (request) =>
          Effect.gen(function* () {
            const existing = yield* Ref.get(executorReport)
            if (Option.isSome(existing)) return existing.value
            yield* Ref.update(executorStarts, (starts) => starts + 1)
            const executing = PlannedAttemptExecutorReport.cases.ExecutorWorkExecuting.make({
              correlation: plannedAttemptExecutorCorrelation(request.plannedAttempt)
            })
            yield* Ref.set(executorReport, Option.some(executing))
            yield* Effect.scoped(
              Effect.gen(function* () {
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
                const report = PlannedAttemptExecutorReport.cases.ExecutorWorkTerminal.make({
                  correlation: plannedAttemptExecutorCorrelation(request.plannedAttempt),
                  result: { _tag: "Accepted", acceptedResult: { commit, evidenceManifest } }
                })
                yield* Ref.set(executorReport, Option.some(report))
                yield* Deferred.succeed(terminalProjectionReady, undefined)
              })
            ).pipe(Effect.orDie, Effect.forkIn(executorScope))
            return executing
          }).pipe(Effect.orDie)
      })

      const integrator: IntegratorService = {
        prepare: (request) =>
          Effect.gen(function* () {
            const call = yield* Ref.updateAndGet(integratorCalls, (calls) => calls + 1)
            const acceptedCommit = request.correlation.session.acceptedResult.commit
            const candidateRepository = competingHeadRace ? repository + "/.git" : bareRemote
            const tree = yield* runInGitDirectory(
              git,
              candidateRepository,
              ["rev-parse", `${acceptedCommit}^{tree}`],
              "read accepted tree"
            )
            const candidate = GitCommitSha.make(
              yield* runInGitDirectory(
                git,
                candidateRepository,
                [
                  "commit-tree",
                  tree,
                  "-p",
                  request.correlation.session.expectedTargetHead,
                  "-p",
                  acceptedCommit,
                  "-m",
                  "integrate A"
                ],
                "create explicit integration candidate"
              )
            )
            yield* Ref.set(integratorCandidate, Option.some(candidate))
            if (call === 1) {
              yield* runInGitDirectory(
                git,
                bareRemote,
                ["update-ref", "-d", "refs/dalph/transfer-A", acceptedCommit],
                "remove private transfer ref"
              )
            }
            return IntegratorResult.cases.PreparedCandidate.make({
              candidateText: IntegratorCandidateText.make(candidate),
              correlation: request.correlation
            })
          }).pipe(Effect.orDie)
      }

      const application = productionWorkflowInterpreterLayer(
        runId,
        GitCommonDirectoryTarget.make(`${repository}/.git`),
        GitRepositoryLocator.make(repository),
        integrationTarget,
        Layer.succeed(TrackerMutation, trackerMutation),
        controlledSynchronousPlannedAttemptExecutorLayer(Layer.succeed(PlannedAttemptExecutor, executor)),
        hermeticCandidateProviderAuthority,
        {
          acceptedResultEvidenceStore: evidenceStore,
          completionTask,
          integrationFinality: completionClaim,
          integrator,
          remoteBaselineGitLayer: remoteBaselineLayer,
          remotePublicationGitLayer,
          remotePublicationTarget,
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
        Layer.provide(Layer.succeed(DeliveryRuntimeObservationObserver, runtimeObservation)),
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
      const lastWorkflowDecision = yield* Ref.make<Option.Option<string>>(Option.none())
      const activationDriver = Effect.forEach(
        Array.from({ length: maxActivationPasses }),
        () =>
          Ref.get(terminated).pipe(
            Effect.flatMap((done) =>
              done
                ? Effect.void
                : Effect.gen(function* () {
                    const decision = yield* activate
                    yield* Ref.set(lastWorkflowDecision, Option.some(JSON.stringify(decision)))
                    if (decision._tag === "RunMayTerminate") yield* Ref.set(terminated, true)
                  })
            )
          ),
        { discard: true }
      ).pipe(
        Effect.provide(application),
        Effect.provide(ConfigProvider.layer(ConfigProvider.fromUnknown({ DALPH_JOURNAL_DATABASE: journalFilename })))
      )

      yield* Effect.scoped(
        Effect.gen(function* () {
          const initialCoordinator = yield* activationDriver.pipe(Effect.forkScoped)
          yield* Deferred.await(terminalProjectionReady)
          yield* Fiber.await(initialCoordinator)
        })
      )

      if (crashAfterPromotion) {
        yield* Deferred.await(promotionAppliedWithoutResponse)
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
        const s2MilestoneTags = [
          "RemotePublicationRetained",
          "IntegratorCompetingHeadSuccessorAuthorized",
          "RemoteBaselineObserved",
          "LocalTargetCatchUpObserved",
          "TargetLineageObserved",
          "IntegratorAutomaticSuccessorSessionFixed",
          "IntegratorRunStarted",
          "IntegratorRunResultRecorded",
          "IntegratorRunCandidateGitObserved",
          "RemotePublicationIntended",
          "RemotePublicationSucceeded",
          "TargetPromotionObservedSuccess",
          "CompletionTaskAcknowledged",
          "IntegrationFinalitySettled",
          "IntegratorCandidateCleanupAuthorized",
          "IntegratorCandidateCleanupSettled",
          "WorktreeCleanupSettled",
          "BranchCleanupSettled",
          "WorkflowRunTerminated"
        ] as const satisfies ReadonlyArray<WorkflowJournalEvent["_tag"]>
        type S2MilestoneEvent = Extract<WorkflowJournalEvent, { readonly _tag: (typeof s2MilestoneTags)[number] }>
        const s2MilestoneTagSet: ReadonlySet<string> = new Set(s2MilestoneTags)
        const isS2MilestoneEvent = (event: WorkflowJournalEvent): event is S2MilestoneEvent =>
          s2MilestoneTagSet.has(event._tag)
        const s2Milestones = stalledRecords
          .filter((record): record is typeof record & { readonly event: S2MilestoneEvent } =>
            isS2MilestoneEvent(record.event)
          )
          .map(({ event, position }) => {
            const common = { position, tag: event._tag }
            switch (event._tag) {
              case "RemotePublicationRetained":
                return {
                  ...common,
                  cause: event.cause._tag,
                  mergeBase: event.cause._tag === "CompatibleCompetingHead" ? event.cause.mergeBase : undefined,
                  remoteHead: event.cause._tag === "CompatibleCompetingHead" ? event.cause.remoteHead : undefined
                }
              case "IntegratorCompetingHeadSuccessorAuthorized":
                return {
                  ...common,
                  authorizationId: event.authorizationId,
                  mergeBase: event.mergeBase,
                  remoteHead: event.remoteHead
                }
              case "RemoteBaselineObserved":
                return {
                  ...common,
                  observation: event.observation._tag,
                  remoteHead: "remoteHead" in event.observation ? event.observation.remoteHead : undefined
                }
              case "LocalTargetCatchUpObserved":
                return { ...common, remoteHead: event.remoteHead, result: event.result._tag }
              case "TargetLineageObserved":
                return { ...common, targetHead: event.observation.targetHeadSha }
              case "IntegratorAutomaticSuccessorSessionFixed":
                return {
                  ...common,
                  authorizationAt: event.authorizationAt,
                  predecessor: {
                    sessionId: event.predecessor.sessionId,
                    targetHead: event.predecessor.expectedTargetHead
                  },
                  successor: { sessionId: event.successor.sessionId, targetHead: event.successor.expectedTargetHead },
                  generation: event.successorGeneration
                }
              case "IntegratorRunStarted":
                return {
                  ...common,
                  sessionId: event.run.session.sessionId,
                  ordinal: event.run.ordinal,
                  targetHead: event.run.session.expectedTargetHead,
                  acceptedCommit: event.run.session.acceptedResult.commit
                }
              case "IntegratorRunResultRecorded":
                return {
                  ...common,
                  sessionId: event.run.session.sessionId,
                  ordinal: event.run.ordinal,
                  result: event.result._tag
                }
              case "IntegratorRunCandidateGitObserved":
                return {
                  ...common,
                  sessionId: event.run.session.sessionId,
                  candidate: event.observation._tag === "Commit" ? event.observation.commit : undefined,
                  directParents: event.observation._tag === "Commit" ? event.observation.directParents : undefined
                }
              case "RemotePublicationIntended":
                return {
                  ...common,
                  candidate: event.correlation.qualifiedCandidate.candidateCommit,
                  directParents: event.correlation.qualifiedCandidate.directParents
                }
              case "RemotePublicationSucceeded":
                return {
                  ...common,
                  candidate: event.correlation.qualifiedCandidate.candidateCommit,
                  directParents: event.correlation.qualifiedCandidate.directParents,
                  proof: event.proof._tag,
                  remoteHead: "remoteHead" in event.proof ? event.proof.remoteHead : undefined
                }
              case "TargetPromotionObservedSuccess":
                return {
                  ...common,
                  candidate: event.correlation.qualifiedCandidate.candidateCommit,
                  targetHead: event.correlation.qualifiedCandidate.run.session.expectedTargetHead,
                  observation: event.observation._tag
                }
              case "IntegratorCandidateCleanupAuthorized":
                return {
                  ...common,
                  disposition: event.authorization.disposition._tag,
                  locator: event.authorization.locator,
                  writerQuiescent: event.authorization.writerQuiescent
                }
              case "IntegratorCandidateCleanupSettled":
                return {
                  ...common,
                  result: event.result._tag,
                  locator: event.result.locator,
                  sessionId: event.result.sessionId
                }
              case "CompletionTaskAcknowledged":
              case "IntegrationFinalitySettled":
              case "WorktreeCleanupSettled":
              case "BranchCleanupSettled":
              case "WorkflowRunTerminated":
                return common
            }
          })
        const candidateObservations = stalledRecords.flatMap(({ event }) =>
          event._tag === "IntegratorRunCandidateGitObserved" && event.observation._tag === "Commit"
            ? [{ candidate: event.observation.commit, directParents: event.observation.directParents }]
            : []
        )
        const originalCandidate = candidateObservations.find(({ directParents }) => directParents[0] === baseSha)
        const s2Candidate =
          originalCandidate === undefined
            ? undefined
            : candidateObservations.find(
                ({ directParents }) =>
                  directParents[0] === competingHead && directParents[1] === originalCandidate.directParents[1]
              )
        const hasPublication =
          s2Candidate !== undefined &&
          stalledRecords.some(
            ({ event }) =>
              event._tag === "RemotePublicationSucceeded" &&
              event.correlation.qualifiedCandidate.candidateCommit === s2Candidate.candidate
          )
        const hasPromotion =
          s2Candidate !== undefined &&
          stalledRecords.some(
            ({ event }) =>
              event._tag === "TargetPromotionObservedSuccess" &&
              event.correlation.qualifiedCandidate.candidateCommit === s2Candidate.candidate
          )
        const firstMissingMilestone =
          s2Candidate === undefined
            ? "S2 candidate qualification [H2,C]"
            : !hasPublication
              ? "publication proof for the S2 candidate"
              : !hasPromotion
                ? "local target promotion for the S2 candidate"
                : !stalledRecords.some(({ event }) => event._tag === "CompletionTaskAcknowledged")
                  ? "fresh tracker completion acknowledgement"
                  : !stalledRecords.some(({ event }) => event._tag === "IntegratorCandidateCleanupSettled")
                    ? "predecessor candidate cleanup settlement"
                    : !stalledRecords.some(({ event }) => event._tag === "WorkflowRunTerminated")
                      ? "Run termination"
                      : "none"
        const latestGraph = stalledRecords.findLast(
          ({ event }) =>
            event._tag === "TaskTrackerFactsObserved" &&
            event.observation._tag === "CompleteTaskTrackerFacts" &&
            event.observation.target === target
        )
        const latestLineage = stalledRecords.findLast(
          ({ event }) =>
            event._tag === "TargetLineageObserved" && event.plannedAttempt.attemptId === plannedAttempt.attemptId
        )
        const refreshRequired =
          latestGraph !== undefined && (latestLineage === undefined || latestGraph.position > latestLineage.position)
        const runtimeFrames = yield* Ref.get(runtimeTrace)
        const lastDecision = yield* Ref.get(lastWorkflowDecision)
        return yield* Effect.die(
          `hermetic MVP did not converge; first missing milestone: ${firstMissingMilestone}; targetLineageRefreshRequired=${refreshRequired} graphAt=${latestGraph?.position ?? "none"} lineageAt=${latestLineage?.position ?? "none"}; runtime proposals/owners=${JSON.stringify(runtimeFrames.slice(-12))}; engineEntered=${stalledRecords.some(({ event }) => event._tag === "RemotePublicationIntended")}; last runWorkflow decision: ${Option.getOrElse(lastDecision, () => "<none>")}; ordered S2 milestones: ${JSON.stringify(s2Milestones)}; latest records: ${stalledRecords
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
      const qualificationAt = eventTags.lastIndexOf("IntegratorRunCandidateGitObserved")
      const promotionAttemptAt = eventTags.indexOf("TargetPromotionAttemptIntended")
      const promotionSucceededAt = eventTags.indexOf("TargetPromotionObservedSuccess")
      const completionAttemptAt = eventTags.indexOf("CompletionTaskAttemptIntended")
      const runTerminatedAt = eventTags.indexOf("WorkflowRunTerminated")
      const finalitySettledRecords = records.filter(hasEventTag("IntegrationFinalitySettled"))
      const worktreeCleanupAuthorized = records.filter(hasEventTag("WorktreeCleanupAuthorized"))
      const worktreeCleanupSettled = records.filter(hasEventTag("WorktreeCleanupSettled"))
      const branchCleanupAuthorized = records.filter(hasEventTag("BranchCleanupAuthorized"))
      const branchCleanupSettled = records.filter(hasEventTag("BranchCleanupSettled"))
      const candidateCleanupAuthorized = records.filter(hasEventTag("IntegratorCandidateCleanupAuthorized"))
      const candidateCleanupSettled = records.filter(hasEventTag("IntegratorCandidateCleanupSettled"))
      const qualificationRecords = records.filter(({ event }) => event._tag === "IntegratorRunCandidateGitObserved")
      const promotionAttemptRecords = records.filter(({ event }) => event._tag === "TargetPromotionAttemptIntended")
      const promotionSuccessRecords = records.filter(hasEventTag("TargetPromotionObservedSuccess"))
      const runBeginningRecords = records.filter(({ event }) => event._tag === "WorkflowRunBegan")
      const runTerminationRecords = records.filter(({ event }) => event._tag === "WorkflowRunTerminated")

      const expectedTargetHead = competingHeadRace ? Option.getOrThrow(Option.fromUndefinedOr(competingHead)) : baseSha
      expect(targetParents).toEqual([expectedTargetHead, decodedEvidence.commit])
      if (competingHeadRace) {
        const localPromotedHead = GitCommitSha.make(
          yield* runInWorktree(git, repository, ["rev-parse", integrationRef], "read locally promoted target")
        )
        expect(localPromotedHead).toBe(targetHead)
        const retained = records.find(({ event }) => event._tag === "RemotePublicationRetained")
        expect(retained?.event).toMatchObject({
          _tag: "RemotePublicationRetained",
          cause: { _tag: "CompatibleCompetingHead", remoteHead: competingHead }
        })
        const publicationAttemptIntents = records.filter(hasEventTag("RemotePublicationAttemptIntended"))
        expect(publicationAttemptIntents).toHaveLength(competingHeadBetweenDiscoveryAndPush ? 2 : 1)
        const rejectedNonFastForwardAttempts = records.filter(
          hasEventTag("RemotePublicationAttemptRejectedNonFastForward")
        )
        expect(rejectedNonFastForwardAttempts).toHaveLength(competingHeadBetweenDiscoveryAndPush ? 1 : 0)
        if (competingHeadBetweenDiscoveryAndPush) {
          const qualifiedCandidateCommits = qualificationRecords.flatMap(({ event }) =>
            event._tag === "IntegratorRunCandidateGitObserved" ? [event.observation.commit] : []
          )
          expect(
            publicationAttemptIntents.flatMap(({ event }) => [event.correlation.qualifiedCandidate.candidateCommit])
          ).toEqual(qualifiedCandidateCommits)
          expect(rejectedNonFastForwardAttempts[0]?.event).toMatchObject({
            _tag: "RemotePublicationAttemptRejectedNonFastForward",
            correlation: { qualifiedCandidate: { candidateCommit: qualifiedCandidateCommits[0] } }
          })
        }
        expect(eventTags.filter((tag) => tag === "IntegratorAutomaticSuccessorSessionFixed")).toHaveLength(1)
        expect(qualificationRecords).toHaveLength(2)
        const qualifiedParents = qualificationRecords.map((record) =>
          record.event._tag === "IntegratorRunCandidateGitObserved" ? record.event.observation.directParents : []
        )
        expect(qualifiedParents).toContainEqual([baseSha, decodedEvidence.commit])
        expect(qualifiedParents).toContainEqual([expectedTargetHead, decodedEvidence.commit])
      } else {
        expect(qualificationRecords).toHaveLength(1)
      }
      expect(promotedResult).toMatchObject({ exitCode: 0, stdout: "implemented by hermetic child\n" })
      expect(yield* Ref.get(lifecycle)).toBe("CompletedSuccessfully")
      expect(yield* Ref.get(trackerClaim)).toEqual(UnclaimedTask.make({ taskId }))
      expect(qualificationRecords.at(-1)?.event).toMatchObject({
        _tag: "IntegratorRunCandidateGitObserved",
        observation: { _tag: "Commit", directParents: [expectedTargetHead, decodedEvidence.commit] }
      })
      expect(qualificationAt).toBeGreaterThanOrEqual(0)
      expect(promotionAttemptAt).toBeGreaterThan(qualificationAt)
      expect(promotionSucceededAt).toBeGreaterThan(promotionAttemptAt)
      expect(completionAttemptAt).toBeGreaterThan(promotionSucceededAt)
      expect(promotionAttemptRecords).toHaveLength(1)
      expect(promotionSuccessRecords).toHaveLength(1)
      const promotionSuccess = Option.getOrThrow(Option.fromUndefinedOr(promotionSuccessRecords[0]))
      const qualifiedCandidate = promotionSuccess.event.correlation.qualifiedCandidate
      expect(yield* Ref.get(targetPromotionCompareAndSetCalls)).toBe(1)
      if (competingHeadBetweenDiscoveryAndPush) {
        expect(yield* Ref.get(outsideHeadPublished)).toBe(true)
      }
      expect(yield* Ref.get(executorStarts)).toBe(1)
      expect(yield* Ref.get(integratorCalls)).toBe(competingHeadRace ? 2 : 1)
      expect(eventTags.filter((tag) => tag === "TaskAttemptPlanned")).toHaveLength(1)
      expect(eventTags.filter((tag) => tag === "TaskWorktreeReady")).toHaveLength(1)
      expect(eventTags.filter((tag) => tag === "PlannedAttemptExecutorWorkReported")).toHaveLength(2)
      expect(eventTags.filter((tag) => tag === "IntegratorSessionFixed")).toHaveLength(1)
      expect(eventTags.filter((tag) => tag === "IntegratorRunStarted")).toHaveLength(competingHeadRace ? 2 : 1)
      expect(eventTags.filter((tag) => tag === "IntegratorRunResultRecorded")).toHaveLength(competingHeadRace ? 2 : 1)
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
      expect(finalitySettledRecords).toHaveLength(1)
      const finalitySettlement = Option.getOrThrow(Option.fromUndefinedOr(finalitySettledRecords[0]))
      const finalitySettledAt = records.indexOf(finalitySettlement)
      expect(finalitySettlement.event.claim).toMatchObject({
        plannedAttempt,
        promotionCorrelation: promotionSuccess.event.correlation
      })
      expect(finalitySettledAt).toBeGreaterThan(completionAttemptAt)
      expect(worktreeCleanupAuthorized).toHaveLength(1)
      expect(worktreeCleanupSettled).toHaveLength(1)
      expect(branchCleanupAuthorized).toHaveLength(1)
      expect(branchCleanupSettled).toHaveLength(1)
      expect(candidateCleanupAuthorized).toHaveLength(competingHeadRace ? 2 : 1)
      expect(candidateCleanupSettled).toHaveLength(competingHeadRace ? 2 : 1)
      const worktreeAuthorization = Option.getOrThrow(Option.fromUndefinedOr(worktreeCleanupAuthorized[0]))
      const worktreeSettlement = Option.getOrThrow(Option.fromUndefinedOr(worktreeCleanupSettled[0]))
      const branchAuthorization = Option.getOrThrow(Option.fromUndefinedOr(branchCleanupAuthorized[0]))
      const branchSettlement = Option.getOrThrow(Option.fromUndefinedOr(branchCleanupSettled[0]))
      const candidateAuthorization = Option.getOrThrow(
        Option.fromUndefinedOr(
          candidateCleanupAuthorized.find(({ event }) => event.authorization.disposition._tag === "Settled")
        )
      )
      const candidateSettlement = Option.getOrThrow(
        Option.fromUndefinedOr(
          candidateCleanupSettled.find(({ event }) => event.authorization.disposition._tag === "Settled")
        )
      )
      if (competingHeadRace) {
        const predecessorAuthorization = Option.getOrThrow(
          Option.fromUndefinedOr(
            candidateCleanupAuthorized.find(
              ({ event }) => event.authorization.disposition._tag === "AutomaticSuccessorSuperseded"
            )
          )
        )
        const predecessorSettlement = Option.getOrThrow(
          Option.fromUndefinedOr(
            candidateCleanupSettled.find(
              ({ event }) => event.authorization.disposition._tag === "AutomaticSuccessorSuperseded"
            )
          )
        )
        const originalQualification = qualificationRecords[0]?.event
        if (originalQualification?._tag !== "IntegratorRunCandidateGitObserved") {
          return yield* Effect.die("automatic S2 cleanup requires the exact S1 candidate session")
        }
        const originalSession = originalQualification.run.session
        expect(predecessorAuthorization.event.authorization).toMatchObject({
          disposition: {
            _tag: "AutomaticSuccessorSuperseded",
            predecessor: originalSession,
            successor: qualifiedCandidate.run.session
          },
          locator: originalSession.candidateResource,
          owner: { sessionId: originalSession.sessionId }
        })
        expect(predecessorSettlement.event.authorization).toEqual(predecessorAuthorization.event.authorization)
        expect(predecessorSettlement.event.result).toMatchObject({
          _tag: "AlreadyAbsent",
          locator: originalSession.candidateResource,
          sessionId: originalSession.sessionId
        })
      }
      expect(worktreeAuthorization.event).toMatchObject({
        authorization: { disposition: { _tag: "Settled", plannedAttempt }, locator: plannedAttempt.worktree }
      })
      expect(branchAuthorization.event).toMatchObject({
        authorization: { disposition: { _tag: "Settled", plannedAttempt }, locator: plannedAttempt.branch }
      })
      expect(candidateAuthorization.event).toMatchObject({
        authorization: {
          disposition: { _tag: "Settled", qualifiedCandidate },
          locator: qualifiedCandidate.run.session.candidateResource,
          owner: { sessionId: qualifiedCandidate.run.session.sessionId }
        }
      })
      expect(worktreeSettlement.event).toMatchObject({ authorization: worktreeAuthorization.event.authorization })
      expect(branchSettlement.event).toMatchObject({ authorization: branchAuthorization.event.authorization })
      expect(candidateSettlement.event).toMatchObject({ authorization: candidateAuthorization.event.authorization })
      expect(candidateSettlement.event.result).toEqual({
        _tag: "AlreadyAbsent",
        locator: qualifiedCandidate.run.session.candidateResource,
        revision: 1,
        sessionId: qualifiedCandidate.run.session.sessionId
      })
      const worktreeAuthorizationAt = records.indexOf(worktreeAuthorization)
      const worktreeSettlementAt = records.indexOf(worktreeSettlement)
      const branchAuthorizationAt = records.indexOf(branchAuthorization)
      const branchSettlementAt = records.indexOf(branchSettlement)
      const candidateAuthorizationAt = records.indexOf(candidateAuthorization)
      const candidateSettlementAt = records.indexOf(candidateSettlement)
      const cleanupOrder = [
        worktreeAuthorizationAt,
        worktreeSettlementAt,
        branchAuthorizationAt,
        branchSettlementAt,
        candidateAuthorizationAt,
        candidateSettlementAt
      ]
      expect(cleanupOrder.every((index) => index > finalitySettledAt && index < runTerminatedAt)).toBe(true)
      expect(worktreeSettlementAt).toBeGreaterThan(worktreeAuthorizationAt)
      expect(branchSettlementAt).toBeGreaterThan(branchAuthorizationAt)
      expect(candidateSettlementAt).toBeGreaterThan(candidateAuthorizationAt)
      expect(yield* fileSystem.exists(journalFilename)).toBe(true)
      expect(yield* fileSystem.exists(evidenceDirectory)).toBe(true)
      expect(yield* fileSystem.exists(repository)).toBe(true)
      expect(yield* fileSystem.exists(bareRemote)).toBe(true)
      expect(yield* fileSystem.exists(worktree)).toBe(false)
      const plannedBranchStatus = yield* git.runInWorktree(repository, ["show-ref", "--verify", plannedAttempt.branch])
      expect(plannedBranchStatus.exitCode).not.toBe(0)
      expect((yield* git.runInWorktree(repository, ["show-ref", "--verify", "refs/heads/unrelated"])).exitCode).toBe(0)
      expect((yield* git.run(bareRemote, ["show-ref", "--verify", "refs/dalph/transfer-A"])).exitCode).not.toBe(0)
      expect(yield* Option.getOrThrow(yield* Ref.get(childHandle)).isRunning).toBe(false)

      yield* Effect.scoped(
        CoordinatorOwnership.pipe(
          Effect.provide(productionCoordinatorOwnershipLayer(GitCommonDirectoryTarget.make(`${repository}/.git`)))
        )
      )
    }).pipe(
      Effect.ensuring(Scope.close(executorScope, Exit.void)),
      Effect.ensuring(fileSystem.remove(root, { recursive: true }).pipe(Effect.orDie))
    )

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

it.effect(
  "recovers a competing remote head found before publication discovery through the automatic S2 full suffix",
  () => runHermeticMvpJourney(false, true),
  120_000
)

it.effect(
  "recovers a competing remote head advanced between publication discovery and update through the automatic S2 full suffix",
  () => runHermeticMvpJourney(false, false, true),
  120_000
)
