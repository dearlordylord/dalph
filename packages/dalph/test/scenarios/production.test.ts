// @effect-diagnostics multipleEffectProvide:off
import {
  AttemptId,
  AcceptedResult,
  EvidenceDigest,
  EvidenceReference,
  GitCommitSha,
  GitRepositoryLocator,
  IntegrationTarget,
  IntegrationTargetRef,
  makeTaskWorkSpecification,
  type TaskWorkSpecification,
  PlannedAttemptExecutor,
  PlannedAttemptExecutorLifecycleObservation,
  type PlannedAttemptExecutorLifecycleObservationService,
  type PlannedAttemptExecutorService,
  PlannedAttemptExecutorCommandFailure,
  PlannedAttemptExecutorProjection,
  PlannedAttemptExecutorReport,
  type PlannedAttemptExecutorRequest,
  PlannedTaskAttempt,
  passiveLifecycleObservationPurpose,
  plannedAttemptExecutorCorrelation,
  plannedAttemptExecutorCorrelationKey,
  RunId,
  TaskBranchRef,
  TaskExecutorLocator,
  TaskId,
  WorktreeLocator
} from "@dalph/contracts"
import { NodeServices } from "@effect/platform-node"
import { it } from "@effect/vitest"
import {
  type GithubGraphqlRequest,
  ActiveTaskClaim,
  AllocatedWorkflowRunId,
  attemptPlanRecordKey,
  ClaimOwner,
  ClaimToken,
  controlledTrackerMutationLayer,
  EvidenceStore,
  type EvidenceStoreService,
  FixtureTarget,
  freshWorkflowRunId,
  GitCommand,
  GitCommonDirectoryTarget,
  GithubGraphqlClient,
  GithubIssueNodeId,
  GithubIssueNumber,
  GithubIssueTarget,
  GithubRepositoryName,
  GithubRepositoryNodeId,
  GithubRepositoryOwner,
  githubTaskIdFor,
  githubTrackerGraphReaderLayer,
  intentRecordKey,
  JournalDatabaseLocator,
  type JournalRecord,
  JournalPosition,
  JournaledRunBootstrap,
  JournalStore,
  InitialControlPolicy,
  IntegratorCandidateCleanupMutationResult,
  IntegratorCandidateCleanupObservation,
  type IntegratorCandidateProviderAuthorityService,
  IntegratorCandidateResourceLocator,
  IntegratorSessionCorrelation,
  IntegratorSessionId,
  IntegratorBoundaryUnavailable,
  TargetLineageObservation,
  appendCandidateProvenance,
  appendCurrentQuarantineProvenance,
  appendReplacementProvenance,
  integratorSuccessorCorrelationFor,
  makeTaskAttemptPlanOperation,
  makeTaskClaimAcquisitionOperation,
  makeTaskWorktreeReconciliationOperation,
  makeTrackerGraphObservationOperation,
  makeTaskWorkSpecificationObservationOperation,
  nodeGitCommandLayer,
  OperationId,
  OperationIdAllocator,
  outcomeRecordKey,
  PlannedAttemptExecutorCommandIntendedEvent,
  plannedAttemptExecutorCommandIntendedRecordKey,
  PlannedAttemptExecutorCommandResponseObservedEvent,
  plannedAttemptExecutorCommandResponseObservedRecordKey,
  PlannedAttemptExecutorCommandOrdinal,
  PlannedAttemptExecutorReportOrdinal,
  PlannedAttemptExecutorStateObservation,
  PlannedAttemptExecutorStateObservationOrdinal,
  PlannedAttemptExecutorStateObservedEvent,
  plannedAttemptExecutorStateObservedRecordKey,
  PlannedAttemptExecutorWorkReportedEvent,
  plannedAttemptExecutorWorkReportedRecordKey,
  PlannedAttemptExecutorWorkResponsibilityBeganEvent,
  plannedAttemptExecutorWorkResponsibilityBeganRecordKey,
  PlannedWorktreeReady,
  PlannedTaskAttemptPlanner,
  PlannedAttemptExecutorCorrelationMismatch,
  PlannedAttemptExecutorBeginReportContradiction,
  PlannedAttemptExecutorProjectionTemporarilyUnavailable,
  PlannedAttemptExecutorProjectionUnreadable,
  projectTrackerSnapshot,
  reduceWorkflowJournalHistory,
  runWorkflow,
  sqliteJournalTestLayer,
  RunFinalityDecision,
  TaskAttemptPlannedEvent,
  TaskClaimAcquiredEvent,
  TaskClaimAcquisitionIntendedEvent,
  taskTrackerReadIntent,
  TaskWorkCapacity,
  TaskClaimAcquisitionPlanner,
  TaskWorktreeReadyEvent,
  TaskWorktreeReconciliationIntendedEvent,
  TrackerGraphReader,
  TrackerAdapterReadContext,
  TrackerAdapterReadError,
  TrackerAdapterReadFailureReason,
  TrackerMutation,
  TrackerRevision,
  WorkflowRunAlreadyTerminated,
  workflowJournalEventVersion,
  WorkflowTrace,
  unavailableIntegratorCandidateProviderAuthority
} from "@dalph/orchestrator"
import {
  Cause,
  ConfigProvider,
  Deferred,
  Effect,
  Exit,
  Fiber,
  FileSystem,
  Layer,
  Match,
  Option,
  PubSub,
  Ref,
  Scope,
  Stream
} from "effect"
import { expect } from "vitest"
import {
  taskTrackerGraphFactsObserved,
  taskTrackerWorkSpecificationFactsObserved
} from "../../../orchestrator/test/task-tracker-facts.js"
import { controlledFakePlannedAttemptExecutorLayer } from "../../../orchestrator/test/controlled-planned-attempt-executor.js"
import { productionWorkflowInterpreterLayer } from "../../src/application/production.js"
import { controlledSynchronousPlannedAttemptExecutorLayer } from "../../test-support/controlled-synchronous-planned-attempt-executor.js"

const productionControlledFakePlannedAttemptExecutorLayer = controlledSynchronousPlannedAttemptExecutorLayer(
  controlledFakePlannedAttemptExecutorLayer
)

const productionIntegrationTarget = (repository: string): IntegrationTarget =>
  IntegrationTarget.make({
    repository: GitRepositoryLocator.make(repository),
    ref: IntegrationTargetRef.make("refs/heads/master")
  })

const githubInstructionTarget = GithubIssueTarget.make({
  issueNumber: GithubIssueNumber.make(281),
  owner: GithubRepositoryOwner.make("dearlordylord"),
  repository: GithubRepositoryName.make("dalph")
})
const githubInstructionRepositoryNodeId = GithubRepositoryNodeId.make("github-instruction-repository")
const githubInstructionIssueNodeId = GithubIssueNodeId.make("github-instruction-issue")
const githubInstructionTaskId = githubTaskIdFor(githubInstructionRepositoryNodeId, githubInstructionIssueNodeId)
const githubInstructionFailureMatrixTimeoutMilliseconds = 30_000
const githubInstructionSpecification = makeTaskWorkSpecification({
  body: "Exact current body from GitHub.",
  taskId: githubInstructionTaskId,
  title: "Exact current title from GitHub"
})
const unexpectedGithubInstructionResponse = {
  body: { errors: [{ message: "unexpected non-instruction GitHub request" }] }
}

/** The complete executor boundary vocabulary observed by the GitHub-instruction production vertical. */
type ObservedPlannedAttemptExecutorCall = "observe" | "requestSuspension" | "begin" | "resume"

const appendObservedExecutorCall =
  (call: ObservedPlannedAttemptExecutorCall) =>
  (calls: ReadonlyArray<ObservedPlannedAttemptExecutorCall>): ReadonlyArray<ObservedPlannedAttemptExecutorCall> => [
    ...calls,
    call
  ]

const githubInstructionResponse = (request: GithubGraphqlRequest, focusedBody: unknown) =>
  Match.valueTags(request, {
    AddBlockedBy: () => unexpectedGithubInstructionResponse,
    AddIssueComment: () => unexpectedGithubInstructionResponse,
    AddSubIssue: () => unexpectedGithubInstructionResponse,
    CloseIssue: () => unexpectedGithubInstructionResponse,
    CreateClaimLabel: () => unexpectedGithubInstructionResponse,
    CreateIssue: () => unexpectedGithubInstructionResponse,
    DeleteClaimLabel: () => unexpectedGithubInstructionResponse,
    DeleteIssue: () => unexpectedGithubInstructionResponse,
    FindClaimLabel: () => unexpectedGithubInstructionResponse,
    ReadBlockedBy: () => ({
      body: {
        data: {
          node: {
            __typename: "Issue",
            blockedBy: { nodes: [], pageInfo: { endCursor: null, hasNextPage: false } },
            id: githubInstructionIssueNodeId
          }
        }
      }
    }),
    ReadIssue: () => ({
      body: {
        data: {
          node: {
            __typename: "Issue",
            id: githubInstructionIssueNodeId,
            parent: null,
            repository: { id: githubInstructionRepositoryNodeId },
            state: "OPEN",
            stateReason: null
          }
        }
      }
    }),
    ReadIssueDetails: () => unexpectedGithubInstructionResponse,
    ReadSubIssues: () => ({
      body: {
        data: {
          node: {
            __typename: "Issue",
            id: githubInstructionIssueNodeId,
            subIssues: { nodes: [], pageInfo: { endCursor: null, hasNextPage: false } }
          }
        }
      }
    }),
    ReadTaskWorkSpecification: () => ({ body: focusedBody }),
    ReopenIssue: () => unexpectedGithubInstructionResponse,
    ResolveIssue: () => ({
      body: {
        data: { repository: { id: githubInstructionRepositoryNodeId, issue: { id: githubInstructionIssueNodeId } } }
      }
    }),
    ResolveRepository: () => unexpectedGithubInstructionResponse
  })

const runFreshGithubInstructionVertical = (scenario: string, focusedBody: unknown) =>
  Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem
    const directory = yield* fileSystem.makeTempDirectoryScoped({ prefix: `dalph-github-instructions-${scenario}-` })
    const git = yield* GitCommand
    yield* git.runInWorktree(directory, ["init"])
    yield* git.runInWorktree(directory, ["config", "user.email", "dalph@example.invalid"])
    yield* git.runInWorktree(directory, ["config", "user.name", "Dalph Test"])
    yield* fileSystem.writeFileString(`${directory}/README.md`, "GitHub instruction vertical\n")
    yield* git.runInWorktree(directory, ["add", "README.md"])
    yield* git.runInWorktree(directory, ["commit", "-m", "initial"])
    yield* git.runInWorktree(directory, ["branch", "-M", "master"])
    const baseSha = GitCommitSha.make((yield* git.runInWorktree(directory, ["rev-parse", "HEAD"])).stdout.trim())
    const runId = yield* freshWorkflowRunId(githubInstructionTarget)
    const plannedAttempt = PlannedTaskAttempt.make({
      attemptId: AttemptId.make(`github-instructions-${scenario}`),
      baseSha,
      branch: TaskBranchRef.make(`refs/heads/dalph/github-instructions-${scenario}`),
      executor: TaskExecutorLocator.make("executor:github-instruction-vertical"),
      runId,
      taskId: githubInstructionTaskId,
      taskRevision: githubInstructionSpecification.fingerprint,
      worktree: WorktreeLocator.make(`${directory}/worktree`)
    })
    const githubCalls = yield* Ref.make<ReadonlyArray<GithubGraphqlRequest["_tag"]>>([])
    const executorCalls = yield* Ref.make<ReadonlyArray<ObservedPlannedAttemptExecutorCall>>([])
    const executorRequests = yield* Ref.make<ReadonlyArray<PlannedAttemptExecutorRequest>>([])
    const githubClientLayer = Layer.succeed(
      GithubGraphqlClient,
      GithubGraphqlClient.of({
        execute: (request) =>
          Ref.update(githubCalls, (calls) => [...calls, request._tag]).pipe(
            Effect.as(githubInstructionResponse(request, focusedBody))
          )
      })
    )
    const executorLayer = Layer.succeed(
      PlannedAttemptExecutor,
      PlannedAttemptExecutor.of({
        observe: (correlation) =>
          Ref.update(executorCalls, appendObservedExecutorCall("observe")).pipe(
            Effect.as(PlannedAttemptExecutorProjection.cases.NoReport.make({ correlation }))
          ),
        requestSuspension: () =>
          Ref.update(executorCalls, appendObservedExecutorCall("requestSuspension")).pipe(
            Effect.andThen(Effect.die("fresh instruction read must not suspend executor work"))
          ),
        begin: (request) =>
          Ref.update(executorCalls, appendObservedExecutorCall("begin")).pipe(
            Effect.andThen(Ref.update(executorRequests, (requests) => [...requests, request])),
            Effect.andThen(
              new PlannedAttemptExecutorCommandFailure({
                command: "Begin",
                correlation: plannedAttemptExecutorCorrelation(request.plannedAttempt),
                detail: "stop after observing the exact executor request"
              })
            )
          ),
        resume: () =>
          Ref.update(executorCalls, appendObservedExecutorCall("resume")).pipe(
            Effect.andThen(Effect.die("fresh instruction read must not resume executor work"))
          )
      })
    )
    const filename = JournalDatabaseLocator.make(`${directory}/journal.sqlite`)
    const application = productionWorkflowInterpreterLayer(
      runId,
      GitCommonDirectoryTarget.make(`${directory}/.git`),
      productionIntegrationTarget(`${directory}/.git`),
      controlledTrackerMutationLayer,
      controlledSynchronousPlannedAttemptExecutorLayer(executorLayer),
      unavailableIntegratorCandidateProviderAuthority
    ).pipe(
      Layer.provide(githubTrackerGraphReaderLayer.pipe(Layer.provide(githubClientLayer))),
      Layer.provide(Layer.succeed(WorkflowTrace, WorkflowTrace.of({ emit: () => Effect.void })))
    )
    const nextOperation = yield* Ref.make(0)
    const exit = yield* runWorkflow(
      githubInstructionTarget,
      Effect.succeed(InitialControlPolicy.make({ taskExecutionCapacity: TaskWorkCapacity.make(1) })),
      runId
    ).pipe(
      Effect.provideService(
        OperationIdAllocator,
        OperationIdAllocator.of({
          allocate: () =>
            Ref.getAndUpdate(nextOperation, (value) => value + 1).pipe(
              Effect.map((value) => OperationId.make(`github-instructions-${scenario}-operation-${value}`))
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
              token: ClaimToken.make(`github-instructions-${scenario}-token`)
            })
        })
      ),
      Effect.provideService(
        PlannedTaskAttemptPlanner,
        PlannedTaskAttemptPlanner.of({ plan: () => Effect.succeed(plannedAttempt) })
      ),
      Effect.provide(application),
      Effect.provide(ConfigProvider.layer(ConfigProvider.fromUnknown({ DALPH_JOURNAL_DATABASE: filename }))),
      Effect.exit
    )
    const records = yield* Effect.gen(function* () {
      return yield* (yield* JournalStore).read(runId)
    }).pipe(Effect.provide(sqliteJournalTestLayer({ filename })))
    return {
      executorCalls: yield* Ref.get(executorCalls),
      executorRequests: yield* Ref.get(executorRequests),
      exit,
      githubCalls: yield* Ref.get(githubCalls),
      records
    }
  })

type PublicExecutorProjectionPlan = (
  correlation: ReturnType<typeof plannedAttemptExecutorCorrelation>
) => ReadonlyArray<PlannedAttemptExecutorProjection>

type PublicExecutorProjectionForApplication = (
  applicationOrdinal: number,
  correlation: ReturnType<typeof plannedAttemptExecutorCorrelation>
) => Effect.Effect<PlannedAttemptExecutorProjection>

// eslint-disable-next-line functional/no-mixed-types -- The restart fixture combines static boundary options with the per-process lifecycle factory it exercises.
interface PublicRunFixtureOptions {
  readonly acceptedResultEvidenceStore?: EvidenceStoreService
  readonly beginSucceeds?: boolean
  readonly integratorCandidateProviderAuthority?: IntegratorCandidateProviderAuthorityService
  readonly lifecycleForApplication?: (
    applicationOrdinal: number,
    executor: PlannedAttemptExecutorService
  ) => PlannedAttemptExecutorLifecycleObservationService
  readonly projectionForApplication?: PublicExecutorProjectionForApplication
  readonly seedExecutorFacts?: boolean
  readonly taskWorkSpecificationRead?: Effect.Effect<TaskWorkSpecification, TrackerAdapterReadError>
}

interface StartupValidCandidatePositions {
  readonly directionAppliedAt: JournalPosition
  readonly predecessorLineageObservedAt: JournalPosition
  readonly quarantineAt: JournalPosition
  readonly queuedAt: JournalPosition
  readonly startedAt: JournalPosition
  readonly successorLineageObservedAt: JournalPosition
}

/**
 * Derives the shared StartupValid candidate-provenance chronology from the
 * exact journal record that immediately precedes it.
 */
const startupValidCandidatePositionsAfter = (preceding: JournalRecord): StartupValidCandidatePositions => {
  const queuedAt = JournalPosition.make(Number(preceding.position) + 1)
  const startedAt = JournalPosition.make(Number(queuedAt) + 1)
  const predecessorLineageObservedAt = JournalPosition.make(Number(startedAt) + 2)
  const quarantineAt = JournalPosition.make(Number(predecessorLineageObservedAt) + 4)
  const directionAppliedAt = JournalPosition.make(Number(quarantineAt) + 1)
  const successorLineageObservedAt = JournalPosition.make(Number(directionAppliedAt) + 2)
  return {
    directionAppliedAt,
    predecessorLineageObservedAt,
    quarantineAt,
    queuedAt,
    startedAt,
    successorLineageObservedAt
  }
}

/**
 * Seeds the same exact Run facts that ordinary bootstrap recovers after a
 * coordinator process loss, leaving one Begin intent unmatched.
 * The returned `activate` function still crosses the public runWorkflow
 * boundary; only the opaque executor projection sequence is controlled.
 */
const makePublicRunFixture = (projectionPlan: PublicExecutorProjectionPlan, options: PublicRunFixtureOptions = {}) =>
  Effect.gen(function* () {
    const {
      acceptedResultEvidenceStore,
      beginSucceeds = false,
      integratorCandidateProviderAuthority = unavailableIntegratorCandidateProviderAuthority,
      lifecycleForApplication,
      projectionForApplication,
      seedExecutorFacts = true,
      taskWorkSpecificationRead
    } = options
    const fileSystem = yield* FileSystem.FileSystem
    const directory = yield* fileSystem.makeTempDirectoryScoped({ prefix: "dalph-production-executor-projection-" })
    const git = yield* GitCommand
    yield* git.runInWorktree(directory, ["init"])
    yield* git.runInWorktree(directory, ["config", "user.email", "dalph@example.invalid"])
    yield* git.runInWorktree(directory, ["config", "user.name", "Dalph Test"])
    yield* fileSystem.writeFileString(`${directory}/README.md`, "public executor projection\n")
    yield* git.runInWorktree(directory, ["add", "README.md"])
    yield* git.runInWorktree(directory, ["commit", "-m", "initial"])
    yield* git.runInWorktree(directory, ["branch", "-M", "master"])
    const baseSha = GitCommitSha.make((yield* git.runInWorktree(directory, ["rev-parse", "HEAD"])).stdout.trim())
    const runId = RunId.make("production-executor-projection-run")
    const target = FixtureTarget.make("production-executor-projection-target")
    const taskId = TaskId.make("A")
    const specification = makeTaskWorkSpecification({ body: "Complete A.", taskId, title: "Complete A" })
    const attempt = PlannedTaskAttempt.make({
      attemptId: AttemptId.make("production-executor-projection-attempt"),
      baseSha,
      branch: TaskBranchRef.make("refs/heads/dalph/production-executor-projection"),
      executor: TaskExecutorLocator.make("executor:production-controlled-projection"),
      runId,
      taskId,
      taskRevision: specification.fingerprint,
      worktree: WorktreeLocator.make(`${directory}/worktree`)
    })
    const correlation = plannedAttemptExecutorCorrelation(attempt)
    const projected = projectTrackerSnapshot({
      revision: "production-executor-projection-current",
      tasks: [{ id: taskId, lifecycle: { _tag: "Open" }, parentTaskId: null, prerequisiteIds: [] }]
    })
    if (projected._tag === "Invalid") return yield* Effect.die("current graph must be valid")
    const filename = JournalDatabaseLocator.make(`${directory}/journal.sqlite`)
    yield* git.runInWorktree(directory, [
      "worktree",
      "add",
      "-b",
      attempt.branch.slice("refs/heads/".length),
      attempt.worktree,
      attempt.baseSha
    ])

    const acquisition = {
      operationId: OperationId.make("production-executor-projection-claim"),
      owner: ClaimOwner.make("dalph"),
      taskId,
      token: ClaimToken.make("production-executor-projection-token")
    }
    const claimOperation = makeTaskClaimAcquisitionOperation({ acquisition, predecessorOperationIds: [] })
    const observation = makeTrackerGraphObservationOperation(
      { _tag: "WorkflowEstablishment" },
      OperationId.make("production-executor-projection-graph"),
      target,
      [claimOperation.acquisition.operationId],
      [taskId]
    )
    const specificationObservation = makeTaskWorkSpecificationObservationOperation(
      OperationId.make("production-executor-projection-specification"),
      target,
      taskId,
      [observation.operationId]
    )
    const plan = makeTaskAttemptPlanOperation({
      operationId: OperationId.make("production-executor-projection-plan"),
      plannedAttempt: attempt,
      predecessorOperationIds: [specificationObservation.operationId]
    })
    const worktree = makeTaskWorktreeReconciliationOperation({
      operationId: OperationId.make("production-executor-projection-worktree"),
      plannedAttempt: attempt,
      predecessorOperationIds: [plan.operationId]
    })
    const commandOrdinal = PlannedAttemptExecutorCommandOrdinal.make(1)
    yield* Effect.gen(function* () {
      const journal = yield* JournalStore
      yield* journal.beginRun(
        runId,
        target,
        InitialControlPolicy.make({ taskExecutionCapacity: TaskWorkCapacity.make(1) })
      )
      if (!seedExecutorFacts) return
      yield* journal.append(
        runId,
        intentRecordKey(acquisition.operationId),
        TaskClaimAcquisitionIntendedEvent.make({ operation: claimOperation, version: workflowJournalEventVersion })
      )
      yield* journal.append(
        runId,
        outcomeRecordKey(acquisition.operationId),
        TaskClaimAcquiredEvent.make({ claim: ActiveTaskClaim.make(acquisition), version: workflowJournalEventVersion })
      )
      yield* journal.append(runId, intentRecordKey(observation.operationId), taskTrackerReadIntent(observation))
      yield* journal.append(
        runId,
        outcomeRecordKey(observation.operationId),
        taskTrackerGraphFactsObserved(observation, {
          revision: TrackerRevision.make("production-executor-projection-seed"),
          taskIds: [taskId]
        })
      )
      yield* journal.append(
        runId,
        intentRecordKey(specificationObservation.operationId),
        taskTrackerReadIntent(specificationObservation)
      )
      yield* journal.append(
        runId,
        outcomeRecordKey(specificationObservation.operationId),
        taskTrackerWorkSpecificationFactsObserved(specificationObservation, specification)
      )
      yield* journal.append(
        runId,
        attemptPlanRecordKey(attempt.attemptId),
        TaskAttemptPlannedEvent.make({ operation: plan, version: workflowJournalEventVersion })
      )
      yield* journal.append(
        runId,
        intentRecordKey(worktree.operationId),
        TaskWorktreeReconciliationIntendedEvent.make({ operation: worktree, version: workflowJournalEventVersion })
      )
      yield* journal.append(
        runId,
        outcomeRecordKey(worktree.operationId),
        TaskWorktreeReadyEvent.make({
          operationId: worktree.operationId,
          proof: PlannedWorktreeReady.make({
            baseSha: attempt.baseSha,
            branch: attempt.branch,
            headSha: attempt.baseSha,
            worktree: attempt.worktree
          }),
          version: workflowJournalEventVersion
        })
      )
      yield* journal.append(
        runId,
        plannedAttemptExecutorWorkResponsibilityBeganRecordKey(attempt.attemptId),
        PlannedAttemptExecutorWorkResponsibilityBeganEvent.make({
          plannedAttempt: attempt,
          version: workflowJournalEventVersion
        })
      )
      yield* journal.append(
        runId,
        plannedAttemptExecutorCommandIntendedRecordKey(attempt.attemptId, commandOrdinal),
        PlannedAttemptExecutorCommandIntendedEvent.make({
          command: "Begin",
          initiatedBy: { _tag: "DalphCoordinator" },
          occurrenceClassification: "InitiatedAction",
          ordinal: commandOrdinal,
          plannedAttempt: attempt,
          version: workflowJournalEventVersion
        })
      )
    }).pipe(Effect.provide(sqliteJournalTestLayer({ filename })))

    const projections = yield* Ref.make(projectionPlan(correlation))
    const begunReports = yield* Ref.make<ReadonlyMap<string, PlannedAttemptExecutorReport>>(new Map())
    const commandCallsRef = yield* Ref.make<ReadonlyArray<"Begin" | "Resume" | "Suspend">>([])
    const projectionCallsRef = yield* Ref.make(0)
    const specificationReadsRef = yield* Ref.make(0)
    const consumeCommand = (command: "Begin" | "Resume" | "Suspend", planned: PlannedTaskAttempt) =>
      Effect.gen(function* () {
        yield* Ref.update(commandCallsRef, (calls) => [...calls, command])
        return yield* new PlannedAttemptExecutorCommandFailure({
          command,
          correlation: plannedAttemptExecutorCorrelation(planned),
          detail: `public projection fixture has no ${command} response`
        })
      })
    const executorForApplication = (applicationOrdinal: number) =>
      PlannedAttemptExecutor.of({
        observe: (requested) =>
          Effect.gen(function* () {
            yield* Ref.update(projectionCallsRef, (calls) => calls + 1)
            if (projectionForApplication !== undefined) {
              return yield* projectionForApplication(applicationOrdinal, requested)
            }
            const next = yield* Ref.modify(projections, (remaining) => {
              const projection = remaining[0]
              return [projection, remaining.slice(1)] as const
            })
            if (next !== undefined) return next
            const begun = (yield* Ref.get(begunReports)).get(plannedAttemptExecutorCorrelationKey(requested))
            if (begun !== undefined) return PlannedAttemptExecutorProjection.cases.Exact.make({ report: begun })
            return PlannedAttemptExecutorProjection.cases.NoReport.make({ correlation: requested })
          }),
        requestSuspension: (planned) => consumeCommand("Suspend", planned),
        begin: (request: PlannedAttemptExecutorRequest) =>
          beginSucceeds
            ? Effect.gen(function* () {
                yield* Ref.update(commandCallsRef, (calls) => [...calls, "Begin" as const])
                const report = PlannedAttemptExecutorReport.cases.ExecutorWorkExecuting.make({
                  correlation: plannedAttemptExecutorCorrelation(request.plannedAttempt)
                })
                yield* Ref.update(
                  begunReports,
                  (current) => new Map([...current, [plannedAttemptExecutorCorrelationKey(report.correlation), report]])
                )
                return report
              })
            : consumeCommand("Begin", request.plannedAttempt),
        resume: (request: PlannedAttemptExecutorRequest) => consumeCommand("Resume", request.plannedAttempt)
      })
    const trackerLayer = Layer.succeed(
      TrackerMutation,
      TrackerMutation.of({
        acquireTaskClaim: () => Effect.die("projection fixture must not acquire a successor claim"),
        readTaskClaim: () => Effect.succeed(ActiveTaskClaim.make(acquisition)),
        releaseTaskClaim: () => Effect.die("projection fixture must retain the exact claim")
      })
    )
    let applicationBuilds = 0
    const makeApplication = () => {
      applicationBuilds += 1
      const applicationOrdinal = applicationBuilds
      const executor = executorForApplication(applicationOrdinal)
      const executorLayer = Layer.succeed(PlannedAttemptExecutor, executor)
      const completeExecutorLayer =
        lifecycleForApplication === undefined
          ? controlledSynchronousPlannedAttemptExecutorLayer(executorLayer)
          : Layer.merge(
              executorLayer,
              Layer.succeed(
                PlannedAttemptExecutorLifecycleObservation,
                lifecycleForApplication(applicationOrdinal, executor)
              )
            )
      return productionWorkflowInterpreterLayer(
        runId,
        GitCommonDirectoryTarget.make(`${directory}/.git`),
        productionIntegrationTarget(`${directory}/.git`),
        trackerLayer,
        completeExecutorLayer,
        integratorCandidateProviderAuthority,
        acceptedResultEvidenceStore === undefined ? {} : { acceptedResultEvidenceStore }
      ).pipe(
        Layer.provide(
          Layer.succeed(
            TrackerGraphReader,
            TrackerGraphReader.of({
              read: () => Effect.succeed(projected.snapshot),
              readTaskWorkSpecification: () =>
                Ref.update(specificationReadsRef, (count) => count + 1).pipe(
                  Effect.andThen(
                    taskWorkSpecificationRead === undefined ? Effect.succeed(specification) : taskWorkSpecificationRead
                  )
                )
            })
          )
        ),
        Layer.provide(Layer.succeed(WorkflowTrace, WorkflowTrace.of({ emit: () => Effect.void })))
      )
    }
    const nextOperation = yield* Ref.make(0)
    const makeRun = () =>
      runWorkflow(
        target,
        Effect.die("existing history must supply the initial control policy"),
        AllocatedWorkflowRunId.make(runId)
      ).pipe(
        Effect.provideService(
          OperationIdAllocator,
          OperationIdAllocator.of({
            allocate: () =>
              Ref.getAndUpdate(nextOperation, (value) => value + 1).pipe(
                Effect.map((value) => OperationId.make(`production-executor-projection-operation-${value}`))
              )
          })
        ),
        Effect.provideService(
          TaskClaimAcquisitionPlanner,
          TaskClaimAcquisitionPlanner.of({ plan: () => Effect.die("projection fixture must not claim fresh work") })
        ),
        Effect.provideService(
          PlannedTaskAttemptPlanner,
          PlannedTaskAttemptPlanner.of({ plan: () => Effect.die("projection fixture must not plan a successor") })
        ),
        Effect.provide(ConfigProvider.layer(ConfigProvider.fromUnknown({ DALPH_JOURNAL_DATABASE: filename })))
      )
    const journalConfig = ConfigProvider.layer(ConfigProvider.fromUnknown({ DALPH_JOURNAL_DATABASE: filename }))
    const openProcess = Effect.suspend(() => Layer.build(makeApplication())).pipe(
      Effect.provide(journalConfig),
      Effect.map((application) => () => makeRun().pipe(Effect.provide(application)))
    )
    const activate = () => Effect.scoped(openProcess.pipe(Effect.flatMap((run) => run())))
    const readRecords = Effect.gen(function* () {
      return yield* (yield* JournalStore).read(runId)
    }).pipe(Effect.provide(sqliteJournalTestLayer({ filename })))
    return {
      activate,
      attempt,
      applicationBuilds: () => applicationBuilds,
      commandCalls: Ref.get(commandCallsRef),
      projectionCalls: Ref.get(projectionCallsRef),
      specificationReads: Ref.get(specificationReadsRef),
      readRecords,
      journalFilename: filename,
      openProcess,
      repository: directory,
      runId,
      target
    }
  })

type PublicRunFixture = Effect.Success<ReturnType<typeof makePublicRunFixture>>

/** Settles the once-only Begin with the required first accepted Executing report. */
const appendAcceptedExecutingExecutorHistory = Effect.fn("ProductionScenario.appendAcceptedExecutingExecutorHistory")(
  function* (fixture: PublicRunFixture) {
    const journal = yield* JournalStore
    const beginOrdinal = PlannedAttemptExecutorCommandOrdinal.make(1)
    const executingOrdinal = PlannedAttemptExecutorReportOrdinal.make(1)
    const executing = PlannedAttemptExecutorReport.cases.ExecutorWorkExecuting.make({
      correlation: plannedAttemptExecutorCorrelation(fixture.attempt)
    })
    yield* journal.append(
      fixture.runId,
      plannedAttemptExecutorCommandResponseObservedRecordKey(fixture.attempt.attemptId, beginOrdinal),
      PlannedAttemptExecutorCommandResponseObservedEvent.make({
        commandOrdinal: beginOrdinal,
        occurrenceClassification: "NonActionOccurrence",
        plannedAttempt: fixture.attempt,
        report: executing,
        version: workflowJournalEventVersion
      })
    )
    yield* journal.append(
      fixture.runId,
      plannedAttemptExecutorWorkReportedRecordKey(fixture.attempt.attemptId, executingOrdinal),
      PlannedAttemptExecutorWorkReportedEvent.make({
        ordinal: executingOrdinal,
        report: executing,
        version: workflowJournalEventVersion
      })
    )
  }
)

/** Leaves one exact Suspend intent pending so a later Safe projection has a causal command boundary. */
const appendPendingSuspendExecutorCommandIntent = Effect.fn(
  "ProductionScenario.appendPendingSuspendExecutorCommandIntent"
)(function* (fixture: PublicRunFixture) {
  const journal = yield* JournalStore
  const suspendOrdinal = PlannedAttemptExecutorCommandOrdinal.make(2)
  yield* journal.append(
    fixture.runId,
    plannedAttemptExecutorCommandIntendedRecordKey(fixture.attempt.attemptId, suspendOrdinal),
    PlannedAttemptExecutorCommandIntendedEvent.make({
      command: "Suspend",
      initiatedBy: { _tag: "DalphCoordinator" },
      occurrenceClassification: "InitiatedAction",
      ordinal: suspendOrdinal,
      plannedAttempt: fixture.attempt,
      version: workflowJournalEventVersion
    })
  )
})

/** Seeds a completed autonomous work unit without treating Terminal as a Begin response. */
const appendAcceptedTerminalExecutorHistory = Effect.fn("ProductionScenario.appendAcceptedTerminalExecutorHistory")(
  function* (
    fixture: PublicRunFixture,
    terminal: ReturnType<typeof PlannedAttemptExecutorReport.cases.ExecutorWorkTerminal.make>
  ) {
    yield* appendAcceptedExecutingExecutorHistory(fixture)
    const journal = yield* JournalStore
    const stateOrdinal = PlannedAttemptExecutorStateObservationOrdinal.make(1)
    const terminalOrdinal = PlannedAttemptExecutorReportOrdinal.make(2)
    yield* journal.append(
      fixture.runId,
      plannedAttemptExecutorStateObservedRecordKey(fixture.attempt.attemptId, stateOrdinal),
      PlannedAttemptExecutorStateObservedEvent.make({
        observation: PlannedAttemptExecutorStateObservation.cases.ExactExecutorReport.make({ report: terminal }),
        occurrenceClassification: "NonActionOccurrence",
        ordinal: stateOrdinal,
        plannedAttempt: fixture.attempt,
        version: workflowJournalEventVersion
      })
    )
    return yield* journal.append(
      fixture.runId,
      plannedAttemptExecutorWorkReportedRecordKey(fixture.attempt.attemptId, terminalOrdinal),
      PlannedAttemptExecutorWorkReportedEvent.make({
        ordinal: terminalOrdinal,
        report: terminal,
        version: workflowJournalEventVersion
      })
    )
  }
)

it.effect("ordinary production Run activation sends FullRerun cleanup through the provider authority", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const active = yield* Ref.make<ReadonlyMap<IntegratorCandidateResourceLocator, IntegratorSessionId>>(new Map())
      const observed = yield* Ref.make<ReadonlyArray<IntegratorCandidateResourceLocator>>([])
      const removed = yield* Ref.make<ReadonlyArray<IntegratorCandidateResourceLocator>>([])
      const provider = {
        observe: (authorization: Parameters<IntegratorCandidateProviderAuthorityService["observe"]>[0]) =>
          Effect.gen(function* () {
            yield* Ref.update(observed, (values) => [...values, authorization.locator])
            const owner = (yield* Ref.get(active)).get(authorization.locator)
            return owner === undefined
              ? IntegratorCandidateCleanupObservation.cases.Absent.make({
                  locator: authorization.locator,
                  revision: authorization.evidenceRevision
                })
              : IntegratorCandidateCleanupObservation.cases.Present.make({
                  locator: authorization.locator,
                  revision: authorization.evidenceRevision,
                  sessionId: owner,
                  writerQuiescent: true
                })
          }),
        remove: (authorization: Parameters<IntegratorCandidateProviderAuthorityService["remove"]>[0]) =>
          Ref.update(removed, (values) => [...values, authorization.locator]).pipe(
            Effect.andThen(
              Ref.update(active, (resources) => {
                const next = new Map(resources)
                next.delete(authorization.locator)
                return next
              })
            ),
            Effect.as(
              IntegratorCandidateCleanupMutationResult.cases.Removed.make({
                locator: authorization.locator,
                revision: authorization.evidenceRevision,
                sessionId: authorization.owner.sessionId
              })
            )
          )
      } satisfies IntegratorCandidateProviderAuthorityService
      const fixture = yield* makePublicRunFixture(() => [], {
        acceptedResultEvidenceStore: EvidenceStore.of({
          put: () => Effect.die("FullRerun cleanup does not write accepted-result evidence"),
          read: () => Effect.die("FullRerun cleanup does not read accepted-result evidence")
        }),
        integratorCandidateProviderAuthority: provider
      })
      const acceptedResult = AcceptedResult.make({
        commit: fixture.attempt.baseSha,
        evidenceManifest: EvidenceReference.make({ byteLength: 1, digest: EvidenceDigest.make("b".repeat(64)) })
      })
      const acceptedTerminalReport = PlannedAttemptExecutorReport.cases.ExecutorWorkTerminal.make({
        correlation: plannedAttemptExecutorCorrelation(fixture.attempt),
        result: { _tag: "Accepted", acceptedResult }
      })
      const terminalReport = yield* appendAcceptedTerminalExecutorHistory(fixture, acceptedTerminalReport).pipe(
        Effect.provide(sqliteJournalTestLayer({ filename: fixture.journalFilename }))
      )
      const positions = startupValidCandidatePositionsAfter(terminalReport)
      const candidateTarget = productionIntegrationTarget(`${fixture.repository}/.git`)
      const predecessor = IntegratorSessionCorrelation.make({
        acceptedResult,
        candidateResource: IntegratorCandidateResourceLocator.make("candidate:ordinary-production-predecessor"),
        expectedTargetHead: fixture.attempt.baseSha,
        integrationTarget: candidateTarget,
        plannedAttempt: fixture.attempt,
        queuedAt: positions.queuedAt,
        sessionId: IntegratorSessionId.make("session:ordinary-production-predecessor"),
        startedAt: positions.startedAt,
        targetLineageObservedAt: positions.predecessorLineageObservedAt
      })
      const successor = integratorSuccessorCorrelationFor({
        directionAppliedAt: positions.directionAppliedAt,
        predecessor,
        quarantineAt: positions.quarantineAt,
        targetLineage: TargetLineageObservation.make({
          plannedBaseIsAncestorOfTargetHead: true,
          plannedBaseSha: fixture.attempt.baseSha,
          targetHeadSha: fixture.attempt.baseSha
        }),
        targetLineageObservedAt: positions.successorLineageObservedAt
      })
      yield* Ref.set(
        active,
        new Map([
          [predecessor.candidateResource, predecessor.sessionId],
          [successor.candidateResource, successor.sessionId]
        ])
      )

      yield* appendCandidateProvenance(predecessor, successor, "ordinary-production-full-rerun", "StartupValid").pipe(
        Effect.provide(sqliteJournalTestLayer({ filename: fixture.journalFilename }))
      )

      const activation = yield* Effect.exit(fixture.activate())
      // Cleanup is the qualified boundary under test. Delivery then reaches
      // the deliberately absent Integrator, whose exact typed terminal
      // failure is unrelated to cleanup.
      expect(activation._tag).toBe("Failure")
      if (activation._tag === "Failure") {
        expect(Cause.findErrorOption(activation.cause)).toEqual(
          Option.some(new IntegratorBoundaryUnavailable({ boundary: "Integrator" }))
        )
      }
      const activationRecords = yield* fixture.readRecords
      expect(
        activationRecords.filter(({ event }) => event._tag === "IntegratorCandidateCleanupAuthorized")
      ).toHaveLength(1)
      expect(activationRecords.filter(({ event }) => event._tag === "IntegratorCandidateCleanupSettled")).toHaveLength(
        1
      )
      expect(yield* Ref.get(observed)).toEqual([predecessor.candidateResource, predecessor.candidateResource])
      expect(yield* Ref.get(removed)).toEqual([predecessor.candidateResource])
      const records = yield* fixture.readRecords
      expect(records.some(({ event }) => event._tag === "IntegratorCandidateCleanupSettled")).toBe(true)
      expect(records.some(({ event }) => event._tag === "IntegratorCandidateCleanupAuthorized")).toBe(true)
    }).pipe(Effect.provide(nodeGitCommandLayer), Effect.provide(NodeServices.layer))
  )
)

it.effect("ordinary production Run activation leaves a current quarantine untouched", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const providerObserveCalls = yield* Ref.make(0)
      const providerRemoveCalls = yield* Ref.make(0)
      const provider: IntegratorCandidateProviderAuthorityService = {
        observe: () =>
          Ref.update(providerObserveCalls, (calls) => calls + 1).pipe(
            Effect.andThen(Effect.die("current quarantine must not observe a provider candidate"))
          ),
        remove: () =>
          Ref.update(providerRemoveCalls, (calls) => calls + 1).pipe(
            Effect.andThen(Effect.die("current quarantine must not remove a provider candidate"))
          )
      }
      const fixture = yield* makePublicRunFixture(() => [], { integratorCandidateProviderAuthority: provider })
      const acceptedResult = AcceptedResult.make({
        commit: fixture.attempt.baseSha,
        evidenceManifest: EvidenceReference.make({ byteLength: 1, digest: EvidenceDigest.make("b".repeat(64)) })
      })
      const terminalReport = yield* Effect.gen(function* () {
        const report = PlannedAttemptExecutorReport.cases.ExecutorWorkTerminal.make({
          correlation: plannedAttemptExecutorCorrelation(fixture.attempt),
          result: { _tag: "Accepted", acceptedResult }
        })
        return yield* appendAcceptedTerminalExecutorHistory(fixture, report)
      }).pipe(Effect.provide(sqliteJournalTestLayer({ filename: fixture.journalFilename })))
      const positions = startupValidCandidatePositionsAfter(terminalReport)
      const predecessor = IntegratorSessionCorrelation.make({
        acceptedResult,
        candidateResource: IntegratorCandidateResourceLocator.make("candidate:ordinary-production-current-quarantine"),
        expectedTargetHead: fixture.attempt.baseSha,
        integrationTarget: productionIntegrationTarget(`${fixture.repository}/.git`),
        plannedAttempt: fixture.attempt,
        queuedAt: positions.queuedAt,
        sessionId: IntegratorSessionId.make("session:ordinary-production-current-quarantine"),
        startedAt: positions.startedAt,
        targetLineageObservedAt: positions.predecessorLineageObservedAt
      })
      yield* appendCurrentQuarantineProvenance(predecessor, "StartupValid").pipe(
        Effect.provide(sqliteJournalTestLayer({ filename: fixture.journalFilename }))
      )

      const activation = yield* Effect.exit(fixture.activate())
      // Cleanup is intentionally a no-op. The current quarantine keeps the
      // Run active; if a future activation continues to delivery, require the
      // exact unrelated Integrator failure rather than accepting any failure.
      if (activation._tag === "Failure") {
        expect(Cause.findErrorOption(activation.cause)).toEqual(
          Option.some(new IntegratorBoundaryUnavailable({ boundary: "Integrator" }))
        )
      } else {
        expect(activation._tag).toBe("Success")
        expect(activation.value).toEqual({ reason: "UnsettledResponsibility", _tag: "RunMustRemainActive" })
      }
      const records = yield* fixture.readRecords
      expect(records.filter(({ event }) => event._tag.startsWith("WorktreeCleanup"))).toHaveLength(0)
      expect(records.filter(({ event }) => event._tag.startsWith("BranchCleanup"))).toHaveLength(0)
      expect(records.filter(({ event }) => event._tag.startsWith("IntegratorCandidateCleanup"))).toHaveLength(0)
      expect(yield* Ref.get(providerObserveCalls)).toBe(0)
      expect(yield* Ref.get(providerRemoveCalls)).toBe(0)

      const fileSystem = yield* FileSystem.FileSystem
      const git = yield* GitCommand
      expect(yield* fileSystem.exists(fixture.attempt.worktree)).toBe(true)
      expect(
        (yield* git.runInWorktree(fixture.repository, ["show-ref", "--verify", fixture.attempt.branch])).stdout
      ).toContain(fixture.attempt.branch)
    }).pipe(Effect.provide(nodeGitCommandLayer), Effect.provide(NodeServices.layer))
  )
)

it.effect("ordinary production Run activation derives W1 then B1 cleanup and preserves unrelated P2", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const fixture = yield* makePublicRunFixture(() => [], { beginSucceeds: true, seedExecutorFacts: false })
      const fileSystem = yield* FileSystem.FileSystem
      const git = yield* GitCommand
      const p2Worktree = WorktreeLocator.make(`${fixture.repository}/worktree-p2`)
      const p2Branch = TaskBranchRef.make("refs/heads/dalph/production-executor-projection-p2")
      const replacementSpecification = makeTaskWorkSpecification({
        body: "cleanup provenance witness",
        taskId: fixture.attempt.taskId,
        title: "cleanup provenance witness"
      })
      yield* git.runInWorktree(fixture.repository, [
        "worktree",
        "add",
        "-b",
        p2Branch.slice("refs/heads/".length),
        p2Worktree,
        fixture.attempt.baseSha
      ])
      const successor = PlannedTaskAttempt.make({
        ...fixture.attempt,
        attemptId: AttemptId.make("production-executor-projection-successor"),
        branch: p2Branch,
        taskRevision: replacementSpecification.fingerprint,
        worktree: p2Worktree
      })
      yield* Effect.gen(function* () {
        yield* appendReplacementProvenance(fixture.attempt, successor, "StartupValid")
      }).pipe(Effect.provide(sqliteJournalTestLayer({ filename: fixture.journalFilename })))

      const activation = yield* Effect.exit(fixture.activate())
      expect(activation._tag).toBe("Success")
      const records = yield* fixture.readRecords
      expect(records.filter(({ event }) => event._tag === "WorktreeCleanupAuthorized")).toHaveLength(1)
      expect(records.filter(({ event }) => event._tag === "WorktreeCleanupSettled")).toHaveLength(1)
      expect(records.filter(({ event }) => event._tag === "BranchCleanupAuthorized")).toHaveLength(1)
      expect(records.filter(({ event }) => event._tag === "BranchCleanupSettled")).toHaveLength(1)
      expect(yield* fileSystem.exists(fixture.attempt.worktree)).toBe(false)
      expect(yield* fileSystem.exists(p2Worktree)).toBe(true)
      expect((yield* git.runInWorktree(fixture.repository, ["show-ref", "--verify", p2Branch])).stdout).toContain(
        p2Branch
      )
    }).pipe(Effect.provide(nodeGitCommandLayer), Effect.provide(NodeServices.layer))
  )
)

it.effect("reconciles a lost Begin to executing work without sending another command", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const fixture = yield* makePublicRunFixture((correlation) => [
        PlannedAttemptExecutorProjection.cases.Exact.make({
          report: PlannedAttemptExecutorReport.cases.ExecutorWorkExecuting.make({ correlation })
        })
      ])
      const activation = yield* fixture.activate().pipe(Effect.flip)
      const records = yield* fixture.readRecords
      expect(activation._tag).toBe("PlannedAttemptExecutorStateNoCurrentReport")
      const projection = records.find(
        ({ event }) => event._tag === "PlannedAttemptExecutorCommandProjectionObserved" && event.commandOrdinal === 1
      )
      expect(projection?.event).toMatchObject({
        commandOrdinal: 1,
        plannedAttempt: { runId: fixture.runId, attemptId: fixture.attempt.attemptId },
        observation: {
          _tag: "ExactExecutorReport",
          report: {
            _tag: "ExecutorWorkExecuting",
            correlation: { runId: fixture.runId, attemptId: fixture.attempt.attemptId }
          }
        }
      })
      expect(yield* fixture.projectionCalls).toBe(2)
      expect(yield* fixture.specificationReads).toBe(0)
      expect(fixture.applicationBuilds()).toBe(1)
      expect(yield* fixture.commandCalls).toEqual([])
      expect(
        records.filter(
          ({ event }) =>
            event._tag === "TaskTrackerReadIntentRecorded" && event.operation._tag === "ReadTaskWorkSpecification"
        )
      ).toHaveLength(1)
      expect(
        records.filter(({ event }) => event._tag === "PlannedAttemptExecutorCommandProjectionObserved")
      ).toHaveLength(1)
      expect(
        records
          .filter(({ event }) => event._tag === "PlannedAttemptExecutorCommandIntended")
          .map(({ event }) => (event._tag === "PlannedAttemptExecutorCommandIntended" ? event.ordinal : undefined))
      ).toEqual([1])
      const executingReports = records.filter(
        ({ event }) =>
          event._tag === "PlannedAttemptExecutorWorkReported" && event.report._tag === "ExecutorWorkExecuting"
      )
      expect(executingReports).toHaveLength(1)
      expect(executingReports).toEqual([
        expect.objectContaining({
          key: plannedAttemptExecutorWorkReportedRecordKey(
            fixture.attempt.attemptId,
            PlannedAttemptExecutorReportOrdinal.make(1)
          ),
          event: expect.objectContaining({
            ordinal: PlannedAttemptExecutorReportOrdinal.make(1),
            report: PlannedAttemptExecutorReport.cases.ExecutorWorkExecuting.make({
              correlation: plannedAttemptExecutorCorrelation(fixture.attempt)
            })
          })
        })
      ])
    }).pipe(Effect.provide(nodeGitCommandLayer), Effect.provide(NodeServices.layer))
  )
)

it.effect("reconciles a lost Suspend to Safe before ordinary Run entry resumes the same attempt", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const fixture = yield* makePublicRunFixture((correlation) => [
        PlannedAttemptExecutorProjection.cases.Exact.make({
          report: PlannedAttemptExecutorReport.cases.ExecutorWorkSafelySuspended.make({ correlation })
        })
      ])
      const correlation = plannedAttemptExecutorCorrelation(fixture.attempt)
      const beginOrdinal = PlannedAttemptExecutorCommandOrdinal.make(1)
      const executingOrdinal = PlannedAttemptExecutorReportOrdinal.make(1)
      const suspendOrdinal = PlannedAttemptExecutorCommandOrdinal.make(2)
      yield* Effect.gen(function* () {
        const journal = yield* JournalStore
        const executing = PlannedAttemptExecutorReport.cases.ExecutorWorkExecuting.make({ correlation })
        yield* journal.append(
          fixture.runId,
          plannedAttemptExecutorCommandResponseObservedRecordKey(fixture.attempt.attemptId, beginOrdinal),
          PlannedAttemptExecutorCommandResponseObservedEvent.make({
            commandOrdinal: beginOrdinal,
            occurrenceClassification: "NonActionOccurrence",
            plannedAttempt: fixture.attempt,
            report: executing,
            version: workflowJournalEventVersion
          })
        )
        yield* journal.append(
          fixture.runId,
          plannedAttemptExecutorWorkReportedRecordKey(fixture.attempt.attemptId, executingOrdinal),
          PlannedAttemptExecutorWorkReportedEvent.make({
            ordinal: executingOrdinal,
            report: executing,
            version: workflowJournalEventVersion
          })
        )
        yield* journal.append(
          fixture.runId,
          plannedAttemptExecutorCommandIntendedRecordKey(fixture.attempt.attemptId, suspendOrdinal),
          PlannedAttemptExecutorCommandIntendedEvent.make({
            command: "Suspend",
            initiatedBy: { _tag: "DalphCoordinator" },
            occurrenceClassification: "InitiatedAction",
            ordinal: suspendOrdinal,
            plannedAttempt: fixture.attempt,
            version: workflowJournalEventVersion
          })
        )
      }).pipe(Effect.provide(sqliteJournalTestLayer({ filename: fixture.journalFilename })))
      yield* fixture.activate().pipe(Effect.exit)
      const records = yield* fixture.readRecords
      const projection = records.find(({ event }) => event._tag === "PlannedAttemptExecutorCommandProjectionObserved")
      const focusedIntentAt = records.findIndex(
        ({ event }) =>
          event._tag === "TaskTrackerReadIntentRecorded" &&
          event.operation._tag === "ReadTaskWorkSpecification" &&
          event.operation.operationId !== OperationId.make("production-executor-projection-specification")
      )
      const focusedObservationAt = records.findIndex(
        ({ event }, index) =>
          index > focusedIntentAt &&
          event._tag === "TaskTrackerFactsObserved" &&
          event.observation._tag === "FocusedTaskWorkSpecificationFacts"
      )
      const continuationAt = records.findIndex(({ event }) => event._tag === "PlannedAttemptContinuationAuthorized")
      const continuationCommandAt = records.findIndex(
        ({ event }) => event._tag === "PlannedAttemptExecutorCommandIntended" && event.command === "Resume"
      )
      expect(projection?.event).toMatchObject({
        commandOrdinal: 2,
        plannedAttempt: { runId: fixture.runId, attemptId: fixture.attempt.attemptId },
        observation: {
          _tag: "ExactExecutorReport",
          report: {
            _tag: "ExecutorWorkSafelySuspended",
            correlation: { runId: fixture.runId, attemptId: fixture.attempt.attemptId }
          }
        }
      })
      expect(yield* fixture.projectionCalls).toBe(1)
      expect(yield* fixture.specificationReads).toBe(1)
      expect(fixture.applicationBuilds()).toBe(1)
      expect(yield* fixture.commandCalls).toEqual(["Resume"])
      expect(focusedIntentAt).toBeGreaterThanOrEqual(0)
      expect(focusedObservationAt).toBeGreaterThan(focusedIntentAt)
      expect(continuationAt).toBeGreaterThan(focusedObservationAt)
      expect(continuationCommandAt).toBeGreaterThan(continuationAt)
      expect(
        records
          .filter(({ event }) => event._tag === "PlannedAttemptExecutorCommandIntended")
          .map(({ event }) => (event._tag === "PlannedAttemptExecutorCommandIntended" ? event.ordinal : undefined))
      ).toEqual([1, 2, 3])
      expect(
        records
          .filter(({ event }) => event._tag === "PlannedAttemptExecutorWorkReported")
          .map(({ event }) => (event._tag === "PlannedAttemptExecutorWorkReported" ? event.report._tag : undefined))
      ).toEqual(["ExecutorWorkExecuting", "ExecutorWorkSafelySuspended"])
      expect(records.some(({ event }) => event._tag === "WorkflowRunTerminated")).toBe(false)
    }).pipe(Effect.provide(nodeGitCommandLayer), Effect.provide(NodeServices.layer))
  )
)

it.effect(
  "missing cross-repository partial malformed and throttled instructions make zero safely suspended resume calls",
  () =>
    Effect.scoped(
      Effect.gen(function* () {
        const cases: ReadonlyArray<{ readonly error: TrackerAdapterReadError; readonly name: string }> = [
          {
            error: new TrackerAdapterReadError({
              context: TrackerAdapterReadContext.cases.Github.make({
                operation: "GithubTrackerGraphReader.readTaskWorkSpecification"
              }),
              detail: "the claimed issue is missing",
              reason: TrackerAdapterReadFailureReason.cases.IncompleteSnapshot.make({})
            }),
            name: "missing"
          },
          {
            error: new TrackerAdapterReadError({
              context: TrackerAdapterReadContext.cases.Github.make({
                operation: "GithubTrackerGraphReader.readTaskWorkSpecification"
              }),
              detail: "the issue belongs to another repository",
              reason: TrackerAdapterReadFailureReason.cases.IncompleteSnapshot.make({})
            }),
            name: "cross-repository"
          },
          {
            error: new TrackerAdapterReadError({
              context: TrackerAdapterReadContext.cases.Github.make({
                operation: "GithubTrackerGraphReader.readTaskWorkSpecification"
              }),
              detail: "the provider returned a partial response",
              reason: TrackerAdapterReadFailureReason.cases.IncompleteSnapshot.make({})
            }),
            name: "partial"
          },
          {
            error: new TrackerAdapterReadError({
              context: TrackerAdapterReadContext.cases.Github.make({
                operation: "GithubTrackerGraphReader.readTaskWorkSpecification"
              }),
              detail: "the provider response is malformed",
              reason: TrackerAdapterReadFailureReason.cases.BoundaryDecode.make({})
            }),
            name: "malformed"
          },
          {
            error: new TrackerAdapterReadError({
              context: TrackerAdapterReadContext.cases.Github.make({
                operation: "GithubTrackerGraphReader.readTaskWorkSpecification"
              }),
              detail: "the provider throttled the read",
              reason: TrackerAdapterReadFailureReason.cases.Throttled.make({})
            }),
            name: "throttled"
          }
        ]

        for (const scenario of cases) {
          const fixture = yield* makePublicRunFixture(
            (correlation) => [
              PlannedAttemptExecutorProjection.cases.Exact.make({
                report: PlannedAttemptExecutorReport.cases.ExecutorWorkSafelySuspended.make({ correlation })
              })
            ],
            { taskWorkSpecificationRead: Effect.fail(scenario.error) }
          )
          yield* appendAcceptedExecutingExecutorHistory(fixture).pipe(
            Effect.provide(sqliteJournalTestLayer({ filename: fixture.journalFilename }))
          )
          yield* appendPendingSuspendExecutorCommandIntent(fixture).pipe(
            Effect.provide(sqliteJournalTestLayer({ filename: fixture.journalFilename }))
          )
          const activation = yield* Effect.exit(fixture.activate())
          expect(activation._tag, scenario.name).toBe("Failure")
          const failure =
            activation._tag === "Failure" ? Option.getOrThrow(Cause.findErrorOption(activation.cause)) : undefined
          expect(failure, scenario.name).toEqual(scenario.error)
          expect(yield* fixture.specificationReads, scenario.name).toBe(1)
          expect(yield* fixture.commandCalls, scenario.name).toEqual([])

          const records = yield* fixture.readRecords
          expect(
            records.some(
              ({ event }) =>
                event._tag === "PlannedAttemptExecutorCommandProjectionObserved" &&
                event.observation._tag === "ExactExecutorReport" &&
                event.observation.report._tag === "ExecutorWorkSafelySuspended"
            ),
            scenario.name
          ).toBe(true)
          expect(
            records.some(
              ({ event }) =>
                event._tag === "TaskTrackerReadIntentRecorded" && event.operation._tag === "ReadTaskWorkSpecification"
            ),
            scenario.name
          ).toBe(true)
          expect(
            records.some(({ event }) => event._tag === "PlannedAttemptContinuationAuthorized"),
            scenario.name
          ).toBe(false)
          expect(
            records.filter(({ event }) => event._tag === "PlannedAttemptExecutorCommandIntended"),
            scenario.name
          ).toHaveLength(2)
          expect(
            records
              .filter(({ event }) => event._tag === "PlannedAttemptExecutorCommandIntended")
              .map(({ event }) => (event._tag === "PlannedAttemptExecutorCommandIntended" ? event.command : undefined)),
            scenario.name
          ).toEqual(["Begin", "Suspend"])
        }
      }).pipe(Effect.provide(nodeGitCommandLayer), Effect.provide(NodeServices.layer))
    ),
  { timeout: githubInstructionFailureMatrixTimeoutMilliseconds }
)

it.effect("rejects a Terminal projection while a lost Begin still lacks Executing settlement", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const fixture = yield* makePublicRunFixture((correlation) => [
        PlannedAttemptExecutorProjection.cases.Exact.make({
          report: PlannedAttemptExecutorReport.cases.ExecutorWorkTerminal.make({
            correlation,
            result: { _tag: "Completed" }
          })
        })
      ])
      const failure = yield* fixture.activate().pipe(Effect.flip)
      expect(failure).toMatchObject({
        _tag: "PlannedAttemptExecutorBeginReportContradiction",
        observed: {
          _tag: "ExecutorWorkTerminal",
          correlation: { runId: fixture.runId, attemptId: fixture.attempt.attemptId }
        }
      })
      expect(failure).toBeInstanceOf(PlannedAttemptExecutorBeginReportContradiction)
      const records = yield* fixture.readRecords
      const projection = records.find(({ event }) => event._tag === "PlannedAttemptExecutorCommandProjectionObserved")
      expect(projection?.event).toMatchObject({
        commandOrdinal: 1,
        plannedAttempt: { runId: fixture.runId, attemptId: fixture.attempt.attemptId },
        observation: {
          _tag: "ExactExecutorReport",
          report: {
            _tag: "ExecutorWorkTerminal",
            correlation: { runId: fixture.runId, attemptId: fixture.attempt.attemptId },
            result: { _tag: "Completed" }
          }
        }
      })
      expect(yield* fixture.projectionCalls).toBe(1)
      expect(fixture.applicationBuilds()).toBe(1)
      expect(yield* fixture.commandCalls).toEqual([])
      expect(records.filter(({ event }) => event._tag === "PlannedAttemptExecutorWorkReported")).toHaveLength(0)
      expect(records.some(({ event }) => event._tag === "PlannedAttemptReplaced")).toBe(false)
    }).pipe(Effect.provide(nodeGitCommandLayer), Effect.provide(NodeServices.layer))
  )
)

it.effect(
  "retains responsibility after temporary executor unavailability; later ordinary Run entry retries projection",
  () =>
    Effect.scoped(
      Effect.gen(function* () {
        const fixture = yield* makePublicRunFixture((correlation) => [
          PlannedAttemptExecutorProjection.cases.TemporarilyUnavailable.make({ correlation }),
          PlannedAttemptExecutorProjection.cases.Exact.make({
            report: PlannedAttemptExecutorReport.cases.ExecutorWorkExecuting.make({ correlation })
          })
        ])
        const first = yield* fixture.activate().pipe(Effect.flip)
        expect(first).toMatchObject({
          _tag: "PlannedAttemptExecutorProjectionTemporarilyUnavailable",
          commandOrdinal: 1,
          correlation: { runId: fixture.runId, attemptId: fixture.attempt.attemptId }
        })
        expect(first).toBeInstanceOf(PlannedAttemptExecutorProjectionTemporarilyUnavailable)
        const firstRecords = yield* fixture.readRecords
        expect(firstRecords.filter(({ event }) => event._tag === "PlannedAttemptExecutorCommandIntended")).toHaveLength(
          1
        )
        expect(
          firstRecords.some(
            ({ event }) =>
              event._tag === "PlannedAttemptExecutorCommandProjectionObserved" &&
              event.commandOrdinal === 1 &&
              event.plannedAttempt.runId === fixture.runId &&
              event.plannedAttempt.attemptId === fixture.attempt.attemptId &&
              event.observation._tag === "ExecutorStateTemporarilyUnavailable"
          )
        ).toBe(true)
        expect(firstRecords.some(({ event }) => event._tag === "TaskClaimReleased")).toBe(false)
        expect(firstRecords.some(({ event }) => event._tag === "PlannedAttemptReplaced")).toBe(false)
        expect(firstRecords.some(({ event }) => event._tag === "PlannedAttemptExecutorWorkReported")).toBe(false)
        expect(firstRecords.some(({ event }) => event._tag === "WorkflowRunTerminated")).toBe(false)

        yield* fixture.activate().pipe(Effect.exit)
        const secondRecords = yield* fixture.readRecords
        expect(
          secondRecords.filter(({ event }) => event._tag === "PlannedAttemptExecutorCommandIntended")
        ).toHaveLength(1)
        expect(
          secondRecords.some(
            ({ event }) =>
              event._tag === "PlannedAttemptExecutorCommandProjectionObserved" &&
              event.observation._tag === "ExactExecutorReport" &&
              event.observation.report._tag === "ExecutorWorkExecuting" &&
              event.observation.report.correlation.runId === fixture.runId &&
              event.observation.report.correlation.attemptId === fixture.attempt.attemptId
          )
        ).toBe(true)
        expect(yield* fixture.projectionCalls).toBe(3)
        expect(secondRecords.some(({ event }) => event._tag === "TaskClaimReleased")).toBe(false)
        expect(secondRecords.some(({ event }) => event._tag === "PlannedAttemptReplaced")).toBe(false)
        expect(
          secondRecords.some(
            ({ event }) =>
              event._tag === "PlannedAttemptExecutorWorkReported" &&
              event.report._tag === "ExecutorWorkExecuting" &&
              event.report.correlation.attemptId === fixture.attempt.attemptId
          )
        ).toBe(true)
        expect(secondRecords.some(({ event }) => event._tag === "WorkflowRunTerminated")).toBe(false)
      }).pipe(Effect.provide(nodeGitCommandLayer), Effect.provide(NodeServices.layer))
    )
)

it.effect("retains resources after an unreadable executor projection; ordinary Run entry authorizes no successor", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const fixture = yield* makePublicRunFixture((correlation) => [
        PlannedAttemptExecutorProjection.cases.Unreadable.make({ correlation })
      ])
      const failure = yield* fixture.activate().pipe(Effect.flip)
      expect(failure).toMatchObject({
        _tag: "PlannedAttemptExecutorProjectionUnreadable",
        commandOrdinal: 1,
        correlation: { runId: fixture.runId, attemptId: fixture.attempt.attemptId }
      })
      expect(failure).toBeInstanceOf(PlannedAttemptExecutorProjectionUnreadable)
      const records = yield* fixture.readRecords
      expect(
        records.some(
          ({ event }) =>
            event._tag === "PlannedAttemptExecutorCommandProjectionObserved" &&
            event.commandOrdinal === 1 &&
            event.plannedAttempt.runId === fixture.runId &&
            event.plannedAttempt.attemptId === fixture.attempt.attemptId &&
            event.observation._tag === "ExecutorStateUnreadable"
        )
      ).toBe(true)
      expect(records.filter(({ event }) => event._tag === "PlannedAttemptExecutorCommandIntended")).toHaveLength(1)
      expect(records.some(({ event }) => event._tag === "TaskClaimReleased")).toBe(false)
      expect(
        records.some(
          ({ event }) =>
            event._tag === "TaskAttemptPlanned" &&
            event.operation.plannedAttempt.attemptId !== fixture.attempt.attemptId
        )
      ).toBe(false)
      expect(records.some(({ event }) => event._tag === "PlannedAttemptReplaced")).toBe(false)
      expect(records.some(({ event }) => event._tag === "PlannedAttemptExecutorWorkReported")).toBe(false)
      expect(records.some(({ event }) => event._tag === "WorkflowRunTerminated")).toBe(false)
    }).pipe(Effect.provide(nodeGitCommandLayer), Effect.provide(NodeServices.layer))
  )
)

it.effect("preserves the original responsibility after a foreign executor projection", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const fixture = yield* makePublicRunFixture((correlation) => [
        PlannedAttemptExecutorProjection.cases.CorrelationContradiction.make({
          expected: correlation,
          observed: PlannedAttemptExecutorReport.cases.ExecutorWorkExecuting.make({
            correlation: { runId: correlation.runId, attemptId: AttemptId.make("foreign-projection-attempt") }
          })
        })
      ])
      const failure = yield* fixture.activate().pipe(Effect.flip)
      expect(failure).toMatchObject({
        _tag: "PlannedAttemptExecutorCorrelationMismatch",
        expected: { runId: fixture.runId, attemptId: fixture.attempt.attemptId },
        observed: { runId: fixture.runId, attemptId: "foreign-projection-attempt" }
      })
      expect(failure).toBeInstanceOf(PlannedAttemptExecutorCorrelationMismatch)
      const records = yield* fixture.readRecords
      expect(
        records.some(
          ({ event }) =>
            event._tag === "PlannedAttemptExecutorCommandProjectionObserved" &&
            event.observation._tag === "ExecutorReportContradiction" &&
            event.commandOrdinal === 1 &&
            event.plannedAttempt.runId === fixture.runId &&
            event.plannedAttempt.attemptId === fixture.attempt.attemptId &&
            event.observation.observed.correlation.runId === fixture.runId &&
            event.observation.observed.correlation.attemptId === "foreign-projection-attempt"
        )
      ).toBe(true)
      expect(
        records.filter(({ event }) => event._tag === "PlannedAttemptExecutorWorkResponsibilityBegan")
      ).toHaveLength(1)
      expect(records.filter(({ event }) => event._tag === "TaskAttemptPlanned")).toHaveLength(1)
      expect(records.some(({ event }) => event._tag === "TaskClaimReleased")).toBe(false)
      expect(records.some(({ event }) => event._tag === "PlannedAttemptExecutorWorkReported")).toBe(false)
      expect(
        records.some(
          ({ event }) =>
            event._tag === "PlannedAttemptExecutorWorkResponsibilityBegan" &&
            event.plannedAttempt.attemptId === "foreign-projection-attempt"
        )
      ).toBe(false)
      expect(
        records.some(
          ({ event }) =>
            event._tag === "TaskAttemptPlanned" &&
            event.operation.plannedAttempt.attemptId === "foreign-projection-attempt"
        )
      ).toBe(false)
      expect(records.some(({ event }) => event._tag === "PlannedAttemptReplaced")).toBe(false)
      expect(records.some(({ event }) => event._tag === "WorkflowRunTerminated")).toBe(false)
    }).pipe(Effect.provide(nodeGitCommandLayer), Effect.provide(NodeServices.layer))
  )
)

it.effect("restart reprojects the exact executing attempt once then reattaches without Begin", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const providerHints = yield* PubSub.unbounded<void>()
      const firstOwnerWaiting = yield* Deferred.make<void>()
      const secondOwnerWaiting = yield* Deferred.make<void>()
      const secondAttachmentClosed = yield* Deferred.make<void>()
      const correlation = {
        attemptId: AttemptId.make("production-executor-projection-attempt"),
        runId: RunId.make("production-executor-projection-run")
      }
      const currentProjection = yield* Ref.make<PlannedAttemptExecutorProjection>(
        PlannedAttemptExecutorProjection.cases.Exact.make({
          report: PlannedAttemptExecutorReport.cases.ExecutorWorkExecuting.make({ correlation })
        })
      )
      const fixture = yield* makePublicRunFixture(() => [], {
        lifecycleForApplication: (applicationOrdinal, executor) => ({
          attach: (requested) =>
            Effect.gen(function* () {
              const subscription = yield* PubSub.subscribe(providerHints)
              const current = yield* executor.observe(requested, passiveLifecycleObservationPurpose)
              const ownerWaiting = applicationOrdinal === 1 ? firstOwnerWaiting : secondOwnerWaiting
              const providerChanges = Stream.unfold(undefined, () =>
                PubSub.take(subscription).pipe(
                  Effect.flatMap(() => executor.observe(requested, passiveLifecycleObservationPurpose)),
                  Effect.map((projection) => [projection, undefined] as const)
                )
              )
              return {
                changes: Stream.fromEffect(Deferred.succeed(ownerWaiting, undefined)).pipe(
                  Stream.drain,
                  Stream.concat(providerChanges)
                ),
                close:
                  applicationOrdinal === 2
                    ? Deferred.succeed(secondAttachmentClosed, undefined).pipe(Effect.asVoid)
                    : Effect.void,
                current
              }
            })
        }),
        projectionForApplication: () => Ref.get(currentProjection)
      })
      yield* Effect.scoped(
        appendAcceptedExecutingExecutorHistory(fixture).pipe(
          Effect.provide(sqliteJournalTestLayer({ filename: fixture.journalFilename }))
        )
      )
      const recoveredBeforeFirstProcess = reduceWorkflowJournalHistory(
        fixture.runId,
        yield* Effect.scoped(fixture.readRecords)
      )
      if (recoveredBeforeFirstProcess._tag !== "ValidWorkflowJournalHistory") {
        return yield* Effect.die("the shared Journal must reconstruct the exact executing responsibility")
      }
      expect(recoveredBeforeFirstProcess.runState.responsibility.entries).toContainEqual(
        expect.objectContaining({ _tag: "PlannedAttemptExecutorWorkResponsibility", plannedAttempt: fixture.attempt })
      )
      const firstProcessScope = yield* Scope.make()
      yield* Effect.addFinalizer((exit) => Scope.close(firstProcessScope, exit))
      const firstRun = yield* fixture.openProcess.pipe(Effect.provideService(Scope.Scope, firstProcessScope))
      const firstProcess = yield* firstRun().pipe(Effect.forkScoped)
      yield* Deferred.await(firstOwnerWaiting)
      yield* Fiber.interrupt(firstProcess)
      yield* Scope.close(firstProcessScope, Exit.void)
      const secondProcessScope = yield* Scope.make()
      yield* Effect.addFinalizer((exit) => Scope.close(secondProcessScope, exit))
      const secondRun = yield* fixture.openProcess.pipe(Effect.provideService(Scope.Scope, secondProcessScope))
      const secondProcess = yield* secondRun().pipe(Effect.forkScoped)
      yield* Deferred.await(secondOwnerWaiting)

      yield* Ref.set(
        currentProjection,
        PlannedAttemptExecutorProjection.cases.Exact.make({
          report: PlannedAttemptExecutorReport.cases.ExecutorWorkTerminal.make({
            correlation: plannedAttemptExecutorCorrelation(fixture.attempt),
            result: { _tag: "Completed" }
          })
        })
      )
      yield* PubSub.publish(providerHints, undefined)
      yield* Deferred.await(secondAttachmentClosed)
      yield* Fiber.interrupt(secondProcess)
      yield* Scope.close(secondProcessScope, Exit.void)
      const secondRecords = yield* Effect.scoped(fixture.readRecords)
      expect(fixture.applicationBuilds()).toBe(2)
      expect(secondRecords.filter(({ event }) => event._tag === "PlannedAttemptExecutorCommandIntended")).toHaveLength(
        1
      )
      expect(
        secondRecords.some(
          ({ event }) =>
            event._tag === "PlannedAttemptExecutorStateObserved" &&
            event.observation._tag === "ExactExecutorReport" &&
            event.observation.report._tag === "ExecutorWorkTerminal" &&
            event.observation.report.correlation.runId === fixture.runId &&
            event.observation.report.correlation.attemptId === fixture.attempt.attemptId &&
            event.observation.report.result._tag === "Completed"
        )
      ).toBe(true)
      expect(yield* fixture.projectionCalls).toBe(3)
      expect(yield* fixture.commandCalls).toEqual([])
      expect(secondRecords.some(({ event }) => event._tag === "PlannedAttemptReplaced")).toBe(false)
      expect(secondRecords.some(({ event }) => event._tag === "TaskClaimReleased")).toBe(false)
      expect(
        secondRecords.some(
          ({ event }) =>
            event._tag === "PlannedAttemptExecutorWorkReported" &&
            event.report._tag === "ExecutorWorkTerminal" &&
            event.report.correlation.attemptId === fixture.attempt.attemptId
        )
      ).toBe(true)
    }).pipe(Effect.provide(nodeGitCommandLayer), Effect.provide(NodeServices.layer))
  )
)

it.effect(
  "retains responsibility and position for absent unavailable unreadable or foreign projection",
  () =>
    Effect.scoped(
      Effect.gen(function* () {
        const cases = [
          {
            errorTag: "PlannedAttemptExecutorStateNoCurrentReport",
            observationTag: "ExecutorStateNoCurrentReport",
            projection: (correlation: ReturnType<typeof plannedAttemptExecutorCorrelation>) =>
              PlannedAttemptExecutorProjection.cases.NoReport.make({ correlation })
          },
          {
            errorTag: "PlannedAttemptExecutorStateTemporarilyUnavailable",
            observationTag: "ExecutorStateTemporarilyUnavailable",
            projection: (correlation: ReturnType<typeof plannedAttemptExecutorCorrelation>) =>
              PlannedAttemptExecutorProjection.cases.TemporarilyUnavailable.make({ correlation })
          },
          {
            errorTag: "PlannedAttemptExecutorStateUnreadable",
            observationTag: "ExecutorStateUnreadable",
            projection: (correlation: ReturnType<typeof plannedAttemptExecutorCorrelation>) =>
              PlannedAttemptExecutorProjection.cases.Unreadable.make({ correlation })
          },
          {
            errorTag: "PlannedAttemptExecutorCorrelationMismatch",
            observationTag: "ExecutorReportContradiction",
            projection: (correlation: ReturnType<typeof plannedAttemptExecutorCorrelation>) =>
              PlannedAttemptExecutorProjection.cases.CorrelationContradiction.make({
                expected: correlation,
                observed: PlannedAttemptExecutorReport.cases.ExecutorWorkExecuting.make({
                  correlation: {
                    attemptId: AttemptId.make("production-passive-failure-foreign-attempt"),
                    runId: correlation.runId
                  }
                })
              })
          }
        ] as const

        for (const testCase of cases) {
          const fixture = yield* makePublicRunFixture((correlation) => [testCase.projection(correlation)])
          yield* appendAcceptedExecutingExecutorHistory(fixture).pipe(
            Effect.provide(sqliteJournalTestLayer({ filename: fixture.journalFilename }))
          )
          const baseline = yield* fixture.readRecords
          const first = yield* Effect.exit(fixture.activate())
          expect(first._tag, testCase.errorTag).toBe("Failure")
          const firstFailure =
            first._tag === "Failure" ? Option.getOrThrow(Cause.findErrorOption(first.cause)) : undefined
          expect(firstFailure, testCase.errorTag).toMatchObject({ _tag: testCase.errorTag })
          const firstRecords = yield* fixture.readRecords
          const firstProcessRecords = firstRecords.slice(baseline.length)
          expect(
            firstProcessRecords.flatMap(({ event }) =>
              event._tag === "TaskTrackerReadIntentRecorded" ? [event.operation._tag] : []
            ),
            testCase.errorTag
          ).toEqual(["ReadTrackerGraph"])
          expect(
            firstProcessRecords.some(({ event }) => event._tag === "GitReadIntentRecorded"),
            testCase.errorTag
          ).toBe(false)

          yield* fixture.activate().pipe(Effect.exit)
          const records = yield* fixture.readRecords
          const newRecords = records.slice(baseline.length)
          expect(fixture.applicationBuilds(), testCase.errorTag).toBe(2)
          expect(yield* fixture.projectionCalls, testCase.errorTag).toBe(1)
          expect(yield* fixture.commandCalls, testCase.errorTag).toEqual([])
          expect(yield* fixture.specificationReads, testCase.errorTag).toBe(0)
          expect(
            records.flatMap(({ event }) =>
              event._tag === "PlannedAttemptExecutorCommandIntended" ? [event.command] : []
            ),
            testCase.errorTag
          ).toEqual(["Begin"])
          expect(
            newRecords.flatMap(({ event }) =>
              event._tag === "PlannedAttemptExecutorStateObserved" ? [event.observation._tag] : []
            ),
            testCase.errorTag
          ).toEqual([testCase.observationTag])
          expect(
            records.filter(({ event }) => event._tag === "TaskAttemptPlanned"),
            testCase.errorTag
          ).toHaveLength(1)
          expect(
            newRecords.some(({ event }) => event._tag.includes("Cleanup")),
            testCase.errorTag
          ).toBe(false)
          expect(
            newRecords.some(({ event }) => event._tag === "TaskClaimReleased"),
            testCase.errorTag
          ).toBe(false)
          expect(
            newRecords.some(({ event }) => event._tag === "PlannedAttemptReplaced"),
            testCase.errorTag
          ).toBe(false)
          expect(
            records.filter(({ event }) => event._tag === "PlannedAttemptExecutorWorkReported"),
            testCase.errorTag
          ).toHaveLength(1)
        }
      }).pipe(Effect.provide(nodeGitCommandLayer), Effect.provide(NodeServices.layer))
    ),
  { timeout: githubInstructionFailureMatrixTimeoutMilliseconds }
)

const absentHistoryApplicationScenario = "establishes an absent Run before its first tracker read and activates it once"

it.effect("reads exact GitHub title and body before planning one claimed task", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const result = yield* runFreshGithubInstructionVertical("exact", {
        data: {
          node: {
            __typename: "Issue",
            body: githubInstructionSpecification.body,
            id: githubInstructionIssueNodeId,
            repository: { id: githubInstructionRepositoryNodeId },
            title: githubInstructionSpecification.title
          }
        }
      })
      const request = result.executorRequests[0]
      const focusedAt = result.records.findIndex(
        ({ event }) =>
          event._tag === "TaskTrackerFactsObserved" && event.observation._tag === "FocusedTaskWorkSpecificationFacts"
      )
      const claimAt = result.records.findIndex(({ event }) => event._tag === "TaskClaimAcquired")
      const focusedIntentAt = result.records.findIndex(
        ({ event }) =>
          event._tag === "TaskTrackerReadIntentRecorded" && event.operation._tag === "ReadTaskWorkSpecification"
      )
      const plannedAt = result.records.findIndex(({ event }) => event._tag === "TaskAttemptPlanned")
      const responsibilityAt = result.records.findIndex(
        ({ event }) => event._tag === "PlannedAttemptExecutorWorkResponsibilityBegan"
      )

      expect(result.exit._tag).toBe("Failure")
      expect(result.executorCalls).toEqual(["begin"])
      expect(result.executorRequests).toHaveLength(1)
      expect(request?.specification).toEqual(githubInstructionSpecification)
      expect(claimAt).toBeGreaterThanOrEqual(0)
      expect(focusedIntentAt).toBeGreaterThan(claimAt)
      expect(focusedAt).toBeGreaterThan(focusedIntentAt)
      expect(plannedAt).toBeGreaterThan(focusedAt)
      expect(responsibilityAt).toBeGreaterThan(plannedAt)
      expect(result.githubCalls.filter((tag) => tag === "ReadTaskWorkSpecification")).toEqual([
        "ReadTaskWorkSpecification"
      ])
      expect(
        result.githubCalls.every((tag) =>
          ["ReadBlockedBy", "ReadIssue", "ReadSubIssues", "ReadTaskWorkSpecification", "ResolveIssue"].includes(tag)
        )
      ).toBe(true)
    }).pipe(Effect.provide(nodeGitCommandLayer), Effect.provide(NodeServices.layer))
  )
)

it.effect(
  "missing cross-repository partial malformed and throttled GitHub instructions make zero fresh executor calls",
  () =>
    Effect.scoped(
      Effect.gen(function* () {
        const cases: ReadonlyArray<{
          readonly body: unknown
          readonly name: string
          readonly reason: TrackerAdapterReadFailureReason["_tag"]
        }> = [
          { body: { data: { node: null } }, name: "missing", reason: "IncompleteSnapshot" },
          {
            body: {
              data: {
                node: {
                  __typename: "Issue",
                  body: "foreign body",
                  id: githubInstructionIssueNodeId,
                  repository: { id: "foreign-repository" },
                  title: "Foreign title"
                }
              }
            },
            name: "cross-repository",
            reason: "IncompleteSnapshot"
          },
          {
            body: {
              data: {
                node: {
                  __typename: "Issue",
                  body: "must not reach the executor",
                  id: githubInstructionIssueNodeId,
                  repository: { id: githubInstructionRepositoryNodeId },
                  title: "Partial title"
                }
              },
              errors: [{ message: "partial instruction response" }]
            },
            name: "partial",
            reason: "IncompleteSnapshot"
          },
          {
            body: {
              data: {
                node: {
                  __typename: "Issue",
                  body: "missing title",
                  id: githubInstructionIssueNodeId,
                  repository: { id: githubInstructionRepositoryNodeId }
                }
              }
            },
            name: "malformed",
            reason: "BoundaryDecode"
          },
          {
            body: { errors: [{ message: "API rate limit exceeded", type: "RATE_LIMITED" }] },
            name: "throttled",
            reason: "Throttled"
          }
        ]

        for (const scenario of cases) {
          const result = yield* runFreshGithubInstructionVertical(scenario.name, scenario.body)
          expect(result.exit._tag, scenario.name).toBe("Failure")
          const failure =
            result.exit._tag === "Failure" ? Option.getOrThrow(Cause.findErrorOption(result.exit.cause)) : undefined
          expect(failure, scenario.name).toMatchObject({
            _tag: "TrackerGraphReader.AdapterReadError",
            reason: { _tag: scenario.reason }
          })
          expect(result.executorCalls, scenario.name).toEqual([])
          expect(result.executorRequests, scenario.name).toEqual([])
          const claimAt = result.records.findIndex(({ event }) => event._tag === "TaskClaimAcquired")
          const focusedIntentAt = result.records.findIndex(
            ({ event }) =>
              event._tag === "TaskTrackerReadIntentRecorded" && event.operation._tag === "ReadTaskWorkSpecification"
          )
          expect(claimAt, scenario.name).toBeGreaterThanOrEqual(0)
          expect(focusedIntentAt, scenario.name).toBeGreaterThan(claimAt)
          expect(
            result.records.some(({ event }) => event._tag === "TaskAttemptPlanned"),
            scenario.name
          ).toBe(false)
          expect(
            result.githubCalls.every((tag) =>
              ["ReadBlockedBy", "ReadIssue", "ReadSubIssues", "ReadTaskWorkSpecification", "ResolveIssue"].includes(tag)
            ),
            scenario.name
          ).toBe(true)
        }
      }).pipe(Effect.provide(nodeGitCommandLayer), Effect.provide(NodeServices.layer))
    ),
  { timeout: githubInstructionFailureMatrixTimeoutMilliseconds }
)

it.effect(absentHistoryApplicationScenario, () =>
  Effect.scoped(
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem
      const directory = yield* fileSystem.makeTempDirectoryScoped({ prefix: "dalph-production-fresh-task-" })
      const git = yield* GitCommand
      yield* git.runInWorktree(directory, ["init"])
      yield* git.runInWorktree(directory, ["config", "user.email", "dalph@example.invalid"])
      yield* git.runInWorktree(directory, ["config", "user.name", "Dalph Test"])
      yield* fileSystem.writeFileString(`${directory}/README.md`, "fresh production task\n")
      yield* git.runInWorktree(directory, ["add", "README.md"])
      yield* git.runInWorktree(directory, ["commit", "-m", "initial"])
      const baseSha = GitCommitSha.make((yield* git.runInWorktree(directory, ["rev-parse", "HEAD"])).stdout.trim())
      const target = FixtureTarget.make("production-fresh-task-target")
      const runId = yield* freshWorkflowRunId(target)
      const projected = projectTrackerSnapshot({
        revision: "production-fresh-task-snapshot",
        tasks: [{ id: "A", lifecycle: { _tag: "Open" }, parentTaskId: null, prerequisiteIds: [] }]
      })
      const snapshot = Option.getOrThrow(
        Option.fromUndefinedOr(projected._tag === "Valid" ? projected.snapshot : undefined)
      )
      const task = Option.getOrThrow(Option.fromUndefinedOr(snapshot.eligibleTasks()[0]))
      const specification = makeTaskWorkSpecification({ body: "Complete A.", taskId: task.id, title: "Complete A" })
      const plannedAttempt = PlannedTaskAttempt.make({
        attemptId: AttemptId.make("production-fresh-task-attempt"),
        baseSha,
        branch: TaskBranchRef.make("refs/heads/dalph/production-fresh-task-attempt"),
        executor: TaskExecutorLocator.make("executor:production-controlled-fake"),
        runId,
        taskId: task.id,
        taskRevision: specification.fingerprint,
        worktree: WorktreeLocator.make(`${directory}/worktree`)
      })
      const specificationReads = yield* Ref.make(0)
      const trackerReaderLayer = Layer.succeed(
        TrackerGraphReader,
        TrackerGraphReader.of({
          read: () => Effect.succeed(snapshot),
          readTaskWorkSpecification: (_target, _taskId) =>
            Ref.update(specificationReads, (count) => count + 1).pipe(Effect.as(specification))
        })
      )
      const filename = JournalDatabaseLocator.make(`${directory}/journal.sqlite`)
      const application = productionWorkflowInterpreterLayer(
        runId,
        GitCommonDirectoryTarget.make(`${directory}/.git`),
        productionIntegrationTarget(`${directory}/.git`),
        controlledTrackerMutationLayer,
        productionControlledFakePlannedAttemptExecutorLayer,
        unavailableIntegratorCandidateProviderAuthority
      ).pipe(
        Layer.provide(trackerReaderLayer),
        Layer.provide(Layer.succeed(WorkflowTrace, WorkflowTrace.of({ emit: () => Effect.void })))
      )
      const nextOperation = yield* Ref.make(0)
      const initialPolicyEvaluations = yield* Ref.make(0)

      const activation = yield* runWorkflow(
        target,
        Ref.update(initialPolicyEvaluations, (count) => count + 1).pipe(
          Effect.as(InitialControlPolicy.make({ taskExecutionCapacity: TaskWorkCapacity.make(1) }))
        ),
        runId
      ).pipe(
        Effect.provideService(
          OperationIdAllocator,
          OperationIdAllocator.of({
            allocate: () =>
              Ref.getAndUpdate(nextOperation, (value) => value + 1).pipe(
                Effect.map((value) => OperationId.make(`production-fresh-task-operation-${value}`))
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
                token: ClaimToken.make("production-fresh-task-token")
              })
          })
        ),
        Effect.provideService(
          PlannedTaskAttemptPlanner,
          PlannedTaskAttemptPlanner.of({ plan: () => Effect.succeed(plannedAttempt) })
        ),
        Effect.provide(application),
        Effect.provide(ConfigProvider.layer(ConfigProvider.fromUnknown({ DALPH_JOURNAL_DATABASE: filename })))
      )
      const records = yield* Effect.gen(function* () {
        return yield* (yield* JournalStore).read(runId)
      }).pipe(Effect.provide(sqliteJournalTestLayer({ filename })))
      const beginningAt = records.findIndex(({ event }) => event._tag === "WorkflowRunBegan")
      const firstTrackerReadAt = records.findIndex(({ event }) => event._tag === "TaskTrackerReadIntentRecorded")

      expect(activation._tag).toBe("RunMustRemainActive")
      expect(yield* Ref.get(initialPolicyEvaluations)).toBe(1)
      expect(records.filter(({ event }) => event._tag === "WorkflowRunBegan")).toHaveLength(1)
      expect(beginningAt).toBe(0)
      expect(firstTrackerReadAt).toBeGreaterThan(beginningAt)
      expect(yield* Ref.get(specificationReads)).toBe(1)
    }).pipe(Effect.provide(nodeGitCommandLayer), Effect.provide(NodeServices.layer))
  )
)

it.effect("ticket delivery checks the tracker after a lost claim response and reuses the exact claim", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem
      const directory = yield* fileSystem.makeTempDirectoryScoped({ prefix: "dalph-production-lost-claim-" })
      const git = yield* GitCommand
      yield* git.runInWorktree(directory, ["init"])
      const filename = JournalDatabaseLocator.make(`${directory}/journal.sqlite`)
      const runId = RunId.make("production-lost-claim-run")
      const target = FixtureTarget.make("production-lost-claim-target")
      const taskId = TaskId.make("A")
      const graphRead = makeTrackerGraphObservationOperation(
        { _tag: "WorkflowEstablishment" },
        OperationId.make("production-lost-claim-graph"),
        target
      )
      const acquisition = {
        operationId: OperationId.make("production-lost-claim-operation"),
        owner: ClaimOwner.make("dalph"),
        taskId,
        token: ClaimToken.make("production-lost-claim-token")
      }
      const claim = ActiveTaskClaim.make(acquisition)
      const claimOperation = makeTaskClaimAcquisitionOperation({
        acquisition,
        predecessorOperationIds: [graphRead.operationId]
      })
      yield* Effect.gen(function* () {
        const journal = yield* JournalStore
        yield* journal.beginRun(
          runId,
          target,
          InitialControlPolicy.make({ taskExecutionCapacity: TaskWorkCapacity.make(1) })
        )
        yield* journal.append(runId, intentRecordKey(graphRead.operationId), taskTrackerReadIntent(graphRead))
        yield* journal.append(
          runId,
          outcomeRecordKey(graphRead.operationId),
          taskTrackerGraphFactsObserved(graphRead, {
            revision: TrackerRevision.make("production-lost-claim-before-crash"),
            taskIds: [taskId]
          })
        )
        yield* journal.append(
          runId,
          intentRecordKey(acquisition.operationId),
          TaskClaimAcquisitionIntendedEvent.make({ operation: claimOperation, version: workflowJournalEventVersion })
        )
      }).pipe(Effect.provide(sqliteJournalTestLayer({ filename })))

      const current = projectTrackerSnapshot({ revision: "production-lost-claim-current", tasks: [] })
      if (current._tag === "Invalid") return yield* Effect.die("current graph must be valid")
      type ClaimBoundaryCall = "acquire" | "read"
      const claimCalls = yield* Ref.make<ReadonlyArray<ClaimBoundaryCall>>([])
      const recordClaimCall = (call: ClaimBoundaryCall) => Ref.update(claimCalls, (calls) => [...calls, call])
      const nextOperation = yield* Ref.make(0)
      const trackerLayer = Layer.succeed(
        TrackerMutation,
        TrackerMutation.of({
          acquireTaskClaim: () => recordClaimCall("acquire").pipe(Effect.as(claim)),
          readTaskClaim: () => recordClaimCall("read").pipe(Effect.as(claim)),
          releaseTaskClaim: () => Effect.void
        })
      )
      const application = productionWorkflowInterpreterLayer(
        runId,
        GitCommonDirectoryTarget.make(`${directory}/.git`),
        productionIntegrationTarget(`${directory}/.git`),
        trackerLayer,
        productionControlledFakePlannedAttemptExecutorLayer,
        unavailableIntegratorCandidateProviderAuthority
      ).pipe(
        Layer.provide(
          Layer.succeed(
            TrackerGraphReader,
            TrackerGraphReader.of({
              read: () => Effect.succeed(current.snapshot),
              readTaskWorkSpecification: () => Effect.die("removed task has no specification")
            })
          )
        ),
        Layer.provide(Layer.succeed(WorkflowTrace, WorkflowTrace.of({ emit: () => Effect.void })))
      )

      yield* runWorkflow(
        target,
        Effect.die("existing history must supply the initial control policy"),
        AllocatedWorkflowRunId.make(runId)
      ).pipe(
        Effect.provideService(
          OperationIdAllocator,
          OperationIdAllocator.of({
            allocate: () =>
              Ref.getAndUpdate(nextOperation, (value) => value + 1).pipe(
                Effect.map((value) => OperationId.make(`production-lost-claim-operation-${value}`))
              )
          })
        ),
        Effect.provideService(
          TaskClaimAcquisitionPlanner,
          TaskClaimAcquisitionPlanner.of({
            plan: () => Effect.die("the later activation must reuse the accepted claim identity")
          })
        ),
        Effect.provideService(
          PlannedTaskAttemptPlanner,
          PlannedTaskAttemptPlanner.of({ plan: () => Effect.die("removed task must not plan an attempt") })
        ),
        Effect.provide(application),
        Effect.provide(ConfigProvider.layer(ConfigProvider.fromUnknown({ DALPH_JOURNAL_DATABASE: filename })))
      )

      expect(yield* Ref.get(claimCalls)).toEqual(["read"])
      const records = yield* Effect.gen(function* () {
        return yield* (yield* JournalStore).read(runId)
      }).pipe(Effect.provide(sqliteJournalTestLayer({ filename })))
      expect(records.filter(({ event }) => event._tag === "TaskClaimAcquisitionIntended")).toHaveLength(1)
      expect(records.find(({ event }) => event._tag === "TaskClaimAcquired")?.event).toMatchObject({
        _tag: "TaskClaimAcquired",
        claim: { operationId: acquisition.operationId }
      })
    }).pipe(Effect.provide(nodeGitCommandLayer), Effect.provide(NodeServices.layer))
  )
)

it.effect("ticket delivery reads Git after ambiguous worktree creation and preserves the exact registration", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem
      const directory = yield* fileSystem.makeTempDirectoryScoped({ prefix: "dalph-production-ambiguous-worktree-" })
      const git = yield* GitCommand
      yield* git.runInWorktree(directory, ["init"])
      yield* git.runInWorktree(directory, ["config", "user.email", "dalph@example.invalid"])
      yield* git.runInWorktree(directory, ["config", "user.name", "Dalph Test"])
      yield* fileSystem.writeFileString(`${directory}/README.md`, "ambiguous worktree\n")
      yield* git.runInWorktree(directory, ["add", "README.md"])
      yield* git.runInWorktree(directory, ["commit", "-m", "initial"])
      const baseSha = GitCommitSha.make((yield* git.runInWorktree(directory, ["rev-parse", "HEAD"])).stdout.trim())
      const filename = JournalDatabaseLocator.make(`${directory}/journal.sqlite`)
      const runId = RunId.make("production-ambiguous-worktree-run")
      const target = FixtureTarget.make("production-ambiguous-worktree-target")
      const specification = makeTaskWorkSpecification({
        body: "Complete A.",
        taskId: TaskId.make("A"),
        title: "Complete A"
      })
      const projected = projectTrackerSnapshot({
        revision: "production-ambiguous-worktree-current",
        tasks: [{ id: "A", lifecycle: { _tag: "Open" }, parentTaskId: null, prerequisiteIds: [] }]
      })
      if (projected._tag === "Invalid") return yield* Effect.die("current graph must be valid")
      const plannedAttempt = PlannedTaskAttempt.make({
        attemptId: AttemptId.make("production-ambiguous-worktree-attempt"),
        baseSha,
        branch: TaskBranchRef.make("refs/heads/dalph/production-ambiguous-worktree"),
        executor: TaskExecutorLocator.make("executor:production-controlled-fake"),
        runId,
        taskId: specification.taskId,
        taskRevision: specification.fingerprint,
        worktree: WorktreeLocator.make(`${directory}/worktree`)
      })
      yield* git.runInWorktree(directory, [
        "worktree",
        "add",
        "-b",
        "dalph/production-ambiguous-worktree",
        plannedAttempt.worktree,
        plannedAttempt.baseSha
      ])
      const worktreesBefore = (yield* git.runInWorktree(directory, ["worktree", "list", "--porcelain"])).stdout
      const acquisition = {
        operationId: OperationId.make("production-ambiguous-worktree-claim"),
        owner: ClaimOwner.make("dalph"),
        taskId: plannedAttempt.taskId,
        token: ClaimToken.make("production-ambiguous-worktree-token")
      }
      const claim = ActiveTaskClaim.make(acquisition)
      const graphRead = makeTrackerGraphObservationOperation(
        { _tag: "WorkflowEstablishment" },
        OperationId.make("production-ambiguous-worktree-graph"),
        target
      )
      const claimOperation = makeTaskClaimAcquisitionOperation({
        acquisition,
        predecessorOperationIds: [graphRead.operationId]
      })
      const plan = makeTaskAttemptPlanOperation({
        operationId: OperationId.make("production-ambiguous-worktree-plan"),
        plannedAttempt,
        predecessorOperationIds: [claimOperation.acquisition.operationId]
      })
      const worktree = makeTaskWorktreeReconciliationOperation({
        operationId: OperationId.make("production-ambiguous-worktree-operation"),
        plannedAttempt,
        predecessorOperationIds: [plan.operationId]
      })
      yield* Effect.gen(function* () {
        const journal = yield* JournalStore
        yield* journal.beginRun(
          runId,
          target,
          InitialControlPolicy.make({ taskExecutionCapacity: TaskWorkCapacity.make(1) })
        )
        yield* journal.append(runId, intentRecordKey(graphRead.operationId), taskTrackerReadIntent(graphRead))
        yield* journal.append(
          runId,
          outcomeRecordKey(graphRead.operationId),
          taskTrackerGraphFactsObserved(graphRead, {
            revision: TrackerRevision.make("production-ambiguous-worktree-before-crash"),
            taskIds: [plannedAttempt.taskId]
          })
        )
        yield* journal.append(
          runId,
          intentRecordKey(acquisition.operationId),
          TaskClaimAcquisitionIntendedEvent.make({ operation: claimOperation, version: workflowJournalEventVersion })
        )
        yield* journal.append(
          runId,
          outcomeRecordKey(acquisition.operationId),
          TaskClaimAcquiredEvent.make({ claim, version: workflowJournalEventVersion })
        )
        yield* journal.append(
          runId,
          attemptPlanRecordKey(plannedAttempt.attemptId),
          TaskAttemptPlannedEvent.make({ operation: plan, version: workflowJournalEventVersion })
        )
        yield* journal.append(
          runId,
          intentRecordKey(worktree.operationId),
          TaskWorktreeReconciliationIntendedEvent.make({ operation: worktree, version: workflowJournalEventVersion })
        )
      }).pipe(Effect.provide(sqliteJournalTestLayer({ filename })))

      const trackerLayer = Layer.succeed(
        TrackerMutation,
        TrackerMutation.of({
          acquireTaskClaim: () => Effect.die("the later activation must not acquire another claim"),
          readTaskClaim: () => Effect.succeed(claim),
          releaseTaskClaim: () => Effect.void
        })
      )
      const application = productionWorkflowInterpreterLayer(
        runId,
        GitCommonDirectoryTarget.make(`${directory}/.git`),
        productionIntegrationTarget(`${directory}/.git`),
        trackerLayer,
        productionControlledFakePlannedAttemptExecutorLayer,
        unavailableIntegratorCandidateProviderAuthority
      ).pipe(
        Layer.provide(
          Layer.succeed(
            TrackerGraphReader,
            TrackerGraphReader.of({
              read: () => Effect.succeed(projected.snapshot),
              readTaskWorkSpecification: () => Effect.succeed(specification)
            })
          )
        ),
        Layer.provide(Layer.succeed(WorkflowTrace, WorkflowTrace.of({ emit: () => Effect.void })))
      )
      const nextOperation = yield* Ref.make(0)
      yield* runWorkflow(
        target,
        Effect.die("existing history must supply the initial control policy"),
        AllocatedWorkflowRunId.make(runId)
      ).pipe(
        Effect.provideService(
          OperationIdAllocator,
          OperationIdAllocator.of({
            allocate: () =>
              Ref.getAndUpdate(nextOperation, (value) => value + 1).pipe(
                Effect.map((value) => OperationId.make(`production-ambiguous-worktree-later-activation-${value}`))
              )
          })
        ),
        Effect.provideService(
          TaskClaimAcquisitionPlanner,
          TaskClaimAcquisitionPlanner.of({ plan: () => Effect.die("the later activation must reuse the exact claim") })
        ),
        Effect.provideService(
          PlannedTaskAttemptPlanner,
          PlannedTaskAttemptPlanner.of({ plan: () => Effect.die("the later activation must reuse the exact attempt") })
        ),
        Effect.provide(application),
        Effect.provide(ConfigProvider.layer(ConfigProvider.fromUnknown({ DALPH_JOURNAL_DATABASE: filename })))
      )

      const worktreesAfter = (yield* git.runInWorktree(directory, ["worktree", "list", "--porcelain"])).stdout
      expect(worktreesAfter).toBe(worktreesBefore)
      const records = yield* Effect.gen(function* () {
        return yield* (yield* JournalStore).read(runId)
      }).pipe(Effect.provide(sqliteJournalTestLayer({ filename })))
      expect(records.filter(({ event }) => event._tag === "TaskWorktreeReconciliationIntended")).toHaveLength(1)
      expect(records.find(({ event }) => event._tag === "TaskWorktreeReady")?.event).toMatchObject({
        _tag: "TaskWorktreeReady",
        operationId: worktree.operationId,
        proof: {
          baseSha: plannedAttempt.baseSha,
          branch: plannedAttempt.branch,
          headSha: plannedAttempt.baseSha,
          worktree: plannedAttempt.worktree
        }
      })
    }).pipe(Effect.provide(nodeGitCommandLayer), Effect.provide(NodeServices.layer))
  )
)

it.effect("records an Operator capacity change through the production composition before scheduling continues", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem
      const directory = yield* fileSystem.makeTempDirectoryScoped({ prefix: "dalph-production-capacity-change-" })
      const git = yield* GitCommand
      yield* git.runInWorktree(directory, ["init"])
      const filename = JournalDatabaseLocator.make(`${directory}/journal.sqlite`)
      const target = FixtureTarget.make("production-capacity-change-target")
      const runId = yield* freshWorkflowRunId(target)
      const projected = projectTrackerSnapshot({ revision: "production-capacity-change-snapshot", tasks: [] })
      const snapshot = Option.getOrThrow(
        Option.fromUndefinedOr(projected._tag === "Valid" ? projected.snapshot : undefined)
      )
      const initialReadStarted = yield* Deferred.make<void>()
      const returnInitialRead = yield* Deferred.make<void>()
      const reads = yield* Ref.make(0)
      const nextOperation = yield* Ref.make(0)
      const trackerReaderLayer = Layer.succeed(
        TrackerGraphReader,
        TrackerGraphReader.of({
          read: () =>
            Ref.getAndUpdate(reads, (count) => count + 1).pipe(
              Effect.flatMap((count) =>
                count === 0
                  ? Deferred.succeed(initialReadStarted, undefined).pipe(
                      Effect.andThen(Deferred.await(returnInitialRead)),
                      Effect.as(snapshot)
                    )
                  : Effect.succeed(snapshot)
              )
            ),
          readTaskWorkSpecification: () => Effect.die("empty tracker has no task-work specification")
        })
      )
      const application = productionWorkflowInterpreterLayer(
        runId,
        GitCommonDirectoryTarget.make(`${directory}/.git`),
        productionIntegrationTarget(`${directory}/.git`),
        controlledTrackerMutationLayer,
        productionControlledFakePlannedAttemptExecutorLayer,
        unavailableIntegratorCandidateProviderAuthority
      ).pipe(
        Layer.provide(trackerReaderLayer),
        Layer.provide(Layer.succeed(WorkflowTrace, WorkflowTrace.of({ emit: () => Effect.void })))
      )
      yield* Effect.gen(function* () {
        const bootstrap = yield* JournaledRunBootstrap
        const running = yield* runWorkflow(
          target,
          Effect.succeed(InitialControlPolicy.make({ taskExecutionCapacity: TaskWorkCapacity.make(2) })),
          runId
        ).pipe(
          Effect.provideService(
            OperationIdAllocator,
            OperationIdAllocator.of({
              allocate: () =>
                Ref.getAndUpdate(nextOperation, (value) => value + 1).pipe(
                  Effect.map((value) => OperationId.make(`production-capacity-change-operation-${value}`))
                )
            })
          ),
          Effect.provideService(
            TaskClaimAcquisitionPlanner,
            TaskClaimAcquisitionPlanner.of({ plan: () => Effect.die("empty tracker has no claim") })
          ),
          Effect.provideService(
            PlannedTaskAttemptPlanner,
            PlannedTaskAttemptPlanner.of({ plan: () => Effect.die("empty tracker has no attempt") })
          ),
          Effect.forkScoped
        )
        yield* Deferred.await(initialReadStarted)
        const current = yield* bootstrap.operatorControl.readTaskWorkCapacity(runId)
        yield* bootstrap.operatorControl.setTaskWorkCapacity({ capacity: 1, expectedRevision: current.revision, runId })
        yield* bootstrap.operatorControl.applyControlDirection({ direction: "Pause", subject: { _tag: "Run", runId } })
        yield* bootstrap.operatorControl.applyControlDirection({
          direction: "Unpause",
          subject: { _tag: "Run", runId }
        })
        yield* Deferred.succeed(returnInitialRead, undefined)
        yield* Fiber.join(running)
      }).pipe(
        Effect.provide(application),
        Effect.provide(ConfigProvider.layer(ConfigProvider.fromUnknown({ DALPH_JOURNAL_DATABASE: filename })))
      )
      const records = yield* Effect.gen(function* () {
        return yield* (yield* JournalStore).read(runId)
      }).pipe(Effect.provide(sqliteJournalTestLayer({ filename })))

      expect(records.find(({ event }) => event._tag === "WorkflowRunBegan")?.event).toMatchObject({
        initialControlPolicy: { taskExecutionCapacity: 2 }
      })
      expect(records.find(({ event }) => event._tag === "TaskWorkCapacityChanged")?.event).toMatchObject({
        capacity: 1,
        previousRevision: 1,
        revision: 2
      })
      expect(
        records
          .filter(({ event }) => event._tag === "ControlDirectionApplied")
          .map(({ event }) => (event._tag === "ControlDirectionApplied" ? event.direction : undefined))
      ).toEqual(["Pause", "Unpause"])
    }).pipe(Effect.provide(nodeGitCommandLayer), Effect.provide(NodeServices.layer))
  )
)

it.effect("terminates once only after G2 proves the target complete and responsibilities settled", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem
      const directory = yield* fileSystem.makeTempDirectoryScoped({ prefix: "dalph-production-single-start-" })
      const git = yield* GitCommand
      yield* git.runInWorktree(directory, ["init"])
      const filename = JournalDatabaseLocator.make(`${directory}/journal.sqlite`)
      const target = FixtureTarget.make("production-single-start-target")
      const runId = yield* freshWorkflowRunId(target)
      const projected = projectTrackerSnapshot({
        revision: "production-single-start-snapshot",
        rootTaskId: TaskId.make("A"),
        tasks: [
          {
            id: TaskId.make("A"),
            lifecycle: { _tag: "CompletedSuccessfully" },
            parentTaskId: null,
            prerequisiteIds: []
          }
        ]
      })
      const snapshot = Option.getOrThrow(
        Option.fromUndefinedOr(projected._tag === "Valid" ? projected.snapshot : undefined)
      )
      const trackerReads = yield* Ref.make(0)
      const nextOperation = yield* Ref.make(0)
      const trackerReaderLayer = Layer.succeed(
        TrackerGraphReader,
        TrackerGraphReader.of({
          read: () => Ref.update(trackerReads, (count) => count + 1).pipe(Effect.as(snapshot)),
          readTaskWorkSpecification: () => Effect.die("completed tracker task needs no task-work specification")
        })
      )
      const application = productionWorkflowInterpreterLayer(
        runId,
        GitCommonDirectoryTarget.make(`${directory}/.git`),
        productionIntegrationTarget(`${directory}/.git`),
        controlledTrackerMutationLayer,
        productionControlledFakePlannedAttemptExecutorLayer,
        unavailableIntegratorCandidateProviderAuthority
      ).pipe(
        Layer.provide(trackerReaderLayer),
        Layer.provide(Layer.succeed(WorkflowTrace, WorkflowTrace.of({ emit: () => Effect.void })))
      )
      const execute = runWorkflow(
        target,
        Effect.succeed(InitialControlPolicy.make({ taskExecutionCapacity: TaskWorkCapacity.make(1) })),
        runId
      ).pipe(
        Effect.provideService(
          OperationIdAllocator,
          OperationIdAllocator.of({
            allocate: () =>
              Ref.getAndUpdate(nextOperation, (value) => value + 1).pipe(
                Effect.map((value) => OperationId.make(`production-single-start-operation-${value}`))
              )
          })
        ),
        Effect.provideService(
          TaskClaimAcquisitionPlanner,
          TaskClaimAcquisitionPlanner.of({ plan: () => Effect.die("completed tracker task has no claim") })
        ),
        Effect.provideService(
          PlannedTaskAttemptPlanner,
          PlannedTaskAttemptPlanner.of({ plan: () => Effect.die("completed tracker task has no attempt") })
        ),
        Effect.provide(application),
        Effect.provide(ConfigProvider.layer(ConfigProvider.fromUnknown({ DALPH_JOURNAL_DATABASE: filename })))
      )

      yield* execute
      const readsAfterFirstRun = yield* Ref.get(trackerReads)
      const repeated = yield* execute.pipe(Effect.flip)

      expect(repeated).toBeInstanceOf(WorkflowRunAlreadyTerminated)
      expect(readsAfterFirstRun).toBe(2)
      expect(yield* Ref.get(trackerReads)).toBe(readsAfterFirstRun)
      const records = yield* Effect.gen(function* () {
        return yield* (yield* JournalStore).read(runId)
      }).pipe(Effect.provide(sqliteJournalTestLayer({ filename })))
      expect(records[0]?.event._tag).toBe("WorkflowRunBegan")
      expect(records.at(-1)?.event._tag).toBe("WorkflowRunTerminated")
    }).pipe(Effect.provide(nodeGitCommandLayer), Effect.provide(NodeServices.layer))
  )
)

it.effect("rejects re-entry after fresh tracker facts conclusively block the Run", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem
      const directory = yield* fileSystem.makeTempDirectoryScoped({ prefix: "dalph-production-incomplete-" })
      const git = yield* GitCommand
      yield* git.runInWorktree(directory, ["init"])
      const filename = JournalDatabaseLocator.make(`${directory}/journal.sqlite`)
      const target = FixtureTarget.make("production-incomplete-target")
      const runId = yield* freshWorkflowRunId(target)
      const projected = projectTrackerSnapshot({
        revision: "production-incomplete-snapshot",
        rootTaskId: TaskId.make("A"),
        tasks: [
          {
            id: TaskId.make("A"),
            lifecycle: { _tag: "TerminalWithoutSuccess" },
            parentTaskId: null,
            prerequisiteIds: []
          },
          { id: TaskId.make("B"), lifecycle: { _tag: "Open" }, parentTaskId: null, prerequisiteIds: [TaskId.make("A")] }
        ]
      })
      const snapshot = Option.getOrThrow(
        Option.fromUndefinedOr(projected._tag === "Valid" ? projected.snapshot : undefined)
      )
      const trackerReads = yield* Ref.make(0)
      const nextOperation = yield* Ref.make(0)
      const trackerReaderLayer = Layer.succeed(
        TrackerGraphReader,
        TrackerGraphReader.of({
          read: () => Ref.update(trackerReads, (count) => count + 1).pipe(Effect.as(snapshot)),
          readTaskWorkSpecification: () => Effect.die("incomplete tracker has no selected task")
        })
      )
      const application = productionWorkflowInterpreterLayer(
        runId,
        GitCommonDirectoryTarget.make(`${directory}/.git`),
        productionIntegrationTarget(`${directory}/.git`),
        controlledTrackerMutationLayer,
        productionControlledFakePlannedAttemptExecutorLayer,
        unavailableIntegratorCandidateProviderAuthority
      ).pipe(
        Layer.provide(trackerReaderLayer),
        Layer.provide(Layer.succeed(WorkflowTrace, WorkflowTrace.of({ emit: () => Effect.void })))
      )
      const operationAllocator = OperationIdAllocator.of({
        allocate: () =>
          Ref.getAndUpdate(nextOperation, (value) => value + 1).pipe(
            Effect.map((value) => OperationId.make(`production-incomplete-operation-${value}`))
          )
      })
      const claimPlanner = TaskClaimAcquisitionPlanner.of({ plan: () => Effect.die("incomplete tracker has no claim") })
      const attemptPlanner = PlannedTaskAttemptPlanner.of({
        plan: () => Effect.die("incomplete tracker has no attempt")
      })
      const provideRunEnvironment = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
        effect.pipe(
          Effect.provideService(OperationIdAllocator, operationAllocator),
          Effect.provideService(TaskClaimAcquisitionPlanner, claimPlanner),
          Effect.provideService(PlannedTaskAttemptPlanner, attemptPlanner),
          Effect.provide(application),
          Effect.provide(ConfigProvider.layer(ConfigProvider.fromUnknown({ DALPH_JOURNAL_DATABASE: filename })))
        )

      const firstActivation = yield* runWorkflow(
        target,
        Effect.succeed(InitialControlPolicy.make({ taskExecutionCapacity: TaskWorkCapacity.make(1) })),
        runId
      ).pipe(provideRunEnvironment)
      const laterActivation = yield* runWorkflow(
        target,
        Effect.die("a terminal Run must not evaluate the initial control-policy source"),
        runId
      ).pipe(provideRunEnvironment, Effect.flip)
      const records = yield* Effect.gen(function* () {
        return yield* (yield* JournalStore).read(runId)
      }).pipe(Effect.provide(sqliteJournalTestLayer({ filename })))

      expect(firstActivation).toEqual({ _tag: "RunMayTerminate" })
      expect(laterActivation).toMatchObject({ _tag: "WorkflowRunAlreadyTerminated", runId })
      expect(yield* Ref.get(trackerReads)).toBe(2)
      expect(records.filter(({ event }) => event._tag === "WorkflowRunBegan")).toHaveLength(1)
      expect(new Set(records.map(({ runId: recordedRunId }) => recordedRunId))).toEqual(new Set([runId]))
      expect(records.at(-1)?.event).toMatchObject({ _tag: "WorkflowRunTerminated", disposition: "Blocked" })
    }).pipe(Effect.provide(nodeGitCommandLayer), Effect.provide(NodeServices.layer))
  )
)

it.effect("publishes a changed terminal observation before continuing", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem
      const directory = yield* fileSystem.makeTempDirectoryScoped({ prefix: "dalph-production-fake-" })
      const git = yield* GitCommand
      yield* git.runInWorktree(directory, ["init"])
      yield* git.runInWorktree(directory, ["config", "user.email", "dalph@example.invalid"])
      yield* git.runInWorktree(directory, ["config", "user.name", "Dalph Test"])
      yield* fileSystem.writeFileString(`${directory}/README.md`, "production-shaped fake\n")
      yield* git.runInWorktree(directory, ["add", "README.md"])
      yield* git.runInWorktree(directory, ["commit", "-m", "initial"])
      const baseSha = GitCommitSha.make((yield* git.runInWorktree(directory, ["rev-parse", "HEAD"])).stdout.trim())
      const runId = RunId.make("production-fake-run")
      const currentSpecification = makeTaskWorkSpecification({
        body: "Complete A.",
        taskId: TaskId.make("A"),
        title: "Complete A"
      })
      const plannedAttempt = PlannedTaskAttempt.make({
        attemptId: AttemptId.make("production-fake-attempt"),
        baseSha,
        branch: TaskBranchRef.make("refs/heads/dalph/production-fake-attempt"),
        executor: TaskExecutorLocator.make("executor:production-controlled-fake"),
        runId,
        taskId: TaskId.make("A"),
        taskRevision: currentSpecification.fingerprint,
        worktree: WorktreeLocator.make(`${directory}/worktree`)
      })
      const correlation = plannedAttemptExecutorCorrelation(plannedAttempt)
      const projected = projectTrackerSnapshot({
        revision: "production-current-observation",
        tasks: [{ id: "A", lifecycle: { _tag: "Open" }, parentTaskId: null, prerequisiteIds: [] }]
      })
      const currentSnapshot = Option.getOrThrow(
        Option.fromUndefinedOr(projected._tag === "Valid" ? projected.snapshot : undefined)
      )
      const filename = JournalDatabaseLocator.make(`${directory}/journal.sqlite`)
      yield* git.runInWorktree(directory, [
        "worktree",
        "add",
        "-b",
        "dalph/production-fake-attempt",
        plannedAttempt.worktree,
        plannedAttempt.baseSha
      ])
      const acquisition = {
        operationId: OperationId.make("production-claim"),
        owner: ClaimOwner.make("dalph"),
        taskId: plannedAttempt.taskId,
        token: ClaimToken.make("production-token")
      }
      const claimOperation = makeTaskClaimAcquisitionOperation({ acquisition, predecessorOperationIds: [] })
      const trackerTarget = FixtureTarget.make("production-target")
      const observation = makeTrackerGraphObservationOperation(
        { _tag: "WorkflowEstablishment" },
        OperationId.make("production-observation"),
        trackerTarget,
        [claimOperation.acquisition.operationId],
        [plannedAttempt.taskId]
      )
      const specificationObservation = makeTaskWorkSpecificationObservationOperation(
        OperationId.make("production-specification"),
        trackerTarget,
        plannedAttempt.taskId,
        [observation.operationId]
      )
      const plan = makeTaskAttemptPlanOperation({
        operationId: OperationId.make("production-plan"),
        plannedAttempt,
        predecessorOperationIds: [specificationObservation.operationId]
      })
      const worktree = makeTaskWorktreeReconciliationOperation({
        operationId: OperationId.make("production-worktree"),
        plannedAttempt,
        predecessorOperationIds: [plan.operationId]
      })
      const runningCommandOrdinal = PlannedAttemptExecutorCommandOrdinal.make(1)
      const runningOrdinal = PlannedAttemptExecutorReportOrdinal.make(1)
      yield* Effect.gen(function* () {
        const journal = yield* JournalStore
        yield* journal.beginRun(
          runId,
          trackerTarget,
          InitialControlPolicy.make({ taskExecutionCapacity: TaskWorkCapacity.make(1) })
        )
        yield* journal.append(
          runId,
          intentRecordKey(acquisition.operationId),
          TaskClaimAcquisitionIntendedEvent.make({ operation: claimOperation, version: workflowJournalEventVersion })
        )
        yield* journal.append(
          runId,
          outcomeRecordKey(acquisition.operationId),
          TaskClaimAcquiredEvent.make({
            claim: ActiveTaskClaim.make(acquisition),
            version: workflowJournalEventVersion
          })
        )
        yield* journal.append(runId, intentRecordKey(observation.operationId), taskTrackerReadIntent(observation))
        yield* journal.append(
          runId,
          outcomeRecordKey(observation.operationId),
          taskTrackerGraphFactsObserved(observation, {
            revision: TrackerRevision.make("production-observation"),
            taskIds: [plannedAttempt.taskId]
          })
        )
        yield* journal.append(
          runId,
          intentRecordKey(specificationObservation.operationId),
          taskTrackerReadIntent(specificationObservation)
        )
        yield* journal.append(
          runId,
          outcomeRecordKey(specificationObservation.operationId),
          taskTrackerWorkSpecificationFactsObserved(specificationObservation, currentSpecification)
        )
        yield* journal.append(
          runId,
          attemptPlanRecordKey(plannedAttempt.attemptId),
          TaskAttemptPlannedEvent.make({ operation: plan, version: workflowJournalEventVersion })
        )
        yield* journal.append(
          runId,
          intentRecordKey(worktree.operationId),
          TaskWorktreeReconciliationIntendedEvent.make({ operation: worktree, version: workflowJournalEventVersion })
        )
        yield* journal.append(
          runId,
          outcomeRecordKey(worktree.operationId),
          TaskWorktreeReadyEvent.make({
            operationId: worktree.operationId,
            proof: PlannedWorktreeReady.make({
              baseSha: plannedAttempt.baseSha,
              branch: plannedAttempt.branch,
              headSha: plannedAttempt.baseSha,
              worktree: plannedAttempt.worktree
            }),
            version: workflowJournalEventVersion
          })
        )
        yield* journal.append(
          runId,
          plannedAttemptExecutorWorkResponsibilityBeganRecordKey(plannedAttempt.attemptId),
          PlannedAttemptExecutorWorkResponsibilityBeganEvent.make({
            plannedAttempt,
            version: workflowJournalEventVersion
          })
        )
        yield* journal.append(
          runId,
          plannedAttemptExecutorCommandIntendedRecordKey(plannedAttempt.attemptId, runningCommandOrdinal),
          PlannedAttemptExecutorCommandIntendedEvent.make({
            command: "Begin",
            initiatedBy: { _tag: "DalphCoordinator" },
            occurrenceClassification: "InitiatedAction",
            ordinal: runningCommandOrdinal,
            plannedAttempt,
            version: workflowJournalEventVersion
          })
        )
        yield* journal.append(
          runId,
          plannedAttemptExecutorCommandResponseObservedRecordKey(plannedAttempt.attemptId, runningCommandOrdinal),
          PlannedAttemptExecutorCommandResponseObservedEvent.make({
            commandOrdinal: runningCommandOrdinal,
            occurrenceClassification: "NonActionOccurrence",
            plannedAttempt,
            report: PlannedAttemptExecutorReport.cases.ExecutorWorkExecuting.make({ correlation }),
            version: workflowJournalEventVersion
          })
        )
        yield* journal.append(
          runId,
          plannedAttemptExecutorWorkReportedRecordKey(plannedAttempt.attemptId, runningOrdinal),
          PlannedAttemptExecutorWorkReportedEvent.make({
            ordinal: runningOrdinal,
            report: PlannedAttemptExecutorReport.cases.ExecutorWorkExecuting.make({ correlation }),
            version: workflowJournalEventVersion
          })
        )
      }).pipe(Effect.provide(sqliteJournalTestLayer({ filename })))
      const trackerLayer = Layer.succeed(
        TrackerMutation,
        TrackerMutation.of({
          acquireTaskClaim: () => Effect.succeed(ActiveTaskClaim.make(acquisition)),
          readTaskClaim: () => Effect.succeed(ActiveTaskClaim.make(acquisition)),
          releaseTaskClaim: () => Effect.void
        })
      )
      const continuationTarget = IntegrationTarget.make({
        repository: GitRepositoryLocator.make(`${directory}/.git`),
        ref: IntegrationTargetRef.make("refs/heads/continuation-target")
      })
      const trackerReads = yield* Ref.make(0)
      const specificationReads = yield* Ref.make(0)
      const terminalExecutorLayer = Layer.succeed(
        PlannedAttemptExecutor,
        PlannedAttemptExecutor.of({
          observe: (requested) =>
            Effect.succeed(
              PlannedAttemptExecutorProjection.cases.Exact.make({
                report: PlannedAttemptExecutorReport.cases.ExecutorWorkTerminal.make({
                  correlation: requested,
                  result: { _tag: "Completed" }
                })
              })
            ),
          begin: () => Effect.die("accepted executing work must not begin again"),
          requestSuspension: () => Effect.die("the terminal observation requires no suspension"),
          resume: () => Effect.die("accepted executing work must not resume")
        })
      )
      const application = productionWorkflowInterpreterLayer(
        runId,
        GitCommonDirectoryTarget.make(`${directory}/.git`),
        continuationTarget,
        trackerLayer,
        controlledSynchronousPlannedAttemptExecutorLayer(terminalExecutorLayer),
        unavailableIntegratorCandidateProviderAuthority
      ).pipe(
        Layer.provide(
          Layer.succeed(
            TrackerGraphReader,
            TrackerGraphReader.of({
              read: () => Ref.updateAndGet(trackerReads, (reads) => reads + 1).pipe(Effect.as(currentSnapshot)),
              readTaskWorkSpecification: () =>
                Ref.updateAndGet(specificationReads, (reads) => reads + 1).pipe(Effect.as(currentSpecification))
            })
          )
        ),
        Layer.provide(Layer.succeed(WorkflowTrace, WorkflowTrace.of({ emit: () => Effect.void })))
      )
      const nextOperation = yield* Ref.make(0)
      const activateExactRun = runWorkflow(
        trackerTarget,
        Effect.die("existing history must supply the initial control policy"),
        AllocatedWorkflowRunId.make(runId)
      ).pipe(
        Effect.provideService(
          OperationIdAllocator,
          OperationIdAllocator.of({
            allocate: () =>
              Ref.getAndUpdate(nextOperation, (value) => value + 1).pipe(
                Effect.map((value) => OperationId.make(`production-later-activation-operation-${value}`))
              )
          })
        ),
        Effect.provideService(
          TaskClaimAcquisitionPlanner,
          TaskClaimAcquisitionPlanner.of({
            plan: () => Effect.die("the later activation must not acquire another claim")
          })
        ),
        Effect.provideService(
          PlannedTaskAttemptPlanner,
          PlannedTaskAttemptPlanner.of({ plan: () => Effect.die("the later activation must not plan another attempt") })
        ),
        Effect.provide(application),
        Effect.provide(ConfigProvider.layer(ConfigProvider.fromUnknown({ DALPH_JOURNAL_DATABASE: filename })))
      )
      expect(yield* activateExactRun).toEqual({ _tag: "RunMustRemainActive", reason: "TrackerTargetUnsettled" })
      expect(yield* Ref.get(trackerReads)).toBe(2)
      expect(yield* Ref.get(specificationReads)).toBe(0)
      const records = yield* Effect.gen(function* () {
        return yield* (yield* JournalStore).read(runId)
      }).pipe(Effect.provide(sqliteJournalTestLayer({ filename })))
      expect(records.findLast(({ event }) => event._tag === "PlannedAttemptExecutorWorkReported")?.event).toMatchObject(
        {
          _tag: "PlannedAttemptExecutorWorkReported",
          report: { _tag: "ExecutorWorkTerminal", correlation, result: { _tag: "Completed" } }
        }
      )
      expect(
        records.flatMap(({ event }) =>
          event._tag === "PlannedAttemptExecutorWorkReported"
            ? [{ ordinal: event.ordinal, report: event.report._tag }]
            : []
        )
      ).toEqual([
        { ordinal: 1, report: "ExecutorWorkExecuting" },
        { ordinal: 2, report: "ExecutorWorkTerminal" }
      ])
      const terminal = records.findLast(
        ({ event }) =>
          event._tag === "PlannedAttemptExecutorWorkReported" && event.report._tag === "ExecutorWorkTerminal"
      )
      const stabilizationRead = records.findLast(({ event }) => event._tag === "TaskTrackerReadIntentRecorded")
      expect(terminal).toBeDefined()
      expect(stabilizationRead).toBeDefined()
      expect(terminal?.position).toBeLessThan(stabilizationRead?.position ?? JournalPosition.make(0))
      const recordsAfterTerminal = records.filter(({ position }) => position > (terminal?.position ?? Infinity))
      expect(
        recordsAfterTerminal.flatMap(({ event }) =>
          event._tag === "TaskTrackerReadIntentRecorded" ? [event.operation._tag] : []
        )
      ).toEqual(["ReadTrackerGraph"])
      expect(
        recordsAfterTerminal.filter(
          ({ event }) => event._tag === "GitReadIntentRecorded" && event.operation._tag === "ReadTargetLineage"
        )
      ).toHaveLength(0)
      expect(recordsAfterTerminal.filter(({ event }) => event._tag === "TargetLineageObserved")).toHaveLength(0)
    }).pipe(Effect.provide(nodeGitCommandLayer), Effect.provide(NodeServices.layer))
  )
)

it.effect("blocks Run establishment before activation when preserved history has an invalid chronology", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem
      const directory = yield* fileSystem.makeTempDirectoryScoped({ prefix: "dalph-production-invalid-history-" })
      const filename = JournalDatabaseLocator.make(`${directory}/journal.sqlite`)
      const invalidRunId = RunId.make("invalid-preserved-run")
      const missingIntent = OperationId.make("missing-observation-intent")
      const missingIntentOperation = makeTrackerGraphObservationOperation(
        { _tag: "WorkflowEstablishment" },
        missingIntent,
        FixtureTarget.make("missing-observation-target")
      )
      yield* Effect.gen(function* () {
        const journal = yield* JournalStore
        const validObservation = makeTrackerGraphObservationOperation(
          { _tag: "WorkflowEstablishment" },
          OperationId.make("valid-preserved-observation"),
          FixtureTarget.make("valid-preserved-target")
        )
        yield* journal.append(
          RunId.make("valid-preserved-run"),
          intentRecordKey(validObservation.operationId),
          taskTrackerReadIntent(validObservation)
        )
        yield* journal.append(
          invalidRunId,
          outcomeRecordKey(missingIntent),
          taskTrackerGraphFactsObserved(missingIntentOperation, {
            revision: TrackerRevision.make("invalid-revision"),
            taskIds: []
          })
        )
      }).pipe(Effect.provide(sqliteJournalTestLayer({ filename })))

      const requestedRunId = RunId.make("current-production-run")
      const application = productionWorkflowInterpreterLayer(
        requestedRunId,
        GitCommonDirectoryTarget.make(directory),
        productionIntegrationTarget(directory),
        controlledTrackerMutationLayer,
        productionControlledFakePlannedAttemptExecutorLayer,
        unavailableIntegratorCandidateProviderAuthority
      ).pipe(
        Layer.provide(
          Layer.succeed(
            TrackerGraphReader,
            TrackerGraphReader.of({
              read: () => Effect.die("unused"),
              readTaskWorkSpecification: () => Effect.die("unused")
            })
          )
        ),
        Layer.provide(Layer.succeed(WorkflowTrace, WorkflowTrace.of({ emit: () => Effect.void })))
      )
      const blocked = yield* JournaledRunBootstrap.pipe(
        Effect.flatMap((bootstrap) =>
          bootstrap.activate(
            FixtureTarget.make("current-production-target"),
            Effect.die("invalid journal history must block before evaluating the initial policy"),
            AllocatedWorkflowRunId.make(requestedRunId),
            Effect.succeed({
              acceptedAt: null,
              decision: RunFinalityDecision.RunMustRemainActive({ reason: "TrackerTargetUnsettled" })
            })
          )
        ),
        Effect.provide(application),
        Effect.provide(ConfigProvider.layer(ConfigProvider.fromUnknown({ DALPH_JOURNAL_DATABASE: filename }))),
        Effect.flip
      )
      expect(blocked._tag).toBe("StartupRecoveryBlocked")
      if (blocked._tag !== "StartupRecoveryBlocked") {
        return yield* Effect.die(`unexpected Run-establishment error ${blocked._tag}`)
      }
      expect(blocked.issues).not.toHaveLength(0)
    }).pipe(Effect.provide(NodeServices.layer))
  )
)

it.effect(
  "blocks Run establishment before activation instead of ignoring another Run's unfinished responsibility",
  () =>
    Effect.scoped(
      Effect.gen(function* () {
        const fileSystem = yield* FileSystem.FileSystem
        const directory = yield* fileSystem.makeTempDirectoryScoped({ prefix: "dalph-production-other-run-" })
        const filename = JournalDatabaseLocator.make(`${directory}/journal.sqlite`)
        const unfinishedRunId = RunId.make("other-unfinished-run")
        const unfinishedAcquisition = {
          operationId: OperationId.make("other-unfinished-claim"),
          owner: ClaimOwner.make("dalph"),
          taskId: TaskId.make("other-unfinished-task"),
          token: ClaimToken.make("other-unfinished-token")
        }
        yield* Effect.gen(function* () {
          yield* (yield* JournalStore).append(
            unfinishedRunId,
            intentRecordKey(unfinishedAcquisition.operationId),
            TaskClaimAcquisitionIntendedEvent.make({
              operation: makeTaskClaimAcquisitionOperation({
                acquisition: unfinishedAcquisition,
                predecessorOperationIds: []
              }),
              version: workflowJournalEventVersion
            })
          )
        }).pipe(Effect.provide(sqliteJournalTestLayer({ filename })))

        const requestedRunId = RunId.make("requested-production-run")
        const application = productionWorkflowInterpreterLayer(
          requestedRunId,
          GitCommonDirectoryTarget.make(directory),
          productionIntegrationTarget(directory),
          controlledTrackerMutationLayer,
          productionControlledFakePlannedAttemptExecutorLayer,
          unavailableIntegratorCandidateProviderAuthority
        ).pipe(
          Layer.provide(
            Layer.succeed(
              TrackerGraphReader,
              TrackerGraphReader.of({
                read: () => Effect.die("unused"),
                readTaskWorkSpecification: () => Effect.die("unused")
              })
            )
          ),
          Layer.provide(Layer.succeed(WorkflowTrace, WorkflowTrace.of({ emit: () => Effect.void })))
        )
        const blocked = yield* JournaledRunBootstrap.pipe(
          Effect.flatMap((bootstrap) =>
            bootstrap.activate(
              FixtureTarget.make("requested-production-target"),
              Effect.die("foreign unfinished history must block before evaluating the initial policy"),
              AllocatedWorkflowRunId.make(requestedRunId),
              Effect.succeed({
                acceptedAt: null,
                decision: RunFinalityDecision.RunMustRemainActive({ reason: "TrackerTargetUnsettled" })
              })
            )
          ),
          Effect.provide(application),
          Effect.provide(ConfigProvider.layer(ConfigProvider.fromUnknown({ DALPH_JOURNAL_DATABASE: filename }))),
          Effect.flip
        )
        expect(blocked).toMatchObject({
          _tag: "StartupRecoveryBlocked",
          issues: [{ _tag: "OtherUnfinishedRunIssue", requestedRunId, unfinishedRunId }]
        })
      }).pipe(Effect.provide(NodeServices.layer))
    )
)

it.effect("blocks a new Run when another Run crashed immediately after recording its beginning", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem
      const directory = yield* fileSystem.makeTempDirectoryScoped({ prefix: "dalph-production-began-only-run-" })
      const filename = JournalDatabaseLocator.make(`${directory}/journal.sqlite`)
      const unfinishedRunId = RunId.make("began-only-unfinished-run")
      yield* Effect.gen(function* () {
        yield* (yield* JournalStore).beginRun(
          unfinishedRunId,
          FixtureTarget.make("began-only-target"),
          InitialControlPolicy.make({ taskExecutionCapacity: TaskWorkCapacity.make(1) })
        )
      }).pipe(Effect.provide(sqliteJournalTestLayer({ filename })))

      const requestedRunId = RunId.make("new-run-after-began-only")
      const application = productionWorkflowInterpreterLayer(
        requestedRunId,
        GitCommonDirectoryTarget.make(directory),
        productionIntegrationTarget(directory),
        controlledTrackerMutationLayer,
        productionControlledFakePlannedAttemptExecutorLayer,
        unavailableIntegratorCandidateProviderAuthority
      ).pipe(
        Layer.provide(
          Layer.succeed(
            TrackerGraphReader,
            TrackerGraphReader.of({
              read: () => Effect.die("Run establishment must fail before activation reads the tracker"),
              readTaskWorkSpecification: () =>
                Effect.die("Run establishment must fail before activation reads task work")
            })
          )
        ),
        Layer.provide(Layer.succeed(WorkflowTrace, WorkflowTrace.of({ emit: () => Effect.void })))
      )
      const blocked = yield* JournaledRunBootstrap.pipe(
        Effect.flatMap((bootstrap) =>
          bootstrap.activate(
            FixtureTarget.make("new-run-after-began-only-target"),
            Effect.die("another unfinished Run must block before evaluating the initial policy"),
            AllocatedWorkflowRunId.make(requestedRunId),
            Effect.succeed({
              acceptedAt: null,
              decision: RunFinalityDecision.RunMustRemainActive({ reason: "TrackerTargetUnsettled" })
            })
          )
        ),
        Effect.provide(application),
        Effect.provide(ConfigProvider.layer(ConfigProvider.fromUnknown({ DALPH_JOURNAL_DATABASE: filename }))),
        Effect.flip
      )

      expect(blocked).toMatchObject({
        _tag: "StartupRecoveryBlocked",
        issues: [{ _tag: "OtherUnfinishedRunIssue", requestedRunId, unfinishedRunId }]
      })
    }).pipe(Effect.provide(NodeServices.layer))
  )
)

it.effect("establishes a Run when another Run's responsibility is completed", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem
      const directory = yield* fileSystem.makeTempDirectoryScoped({ prefix: "dalph-production-completed-run-" })
      const filename = JournalDatabaseLocator.make(`${directory}/journal.sqlite`)
      const completedRunId = RunId.make("other-completed-run")
      const completedAcquisition = {
        operationId: OperationId.make("other-completed-claim"),
        owner: ClaimOwner.make("dalph"),
        taskId: TaskId.make("other-completed-task"),
        token: ClaimToken.make("other-completed-token")
      }
      const operation = makeTaskClaimAcquisitionOperation({
        acquisition: completedAcquisition,
        predecessorOperationIds: []
      })
      yield* Effect.gen(function* () {
        const journal = yield* JournalStore
        yield* journal.append(
          completedRunId,
          intentRecordKey(completedAcquisition.operationId),
          TaskClaimAcquisitionIntendedEvent.make({ operation, version: workflowJournalEventVersion })
        )
        yield* journal.append(
          completedRunId,
          outcomeRecordKey(completedAcquisition.operationId),
          TaskClaimAcquiredEvent.make({
            claim: ActiveTaskClaim.make(completedAcquisition),
            version: workflowJournalEventVersion
          })
        )
      }).pipe(Effect.provide(sqliteJournalTestLayer({ filename })))

      const requestedTarget = FixtureTarget.make("requested-after-completed-run-target")
      const requestedRunId = yield* freshWorkflowRunId(requestedTarget)
      const application = productionWorkflowInterpreterLayer(
        requestedRunId,
        GitCommonDirectoryTarget.make(directory),
        productionIntegrationTarget(directory),
        controlledTrackerMutationLayer,
        productionControlledFakePlannedAttemptExecutorLayer,
        unavailableIntegratorCandidateProviderAuthority
      ).pipe(
        Layer.provide(
          Layer.succeed(
            TrackerGraphReader,
            TrackerGraphReader.of({
              read: () => Effect.die("unused"),
              readTaskWorkSpecification: () => Effect.die("unused")
            })
          )
        ),
        Layer.provide(Layer.succeed(WorkflowTrace, WorkflowTrace.of({ emit: () => Effect.void })))
      )
      expect(
        yield* JournaledRunBootstrap.pipe(
          Effect.flatMap((bootstrap) =>
            bootstrap.activate(
              requestedTarget,
              Effect.succeed(InitialControlPolicy.make({ taskExecutionCapacity: TaskWorkCapacity.make(1) })),
              requestedRunId,
              Effect.succeed({
                acceptedAt: null,
                decision: RunFinalityDecision.RunMustRemainActive({ reason: "TrackerTargetUnsettled" })
              })
            )
          ),
          Effect.provide(application),
          Effect.provide(ConfigProvider.layer(ConfigProvider.fromUnknown({ DALPH_JOURNAL_DATABASE: filename })))
        )
      ).toEqual({ _tag: "RunMustRemainActive", reason: "TrackerTargetUnsettled" })
    }).pipe(Effect.provide(NodeServices.layer))
  )
)
