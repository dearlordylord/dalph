import { readFile } from "node:fs/promises"
import { fileURLToPath } from "node:url"
import { Effect, Layer, Schema } from "effect"
import { Activity, Workflow, WorkflowEngine } from "effect/unstable/workflow"
import { describe, expect, it } from "vitest"
import {
  CurrentTaskFactsRefresh,
  ExactTaskClaimRecovery,
  recoverCurrentRunDecision
} from "../src/domain-colored-computation.ts"
import { fixture } from "../src/contracts.ts"

describe("Effect Workflow placement beneath Dalph domain colours", () => {
  it("keeps Workflow vocabulary out of the seven-line delivery description", async () => {
    const deliverySource = await readFile(
      fileURLToPath(
        new URL("../../../packages/orchestrator/src/coordination/delivery/delivery.ts", import.meta.url)
      ),
      "utf8"
    )
    expect(deliverySource).not.toMatch(/effect\/unstable\/workflow|\b(?:Activity|WorkflowEngine)\b/)
  })

  it("keeps Workflow and storage vocabulary out of delivery action planning", async () => {
    const planningSource = await readFile(
      fileURLToPath(
        new URL(
          "../../../packages/orchestrator/src/coordination/delivery/delivery-action-planning.ts",
          import.meta.url
        )
      ),
      "utf8"
    )

    expect(planningSource).not.toMatch(
      /effect\/unstable\/workflow|@effect\/sql|\b(?:Activity|WorkflowEngine|SqliteClient|JournalStore)\b/
    )
  })

  it("expresses the recovered decision without Workflow or storage vocabulary", async () => {
    const calls: Array<string> = []
    const result = await Effect.runPromise(
      recoverCurrentRunDecision.pipe(
        Effect.provideService(
          ExactTaskClaimRecovery,
          ExactTaskClaimRecovery.of({
            recoverExactClaim: Effect.sync(() => {
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
          ExactTaskClaimRecovery,
          ExactTaskClaimRecovery.of({ recoverExactClaim: Effect.succeed(null) })
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
    let firstActionCalls = 0
    let secondActionCalls = 0
    const probe = Workflow.make("DomainActionIdentityProbe", {
      error: Schema.Never,
      idempotencyKey: ({ runId }) => runId,
      payload: { runId: Schema.NonEmptyString },
      success: Schema.Int
    })
    const firstAction = Activity.make({
      error: Schema.Never,
      execute: Effect.sync(() => ++firstActionCalls),
      name: "ExecuteDomainAction",
      success: Schema.Int
    })
    const secondAction = Activity.make({
      error: Schema.Never,
      execute: Effect.sync(() => {
        secondActionCalls += 1
        return 2
      }),
      name: "ExecuteDomainAction",
      success: Schema.Int
    })
    const handler = probe.toLayer(() =>
      Effect.gen(function* () {
        yield* firstAction
        return yield* secondAction
      })
    )
    const runtime = handler.pipe(Layer.provideMerge(WorkflowEngine.layerMemory))

    const result = await Effect.runPromise(
      probe.execute({ runId: "run-activity-identity-probe" }).pipe(Effect.provide(runtime), Effect.scoped)
    )

    expect(result).toBe(1)
    expect(firstActionCalls).toBe(1)
    expect(secondActionCalls).toBe(0)
  })
})
