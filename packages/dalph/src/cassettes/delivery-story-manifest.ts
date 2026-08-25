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
      readonly cassetteKeys: readonly ["authored:deliveryInvariantStoryCapstone"]
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

const capstoneTest = (name: string): DeliveryStoryAcceptanceTest => ({
  declaration: "it.effect",
  name,
  sourceFile: "packages/dalph/test/cassettes/delivery-story-capstone.execution.test.ts"
})

const chronologyTest = capstoneTest("executes DS01 through DS13 in one maintained chronology")
const finalityTest = capstoneTest(
  "executes DS-14 through DS-17 from rejected exact-head offer through Operator-authorized successor finality"
)

const spine = (
  beatId: DeliveryStoryBeatId,
  ...acceptanceTests: readonly [DeliveryStoryAcceptanceTest, ...ReadonlyArray<DeliveryStoryAcceptanceTest>]
): DeliveryStoryBeatManifestEntry => ({
  beatId,
  coverage: { _tag: "DemonstratedBySpine", acceptanceTests, cassetteKeys: ["authored:deliveryInvariantStoryCapstone"] }
})

const missing = (beatId: DeliveryStoryBeatId, reason: string): DeliveryStoryBeatManifestEntry => ({
  beatId,
  coverage: { _tag: "NotImplemented", acceptanceTests: [], cassetteKeys: [], reason }
})

/**
 * Machine-readable coverage for the prose story. The maintained capstone proves
 * the accepted DS01-DS17 chronology; later unsupported behavior remains explicit
 * instead of fabricated.
 */
export const deliveryStoryManifest = {
  cassetteKey: "authored:deliveryInvariantStoryCapstone" as const,
  cassetteAcceptanceTests: [chronologyTest, finalityTest],
  sourceDocument: "docs/DELIVERY-STORY.md" as const,
  beats: [
    spine("DS-01", chronologyTest),
    spine("DS-02", chronologyTest),
    spine("DS-03", chronologyTest),
    spine("DS-04", chronologyTest),
    spine("DS-05", chronologyTest),
    spine("DS-06", chronologyTest),
    spine("DS-07", chronologyTest),
    spine("DS-08", chronologyTest),
    spine("DS-09", chronologyTest),
    spine("DS-10", chronologyTest),
    spine("DS-11", chronologyTest),
    spine("DS-12", chronologyTest),
    spine("DS-13", chronologyTest),
    spine("DS-14", finalityTest),
    spine("DS-15", finalityTest),
    spine("DS-16", finalityTest),
    spine("DS-17", finalityTest),
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
