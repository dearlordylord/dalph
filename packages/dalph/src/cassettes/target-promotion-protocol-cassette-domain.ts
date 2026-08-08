import { Schema } from "effect"
import { JournalPosition, JournalRecord } from "@dalph/orchestrator"

export const PromotionOwner = Schema.Literals(["T1", "T2"])
export type PromotionOwner = typeof PromotionOwner.Type

const BoundaryCall = Schema.Literals(["T1.read", "T1.compareAndSet", "T2.read", "T2.compareAndSet"])
export type BoundaryCall = typeof BoundaryCall.Type

export const PromotionBoundaryResult = Schema.TaggedUnion({
  CompareAndSetApplied: {},
  CompareAndSetWaitsThenApplies: {},
  ReadExpectedHead: {},
  ReadFailed: { detail: Schema.String }
})
export type PromotionBoundaryResult = typeof PromotionBoundaryResult.Type

const PromotionParticipant = Schema.Struct({
  boundaryResults: Schema.Array(PromotionBoundaryResult),
  owner: PromotionOwner,
  queuedAt: JournalPosition
})
export type PromotionParticipant = typeof PromotionParticipant.Type

export const TerminalExpectation = Schema.Struct({
  compareAndSetCount: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
  failureTag: Schema.NullOr(Schema.String),
  journalTags: Schema.Array(Schema.String)
})
export type TerminalExpectation = typeof TerminalExpectation.Type

export const LeaseObservation = Schema.Struct({
  active: Schema.Array(JournalPosition),
  held: Schema.Array(JournalPosition),
  moment: Schema.String
})
export type LeaseObservation = typeof LeaseObservation.Type

export const ProtocolStoryItem = Schema.TaggedUnion({
  Acquire: { owner: PromotionOwner },
  AwaitBlockedBoundary: { owner: PromotionOwner },
  AwaitSettlement: { expected: TerminalExpectation, owner: PromotionOwner },
  ObserveLeases: { expected: LeaseObservation },
  ReleaseBlockedBoundary: { owner: PromotionOwner },
  StartPromotion: { owner: PromotionOwner }
})
export type ProtocolStoryItem = typeof ProtocolStoryItem.Type

const TargetPromotionProtocolCassetteShape = Schema.Struct({
  name: Schema.String,
  participants: Schema.Array(PromotionParticipant),
  story: Schema.Array(ProtocolStoryItem)
})

const boundarySequenceKey = (participant: PromotionParticipant): string =>
  participant.boundaryResults.map(({ _tag }) => _tag).join(">")

const nonBlockingBoundarySequences = new Set(["ReadFailed", "ReadExpectedHead>CompareAndSetApplied"])
const blockingBoundarySequence = "ReadExpectedHead>CompareAndSetWaitsThenApplies"

const participantLifecycleKey = (story: ReadonlyArray<ProtocolStoryItem>, owner: PromotionOwner): string =>
  story.flatMap((item) => ("owner" in item && item.owner === owner ? [item._tag] : [])).join(">")

const nonBlockingLifecycle = "Acquire>StartPromotion>AwaitSettlement"
const blockingLifecycle = "Acquire>StartPromotion>AwaitBlockedBoundary>ReleaseBlockedBoundary>AwaitSettlement"

const participantStoryIsClosed = (
  story: ReadonlyArray<ProtocolStoryItem>,
  participant: PromotionParticipant
): boolean => {
  const boundary = boundarySequenceKey(participant)
  const lifecycle = participantLifecycleKey(story, participant.owner)
  return boundary === blockingBoundarySequence
    ? lifecycle === blockingLifecycle
    : nonBlockingBoundarySequences.has(boundary) && lifecycle === nonBlockingLifecycle
}

const cassetteStoryIsClosed = Schema.makeFilter((cassette: typeof TargetPromotionProtocolCassetteShape.Type) => {
  const participantOwners = cassette.participants.map(({ owner }) => owner)
  if (participantOwners.length === 0) {
    return "promotion protocol cassettes must declare at least one participant"
  }
  if (new Set(participantOwners).size !== participantOwners.length) {
    return "promotion protocol cassette participants must have unique owners"
  }
  const participantOwnerSet = new Set(participantOwners)
  const referencedOwners = cassette.story.flatMap((item) => ("owner" in item ? [item.owner] : []))
  if (!referencedOwners.every((owner) => participantOwnerSet.has(owner))) {
    return "promotion protocol cassette story items must reference declared participants"
  }
  const everyParticipantSettles = cassette.participants.every((participant) =>
    participantStoryIsClosed(cassette.story, participant)
  )
  return everyParticipantSettles
    ? undefined
    : "each promotion participant must have one ordered lifecycle and exact await/release choreography for its blocking boundary"
})

export const TargetPromotionProtocolCassette = TargetPromotionProtocolCassetteShape.check(cassetteStoryIsClosed)
export type TargetPromotionProtocolCassette = typeof TargetPromotionProtocolCassette.Type

export const TargetPromotionProtocolCassetteRun = Schema.Struct({
  boundaryCalls: Schema.Array(BoundaryCall),
  compareAndSetCount: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
  failureTag: Schema.NullOr(Schema.String),
  leaseObservations: Schema.Array(LeaseObservation),
  records: Schema.Array(JournalRecord)
})
export type TargetPromotionProtocolCassetteRun = typeof TargetPromotionProtocolCassetteRun.Type

const firstResponsibilityPosition = JournalPosition.make(8) // eslint-disable-line no-magic-numbers
const secondResponsibilityPosition = JournalPosition.make(28) // eslint-disable-line no-magic-numbers
const successTerminal = TerminalExpectation.make({
  compareAndSetCount: 1,
  failureTag: null,
  journalTags: ["TargetPromotionIntended", "TargetPromotionAttemptIntended", "TargetPromotionObservedSuccess"]
})

export const targetPromotionConcurrentTargetsProtocolCassette = TargetPromotionProtocolCassette.make({
  name: "keeps another target usable while M promotion waits and releases only M when it settles",
  participants: [
    {
      boundaryResults: [
        PromotionBoundaryResult.cases.ReadExpectedHead.make({}),
        PromotionBoundaryResult.cases.CompareAndSetWaitsThenApplies.make({})
      ],
      owner: "T1",
      queuedAt: firstResponsibilityPosition
    },
    {
      boundaryResults: [
        PromotionBoundaryResult.cases.ReadExpectedHead.make({}),
        PromotionBoundaryResult.cases.CompareAndSetApplied.make({})
      ],
      owner: "T2",
      queuedAt: secondResponsibilityPosition
    }
  ],
  story: [
    ProtocolStoryItem.cases.Acquire.make({ owner: "T1" }),
    ProtocolStoryItem.cases.StartPromotion.make({ owner: "T1" }),
    ProtocolStoryItem.cases.AwaitBlockedBoundary.make({ owner: "T1" }),
    ProtocolStoryItem.cases.ObserveLeases.make({
      expected: {
        active: [firstResponsibilityPosition],
        held: [firstResponsibilityPosition],
        moment: "T1WaitingBeforeT2"
      }
    }),
    ProtocolStoryItem.cases.Acquire.make({ owner: "T2" }),
    ProtocolStoryItem.cases.ObserveLeases.make({
      expected: {
        active: [firstResponsibilityPosition],
        held: [firstResponsibilityPosition, secondResponsibilityPosition],
        moment: "T2AcquiredWhileT1Waiting"
      }
    }),
    ProtocolStoryItem.cases.StartPromotion.make({ owner: "T2" }),
    ProtocolStoryItem.cases.AwaitSettlement.make({ expected: successTerminal, owner: "T2" }),
    ProtocolStoryItem.cases.ObserveLeases.make({
      expected: { active: [firstResponsibilityPosition], held: [firstResponsibilityPosition], moment: "T2Settled" }
    }),
    ProtocolStoryItem.cases.ReleaseBlockedBoundary.make({ owner: "T1" }),
    ProtocolStoryItem.cases.AwaitSettlement.make({ expected: successTerminal, owner: "T1" }),
    ProtocolStoryItem.cases.ObserveLeases.make({ expected: { active: [], held: [], moment: "AllSettled" } })
  ]
})

export const targetPromotionUnreadableProtocolCassette = TargetPromotionProtocolCassette.make({
  name: "waits without another request when Git cannot be read",
  participants: [
    {
      boundaryResults: [
        PromotionBoundaryResult.cases.ReadFailed.make({ detail: "target ref is temporarily unreadable" })
      ],
      owner: "T1",
      queuedAt: firstResponsibilityPosition
    }
  ],
  story: [
    ProtocolStoryItem.cases.Acquire.make({ owner: "T1" }),
    ProtocolStoryItem.cases.StartPromotion.make({ owner: "T1" }),
    ProtocolStoryItem.cases.AwaitSettlement.make({
      expected: {
        compareAndSetCount: 0,
        failureTag: "TargetPromotionGitReadFailure",
        journalTags: ["TargetPromotionIntended"]
      },
      owner: "T1"
    }),
    ProtocolStoryItem.cases.ObserveLeases.make({ expected: { active: [], held: [], moment: "AllSettled" } })
  ]
})

export const maintainedTargetPromotionProtocolCassetteCatalog = {
  targetPromotionConcurrentTargets: targetPromotionConcurrentTargetsProtocolCassette,
  targetPromotionUnreadable: targetPromotionUnreadableProtocolCassette
} as const
