import { it } from "@effect/vitest"
import { NodeCrypto } from "@effect/platform-node"
import { Effect, Schema } from "effect"
import { expect } from "vitest"
import {
  JournalPosition,
  JournalRecord,
  JournalRecordKey,
  PlannedAttemptReplacedEvent,
  workflowJournalEventVersion
} from "@dalph/orchestrator"
import {
  maintainedAuthoredCassetteCatalog,
  maintainedIntegrationFinalityProtocolCassetteCatalog,
  runAuthoredScenarioCassette,
  runIntegrationFinalityProtocolCassetteFromPromotedRecords
} from "../../src/cassettes/index.js"
import { IntegrationFinalityProtocolCassette } from "../../src/cassettes/integration-finality-protocol-cassette-domain.js"

const runAuthored = (input: unknown) => runAuthoredScenarioCassette(input).pipe(Effect.provide(NodeCrypto.layer))

const replacementEventFor = Effect.fn("IntegrationFinalityProtocolCassetteTest.replacementEventFor")(function* (
  records: ReadonlyArray<JournalRecord>
) {
  const plan = records.find(({ event }) => event._tag === "TaskAttemptPlanned")?.event
  const acquisition = records.find(({ event }) => event._tag === "TaskClaimAcquired")?.event
  if (plan?._tag !== "TaskAttemptPlanned" || acquisition?._tag !== "TaskClaimAcquired") {
    return yield* Effect.die("promoted fixture did not record its plan and exact active claim")
  }
  const prior = plan.operation.plannedAttempt
  const successor = {
    ...prior,
    attemptId: `${prior.attemptId}:replacement-fixture`,
    branch: "refs/heads/dalph/integration-finality-replacement-fixture",
    taskRevision: `${prior.taskRevision}:replacement-fixture`,
    worktree: "/dalph/cassettes/integration-finality-replacement-fixture"
  }
  const observationIds = {
    claim: "integration-finality-replacement-claim-read",
    graph: "integration-finality-replacement-graph-read",
    specification: "integration-finality-replacement-specification-read",
    target: "integration-finality-replacement-target-read",
    worktree: "integration-finality-replacement-worktree-read"
  }
  const predecessorOperationIds = [
    acquisition.claim.operationId,
    observationIds.claim,
    observationIds.graph,
    observationIds.specification,
    observationIds.target,
    observationIds.worktree
  ]
  return yield* Schema.decodeUnknownEffect(PlannedAttemptReplacedEvent)({
    _tag: "PlannedAttemptReplaced",
    initiatedBy: { _tag: "DalphCoordinator" },
    occurrenceClassification: "InitiatedAction",
    requestId: { nonce: "integration-finality-replacement-fixture", runId: prior.runId },
    subject: { observedTaskRevision: successor.taskRevision, plannedAttempt: prior },
    successorPlan: {
      _tag: "RecordTaskAttemptPlan",
      operationId: "integration-finality-replacement-plan",
      plannedAttempt: successor,
      predecessorOperationIds
    },
    version: workflowJournalEventVersion,
    witness: {
      claimObservationOperationId: observationIds.claim,
      expectedClaim: acquisition.claim,
      graphObservationOperationId: observationIds.graph,
      oldWorktreeObservationOperationId: observationIds.worktree,
      oldWorktreeProof: {
        _tag: "PlannedWorktreeReady",
        baseSha: prior.baseSha,
        branch: prior.branch,
        headSha: prior.baseSha,
        worktree: prior.worktree
      },
      quiescenceProof: { _tag: "CommandResponse", reportOrdinal: 1 },
      specificationObservationOperationId: observationIds.specification,
      targetHeadSha: successor.baseSha,
      targetLineageObservationOperationId: observationIds.target
    }
  }).pipe(Effect.orDie)
})

it.effect("accepts a promoted history containing a replacement plan while selecting the promoted plan", () =>
  Effect.gen(function* () {
    const promoted = yield* runAuthored(maintainedAuthoredCassetteCatalog.targetPromotionSuccess)
    const replacement = yield* replacementEventFor(promoted.records)

    const replacementRecord = JournalRecord.make({
      event: replacement,
      key: JournalRecordKey.make("integration-finality-replacement-fixture"),
      position: JournalPosition.make(promoted.records.length + 1),
      runId: promoted.runId
    })
    const finalized = yield* runIntegrationFinalityProtocolCassetteFromPromotedRecords(
      maintainedIntegrationFinalityProtocolCassetteCatalog.deletesOnlyTheExactCompletionClaimAfterFocusedTaskSuccess,
      [...promoted.records, replacementRecord]
    )

    expect(finalized.failureTag).toBeNull()
    expect(finalized.records.some(({ event }) => event._tag === "IntegrationFinalitySettled")).toBe(true)
  })
)

it("rejects active-record absence as a completion-marker absence result", () => {
  const exact =
    maintainedIntegrationFinalityProtocolCassetteCatalog.deletesOnlyTheExactCompletionClaimAfterFocusedTaskSuccess
  const collapsed = {
    ...exact,
    boundaryResults: exact.boundaryResults.map((result) =>
      result._tag === "ReadCompletionMarkerAbsent" ? { _tag: "ReadUnclaimed" } : result
    )
  }

  expect(() => Schema.decodeUnknownSync(IntegrationFinalityProtocolCassette)(collapsed)).toThrow()
})
