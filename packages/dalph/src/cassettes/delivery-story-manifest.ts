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
    | "packages/dalph/src/application/production-reactivation.test.ts"
    | "packages/dalph/test/cassettes/scenario.test.ts"
    | "packages/dalph/test/cassettes/delivery-story-capstone.execution.test.ts"
    | "packages/orchestrator/src/coordination/delivery/run-delivery-runtime.test.ts"
    | "packages/orchestrator/src/coordination/run/run-reactivation-owner.test.ts"
    | "prototypes/reducer-lab/src/cassette-lab.smoke.ts"
}

type DeliveryStoryBeatCoverage =
  | {
      readonly _tag: "DemonstratedBySpine"
      readonly acceptanceTests: readonly [DeliveryStoryAcceptanceTest, ...ReadonlyArray<DeliveryStoryAcceptanceTest>]
      readonly cassetteKeys: readonly ["authored:deliveryInvariantStory"]
    }
  | {
      readonly _tag: "DemonstratedByMaintainedSlice"
      readonly acceptanceTests: readonly [DeliveryStoryAcceptanceTest, ...ReadonlyArray<DeliveryStoryAcceptanceTest>]
      readonly cassetteKeys: readonly [
        `authored:${string}` | `integration-finality:${string}`,
        ...ReadonlyArray<`authored:${string}` | `integration-finality:${string}`>
      ]
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

const maintainedTest = (
  sourceFile: Extract<
    DeliveryStoryAcceptanceTest["sourceFile"],
    | "packages/dalph/src/application/production-reactivation.test.ts"
    | "packages/orchestrator/src/coordination/delivery/run-delivery-runtime.test.ts"
    | "packages/orchestrator/src/coordination/run/run-reactivation-owner.test.ts"
  >,
  name: string
): DeliveryStoryAcceptanceTest => ({ declaration: "it.effect", name, sourceFile })

const topologyTest = capstoneTest("consumes a staggered graph while restart-added X waits for recovered capacity")
const restartTest = capstoneTest("preserves the double-diamond middle positions across coordinator restart")
const checkpointTest = capstoneTest("emits the exact DS01 through DS13 delivery checkpoint table")
const choiceProjectionTest = capstoneTest(
  "captures B's exact F1 F2 choices from each production runtime observation through Continue"
)
const identityTest = capstoneTest("retains exact Run attempt claim and resource identities across DS01 through DS13")
const activeRefreshTest = capstoneTest(
  "publishes B F2 through one active refresh and rereads G1 after Safe before D begins"
)
const timerFallbackOwnerTest = maintainedTest(
  "packages/orchestrator/src/coordination/run/run-reactivation-owner.test.ts",
  "rechecks after a lost notification when TestClock fires, with no Run read per timer"
)
const timerSpecificationRefreshTest = maintainedTest(
  "packages/dalph/src/application/production-reactivation.test.ts",
  "accepted B F2 refresh suspends only B1 while A1 and C1 continue executing"
)
const runtimeObservationTest = maintainedTest(
  "packages/orchestrator/src/coordination/delivery/run-delivery-runtime.test.ts",
  "publishes current-first exact live-owner observations until standalone runtime quiescence"
)
const runtimeProjectionBridgeTest = scenarioTest(
  "reuses one delivery relation evaluation for the authored publication frame"
)
const bContinuationTest = capstoneTest("records B's F1-to-F2 transition and one same-attempt Continue and Resume")
const cSafeTest = capstoneTest("records exactly one C2 Safe ordinal before Continue B")
const authorityGroupTest = capstoneTest(
  "preserves the post-hint A D authority group without weakening the thirteen-beat story"
)
const admissionPriorityTest = capstoneTest("admits retained B ahead of unstarted E after A releases its position")
const autonomousCapstoneKey = ["authored:autonomousExecutorDeliveryCapstone"] as const

const slice = (
  beatId: DeliveryStoryBeatId,
  cassetteKeys: readonly [
    `authored:${string}` | `integration-finality:${string}`,
    ...ReadonlyArray<`authored:${string}` | `integration-finality:${string}`>
  ],
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
 * double-diamond graph/restart path; one maintained story proves the narrower early beats;
 * unsupported combined behavior remains explicit instead of fabricated.
 */
export const deliveryStoryManifest = {
  cassetteKey: "authored:deliveryInvariantStory" as const,
  cassetteAcceptanceTests: [topologyTest, restartTest],
  sourceDocument: "docs/DELIVERY-STORY.md" as const,
  beats: [
    slice("DS-01", autonomousCapstoneKey, checkpointTest, identityTest),
    slice("DS-02", autonomousCapstoneKey, checkpointTest, identityTest),
    slice("DS-03", autonomousCapstoneKey, checkpointTest, activeRefreshTest, authorityGroupTest),
    slice(
      "DS-04",
      autonomousCapstoneKey,
      checkpointTest,
      activeRefreshTest,
      timerFallbackOwnerTest,
      timerSpecificationRefreshTest,
      authorityGroupTest
    ),
    slice(
      "DS-05",
      autonomousCapstoneKey,
      checkpointTest,
      choiceProjectionTest,
      identityTest,
      runtimeObservationTest,
      runtimeProjectionBridgeTest
    ),
    slice(
      "DS-06",
      autonomousCapstoneKey,
      checkpointTest,
      choiceProjectionTest,
      identityTest,
      runtimeObservationTest,
      runtimeProjectionBridgeTest
    ),
    slice(
      "DS-07",
      autonomousCapstoneKey,
      checkpointTest,
      choiceProjectionTest,
      identityTest,
      runtimeObservationTest,
      runtimeProjectionBridgeTest
    ),
    slice(
      "DS-08",
      autonomousCapstoneKey,
      checkpointTest,
      choiceProjectionTest,
      identityTest,
      runtimeObservationTest,
      runtimeProjectionBridgeTest
    ),
    slice(
      "DS-09",
      autonomousCapstoneKey,
      checkpointTest,
      choiceProjectionTest,
      identityTest,
      runtimeObservationTest,
      runtimeProjectionBridgeTest
    ),
    slice(
      "DS-10",
      autonomousCapstoneKey,
      checkpointTest,
      choiceProjectionTest,
      identityTest,
      runtimeObservationTest,
      runtimeProjectionBridgeTest
    ),
    slice(
      "DS-11",
      autonomousCapstoneKey,
      checkpointTest,
      choiceProjectionTest,
      identityTest,
      cSafeTest,
      runtimeObservationTest,
      runtimeProjectionBridgeTest
    ),
    slice("DS-12", autonomousCapstoneKey, checkpointTest, cSafeTest, bContinuationTest),
    slice("DS-13", autonomousCapstoneKey, checkpointTest, identityTest, admissionPriorityTest, bContinuationTest),
    slice(
      "DS-14",
      ["authored:acceptedResultRestartsIntoIntegration"],
      scenarioTest("continues an accepted result after process death and crosses its integration cutoff once")
    ),
    missing(
      "DS-15",
      "No named acceptance test proves the candidate's exact ordered expected-head and accepted-result parents for this beat."
    ),
    missing(
      "DS-16",
      "The maintained stale-head cassette detects H2 before compare-and-set; it does not send the beat's rejected exact-head offer."
    ),
    missing(
      "DS-17",
      "The separate A-finality spine settles A, but does not first reconcile a stale head and rebuild its successor candidate."
    ),
    missing(
      "DS-18",
      "No maintained run reopens a tracker lifecycle wait for C; Operator task Unpause is a different phenomenon."
    ),
    missing("DS-19", "No maintained run combines the retained C attempt with a later capacity increase."),
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
