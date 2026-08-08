import { Schema } from "effect"
import { JournalRecord } from "@dalph/orchestrator"
import { boundaryScriptMatchesStory } from "./integration-finality-protocol-cassette-validation.js"

/** One scripted result at the ordinary completion-claim tracker boundary. */
export const CompletionClaimBoundaryResult = Schema.TaggedUnion({
  DeletionApplied: {},
  DeletionDefinitelyNotApplied: { detail: Schema.String },
  DeletionUnknown: {},
  DeletionUnknownApplied: {},
  ReadActiveClaim: {},
  ReadCompletionClaim: {},
  ReadFailed: { detail: Schema.String },
  ReadForeignClaim: {},
  ReadUnclaimed: {},
  ReplacementApplied: {},
  ReplacementDefinitelyNotApplied: { detail: Schema.String },
  ReplacementUnknown: {},
  ReplacementUnknownApplied: {}
})
export type CompletionClaimBoundaryResult = typeof CompletionClaimBoundaryResult.Type

/** The terminal evidence expected after replaying one declared protocol story. */
export const CompletionClaimProtocolTerminalExpectation = Schema.Struct({
  deletionCalls: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
  failureTag: Schema.NullOr(Schema.String),
  journalTags: Schema.Array(Schema.String),
  readCalls: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
  replacementCalls: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0))
})
export type CompletionClaimProtocolTerminalExpectation = typeof CompletionClaimProtocolTerminalExpectation.Type

/** One chronological instruction for the production-protocol cassette seam. */
export const CompletionClaimProtocolStoryItem = Schema.TaggedUnion({
  AwaitSettlement: { expected: CompletionClaimProtocolTerminalExpectation },
  ObserveEmptyFrontier: {},
  RecordFreshSuccess: {},
  RestartDeletion: {},
  RestartReplacement: {},
  RunDeletion: {},
  RunReplacement: {}
})
export type CompletionClaimProtocolStoryItem = typeof CompletionClaimProtocolStoryItem.Type

const IntegrationFinalityProtocolCassetteShape = Schema.Struct({
  boundaryResults: Schema.Array(CompletionClaimBoundaryResult),
  initialClaim: Schema.Literals(["Active", "Completion", "Foreign"]),
  name: Schema.String,
  story: Schema.Array(CompletionClaimProtocolStoryItem)
})

const completionClaimMutationLimit = 3
const directReplacementReadCalls = 1
const reconciledReplacementReadCalls = 2
const directDeletionReadCalls = 2
const reconciledDeletionReadCalls = 3
const pendingDeletionStoryPrefixLength = 3
const lastStoryItemOffset = 1

const hasOneFinalTerminalObservation = (story: ReadonlyArray<CompletionClaimProtocolStoryItem>): boolean =>
  story.filter((item) => item._tag === "AwaitSettlement").length === 1 &&
  story.at(-lastStoryItemOffset)?._tag === "AwaitSettlement"

const mutationRequestsAreBounded = (results: ReadonlyArray<CompletionClaimBoundaryResult>): boolean =>
  results.filter(({ _tag }) => _tag.startsWith("Replacement")).length <= completionClaimMutationLimit &&
  results.filter(({ _tag }) => _tag.startsWith("Deletion")).length <= completionClaimMutationLimit

const isReplacementStep = (item: CompletionClaimProtocolStoryItem): boolean =>
  item._tag === "RunReplacement" || item._tag === "RestartReplacement"

const isDeletionStep = (item: CompletionClaimProtocolStoryItem): boolean =>
  item._tag === "RunDeletion" || item._tag === "RestartDeletion"

const storyOrderingIssue = (story: ReadonlyArray<CompletionClaimProtocolStoryItem>): string | undefined => {
  let freshSuccessRecorded = false
  let replacementStarted = false
  for (const item of story) {
    if (isReplacementStep(item)) replacementStarted = true
    if (item._tag === "RecordFreshSuccess") freshSuccessRecorded = true
    if (isDeletionStep(item) && !freshSuccessRecorded) {
      return "completion-claim deletion requires a recorded fresh tracker success"
    }
    if (isDeletionStep(item) && !replacementStarted) {
      return "completion-claim deletion requires the replacement protocol first"
    }
  }
  return undefined
}

const cassetteStoryIsClosed = Schema.makeFilter((cassette: typeof IntegrationFinalityProtocolCassetteShape.Type) =>
  !hasOneFinalTerminalObservation(cassette.story)
    ? "integration finality protocol cassettes must end with exactly one terminal observation"
    : !mutationRequestsAreBounded(cassette.boundaryResults)
      ? "integration finality protocol cassettes must keep each mutation boundary within three requests"
      : !boundaryScriptMatchesStory(cassette.initialClaim, cassette.story, cassette.boundaryResults)
        ? "integration finality boundary results must belong to the declared replacement and deletion steps"
        : storyOrderingIssue(cassette.story)
)

/** Declarative, bounded, replayable stories for the real completion-finality protocols. */
export const IntegrationFinalityProtocolCassette = IntegrationFinalityProtocolCassetteShape.check(cassetteStoryIsClosed)
export type IntegrationFinalityProtocolCassette = typeof IntegrationFinalityProtocolCassette.Type

/** Observable production-protocol result returned by one cassette replay. */
export const IntegrationFinalityProtocolCassetteRun = Schema.Struct({
  boundaryCalls: Schema.Array(Schema.Literals(["deleteTaskClaim", "readTaskClaim", "replaceTaskClaim"])),
  deletionCalls: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
  failureTag: Schema.NullOr(Schema.String),
  journalTags: Schema.Array(Schema.String),
  readCalls: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
  records: Schema.Array(JournalRecord),
  replacementCalls: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
  sawEmptyFrontierWhilePending: Schema.Boolean
})
export type IntegrationFinalityProtocolCassetteRun = typeof IntegrationFinalityProtocolCassetteRun.Type

const replacementStory = (readCalls: number): ReadonlyArray<CompletionClaimProtocolStoryItem> => [
  CompletionClaimProtocolStoryItem.cases.RunReplacement.make({}),
  CompletionClaimProtocolStoryItem.cases.AwaitSettlement.make({
    expected: {
      deletionCalls: 0,
      failureTag: null,
      journalTags: [
        "CompletionClaimReplacementIntended",
        "CompletionClaimReplacementAttemptIntended",
        "CompletionClaimReplaced"
      ],
      readCalls,
      replacementCalls: 1
    }
  })
]

const activeReplacementStory = replacementStory(directReplacementReadCalls)
const lostReplacementStory = replacementStory(reconciledReplacementReadCalls)

const completionSettlementStory = (
  expected: CompletionClaimProtocolTerminalExpectation,
  readCalls = expected.readCalls
): ReadonlyArray<CompletionClaimProtocolStoryItem> => [
  CompletionClaimProtocolStoryItem.cases.RunReplacement.make({}),
  CompletionClaimProtocolStoryItem.cases.RecordFreshSuccess.make({}),
  CompletionClaimProtocolStoryItem.cases.RunDeletion.make({}),
  CompletionClaimProtocolStoryItem.cases.AwaitSettlement.make({ expected: { ...expected, readCalls } })
]

const successfulSettlementExpectation: CompletionClaimProtocolTerminalExpectation = {
  deletionCalls: 1,
  failureTag: null,
  journalTags: [
    "CompletionClaimReplacementIntended",
    "CompletionClaimReplaced",
    "TaskTrackerReadIntentRecorded",
    "TaskTrackerFactsObserved",
    "CompletionClaimDeletionIntended",
    "CompletionClaimDeletionAttemptIntended",
    "CompletionClaimDeleted",
    "IntegrationFinalitySettled"
  ],
  readCalls: directDeletionReadCalls,
  replacementCalls: 0
}

/** Maintained cassettes are named exactly after their operational acceptance scenarios. */
export const replacesTheExactActiveClaimWithAPromotionBoundCompletionClaim = IntegrationFinalityProtocolCassette.make({
  boundaryResults: [
    CompletionClaimBoundaryResult.cases.ReadActiveClaim.make({}),
    CompletionClaimBoundaryResult.cases.ReplacementApplied.make({})
  ],
  initialClaim: "Active",
  name: "replaces the exact active claim with a promotion-bound completion claim",
  story: activeReplacementStory
})

export const restartAfterPromotionResumesCompletionSettlementWithoutAnotherIntegrationAgent =
  IntegrationFinalityProtocolCassette.make({
    boundaryResults: [CompletionClaimBoundaryResult.cases.ReadCompletionClaim.make({})],
    initialClaim: "Completion",
    name: "restart after promotion resumes completion settlement without another integration agent",
    story: [
      CompletionClaimProtocolStoryItem.cases.RestartReplacement.make({}),
      CompletionClaimProtocolStoryItem.cases.AwaitSettlement.make({
        expected: {
          deletionCalls: 0,
          failureTag: null,
          journalTags: ["CompletionClaimReplacementIntended", "CompletionClaimReplaced"],
          readCalls: 1,
          replacementCalls: 0
        }
      })
    ]
  })

export const reconcilesALostCompletionClaimReplacementWithoutAllocatingAnotherClaim =
  IntegrationFinalityProtocolCassette.make({
    boundaryResults: [
      CompletionClaimBoundaryResult.cases.ReadActiveClaim.make({}),
      CompletionClaimBoundaryResult.cases.ReplacementUnknownApplied.make({}),
      CompletionClaimBoundaryResult.cases.ReadCompletionClaim.make({})
    ],
    initialClaim: "Active",
    name: "reconciles a lost completion-claim replacement without allocating another claim",
    story: lostReplacementStory
  })

export const doesNotMutateAForeignClaimWhileSettlingAPromotedTask = IntegrationFinalityProtocolCassette.make({
  boundaryResults: [CompletionClaimBoundaryResult.cases.ReadForeignClaim.make({})],
  initialClaim: "Foreign",
  name: "does not mutate a foreign claim while settling a promoted task",
  story: [
    CompletionClaimProtocolStoryItem.cases.RunReplacement.make({}),
    CompletionClaimProtocolStoryItem.cases.AwaitSettlement.make({
      expected: {
        deletionCalls: 0,
        failureTag: "IntegrationFinality.CompletionClaimOwnershipConflict",
        journalTags: ["CompletionClaimReplacementIntended"],
        readCalls: 1,
        replacementCalls: 0
      }
    })
  ]
})

export const deletesOnlyTheExactCompletionClaimAfterFreshTrackerSuccess = IntegrationFinalityProtocolCassette.make({
  boundaryResults: [
    CompletionClaimBoundaryResult.cases.ReadCompletionClaim.make({}),
    CompletionClaimBoundaryResult.cases.ReadCompletionClaim.make({}),
    CompletionClaimBoundaryResult.cases.DeletionApplied.make({})
  ],
  initialClaim: "Completion",
  name: "deletes only the exact completion claim after fresh tracker success",
  story: completionSettlementStory(successfulSettlementExpectation)
})

export const reconcilesALostCompletionClaimDeletionWithoutReopeningSuccess = IntegrationFinalityProtocolCassette.make({
  boundaryResults: [
    CompletionClaimBoundaryResult.cases.ReadCompletionClaim.make({}),
    CompletionClaimBoundaryResult.cases.ReadCompletionClaim.make({}),
    CompletionClaimBoundaryResult.cases.DeletionUnknownApplied.make({}),
    CompletionClaimBoundaryResult.cases.ReadUnclaimed.make({})
  ],
  initialClaim: "Completion",
  name: "reconciles a lost completion-claim deletion without reopening success",
  story: [
    CompletionClaimProtocolStoryItem.cases.RunReplacement.make({}),
    CompletionClaimProtocolStoryItem.cases.RecordFreshSuccess.make({}),
    CompletionClaimProtocolStoryItem.cases.RestartDeletion.make({}),
    CompletionClaimProtocolStoryItem.cases.AwaitSettlement.make({
      expected: { ...successfulSettlementExpectation, readCalls: reconciledDeletionReadCalls }
    })
  ]
})

export const waitsWithoutReplacingWhenTheCurrentCompletionClaimCannotBeRead = IntegrationFinalityProtocolCassette.make({
  boundaryResults: [CompletionClaimBoundaryResult.cases.ReadFailed.make({ detail: "tracker claim is unreadable" })],
  initialClaim: "Active",
  name: "waits without replacing when the current completion claim cannot be read",
  story: [
    CompletionClaimProtocolStoryItem.cases.RunReplacement.make({}),
    CompletionClaimProtocolStoryItem.cases.AwaitSettlement.make({
      expected: {
        deletionCalls: 0,
        failureTag: "IntegrationFinality.CompletionClaimReadFailure",
        journalTags: ["CompletionClaimReplacementIntended"],
        readCalls: 1,
        replacementCalls: 0
      }
    })
  ]
})

export const keepsSuccessfulWorkFinalWhenTheCompletionClaimCannotBeReadBeforeDeletion =
  IntegrationFinalityProtocolCassette.make({
    boundaryResults: [
      CompletionClaimBoundaryResult.cases.ReadCompletionClaim.make({}),
      CompletionClaimBoundaryResult.cases.ReadFailed.make({ detail: "tracker claim is unreadable" })
    ],
    initialClaim: "Completion",
    name: "keeps successful work final when the completion claim cannot be read before deletion",
    story: completionSettlementStory({
      deletionCalls: 0,
      failureTag: "IntegrationFinality.CompletionClaimReadFailure",
      journalTags: [
        "CompletionClaimReplacementIntended",
        "CompletionClaimReplaced",
        "TaskTrackerReadIntentRecorded",
        "TaskTrackerFactsObserved",
        "CompletionClaimDeletionIntended"
      ],
      readCalls: 2,
      replacementCalls: 0
    })
  })

const deletionCannotConvergeExpectation: CompletionClaimProtocolTerminalExpectation = {
  deletionCalls: completionClaimMutationLimit,
  failureTag: "IntegrationFinality.CompletionClaimDidNotConverge",
  journalTags: [
    "CompletionClaimReplacementIntended",
    "CompletionClaimReplaced",
    "TaskTrackerReadIntentRecorded",
    "TaskTrackerFactsObserved",
    "CompletionClaimDeletionIntended",
    "CompletionClaimDeletionAttemptIntended",
    "CompletionClaimDeletionAttemptIntended",
    "CompletionClaimDeletionAttemptIntended"
  ],
  readCalls: 5,
  replacementCalls: 0
}

export const keepsSuccessfulWorkFinalWhenCompletionClaimDeletionCannotConverge =
  IntegrationFinalityProtocolCassette.make({
    boundaryResults: [
      CompletionClaimBoundaryResult.cases.ReadCompletionClaim.make({}),
      CompletionClaimBoundaryResult.cases.ReadCompletionClaim.make({}),
      CompletionClaimBoundaryResult.cases.DeletionUnknown.make({}),
      CompletionClaimBoundaryResult.cases.ReadCompletionClaim.make({}),
      CompletionClaimBoundaryResult.cases.DeletionUnknown.make({}),
      CompletionClaimBoundaryResult.cases.ReadCompletionClaim.make({}),
      CompletionClaimBoundaryResult.cases.DeletionUnknown.make({}),
      CompletionClaimBoundaryResult.cases.ReadCompletionClaim.make({})
    ],
    initialClaim: "Completion",
    name: "keeps successful work final when completion-claim deletion cannot converge",
    story: completionSettlementStory(deletionCannotConvergeExpectation)
  })

export const doesNotTerminateAnEmptyFrontierWhileCompletionSettlementIsPending =
  IntegrationFinalityProtocolCassette.make({
    boundaryResults: [
      CompletionClaimBoundaryResult.cases.ReadCompletionClaim.make({}),
      CompletionClaimBoundaryResult.cases.ReadCompletionClaim.make({}),
      CompletionClaimBoundaryResult.cases.DeletionUnknown.make({}),
      CompletionClaimBoundaryResult.cases.ReadCompletionClaim.make({}),
      CompletionClaimBoundaryResult.cases.DeletionUnknown.make({}),
      CompletionClaimBoundaryResult.cases.ReadCompletionClaim.make({}),
      CompletionClaimBoundaryResult.cases.DeletionUnknown.make({}),
      CompletionClaimBoundaryResult.cases.ReadCompletionClaim.make({})
    ],
    initialClaim: "Completion",
    name: "does not terminate an empty frontier while completion settlement is pending",
    story: [
      ...completionSettlementStory(deletionCannotConvergeExpectation).slice(0, pendingDeletionStoryPrefixLength),
      CompletionClaimProtocolStoryItem.cases.ObserveEmptyFrontier.make({}),
      CompletionClaimProtocolStoryItem.cases.AwaitSettlement.make({ expected: deletionCannotConvergeExpectation })
    ]
  })

export const maintainedIntegrationFinalityProtocolCassetteCatalog = {
  replacesTheExactActiveClaimWithAPromotionBoundCompletionClaim,
  restartAfterPromotionResumesCompletionSettlementWithoutAnotherIntegrationAgent,
  reconcilesALostCompletionClaimReplacementWithoutAllocatingAnotherClaim,
  doesNotMutateAForeignClaimWhileSettlingAPromotedTask,
  deletesOnlyTheExactCompletionClaimAfterFreshTrackerSuccess,
  reconcilesALostCompletionClaimDeletionWithoutReopeningSuccess,
  waitsWithoutReplacingWhenTheCurrentCompletionClaimCannotBeRead,
  keepsSuccessfulWorkFinalWhenTheCompletionClaimCannotBeReadBeforeDeletion,
  keepsSuccessfulWorkFinalWhenCompletionClaimDeletionCannotConverge,
  doesNotTerminateAnEmptyFrontierWhileCompletionSettlementIsPending
} as const
