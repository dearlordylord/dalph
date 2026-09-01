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
    | "packages/dalph/test/cassettes/scenario.test.ts"
    | "packages/dalph/test/cassettes/delivery-story-capstone.execution.test.ts"
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

const topologyTest = capstoneTest("consumes a staggered graph while restart-added X waits for recovered capacity")
const restartTest = capstoneTest("preserves the double-diamond middle positions across coordinator restart")
const checkpointTest = capstoneTest("emits the exact DS01 through DS13 delivery checkpoint table")
const identityTest = capstoneTest("retains exact Run attempt claim and resource identities across DS01 through DS13")
const bChoiceTest = capstoneTest("records B's F1-to-F2 choice and one same-attempt Continue and Resume")
const capacityTest = capstoneTest("observes reduced capacity revision two before the authored restart cut")
const cSafeTest = capstoneTest("records exactly one C2 Safe ordinal before Continue B")
const reconstructedRestartTest = capstoneTest(
  "runs reconstructed ordinary activation through strict exact projections before returning unsettled responsibility"
)
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
    slice("DS-02", autonomousCapstoneKey, checkpointTest, identityTest, bChoiceTest),
    slice("DS-03", autonomousCapstoneKey, checkpointTest, bChoiceTest, authorityGroupTest),
    slice("DS-04", autonomousCapstoneKey, checkpointTest, authorityGroupTest),
    slice("DS-05", autonomousCapstoneKey, checkpointTest, bChoiceTest, authorityGroupTest),
    slice("DS-06", autonomousCapstoneKey, checkpointTest, admissionPriorityTest),
    slice("DS-07", autonomousCapstoneKey, checkpointTest, capacityTest),
    slice("DS-08", autonomousCapstoneKey, checkpointTest, capacityTest, reconstructedRestartTest),
    slice("DS-09", autonomousCapstoneKey, checkpointTest, reconstructedRestartTest),
    slice("DS-10", autonomousCapstoneKey, checkpointTest, authorityGroupTest),
    slice("DS-11", autonomousCapstoneKey, checkpointTest, cSafeTest),
    slice("DS-12", autonomousCapstoneKey, checkpointTest, cSafeTest, bChoiceTest),
    slice("DS-13", autonomousCapstoneKey, checkpointTest, admissionPriorityTest, bChoiceTest),
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
