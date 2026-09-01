#!/usr/bin/env node
/* eslint-disable import/no-nodejs-modules -- The fixture is the real second Node host process. */
import { NodeCrypto, NodeFileSystem, NodePath } from "@effect/platform-node"
import {
  GithubGraphqlClient,
  TaskClaimCheckSelected,
  WorkflowTrace,
  type GithubGraphqlRequest
} from "@dalph/orchestrator"
import { Deferred, Effect, Layer, Ref, Result, Schema } from "effect"
import nodeProcess from "node:process"
import { join } from "node:path"
import { productionRepositoryHostGraph, withProductionRepositoryHost } from "../src/application/production-host.js"
import type { ProductionRunReconstructionObservation } from "../src/application/production.js"
import { CodexAppServer as CodexAppServerService } from "../src/application/codex-app-server.js"
import { CodexServerIncarnation } from "../src/application/codex-attempt-store.js"
import {
  GithubReadStarted,
  HostCompleted,
  RecoveryReconstructed,
  RestartChildProcessId,
  RestartChildStarted,
  RestartFixtureFailed,
  RestartFixtureInput
} from "./production-restart-host-fixture-contract.js"
import type { RestartFixtureEvent } from "./production-restart-host-fixture-contract.js"

const plannedAttemptBaseShaLength = 40
const expectedRecoveredPolicyRevision = 2
const expectedRecoveredTaskWorkCapacity = 7

type RecoveryEvent = Extract<RestartFixtureEvent, { readonly _tag: "RecoveryReconstructed" }>
type TaskClaimCheckEvent = Extract<RestartFixtureEvent, { readonly _tag: "TaskClaimCheckSelected" }>

const validRawConfiguration = (input: RestartFixtureInput) => {
  const repository = join(input.root, "repository")
  return {
    target: input.target,
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

const requireRecovery = (reconstruction: Ref.Ref<RecoveryEvent | undefined>) =>
  Effect.gen(function* () {
    const recovered = yield* Ref.get(reconstruction)
    if (recovered === undefined) {
      return yield* Effect.die("GitHub read entered before production recovery reconstruction")
    }
    return recovered
  })

const requireSelectedTaskClaim = (
  selectedOperation: Ref.Ref<TaskClaimCheckEvent | undefined>,
  input: RestartFixtureInput
) =>
  Effect.gen(function* () {
    const selected = yield* Ref.get(selectedOperation)
    if (selected === undefined) {
      return yield* Effect.die("GitHub read entered before the exact owning task-claim transition was selected")
    }
    if (selected.operationId !== input.responsibilityOperationId || selected.taskId !== input.taskId) {
      return yield* Effect.die("GitHub read entered before the exact owning task-claim transition was selected")
    }
    return selected
  })

const requireClaimLabelRead = (request: GithubGraphqlRequest) =>
  request._tag === "FindClaimLabel"
    ? Effect.void
    : Effect.die(`GitHub read entered with unexpected request ${request._tag}`)

const hasExpectedRecoveredState = (recovered: RecoveryEvent, input: RestartFixtureInput) => {
  const responsibility = recovered.responsibilities[0]
  const taskResponsibility = responsibility?._tag === "TaskClaimResponsibility" ? responsibility : undefined
  return [
    recovered.policy.revision === expectedRecoveredPolicyRevision,
    recovered.policy.taskExecutionCapacity === expectedRecoveredTaskWorkCapacity,
    recovered.responsibilities.length === 1,
    responsibility !== undefined,
    taskResponsibility !== undefined,
    taskResponsibility?.taskId === input.taskId
  ].every(Boolean)
}

const makeGithubClient = (
  input: RestartFixtureInput,
  reconstruction: Ref.Ref<RecoveryEvent | undefined>,
  selectedOperation: Ref.Ref<TaskClaimCheckEvent | undefined>,
  githubReadStarted: Deferred.Deferred<void>
) =>
  GithubGraphqlClient.of({
    execute: (request) =>
      Effect.gen(function* () {
        const recovered = yield* requireRecovery(reconstruction)
        const selected = yield* requireSelectedTaskClaim(selectedOperation, input)
        yield* requireClaimLabelRead(request)
        if (!hasExpectedRecoveredState(recovered, input)) {
          return yield* Effect.die("GitHub read entered without the expected recovered policy and responsibility")
        }
        yield* writeEvent(GithubReadStarted.make({ operationId: selected.operationId, target: input.target }))
        yield* Deferred.succeed(githubReadStarted, undefined)
        return yield* Effect.never
      })
  })

const fakeCodexAppServer = CodexAppServerService.of({
  incarnation: CodexServerIncarnation.make("production-restart-child-incarnation"),
  startThread: () => Effect.die("restart fixture must not start a Codex thread"),
  readThread: () => Effect.die("restart fixture must not read a Codex thread"),
  resumeThread: () => Effect.die("restart fixture must not resume a Codex thread"),
  startTurn: () => Effect.die("restart fixture must not start a Codex turn"),
  interruptTurn: () => Effect.die("restart fixture must not interrupt a Codex turn"),
  listBackgroundTerminals: () => Effect.die("restart fixture must not inspect a background terminal"),
  terminateBackgroundTerminal: () => Effect.die("restart fixture must not terminate a background terminal"),
  close: Effect.void
})

const runFixture = Effect.scoped(
  Effect.gen(function* () {
    const decoded = Schema.decodeUnknownResult(Schema.fromJsonString(RestartFixtureInput))(nodeProcess.argv[2])
    if (Result.isFailure(decoded)) {
      return yield* Effect.die(String(decoded.failure))
    }
    const input = decoded.success
    yield* writeEvent(
      RestartChildStarted.make({ label: input.label, pid: RestartChildProcessId.make(nodeProcess.pid) })
    )

    // These Refs record actual production-boundary observations. They do not
    // release or sequence the protocol; an early provider entry fails below.
    const reconstruction = yield* Ref.make<RecoveryEvent | undefined>(undefined)
    const selectedOperation = yield* Ref.make<TaskClaimCheckEvent | undefined>(undefined)
    // This latch only keeps the host scope alive after the provider is entered.
    const githubReadStarted = yield* Deferred.make<void>()

    const onReconstructed = ({ recovery, taskWorkCapacity }: ProductionRunReconstructionObservation) =>
      Effect.gen(function* () {
        const projection = yield* recovery.readDeliveryProjection
        if (projection.evidence._tag !== "AvailableDeliveryProjectionEvidence") {
          return yield* Effect.die("restart fixture recovery projection is unavailable")
        }
        if (projection.evidence.acceptedAt === null) {
          return yield* Effect.die("restart fixture recovery projection has no accepted position")
        }
        const policy = yield* taskWorkCapacity.read(input.runId)
        const event = RecoveryReconstructed.make({
          acceptedPosition: projection.evidence.acceptedAt,
          label: input.label,
          policy,
          responsibilities: projection.evidence.facts.map(({ responsibility }) => responsibility),
          runId: input.runId
        })
        yield* Ref.set(reconstruction, event)
        yield* writeEvent(event)
      }).pipe(Effect.orDie)

    const githubClient = makeGithubClient(input, reconstruction, selectedOperation, githubReadStarted)
    const workflowTrace = WorkflowTrace.of({
      emit: (item) => {
        if (item._tag !== "TaskClaimCheckSelected") return Effect.void
        const event = TaskClaimCheckSelected.make({ operationId: item.operationId, taskId: item.taskId })
        return Ref.set(selectedOperation, event).pipe(Effect.andThen(writeEvent(event)))
      }
    })
    const adapters = {
      codexAppServer: () => Layer.succeed(CodexAppServerService, fakeCodexAppServer),
      githubClient: () => Layer.succeed(GithubGraphqlClient, githubClient),
      workflowTrace: () => Layer.succeed(WorkflowTrace, workflowTrace),
      onReconstructed
    }
    const selection = yield* withProductionRepositoryHost(
      validRawConfiguration(input),
      productionRepositoryHostGraph(adapters),
      (observation) => Deferred.await(githubReadStarted).pipe(Effect.as(observation.selection))
    )
    yield* writeEvent(HostCompleted.make({ label: input.label, selection }))
  })
).pipe(Effect.provide(Layer.mergeAll(NodeFileSystem.layer, NodePath.layer, NodeCrypto.layer)))

Effect.runPromise(runFixture).catch((cause: unknown) => {
  nodeProcess.stdout.write(`${JSON.stringify(RestartFixtureFailed.make({ detail: String(cause) }))}\n`)
  // eslint-disable-next-line functional/immutable-data -- The child fixture must expose a nonzero process result to its parent.
  nodeProcess.exitCode = 70
})
