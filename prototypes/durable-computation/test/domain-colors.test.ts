import { readFile } from "node:fs/promises"
import { fileURLToPath } from "node:url"
import { Effect, Layer, Schema } from "effect"
import { Activity, Workflow, WorkflowEngine } from "effect/unstable/workflow"
import { describe, expect, it } from "vitest"
import {
  CurrentTaskFactsRefresh,
  ExactTaskClaimReconciliation,
  recoverCurrentRunDecision
} from "../src/domain-colored-computation.ts"
import { fixture } from "../src/contracts.ts"

describe("Effect Workflow placement beneath Dalph domain colours", () => {
  it("keeps the seven-line delivery description outside Workflow", async () => {
    const deliverySource = await readFile(
      fileURLToPath(
        new URL("../../../packages/orchestrator/src/coordination/delivery/delivery.ts", import.meta.url)
      ),
      "utf8"
    )
    const deliveryBody = deliverySource.slice(deliverySource.indexOf("export const delivery"))

    expect(deliveryBody).toBe(`export const delivery = Effect.gen(function* () {
  const trackerGraph = yield* TrackerGraphRelation

  const graph = trackerGraph.signal
  const frontier = mapCurrentSignal(graph, frontierOf)
  const tickets = yield* boundedParallelTickets(frontier)
  const responsibilities = yield* executorResponsibilities(tickets)
  const settlements = yield* deliverySettlements(responsibilities)

  return yield* reflectDeliverySettlements(settlements)
})
`)
    expect(deliverySource).not.toMatch(/effect\/unstable\/workflow|\b(?:Activity|WorkflowEngine)\b/)
  })

  it("expresses the recovered decision without Workflow or storage vocabulary", async () => {
    const calls: Array<string> = []
    const result = await Effect.runPromise(
      recoverCurrentRunDecision.pipe(
        Effect.provideService(
          ExactTaskClaimReconciliation,
          ExactTaskClaimReconciliation.of({
            exactClaim: Effect.sync(() => {
              calls.push("reconcile exact task claim")
              return fixture.claim
            })
          })
        ),
        Effect.provideService(
          CurrentTaskFactsRefresh,
          CurrentTaskFactsRefresh.of({
            currentTaskFacts: Effect.sync(() => {
              calls.push("read current task facts")
              return { lifecycle: "Open" as const, targetMember: true }
            })
          })
        )
      )
    )

    expect(calls).toEqual(["reconcile exact task claim", "read current task facts"])
    expect(result).toBe("ContinueSameRun")

    const source = await readFile(
      fileURLToPath(new URL("../src/domain-colored-computation.ts", import.meta.url)),
      "utf8"
    )
    expect(source).not.toMatch(/\b(?:Activity|Workflow|WorkflowEngine|Sqlite|Cluster|Journal|faultPoint)\b/)
  })

  it("waits without refreshing task facts when the exact claim cannot be reconciled", async () => {
    const result = await Effect.runPromise(
      recoverCurrentRunDecision.pipe(
        Effect.provideService(
          ExactTaskClaimReconciliation,
          ExactTaskClaimReconciliation.of({ exactClaim: Effect.succeed(null) })
        ),
        Effect.provideService(
          CurrentTaskFactsRefresh,
          CurrentTaskFactsRefresh.of({ currentTaskFacts: Effect.die("refresh must not run") })
        )
      )
    )

    expect(result).toBe("Wait")
  })

  it("requires one stable Activity name per durable domain action", async () => {
    let calls = 0
    const probe = Workflow.make("DomainActionIdentityProbe", {
      error: Schema.Never,
      idempotencyKey: ({ runId }) => runId,
      payload: { runId: Schema.NonEmptyString },
      success: Schema.Int
    })
    const action = Activity.make({
      error: Schema.Never,
      execute: Effect.sync(() => ++calls),
      name: "ExecuteDomainAction",
      success: Schema.Int
    })
    const handler = probe.toLayer(() =>
      Effect.gen(function* () {
        yield* action
        return yield* action
      })
    )
    const runtime = handler.pipe(Layer.provideMerge(WorkflowEngine.layerMemory))

    const result = await Effect.runPromise(
      probe.execute({ runId: "run-activity-identity-probe" }).pipe(Effect.provide(runtime), Effect.scoped)
    )

    expect(result).toBe(1)
    expect(calls).toBe(1)
  })
})
