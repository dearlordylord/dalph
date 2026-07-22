import { NodeCrypto } from "@effect/platform-node"
import { it } from "@effect/vitest"
import { ConfigProvider, Effect, Layer } from "effect"
import { expect } from "vitest"
import { OperationId, TaskClaimAcquisitionPlanner, taskClaimAcquisitionPlannerConfigLayer, TaskId } from "./index.js"

it.effect("plans a fresh claim token for the configured owner", () =>
  Effect.gen(function*() {
    const planner = yield* TaskClaimAcquisitionPlanner
    const operationId = OperationId.make("claim-planning-operation")
    const taskId = TaskId.make("claim-planning-task")
    const first = yield* planner.plan(operationId, taskId)
    const second = yield* planner.plan(operationId, taskId)

    expect(first).toMatchObject({ operationId, owner: "configured-owner", taskId })
    expect(second.token).not.toBe(first.token)
  }).pipe(
    Effect.provide(taskClaimAcquisitionPlannerConfigLayer),
    Effect.provide(NodeCrypto.layer),
    Effect.provide(ConfigProvider.layer(ConfigProvider.fromUnknown({
      DALPH_CLAIM_OWNER: "configured-owner"
    })))
  ))

it.effect("rejects an empty configured claim owner at the schema boundary", () =>
  Effect.gen(function*() {
    const failure = yield* Layer.build(taskClaimAcquisitionPlannerConfigLayer).pipe(
      Effect.flip
    )
    expect(String(failure)).toContain("DALPH_CLAIM_OWNER")
  }).pipe(
    Effect.provide(NodeCrypto.layer),
    Effect.provide(ConfigProvider.layer(ConfigProvider.fromUnknown({
      DALPH_CLAIM_OWNER: ""
    })))
  ))
