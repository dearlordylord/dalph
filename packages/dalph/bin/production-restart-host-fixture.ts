#!/usr/bin/env node
/* eslint-disable import/no-nodejs-modules -- The fixture is the real second Node host process. */
import { NodeCrypto, NodeFileSystem, NodePath } from "@effect/platform-node"
import {
  GithubGraphqlClient,
  JournaledRunObservationSource,
  JournalStore,
  WorkflowTrace,
  workflowOperationId,
  type WorkflowOperation
} from "@dalph/orchestrator"
import { Context, Deferred, Effect, Layer, Result, Schema } from "effect"
import nodeProcess from "node:process"
import { join } from "node:path"
import { productionRepositoryHostGraph, withProductionRepositoryHost } from "../src/application/production-host.js"
import { CodexAppServer as CodexAppServerService } from "../src/application/codex-app-server.js"
import { CodexServerIncarnation } from "../src/application/codex-attempt-store.js"
import {
  GithubReadStarted,
  HostCompleted,
  OperationSelected,
  RecoveryReconstructed,
  RestartChildStarted,
  RestartFixtureFailed,
  RestartFixtureInput
} from "./production-restart-host-fixture-contract.js"
import type { RestartFixtureEvent } from "./production-restart-host-fixture-contract.js"

const plannedAttemptBaseShaLength = 40
const missingIssueNumber = -1
const missingPolicyTaskWorkCapacity = -1

const validRawConfiguration = (input: RestartFixtureInput) => {
  const repository = join(input.root, "repository")
  return {
    target: { _tag: "GithubIssue", issueNumber: 293, owner: "dearlordylord", repository: "dalph" },
    repository,
    commonDirectory: repository,
    integrationRef: "refs/heads/master",
    plannedAttemptBaseSha: "a".repeat(plannedAttemptBaseShaLength),
    plannedAttemptExecutor: "codex:production",
    claimOwner: "dalph:production",
    taskWorkCapacity: input.taskWorkCapacity,
    journalDatabase: input.journalDatabase,
    evidenceStoreRoot: join(input.root, "evidence"),
    plannedAttemptWorktreeRoot: join(input.root, "planned-attempts"),
    codexStateDirectory: join(input.root, "codex-state"),
    integratorCandidateWorktreeRoot: join(input.root, "integrator-candidates"),
    integratorPrivateStore: join(input.root, "integrator-private.json"),
    activationInterval: "1 minute",
    failureCooldown: "5 seconds",
    codexExecutable: "/usr/local/bin/codex",
    codexClientName: "dalph",
    codexClientVersion: "0.0.0",
    codexProvider: "openai",
    githubToken: "github-secret",
    codexProviderCredential: "codex-secret"
  }
}

const writeEvent = (event: RestartFixtureEvent): Effect.Effect<void> =>
  Effect.sync(() => {
    nodeProcess.stdout.write(`${JSON.stringify(event)}\n`)
  })

const operationIdentity = workflowOperationId

const operationTargetIssueNumber = (operation: WorkflowOperation) => {
  if (!("target" in operation) || typeof operation.target === "string") return missingIssueNumber
  return Number(operation.target.issueNumber)
}

const productionGraphWithRecoveryEvidence = (
  adapters: Parameters<typeof productionRepositoryHostGraph>[0],
  input: RestartFixtureInput
) => {
  const productionGraph = productionRepositoryHostGraph(adapters)
  return {
    foundation: productionGraph.foundation,
    run: (
      configuration: Parameters<typeof productionGraph.run>[0],
      selection: Parameters<typeof productionGraph.run>[1],
      onFailure: (failure: unknown) => Effect.Effect<void>
    ) =>
      Layer.unwrap(
        Effect.gen(function* () {
          const context = yield* Layer.build(productionGraph.run(configuration, selection, onFailure))
          const source = Context.get(context, JournaledRunObservationSource)
          const journal = yield* JournalStore
          const instrumentedSource = JournaledRunObservationSource.of({
            ...source,
            awaitEstablished: source.awaitEstablished.pipe(
              Effect.tap(({ acceptedAt, runId }) =>
                journal.read(runId).pipe(
                  Effect.flatMap((records) => {
                    const beginning = records.find(({ event }) => event._tag === "WorkflowRunBegan")
                    const initialPolicyTaskWorkCapacity =
                      beginning?.event._tag === "WorkflowRunBegan"
                        ? Number(beginning.event.initialControlPolicy.taskExecutionCapacity)
                        : missingPolicyTaskWorkCapacity
                    return writeEvent(
                      RecoveryReconstructed.make({
                        acceptedPosition: Number(acceptedAt),
                        initialPolicyTaskWorkCapacity,
                        label: input.label,
                        responsibilities: records
                          .filter(({ event }) => event._tag === "TaskClaimAcquired")
                          .map(() => "TaskClaimAcquired"),
                        runId
                      })
                    )
                  }),
                  Effect.orDie
                )
              )
            )
          })
          return Layer.succeedContext(Context.add(context, JournaledRunObservationSource, instrumentedSource))
        })
      )
  }
}

const fakeCodexAppServer = CodexAppServerService.of({
  incarnation: CodexServerIncarnation.make("production-restart-child-incarnation"),
  startThread: () => Effect.die("restart fixture must not start a Codex thread"),
  readThread: () => Effect.die("restart fixture must not read a Codex thread"),
  resumeThread: () => Effect.die("restart fixture must not resume a Codex thread"),
  startTurn: () => Effect.die("restart fixture must not start a Codex turn"),
  interruptTurn: () => Effect.die("restart fixture must not interrupt a Codex turn"),
  listBackgroundTerminals: () => Effect.die("restart fixture must not inspect terminals"),
  terminateBackgroundTerminal: () => Effect.die("restart fixture must not terminate a background terminal"),
  close: Effect.void
})

const runFixture = Effect.scoped(
  Effect.gen(function* () {
    const decoded = Schema.decodeUnknownResult(RestartFixtureInput)({
      journalDatabase: nodeProcess.argv[2],
      label: nodeProcess.argv[4],
      root: nodeProcess.argv[3],
      taskWorkCapacity: Number(nodeProcess.argv[5])
    })
    if (Result.isFailure(decoded)) {
      return yield* Effect.die(String(decoded.failure))
    }
    const input = decoded.success
    yield* writeEvent(RestartChildStarted.make({ label: input.label, pid: nodeProcess.pid }))
    const bootstrapReleased = yield* Deferred.make<void>()
    const operationSelected = yield* Deferred.make<void>()
    const githubReadStarted = yield* Deferred.make<void>()
    const githubClient = GithubGraphqlClient.of({
      execute: () =>
        Deferred.await(bootstrapReleased).pipe(
          Effect.andThen(Deferred.await(operationSelected)),
          Effect.andThen(writeEvent(GithubReadStarted.make({ label: input.label }))),
          Effect.andThen(Deferred.succeed(githubReadStarted, undefined)),
          Effect.andThen(Effect.never)
        )
    })
    const workflowTrace = WorkflowTrace.of({
      emit: (item) =>
        item._tag === "OperationSelected"
          ? Deferred.await(bootstrapReleased).pipe(
              Effect.andThen(
                writeEvent(
                  OperationSelected.make({
                    operationId: String(operationIdentity(item.operation)),
                    operationTag: item.operation._tag,
                    targetIssueNumber: operationTargetIssueNumber(item.operation)
                  })
                )
              ),
              Effect.andThen(Deferred.succeed(operationSelected, undefined))
            )
          : Effect.void
    })
    const adapters = {
      codexAppServer: () => Layer.succeed(CodexAppServerService, fakeCodexAppServer),
      githubClient: () => Layer.succeed(GithubGraphqlClient, githubClient),
      workflowTrace: () => Layer.succeed(WorkflowTrace, workflowTrace)
    }
    const selection = yield* withProductionRepositoryHost(
      validRawConfiguration(input),
      productionGraphWithRecoveryEvidence(adapters, input),
      (observation) =>
        Effect.gen(function* () {
          yield* Deferred.succeed(bootstrapReleased, undefined)
          yield* Deferred.await(githubReadStarted)
          return observation.selection
        })
    )
    yield* writeEvent(HostCompleted.make({ label: input.label, runId: selection.runId, selectionTag: selection._tag }))
  })
).pipe(Effect.provide(Layer.mergeAll(NodeFileSystem.layer, NodePath.layer, NodeCrypto.layer)))

Effect.runPromise(runFixture).catch((cause: unknown) => {
  nodeProcess.stdout.write(`${JSON.stringify(RestartFixtureFailed.make({ detail: String(cause) }))}\n`)
  // eslint-disable-next-line functional/immutable-data -- The child fixture must expose a nonzero process result to its parent.
  nodeProcess.exitCode = 70
})
