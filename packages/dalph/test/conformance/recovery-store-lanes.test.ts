import { GitCommitSha, RunId } from "@dalph/contracts"
import {
  AttemptBasePolicy,
  FixtureTarget,
  InitialControlPolicy,
  makeWorkflowRunBeganRecord,
  TaskWorkCapacity
} from "@dalph/orchestrator"
import { it } from "@effect/vitest"
import { Effect } from "effect"
import { expect } from "vitest"
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
        const record = makeWorkflowRunBeganRecord(
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
