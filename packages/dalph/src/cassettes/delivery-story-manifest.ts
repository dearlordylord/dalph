const deliveryStoryBeatIds = [
  "DS-01",
  "DS-02",
  "DS-03",
  "DS-04",
  "DS-05",
  "DS-06",
  "DS-07",
  "DS-08",
  "DS-09",
  "DS-10",
  "DS-11",
  "DS-12",
  "DS-13",
  "DS-14",
  "DS-15",
  "DS-16",
  "DS-17",
  "DS-18",
  "DS-19",
  "DS-20",
  "DS-21",
  "DS-22"
] as const

/** Stable identity of one numbered beat in docs/DELIVERY-STORY.md. */
type DeliveryStoryBeatId = (typeof deliveryStoryBeatIds)[number]

interface DeliveryStoryAcceptanceTest {
  readonly declaration: "it" | "it.effect" | "scenario"
  readonly name: string
  readonly sourceFile:
    | "packages/orchestrator/src/coordination/frontier/integration-frontier-transitions.test.ts"
    | "packages/orchestrator/src/workflow/protocols/integration-quarantine/promotion-stale.test.ts"
    | "packages/orchestrator/src/workflow/protocols/integration-quarantine/protocol.test.ts"
    | "packages/orchestrator/src/workflow/protocols/integration-finality/protocol.test.ts"
    | "packages/orchestrator/src/workflow/protocols/integrator/successor-session.test.ts"
    | "packages/dalph/test/cassettes/scenario.test.ts"
    | "packages/dalph/test/cassettes/delivery-story-capstone.execution.test.ts"
    | "packages/dalph/test/cassettes/issue-274-lifecycle-resume.test.ts"
    | "prototypes/reducer-lab/src/cassette-lab.smoke.ts"
}

type DeliveryStoryCassetteKey = `authored:${string}` | `controlled:${string}` | `integration-finality:${string}`

type DeliveryStoryBeatCoverage =
  | {
      readonly _tag: "DemonstratedBySpine"
      readonly acceptanceTests: readonly [DeliveryStoryAcceptanceTest, ...ReadonlyArray<DeliveryStoryAcceptanceTest>]
      readonly cassetteKeys: readonly ["authored:deliveryInvariantStory"]
    }
  | {
      readonly _tag: "DemonstratedByMaintainedSlice"
      readonly acceptanceTests: readonly [DeliveryStoryAcceptanceTest, ...ReadonlyArray<DeliveryStoryAcceptanceTest>]
      readonly cassetteKeys: readonly [DeliveryStoryCassetteKey, ...ReadonlyArray<DeliveryStoryCassetteKey>]
    }
  | {
      readonly _tag: "NotImplemented"
      readonly acceptanceTests: readonly []
      readonly cassetteKeys: readonly []
      readonly reason: string
    }

interface DeliveryStoryBeatManifestEntry {
  readonly beatId: DeliveryStoryBeatId
  readonly coverage: DeliveryStoryBeatCoverage
}

const scenarioTest = (name: string): DeliveryStoryAcceptanceTest => ({
  declaration: "it.effect",
  name,
  sourceFile: "packages/dalph/test/cassettes/scenario.test.ts"
})

const capstoneTest = (name: string): DeliveryStoryAcceptanceTest => ({
  declaration: "it.effect",
  name,
  sourceFile: "packages/dalph/test/cassettes/delivery-story-capstone.execution.test.ts"
})

const orchestratorTest = (
  sourceFile: Extract<DeliveryStoryAcceptanceTest["sourceFile"], `packages/orchestrator/${string}`>,
  declaration: "it" | "it.effect",
  name: string
): DeliveryStoryAcceptanceTest => ({ declaration, name, sourceFile })

const topologyTest = capstoneTest("consumes a staggered graph while restart-added X waits for recovered capacity")
const restartTest = capstoneTest("preserves the double-diamond middle positions across coordinator restart")
const issue268CheckpointTable = capstoneTest("emits the exact DS01 through DS13 delivery checkpoint table")
const issue268OccurrenceCassette = capstoneTest("consumes exactly the accepted issue 268 occurrence inventory")
const ds14ThroughDs17Test = capstoneTest(
  "executes DS-14 through DS-17 from rejected exact-head offer through Operator-authorized successor finality"
)
const ds15NegativeTest = capstoneTest("rejects DS-15 evidence when M or M2 lacks exact ordered head-then-C parents")
const ds16NegativeTest = capstoneTest(
  "rejects DS16 evidence without the rejected CAS attempt or with a pre-request stale read"
)
const ds14ThroughDs17PrefixHistoryTest = capstoneTest(
  "accepts every DS-14 through DS-17 checkpoint prefix as valid history with at most one recorded successor, promotion, and completion attempt"
)
const ds14ThroughDs17ComposedRestartTest = capstoneTest(
  "resumes the composed DS-14 through DS-17 path after every CAS-to-successor durable checkpoint"
)
const ds17FinalityRestartTests = [
  capstoneTest("resumes exact DS-17 finality after TargetPromotionObservedSuccess durable checkpoint"),
  capstoneTest("resumes exact DS-17 finality after CompletionClaimReplaced durable checkpoint"),
  capstoneTest("resumes exact DS-17 finality after CompletionTaskAcknowledged durable checkpoint"),
  capstoneTest("resumes exact DS-17 finality after CompletionClaimDeleted durable checkpoint"),
  capstoneTest("resumes exact DS-17 finality after IntegrationFinalitySettled durable checkpoint")
] as const
const promotionStaleRestartTest = orchestratorTest(
  "packages/orchestrator/src/workflow/protocols/integration-quarantine/promotion-stale.test.ts",
  "it.effect",
  "checks Git after losing the compare-and-set response and records at most one quarantine"
)
const fullRerunDirectionRedeliveryTest = orchestratorTest(
  "packages/orchestrator/src/workflow/protocols/integration-quarantine/protocol.test.ts",
  "it.effect",
  "reconciles every ambiguous direction append outcome against the Journal winner"
)
const fullRerunPredecessorFactNegativeTest = orchestratorTest(
  "packages/orchestrator/src/workflow/protocols/integrator/successor-session.test.ts",
  "it.effect",
  "rejects every missing or contradictory FullRerun predecessor fact before appending S2"
)
const reusedSuccessorIdentityNegativeTest = orchestratorTest(
  "packages/orchestrator/src/workflow/protocols/integrator/successor-session.test.ts",
  "it",
  "rejects a FullRerun successor that reuses predecessor identities"
)
const foreignCompletionClaimNegativeTest = orchestratorTest(
  "packages/orchestrator/src/workflow/protocols/integration-finality/protocol.test.ts",
  "it.effect",
  "does not delete when the completion marker disappears or changes before the first delete"
)
const successorSessionRestartTest = orchestratorTest(
  "packages/orchestrator/src/workflow/protocols/integrator/successor-session.test.ts",
  "it.effect",
  "recovers a recorded full rerun without creating a second successor"
)
const successorDeliveryRestartTest = orchestratorTest(
  "packages/orchestrator/src/coordination/frontier/integration-frontier-transitions.test.ts",
  "it",
  "delivers the already-recorded FullRerun successor after restart"
)
const issue268CassetteKeys = ["controlled:issue268Ds01ThroughDs13"] as const
const issue268BeatIds = deliveryStoryBeatIds.slice(0, deliveryStoryBeatIds.indexOf("DS-13") + 1)

const slice = (
  beatId: DeliveryStoryBeatId,
  cassetteKeys: readonly [DeliveryStoryCassetteKey, ...ReadonlyArray<DeliveryStoryCassetteKey>],
  ...acceptanceTests: readonly [DeliveryStoryAcceptanceTest, ...ReadonlyArray<DeliveryStoryAcceptanceTest>]
): DeliveryStoryBeatManifestEntry => ({
  beatId,
  coverage: { _tag: "DemonstratedByMaintainedSlice", acceptanceTests, cassetteKeys }
})

const missing = (beatId: DeliveryStoryBeatId, reason: string): DeliveryStoryBeatManifestEntry => ({
  beatId,
  coverage: { _tag: "NotImplemented", acceptanceTests: [], cassetteKeys: [], reason }
})

/**
 * Machine-readable coverage for the prose story. The long spine proves the
 * double-diamond graph/restart path; one maintained story proves one narrower beat;
 * unsupported combined behavior remains explicit instead of fabricated.
 */
export const deliveryStoryManifest = {
  cassetteKey: "authored:deliveryInvariantStory" as const,
  cassetteAcceptanceTests: [topologyTest, restartTest],
  sourceDocument: "docs/DELIVERY-STORY.md" as const,
  beats: [
    ...issue268BeatIds.map((beatId) =>
      slice(beatId, issue268CassetteKeys, issue268CheckpointTable, issue268OccurrenceCassette)
    ),
    slice(
      "DS-14",
      ["authored:deliveryStoryDs14ThroughDs17", "authored:acceptedResultRestartsIntoIntegration"],
      ds14ThroughDs17Test,
      ds14ThroughDs17ComposedRestartTest,
      ds14ThroughDs17PrefixHistoryTest,
      scenarioTest("continues an accepted result after process death and crosses its integration cutoff once")
    ),
    slice(
      "DS-15",
      ["authored:deliveryStoryDs14ThroughDs17"],
      ds14ThroughDs17Test,
      ds15NegativeTest,
      ds14ThroughDs17ComposedRestartTest,
      ds14ThroughDs17PrefixHistoryTest
    ),
    slice(
      "DS-16",
      ["authored:deliveryStoryDs14ThroughDs17"],
      ds14ThroughDs17Test,
      ds16NegativeTest,
      ds14ThroughDs17ComposedRestartTest,
      ds14ThroughDs17PrefixHistoryTest,
      promotionStaleRestartTest
    ),
    slice(
      "DS-17",
      [
        "authored:deliveryStoryDs14ThroughDs17",
        "authored:ambiguousCompletionResponse",
        "integration-finality:restartAfterPromotionResumesCompletionSettlementWithoutAnotherIntegrationAgent",
        "integration-finality:reconcilesALostCompletionClaimReplacementWithoutAllocatingAnotherClaim",
        "integration-finality:doesNotMutateAForeignClaimWhileSettlingAPromotedTask",
        "integration-finality:deletesOnlyTheExactCompletionClaimAfterFocusedTaskSuccess",
        "integration-finality:reconcilesALostCompletionClaimDeletionWithoutReopeningSuccess"
      ],
      ds14ThroughDs17Test,
      ds14ThroughDs17ComposedRestartTest,
      ...ds17FinalityRestartTests,
      ds14ThroughDs17PrefixHistoryTest,
      fullRerunDirectionRedeliveryTest,
      fullRerunPredecessorFactNegativeTest,
      reusedSuccessorIdentityNegativeTest,
      foreignCompletionClaimNegativeTest,
      successorSessionRestartTest,
      successorDeliveryRestartTest,
      scenarioTest("restart after promotion resumes completion settlement without another integration agent"),
      scenarioTest("reconciles a lost completion-claim replacement without allocating another claim"),
      scenarioTest("Dalph checks A after losing the tracker completion response"),
      scenarioTest("does not mutate a foreign claim while settling a promoted task"),
      scenarioTest("deletes only the exact completion claim after focused task success"),
      scenarioTest("reconciles a lost completion-claim deletion without reopening success"),
      scenarioTest("reconstructs and round-trips interrupted and settled completion-cleanup Run prefixes")
    ),
    slice("DS-18", ["controlled:issue274LifecycleReopen"], {
      declaration: "it.effect",
      sourceFile: "packages/dalph/test/cassettes/issue-274-lifecycle-resume.test.ts",
      name: "reopens C and resumes its original attempt only after accepted capacity three"
    }),
    slice(
      "DS-19",
      ["controlled:issue274LifecycleReopen", "controlled:issue274LostResumeResponse"],
      {
        declaration: "it.effect",
        sourceFile: "packages/dalph/test/cassettes/issue-274-lifecycle-resume.test.ts",
        name: "reopens C and resumes its original attempt only after accepted capacity three"
      },
      {
        declaration: "it.effect",
        sourceFile: "packages/dalph/test/cassettes/issue-274-lifecycle-resume.test.ts",
        name: "reconciles C's lost Resume response after restart without another Begin or Resume"
      }
    ),
    missing(
      "DS-20",
      "The maintained staggered graph adds X during process loss and delays it behind reconstructed B/C positions; it does not add F and G behind three running tasks."
    ),
    missing("DS-21", "No maintained authored run finalizes B, C, and D and admits E, F, and G in one chronology."),
    missing(
      "DS-22",
      "The maintained staggered ten-task cassette finalizes all ten accepted results and terminates, but it is not the prose beat's seven-task G5 chronology for E, F, and G."
    )
  ] satisfies ReadonlyArray<DeliveryStoryBeatManifestEntry>
} as const

const coverageLabel = (coverage: DeliveryStoryBeatCoverage): string =>
  coverage._tag === "NotImplemented"
    ? `${coverage._tag}|${coverage.reason}`
    : `${coverage._tag}|${coverage.cassetteKeys.join(",")}|${coverage.acceptanceTests
        .map(({ declaration, name, sourceFile }) => `${sourceFile}#${declaration}#${name}`)
        .join(",")}`

/** Exact checked-in documentation block; tests require byte-for-byte parity. */
export const renderDeliveryStoryManifest = (): string =>
  [
    "<!-- DELIVERY-STORY-MANIFEST:START -->",
    `cassette|${deliveryStoryManifest.cassetteKey}`,
    ...deliveryStoryManifest.cassetteAcceptanceTests.map(
      ({ declaration, name, sourceFile }) => `cassette-test|${sourceFile}#${declaration}#${name}`
    ),
    ...deliveryStoryManifest.beats.map(({ beatId, coverage }) => `${beatId}|${coverageLabel(coverage)}`),
    "<!-- DELIVERY-STORY-MANIFEST:END -->"
  ].join("\n")
