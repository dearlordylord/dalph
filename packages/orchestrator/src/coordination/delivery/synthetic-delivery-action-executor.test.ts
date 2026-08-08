import { AttemptId, RunId } from "@dalph/contracts"
import { it } from "@effect/vitest"
import { Effect } from "effect"
import { expect } from "vitest"
import { PlannedAttemptExecutorCorrelationMismatch } from "../../workflow/protocols/planned-attempt-executor-work/protocol.js"
import { validateSyntheticExecutorCorrelation } from "./synthetic-delivery-action-executor.js"

const expected = { attemptId: AttemptId.make("synthetic-correlation-attempt"), runId: RunId.make("synthetic-run") }

it.effect("accepts only the exact synthetic executor correlation", () =>
  Effect.gen(function* () {
    yield* validateSyntheticExecutorCorrelation(expected, expected)
    const mismatch = yield* validateSyntheticExecutorCorrelation(expected, {
      attemptId: AttemptId.make("other-attempt"),
      runId: expected.runId
    }).pipe(Effect.flip)

    expect(mismatch).toBeInstanceOf(PlannedAttemptExecutorCorrelationMismatch)
    expect(mismatch).toMatchObject({ expected, observed: { attemptId: "other-attempt", runId: expected.runId } })
  })
)
