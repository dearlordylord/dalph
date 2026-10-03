import { GitCommitSha, RemotePublicationTarget, RemotePublicationEndpoint } from "@dalph/contracts"
import {
  GitCommand,
  GithubGraphqlClient,
  GithubIssueNodeId,
  JournalStore,
  attachCurrentSignal,
  githubTaskIdFor,
  nodeGitCommandLayer,
  sqliteJournalStoreLayer,
  type DeliveryRuntimeReadyObservation,
  type GithubGraphqlRequest
} from "@dalph/orchestrator"
import { NodeCrypto, NodeServices } from "@effect/platform-node"
import { it } from "@effect/vitest"
// eslint-disable-next-line import/no-nodejs-modules -- The production fixture records a local executable locator.
import { fileURLToPath } from "node:url"
import { Context, Deferred, Effect, Fiber, FileSystem, Layer, Option, Ref, Stream } from "effect"
import { expect } from "vitest"
import {
  productionRepositoryHostGraph,
  withDecodedProductionRepositoryHost,
  type ProductionHostObservation
} from "./production-host.js"
import { CodexAppServer, CodexThreadListSummary, type CodexThreadSnapshot } from "./codex-app-server.js"
import type { CodexTurnId } from "./codex-attempt-store.js"
import { makeHermeticProviderState } from "../../test-support/production-hermetic-provider-state.js"
import { createHermeticFixture } from "../../test-support/production-hermetic-fixture.js"
import { projectRecordedCassette, verifyRecordedCassetteRoundTrip } from "../cassettes/recorded.js"
import { ProductionRepositoryHostConfiguration } from "./production-configuration.js"
import { hermeticQualificationTrackerIdentity } from "./production-hermetic-contract.js"

// The fixture records this entry in its manifest; this test invokes the source host in-process.
const builtEntry = fileURLToPath(new URL("../../dist/bin/dalph.js", import.meta.url))
const sourceBaseSha = GitCommitSha.make("e73348030ad88d27f09ce838d3b33045e1f5e9de")
const fixtureLayer = nodeGitCommandLayer.pipe(Layer.provideMerge(NodeServices.layer), Layer.merge(NodeCrypto.layer))

const providerBodyFor = (request: GithubGraphqlRequest) => {
  if (request._tag === "ResolveIssue") {
    return {
      query: "query ResolveIssue($fixture: String!) { fixture }",
      variables: {
        owner: request.target.owner,
        repository: request.target.repository,
        issueNumber: request.target.issueNumber
      }
    }
  }
  const { _tag, ...variables } = request
  return { query: `query ${_tag}($fixture: String!) { fixture }`, variables }
}

const awaitReady = (
  observation: ProductionHostObservation,
  predicate: (state: DeliveryRuntimeReadyObservation) => boolean
) =>
  Effect.scoped(
    Effect.gen(function* () {
      const attached = yield* attachCurrentSignal(observation.current)
      if (attached.current._tag === "Ready" && predicate(attached.current)) return attached.current
      return Option.getOrThrow(
        yield* attached.changes.pipe(
          Stream.filter(
            (state): state is DeliveryRuntimeReadyObservation => state._tag === "Ready" && predicate(state)
          ),
          Stream.runHead
        )
      )
    })
  ).pipe(Effect.timeout("20 seconds"))

const snapshotOf = (state: DeliveryRuntimeReadyObservation) => {
  const graph = state.evaluation.current.trackerGraph
  if (graph._tag !== "GraphEstablished") return expect.fail("expected an accepted complete graph")
  return graph.observation.snapshot
}

it.live(
  "settles Alice's changing graph as Blocked while retaining A at capacity one",
  () =>
    Effect.scoped(
      Effect.gen(function* () {
        const fileSystem = yield* FileSystem.FileSystem
        const git = yield* GitCommand
        const fixture = yield* createHermeticFixture(builtEntry, sourceBaseSha)
        const remoteRepository = `${fixture.container}/remote.git`
        expect(
          (yield* git.runInWorktree(fixture.configuration.repository, [
            "clone",
            "--bare",
            fixture.configuration.repository,
            remoteRepository
          ])).exitCode
        ).toBe(0)
        const configuration = ProductionRepositoryHostConfiguration.make({
          ...fixture.configuration,
          remotePublicationTarget: RemotePublicationTarget.make({
            endpoint: RemotePublicationEndpoint.make(remoteRepository),
            branch: fixture.configuration.remotePublicationTarget.branch
          })
        })
        yield* Effect.addFinalizer(() =>
          fileSystem.remove(fixture.container, { force: true, recursive: true }).pipe(Effect.orDie)
        )
        const turnEntered = yield* Deferred.make<void>()
        const turnCompletedHint = yield* Deferred.make<void>()
        const turnTerminalVisible = yield* Ref.make(false)
        const completionEntered = yield* Deferred.make<void>()
        const releaseCompletion = yield* Deferred.make<void>()
        yield* Effect.addFinalizer(() =>
          Effect.all([
            Deferred.succeed(turnCompletedHint, undefined),
            Deferred.succeed(releaseCompletion, undefined)
          ]).pipe(Effect.asVoid)
        )
        const provider = yield* makeHermeticProviderState(
          configuration,
          (boundary) =>
            boundary._tag === "CompletionResponse"
              ? Deferred.succeed(completionEntered, undefined).pipe(Effect.andThen(Deferred.await(releaseCompletion)))
              : Effect.void,
          fixture.manifest.invocationId
        )
        const maskThread = (thread: CodexThreadSnapshot, visible: boolean): CodexThreadSnapshot =>
          visible
            ? thread
            : {
                ...thread,
                status: "active" as const,
                turns: thread.turns.map((turn) => ({ ...turn, status: "inProgress" as const }))
              }
        const codex = CodexAppServer.of({
          ...provider.codex,
          unattendedPolicyAdmission: Effect.void,
          attachTurnCompletedHints: Effect.succeed(Stream.empty),
          attachExactTurnCompletedHints: (threadId, expectedTurnId) =>
            Effect.gen(function* () {
              const expected = yield* Deferred.make<CodexTurnId>()
              if (expectedTurnId !== undefined) yield* Deferred.succeed(expected, expectedTurnId)
              return {
                expectTurnId: (turnId: CodexTurnId) => Deferred.succeed(expected, turnId).pipe(Effect.asVoid),
                hints: Stream.fromEffect(
                  Deferred.await(turnCompletedHint).pipe(
                    Effect.andThen(Deferred.await(expected)),
                    Effect.map((turnId) => ({ threadId, turnId }))
                  )
                )
              }
            }),
          listThreads: () =>
            (provider.codex.listThreads ?? (() => Effect.die("fixture requires thread listing")))().pipe(
              Effect.zip(Ref.get(turnTerminalVisible)),
              Effect.map(([threads, visible]) =>
                visible
                  ? threads
                  : threads.map((thread) =>
                      thread._tag === "CompleteSummary"
                        ? CodexThreadListSummary.CompleteSummary({
                            ...thread,
                            summary: {
                              status: "active",
                              turns: thread.summary.turns.map((turn) => ({ ...turn, status: "inProgress" as const }))
                            }
                          })
                        : thread
                    )
              )
            ),
          readThread: (id) =>
            provider.codex
              .readThread(id)
              .pipe(
                Effect.flatMap((thread) =>
                  Ref.get(turnTerminalVisible).pipe(Effect.map((visible) => maskThread(thread, visible)))
                )
              ),
          resumeThread: (id, cwd) =>
            provider.codex
              .resumeThread(id, cwd)
              .pipe(
                Effect.flatMap((thread) =>
                  Ref.get(turnTerminalVisible).pipe(Effect.map((visible) => maskThread(thread, visible)))
                )
              ),
          startTurn: (...args) =>
            provider.codex.startTurn(...args).pipe(
              Effect.tap(() => Deferred.succeed(turnEntered, undefined)),
              Effect.flatMap((turn) =>
                Ref.get(turnTerminalVisible).pipe(
                  Effect.map((visible) => (visible ? turn : { ...turn, status: "inProgress" as const }))
                )
              )
            )
        })
        const graphPhase = yield* Ref.make<"Initial" | "Expanded" | "Settled">("Initial")
        const changedGraphReads = yield* Ref.make(0)
        const changedGraphReadEntered = yield* Deferred.make<void>()
        const forbiddenChildWorkReads = yield* Ref.make<ReadonlyArray<string>>([])
        const rootNodeId = hermeticQualificationTrackerIdentity.issueNodeId
        const repositoryNodeId = hermeticQualificationTrackerIdentity.repositoryNodeId
        const childNodeId = GithubIssueNodeId.make("changing-graph-child")
        const blockerNodeId = GithubIssueNodeId.make("changing-graph-blocker")
        const independentNodeId = GithubIssueNodeId.make("changing-graph-independent")
        const rootTaskId = githubTaskIdFor(repositoryNodeId, rootNodeId)
        const childTaskId = githubTaskIdFor(repositoryNodeId, childNodeId)
        const blockerTaskId = githubTaskIdFor(repositoryNodeId, blockerNodeId)
        const independentTaskId = githubTaskIdFor(repositoryNodeId, independentNodeId)
        const delegateGithub = (request: GithubGraphqlRequest) =>
          provider.github(providerBodyFor(request)).pipe(
            Effect.orDie,
            Effect.flatMap((response) =>
              response.status === 200
                ? Effect.succeed({ body: response.body })
                : Effect.die(`controlled GitHub provider returned HTTP ${response.status}`)
            )
          )
        const connection = (
          issueNodeId: GithubIssueNodeId,
          field: "blockedBy" | "subIssues",
          ids: ReadonlyArray<GithubIssueNodeId>
        ) => ({
          body: {
            data: {
              node: {
                __typename: "Issue",
                id: issueNodeId,
                [field]: { nodes: ids.map((id) => ({ id })), pageInfo: { endCursor: null, hasNextPage: false } }
              }
            }
          }
        })
        const github = GithubGraphqlClient.of({
          execute: (request: GithubGraphqlRequest) =>
            Effect.gen(function* () {
              const phase = yield* Ref.get(graphPhase)
              if (phase === "Initial") {
                if (request._tag === "ReadSubIssues") return connection(request.issueNodeId, "subIssues", [])
                return yield* delegateGithub(request)
              }
              if (request._tag === "ReadSubIssues") {
                if (request.issueNodeId === rootNodeId) {
                  yield* Ref.update(changedGraphReads, (current) => current + 1)
                  yield* Deferred.succeed(changedGraphReadEntered, undefined)
                  return connection(rootNodeId, "subIssues", [childNodeId, independentNodeId])
                }
                return connection(request.issueNodeId, "subIssues", [])
              }
              if (request._tag === "ReadBlockedBy") {
                return connection(
                  request.issueNodeId,
                  "blockedBy",
                  request.issueNodeId === childNodeId ? [blockerNodeId] : []
                )
              }
              if (request._tag === "ReadIssue" && request.issueNodeId !== rootNodeId) {
                const isChild = request.issueNodeId === childNodeId
                const isIndependent = request.issueNodeId === independentNodeId
                if (!isChild && !isIndependent && request.issueNodeId !== blockerNodeId) {
                  return yield* Effect.die(`unexpected changing-graph issue ${request.issueNodeId}`)
                }
                return {
                  body: {
                    data: {
                      node: {
                        __typename: "Issue",
                        id: request.issueNodeId,
                        parent: isChild || isIndependent ? { id: rootNodeId } : null,
                        repository: { id: repositoryNodeId },
                        state: isChild || (isIndependent && phase === "Expanded") ? "OPEN" : "CLOSED",
                        stateReason: isChild || (isIndependent && phase === "Expanded") ? null : "NOT_PLANNED"
                      }
                    }
                  }
                }
              }
              if (request._tag === "ReadTaskWorkSpecification" && request.issueNodeId !== rootNodeId) {
                yield* Ref.update(forbiddenChildWorkReads, (current) => [
                  ...current,
                  `${request._tag}:${request.issueNodeId}`
                ])
                return yield* Effect.die("blocked or terminal task reached a work-specification read")
              }
              return yield* delegateGithub(request)
            })
        })
        const failures = yield* Ref.make<ReadonlyArray<unknown>>([])
        const graph = productionRepositoryHostGraph({
          githubRequestCircuitMaxRequests: 2_000,
          onActivationFailure: (failure) => Ref.update(failures, (current) => [...current, failure]),
          codexAppServer: () =>
            Layer.effect(
              CodexAppServer,
              Effect.addFinalizer(() => provider.codex.close.pipe(Effect.orDie)).pipe(Effect.as(codex))
            ),
          githubClient: () => Layer.succeed(GithubGraphqlClient, github)
        })
        const observationReady = yield* Deferred.make<ProductionHostObservation>()
        const releaseHost = yield* Deferred.make<void>()
        const hostFiber = yield* withDecodedProductionRepositoryHost(configuration, graph, (observation) =>
          Deferred.succeed(observationReady, observation).pipe(Effect.andThen(Deferred.await(releaseHost)))
        ).pipe(Effect.forkScoped)
        const observation = yield* Deferred.await(observationReady).pipe(
          Effect.raceFirst(Fiber.join(hostFiber).pipe(Effect.andThen(Effect.die("host closed before observation")))),
          Effect.timeout("20 seconds")
        )
        yield* Deferred.await(turnEntered).pipe(Effect.timeout("20 seconds"))
        const executingHistory = yield* Effect.scoped(
          Effect.gen(function* () {
            const history = yield* attachCurrentSignal(observation.acceptedHistory)
            const current = yield* observation.traceReader.readAt(history.current)
            const executing = (view: typeof current) =>
              view.items.some(
                ({ occurrence }) =>
                  occurrence._tag === "PlannedAttemptExecutorWorkReported" &&
                  occurrence.report._tag === "ExecutorWorkExecuting"
              )
            if (executing(current)) return current
            return Option.getOrThrow(
              yield* history.changes.pipe(
                Stream.mapEffect((cursor) => observation.traceReader.readAt(cursor)),
                Stream.filter(executing),
                Stream.runHead
              )
            )
          })
        ).pipe(Effect.timeout("20 seconds"))
        const initial = yield* awaitReady(
          observation,
          (state) => state.evaluation.current.trackerGraph._tag === "GraphEstablished"
        )
        expect(snapshotOf(initial).taskIds()).toEqual([rootTaskId])
        const initialPlan = executingHistory.items.find(
          ({ occurrence }) => occurrence._tag === "TaskAttemptPlanned"
        )?.occurrence
        if (initialPlan?._tag !== "TaskAttemptPlanned") return expect.fail("A requires an accepted immutable plan")
        const plannedAttempt = initialPlan.operation.plannedAttempt
        expect(plannedAttempt.baseSha).toBe(configuration.plannedAttemptBaseSha)
        expect(plannedAttempt.taskId).toBe(rootTaskId)
        const exactWorktree = yield* git.runInWorktree(plannedAttempt.worktree, ["rev-parse", "HEAD"])
        expect(exactWorktree.exitCode).toBe(0)
        expect(
          (yield* git.runInWorktree(plannedAttempt.worktree, [
            "merge-base",
            "--is-ancestor",
            plannedAttempt.baseSha,
            "HEAD"
          ])).exitCode
        ).toBe(0)

        yield* Ref.set(graphPhase, "Expanded")
        const expanded = yield* awaitReady(observation, (state) => {
          const graph = state.evaluation.current.trackerGraph
          return graph._tag === "GraphEstablished" && graph.observation.snapshot.taskIds().length === 4
        })
        const tasks = snapshotOf(expanded).toWire().tasks
        expect(tasks.find(({ id }) => id === childTaskId)).toMatchObject({
          parentTaskId: rootTaskId,
          prerequisiteIds: [blockerTaskId]
        })
        expect(tasks.find(({ id }) => id === blockerTaskId)).toMatchObject({
          parentTaskId: null,
          lifecycle: { _tag: "TerminalWithoutSuccess" }
        })
        expect(tasks.find(({ id }) => id === independentTaskId)).toMatchObject({
          parentTaskId: rootTaskId,
          prerequisiteIds: [],
          lifecycle: { _tag: "Open" }
        })
        const placements = expanded.evaluation.current.ticketDeliveries.source.placements
        expect(placements.find(({ taskId }) => taskId === independentTaskId)?.placement).toEqual({
          _tag: "Selected",
          rank: 0
        })
        expect(placements.find(({ taskId }) => taskId === rootTaskId)?.placement).toEqual({
          _tag: "EligibleOutsideBound",
          rank: 1
        })
        const retainedHistory = yield* observation.traceReader.readAt(yield* observation.acceptedHistory.get)
        expect(
          retainedHistory.items
            .filter(({ occurrence }) => occurrence._tag === "TaskAttemptPlanned")
            .map(({ occurrence }) => occurrence)
        ).toEqual([initialPlan])
        expect(
          retainedHistory.items.filter(
            ({ occurrence }) => occurrence._tag === "PlannedAttemptExecutorWorkResponsibilityBegan"
          )
        ).toHaveLength(1)
        expect((yield* provider.snapshot()).operationCounts.find(({ tag }) => tag === "CodexStartTurn")?.count).toBe(1)
        expect(yield* Ref.get(forbiddenChildWorkReads)).toEqual([])
        expect((yield* git.runInWorktree(plannedAttempt.worktree, ["rev-parse", "HEAD"])).stdout).toBe(
          exactWorktree.stdout
        )

        yield* Ref.set(graphPhase, "Settled")
        yield* awaitReady(observation, (state) => {
          const graph = state.evaluation.current.trackerGraph
          return (
            graph._tag === "GraphEstablished" &&
            graph.observation.snapshot
              .toWire()
              .tasks.some(
                ({ id, lifecycle }) => id === independentTaskId && lifecycle._tag === "TerminalWithoutSuccess"
              )
          )
        })
        yield* Ref.set(turnTerminalVisible, true)
        yield* Deferred.succeed(turnCompletedHint, undefined)
        yield* Deferred.await(completionEntered).pipe(Effect.timeout("20 seconds"))
        yield* Deferred.succeed(releaseCompletion, undefined)
        const termination = yield* observation.runTermination.await.pipe(Effect.timeout("20 seconds"))
        expect(termination.disposition).toBe("Blocked")
        expect(yield* Ref.get(failures)).toEqual([])
        yield* Deferred.succeed(releaseHost, undefined)
        yield* Fiber.join(hostFiber).pipe(Effect.timeout("20 seconds"))

        const records = yield* Effect.scoped(
          Effect.gen(function* () {
            const context = yield* Layer.build(sqliteJournalStoreLayer({ filename: configuration.journalDatabase }))
            return yield* Context.get(context, JournalStore).read(observation.selection.runId)
          })
        )
        const terminalRecords = records.filter(({ event }) => event._tag === "WorkflowRunTerminated")
        expect(terminalRecords).toHaveLength(1)
        expect(terminalRecords[0]).toMatchObject({
          runId: observation.selection.runId,
          position: termination.terminatedAt.position,
          event: { disposition: "Blocked" }
        })
        expect(records.at(-1)).toEqual(terminalRecords[0])
        const terminal = terminalRecords[0]
        if (terminal?.event._tag !== "WorkflowRunTerminated") return expect.fail("expected actual terminal record")
        const terminalEvidence = terminal.event.evidence
        const finalObservation = records.find(({ position }) => position === terminalEvidence.observedAt)
        expect(finalObservation).toMatchObject({
          event: { _tag: "TaskTrackerFactsObserved", operationId: terminal.event.evidence.operationId }
        })
        expect(terminal.position).toBe(terminal.event.evidence.observedAt + 1)
        expect(terminal.event.evidence).toMatchObject({
          graphOutcome: "Blocked",
          blockedTaskIds: expect.arrayContaining([childTaskId, blockerTaskId, independentTaskId]),
          terminalTaskIds: expect.arrayContaining([blockerTaskId, independentTaskId])
        })
        expect(terminal.event.evidence.blockedTaskIds).toHaveLength(3)
        expect(terminal.event.evidence.terminalTaskIds).toHaveLength(2)
        const graphIntents = records.flatMap(({ event, position }) =>
          event._tag === "TaskTrackerReadIntentRecorded" && event.operation._tag === "ReadTrackerGraph"
            ? [{ operation: event.operation, position }]
            : []
        )
        const completedGraph = records.find(
          ({ event }) =>
            event._tag === "TaskTrackerFactsObserved" &&
            event.observation._tag === "CompleteTaskTrackerFacts" &&
            event.observation.factFamilies[1].lifecycles.some(
              ({ lifecycle, taskId }) => taskId === rootTaskId && lifecycle._tag === "CompletedSuccessfully"
            )
        )
        if (completedGraph?.event._tag !== "TaskTrackerFactsObserved") return expect.fail("requires A's changed graph")
        const completedGraphOperationId = completedGraph.event.operationId
        const replacement = graphIntents.find(({ operation }) => operation.operationId === completedGraphOperationId)
        const priorG2 = graphIntents.findLast(
          ({ operation, position }) =>
            operation.cause._tag === "PostQuiescenceReconfirmation" && position < (replacement?.position ?? 0)
        )
        expect(replacement?.operation.cause._tag).toBe("WorkflowEstablishment")
        expect(priorG2).toBeDefined()
        expect(replacement?.operation.predecessorOperationIds).toContain(priorG2?.operation.operationId)
        const worktreeSettlements = records.flatMap(({ event }) =>
          event._tag === "WorktreeCleanupSettled" ? [event] : []
        )
        expect(worktreeSettlements).toHaveLength(1)
        expect(worktreeSettlements[0]?.authorization).toMatchObject({
          locator: plannedAttempt.worktree,
          owner: { attemptId: plannedAttempt.attemptId, branch: plannedAttempt.branch },
          disposition: { _tag: "Settled", plannedAttempt }
        })
        expect(yield* fileSystem.exists(plannedAttempt.worktree)).toBe(false)
        const branchSettlements = records.flatMap(({ event }) => (event._tag === "BranchCleanupSettled" ? [event] : []))
        expect(branchSettlements).toHaveLength(1)
        expect(branchSettlements[0]?.authorization).toMatchObject({
          locator: plannedAttempt.branch,
          owner: { attemptId: plannedAttempt.attemptId },
          disposition: { _tag: "Settled", plannedAttempt }
        })
        expect(
          (yield* git.runInWorktree(configuration.repository, [
            "show-ref",
            "--verify",
            "--quiet",
            plannedAttempt.branch
          ])).exitCode
        ).toBe(1)
        const candidates = records.flatMap(({ event }) =>
          event._tag === "IntegratorCandidateCleanupSettled" ? [event] : []
        )
        expect(candidates).toHaveLength(1)
        const candidate = candidates[0]
        if (candidate === undefined) return expect.fail("requires exact Integrator candidate settlement")
        expect(candidate.authorization.disposition._tag).toBe("Settled")
        const gitWorktrees = yield* git.runInWorktree(configuration.repository, ["worktree", "list", "--porcelain"])
        expect(gitWorktrees.exitCode).toBe(0)
        expect(gitWorktrees.stdout).not.toContain(configuration.integratorCandidateWorktreeRoot)
        expect(gitWorktrees.stdout).not.toContain(plannedAttempt.worktree)
        const cassette = yield* projectRecordedCassette(records)
        expect(cassette.entries.at(-1)).toMatchObject({ _tag: "WorkflowRunTerminated", disposition: "Blocked" })
        expect(
          verifyRecordedCassetteRoundTrip(records, cassette).every(
            (checkpoint) =>
              checkpoint.operationalStateEquivalent &&
              checkpoint.workflowHistoryEquivalent &&
              checkpoint.pureSelectionEquivalent &&
              checkpoint.appliedOccurrencePositionEquivalent
          )
        ).toBe(true)

        expect(records.filter(({ event }) => event._tag === "TaskAttemptPlanned")).toHaveLength(1)
        expect(
          records.filter(({ event }) => event._tag === "PlannedAttemptExecutorWorkResponsibilityBegan")
        ).toHaveLength(1)
        expect(records.filter(({ event }) => event._tag === "TargetPromotionObservedSuccess")).toHaveLength(1)
        expect(records.filter(({ event }) => event._tag === "IntegrationFinalitySettled")).toHaveLength(1)
        expect(
          records.some(
            ({ event }) =>
              event._tag === "TaskTrackerFactsObserved" &&
              event.observation._tag === "FocusedTaskCompletionFacts" &&
              event.observation.purpose._tag === "Confirmation" &&
              event.observation.facts.lifecycle === "CompletedSuccessfully"
          )
        ).toBe(true)
        expect((yield* provider.snapshot()).operationCounts.find(({ tag }) => tag === "CodexStartTurn")?.count).toBe(2)
        expect(yield* Ref.get(forbiddenChildWorkReads)).toEqual([])
      })
    ).pipe(Effect.provide(fixtureLayer)),
  60_000
)
