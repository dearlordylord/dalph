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
  PlannedAttemptExecutor,
  PlannedAttemptExecutorCommandFailure,
  PlannedAttemptExecutorProjection,
  PlannedAttemptExecutorReport,
  type PlannedAttemptExecutorRequest,
  PlannedTaskAttempt,
  plannedAttemptExecutorCorrelation,
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
  intentRecordKey,
  JournalDatabaseLocator,
  type JournalRecord,
  type JournalStoreError,
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
  nodeGitCommandLayer,
  OperationId,
  OperationIdAllocator,
  outcomeRecordKey,
  PlannedAttemptExecutorCommandIntendedEvent,
  plannedAttemptExecutorCommandIntendedRecordKey,
  PlannedAttemptExecutorCommandOrdinal,
  PlannedAttemptExecutorReportOrdinal,
  PlannedAttemptExecutorWorkReportedEvent,
  plannedAttemptExecutorWorkReportedRecordKey,
  PlannedAttemptExecutorWorkResponsibilityBeganEvent,
  plannedAttemptExecutorWorkResponsibilityBeganRecordKey,
  PlannedWorktreeReady,
  PlannedTaskAttemptPlanner,
  PlannedAttemptExecutorCorrelationMismatch,
  PlannedAttemptExecutorProjectionTemporarilyUnavailable,
  PlannedAttemptExecutorProjectionUnreadable,
  projectTrackerSnapshot,
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
  TrackerMutation,
  TrackerRevision,
  WorkflowRunAlreadyTerminated,
  workflowJournalEventVersion,
  WorkflowTrace,
  unavailableIntegratorCandidateProviderAuthority
} from "@dalph/orchestrator"
import { Cause, ConfigProvider, Deferred, Effect, Fiber, FileSystem, Layer, Option, Ref } from "effect"
import { expect } from "vitest"
import { taskTrackerGraphFactsObserved } from "../../../orchestrator/test/task-tracker-facts.js"
import { controlledFakePlannedAttemptExecutorLayer } from "../../../orchestrator/test/controlled-planned-attempt-executor.js"
import { productionWorkflowInterpreterLayer } from "../../src/application/production.js"

const productionIntegrationTarget = (repository: string): IntegrationTarget =>
  IntegrationTarget.make({
    repository: GitRepositoryLocator.make(repository),
    ref: IntegrationTargetRef.make("refs/heads/master")
  })

type PublicExecutorProjectionPlan = (
  correlation: ReturnType<typeof plannedAttemptExecutorCorrelation>
) => ReadonlyArray<PlannedAttemptExecutorProjection>

type PublicExecutorProjectionForApplication = (
  applicationOrdinal: number,
  correlation: ReturnType<typeof plannedAttemptExecutorCorrelation>
) => Effect.Effect<PlannedAttemptExecutorProjection>

// eslint-disable-next-line functional/no-mixed-types -- Public Run fixture intentionally groups boundary effects and observations for each scenario.
interface PublicRunFixture {
  readonly activate: () => ReturnType<typeof runWorkflow>
  readonly attempt: PlannedTaskAttempt
  readonly commandCalls: Effect.Effect<ReadonlyArray<"StartOrContinue" | "Suspend">>
  readonly applicationBuilds: () => number
  readonly projectionCalls: Effect.Effect<number>
  readonly readRecords: Effect.Effect<ReadonlyArray<JournalRecord>, JournalStoreError>
  readonly journalFilename: JournalDatabaseLocator
  readonly repository: string
  readonly runId: RunId
  readonly target: FixtureTarget
}

/**
 * Seeds the same exact Run facts that ordinary bootstrap recovers after a
 * coordinator process loss, leaving one StartOrContinue intent unmatched.
 * The returned `activate` function still crosses the public runWorkflow
 * boundary; only the opaque executor projection sequence is controlled.
 */
const makePublicRunFixture = (
  projectionPlan: PublicExecutorProjectionPlan,
  projectionForApplication?: PublicExecutorProjectionForApplication,
  integratorCandidateProviderAuthority: IntegratorCandidateProviderAuthorityService = unavailableIntegratorCandidateProviderAuthority,
  seedExecutorFacts = true,
  acceptedResultEvidenceStore?: EvidenceStoreService
) =>
  Effect.gen(function* () {
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
      OperationId.make("production-executor-projection-graph"),
      target,
      [claimOperation.acquisition.operationId],
      [taskId]
    )
    const plan = makeTaskAttemptPlanOperation({
      operationId: OperationId.make("production-executor-projection-plan"),
      plannedAttempt: attempt,
      predecessorOperationIds: [observation.operationId]
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
          command: "StartOrContinue",
          initiatedBy: { _tag: "DalphCoordinator" },
          occurrenceClassification: "InitiatedAction",
          ordinal: commandOrdinal,
          plannedAttempt: attempt,
          version: workflowJournalEventVersion
        })
      )
    }).pipe(Effect.provide(sqliteJournalTestLayer({ filename })))

    const projections = yield* Ref.make(projectionPlan(correlation))
    const commandCallsRef = yield* Ref.make<ReadonlyArray<"StartOrContinue" | "Suspend">>([])
    const projectionCallsRef = yield* Ref.make(0)
    const consumeCommand = (command: "StartOrContinue" | "Suspend", planned: PlannedTaskAttempt) =>
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
        project: (requested) =>
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
            return PlannedAttemptExecutorProjection.cases.NoReport.make({ correlation: requested })
          }),
        requestSuspension: (planned) => consumeCommand("Suspend", planned),
        startOrContinue: (request: PlannedAttemptExecutorRequest) =>
          consumeCommand("StartOrContinue", request.plannedAttempt)
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
      return productionWorkflowInterpreterLayer(
        runId,
        GitCommonDirectoryTarget.make(`${directory}/.git`),
        productionIntegrationTarget(`${directory}/.git`),
        trackerLayer,
        Layer.succeed(PlannedAttemptExecutor, executorForApplication(applicationOrdinal)),
        integratorCandidateProviderAuthority,
        undefined,
        undefined,
        undefined,
        acceptedResultEvidenceStore
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
    }
    const nextOperation = yield* Ref.make(0)
    const activate = () =>
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
        Effect.provide(makeApplication()),
        Effect.provide(ConfigProvider.layer(ConfigProvider.fromUnknown({ DALPH_JOURNAL_DATABASE: filename })))
      )
    const readRecords = Effect.gen(function* () {
      return yield* (yield* JournalStore).read(runId)
    }).pipe(Effect.provide(sqliteJournalTestLayer({ filename })))
    return {
      activate,
      attempt,
      applicationBuilds: () => applicationBuilds,
      commandCalls: Ref.get(commandCallsRef),
      projectionCalls: Ref.get(projectionCallsRef),
      readRecords,
      journalFilename: filename,
      repository: directory,
      runId,
      target
    } satisfies PublicRunFixture
  })

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
      const fixture = yield* makePublicRunFixture(
        () => [],
        undefined,
        provider,
        true,
        EvidenceStore.of({
          put: () => Effect.die("FullRerun cleanup does not write accepted-result evidence"),
          read: () => Effect.die("FullRerun cleanup does not read accepted-result evidence")
        })
      )
      const acceptedResult = AcceptedResult.make({
        commit: fixture.attempt.baseSha,
        evidenceManifest: EvidenceReference.make({ byteLength: 1, digest: EvidenceDigest.make("b".repeat(64)) })
      })
      const candidateTarget = productionIntegrationTarget(`${fixture.repository}/.git`)
      const predecessor = IntegratorSessionCorrelation.make({
        acceptedResult,
        candidateResource: IntegratorCandidateResourceLocator.make("candidate:ordinary-production-predecessor"),
        expectedTargetHead: fixture.attempt.baseSha,
        integrationTarget: candidateTarget,
        plannedAttempt: fixture.attempt,
        queuedAt: JournalPosition.make(12),
        sessionId: IntegratorSessionId.make("session:ordinary-production-predecessor"),
        startedAt: JournalPosition.make(13),
        targetLineageObservedAt: JournalPosition.make(15)
      })
      const successor = integratorSuccessorCorrelationFor({
        directionAppliedAt: JournalPosition.make(20),
        predecessor,
        quarantineAt: JournalPosition.make(19),
        targetLineage: TargetLineageObservation.make({
          plannedBaseIsAncestorOfTargetHead: true,
          plannedBaseSha: fixture.attempt.baseSha,
          targetHeadSha: fixture.attempt.baseSha
        }),
        targetLineageObservedAt: JournalPosition.make(22)
      })
      yield* Ref.set(
        active,
        new Map([
          [predecessor.candidateResource, predecessor.sessionId],
          [successor.candidateResource, successor.sessionId]
        ])
      )

      yield* Effect.gen(function* () {
        const journal = yield* JournalStore
        const reportOrdinal = PlannedAttemptExecutorReportOrdinal.make(1)
        yield* journal.append(
          fixture.runId,
          plannedAttemptExecutorWorkReportedRecordKey(fixture.attempt.attemptId, reportOrdinal),
          PlannedAttemptExecutorWorkReportedEvent.make({
            ordinal: reportOrdinal,
            report: PlannedAttemptExecutorReport.cases.Terminal.make({
              correlation: plannedAttemptExecutorCorrelation(fixture.attempt),
              result: { _tag: "Accepted", acceptedResult }
            }),
            version: workflowJournalEventVersion
          })
        )
        yield* appendCandidateProvenance(predecessor, successor, "ordinary-production-full-rerun", "StartupValid")
      }).pipe(Effect.provide(sqliteJournalTestLayer({ filename: fixture.journalFilename })))

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
      const fixture = yield* makePublicRunFixture(() => [], undefined, provider)
      const acceptedResult = AcceptedResult.make({
        commit: fixture.attempt.baseSha,
        evidenceManifest: EvidenceReference.make({ byteLength: 1, digest: EvidenceDigest.make("b".repeat(64)) })
      })
      const predecessor = IntegratorSessionCorrelation.make({
        acceptedResult,
        candidateResource: IntegratorCandidateResourceLocator.make("candidate:ordinary-production-current-quarantine"),
        expectedTargetHead: fixture.attempt.baseSha,
        integrationTarget: productionIntegrationTarget(`${fixture.repository}/.git`),
        plannedAttempt: fixture.attempt,
        queuedAt: JournalPosition.make(12),
        sessionId: IntegratorSessionId.make("session:ordinary-production-current-quarantine"),
        startedAt: JournalPosition.make(13),
        targetLineageObservedAt: JournalPosition.make(15)
      })
      yield* Effect.gen(function* () {
        const journal = yield* JournalStore
        const reportOrdinal = PlannedAttemptExecutorReportOrdinal.make(1)
        yield* journal.append(
          fixture.runId,
          plannedAttemptExecutorWorkReportedRecordKey(fixture.attempt.attemptId, reportOrdinal),
          PlannedAttemptExecutorWorkReportedEvent.make({
            ordinal: reportOrdinal,
            report: PlannedAttemptExecutorReport.cases.Terminal.make({
              correlation: plannedAttemptExecutorCorrelation(fixture.attempt),
              result: { _tag: "Accepted", acceptedResult }
            }),
            version: workflowJournalEventVersion
          })
        )
        yield* appendCurrentQuarantineProvenance(predecessor, "StartupValid")
      }).pipe(Effect.provide(sqliteJournalTestLayer({ filename: fixture.journalFilename })))

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
      const fixture = yield* makePublicRunFixture(
        () => [],
        undefined,
        unavailableIntegratorCandidateProviderAuthority,
        false
      )
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
      expect(activation._tag).toBe("Failure")
      if (activation._tag === "Failure") {
        expect(Cause.findErrorOption(activation.cause)).toEqual(
          Option.some(
            new PlannedAttemptExecutorCommandFailure({
              command: "StartOrContinue",
              correlation: plannedAttemptExecutorCorrelation(successor),
              detail: "public projection fixture has no StartOrContinue response"
            })
          )
        )
      }
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

it.effect("reconciles an exact projected executor report through ordinary Run entry (Running)", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const fixture = yield* makePublicRunFixture((correlation) => [
        PlannedAttemptExecutorProjection.cases.Exact.make({
          report: PlannedAttemptExecutorReport.cases.Running.make({ correlation })
        })
      ])
      const activation = yield* fixture.activate().pipe(Effect.flip)
      const records = yield* fixture.readRecords
      expect(activation._tag).toBe("PlannedAttemptExecutorCommandFailure")
      const projection = records.find(
        ({ event }) => event._tag === "PlannedAttemptExecutorCommandProjectionObserved" && event.commandOrdinal === 1
      )
      expect(projection?.event).toMatchObject({
        commandOrdinal: 1,
        plannedAttempt: { runId: fixture.runId, attemptId: fixture.attempt.attemptId },
        observation: {
          _tag: "ExactExecutorReport",
          report: { _tag: "Running", correlation: { runId: fixture.runId, attemptId: fixture.attempt.attemptId } }
        }
      })
      expect(yield* fixture.projectionCalls).toBe(1)
      expect(fixture.applicationBuilds()).toBe(1)
      expect(yield* fixture.commandCalls).toEqual(["StartOrContinue"])
      expect(
        records.filter(({ event }) => event._tag === "PlannedAttemptExecutorCommandProjectionObserved")
      ).toHaveLength(1)
      expect(
        records
          .filter(({ event }) => event._tag === "PlannedAttemptExecutorCommandIntended")
          .map(({ event }) => (event._tag === "PlannedAttemptExecutorCommandIntended" ? event.ordinal : undefined))
      ).toEqual([1, 2])
      expect(records.some(({ event }) => event._tag === "PlannedAttemptExecutorWorkReported")).toBe(false)
    }).pipe(Effect.provide(nodeGitCommandLayer), Effect.provide(NodeServices.layer))
  )
)

it.effect("reconciles an exact projected executor report through ordinary Run entry (SafelySuspended)", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const fixture = yield* makePublicRunFixture((correlation) => [
        PlannedAttemptExecutorProjection.cases.Exact.make({
          report: PlannedAttemptExecutorReport.cases.SafelySuspended.make({ correlation })
        })
      ])
      yield* fixture.activate().pipe(Effect.exit)
      const records = yield* fixture.readRecords
      const projection = records.find(({ event }) => event._tag === "PlannedAttemptExecutorCommandProjectionObserved")
      expect(projection?.event).toMatchObject({
        commandOrdinal: 1,
        plannedAttempt: { runId: fixture.runId, attemptId: fixture.attempt.attemptId },
        observation: {
          _tag: "ExactExecutorReport",
          report: {
            _tag: "SafelySuspended",
            correlation: { runId: fixture.runId, attemptId: fixture.attempt.attemptId }
          }
        }
      })
      expect(yield* fixture.projectionCalls).toBe(1)
      expect(fixture.applicationBuilds()).toBe(1)
      expect(yield* fixture.commandCalls).toEqual(["StartOrContinue"])
      expect(
        records
          .filter(({ event }) => event._tag === "PlannedAttemptExecutorCommandIntended")
          .map(({ event }) => (event._tag === "PlannedAttemptExecutorCommandIntended" ? event.ordinal : undefined))
      ).toEqual([1, 2])
      expect(records.some(({ event }) => event._tag === "WorkflowRunTerminated")).toBe(false)
    }).pipe(Effect.provide(nodeGitCommandLayer), Effect.provide(NodeServices.layer))
  )
)

it.effect("reconciles an exact projected executor report through ordinary Run entry (Terminal)", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const fixture = yield* makePublicRunFixture((correlation) => [
        PlannedAttemptExecutorProjection.cases.Exact.make({
          report: PlannedAttemptExecutorReport.cases.Terminal.make({ correlation, result: { _tag: "Completed" } })
        })
      ])
      yield* fixture.activate().pipe(Effect.exit)
      const records = yield* fixture.readRecords
      const projection = records.find(({ event }) => event._tag === "PlannedAttemptExecutorCommandProjectionObserved")
      expect(projection?.event).toMatchObject({
        commandOrdinal: 1,
        plannedAttempt: { runId: fixture.runId, attemptId: fixture.attempt.attemptId },
        observation: {
          _tag: "ExactExecutorReport",
          report: {
            _tag: "Terminal",
            correlation: { runId: fixture.runId, attemptId: fixture.attempt.attemptId },
            result: { _tag: "Completed" }
          }
        }
      })
      expect(yield* fixture.projectionCalls).toBe(1)
      expect(fixture.applicationBuilds()).toBe(1)
      expect(yield* fixture.commandCalls).toEqual([])
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
            report: PlannedAttemptExecutorReport.cases.Terminal.make({ correlation, result: { _tag: "Completed" } })
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
              event.observation.report._tag === "Terminal" &&
              event.observation.report.correlation.runId === fixture.runId &&
              event.observation.report.correlation.attemptId === fixture.attempt.attemptId
          )
        ).toBe(true)
        expect(yield* fixture.projectionCalls).toBe(2)
        expect(secondRecords.some(({ event }) => event._tag === "TaskClaimReleased")).toBe(false)
        expect(secondRecords.some(({ event }) => event._tag === "PlannedAttemptReplaced")).toBe(false)
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
          observed: PlannedAttemptExecutorReport.cases.Running.make({
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

it.effect(
  "reprojects the exact executor state after process loss on a second ordinary Run activation without a duplicate command",
  () =>
    Effect.scoped(
      Effect.gen(function* () {
        const firstProcessResultAvailable = yield* Deferred.make<PlannedAttemptExecutorProjection>()
        const fixture = yield* makePublicRunFixture(
          () => [],
          (applicationOrdinal, correlation) => {
            const exact = PlannedAttemptExecutorProjection.cases.Exact.make({
              report: PlannedAttemptExecutorReport.cases.Terminal.make({ correlation, result: { _tag: "Completed" } })
            })
            return applicationOrdinal === 1
              ? Deferred.succeed(firstProcessResultAvailable, exact).pipe(Effect.andThen(Effect.never))
              : Effect.succeed(exact)
          }
        )
        const firstProcess = yield* fixture.activate().pipe(Effect.forkScoped)
        expect(yield* Deferred.await(firstProcessResultAvailable)).toMatchObject({
          _tag: "Exact",
          report: { correlation: { attemptId: fixture.attempt.attemptId, runId: fixture.runId } }
        })
        yield* Fiber.interrupt(firstProcess)
        const firstRecords = yield* fixture.readRecords
        expect(firstRecords.filter(({ event }) => event._tag === "PlannedAttemptExecutorCommandIntended")).toHaveLength(
          1
        )
        expect(firstRecords.some(({ event }) => event._tag === "PlannedAttemptExecutorCommandProjectionObserved")).toBe(
          false
        )

        yield* fixture.activate().pipe(Effect.exit)
        const secondRecords = yield* fixture.readRecords
        expect(fixture.applicationBuilds()).toBe(2)
        expect(
          secondRecords.filter(({ event }) => event._tag === "PlannedAttemptExecutorCommandIntended")
        ).toHaveLength(1)
        expect(
          secondRecords.some(
            ({ event }) =>
              event._tag === "PlannedAttemptExecutorCommandProjectionObserved" &&
              event.observation._tag === "ExactExecutorReport" &&
              event.observation.report._tag === "Terminal" &&
              event.observation.report.correlation.runId === fixture.runId &&
              event.observation.report.correlation.attemptId === fixture.attempt.attemptId &&
              event.observation.report.result._tag === "Completed"
          )
        ).toBe(true)
        expect(yield* fixture.projectionCalls).toBe(2)
        expect(yield* fixture.commandCalls).toEqual([])
        expect(secondRecords.some(({ event }) => event._tag === "PlannedAttemptReplaced")).toBe(false)
        expect(secondRecords.some(({ event }) => event._tag === "TaskClaimReleased")).toBe(false)
        expect(secondRecords.some(({ event }) => event._tag === "PlannedAttemptExecutorWorkReported")).toBe(false)
      }).pipe(Effect.provide(nodeGitCommandLayer), Effect.provide(NodeServices.layer))
    )
)

const absentHistoryApplicationScenario = "establishes an absent Run before its first tracker read and activates it once"

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
        controlledFakePlannedAttemptExecutorLayer,
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
      const graphRead = makeTrackerGraphObservationOperation(OperationId.make("production-lost-claim-graph"), target)
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
      const acquireCalls = yield* Ref.make(0)
      const claimReads = yield* Ref.make(0)
      const nextOperation = yield* Ref.make(0)
      const trackerLayer = Layer.succeed(
        TrackerMutation,
        TrackerMutation.of({
          acquireTaskClaim: () => Ref.update(acquireCalls, (count) => count + 1).pipe(Effect.as(claim)),
          readTaskClaim: () => Ref.update(claimReads, (count) => count + 1).pipe(Effect.as(claim)),
          releaseTaskClaim: () => Effect.void
        })
      )
      const application = productionWorkflowInterpreterLayer(
        runId,
        GitCommonDirectoryTarget.make(`${directory}/.git`),
        productionIntegrationTarget(`${directory}/.git`),
        trackerLayer,
        controlledFakePlannedAttemptExecutorLayer,
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

      expect(yield* Ref.get(acquireCalls)).toBe(0)
      expect(yield* Ref.get(claimReads)).toBeGreaterThan(0)
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
        controlledFakePlannedAttemptExecutorLayer,
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
        controlledFakePlannedAttemptExecutorLayer,
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
        controlledFakePlannedAttemptExecutorLayer,
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
        controlledFakePlannedAttemptExecutorLayer,
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

it.effect("publishes each accepted executor report before continuing and stops after Terminal", () =>
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
        OperationId.make("production-observation"),
        trackerTarget,
        [claimOperation.acquisition.operationId],
        [plannedAttempt.taskId]
      )
      const plan = makeTaskAttemptPlanOperation({
        operationId: OperationId.make("production-plan"),
        plannedAttempt,
        predecessorOperationIds: [observation.operationId]
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
            command: "StartOrContinue",
            initiatedBy: { _tag: "DalphCoordinator" },
            occurrenceClassification: "InitiatedAction",
            ordinal: runningCommandOrdinal,
            plannedAttempt,
            version: workflowJournalEventVersion
          })
        )
        yield* journal.append(
          runId,
          plannedAttemptExecutorWorkReportedRecordKey(plannedAttempt.attemptId, runningOrdinal),
          PlannedAttemptExecutorWorkReportedEvent.make({
            ordinal: runningOrdinal,
            report: PlannedAttemptExecutorReport.cases.Running.make({ correlation }),
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
      const application = productionWorkflowInterpreterLayer(
        runId,
        GitCommonDirectoryTarget.make(`${directory}/.git`),
        continuationTarget,
        trackerLayer,
        controlledFakePlannedAttemptExecutorLayer,
        unavailableIntegratorCandidateProviderAuthority
      ).pipe(
        Layer.provide(
          Layer.succeed(
            TrackerGraphReader,
            TrackerGraphReader.of({
              read: () => Effect.succeed(currentSnapshot),
              readTaskWorkSpecification: () => Effect.succeed(currentSpecification)
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
      const failure = yield* activateExactRun.pipe(Effect.flip)
      expect(failure._tag).toBe("GitTargetLineageReadFailure")
      const failedRecords = yield* Effect.gen(function* () {
        return yield* (yield* JournalStore).read(runId)
      }).pipe(Effect.provide(sqliteJournalTestLayer({ filename })))
      const targetReadIntents = failedRecords.filter(
        ({ event }) => event._tag === "GitReadIntentRecorded" && event.operation._tag === "ReadTargetLineage"
      )
      expect(targetReadIntents).toHaveLength(1)
      expect(failedRecords.some(({ event }) => event._tag === "TargetLineageObserved")).toBe(false)

      yield* git.runInWorktree(directory, ["update-ref", continuationTarget.ref, plannedAttempt.baseSha])
      yield* activateExactRun
      const records = yield* Effect.gen(function* () {
        return yield* (yield* JournalStore).read(runId)
      }).pipe(Effect.provide(sqliteJournalTestLayer({ filename })))
      const originalTargetReadOperationId =
        targetReadIntents[0]?.event._tag === "GitReadIntentRecorded"
          ? targetReadIntents[0].event.operation.operationId
          : undefined
      expect(
        records.some(
          ({ event }) => event._tag === "TargetLineageObserved" && event.operationId === originalTargetReadOperationId
        )
      ).toBe(true)
      expect(records.findLast(({ event }) => event._tag === "PlannedAttemptExecutorWorkReported")?.event).toMatchObject(
        {
          _tag: "PlannedAttemptExecutorWorkReported",
          report: { _tag: "Terminal", correlation, result: { _tag: "Completed" } }
        }
      )
      expect(
        records.flatMap(({ event }) =>
          event._tag === "PlannedAttemptExecutorWorkReported"
            ? [{ ordinal: event.ordinal, report: event.report._tag }]
            : []
        )
      ).toEqual([
        { ordinal: 1, report: "Running" },
        { ordinal: 2, report: "Running" },
        { ordinal: 3, report: "Terminal" }
      ])
      const terminal = records.findLast(
        ({ event }) => event._tag === "PlannedAttemptExecutorWorkReported" && event.report._tag === "Terminal"
      )
      const stabilizationRead = records.findLast(({ event }) => event._tag === "TaskTrackerReadIntentRecorded")
      expect(terminal).toBeDefined()
      expect(stabilizationRead).toBeDefined()
      expect(terminal?.position).toBeLessThan(stabilizationRead?.position ?? JournalPosition.make(0))
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
        missingIntent,
        FixtureTarget.make("missing-observation-target")
      )
      yield* Effect.gen(function* () {
        const journal = yield* JournalStore
        const validObservation = makeTrackerGraphObservationOperation(
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
        controlledFakePlannedAttemptExecutorLayer,
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
          controlledFakePlannedAttemptExecutorLayer,
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
        controlledFakePlannedAttemptExecutorLayer,
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
        controlledFakePlannedAttemptExecutorLayer,
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
