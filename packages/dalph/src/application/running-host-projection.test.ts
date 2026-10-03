import { RunId } from "@dalph/contracts"
import { JournalPosition, TraceCursor } from "@dalph/orchestrator"
import { it } from "@effect/vitest"
import { Effect } from "effect"
import { expect } from "vitest"
import { projectRunningHostRunControl, projectRunningHostSnapshot } from "./running-host-projection.js"

const runId = RunId.make("R")
const observedAt = TraceCursor.make({ runId, position: JournalPosition.make(9) })
it.effect("keeps source closure distinct from pending and accepted Run termination", () =>
  Effect.gen(function* () {
    expect(yield* projectRunningHostSnapshot(runId, { _tag: "NotReady" })).toEqual({ _tag: "NotReady", runId })
    expect(yield* projectRunningHostSnapshot(runId, { _tag: "Closed", final: null })).toEqual({
      _tag: "Closed",
      runId,
      final: null
    })
    expect(
      yield* projectRunningHostRunControl({ direction: "RunPaused", observedAt, termination: null }, null)
    ).toEqual({ _tag: "RunPaused", controlObservedAt: observedAt, terminationEvidence: { _tag: "Pending" } })
    const termination = { disposition: "Blocked", terminatedAt: observedAt } as const
    expect(yield* projectRunningHostRunControl({ direction: "RunTerminated", observedAt, termination }, null)).toEqual({
      _tag: "RunTerminated",
      terminationEvidence: { _tag: "Accepted", ...termination }
    })
  })
)

it.effect("exposes finality rejection without inventing a terminal journal occurrence", () =>
  Effect.gen(function* () {
    const failure = {
      _tag: "WorkflowRunTerminationEvidenceInvalid",
      runId,
      detail: "incomparable graph evidence"
    } as const
    expect(
      yield* projectRunningHostRunControl({ direction: "RunUnpaused", observedAt, termination: null }, failure)
    ).toEqual({
      _tag: "RunUnpaused",
      controlObservedAt: observedAt,
      terminationEvidence: { _tag: "FinalityFailed", failure }
    })
    expect(
      yield* projectRunningHostRunControl({ direction: "RunTerminated", observedAt, termination: null }, failure).pipe(
        Effect.flip
      )
    ).toMatchObject({ _tag: "ProjectionFailed", causeTag: "TerminationEvidenceMissing" })
    const terminal = { disposition: "Completed", terminatedAt: observedAt } as const
    expect(
      yield* projectRunningHostRunControl({ direction: "RunUnpaused", observedAt, termination: terminal }, null).pipe(
        Effect.flip
      )
    ).toMatchObject({ _tag: "ProjectionFailed", causeTag: "ControlEvidenceConflict" })
    expect(
      yield* projectRunningHostRunControl(
        { direction: "RunUnpaused", observedAt, termination: null },
        { ...failure, runId: RunId.make("other") }
      ).pipe(Effect.flip)
    ).toMatchObject({ _tag: "ProjectionFailed", causeTag: "ControlEvidenceConflict" })
  })
)
