import { it } from "@effect/vitest"
import { Effect } from "effect"
import { expect } from "vitest"
import { FixtureTarget } from "../../../authorities/task-tracker/fixture/target.js"
import { TaskWorkCapacity } from "../../../coordination/admission/capacity.js"
import { InitialControlPolicy } from "../../../control/policy.js"
import { memoryJournalTestLayer } from "../../../workflow-journal/adapters/memory-store.js"
import {
  targetPromotionAttemptIntentRecordKey,
  targetPromotionIntentRecordKey,
  targetPromotionStaleRecordKey
} from "../../../workflow-journal/record-key.js"
import { JournalStore } from "../../../workflow-journal/store.js"
import { workflowJournalEventVersion } from "../../kernel/event.js"
import { integrationFinalityFixture } from "../integration-finality/fixtures.js"
import {
  TargetPromotionAttemptIntendedEvent,
  TargetPromotionAttemptOrdinal,
  TargetPromotionAttemptReason,
  targetPromotionCorrelationFor,
  TargetPromotionIntendedEvent,
  TargetPromotionStaleEvent,
  TargetPromotionStaleObservation,
  TargetPromotionTerminalBasis
} from "../target-promotion/events.js"
import {
  appendPromotionStaleIntegrationQuarantine,
  IntegrationPromotionStaleQuarantineRejected
} from "./promotion-stale.js"

const candidate = integrationFinalityFixture.qualifiedCandidate
const correlation = targetPromotionCorrelationFor(candidate)
const runId = candidate.run.session.plannedAttempt.runId
const target = FixtureTarget.make("promotion-stale-quarantine-target")
const attemptOrdinal = TargetPromotionAttemptOrdinal.make(1)
const changedHead = candidate.run.session.acceptedResult.commit

type StaleKind = "BeforeFirstAttempt" | "ReconciledAfterAttempt" | "RejectedWithoutIntent" | "RejectedAfterAttempt"

const appendStaleScenario = Effect.fn("PromotionStaleQuarantineTest.appendScenario")(function* (kind: StaleKind) {
  const journal = yield* JournalStore
  yield* journal.beginRun(runId, target, InitialControlPolicy.make({ taskExecutionCapacity: TaskWorkCapacity.make(1) }))
  yield* journal.append(
    runId,
    targetPromotionIntentRecordKey(correlation.requestId),
    TargetPromotionIntendedEvent.make({ correlation, version: workflowJournalEventVersion })
  )
  if (kind === "RejectedAfterAttempt" || kind === "ReconciledAfterAttempt") {
    yield* journal.append(
      runId,
      targetPromotionAttemptIntentRecordKey(correlation.requestId, attemptOrdinal),
      TargetPromotionAttemptIntendedEvent.make({
        attemptOrdinal,
        correlation,
        reason: TargetPromotionAttemptReason.cases.Initial.make({
          observedHeadSha: candidate.run.session.expectedTargetHead
        }),
        version: workflowJournalEventVersion
      })
    )
  }
  const afterAttempt = kind !== "BeforeFirstAttempt"
  const compareAndSetRejected = kind === "RejectedAfterAttempt" || kind === "RejectedWithoutIntent"
  return yield* journal.append(
    runId,
    targetPromotionStaleRecordKey(correlation.requestId),
    TargetPromotionStaleEvent.make({
      basis: afterAttempt
        ? TargetPromotionTerminalBasis.cases.AfterAttempt.make({ attemptOrdinal })
        : TargetPromotionTerminalBasis.cases.BeforeFirstAttempt.make({}),
      correlation,
      observation: compareAndSetRejected
        ? TargetPromotionStaleObservation.cases.CompareAndSetRejected.make({ observedHeadSha: changedHead })
        : TargetPromotionStaleObservation.cases.ReconciledCandidateNotInAncestry.make({ observedHeadSha: changedHead }),
      version: workflowJournalEventVersion
    })
  )
})

const appendQuarantineFor = Effect.fn("PromotionStaleQuarantineTest.appendQuarantineFor")(function* (kind: StaleKind) {
  const stale = yield* appendStaleScenario(kind)
  return yield* appendPromotionStaleIntegrationQuarantine({ correlation, targetPromotionStaleAt: stale.position })
})

it.effect("rejects Q before an actual correlated compare-and-set rejection", () =>
  Effect.gen(function* () {
    for (const kind of ["BeforeFirstAttempt", "ReconciledAfterAttempt", "RejectedWithoutIntent"] as const) {
      const failure = yield* appendQuarantineFor(kind).pipe(Effect.provide(memoryJournalTestLayer), Effect.flip)
      expect(failure).toBeInstanceOf(IntegrationPromotionStaleQuarantineRejected)
    }
  })
)

it.effect("records one idempotent Q after the exact correlated compare-and-set rejection", () =>
  Effect.gen(function* () {
    const first = yield* appendQuarantineFor("RejectedAfterAttempt")
    const second = yield* appendPromotionStaleIntegrationQuarantine({
      correlation,
      targetPromotionStaleAt:
        first.event.basis._tag === "PromotionStale" ? first.event.basis.targetPromotionStaleAt : first.position
    })
    expect(first.event._tag).toBe("IntegrationQuarantined")
    expect(first.event.basis._tag).toBe("PromotionStale")
    expect(second).toEqual(first)
  }).pipe(Effect.provide(memoryJournalTestLayer))
)
