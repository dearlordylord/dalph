// @effect-diagnostics multipleEffectProvide:off
import { remotePublicationTargetForTest } from "../../../orchestrator/test/support/direct-publication.js"
import { makeAcceptedIntegrationHistory } from "../../../orchestrator/test/support/accepted-integration-history.js"
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
  ApplicationExitShell,
  ActiveTaskClaim,
  AllocatedWorkflowRunId,
  ClaimOwner,
  ClaimToken,
  FixtureTarget,
  GitCommand,
  GitCommonDirectoryTarget,
  JournalDatabaseLocator,
  type JournalRecord,
  JournalPosition,
  JournaledRunBootstrap,
  JournalStore,
  IntegratorCandidateText,
  nodeGitCommandLayer,
  OperationId,
  OperationIdAllocator,
  PlannedTaskAttemptPlanner,
  projectTrackerSnapshot,
  reduceWorkflowJournalHistory,
  runWorkflow,
  sqliteJournalTestLayer,
  memoryJournalTestLayer,
  TaskClaimAcquisitionPlanner,
  TrackerGraphReader,
  TrackerMutation,
  RemotePublicationAttemptAuthorization,
  RemotePublicationAttemptOrdinal,
  RemotePublicationGit,
  RemotePublicationGitObservation,
  RemotePublicationAdmissionObservation,
  RemotePublicationResumeRequest,
  RemotePublicationResumeRequestId,
  IntegrationResponsibilityIdentity,
  RemotePublicationRetainedCause,
  RemotePublicationRetainedEvent,
  IntegratorCompetingHeadSuccessorAuthorizedEvent,
  integratorCompetingHeadSuccessorAuthorizationIdFor,
  integratorCorrelationFor,
  integratorRunCorrelationForSession,
  IntegratorGitObservation,
  IntegratorRunOrdinal,
  IntegratorRunQualifiedCandidate,
  IntegratorResult,
  LocalTargetCatchUpResult,
  RemoteBaselineGit,
  RemoteBaselineObservation,
  RemotePublicationAttemptIntendedEvent,
  RemotePublicationIntendedEvent,
  remotePublicationCorrelationFor,
  remotePublicationRefspecFor,
  workflowJournalEventVersion,
  WorkflowTrace,
  unavailableIntegratorCandidateProviderAuthority
} from "@dalph/orchestrator"
import { Cause, ConfigProvider, Effect, FileSystem, Layer, Option, Ref } from "effect"
import { expect } from "vitest"
import { controlledFakePlannedAttemptExecutorLayer } from "../../../orchestrator/test/controlled-planned-attempt-executor.js"
import { productionWorkflowInterpreterLayer } from "../../src/application/production.js"
import { describeJournalEvent } from "../../../orchestrator/src/workflow/registry/event-descriptor.js"
import { controlledSynchronousPlannedAttemptExecutorLayer } from "../../test-support/controlled-synchronous-planned-attempt-executor.js"
import {
  IntegratorRunCandidateGitObservedEvent,
  IntegratorRunCandidateGitReadIntendedEvent,
  IntegratorRunResultRecordedEvent,
  IntegratorRunStartedEvent,
  IntegratorSessionFixedEvent
} from "../../../orchestrator/src/workflow/protocols/integrator/events.js"

const productionControlledFakePlannedAttemptExecutorLayer = controlledSynchronousPlannedAttemptExecutorLayer(
  controlledFakePlannedAttemptExecutorLayer
)

const productionIntegrationTarget = (repository: string): IntegrationTarget =>
  IntegrationTarget.make({
    repository: GitRepositoryLocator.make(repository),
    ref: IntegrationTargetRef.make("refs/heads/master")
  })

type CompositionCase =
  | "Pause"
  | "Exit"
  | "ReceiptBeforeAuthorization"
  | "ReceiptAfterAuthorization"
  | "ReopenAfterReceipt"
  | "PauseAfterReceipt"
  | "ExitAfterReceipt"

const exerciseProductionAutomaticSuccessorLifecycleCut = (
  cutoff: CompositionCase,
  backend: "SQLite" | "Memory" = "SQLite"
) =>
  Effect.scoped(
    Effect.gen(function* () {
      const paused = cutoff.startsWith("Pause")
      const exiting = cutoff.startsWith("Exit")
      const continues = !paused && !exiting
      const receiptBeforeControl = cutoff === "PauseAfterReceipt" || cutoff === "ExitAfterReceipt"
      const fileSystem = yield* FileSystem.FileSystem
      const directory = yield* fileSystem.makeTempDirectoryScoped({
        prefix: `dalph-production-automatic-s2-${cutoff.toLowerCase()}-`
      })
      const git = yield* GitCommand
      yield* git.runInWorktree(directory, ["init"])
      yield* git.runInWorktree(directory, ["config", "user.email", "dalph@example.invalid"])
      yield* git.runInWorktree(directory, ["config", "user.name", "Dalph Test"])
      yield* fileSystem.writeFileString(`${directory}/README.md`, "automatic successor lifecycle cutoff\n")
      yield* git.runInWorktree(directory, ["add", "README.md"])
      yield* git.runInWorktree(directory, ["commit", "-m", "initial"])
      yield* git.runInWorktree(directory, ["branch", "-M", "master"])
      const baseSha = GitCommitSha.make((yield* git.runInWorktree(directory, ["rev-parse", "HEAD"])).stdout.trim())
      const worktree = WorktreeLocator.make(`${directory}/worktree`)
      const branch = TaskBranchRef.make(`refs/heads/dalph/automatic-s2-${cutoff.toLowerCase()}`)
      yield* git.runInWorktree(directory, [
        "worktree",
        "add",
        "-b",
        branch.slice("refs/heads/".length),
        worktree,
        baseSha
      ])
      yield* fileSystem.writeFileString(`${worktree}/accepted.txt`, "accepted result\n")
      yield* git.runInWorktree(worktree, ["add", "accepted.txt"])
      yield* git.runInWorktree(worktree, ["commit", "-m", "accepted task result"])
      const acceptedCommit = GitCommitSha.make(
        (yield* git.runInWorktree(worktree, ["rev-parse", "HEAD"])).stdout.trim()
      )
      const candidateCommit = GitCommitSha.make(
        (yield* git.runInWorktree(directory, [
          "commit-tree",
          `${acceptedCommit}^{tree}`,
          "-p",
          baseSha,
          "-p",
          acceptedCommit,
          "-m",
          "initial integrated candidate"
        ])).stdout.trim()
      )
      const competingHead = GitCommitSha.make(
        (yield* git.runInWorktree(directory, [
          "commit-tree",
          `${baseSha}^{tree}`,
          "-p",
          baseSha,
          "-m",
          "outside compatible remote advance"
        ])).stdout.trim()
      )

      const taskId = TaskId.make(`automatic-s2-${cutoff.toLowerCase()}`)
      const target = FixtureTarget.make(`automatic-s2-${cutoff.toLowerCase()}-target`)
      const runId = RunId.make(`automatic-s2-${cutoff.toLowerCase()}-run`)
      const specification = makeTaskWorkSpecification({
        body: "Publish the accepted result after compatible remote work.",
        taskId,
        title: "Recover publication"
      })
      const attempt = PlannedTaskAttempt.make({
        attemptId: AttemptId.make(`automatic-s2-${cutoff.toLowerCase()}-attempt`),
        baseSha,
        branch,
        executor: TaskExecutorLocator.make("executor:production-controlled-automatic-s2"),
        runId,
        taskId,
        taskRevision: specification.fingerprint,
        worktree
      })
      const claim = ActiveTaskClaim.make({
        operationId: OperationId.make(`automatic-s2-${cutoff.toLowerCase()}-claim`),
        owner: ClaimOwner.make("dalph"),
        taskId,
        token: ClaimToken.make(`automatic-s2-${cutoff.toLowerCase()}-token`)
      })
      const acceptedResult = AcceptedResult.make({
        commit: acceptedCommit,
        evidenceManifest: EvidenceReference.make({ byteLength: 1, digest: EvidenceDigest.make("c".repeat(64)) })
      })
      const integrationTarget = productionIntegrationTarget(`${directory}/.git`)
      const accepted = makeAcceptedIntegrationHistory({
        acceptedResult,
        activeClaim: claim,
        integrationTarget,
        plannedAttempt: attempt,
        runId,
        targetHeadSha: baseSha,
        taskSpecification: specification,
        trackerTarget: target
      })
      const predecessor = integratorCorrelationFor({
        responsibility: accepted.responsibility,
        targetLineage: accepted.targetLineage,
        targetLineageObservedAt: accepted.targetLineageObservedAt
      })
      const predecessorRun = integratorRunCorrelationForSession(predecessor, IntegratorRunOrdinal.make(1))
      const candidateText = IntegratorCandidateText.make(
        `refs/heads/dalph/automatic-s2-candidate-${cutoff.toLowerCase()}`
      )
      let records = [...accepted.records]
      const append = (event: JournalRecord["event"]): JournalRecord => {
        const record: JournalRecord = {
          event,
          key: describeJournalEvent(event).expectedKey,
          position: JournalPosition.make(records.length + 1),
          runId
        }
        records = [...records, record]
        return record
      }
      append(IntegratorSessionFixedEvent.make({ correlation: predecessor, version: workflowJournalEventVersion }))
      append(IntegratorRunStartedEvent.make({ run: predecessorRun, version: workflowJournalEventVersion }))
      append(
        IntegratorRunResultRecordedEvent.make({
          result: IntegratorResult.cases.PreparedCandidate.make({ candidateText, correlation: predecessorRun }),
          run: predecessorRun,
          version: workflowJournalEventVersion
        })
      )
      append(
        IntegratorRunCandidateGitReadIntendedEvent.make({
          candidateText,
          run: predecessorRun,
          version: workflowJournalEventVersion
        })
      )
      const candidateObserved = append(
        IntegratorRunCandidateGitObservedEvent.make({
          candidateText,
          observation: IntegratorGitObservation.cases.Commit.make({
            candidateText,
            commit: candidateCommit,
            directParents: [baseSha, acceptedCommit]
          }),
          run: predecessorRun,
          version: workflowJournalEventVersion
        })
      )
      const qualifiedCandidate = IntegratorRunQualifiedCandidate.make({
        candidateCommit,
        candidateText,
        directParents: [baseSha, acceptedCommit],
        qualifiedAt: candidateObserved.position,
        run: predecessorRun
      })
      const publication = remotePublicationCorrelationFor(qualifiedCandidate, remotePublicationTargetForTest)
      append(
        RemotePublicationIntendedEvent.make({
          correlation: publication,
          initiatedBy: { _tag: "DalphCoordinator" },
          occurrenceClassification: "InitiatedAction",
          version: workflowJournalEventVersion
        })
      )
      append(
        RemotePublicationAttemptIntendedEvent.make({
          attemptOrdinal: RemotePublicationAttemptOrdinal.make(1),
          correlation: publication,
          initiatedBy: { _tag: "DalphCoordinator" },
          occurrenceClassification: "InitiatedAction",
          refspec: remotePublicationRefspecFor(candidateCommit, publication.target.branch),
          version: workflowJournalEventVersion
        })
      )
      const retained = append(
        RemotePublicationRetainedEvent.make({
          authorization: RemotePublicationAttemptAuthorization.cases.InitialAttempt.make({}),
          cause: RemotePublicationRetainedCause.cases.CompatibleCompetingHead.make({
            mergeBase: baseSha,
            remoteHead: competingHead
          }),
          correlation: publication,
          occurrenceClassification: "NonActionOccurrence",
          version: workflowJournalEventVersion
        })
      )
      const authorization = append(
        IntegratorCompetingHeadSuccessorAuthorizedEvent.make({
          authorizationId: integratorCompetingHeadSuccessorAuthorizationIdFor(
            publication.requestId,
            retained.position,
            baseSha,
            competingHead
          ),
          correlation: publication,
          initiatedBy: { _tag: "DalphCoordinator" },
          mergeBase: baseSha,
          occurrenceClassification: "InitiatedAction",
          remoteHead: competingHead,
          remotePublicationRetainedAt: retained.position,
          version: workflowJournalEventVersion
        })
      )
      const authorizedRecords = cutoff === "ReceiptBeforeAuthorization" ? records.slice(0, -1) : [...records]
      const resumeRequest = RemotePublicationResumeRequest.make({
        requestId: RemotePublicationResumeRequestId.make(`composition-${cutoff}`),
        responsibility: IntegrationResponsibilityIdentity.make({ queuedAt: accepted.responsibility.queuedAt, runId }),
        runId,
        schemaVersion: 1
      })
      const validPrefix = reduceWorkflowJournalHistory(runId, authorizedRecords)
      if (validPrefix._tag === "InvalidWorkflowJournalHistory") {
        return yield* Effect.die(
          `automatic S2 lifecycle fixture must be reducer-accepted: ${JSON.stringify(validPrefix.issues)}`
        )
      }

      const filename = JournalDatabaseLocator.make(`${directory}/journal.sqlite`)
      const storeLayer =
        backend === "Memory"
          ? Layer.succeedContext(yield* Layer.build(memoryJournalTestLayer))
          : sqliteJournalTestLayer({ filename })
      const applicationStoreScopeEvents = yield* Ref.make<ReadonlyArray<string>>([])
      const applicationStoreOpenCount = yield* Ref.make(0)
      const applicationStoreLayer =
        cutoff === "ReopenAfterReceipt" && backend === "SQLite"
          ? Layer.tap(storeLayer, () =>
              Ref.getAndUpdate(applicationStoreOpenCount, (count) => count + 1).pipe(
                Effect.flatMap((previousCount) =>
                  Ref.update(applicationStoreScopeEvents, (events) => [
                    ...events,
                    `journal-store-opened-${previousCount + 1}`
                  ])
                )
              )
            )
          : storeLayer
      yield* Effect.gen(function* () {
        const journal = yield* JournalStore
        const began = authorizedRecords[0]
        if (began?.event._tag !== "WorkflowRunBegan") return yield* Effect.die("automatic S2 fixture lacks Run begin")
        yield* journal.beginRun(
          runId,
          target,
          began.event.initialControlPolicy,
          began.event.remotePublicationTarget,
          began.event.attemptBasePolicy
        )
        for (const record of authorizedRecords.slice(1)) {
          if (record.event._tag === "WorkflowRunBegan" || record.event._tag === "WorkflowRunTerminated") {
            return yield* Effect.die("automatic S2 fixture contains an invalid Run lifecycle suffix")
          }
          yield* journal.append(runId, record.key, record.event)
        }
      }).pipe(Effect.provide(storeLayer))

      const graph = projectTrackerSnapshot({
        revision: `automatic-s2-${cutoff.toLowerCase()}-current`,
        tasks: [{ id: taskId, lifecycle: { _tag: "Open" }, parentTaskId: null, prerequisiteIds: [] }]
      })
      if (graph._tag === "Invalid") return yield* Effect.die("automatic S2 lifecycle tracker graph must be valid")
      const gitCalls = yield* Ref.make<ReadonlyArray<string>>([])
      const baselineCalls = yield* Ref.make<ReadonlyArray<string>>([])
      const remotePublicationCalls = yield* Ref.make<ReadonlyArray<string>>([])
      const trackerMutationCalls = yield* Ref.make<ReadonlyArray<string>>([])
      const integratorCalls = yield* Ref.make(0)
      const baselineGitLayer = Layer.succeed(
        RemoteBaselineGit,
        RemoteBaselineGit.of({
          observe: () =>
            Effect.gen(function* () {
              yield* Ref.update(baselineCalls, (calls) => [...calls, "observe"])
              const head = GitCommitSha.make(
                (yield* git
                  .runInWorktree(directory, ["rev-parse", "refs/heads/master"])
                  .pipe(Effect.orDie)).stdout.trim()
              )
              return head === competingHead
                ? RemoteBaselineObservation.cases.Aligned.make({ localHead: head, remoteHead: head })
                : RemoteBaselineObservation.cases.LocalAncestor.make({ localHead: head, remoteHead: competingHead })
            }),
          catchUp: () =>
            Ref.update(baselineCalls, (calls) => [...calls, "catchUp"]).pipe(
              Effect.andThen(
                git
                  .runInWorktree(directory, ["update-ref", "refs/heads/master", competingHead, baseSha])
                  .pipe(Effect.orDie)
              ),
              Effect.as(LocalTargetCatchUpResult.cases.Applied.make({ newHead: competingHead }))
            ),
          reconcileCatchUp: () =>
            Ref.update(baselineCalls, (calls) => [...calls, "reconcileCatchUp"]).pipe(
              Effect.as(LocalTargetCatchUpResult.cases.Applied.make({ newHead: competingHead }))
            )
        })
      )
      const forbiddenPublicationBoundary = (name: string) =>
        Ref.update(remotePublicationCalls, (calls) => [...calls, name]).pipe(
          Effect.andThen(Effect.die(`remote publication ${name} must not start after ${cutoff}`))
        )
      const publicationGitLayer = Layer.succeed(
        RemotePublicationGit,
        RemotePublicationGit.of({
          admit: () =>
            continues
              ? Effect.succeed(
                  RemotePublicationAdmissionObservation.cases.ExistingBranch.make({ remoteHead: competingHead })
                )
              : forbiddenPublicationBoundary("admit"),
          observe: () =>
            continues
              ? Ref.update(remotePublicationCalls, (calls) => [...calls, "observe"]).pipe(
                  Effect.as(
                    RemotePublicationGitObservation.cases.CompatibleCompetingHead.make({
                      mergeBase: baseSha,
                      remoteHead: competingHead
                    })
                  )
                )
              : forbiddenPublicationBoundary("observe"),
          prepareSenderCustody: () => forbiddenPublicationBoundary("prepareSenderCustody"),
          reconcileSenderCustody: () =>
            continues
              ? Ref.update(remotePublicationCalls, (calls) => [...calls, "reconcileSenderCustody"])
              : forbiddenPublicationBoundary("reconcileSenderCustody"),
          push: () => forbiddenPublicationBoundary("push")
        })
      )
      const trackerMutationLayer = Layer.succeed(
        TrackerMutation,
        TrackerMutation.of({
          acquireTaskClaim: () =>
            Ref.update(trackerMutationCalls, (calls) => [...calls, "acquireTaskClaim"]).pipe(
              Effect.andThen(Effect.die(`claim mutation must not start after ${cutoff}`))
            ),
          readTaskClaim: () =>
            continues
              ? Effect.succeed(claim)
              : Ref.update(trackerMutationCalls, (calls) => [...calls, "readTaskClaim"]).pipe(
                  Effect.andThen(Effect.die(`claim read must not start after ${cutoff}`))
                ),
          releaseTaskClaim: () =>
            Ref.update(trackerMutationCalls, (calls) => [...calls, "releaseTaskClaim"]).pipe(
              Effect.andThen(Effect.die(`claim release must not start after ${cutoff}`))
            )
        })
      )
      const application = productionWorkflowInterpreterLayer(
        runId,
        GitCommonDirectoryTarget.make(`${directory}/.git`),
        GitRepositoryLocator.make(directory),
        integrationTarget,
        trackerMutationLayer,
        productionControlledFakePlannedAttemptExecutorLayer,
        unavailableIntegratorCandidateProviderAuthority,
        {
          journalStoreLayer: applicationStoreLayer,
          targetPromotion: {
            git: {
              compareAndSet: () => Effect.die("successor fixture must stop before promotion"),
              read: () => Effect.die("successor fixture must stop before promotion")
            }
          },
          remoteBaselineGitLayer: baselineGitLayer,
          remotePublicationGitLayer: publicationGitLayer,
          remotePublicationTarget: remotePublicationTargetForTest,
          integrator: {
            prepare: () =>
              Ref.update(integratorCalls, (count) => count + 1).pipe(
                Effect.andThen(
                  continues
                    ? Effect.die("controlled process stop after successor fixation")
                    : Effect.die(`successor Integrator provider must not start after ${cutoff}`)
                )
              )
          },
          workflowGitCommandObserver: (boundary) => Ref.update(gitCalls, (calls) => [...calls, boundary])
        }
      ).pipe(
        Layer.provide(
          Layer.succeed(
            TrackerGraphReader,
            TrackerGraphReader.of({
              read: () => Effect.succeed(graph.snapshot),
              readTaskWorkSpecification: () => Effect.succeed(specification)
            })
          )
        ),
        Layer.provide(Layer.succeed(WorkflowTrace, WorkflowTrace.of({ emit: () => Effect.void })))
      )
      const nextOperation = yield* Ref.make(0)
      const run = runWorkflow(
        target,
        Effect.die("retained history supplies the initial control policy"),
        AllocatedWorkflowRunId.make(runId)
      ).pipe(
        Effect.provideService(
          OperationIdAllocator,
          OperationIdAllocator.of({
            allocate: () =>
              Ref.getAndUpdate(nextOperation, (value) => value + 1).pipe(
                Effect.map((value) => OperationId.make(`automatic-s2-${cutoff.toLowerCase()}-${value}`))
              )
          })
        ),
        Effect.provideService(
          TaskClaimAcquisitionPlanner,
          TaskClaimAcquisitionPlanner.of({ plan: () => Effect.die(`automatic S2 ${cutoff} must not claim fresh work`) })
        ),
        Effect.provideService(
          PlannedTaskAttemptPlanner,
          PlannedTaskAttemptPlanner.of({ plan: () => Effect.die(`automatic S2 ${cutoff} must not plan fresh work`) })
        )
      )
      // `local: true` gives each application phase its own layer memo map and
      // closes that phase's scope before the effect returns.
      const provideApplication = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
        effect.pipe(
          Effect.provide(application, { local: cutoff === "ReopenAfterReceipt" }),
          Effect.provide(ConfigProvider.layer(ConfigProvider.fromUnknown({ DALPH_JOURNAL_DATABASE: filename })))
        )
      if (cutoff === "ReopenAfterReceipt") {
        yield* Effect.gen(function* () {
          const bootstrap = yield* JournaledRunBootstrap
          yield* bootstrap.operatorControl.applyRemotePublicationResume(resumeRequest)
        }).pipe(provideApplication)
        // The receipt application scope and its SQLite client are closed before
        // the activation application is built below.
        yield* Ref.update(applicationStoreScopeEvents, (events) => [...events, "receipt-application-scope-closed"])
      }
      const activationExit = yield* Effect.gen(function* () {
        const bootstrap = yield* JournaledRunBootstrap
        const exitShell = yield* ApplicationExitShell
        if (receiptBeforeControl) {
          const receipt = yield* bootstrap.operatorControl.applyRemotePublicationResume(resumeRequest)
          expect(yield* bootstrap.operatorControl.applyRemotePublicationResume(resumeRequest)).toEqual(receipt)
        }
        if (paused) {
          yield* bootstrap.operatorControl.applyControlDirection({
            direction: "Pause",
            subject: { _tag: "Run", runId }
          })
        } else if (exiting) {
          expect(yield* exitShell.requestBoundary.requestExit).toMatchObject({ _tag: "Succeeded", requestedStatus: 0 })
        }
        if (continues) {
          const receipt = yield* bootstrap.operatorControl.applyRemotePublicationResume(resumeRequest)
          expect(yield* bootstrap.operatorControl.applyRemotePublicationResume(resumeRequest)).toEqual(receipt)
        }
        let result = yield* Effect.exit(run)
        if (continues) {
          // The production baseline protocol deliberately admits one Git boundary
          // per activation. The host may activate again after accepted progress.
          const maximumActivations = 6
          for (let activation = 1; activation < maximumActivations && result._tag === "Success"; activation++) {
            result = yield* Effect.exit(run)
          }
        }
        return result
      }).pipe(
        Effect.provide(application, { local: cutoff === "ReopenAfterReceipt" }),
        Effect.provide(ConfigProvider.layer(ConfigProvider.fromUnknown({ DALPH_JOURNAL_DATABASE: filename })))
      )
      if (cutoff === "ReopenAfterReceipt") {
        yield* Ref.update(applicationStoreScopeEvents, (events) => [...events, "activation-application-scope-closed"])
      }

      if (continues) {
        expect(activationExit._tag).toBe("Failure")
        if (activationExit._tag === "Failure") {
          expect(Cause.pretty(activationExit.cause)).toContain("controlled process stop after successor fixation")
        }
      } else if (paused) {
        expect(activationExit._tag).toBe("Success")
        if (activationExit._tag === "Success") expect(activationExit.value._tag).toBe("RunMustRemainActive")
      } else {
        expect(activationExit._tag).toBe("Failure")
        if (activationExit._tag === "Failure") {
          expect(Option.getOrUndefined(Cause.findErrorOption(activationExit.cause))).toMatchObject({
            _tag: "ApplicationExiting"
          })
        }
      }

      const after = yield* Effect.gen(function* () {
        return yield* (yield* JournalStore).read(runId)
      }).pipe(Effect.provide(storeLayer))
      if (continues) {
        expect(after.slice(0, authorizedRecords.length)).toEqual(authorizedRecords)
        const authorizations = after.filter(({ event }) => event._tag === "IntegratorCompetingHeadSuccessorAuthorized")
        expect(
          authorizations,
          JSON.stringify({
            exit: activationExit,
            events: after.slice(authorizedRecords.length).map(({ event }) => event._tag)
          })
        ).toHaveLength(1)
        if (cutoff !== "ReceiptBeforeAuthorization") expect(authorizations).toEqual([authorization])
        const successors = after.filter(({ event }) => event._tag === "IntegratorAutomaticSuccessorSessionFixed")
        expect(
          successors,
          JSON.stringify({
            exit: activationExit,
            events: after.slice(authorizedRecords.length).map(({ event }) => event._tag)
          })
        ).toHaveLength(1)
        expect(successors[0]?.event).toMatchObject({
          authorizationAt: authorizations[0]?.position,
          predecessor,
          successor: {
            acceptedResult,
            expectedTargetHead: competingHead,
            plannedAttempt: attempt,
            integrationTarget,
            queuedAt: accepted.responsibility.queuedAt,
            startedAt: accepted.responsibility.startedAt
          }
        })
        expect(after.filter(({ event }) => event._tag === "RemotePublicationResumeRequested")).toHaveLength(1)
        expect(
          after.filter(({ event }) => event._tag === "PlannedAttemptExecutorWorkResponsibilityBegan")
        ).toHaveLength(
          authorizedRecords.filter(({ event }) => event._tag === "PlannedAttemptExecutorWorkResponsibilityBegan").length
        )
        expect(yield* Ref.get(integratorCalls)).toBe(1)
        expect(yield* Ref.get(remotePublicationCalls)).toEqual(["reconcileSenderCustody", "observe"])
        // Reopen and replay the exact receipt after S2 was fixed. No new record,
        // authorization, publication call, or successor is permitted.
        yield* Effect.gen(function* () {
          yield* (yield* JournaledRunBootstrap).operatorControl.applyRemotePublicationResume(resumeRequest)
        }).pipe(provideApplication)
        yield* Ref.update(applicationStoreScopeEvents, (events) => [...events, "replay-application-scope-closed"])
        const replayed = yield* Effect.gen(function* () {
          return yield* (yield* JournalStore).read(runId)
        }).pipe(Effect.provide(storeLayer))
        expect(replayed).toEqual(after)
        if (cutoff === "ReopenAfterReceipt" && backend === "SQLite") {
          expect(yield* Ref.get(applicationStoreScopeEvents)).toEqual([
            "journal-store-opened-1",
            "receipt-application-scope-closed",
            "journal-store-opened-2",
            "activation-application-scope-closed",
            "journal-store-opened-3",
            "replay-application-scope-closed"
          ])
        }
        return
      }
      expect(after.slice(0, authorizedRecords.length)).toEqual(authorizedRecords)
      expect(after.filter(({ event }) => event._tag === "IntegratorCompetingHeadSuccessorAuthorized")).toEqual([
        authorization
      ])
      if (authorization.event._tag !== "IntegratorCompetingHeadSuccessorAuthorized") {
        return yield* Effect.die("automatic S2 lifecycle fixture lost its exact authorization record")
      }
      expect(authorization.event.correlation.qualifiedCandidate.run.session).toMatchObject({
        acceptedResult,
        expectedTargetHead: baseSha,
        plannedAttempt: attempt,
        queuedAt: accepted.responsibility.queuedAt,
        startedAt: accepted.responsibility.startedAt
      })
      if (paused) {
        expect(after.slice(authorizedRecords.length).map(({ event }) => event)).toEqual([
          ...(receiptBeforeControl
            ? [expect.objectContaining({ _tag: "RemotePublicationResumeRequested", request: resumeRequest })]
            : []),
          expect.objectContaining({
            _tag: "ControlDirectionApplied",
            direction: "Pause",
            subject: { _tag: "Run", runId }
          })
        ])
      } else {
        if (receiptBeforeControl) {
          expect(after.slice(authorizedRecords.length).map(({ event }) => event)).toEqual([
            expect.objectContaining({ _tag: "RemotePublicationResumeRequested", request: resumeRequest })
          ])
        } else expect(after).toEqual(authorizedRecords)
      }
      expect(after.filter(({ event }) => event._tag === "RemoteBaselineReadIntended")).toHaveLength(0)
      expect(after.filter(({ event }) => event._tag === "LocalTargetCatchUpIntended")).toHaveLength(0)
      expect(after.filter(({ event }) => event._tag === "IntegratorAutomaticSuccessorSessionFixed")).toHaveLength(0)
      expect(after.filter(({ event }) => event._tag === "RemotePublicationSucceeded")).toHaveLength(0)
      expect(after.filter(({ event }) => event._tag.startsWith("TargetPromotion"))).toHaveLength(0)
      expect(after.filter(({ event }) => event._tag.startsWith("CompletionClaim"))).toHaveLength(0)
      expect(yield* Ref.get(baselineCalls), cutoff).toEqual([])
      expect(yield* Ref.get(remotePublicationCalls), cutoff).toEqual([])
      expect(yield* Ref.get(gitCalls), cutoff).toEqual([])
      expect(yield* Ref.get(trackerMutationCalls), cutoff).toEqual([])
      expect(yield* Ref.get(integratorCalls), cutoff).toBe(0)
      expect(yield* fileSystem.exists(`${directory}/.git/dalph/git-senders`), cutoff).toBe(false)
    }).pipe(Effect.provide(nodeGitCommandLayer), Effect.provide(NodeServices.layer))
  )

it.effect("Pause after automatic S2 authorization retains FIFO without baseline or successor effects", () =>
  exerciseProductionAutomaticSuccessorLifecycleCut("Pause")
)

it.effect("Exit at automatic S2 authorization preserves the cutoff without starting a successor", () =>
  exerciseProductionAutomaticSuccessorLifecycleCut("Exit")
)

for (const backend of ["Memory", "SQLite"] as const) {
  for (const scenario of [
    "ReceiptBeforeAuthorization",
    "ReceiptAfterAuthorization",
    "ReopenAfterReceipt",
    "PauseAfterReceipt",
    "ExitAfterReceipt"
  ] as const) {
    it.effect(`composes ${scenario} through production continuation and exact replay in ${backend}`, () =>
      exerciseProductionAutomaticSuccessorLifecycleCut(scenario, backend)
    )
  }
}
