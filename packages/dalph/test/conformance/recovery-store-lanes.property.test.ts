import {
  GitCommitSha,
  RunId,
  RemotePublicationTarget,
  RemotePublicationEndpoint,
  RemotePublicationBranchRef,
  IntegrationTarget,
  IntegrationTargetRef
} from "@dalph/contracts"
import {
  AttemptBasePolicy,
  JournalRecord,
  JournalPosition,
  RunPolicyRevision,
  WorkflowRunBeganEvent,
  TaskWorkCapacityChangedEvent,
  makeWorkflowRunBeganRecord,
  FixtureTarget,
  InitialControlPolicy,
  makeHistoricalWorkflowRunBeganRecord,
  TaskWorkCapacity
} from "@dalph/orchestrator"
import { it } from "@effect/vitest"
import { Effect, Schema } from "effect"
import fc from "fast-check"
import {
  workflowRunBeganRecordKey,
  taskWorkCapacityPolicyRecordKey
} from "../../../orchestrator/src/workflow-journal/record-key.js"
import { expect, expectTypeOf, test } from "vitest"
import { remotePublicationTargetForTest } from "../../../orchestrator/test/support/direct-publication.js"
import { replayRecoveryPrefix, type RecoveryPrefix } from "./recovery-store-lanes.js"

for (const lane of ["memory", "sqlite"] as const) {
  for (const policy of [
    undefined,
    AttemptBasePolicy.cases.ExplicitFixedBase.make({ baseSha: GitCommitSha.make("1".repeat(40)) })
  ]) {
    const chronology = policy === undefined ? "historical missing policy" : "contemporary fixed Base"
    it.effect(`preserves ${chronology} when replaying a retained prefix through ${lane}`, () =>
      Effect.gen(function* () {
        const record = makeHistoricalWorkflowRunBeganRecord(
          RunId.make(`base-policy-prefix:${lane}`),
          FixtureTarget.make("base-policy-prefix"),
          InitialControlPolicy.make({ taskExecutionCapacity: TaskWorkCapacity.make(1) }),
          remotePublicationTargetForTest,
          policy
        )
        const prefix: RecoveryPrefix = { cut: "P0", endpoint: "Run began", records: [record] }
        const replayed = yield* replayRecoveryPrefix(prefix, lane)
        expect(replayed.historyTag).toBe("ValidWorkflowJournalHistory")
        expect(replayed.decodedRecords).toEqual(prefix.records)
        const began = replayed.decodedRecords[0]
        expect(began?.event).toMatchObject({ _tag: "WorkflowRunBegan" })
        if (policy === undefined) expect(began?.event).not.toHaveProperty("attemptBasePolicy")
        else expect(began?.event).toMatchObject({ attemptBasePolicy: policy })
      })
    )
  }
}

// Derive event fields from the production schema so future optional fields enter the oracle.
const refArbitrary = fc.integer({ min: 1, max: 1000 }).map((n) => `refs/heads/property-${n}`)
const integrationTargetSchema = Schema.Struct({
  ...IntegrationTarget.fields,
  ref: IntegrationTargetRef.annotate({
    toArbitrary: () => () => refArbitrary.map((value) => IntegrationTargetRef.make(value))
  })
})
const policySchema = Schema.Union([
  AttemptBasePolicy.cases.ExplicitFixedBase,
  Schema.Struct({
    ...AttemptBasePolicy.cases.QualifiedCurrentIntegrationHead.fields,
    integrationTarget: integrationTargetSchema
  })
])
const targetSchema = Schema.Struct({
  ...RemotePublicationTarget.fields,
  endpoint: RemotePublicationEndpoint.annotate({
    toArbitrary: () => () =>
      fc
        .integer({ min: 1, max: 1000 })
        .map((n) => RemotePublicationEndpoint.make(`ssh://git@example.invalid/property-${n}.git`))
  }),
  branch: RemotePublicationBranchRef.annotate({
    toArbitrary: () => () => refArbitrary.map((value) => RemotePublicationBranchRef.make(value))
  })
})
const generatedBeganSchema = Schema.Struct({
  ...WorkflowRunBeganEvent.fields,
  attemptBasePolicy: Schema.optional(policySchema),
  remotePublicationTarget: targetSchema
})
const beganArbitrary = Schema.toArbitrary(generatedBeganSchema)(fc).map((event) =>
  Schema.decodeUnknownSync(WorkflowRunBeganEvent)(
    JSON.parse(JSON.stringify(Schema.encodeUnknownSync(WorkflowRunBeganEvent)(event)))
  )
)
const capacityArbitrary = Schema.toArbitrary(TaskWorkCapacityChangedEvent)(fc)
const historyArbitrary = fc
  .tuple(beganArbitrary, fc.array(capacityArbitrary, { maxLength: 4 }))
  .map(([event, changes]) => {
    const runId = RunId.make("history-copy-property:481")
    const began = JournalRecord.make({
      event,
      runId,
      position: JournalPosition.make(1),
      key: workflowRunBeganRecordKey
    })
    const records = changes.map((change, index) =>
      JournalRecord.make({
        event: {
          ...change,
          previousRevision: RunPolicyRevision.make(index + 1),
          revision: RunPolicyRevision.make(index + 2)
        },
        runId,
        position: JournalPosition.make(index + 2),
        key: taskWorkCapacityPolicyRecordKey(RunPolicyRevision.make(index + 2))
      })
    )
    return {
      cut: "P0",
      endpoint: "generated beginning and capacity history",
      records: [began, ...records]
    } satisfies RecoveryPrefix
  })

for (const lane of ["memory", "sqlite"] as const) {
  test(`preserves every field of generated valid history through ${lane}`, () =>
    fc.assert(
      fc.asyncProperty(historyArbitrary, async (prefix) => {
        const copied = await Effect.runPromise(replayRecoveryPrefix(prefix, lane))
        expect(copied.historyTag).toBe("ValidWorkflowJournalHistory")
        expect(copied.decodedRecords).toEqual(prefix.records)
      }),
      { seed: 481, numRuns: 32 }
    ))

  test(`detects a policy-dropping copy mutation through ${lane}`, async () => {
    const modernHistory = historyArbitrary.map((prefix) => {
      const first = prefix.records[0]
      if (first.event._tag !== "WorkflowRunBegan") throw new Error("generator must begin a Run")
      return {
        ...prefix,
        records: [
          {
            ...first,
            event: {
              ...first.event,
              attemptBasePolicy: AttemptBasePolicy.cases.ExplicitFixedBase.make({
                baseSha: GitCommitSha.make("1".repeat(40))
              })
            }
          },
          ...prefix.records.slice(1)
        ]
      } satisfies RecoveryPrefix
    })
    const result = await fc.check(
      fc.asyncProperty(modernHistory, async (prefix) => {
        const first = prefix.records[0]
        const mutant = makeHistoricalWorkflowRunBeganRecord(
          first.runId,
          first.event.target,
          first.event.initialControlPolicy,
          first.event.remotePublicationTarget
        )
        const copied = await Effect.runPromise(
          replayRecoveryPrefix({ ...prefix, records: [mutant, ...prefix.records.slice(1)] }, lane)
        )
        expect(copied.decodedRecords).toEqual(prefix.records)
      }),
      { seed: 481, numRuns: 1, endOnFailure: true }
    )
    expect(result.failed).toBe(true)
    expect(result.counterexample).not.toBeNull()
  })
}

test("requires the modern constructor policy while the historical path remains explicit", () => {
  expectTypeOf(makeWorkflowRunBeganRecord).parameter(4).toEqualTypeOf<AttemptBasePolicy>()
  expectTypeOf(makeHistoricalWorkflowRunBeganRecord).parameter(4).toEqualTypeOf<AttemptBasePolicy | undefined>()
})
