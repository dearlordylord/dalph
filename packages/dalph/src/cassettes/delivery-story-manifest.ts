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
export type DeliveryStoryBeatId = (typeof deliveryStoryBeatIds)[number]

export type DeliveryStoryBeatCoverage =
  | { readonly _tag: "DemonstratedBySpine"; readonly cassetteKeys: readonly ["authored:deliveryInvariantStory"] }
  | {
      readonly _tag: "DemonstratedByMaintainedSlice"
      readonly cassetteKeys: ReadonlyArray<`authored:${string}` | `integration-finality:${string}`>
    }
  | { readonly _tag: "NotImplemented"; readonly cassetteKeys: readonly []; readonly reason: string }

export interface DeliveryStoryBeatManifestEntry {
  readonly beatId: DeliveryStoryBeatId
  readonly coverage: DeliveryStoryBeatCoverage
}

const spine = (beatId: DeliveryStoryBeatId): DeliveryStoryBeatManifestEntry => ({
  beatId,
  coverage: { _tag: "DemonstratedBySpine", cassetteKeys: ["authored:deliveryInvariantStory"] }
})

const slice = (
  beatId: DeliveryStoryBeatId,
  ...cassetteKeys: ReadonlyArray<`authored:${string}` | `integration-finality:${string}`>
): DeliveryStoryBeatManifestEntry => ({ beatId, coverage: { _tag: "DemonstratedByMaintainedSlice", cassetteKeys } })

const missing = (beatId: DeliveryStoryBeatId, reason: string): DeliveryStoryBeatManifestEntry => ({
  beatId,
  coverage: { _tag: "NotImplemented", cassetteKeys: [], reason }
})

/**
 * Machine-readable coverage for the prose story. The long spine proves the
 * graph/restart/finality path; existing maintained stories prove narrower
 * beats; unsupported combined behavior remains explicit instead of fabricated.
 */
export const deliveryStoryManifest = {
  cassetteKey: "authored:deliveryInvariantStory" as const,
  sourceDocument: "docs/DELIVERY-STORY.md" as const,
  beats: [
    spine("DS-01"),
    missing("DS-02", "No maintained run admits A, B, and C together yet."),
    slice("DS-03", "authored:changedAttemptContinues"),
    slice("DS-04", "authored:changedAttemptContinues"),
    slice("DS-05", "authored:changedAttemptContinues", "authored:changedAttemptStopsAndReleases"),
    slice("DS-06", "authored:taskPauseLetsIndependentTaskContinue"),
    slice("DS-07", "authored:dependentTasksCompleteInOneRun"),
    spine("DS-08"),
    spine("DS-09"),
    slice("DS-10", "authored:taskPauseLetsIndependentTaskContinue"),
    slice("DS-11", "authored:taskPauseLetsIndependentTaskContinue"),
    slice("DS-12", "authored:changedAttemptContinues"),
    slice("DS-13", "authored:acceptedResultRestartsIntoIntegration"),
    spine("DS-14"),
    spine("DS-15"),
    slice("DS-16", "authored:targetPromotionStaleBeforeCompareAndSet"),
    spine("DS-17"),
    slice("DS-18", "authored:taskUnpauseAfterSafeSuspension"),
    missing("DS-19", "No maintained run combines the retained C attempt with a later capacity increase."),
    spine("DS-20"),
    missing("DS-21", "No maintained authored run finalizes B, C, and D and admits E, F, and G in one chronology."),
    missing("DS-22", "Whole-run seven-task completion and normal Run termination are not implemented as one cassette.")
  ] satisfies ReadonlyArray<DeliveryStoryBeatManifestEntry>
} as const

const coverageLabel = (coverage: DeliveryStoryBeatCoverage): string =>
  coverage._tag === "NotImplemented"
    ? `${coverage._tag}|${coverage.reason}`
    : `${coverage._tag}|${coverage.cassetteKeys.join(",")}`

/** Exact checked-in documentation block; tests require byte-for-byte parity. */
export const renderDeliveryStoryManifest = (): string =>
  [
    "<!-- DELIVERY-STORY-MANIFEST:START -->",
    `cassette|${deliveryStoryManifest.cassetteKey}`,
    ...deliveryStoryManifest.beats.map(({ beatId, coverage }) => `${beatId}|${coverageLabel(coverage)}`),
    "<!-- DELIVERY-STORY-MANIFEST:END -->"
  ].join("\n")
