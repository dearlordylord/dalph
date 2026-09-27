import { readFile } from "node:fs/promises"

import { directPublicationBatchGrantObligations } from "./quint-model-obligations.mjs"

const canonicalModel = "specs/directPublicationBatchGrant.qnt"
const commonPrelude = Object.freeze([
  "init",
  "startInitialSession",
  "closeInitialSession",
  "recordInitialPushIntent",
  "resolveInitialIntentWithoutProof",
  "retainInitialPublicationExhaustion"
])

// These actions are enabled at GrantBatchReady. Keep the whole choice set in
// both projections; splitting these selectors would erase their races.
const grantBatchReadySelectors = Object.freeze([
  "startGrantedSuccessorSession",
  "reconcileAlreadyPublishedCandidate",
  "recordReusableCandidatePushIntent",
  "retainBlockedConstraint",
  "retainNextPublicationExhaustion"
])

const grantControlTransitions = Object.freeze([
  ...commonPrelude,
  "applyPause",
  "applyUnpause",
  "applyExitCutoff",
  "submitExactFullRerunRequest",
  "appendExactExhaustionGrant",
  "acknowledgeGrant",
  "replaySameGrantRequest",
  "replayDifferentRequestForSameOccurrence",
  "crashBeforeGrantAppend",
  "rejectPendingGrantAtExitCutoff",
  "crashAfterGrantAppendBeforeAck",
  "crashAfterGrantSessionFixation",
  "crashAfterCommittedGrantIntent",
  "restartHost",
  "recoverCommittedGrant",
  ...grantBatchReadySelectors,
  "recordGrantedPushIntent",
  "resolveGrantedIntentWithoutProof",
  "observeExactPushPublicationProof",
  "closeGrantSessionWithoutIntent",
  "progressUnrelatedResponsibility"
])

const batchFinalityTransitions = Object.freeze([
  ...commonPrelude,
  "applyPause",
  "applyUnpause",
  "applyExitCutoff",
  "submitExactFullRerunRequest",
  "appendExactExhaustionGrant",
  "acknowledgeGrant",
  "replaySameGrantRequest",
  "crashBeforeGrantAppend",
  "rejectPendingGrantAtExitCutoff",
  "crashAfterGrantAppendBeforeAck",
  "crashAfterGrantSessionFixation",
  "crashAfterCommittedGrantIntent",
  "restartHost",
  "recoverCommittedGrant",
  ...grantBatchReadySelectors,
  "recordGrantedPushIntent",
  "resolveGrantedIntentWithoutProof",
  "observeExactPushPublicationProof",
  "closeGrantSessionWithoutIntent",
  "recordSameCommitSuccessorCandidate",
  "recordLocalPromotion",
  "refreshTaskPermission",
  "completeTaskFromExactProof",
  "recordExactCleanup",
  "settleResponsibility",
  "terminateRunAfterResponsibilitySettlement",
  "progressUnrelatedResponsibility"
])

const grantControlOwnedInvariants = Object.freeze([
  "grantIsBoundToRetainedExhaustion",
  "oneGrantPerExactOccurrence",
  "grantReceiptMatchesExactOccurrence",
  "grantAcknowledgementMatchesProgress",
  "grantReplayIsIdempotent",
  "grantReceiptIsVisibleBeforeForwardEffects"
])

const batchFinalityOwnedInvariants = Object.freeze([
  "batchBoundsHold",
  "cumulativeOrdinalsAreNotReset",
  "pauseDefersQForwardEffects",
  "exitCutoffStopsQForwardEffects",
  "taskBeginIsRetainedOnce",
  "grantDoesNotProvePublication",
  "completionRequiresProofPromotionAndCurrentPermission",
  "settlementRequiresExactCompletionAndCleanup",
  "exactSuccessorParentsAreRetained",
  "successorCandidateIsBoundToItsSession",
  "postGrantEffectsMatchSelectedPath",
  "postGrantPathMatchesSelectedPath",
  "runTerminationRequiresSettledResponsibility"
])

export const directPublicationBatchGrantProjectionContract = Object.freeze({
  canonicalModel,
  projectionModel: "specs/directPublicationBatchGrant_proof.qnt",
  projectionTypecheckCommand: "publication exhaustion batch grant proof projection typecheck",
  commonPrelude,
  grantBatchReadySelectors,
  invariants: directPublicationBatchGrantObligations.invariants,
  profiles: Object.freeze({
    grantControl: Object.freeze({
      main: "directPublicationBatchGrantGrantControlProof",
      positiveCommand: "publication exhaustion batch grant control projection deterministic tests",
      negativeCommand: "publication exhaustion batch grant control projection negative mutation profile",
      sampledCommand: "publication exhaustion batch grant control projection sampled model",
      test: "specs/directPublicationBatchGrant_control_proof_test.qnt",
      negativeTest: "specs/directPublicationBatchGrant_control_proof_negative_test.qnt",
      positiveMain: "directPublicationBatchGrantControlProofTest",
      negativeMain: "directPublicationBatchGrantControlProofNegativeTest",
      verifyCommand: "publication exhaustion batch grant control projection exhaustive model",
      invariants: directPublicationBatchGrantObligations.invariants,
      witnesses: Object.freeze([
        "exactExhaustionReached",
        "grantCommittedReached",
        "pausedGrantReached",
        "grantSessionReached",
        "secondExhaustionReached",
        "secondGrantReached"
      ]),
      transitions: grantControlTransitions,
      stutters: Object.freeze([
        {
          action: "recordSameCommitSuccessorCandidate",
          reads: [
            "phase",
            "lifecycle",
            "hostLive",
            "grantedSessionsUsed",
            "selectedPostGrantPath",
            "postGrantPath",
            "successorCandidateSessionOrdinal",
            "successorCandidateSessions",
            "currentSessionOrdinal"
          ],
          guardReads: [
            "phase",
            "lifecycle",
            "hostLive",
            "grantedSessionsUsed",
            "selectedPostGrantPath",
            "postGrantPath",
            "successorCandidateSessionOrdinal",
            "currentSessionOrdinal"
          ],
          writes: [
            "successorParent",
            "successorSecondParent",
            "successorCandidateRecorded",
            "successorCandidateSessions",
            "successorCandidateSessionOrdinal",
            "pausedForwardEffects",
            "exitForwardEffects",
            "qForwardEffectOrdinal"
          ],
          projectedWrites: [],
          abstractedWrites: [
            "successorParent",
            "successorSecondParent",
            "successorCandidateRecorded",
            "successorCandidateSessions",
            "successorCandidateSessionOrdinal",
            "pausedForwardEffects",
            "exitForwardEffects",
            "qForwardEffectOrdinal"
          ],
          reason: "Parent evidence is outside the control projection; batch/finality owns it.",
          proofTest: "controlProjectionStuttersCandidateParentEvidenceTest",
          proofFile: "specs/directPublicationBatchGrant_control_proof_test.qnt",
          reverseProofTest: "controlProjectionCandidateParentThenUnrelatedProgressTest",
          diamondPairs: ["progressUnrelatedResponsibility", "recordSameCommitSuccessorCandidate"],
          projectionView: "grantControlProjection"
        },
        {
          action: "recordLocalPromotion",
          reads: ["phase", "exactRemoteProof", "lifecycle", "hostLive"],
          guardReads: ["phase", "exactRemoteProof", "lifecycle", "hostLive"],
          writes: ["phase", "localPromotion", "pausedForwardEffects", "exitForwardEffects", "qForwardEffectOrdinal"],
          projectedWrites: [],
          abstractedWrites: [
            "phase",
            "localPromotion",
            "pausedForwardEffects",
            "exitForwardEffects",
            "qForwardEffectOrdinal"
          ],
          reason: "Promotion is a batch/finality-owned boundary after exact proof.",
          proofTest: "controlProjectionStuttersLocalPromotionTest",
          proofFile: "specs/directPublicationBatchGrant_control_proof_test.qnt",
          reverseProofTest: "controlProjectionPromotionThenUnrelatedProgressTest",
          diamondPairs: ["progressUnrelatedResponsibility", "recordLocalPromotion"],
          projectionView: "grantControlProjection",
          guardReadAbstractions: { phase: "postProofSuffix" }
        },
        {
          action: "refreshTaskPermission",
          reads: ["phase", "lifecycle", "hostLive"],
          guardReads: ["phase", "lifecycle", "hostLive"],
          writes: [
            "phase",
            "freshTaskPermission",
            "pausedForwardEffects",
            "exitForwardEffects",
            "qForwardEffectOrdinal"
          ],
          projectedWrites: [],
          abstractedWrites: [
            "phase",
            "freshTaskPermission",
            "pausedForwardEffects",
            "exitForwardEffects",
            "qForwardEffectOrdinal"
          ],
          reason: "Permission refresh is a batch/finality-owned boundary after promotion.",
          proofTest: "controlProjectionStuttersPermissionRefreshTest",
          proofFile: "specs/directPublicationBatchGrant_control_proof_test.qnt",
          reverseProofTest: "controlProjectionPermissionRefreshThenUnrelatedProgressTest",
          diamondPairs: ["progressUnrelatedResponsibility", "refreshTaskPermission"],
          projectionView: "grantControlProjection",
          guardReadAbstractions: { phase: "postProofSuffix" }
        },
        {
          action: "completeTaskFromExactProof",
          reads: ["phase", "exactRemoteProof", "localPromotion", "freshTaskPermission", "lifecycle", "hostLive"],
          guardReads: ["phase", "exactRemoteProof", "localPromotion", "freshTaskPermission", "lifecycle", "hostLive"],
          writes: ["phase", "taskCompleted", "pausedForwardEffects", "exitForwardEffects", "qForwardEffectOrdinal"],
          projectedWrites: [],
          abstractedWrites: [
            "phase",
            "taskCompleted",
            "pausedForwardEffects",
            "exitForwardEffects",
            "qForwardEffectOrdinal"
          ],
          reason: "Task completion is a batch/finality-owned boundary.",
          proofTest: "controlProjectionStuttersTaskCompletionTest",
          proofFile: "specs/directPublicationBatchGrant_control_proof_test.qnt",
          reverseProofTest: "controlProjectionTaskCompletionThenUnrelatedProgressTest",
          diamondPairs: ["progressUnrelatedResponsibility", "completeTaskFromExactProof"],
          projectionView: "grantControlProjection",
          guardReadAbstractions: { phase: "postProofSuffix" }
        },
        {
          action: "recordExactCleanup",
          reads: ["phase", "taskCompleted", "lifecycle", "hostLive"],
          guardReads: ["phase", "taskCompleted", "lifecycle", "hostLive"],
          writes: ["cleanupComplete", "pausedForwardEffects", "exitForwardEffects", "qForwardEffectOrdinal"],
          projectedWrites: [],
          abstractedWrites: ["cleanupComplete", "pausedForwardEffects", "exitForwardEffects", "qForwardEffectOrdinal"],
          reason: "Cleanup is a batch/finality-owned boundary.",
          proofTest: "controlProjectionStuttersCleanupTest",
          proofFile: "specs/directPublicationBatchGrant_control_proof_test.qnt",
          reverseProofTest: "controlProjectionCleanupThenUnrelatedProgressTest",
          diamondPairs: ["progressUnrelatedResponsibility", "recordExactCleanup"],
          projectionView: "grantControlProjection"
        },
        {
          action: "settleResponsibility",
          reads: ["phase", "taskCompleted", "cleanupComplete", "exactRemoteProof", "lifecycle", "hostLive"],
          guardReads: ["phase", "taskCompleted", "cleanupComplete", "exactRemoteProof", "lifecycle", "hostLive"],
          writes: [
            "phase",
            "responsibilitySettled",
            "pausedForwardEffects",
            "exitForwardEffects",
            "qForwardEffectOrdinal"
          ],
          projectedWrites: [],
          abstractedWrites: [
            "phase",
            "responsibilitySettled",
            "pausedForwardEffects",
            "exitForwardEffects",
            "qForwardEffectOrdinal"
          ],
          reason: "Responsibility settlement is a batch/finality-owned boundary.",
          proofTest: "controlProjectionStuttersResponsibilitySettlementTest",
          proofFile: "specs/directPublicationBatchGrant_control_proof_test.qnt",
          reverseProofTest: "controlProjectionSettlementThenUnrelatedProgressTest",
          diamondPairs: ["progressUnrelatedResponsibility", "settleResponsibility"],
          projectionView: "grantControlProjection",
          guardReadAbstractions: { phase: "postProofSuffix" }
        },
        {
          action: "terminateRunAfterResponsibilitySettlement",
          reads: ["responsibilitySettled"],
          guardReads: ["responsibilitySettled"],
          writes: ["runTerminated"],
          projectedWrites: [],
          abstractedWrites: ["runTerminated"],
          reason: "Run termination is a batch/finality-owned boundary.",
          proofTest: "controlProjectionStuttersRunTerminationTest",
          proofFile: "specs/directPublicationBatchGrant_control_proof_test.qnt",
          reverseProofTest: "controlProjectionTerminationThenUnrelatedProgressTest",
          diamondPairs: ["progressUnrelatedResponsibility", "terminateRunAfterResponsibilitySettlement"],
          projectionView: "grantControlProjection"
        }
      ]),
      invariantOwners: grantControlOwnedInvariants
    }),
    batchFinality: Object.freeze({
      main: "directPublicationBatchGrantBatchFinalityProof",
      positiveCommand: "publication exhaustion batch grant batch/finality projection deterministic tests",
      negativeCommand: "publication exhaustion batch grant batch/finality projection negative mutation profile",
      sampledCommand: "publication exhaustion batch grant batch/finality projection sampled model",
      test: "specs/directPublicationBatchGrant_batch_finality_proof_test.qnt",
      negativeTest: "specs/directPublicationBatchGrant_batch_finality_proof_negative_test.qnt",
      positiveMain: "directPublicationBatchGrantBatchFinalityProofTest",
      negativeMain: "directPublicationBatchGrantBatchFinalityProofNegativeTest",
      // #408 owns exhaustive batch/finality exploration. #386 retains its
      // deterministic positive and negative controls and one exact control proof.
      invariants: directPublicationBatchGrantObligations.invariants,
      witnesses: Object.freeze([
        "exactExhaustionReached",
        "grantCommittedReached",
        "grantSessionReached",
        "grantPushReached",
        "exactProofReached",
        "blockedWaitReached",
        "settledReached"
      ]),
      transitions: batchFinalityTransitions,
      stutters: Object.freeze([
        {
          action: "replayDifferentRequestForSameOccurrence",
          reads: [
            "grantCount",
            "grantOccurrence",
            "exhaustionOccurrence",
            "hostLive",
            "differentRequestReplays",
            "grantRequestId"
          ],
          guardReads: [
            "grantCount",
            "grantOccurrence",
            "exhaustionOccurrence",
            "hostLive",
            "differentRequestReplays",
            "grantRequestId"
          ],
          writes: ["differentRequestReplays"],
          projectedWrites: [],
          abstractedWrites: ["differentRequestReplays"],
          reason:
            "The replay counter is not read by batch/finality state or guards; the projection erases that counter.",
          proofTest: "batchFinalityStuttersDifferentRequestReplayTest",
          proofFile: "specs/directPublicationBatchGrant_batch_finality_proof_test.qnt",
          reverseProofTest: "batchFinalityDifferentReplayThenUnrelatedProgressTest",
          diamondPairs: ["progressUnrelatedResponsibility", "replayDifferentRequestForSameOccurrence"],
          projectionView: "batchFinalityProjection"
        }
      ]),
      invariantOwners: batchFinalityOwnedInvariants
    })
  }),
  invariantNegativeControls: Object.freeze({
    grantIsBoundToRetainedExhaustion: {
      profile: "grantControl",
      testFile: "specs/directPublicationBatchGrant_control_proof_negative_test.qnt",
      test: "detectsUnrelatedQuarantineFullRerunGrantTest",
      mutant: "mintGrantFromUnrelatedQuarantine"
    },
    oneGrantPerExactOccurrence: {
      profile: "grantControl",
      testFile: "specs/directPublicationBatchGrant_control_proof_negative_test.qnt",
      test: "detectsDifferentRequestIdMintingSecondGrantForSameExhaustionTest",
      mutant: "mintDuplicateGrantForSameOccurrence"
    },
    grantReceiptMatchesExactOccurrence: {
      profile: "grantControl",
      testFile: "specs/directPublicationBatchGrant_control_proof_negative_test.qnt",
      test: "detectsMismatchedGrantReceiptForRetainedOccurrenceTest",
      mutant: "mintDuplicateGrantForSameOccurrence"
    },
    grantAcknowledgementMatchesProgress: {
      profile: "grantControl",
      testFile: "specs/directPublicationBatchGrant_control_proof_negative_test.qnt",
      test: "detectsReplayBeforeAcknowledgementMustAdvanceGrantPhaseTest",
      mutant: "mutateReplayBeforeAcknowledgementWithoutPhaseAdvance"
    },
    grantReplayIsIdempotent: {
      profile: "grantControl",
      testFile: "specs/directPublicationBatchGrant_control_proof_negative_test.qnt",
      test: "detectsMismatchedSameRequestReplayTest",
      mutant: "mutateSameRequestReplayWithForeignReceipt"
    },
    grantReceiptIsVisibleBeforeForwardEffects: {
      profile: "grantControl",
      testFile: "specs/directPublicationBatchGrant_control_proof_negative_test.qnt",
      test: "detectsForwardEffectBeforeCommittedReceiptTest",
      mutant: "mutateForwardSessionBeforeReceipt"
    },
    batchBoundsHold: {
      profile: "batchFinality",
      testFile: "specs/directPublicationBatchGrant_batch_finality_proof_negative_test.qnt",
      test: "detectsGrantedBatchBoundExceededTest",
      mutant: "exceedGrantedBatchBound"
    },
    cumulativeOrdinalsAreNotReset: {
      profile: "batchFinality",
      testFile: "specs/directPublicationBatchGrant_batch_finality_proof_negative_test.qnt",
      test: "detectsBudgetResetAndNonmonotonicOrdinalTest",
      mutant: "resetCumulativeOrdinals"
    },
    pauseDefersQForwardEffects: {
      profile: "batchFinality",
      testFile: "specs/directPublicationBatchGrant_batch_finality_proof_negative_test.qnt",
      test: "detectsGuardRemovedSessionStartDuringPauseTest",
      mutant: "mutateSessionStartWithoutLifecycleGuard"
    },
    exitCutoffStopsQForwardEffects: {
      profile: "batchFinality",
      testFile: "specs/directPublicationBatchGrant_batch_finality_proof_negative_test.qnt",
      test: "detectsGuardRemovedSessionStartAfterExitTest",
      mutant: "mutateSessionStartWithoutLifecycleGuard"
    },
    taskBeginIsRetainedOnce: {
      profile: "batchFinality",
      testFile: "specs/directPublicationBatchGrant_batch_finality_proof_negative_test.qnt",
      test: "detectsGrantStartingTaskExecutionTest",
      mutant: "rerunTaskFromGrant"
    },
    grantDoesNotProvePublication: {
      profile: "batchFinality",
      testFile: "specs/directPublicationBatchGrant_batch_finality_proof_negative_test.qnt",
      test: "detectsGrantReceiptUsedAsPublicationProofTest",
      mutant: "useGrantAsPublicationProof"
    },
    completionRequiresProofPromotionAndCurrentPermission: {
      profile: "batchFinality",
      testFile: "specs/directPublicationBatchGrant_batch_finality_proof_negative_test.qnt",
      test: "detectsCompletionWithoutProofPromotionOrPermissionTest",
      mutant: "useGrantAsPublicationProof"
    },
    settlementRequiresExactCompletionAndCleanup: {
      profile: "batchFinality",
      testFile: "specs/directPublicationBatchGrant_batch_finality_proof_negative_test.qnt",
      test: "detectsSettlementWithoutExactCompletionOrCleanupTest",
      mutant: "mutateSettlementWithoutCleanupOrCompletion"
    },
    exactSuccessorParentsAreRetained: {
      profile: "batchFinality",
      testFile: "specs/directPublicationBatchGrant_batch_finality_proof_negative_test.qnt",
      test: "detectsDiscardedRecordedSuccessorParentEvidenceTest",
      mutant: "discardRecordedSuccessorParentEvidence"
    },
    successorCandidateIsBoundToItsSession: {
      profile: "batchFinality",
      testFile: "specs/directPublicationBatchGrant_batch_finality_proof_negative_test.qnt",
      test: "detectsSuccessorCandidateClaimedForFutureSessionTest",
      mutant: "assignSuccessorCandidateToFutureSession"
    },
    postGrantEffectsMatchSelectedPath: {
      profile: "batchFinality",
      testFile: "specs/directPublicationBatchGrant_batch_finality_proof_negative_test.qnt",
      test: "detectsReusableCandidateRelabeledAsSameCommitSuccessorTest",
      mutant: "mutateReusableCandidateIntoSuccessorSession"
    },
    postGrantPathMatchesSelectedPath: {
      profile: "batchFinality",
      testFile: "specs/directPublicationBatchGrant_batch_finality_proof_negative_test.qnt",
      test: "detectsSameCommitSuccessorRelabeledAsReusableCandidateTest",
      mutant: "mutateStartedSuccessorIntoReusableCandidate"
    },
    runTerminationRequiresSettledResponsibility: {
      profile: "batchFinality",
      testFile: "specs/directPublicationBatchGrant_batch_finality_proof_negative_test.qnt",
      test: "detectsRunTerminationBeforeResponsibilitySettledTest",
      mutant: "mutateTerminateBeforeResponsibilitySettled"
    }
  })
})

const actionNames = (source) =>
  [...source.matchAll(/^\s*action\s+(\w+)\s*(?:\([^\n]*\))?\s*:/gmu)].map((match) => match[1])

const actionBodies = (source) => {
  const starts = [...source.matchAll(/^\s*action\s+(\w+)\s*(?:\([^\n]*\))?\s*:/gmu)]
  return new Map(
    starts.map((match) => {
      const opening = source.indexOf("{", match.index)
      let depth = 0
      let closing = -1
      for (let index = opening; index < source.length; index += 1) {
        if (source[index] === "{") depth += 1
        if (source[index] === "}") {
          depth -= 1
          if (depth === 0) {
            closing = index + 1
            break
          }
        }
      }
      if (opening < 0 || closing < 0) throw new Error(`cannot parse action body ${match[1]}`)
      return [match[1], source.slice(match.index, closing)]
    })
  )
}

const runBodies = (source) => {
  const starts = [...source.matchAll(/^\s*run\s+(\w+)\s*=\s*/gmu)]
  return new Map(
    starts.map((match) => {
      const opening = source.indexOf("{", match.index)
      let depth = 0
      let closing = -1
      for (let index = opening; index < source.length; index += 1) {
        if (source[index] === "{") depth += 1
        if (source[index] === "}") {
          depth -= 1
          if (depth === 0) {
            closing = index + 1
            break
          }
        }
      }
      if (opening < 0 || closing < 0) throw new Error(`cannot parse run body ${match[1]}`)
      return [match[1], source.slice(match.index, closing)]
    })
  )
}

const sorted = (values) => [...values].sort((left, right) => left.localeCompare(right))

const actionReadWriteEvidence = (body) => {
  const assignment = body.indexOf("state' =")
  if (assignment < 0) throw new Error("stutter action lacks a next-state assignment")
  const guard = body.slice(0, assignment)
  const update = body.slice(assignment)
  const reads = new Set([...body.matchAll(/\bstate\.(\w+)/gu)].map((match) => match[1]))
  const guardReads = new Set([...guard.matchAll(/\bstate\.(\w+)/gu)].map((match) => match[1]))
  const writes = new Set([...update.matchAll(/\b([a-z][A-Za-z0-9_]*):/gu)].map((match) => match[1]))
  if (body.includes("recordQForwardEffect")) {
    reads.add("lifecycle")
    for (const field of ["pausedForwardEffects", "exitForwardEffects", "qForwardEffectOrdinal"]) writes.add(field)
  }
  return { reads: sorted(reads), guardReads: sorted(guardReads), writes: sorted(writes) }
}

const namedBoolBodies = (source) => {
  const starts = [...source.matchAll(/^\s*val\s+(\w+)\s*:\s*bool\s*=/gmu)]
  return new Map(
    starts.map((match, index) => {
      const nextStart = starts[index + 1]?.index ?? source.length
      const nextAction = source.slice(match.index + match[0].length, nextStart).search(/^\s*action\s+/mu)
      const end = nextAction < 0 ? nextStart : match.index + match[0].length + nextAction
      return [match[1], source.slice(match.index, end)]
    })
  )
}

export const assertDirectPublicationBatchGrantProjectionContract = async (
  root,
  contract = directPublicationBatchGrantProjectionContract
) => {
  const model = await readFile(`${root}/${canonicalModel}`, "utf8")
  const stateFields = new Set([...model.matchAll(/^\s{4}(\w+):/gmu)].map((match) => match[1]))
  const canonicalActionBodies = actionBodies(model)
  const predicateBodies = namedBoolBodies(model)
  const testFiles = new Map()
  const canonicalActions = actionNames(model).filter((name) => name !== "step")
  const allInvariants = [...contract.invariants].sort()
  const assignedActions = new Set()

  if (new Set(canonicalActions).size !== canonicalActions.length) {
    throw new Error("canonical model declares a duplicate action")
  }
  if (new Set(contract.grantBatchReadySelectors).size !== contract.grantBatchReadySelectors.length) {
    throw new Error("GrantBatchReady selector family contains duplicates")
  }

  for (const [profileName, profile] of Object.entries(contract.profiles)) {
    const transitions = new Set(profile.transitions)
    const stutters = new Set(profile.stutters.map(({ action }) => action))
    const selectors = contract.grantBatchReadySelectors.filter((action) => transitions.has(action))
    if (selectors.length !== contract.grantBatchReadySelectors.length) {
      throw new Error(`${profileName} splits or omits a GrantBatchReady selector`)
    }
    if (
      new Set(profile.transitions).size !== profile.transitions.length ||
      transitions.size !== profile.transitions.length
    ) {
      throw new Error(`${profileName} has duplicate transition mappings`)
    }
    if (new Set(profile.stutters.map(({ action }) => action)).size !== profile.stutters.length) {
      throw new Error(`${profileName} has duplicate stutter mappings`)
    }

    const mapped = new Set([...transitions, ...stutters])
    const missing = canonicalActions.filter((action) => !mapped.has(action))
    const unknown = [...mapped].filter((action) => !canonicalActions.includes(action))
    if (missing.length > 0 || unknown.length > 0) {
      throw new Error(`${profileName} action map mismatch; missing=${missing.join(",")}; unknown=${unknown.join(",")}`)
    }
    const projectedModel = await readFile(`${root}/${contract.projectionModel}`, "utf8")
    const moduleStart = projectedModel.indexOf(`module ${profile.main} {`)
    const nextModule = projectedModel.indexOf("\nmodule ", moduleStart + 1)
    const moduleSource = projectedModel.slice(moduleStart, nextModule < 0 ? undefined : nextModule)
    if (moduleStart < 0 || moduleSource.length === 0) throw new Error(`${profileName} proof module is missing`)
    const projectionActions = new Set(actionNames(moduleSource))
    const expectedActions = new Set([...canonicalActions, "step"])
    if (
      projectionActions.size !== expectedActions.size ||
      [...expectedActions].some((action) => !projectionActions.has(action))
    ) {
      throw new Error(`${profileName} model action declarations differ from the canonical model`)
    }
    const stepBody = actionBodies(moduleSource).get("step") ?? ""
    const stepCalls = new Set([...stepBody.matchAll(/^[ \t]+(\w+)\s*(?:\(|,|$)/gmu)].map((match) => match[1]))
    const expectedStepCalls = new Set(profile.transitions.filter((action) => action !== "init"))
    if (stepCalls.size !== expectedStepCalls.size || [...expectedStepCalls].some((action) => !stepCalls.has(action))) {
      throw new Error(`${profileName} generated step differs from its transition map`)
    }
    const projectionInvariants = new Set(
      [...moduleSource.matchAll(/^\s*val\s+(\w+):\s*bool\s*=/gmu)].map((match) => match[1])
    )
    if (allInvariants.some((invariant) => !projectionInvariants.has(invariant))) {
      throw new Error(`${profileName} does not check the complete canonical invariant declarations`)
    }

    const ownerInvariants = new Set(profile.invariantOwners)
    const negativeControls = Object.entries(contract.invariantNegativeControls)
      .filter(([invariant]) => ownerInvariants.has(invariant))
      .map(([invariant, control]) => [invariant, control])
    if (
      ownerInvariants.size !== profile.invariantOwners.length ||
      negativeControls.length !== ownerInvariants.size ||
      negativeControls.some(
        ([, control]) =>
          control.profile !== profileName || !control.test.endsWith("Test") || !control.mutant || !control.testFile
      )
    ) {
      throw new Error(`${profileName} does not map every owned invariant to one negative control`)
    }
    if (JSON.stringify([...allInvariants]) !== JSON.stringify([...profile.invariants].sort())) {
      throw new Error(`${profileName} invariant list differs from the canonical list`)
    }
    for (const stutter of profile.stutters) {
      if (
        !stutter.reason ||
        !stutter.proofTest ||
        !stutter.proofFile ||
        !Array.isArray(stutter.reads) ||
        !Array.isArray(stutter.writes) ||
        !Array.isArray(stutter.projectedWrites) ||
        !Array.isArray(stutter.abstractedWrites) ||
        !Array.isArray(stutter.diamondPairs) ||
        stutter.projectedWrites.length > 0
      ) {
        throw new Error(`${profileName} lacks an explicit stutter refinement for ${stutter.action}`)
      }
      const declaredFields = new Set([...stutter.reads, ...stutter.writes, ...stutter.guardReads])
      if (stutter.guardReads.some((field) => !stutter.reads.includes(field))) {
        throw new Error(`${profileName} stutter ${stutter.action} has an enabledness read outside its read set`)
      }
      for (const field of declaredFields) {
        if (!stateFields.has(field))
          throw new Error(`${profileName} stutter ${stutter.action} names unknown state field ${field}`)
      }
      const actual = actionReadWriteEvidence(canonicalActionBodies.get(stutter.action) ?? "")
      for (const evidence of ["reads", "guardReads", "writes"]) {
        if (JSON.stringify(sorted(stutter[evidence])) !== JSON.stringify(actual[evidence])) {
          throw new Error(`${profileName} stutter ${stutter.action} ${evidence} differ from canonical action source`)
        }
      }
      const accountedWrites = sorted([...stutter.projectedWrites, ...stutter.abstractedWrites])
      if (JSON.stringify(accountedWrites) !== JSON.stringify(actual.writes)) {
        throw new Error(`${profileName} stutter ${stutter.action} does not account for every write`)
      }
      const retainedGuardReads = new Set()
      for (const action of profile.transitions) {
        const body = canonicalActionBodies.get(action) ?? ""
        const assignment = body.indexOf("state' =")
        const guard = body.slice(0, assignment)
        const evidence = actionReadWriteEvidence(body)
        for (const field of evidence.guardReads) retainedGuardReads.add(field)
        for (const [predicate, predicateBody] of predicateBodies) {
          if (new RegExp(`\\b${predicate}\\b`, "u").test(guard)) {
            for (const match of predicateBody.matchAll(/\bstate\.(\w+)/gu)) retainedGuardReads.add(match[1])
          }
        }
      }
      const guardCollisions = actual.writes.filter((field) => retainedGuardReads.has(field))
      const abstractions = Object.keys(stutter.guardReadAbstractions ?? {})
      if (JSON.stringify(sorted(guardCollisions)) !== JSON.stringify(sorted(abstractions))) {
        throw new Error(
          `${profileName} stutter ${stutter.action} does not account for every retained-action enabledness write`
        )
      }
      const proofSource = await readFile(`${root}/${stutter.proofFile}`, "utf8")
      const proofRuns = runBodies(proofSource)
      const forward = proofRuns.get(stutter.proofTest)
      const reverse = proofRuns.get(stutter.reverseProofTest)
      if (!forward || !stutter.proofTest.endsWith("Test") || !reverse || !stutter.reverseProofTest.endsWith("Test")) {
        throw new Error(`${profileName} stutter ${stutter.action} lacks a collected diamond/refinement test`)
      }
      const [first, second] = stutter.diamondPairs
      const marker = `// diamond: ${first} then ${second}; ${second} then ${first}; projection=${stutter.projectionView}`
      if (
        !first ||
        second !== stutter.action ||
        !profile.transitions.includes(first) ||
        !proofSource.includes(marker) ||
        !proofSource.includes(`pure def ${stutter.projectionView}(`) ||
        !forward.includes(`.then(${second}`) ||
        !forward.includes(`.then(${first})`) ||
        forward.indexOf(`.then(${second}`) > forward.indexOf(`.then(${first})`) ||
        !reverse.includes(`.then(${first})`) ||
        !reverse.includes(`.then(${second}`) ||
        reverse.indexOf(`.then(${first})`) > reverse.indexOf(`.then(${second}`) ||
        !forward.includes(`${stutter.projectionView}(state)`) ||
        !reverse.includes(`${stutter.projectionView}(state)`)
      ) {
        throw new Error(`${profileName} stutter ${stutter.action} lacks a diamond against retained transitions`)
      }
      for (const [field, projectionField] of Object.entries(stutter.guardReadAbstractions ?? {})) {
        if (!actual.writes.includes(field) || !proofSource.includes(`${projectionField}:`)) {
          throw new Error(
            `${profileName} stutter ${stutter.action} lacks an executable guard-read abstraction for ${field}`
          )
        }
        if (field === "phase") {
          const postProofPhases = [
            "ExactPublicationProofRecorded",
            "LocalPromotionRecorded",
            "FreshTaskPermissionRecorded",
            "TaskCompletionRecorded",
            "ResponsibilitySettled"
          ]
          for (const action of profile.transitions) {
            const body = canonicalActionBodies.get(action) ?? ""
            const assignment = body.indexOf("state' =")
            const guard = body.slice(0, assignment)
            let expandedGuard = guard
            for (const [predicate, predicateBody] of predicateBodies) {
              if (new RegExp(`\\b${predicate}\\b`, "u").test(guard)) expandedGuard += `\\n${predicateBody}`
            }
            if (
              postProofPhases.some((phase) =>
                new RegExp(`state\\.phase\\s*(?:==|!=)\\s*${phase}\\b`, "u").test(expandedGuard)
              )
            ) {
              throw new Error(
                `${profileName} retained transition ${action} distinguishes a phase inside ${projectionField}`
              )
            }
          }
        }
      }
    }
    for (const invariant of profile.invariantOwners) {
      const control = contract.invariantNegativeControls[invariant]
      let source = testFiles.get(control.testFile)
      if (source === undefined) {
        source = await readFile(`${root}/${control.testFile}`, "utf8")
        testFiles.set(control.testFile, source)
      }
      if (!source.includes(`run ${control.test} =`) || !control.test.endsWith("Test")) {
        throw new Error(
          `${profileName} negative control for ${invariant} is not a collected test in its owner projection`
        )
      }
      const mapping = new RegExp(
        `// invariant: ${invariant}\\s*// mutant: ${control.mutant}\\s*run ${control.test}\\s*=`
      )
      if (!mapping.test(source)) {
        throw new Error(`${profileName} negative control for ${invariant} does not identify its invariant and mutant`)
      }
      const body = runBodies(source).get(control.test)
      if (
        !body ||
        !body.includes(`.then(${control.mutant}`) ||
        !body.includes(`not(${invariant})`) ||
        !actionNames(source).includes(control.mutant) ||
        !source.includes(`import ${profile.main}.* from`)
      ) {
        throw new Error(
          `${profileName} negative control for ${invariant} does not reach its mutant and fail that invariant`
        )
      }
    }
    for (const action of mapped) assignedActions.add(action)
  }

  const missingGlobal = canonicalActions.filter((action) => !assignedActions.has(action))
  if (missingGlobal.length > 0) throw new Error(`unmapped canonical actions: ${missingGlobal.join(",")}`)

  const owned = [
    ...contract.profiles.grantControl.invariantOwners,
    ...contract.profiles.batchFinality.invariantOwners
  ].sort()
  if (JSON.stringify(owned) !== JSON.stringify(allInvariants)) {
    throw new Error("each canonical invariant must have exactly one projection owner")
  }
  for (const selector of contract.grantBatchReadySelectors) {
    for (const profile of Object.values(contract.profiles)) {
      if (!profile.transitions.includes(selector)) throw new Error(`selector ${selector} is not jointly explored`)
    }
  }
  return { canonicalActions, invariantCount: allInvariants.length }
}

export const assertDirectPublicationBatchGrantProjectionCommands = (commands) => {
  const contract = directPublicationBatchGrantProjectionContract
  const projectionTypecheck = commands.find(({ name }) => name === contract.projectionTypecheckCommand)
  if (
    !projectionTypecheck ||
    projectionTypecheck.kind !== "typecheck" ||
    JSON.stringify(projectionTypecheck.args) !== JSON.stringify(["typecheck", contract.projectionModel])
  ) {
    throw new Error("publication grant projection typecheck command differs from its source contract")
  }

  for (const profile of Object.values(directPublicationBatchGrantProjectionContract.profiles)) {
    const positive = commands.find(({ name }) => name === profile.positiveCommand)
    const negative = commands.find(({ name }) => name === profile.negativeCommand)
    const sampled = commands.find(({ name }) => name === profile.sampledCommand)
    const expectedPositive = ["test", profile.test, "--main", profile.positiveMain]
    const expectedNegative = ["test", profile.negativeTest, "--main", profile.negativeMain]
    if (
      !positive ||
      positive.kind !== "test" ||
      JSON.stringify(positive.args.slice(0, 4)) !== JSON.stringify(expectedPositive)
    ) {
      throw new Error(`positive projection command ${profile.positiveCommand} differs from its source contract`)
    }
    if (
      !negative ||
      negative.kind !== "test" ||
      JSON.stringify(negative.args.slice(0, 4)) !== JSON.stringify(expectedNegative)
    ) {
      throw new Error(`negative projection command ${profile.negativeCommand} differs from its source contract`)
    }
    if (
      !sampled ||
      sampled.kind !== "sampled-run" ||
      sampled.args[0] !== "run" ||
      sampled.args[1] !== contract.projectionModel
    ) {
      throw new Error(`sampled projection command ${profile.sampledCommand} differs from its model source`)
    }
    if (sampled.args[sampled.args.indexOf("--main") + 1] !== profile.main) {
      throw new Error(`sampled projection command ${profile.sampledCommand} selects the wrong main`)
    }
    const sampleInvariantStart = sampled.args.indexOf("--invariants")
    const sampleInvariantEnd = sampled.args.indexOf("--witnesses", sampleInvariantStart)
    const sampleWitnessEnd = sampled.args.indexOf("--max-steps", sampleInvariantEnd)
    if (
      sampleInvariantStart < 0 ||
      sampleInvariantEnd <= sampleInvariantStart ||
      sampleWitnessEnd <= sampleInvariantEnd
    ) {
      throw new Error(`sample command ${profile.sampledCommand} has an open invariant/witness argument list`)
    }
    const sampleInvariants = sampled.args.slice(sampleInvariantStart + 1, sampleInvariantEnd)
    const sampleWitnesses = sampled.args.slice(sampleInvariantEnd + 1, sampleWitnessEnd)
    if (JSON.stringify(sampleInvariants) !== JSON.stringify(profile.invariants)) {
      throw new Error(`sample command ${profile.sampledCommand} invariant list differs from its profile contract`)
    }
    if (JSON.stringify(sampleWitnesses) !== JSON.stringify(profile.witnesses)) {
      throw new Error(`sample command ${profile.sampledCommand} witness list differs from its profile contract`)
    }
    if (profile.verifyCommand !== undefined) {
      const verify = commands.find(({ name }) => name === profile.verifyCommand)
      if (
        !verify ||
        verify.kind !== "verify" ||
        verify.args[0] !== "verify" ||
        verify.args[1] !== contract.projectionModel
      ) {
        throw new Error(`verify command ${profile.verifyCommand} differs from its model source`)
      }
      if (verify.args[verify.args.indexOf("--main") + 1] !== profile.main) {
        throw new Error(`verify command ${profile.verifyCommand} selects the wrong main`)
      }
      const invariantStart = verify.args.indexOf("--invariants")
      const invariantEnd = verify.args.indexOf("--verbosity", invariantStart)
      if (invariantStart < 0 || invariantEnd <= invariantStart) {
        throw new Error(`verify command ${profile.verifyCommand} has no closed invariant argument list`)
      }
      const actual = verify.args.slice(invariantStart + 1, invariantEnd)
      if (JSON.stringify(actual) !== JSON.stringify(profile.invariants)) {
        throw new Error(`verify command ${profile.verifyCommand} invariant list differs from its profile contract`)
      }
    }
  }
}
