import { join } from "node:path"
import { open, readFile, rename } from "node:fs/promises"
import * as NodeCrypto from "@effect/platform-node/NodeCrypto"
import * as SqliteClient from "@effect/sql-sqlite-node/SqliteClient"
import { Effect, Layer, Schedule, Schema } from "effect"
import { ClusterWorkflowEngine, SingleRunner } from "effect/unstable/cluster"
import { Activity, Workflow, WorkflowEngine } from "effect/unstable/workflow"
import {
  type AdapterName,
  ExactClaim,
  type FaultPoint,
  RecoveredDecision,
  fixture
} from "../contracts.ts"
import {
  closeApplicationExitAdmission,
  createClaim,
  readClaim,
  readCurrentTaskFacts
} from "../controlled-world.ts"

interface EffectWorkflowInput {
  readonly adapter: AdapterName
  readonly faultPoint: FaultPoint
  readonly processInstance: string
  readonly workspace: string
  readonly onExecutionStored: (executionId: string) => Promise<void>
  readonly onFault: (faultPoint: FaultPoint) => Promise<never>
}

export interface IncompatibleWorkflowCode {
  readonly _tag: "IncompatibleWorkflowCode"
  readonly changedStep: "ReconcileExactTaskClaimV2"
  readonly found: "v1" | "v2"
  readonly requested: "v1" | "v2"
}

export type EffectWorkflowResult = RecoveredDecision | IncompatibleWorkflowCode

const changedClaimStep = "ReconcileExactTaskClaimV2" as const

const DalphRunV1 = Workflow.make("DalphRunV1", {
  error: Schema.Never,
  idempotencyKey: ({ runId }) => runId,
  payload: { codeVersion: Schema.Literal("v1"), runId: Schema.NonEmptyString },
  success: RecoveredDecision
})

const exactClaimMatches = (claim: ExactClaim | null): boolean =>
  claim !== null &&
  claim.operationId === fixture.claim.operationId &&
  claim.owner === fixture.claim.owner &&
  claim.taskId === fixture.claim.taskId &&
  claim.token === fixture.claim.token

const workflowRuntimeLayer = (
  databasePath: string,
  handler: Layer.Layer<never, never, WorkflowEngine.WorkflowEngine>
) => {
  const sql = SqliteClient.layer({ filename: databasePath })
  const cluster = SingleRunner.layer({
    runnerStorage: "memory",
    shardingConfig: {
      entityMessagePollInterval: "20 millis",
      entityReplyPollInterval: "20 millis",
      refreshAssignmentsInterval: "20 millis",
      sendRetryInterval: "20 millis",
      simulateRemoteSerialization: true
    }
  }).pipe(Layer.provide([sql, NodeCrypto.layer]))
  const engine = ClusterWorkflowEngine.layer.pipe(Layer.provideMerge(cluster))
  return handler.pipe(Layer.provideMerge(engine))
}

const codeVersionFor = (adapter: AdapterName): "v1" | "v2" =>
  adapter === "effect-workflow-v2" ? "v2" : "v1"

const establishCodeVersion = async (
  workspace: string,
  requested: "v1" | "v2"
): Promise<void | IncompatibleWorkflowCode> => {
  const path = join(workspace, "effect-workflow-code-version")
  const found = await readFile(path, "utf8").catch((error: unknown) => {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return undefined
    throw error
  })
  if (found !== undefined) {
    const version = found.trim()
    return version === requested
      ? undefined
      : {
          _tag: "IncompatibleWorkflowCode",
          changedStep: changedClaimStep,
          found: version === "v2" ? "v2" : "v1",
          requested
        }
  }
  const temporaryPath = `${path}.${process.pid}.tmp`
  const file = await open(temporaryPath, "w")
  try {
    await file.writeFile(`${requested}\n`, "utf8")
    await file.sync()
  } finally {
    await file.close()
  }
  await rename(temporaryPath, path)
}

export const runEffectWorkflow = async (input: EffectWorkflowInput): Promise<EffectWorkflowResult> => {
  const codeVersion = codeVersionFor(input.adapter)
  const incompatible = await establishCodeVersion(input.workspace, codeVersion)
  if (incompatible !== undefined) return incompatible
  const context = {
    adapter: input.adapter,
    processInstance: input.processInstance,
    workspace: input.workspace
  }
  const executionRegistration = Activity.make({
    error: Schema.Never,
    execute: Effect.succeed(fixture.runId),
    name: "RegisterExactDalphRunV1",
    success: Schema.NonEmptyString
  })
  const claimActivity = Activity.make({
    error: Schema.Never,
    execute: Effect.gen(function* () {
      if (input.faultPoint === "WithIncompatibleExecutionCode" && input.processInstance === "process-1") {
        return yield* Effect.promise(() => input.onFault(input.faultPoint))
      }
      const observed = yield* Effect.promise(() => readClaim(context))
      if (observed !== null) {
        return exactClaimMatches(observed) ? observed : null
      }
      if (input.faultPoint === "AfterClaimIntentBeforeRequest" && input.processInstance === "process-1") {
        return yield* Effect.promise(() => input.onFault(input.faultPoint))
      }
      if (input.faultPoint === "AfterExitCutoff" && input.processInstance === "process-1") {
        yield* Effect.promise(() => closeApplicationExitAdmission(context))
        return yield* Effect.promise(() => input.onFault(input.faultPoint))
      }
      const replyDelivered = input.faultPoint !== "AfterClaimAppliedBeforeReplyRecorded"
      yield* Effect.promise(() => createClaim(context, fixture.claim, replyDelivered))
      if (input.faultPoint === "AfterClaimAppliedBeforeReplyRecorded") {
        return yield* Effect.promise(() => input.onFault(input.faultPoint))
      }
      return fixture.claim
    }),
    interruptRetryPolicy: Schedule.recurs(0),
    name: codeVersion === "v1" ? "ReconcileExactTaskClaimV1" : changedClaimStep,
    success: Schema.NullOr(ExactClaim)
  })
  const handler = DalphRunV1.toLayer((_payload, executionId) =>
    Effect.gen(function* () {
      yield* executionRegistration
      yield* Effect.promise(() => input.onExecutionStored(executionId))
      if (input.faultPoint === "AfterExecutionStored" && input.processInstance === "process-1") {
        return yield* Effect.promise(() => input.onFault(input.faultPoint))
      }
      const claim = yield* claimActivity
      if (claim === null) return "Wait" as const
      if (input.faultPoint === "AfterClaimReplyDurableBeforeNextRead" && input.processInstance === "process-1") {
        return yield* Effect.promise(() => input.onFault(input.faultPoint))
      }
      const current = yield* Effect.promise(() => readCurrentTaskFacts(context))
      if (input.faultPoint === "AfterCleanCheckpoint" && current.trackerRevision === 2) {
        return yield* Effect.promise(() => input.onFault(input.faultPoint))
      }
      return current.task.lifecycle === "Open" && current.task.targetMember ? "ContinueSameRun" : "Wait"
    })
  )
  const runtime = workflowRuntimeLayer(join(input.workspace, "effect-workflow.sqlite"), handler)
  return Effect.runPromise(
    DalphRunV1.execute({ codeVersion: "v1", runId: fixture.runId }).pipe(Effect.provide(runtime), Effect.scoped)
  )
}
