import { expect, it } from "vitest"
import { Schema } from "effect"
import { WorktreeLocator } from "@dalph/contracts"
import {
  TargetPromotionState,
  TargetPromotionPendingRetry,
  TargetPromotionSafetyObservationOrdinal,
  targetPromotionCorrelationFor
} from "@dalph/orchestrator"
import { integrationFinalityFixture } from "../../../orchestrator/src/workflow/protocols/integration-finality/fixtures.js"
import { publicDeliveryStatusEntryOf } from "./production-cli-status-projection.js"
import { PublicDeliveryStatusEntry } from "./production-cli-status-schema.js"

it("publishes an occupied promotion blocker with exact target and worktree without executable authority", () => {
  const candidate = integrationFinalityFixture.qualifiedCandidate
  const planned = candidate.run.session.plannedAttempt
  const state = TargetPromotionState.cases.PromotionSafetyRefused.make({
    boundary: "ReconciliationRead",
    correlation: targetPromotionCorrelationFor(candidate),
    retry: TargetPromotionPendingRetry.cases.NeedInitialReconciliationRead.make({}),
    observationOrdinal: TargetPromotionSafetyObservationOrdinal.make(1),
    refusal: { _tag: "OccupiedWorktree", worktree: WorktreeLocator.make("/foreign/dirty-worktree") }
  })
  const entry = publicDeliveryStatusEntryOf({
    _tag: "TargetPromotionSafetyRefused",
    classification: "Blocked",
    subject: { _tag: "Task", runId: planned.runId, taskId: planned.taskId },
    standing: { _tag: "TargetPromotionSafetyRefused", state }
  })
  const decoded = Schema.decodeUnknownSync(PublicDeliveryStatusEntry)(JSON.parse(JSON.stringify(entry)))
  expect(decoded).toMatchObject({
    _tag: "TargetPromotionSafetyRefused",
    classification: "Blocked",
    taskId: planned.taskId,
    integrationTarget: candidate.run.session.integrationTarget,
    candidateCommit: candidate.candidateCommit,
    refusal: { _tag: "OccupiedWorktree", worktree: "/foreign/dirty-worktree" }
  })
  expect("standing" in decoded).toBe(false)
  expect("correlation" in decoded).toBe(false)
  expect(() => Schema.decodeUnknownSync(PublicDeliveryStatusEntry)({ ...entry, taskId: "foreign-task" })).toThrow()
})
