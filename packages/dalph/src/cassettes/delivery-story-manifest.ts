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

const topologyTest = scenarioTest("consumes a staggered graph while reconstructed positions delay restart-added X")
const restartTest = scenarioTest("preserves the double-diamond middle positions across coordinator restart")

const spine = (
  beatId: DeliveryStoryBeatId,
  ...acceptanceTests: readonly [DeliveryStoryAcceptanceTest, ...ReadonlyArray<DeliveryStoryAcceptanceTest>]
): DeliveryStoryBeatManifestEntry => ({
  beatId,
  coverage: { _tag: "DemonstratedBySpine", acceptanceTests, cassetteKeys: ["authored:deliveryInvariantStory"] }
})

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
 * double-diamond graph/restart path; one maintained story proves one narrower beat;
 * unsupported combined behavior remains explicit instead of fabricated.
 */
export const deliveryStoryManifest = {
  cassetteKey: "authored:deliveryInvariantStory" as const,
  cassetteAcceptanceTests: [topologyTest, restartTest],
  sourceDocument: "docs/DELIVERY-STORY.md" as const,
  beats: [
    missing(
      "DS-01",
      "The maintained double diamond starts with only A eligible; the prose beat requires five independent eligible tasks."
    ),
    missing("DS-02", "No maintained run admits A, B, and C together yet."),
    missing(
      "DS-03",
      "No maintained cassette represents Alice editing B and then observes the exact G0-to-G1 tracker revision change."
    ),
    missing(
      "DS-04",
      "No named acceptance test proves B's changed graph/specification rereads, safe-suspension request, and retained position together."
    ),
    missing(
      "DS-05",
      "The current changed-attempt choice supports Continue or Stop, not the prose beat's three choices including Restart."
    ),
    missing(
      "DS-06",
      "No maintained run admits D after B's changed-instruction suspension releases one of three held positions."
    ),
    missing(
      "DS-07",
      "No maintained catalog cassette lowers capacity from three to two while A, C, and D all remain held."
    ),
    spine("DS-08", restartTest),
    missing("DS-09", "The maintained double diamond recovers held B and C, not held A, C, and D plus retained B."),
    missing("DS-10", "No maintained run closes C without success and then asks its exact executor to suspend."),
    missing("DS-11", "No maintained run releases closed C's position while retaining its reversible lifecycle wait."),
    missing(
      "DS-12",
      "No maintained run applies Continue to retained B while two other tasks consume all current capacity."
    ),
    missing(
      "DS-13",
      "No maintained run releases A's position after its accepted result and then admits already-owned B."
    ),
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
      "The staggered ten-task cassette terminates after executor completion, but it does not finalize every retained integration result from this prose beat."
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
