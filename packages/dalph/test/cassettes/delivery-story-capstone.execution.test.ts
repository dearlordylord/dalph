import { it } from "@effect/vitest"
import { NodeCrypto } from "@effect/platform-node"
import { plannedAttemptExecutorCorrelation } from "@dalph/contracts"
import {
  deliveryProposalOrderTaskId,
  deriveRunnableFrontier,
  CompletionTaskConfirmationReadOrdinal,
  evaluateDeliveryRuntimeInputBundle,
  integratorRunCorrelationForSession,
  integratorSuccessorCorrelationFor,
  IntegratorRunOrdinal,
  type JournalRecord,
  JournalPosition,
  reduceWorkflowJournalHistory,
  TargetLineageObservation,
  TrackerRevision,
  type DeliveryRelationInputBundle,
  WorkflowResponsibilityState
} from "@dalph/orchestrator"
import { Cause, Effect, Exit, Schema } from "effect"
import { expect } from "vitest"
// @ts-expect-error The C4 subprocess runner is an executable JavaScript test-support module.
import { runIssue268C4 } from "../../../../scripts/run-issue-268-c4.mjs"
import {
  runIssue268Ds01Characterization,
  runIssue268Ds02Characterization,
  runIssue268Ds03Characterization,
  runIssue268Ds04Characterization,
  runIssue268Ds05Characterization,
  runIssue268Ds06Characterization,
  runIssue268Ds07Characterization,
  runIssue268Ds08Characterization,
  runIssue268Ds09Characterization,
  runIssue268Ds10Characterization,
  runIssue268Ds11Characterization,
  runIssue268Ds12Characterization,
  runIssue268Ds13Characterization
} from "../../test-support/issue-268-controlled-characterization.js"
import { issue268ControlledDeliveryCharacterization as controlledScenario } from "../../test-support/issue-268-controlled-characterization-catalog.js"
import {
  consumeIssue268AcceptedOccurrenceOrder,
  issue268ControlledDeliveryCassetteCatalog,
  runIssue268ControlledDeliveryCassette
} from "../../test-support/issue-268-controlled-occurrence-cassette.js"
import { isIssue268Ds04CompleteCheckpoint } from "../../test-support/issue-268-controlled-ds04.js"
import { isIssue268Ds05CompleteCheckpoint } from "../../test-support/issue-268-controlled-ds05.js"
import {
  isIssue268Ds06CompleteCheckpoint,
  isIssue268RetainedBResponsibility
} from "../../test-support/issue-268-controlled-ds06.js"
import { isIssue268Ds07CompleteCheckpoint } from "../../test-support/issue-268-controlled-ds07.js"
import { isIssue268Ds10CompleteCheckpoint } from "../../test-support/issue-268-controlled-ds10.js"
import { isIssue268Ds11CompleteCheckpoint } from "../../test-support/issue-268-controlled-ds11.js"
import { isIssue268Ds12CompleteCheckpoint } from "../../test-support/issue-268-controlled-ds12.js"
import { isIssue268Ds13CompleteCheckpoint } from "../../test-support/issue-268-controlled-ds13.js"
import {
  issue268OccurrenceEvidenceIsComplete,
  issue268RequiredClaimCoverageIsComplete,
  reverseIssue268RequiredEdge,
  validateIssue268RequiredEdges,
  type Issue268CausalLandmark,
  type Issue268ObservedOccurrence,
  type Issue268OccurrenceSource,
  type Issue268RequiredEdge
} from "../../test-support/issue-268-controlled-occurrences.js"
import {
  AuthoredScenarioCassette,
  maintainedAuthoredCassetteCatalog,
  runAuthoredScenarioCassette,
  type AuthoredObservationCapture,
  type AuthoredScenarioCassetteRun
} from "../../src/cassettes/index.js"

const lastItemIndex = -1
const capstoneTimeout = 600_000
const boundedContinuationTimeout = 120_000
const c4RepeatabilityTimeout = 18 * 60_000
const vitestEnvironment = Reflect.get(import.meta, "env")
const c4AlreadyRunsOutsideCoverage =
  typeof vitestEnvironment === "object" &&
  vitestEnvironment !== null &&
  Reflect.get(vitestEnvironment, "MODE") === "coverage"
const cachedRun = Effect.runSync(
  Effect.cached(
    runAuthoredScenarioCassette(maintainedAuthoredCassetteCatalog.deliveryInvariantStory).pipe(
      Effect.provide(NodeCrypto.layer)
    )
  )
)
const cachedDs14ThroughDs17Run = Effect.runSync(
  Effect.cached(
    runAuthoredScenarioCassette(maintainedAuthoredCassetteCatalog.deliveryStoryDs14ThroughDs17).pipe(
      Effect.provide(NodeCrypto.layer)
    )
  )
)

const contributedTaskIds = (publications: ReadonlyArray<DeliveryRelationInputBundle>) =>
  publications.flatMap(({ actionInputs }) =>
    actionInputs.proposalContributions.ticketDelivery.flatMap(({ order }) => ("taskId" in order ? [order.taskId] : []))
  )

type JournalEvent = JournalRecord["event"]
type JournalEventTag = JournalEvent["_tag"]
type JournalRecordFor<Tag extends JournalEventTag> = JournalRecord & {
  readonly event: Extract<JournalEvent, { readonly _tag: Tag }>
}
type AuthoredStoryOccurrence = Extract<
  AuthoredObservationCapture,
  { readonly _tag: "AuthoredStoryOccurrenceCaptured" }
>["occurrence"]
type AuthoredStoryOccurrenceTag = AuthoredStoryOccurrence["_tag"]

const eventRecords = <Tag extends JournalEventTag>(
  run: AuthoredScenarioCassetteRun,
  tag: Tag
): ReadonlyArray<JournalRecordFor<Tag>> =>
  run.records.filter((record): record is JournalRecordFor<Tag> => record.event._tag === tag)

const storyOccurrences = <Tag extends AuthoredStoryOccurrenceTag>(
  run: AuthoredScenarioCassetteRun,
  tag: Tag
): ReadonlyArray<Extract<AuthoredStoryOccurrence, { readonly _tag: Tag }>> =>
  run.observationCaptures.flatMap((capture) =>
    capture._tag === "AuthoredStoryOccurrenceCaptured" && capture.occurrence._tag === tag
      ? [capture.occurrence as Extract<AuthoredStoryOccurrence, { readonly _tag: Tag }>]
      : []
  )

type DeliveryStoryRestartAuthorityRead = "ReadTargetLineage" | "ReadTaskClaim" | "ReadTrackerGraph"

const generatedAuthorityReadJournalWidth = (
  run: AuthoredScenarioCassetteRun,
  operationTag: DeliveryStoryRestartAuthorityRead
): number | undefined => {
  if (operationTag === "ReadTargetLineage") {
    const intents = eventRecords(run, "GitReadIntentRecorded").filter(
      ({ event }) => event.operation._tag === operationTag
    )
    const widths = intents.flatMap((intent) => {
      const observations = eventRecords(run, "TargetLineageObserved").filter(
        ({ event }) => event.operationId === intent.event.operation.operationId
      )
      return observations.length === 1 && observations[0] !== undefined && observations[0].position > intent.position
        ? [Number(observations[0].position) - Number(intent.position) + 1]
        : []
    })
    const distinctWidths = new Set(widths)
    return intents.length > 0 && widths.length === intents.length && distinctWidths.size === 1 ? widths[0] : undefined
  }
  const intents = eventRecords(run, "TaskTrackerReadIntentRecorded").filter(
    ({ event }) => event.operation._tag === operationTag
  )
  const widths = intents.flatMap((intent) => {
    const observations = eventRecords(run, "TaskTrackerFactsObserved").filter(
      ({ event }) => event.operationId === intent.event.operation.operationId
    )
    return observations.length === 1 && observations[0] !== undefined && observations[0].position > intent.position
      ? [Number(observations[0].position) - Number(intent.position) + 1]
      : []
  })
  const distinctWidths = new Set(widths)
  return intents.length > 0 && widths.length === intents.length && distinctWidths.size === 1 ? widths[0] : undefined
}

const one = <Value>(values: ReadonlyArray<Value>, label: string, issues: Array<string>): Value | undefined => {
  if (values.length === 1) return values[0]
  issues.push(`${label}: expected exactly one, observed ${values.length}`)
  return undefined
}

const canonicalValue = (value: unknown): unknown =>
  Array.isArray(value)
    ? value.map(canonicalValue)
    : typeof value === "object" && value !== null
      ? Object.fromEntries(
          Object.entries(value)
            .sort(([left], [right]) => left.localeCompare(right))
            .map(([key, nested]) => [key, canonicalValue(nested)])
        )
      : value

const sameValue = (left: unknown, right: unknown): boolean =>
  JSON.stringify(canonicalValue(left)) === JSON.stringify(canonicalValue(right))

const recordIssueUnless = (issues: Array<string>, condition: boolean, issue: string): void => {
  if (!condition) issues.push(issue)
}

const issue272AdmissionAndSessionIssues = (run: AuthoredScenarioCassetteRun): ReadonlyArray<string> => {
  const issues: Array<string> = []
  const accepted = one(
    eventRecords(run, "PlannedAttemptExecutorWorkReported").filter(
      ({ event }) =>
        event.report._tag === "ExecutorWorkTerminal" &&
        event.report.correlation.attemptId === "attempt:A:0" &&
        event.report.result._tag === "Accepted"
    ),
    "accepted A result",
    issues
  )
  const queued = one(eventRecords(run, "IntegrationResponsibilityBegan"), "integration queue entry", issues)
  const started = one(eventRecords(run, "IntegrationStarted"), "integration start", issues)
  const predecessor = one(eventRecords(run, "IntegratorSessionFixed"), "predecessor session", issues)
  const successor = one(eventRecords(run, "IntegratorSuccessorSessionFixed"), "successor session", issues)
  if (accepted === undefined || queued === undefined || started === undefined || predecessor === undefined)
    return issues
  if (accepted.event.report._tag !== "ExecutorWorkTerminal" || accepted.event.report.result._tag !== "Accepted") {
    issues.push("accepted A result lost its terminal accepted shape")
    return issues
  }
  recordIssueUnless(
    issues,
    accepted.position < queued.position && queued.position < started.position,
    "A < queue < start"
  )
  recordIssueUnless(
    issues,
    sameValue(queued.event.acceptedResult, accepted.event.report.result.acceptedResult) &&
      sameValue(started.event.acceptedResult, queued.event.acceptedResult) &&
      sameValue(started.event.plannedAttempt, queued.event.plannedAttempt) &&
      sameValue(started.event.integrationTarget, queued.event.integrationTarget) &&
      started.event.responsibilityBeganAt === queued.position,
    "queue and start must retain exact accepted result, attempt, target, and queue position"
  )
  recordIssueUnless(
    issues,
    sameValue(predecessor.event.correlation.acceptedResult, queued.event.acceptedResult) &&
      sameValue(predecessor.event.correlation.plannedAttempt, queued.event.plannedAttempt) &&
      sameValue(predecessor.event.correlation.integrationTarget, queued.event.integrationTarget) &&
      predecessor.event.correlation.queuedAt === queued.position &&
      predecessor.event.correlation.startedAt === started.position &&
      predecessor.event.correlation.expectedTargetHead === "1111111111111111111111111111111111111111",
    "S1 must bind the exact queue, target, attempt, H, and responsibility positions"
  )
  if (successor !== undefined) {
    recordIssueUnless(issues, sameValue(successor.event.predecessor, predecessor.event.correlation), "S2 predecessor")
    recordIssueUnless(
      issues,
      sameValue(successor.event.successor.acceptedResult, predecessor.event.correlation.acceptedResult) &&
        sameValue(successor.event.successor.plannedAttempt, predecessor.event.correlation.plannedAttempt) &&
        sameValue(successor.event.successor.integrationTarget, predecessor.event.correlation.integrationTarget) &&
        successor.event.successor.queuedAt === predecessor.event.correlation.queuedAt &&
        successor.event.successor.startedAt === predecessor.event.correlation.startedAt,
      "S2 must preserve the same queued responsibility"
    )
    recordIssueUnless(
      issues,
      successor.event.successor.sessionId !== predecessor.event.correlation.sessionId &&
        successor.event.successor.candidateResource !== predecessor.event.correlation.candidateResource &&
        successor.event.successor.expectedTargetHead === "2222222222222222222222222222222222222222",
      "S2 must use fresh identities fixed at exact H2"
    )
  }
  return issues
}

const issue272PromotionIssues = (
  run: AuthoredScenarioCassetteRun,
  expectedRejectedAttemptOrdinal: 1 | 2 = 1,
  expectedFreshLineagePairCount: 1 | 2 = 1
): ReadonlyArray<string> => {
  const issues: Array<string> = []
  const predecessor = one(eventRecords(run, "IntegratorSessionFixed"), "predecessor session", issues)
  const successor = one(eventRecords(run, "IntegratorSuccessorSessionFixed"), "successor session", issues)
  const stale = one(eventRecords(run, "TargetPromotionStale"), "promotion stale fact", issues)
  const quarantine = one(eventRecords(run, "IntegrationQuarantined"), "integration quarantine", issues)
  const direction = one(
    eventRecords(run, "IntegrationQuarantineDirectionApplied"),
    "Operator FullRerun direction",
    issues
  )
  const candidates = eventRecords(run, "IntegratorRunCandidateGitObserved").filter(
    ({ event }) => event.observation._tag === "Commit"
  )
  const compareAndSets = storyOccurrences(run, "TargetPromotionCompareAndSetReturned")
  recordIssueUnless(
    issues,
    candidates.length === 2,
    `candidate observations: expected 2, observed ${candidates.length}`
  )
  recordIssueUnless(
    issues,
    sameValue(
      candidates.map(({ event }) => (event.observation._tag === "Commit" ? event.observation.directParents : [])),
      [
        ["1111111111111111111111111111111111111111", "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"],
        ["2222222222222222222222222222222222222222", "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"]
      ]
    ),
    "M and M2 must have exact ordered parents [H, C] and [H2, C]"
  )
  if (predecessor !== undefined && successor !== undefined) {
    recordIssueUnless(
      issues,
      candidates.length === 2 &&
        sameValue(candidates[0]?.event.run.session, predecessor.event.correlation) &&
        sameValue(candidates[1]?.event.run.session, successor.event.successor),
      "M and M2 must bind exactly to S1 and S2"
    )
  }
  recordIssueUnless(
    issues,
    compareAndSets.length === 2,
    `promotion CAS results: expected 2, observed ${compareAndSets.length}`
  )
  recordIssueUnless(
    issues,
    sameValue(
      compareAndSets.map(({ request, result }) => ({ request, result })),
      [
        {
          request: {
            candidateCommit: "cccccccccccccccccccccccccccccccccccccccc",
            expectedTargetHead: "1111111111111111111111111111111111111111",
            integrationTarget: { ref: "refs/heads/master", repository: "/dalph/cassettes/integration.git" }
          },
          result: { _tag: "RejectedExpectedHead", observedHeadSha: "2222222222222222222222222222222222222222" }
        },
        {
          request: {
            candidateCommit: "dddddddddddddddddddddddddddddddddddddddd",
            expectedTargetHead: "2222222222222222222222222222222222222222",
            integrationTarget: { ref: "refs/heads/master", repository: "/dalph/cassettes/integration.git" }
          },
          result: { _tag: "Applied" }
        }
      ]
    ),
    "promotion must use one rejected exact-head CAS followed by one applied successor CAS, never force-update"
  )
  if (stale === undefined || quarantine === undefined || direction === undefined || successor === undefined)
    return issues
  recordIssueUnless(
    issues,
    stale.position < quarantine.position &&
      quarantine.position < direction.position &&
      direction.position < successor.position,
    "stale < quarantine < FullRerun < S2"
  )
  recordIssueUnless(
    issues,
    stale.event.basis._tag === "AfterAttempt" &&
      stale.event.basis.attemptOrdinal === expectedRejectedAttemptOrdinal &&
      stale.event.observation._tag === "CompareAndSetRejected" &&
      stale.event.observation.observedHeadSha === "2222222222222222222222222222222222222222" &&
      sameValue(stale.event.correlation.qualifiedCandidate.run.session, successor.event.predecessor),
    "stale must be the exact rejected S1/H attempt"
  )
  recordIssueUnless(
    issues,
    quarantine.event.basis._tag === "PromotionStale" &&
      quarantine.event.basis.observedTargetHead === "2222222222222222222222222222222222222222" &&
      sameValue(quarantine.event.correlation, successor.event.predecessor) &&
      successor.event.quarantineAt === quarantine.position,
    "quarantine must bind the exact stale predecessor"
  )
  recordIssueUnless(
    issues,
    direction.event.fingerprint.direction === "FullRerun" &&
      direction.event.fingerprint.quarantineAt === quarantine.position &&
      direction.event.fingerprint.sessionId === successor.event.predecessor.sessionId &&
      successor.event.directionAppliedAt === direction.position &&
      direction.event.requestId.runId === run.runId,
    "Operator direction must bind exact Run, Q, S1, and FullRerun"
  )
  const freshLineageIntents = eventRecords(run, "GitReadIntentRecorded").filter(
    ({ event, position }) =>
      position > direction.position &&
      position < successor.position &&
      event.operation._tag === "ReadTargetLineage" &&
      event.operation.plannedAttempt.attemptId === "attempt:A:0" &&
      event.operation.plannedAttempt.taskId === "A"
  )
  const freshLineageResults = eventRecords(run, "TargetLineageObserved").filter(
    ({ position }) => position > direction.position && position < successor.position
  )
  recordIssueUnless(
    issues,
    freshLineageIntents.length === expectedFreshLineagePairCount &&
      freshLineageResults.length === expectedFreshLineagePairCount,
    `fresh-H2 lineage pairs: expected ${expectedFreshLineagePairCount}, observed ${freshLineageIntents.length} intents and ${freshLineageResults.length} results`
  )
  recordIssueUnless(
    issues,
    freshLineageIntents.every((intent, index) => {
      const result = freshLineageResults[index]
      const precedingResult = freshLineageResults[index - 1]
      return (
        result !== undefined &&
        (precedingResult === undefined || precedingResult.position < intent.position) &&
        direction.position < intent.position &&
        intent.position < result.position &&
        result.position < successor.position &&
        intent.event.operation.operationId === result.event.operationId &&
        result.event.observation.targetHeadSha === "2222222222222222222222222222222222222222" &&
        result.event.observation.plannedBaseSha === "1111111111111111111111111111111111111111" &&
        result.event.observation.plannedBaseIsAncestorOfTargetHead
      )
    }) && successor.event.successor.targetLineageObservedAt === freshLineageResults.at(-1)?.position,
    "every fresh lineage intent/result must prove H2 after D and before S2, which binds the final proof"
  )
  return issues
}

const issue272FinalityIssues = (run: AuthoredScenarioCassetteRun): ReadonlyArray<string> => {
  const issues: Array<string> = []
  const promotion = one(eventRecords(run, "TargetPromotionObservedSuccess"), "successor promotion", issues)
  const replacement = one(eventRecords(run, "CompletionClaimReplaced"), "completion-claim replacement", issues)
  const completionAttempt = one(eventRecords(run, "CompletionTaskAttemptIntended"), "completion attempt", issues)
  const completionAck = one(eventRecords(run, "CompletionTaskAcknowledged"), "completion acknowledgement", issues)
  const focusedSuccess = one(
    eventRecords(run, "TaskTrackerFactsObserved").filter(
      ({ event }) =>
        event.observation._tag === "FocusedTaskCompletionFacts" &&
        event.observation.facts.taskId === "A" &&
        event.observation.facts.lifecycle === "CompletedSuccessfully"
    ),
    "focused A success",
    issues
  )
  const focusedSuccessIntent = one(
    eventRecords(run, "TaskTrackerReadIntentRecorded").filter(
      ({ event }) =>
        event.operation._tag === "ReadCompletionTaskFacts" &&
        focusedSuccess !== undefined &&
        event.operation.operationId === focusedSuccess.event.operationId
    ),
    "focused A success read intent",
    issues
  )
  const releaseIntent = one(eventRecords(run, "TaskClaimReleaseIntended"), "original-claim release intent", issues)
  const released = one(eventRecords(run, "TaskClaimReleased"), "original-claim release", issues)
  const deletion = one(eventRecords(run, "CompletionClaimDeleted"), "completion-marker deletion", issues)
  const settled = one(eventRecords(run, "IntegrationFinalitySettled"), "finality settlement", issues)
  const activeClaimReads = eventRecords(run, "TaskTrackerFactsObserved").filter(
    ({ event, position }) =>
      replacement !== undefined &&
      position < replacement.position &&
      event.observation._tag === "FocusedTaskClaimFacts" &&
      event.observation.observation._tag === "ActiveTaskClaim"
  )
  if (activeClaimReads.length === 0) issues.push("original active claim: expected at least one exact read")
  const activeClaimRead = activeClaimReads.at(-1)
  if (
    promotion === undefined ||
    replacement === undefined ||
    completionAttempt === undefined ||
    completionAck === undefined ||
    focusedSuccess === undefined ||
    releaseIntent === undefined ||
    released === undefined ||
    deletion === undefined ||
    settled === undefined ||
    activeClaimRead === undefined ||
    focusedSuccessIntent === undefined ||
    focusedSuccessIntent.event.operation._tag !== "ReadCompletionTaskFacts" ||
    activeClaimRead.event.observation._tag !== "FocusedTaskClaimFacts" ||
    activeClaimRead.event.observation.observation._tag !== "ActiveTaskClaim" ||
    focusedSuccess.event.observation._tag !== "FocusedTaskCompletionFacts"
  ) {
    return issues
  }
  const originalClaim = activeClaimRead.event.observation.observation
  const focusedRead = focusedSuccessIntent.event.operation
  const focusedObservation = focusedSuccess.event.observation
  const focusedFacts = focusedObservation.facts
  const successObservation = deletion.event.successObservation
  recordIssueUnless(
    issues,
    promotion.position < replacement.position &&
      replacement.position < completionAttempt.position &&
      completionAttempt.position < completionAck.position &&
      completionAck.position < focusedSuccess.position &&
      focusedSuccess.position < releaseIntent.position &&
      releaseIntent.position < released.position &&
      released.position < deletion.position &&
      deletion.position < settled.position,
    "promotion < replacement < completion Q < focused success < original release < marker deletion < settlement"
  )
  recordIssueUnless(
    issues,
    completionAck.position < focusedSuccessIntent.position &&
      focusedSuccessIntent.position < focusedSuccess.position &&
      focusedRead.operationId === focusedSuccess.event.operationId &&
      focusedObservation.operationId === focusedRead.operationId &&
      focusedFacts.operationId === focusedRead.operationId &&
      sameValue(focusedRead.request, completionAck.event.request) &&
      sameValue(focusedObservation.request, focusedRead.request) &&
      sameValue(focusedObservation.purpose, focusedRead.purpose) &&
      sameValue(focusedObservation.target, focusedRead.target) &&
      focusedObservation.purpose._tag === "Confirmation" &&
      focusedObservation.purpose.attemptOrdinal === completionAck.event.attemptOrdinal &&
      focusedObservation.purpose.confirmationOrdinal === CompletionTaskConfirmationReadOrdinal.make(1) &&
      focusedFacts.currentClaim._tag === "CompletionTaskClaim" &&
      sameValue(focusedFacts.currentClaim, replacement.event.claim) &&
      focusedFacts.lifecycle === "CompletedSuccessfully" &&
      focusedFacts.taskId === completionAck.event.request.taskId &&
      focusedFacts.taskRevision === completionAck.event.request.taskRevision &&
      sameValue(focusedFacts.target, focusedRead.target),
    "focused success must be the exact post-acknowledgement confirmation read for Q and its replacement claim"
  )
  recordIssueUnless(
    issues,
    successObservation.observedAt === focusedSuccess.position &&
      successObservation.operationId === focusedRead.operationId &&
      successObservation.taskId === focusedFacts.taskId &&
      successObservation.taskRevision === focusedFacts.taskRevision &&
      successObservation.trackerRevision === focusedFacts.trackerRevision &&
      sameValue(successObservation.target, focusedFacts.target) &&
      sameValue(successObservation.claim, focusedFacts.currentClaim),
    "cleanup success authority must be derived from the exact focused read record and causal position"
  )
  recordIssueUnless(
    issues,
    sameValue(replacement.event.claim.originalClaim, originalClaim) &&
      activeClaimReads.every(
        ({ event }) =>
          event.observation._tag === "FocusedTaskClaimFacts" &&
          event.observation.observation._tag === "ActiveTaskClaim" &&
          sameValue(event.observation.observation, originalClaim)
      ) &&
      sameValue(completionAttempt.event.request.claim, replacement.event.claim) &&
      sameValue(completionAck.event.request, completionAttempt.event.request) &&
      sameValue(releaseIntent.event.operation.release.claim, originalClaim) &&
      sameValue(released.event.release.claim, originalClaim) &&
      sameValue(successObservation.claim, replacement.event.claim) &&
      sameValue(deletion.event.claim, replacement.event.claim) &&
      sameValue(settled.event.claim, replacement.event.claim) &&
      sameValue(settled.event.successObservation, successObservation),
    "replacement, Q, success, original release, deletion, and settlement must retain one exact claim chain"
  )
  const deletionReads = eventRecords(run, "CompletionClaimDeletionReadObserved")
  recordIssueUnless(
    issues,
    sameValue(
      deletionReads.map(({ event }) => ({ observation: event.observation._tag, purpose: event.purpose._tag })),
      [
        { observation: "CompletionTaskClaim", purpose: "BeforeOriginalClaimRelease" },
        { observation: "CompletionTaskClaim", purpose: "BeforeDeletionAttempt" },
        { observation: "UnclaimedTask", purpose: "ConfirmOriginalClaimReleased" },
        { observation: "CompletionClaimMarkerAbsent", purpose: "BeforeDeletionAttempt" },
        { observation: "UnclaimedTask", purpose: "ConfirmNoActiveClaimAfterMarkerAbsent" }
      ]
    ) &&
      deletionReads.every(({ event }) => sameValue(event.request.claim, replacement.event.claim)) &&
      deletionReads[3] !== undefined &&
      deletionReads[3].position < deletion.position &&
      deletionReads[4] !== undefined &&
      deletionReads[4].position < deletion.position,
    "cleanup must observe the exact marker/active sequence and prove both absences before recording deletion"
  )
  return issues
}

const issue272AcceptanceIssues = (
  run: AuthoredScenarioCassetteRun,
  expectedRejectedAttemptOrdinal: 1 | 2 = 1,
  expectedFreshLineagePairCount: 1 | 2 = 1
): ReadonlyArray<string> => [
  ...issue272AdmissionAndSessionIssues(run),
  ...issue272PromotionIssues(run, expectedRejectedAttemptOrdinal, expectedFreshLineagePairCount),
  ...issue272FinalityIssues(run)
]

const deliveryStoryIntegrationRestartCheckpoints = [
  "TargetPromotionAttemptIntended",
  "TargetPromotionStale",
  "IntegrationQuarantined",
  "IntegrationQuarantineDirectionApplied",
  "TargetLineageObserved",
  "IntegratorSuccessorSessionFixed"
] as const

const deliveryStoryFinalityRestartCheckpoints = [
  "TargetPromotionObservedSuccess",
  "CompletionClaimReplaced",
  "CompletionTaskAcknowledged",
  "CompletionClaimDeleted",
  "IntegrationFinalitySettled"
] as const

const deliveryStoryRestartCheckpoints = [
  ...deliveryStoryIntegrationRestartCheckpoints,
  ...deliveryStoryFinalityRestartCheckpoints
] as const

type DeliveryStoryRestartCheckpoint = (typeof deliveryStoryRestartCheckpoints)[number]

it("distinguishes legacy and exact targeted coordinator deaths at the cassette boundary", () => {
  const base = maintainedAuthoredCassetteCatalog.deliveryStoryDs14ThroughDs17
  const decodeStrict = Schema.decodeUnknownSync(AuthoredScenarioCassette, { onExcessProperty: "error" })
  const withFirstDeathReplacedBy = (replacement: unknown) => {
    let replaced = false
    return {
      ...base,
      story: base.story.map((item) => {
        if (replaced || item._tag !== "CoordinatorProcessDies") return item
        replaced = true
        return replacement
      })
    }
  }

  expect(() =>
    decodeStrict(
      withFirstDeathReplacedBy({ _tag: "CoordinatorProcessDies", afterJournalEvent: "TargetPromotionStale" })
    )
  ).toThrow()
  expect(() =>
    decodeStrict(
      withFirstDeathReplacedBy({
        _tag: "CoordinatorProcessDiesAfterJournalEvent",
        afterJournalEvent: "TargetPromotionStale"
      })
    )
  ).not.toThrow()
  expect(() => decodeStrict(withFirstDeathReplacedBy({ _tag: "CoordinatorProcessDiesAfterJournalEvent" }))).toThrow()
  expect(() =>
    decodeStrict(
      withFirstDeathReplacedBy({
        _tag: "CoordinatorProcessDiesAfterJournalEvent",
        afterJournalEvent: "ExpectedBehavior"
      })
    )
  ).toThrow()
})

const deliveryStoryFinalityRestartInsertionAt = (
  story: ReadonlyArray<AuthoredStoryOccurrence>,
  checkpoint: (typeof deliveryStoryFinalityRestartCheckpoints)[number]
): number => {
  if (checkpoint === "TargetPromotionObservedSuccess") {
    return story.findIndex(
      (item) => item._tag === "TargetPromotionCompareAndSetReturned" && item.result._tag === "Applied"
    )
  }
  if (checkpoint === "CompletionClaimReplaced") {
    return story.findIndex((item) => item._tag === "CompletionClaimReplacementApplied")
  }
  if (checkpoint === "CompletionTaskAcknowledged") {
    return story.findIndex(
      (item) => item._tag === "CompletionTaskRequestReturned" && item.taskId === "A" && item.outcome === "Acknowledged"
    )
  }
  return story.findIndex((item) => item._tag === "ExpectedBehavior") - 1
}

const deliveryStoryWithRestartAfter = (
  afterJournalEvent: DeliveryStoryRestartCheckpoint,
  baselineRun: AuthoredScenarioCassetteRun
) => {
  const base = maintainedAuthoredCassetteCatalog.deliveryStoryDs14ThroughDs17
  const story = [...base.story]
  const originalDeathAt = story.findIndex((item) => item._tag === "CoordinatorProcessDies")
  const originalRestartIntegratorRequestAt = story.findIndex(
    (item, index) => index > originalDeathAt && item._tag === "IntegratorRequestReceived"
  )
  const originalRestartAuthorityReads = story.slice(originalDeathAt + 1, originalRestartIntegratorRequestAt)
  // A recovered accepted attempt rereads the tracker graph and exact claim
  // before it resumes an already-started integration protocol.
  const restartAuthorityReads = originalRestartAuthorityReads.slice(0, 4)
  const restartGraphAuthorityReads = restartAuthorityReads.slice(0, 2)
  const restartPostProtocolGraphRead = originalRestartAuthorityReads.slice(4, 6)
  const rejectedCompareAndSetAt = story.findIndex(
    (item) => item._tag === "TargetPromotionCompareAndSetReturned" && item.result._tag === "RejectedExpectedHead"
  )
  const directionAt = story.findIndex((item) => item._tag === "OperatorAppliesIntegrationQuarantineDirection")
  const freshLineageSelectionAt = story.findIndex(
    (item, index) => index > directionAt && item._tag === "DalphSelects" && item.operation._tag === "ReadTargetLineage"
  )
  const successorRequestAt = story.findIndex(
    (item, index) => index > directionAt && item._tag === "IntegratorRequestReceived"
  )
  const predecessorRequestIndices = story.flatMap((item, index) =>
    index < rejectedCompareAndSetAt && item._tag === "IntegratorRequestReceived" ? [index] : []
  )
  const predecessorRequest = story[predecessorRequestIndices[0] ?? lastItemIndex]
  const successorRequest = story[successorRequestAt]
  const operatorDirection = story[directionAt]
  const baselineSuccessorRecords = eventRecords(baselineRun, "IntegratorSuccessorSessionFixed")
  const baselineSuccessor = baselineSuccessorRecords.length === 1 ? baselineSuccessorRecords[0] : undefined
  if (
    predecessorRequestIndices.length !== 1 ||
    predecessorRequest?._tag !== "IntegratorRequestReceived" ||
    successorRequest?._tag !== "IntegratorRequestReceived" ||
    baselineSuccessor === undefined ||
    operatorDirection?._tag !== "OperatorAppliesIntegrationQuarantineDirection" ||
    restartGraphAuthorityReads[0]?._tag !== "DalphSelects" ||
    restartGraphAuthorityReads[0].operation._tag !== "ReadTrackerGraph" ||
    restartGraphAuthorityReads[1]?._tag !== "TrackerGraphReadReturned"
  ) {
    return { ...base, name: `${base.name}; invalid restart fixture`, story: [] }
  }
  const completedGraphAuthorityReads = [
    restartGraphAuthorityReads[0],
    {
      ...restartGraphAuthorityReads[1],
      graph: {
        ...restartGraphAuthorityReads[1].graph,
        revision: TrackerRevision.make(`${restartGraphAuthorityReads[1].graph.revision}:completed`),
        tasks: restartGraphAuthorityReads[1].graph.tasks.map((task) =>
          task.id === "A" ? { ...task, lifecycle: { _tag: "CompletedSuccessfully" as const } } : task
        )
      }
    }
  ]
  const restartCheckpointIndex = deliveryStoryIntegrationRestartCheckpoints.findIndex(
    (checkpoint) => checkpoint === afterJournalEvent
  )
  const restartPrecedes = (checkpoint: (typeof deliveryStoryIntegrationRestartCheckpoints)[number]): boolean =>
    restartCheckpointIndex >= 0 &&
    restartCheckpointIndex < deliveryStoryIntegrationRestartCheckpoints.indexOf(checkpoint)
  const authorityReadJournalWidths = {
    ReadTargetLineage: generatedAuthorityReadJournalWidth(baselineRun, "ReadTargetLineage"),
    ReadTaskClaim: generatedAuthorityReadJournalWidth(baselineRun, "ReadTaskClaim"),
    ReadTrackerGraph: generatedAuthorityReadJournalWidth(baselineRun, "ReadTrackerGraph")
  }
  const journalRecordsForSelectedReads = (items: ReadonlyArray<AuthoredStoryOccurrence>): number | undefined => {
    let width = 0
    for (const item of items) {
      if (item._tag !== "DalphSelects") continue
      if (
        item.operation._tag !== "ReadTargetLineage" &&
        item.operation._tag !== "ReadTaskClaim" &&
        item.operation._tag !== "ReadTrackerGraph"
      ) {
        return undefined
      }
      const operationWidth = authorityReadJournalWidths[item.operation._tag]
      if (operationWidth === undefined) return undefined
      width += operationWidth
    }
    return width
  }
  const recoveredAuthorityShift = journalRecordsForSelectedReads(restartAuthorityReads)
  const postProtocolGraphShift = journalRecordsForSelectedReads(restartPostProtocolGraphRead)
  const replacementLineageShift = journalRecordsForSelectedReads(originalRestartAuthorityReads)
  if (
    recoveredAuthorityShift === undefined ||
    postProtocolGraphShift === undefined ||
    replacementLineageShift === undefined
  ) {
    return { ...base, name: `${base.name}; invalid generated authority-read widths`, story: [] }
  }
  const reconciledPriorIntentOutcomeShift = afterJournalEvent === "TargetPromotionAttemptIntended" ? 1 : 0
  const quarantineShift =
    (restartPrecedes("IntegrationQuarantined") ? recoveredAuthorityShift : 0) + reconciledPriorIntentOutcomeShift
  const directionShift =
    (restartPrecedes("IntegrationQuarantineDirectionApplied") ? recoveredAuthorityShift : 0) +
    reconciledPriorIntentOutcomeShift
  const lineageShift =
    afterJournalEvent === "TargetLineageObserved"
      ? replacementLineageShift
      : (restartPrecedes("TargetLineageObserved") ? recoveredAuthorityShift + postProtocolGraphShift : 0) +
        reconciledPriorIntentOutcomeShift
  const quarantineAt = JournalPosition.make(Number(baselineSuccessor.event.quarantineAt) + quarantineShift)
  const directionAppliedAt = JournalPosition.make(Number(baselineSuccessor.event.directionAppliedAt) + directionShift)
  const targetLineageObservedAt = JournalPosition.make(
    Number(baselineSuccessor.event.successor.targetLineageObservedAt) + lineageShift
  )
  const successorSession = integratorSuccessorCorrelationFor({
    directionAppliedAt,
    predecessor: predecessorRequest.correlation.session,
    quarantineAt,
    targetLineage: TargetLineageObservation.make({
      plannedBaseIsAncestorOfTargetHead: true,
      plannedBaseSha: predecessorRequest.correlation.session.expectedTargetHead,
      targetHeadSha: successorRequest.correlation.session.expectedTargetHead
    }),
    targetLineageObservedAt
  })
  story[directionAt] = {
    ...operatorDirection,
    request: { ...operatorDirection.request, fingerprint: { ...operatorDirection.request.fingerprint, quarantineAt } }
  }
  story[successorRequestAt] = {
    ...successorRequest,
    correlation: integratorRunCorrelationForSession(successorSession, IntegratorRunOrdinal.make(1))
  }
  const death = { _tag: "CoordinatorProcessDiesAfterJournalEvent" as const, afterJournalEvent }

  if (afterJournalEvent === "TargetPromotionAttemptIntended") {
    const rejected = story[rejectedCompareAndSetAt]
    if (rejected?._tag !== "TargetPromotionCompareAndSetReturned") {
      return { ...base, name: `${base.name}; missing rejected CAS fixture`, story: [] }
    }
    story.splice(rejectedCompareAndSetAt, 0, death, ...restartAuthorityReads, {
      _tag: "TargetPromotionGitReadReturned",
      candidateCommit: rejected.request.candidateCommit,
      observation: { _tag: "CandidateNotInAncestry", currentHeadSha: rejected.request.expectedTargetHead },
      repository: rejected.request.integrationTarget.repository
    })
    const resumedDirectionAt = story.findIndex((item) => item._tag === "OperatorAppliesIntegrationQuarantineDirection")
    const resumedFreshLineageAt = story.findIndex(
      (item, index) =>
        index > resumedDirectionAt && item._tag === "DalphSelects" && item.operation._tag === "ReadTargetLineage"
    )
    story.splice(resumedFreshLineageAt, 0, ...restartPostProtocolGraphRead)
  } else if (afterJournalEvent === "TargetPromotionStale" || afterJournalEvent === "IntegrationQuarantined") {
    story.splice(rejectedCompareAndSetAt + 1, 0, death, ...restartAuthorityReads)
    const resumedDirectionAt = story.findIndex((item) => item._tag === "OperatorAppliesIntegrationQuarantineDirection")
    const resumedFreshLineageAt = story.findIndex(
      (item, index) =>
        index > resumedDirectionAt && item._tag === "DalphSelects" && item.operation._tag === "ReadTargetLineage"
    )
    story.splice(resumedFreshLineageAt, 0, ...restartPostProtocolGraphRead)
  } else if (afterJournalEvent === "IntegrationQuarantineDirectionApplied") {
    story.splice(directionAt + 1, 0, death, ...restartAuthorityReads, ...restartPostProtocolGraphRead)
  } else if (afterJournalEvent === "TargetLineageObserved") {
    story.splice(freshLineageSelectionAt + 1, 0, death, ...originalRestartAuthorityReads)
  } else if (afterJournalEvent === "IntegratorSuccessorSessionFixed") {
    story.splice(successorRequestAt, 0, death, ...restartAuthorityReads)
    const resumedSuccessorRequestAt = story.findIndex(
      (item, index) => index > directionAt && item._tag === "IntegratorRequestReceived"
    )
    const resumedPromotionLineageAt = story.findIndex(
      (item, index) =>
        index > resumedSuccessorRequestAt && item._tag === "DalphSelects" && item.operation._tag === "ReadTargetLineage"
    )
    story.splice(resumedPromotionLineageAt, 0, ...restartPostProtocolGraphRead)
  } else {
    const insertionAt = deliveryStoryFinalityRestartInsertionAt(story, afterJournalEvent)
    const taskAlreadyCompleted =
      afterJournalEvent === "CompletionTaskAcknowledged" ||
      afterJournalEvent === "CompletionClaimDeleted" ||
      afterJournalEvent === "IntegrationFinalitySettled"
    story.splice(
      insertionAt + 1,
      0,
      death,
      ...(taskAlreadyCompleted ? completedGraphAuthorityReads : restartGraphAuthorityReads)
    )
    const expectedBehaviorAt = story.findIndex((item) => item._tag === "ExpectedBehavior")
    story.splice(expectedBehaviorAt, 0, ...completedGraphAuthorityReads)
  }

  return {
    ...base,
    name: `${base.name}; restart after ${afterJournalEvent}`,
    startingFacts: {
      ...base.startingFacts,
      targetLineageObservations: [
        ...(base.startingFacts.targetLineageObservations ?? []),
        ...(afterJournalEvent === "IntegratorSuccessorSessionFixed"
          ? []
          : [
              {
                plannedBaseIsAncestorOfTargetHead: true as const,
                plannedBaseSha: "1111111111111111111111111111111111111111",
                targetHeadSha: "2222222222222222222222222222222222222222"
              }
            ])
      ]
    },
    story
  }
}

it.effect(
  "fails closed when an armed targeted coordinator death passes its exact journal event",
  () =>
    Effect.gen(function* () {
      const baselineRun = yield* cachedDs14ThroughDs17Run
      const exactTarget = deliveryStoryWithRestartAfter("TargetPromotionStale", baselineRun)
      const cassette = yield* Schema.decodeUnknownEffect(AuthoredScenarioCassette)({
        ...exactTarget,
        name: `${exactTarget.name}; mistargeted coordinator death`,
        story: exactTarget.story.map((item) =>
          item._tag === "CoordinatorProcessDiesAfterJournalEvent" && item.afterJournalEvent === "TargetPromotionStale"
            ? { ...item, afterJournalEvent: "CompletionClaimDeleted" as const }
            : item
        )
      })
      const outcome = yield* Effect.exit(runAuthoredScenarioCassette(cassette).pipe(Effect.provide(NodeCrypto.layer)))

      expect(Exit.isFailure(outcome)).toBe(true)
      if (Exit.isFailure(outcome)) {
        expect(Cause.pretty(outcome.cause)).toContain(
          "targeted coordinator death after CompletionClaimDeleted became impossible"
        )
      }
    }),
  capstoneTimeout
)

it.effect(
  "resumes the composed DS-14 through DS-17 path after every CAS-to-successor durable checkpoint",
  () =>
    Effect.gen(function* () {
      for (const checkpoint of deliveryStoryIntegrationRestartCheckpoints) {
        const baselineRun = yield* cachedDs14ThroughDs17Run
        const cassette = yield* Schema.decodeUnknownEffect(AuthoredScenarioCassette)(
          deliveryStoryWithRestartAfter(checkpoint, baselineRun)
        )
        const run = yield* runAuthoredScenarioCassette(cassette).pipe(Effect.provide(NodeCrypto.layer))
        const resumedOccurrences = run.observationCaptures.flatMap((capture) =>
          capture._tag === "AuthoredStoryOccurrenceCaptured" && capture.activationOrdinal === 3
            ? [capture.occurrence]
            : []
        )

        expect(run.activationOrdinals).toEqual([1, 2, 3])
        expect(resumedOccurrences.slice(0, 4).map(({ _tag }) => _tag)).toEqual([
          "DalphSelects",
          "TrackerGraphReadReturned",
          "DalphSelects",
          "TaskClaimCurrentReadReturned"
        ])
        expect(resumedOccurrences[0]).toMatchObject({ _tag: "DalphSelects", operation: { _tag: "ReadTrackerGraph" } })
        expect(resumedOccurrences[2]).toMatchObject({
          _tag: "DalphSelects",
          operation: { _tag: "ReadTaskClaim", taskId: "A" }
        })
        if (checkpoint === "TargetPromotionAttemptIntended") {
          const gitReconciliationAt = resumedOccurrences.findIndex(
            ({ _tag }) => _tag === "TargetPromotionGitReadReturned"
          )
          const compareAndSetAt = resumedOccurrences.findIndex(
            ({ _tag }) => _tag === "TargetPromotionCompareAndSetReturned"
          )
          expect(gitReconciliationAt).toBeGreaterThan(3)
          expect(compareAndSetAt).toBeGreaterThan(gitReconciliationAt)
        }
        expect(
          issue272AcceptanceIssues(
            run,
            checkpoint === "TargetPromotionAttemptIntended" ? 2 : 1,
            checkpoint === "TargetLineageObserved" ? 2 : 1
          )
        ).toEqual([])
        expect(run.records.filter(({ event }) => event._tag === "TargetPromotionStale")).toHaveLength(1)
        expect(run.records.filter(({ event }) => event._tag === "IntegrationQuarantined")).toHaveLength(1)
        expect(run.records.filter(({ event }) => event._tag === "IntegrationQuarantineDirectionApplied")).toHaveLength(
          1
        )
        expect(run.records.filter(({ event }) => event._tag === "IntegratorSuccessorSessionFixed")).toHaveLength(1)
        expect(run.records.filter(({ event }) => event._tag === "TargetPromotionObservedSuccess")).toHaveLength(1)
        expect(run.records.filter(({ event }) => event._tag === "CompletionTaskAttemptIntended")).toHaveLength(1)
        expect(run.history._tag).toBe("ValidWorkflowJournalHistory")
      }
    }),
  capstoneTimeout
)

const verifyDeliveryStoryFinalityRestart = (checkpoint: (typeof deliveryStoryFinalityRestartCheckpoints)[number]) =>
  Effect.gen(function* () {
    const baselineRun = yield* cachedDs14ThroughDs17Run
    const cassette = yield* Schema.decodeUnknownEffect(AuthoredScenarioCassette)(
      deliveryStoryWithRestartAfter(checkpoint, baselineRun)
    )
    const run = yield* runAuthoredScenarioCassette(cassette).pipe(Effect.provide(NodeCrypto.layer))
    const resumedOccurrences = run.observationCaptures.flatMap((capture) =>
      capture._tag === "AuthoredStoryOccurrenceCaptured" && capture.activationOrdinal === 3 ? [capture.occurrence] : []
    )

    expect(run.activationOrdinals).toEqual([1, 2, 3])
    expect(resumedOccurrences.slice(0, 2).map(({ _tag }) => _tag)).toEqual(["DalphSelects", "TrackerGraphReadReturned"])
    expect(resumedOccurrences[1]).toMatchObject({
      _tag: "TrackerGraphReadReturned",
      graph: {
        tasks: [
          {
            id: "A",
            lifecycle: {
              _tag:
                checkpoint === "TargetPromotionObservedSuccess" || checkpoint === "CompletionClaimReplaced"
                  ? "Open"
                  : "CompletedSuccessfully"
            }
          }
        ]
      }
    })
    const expectedContinuation =
      checkpoint === "TargetPromotionObservedSuccess"
        ? { _tag: "CompletionClaimReadReturned", claim: "Active", taskId: "A" }
        : checkpoint === "CompletionClaimReplaced"
          ? { _tag: "CompletionTaskFocusedReadReturned", lifecycle: "Open", taskId: "A" }
          : checkpoint === "CompletionTaskAcknowledged"
            ? { _tag: "CompletionTaskFocusedReadReturned", lifecycle: "CompletedSuccessfully", taskId: "A" }
            : { _tag: "DalphSelects", operation: { _tag: "ReadTrackerGraph", target: "cassette-target" } }
    expect(resumedOccurrences[2]).toMatchObject(expectedContinuation)
    expect(issue272AcceptanceIssues(run)).toEqual([])
    expect(storyOccurrences(run, "CompletionClaimReplacementApplied")).toHaveLength(1)
    expect(storyOccurrences(run, "CompletionTaskRequestReturned")).toHaveLength(1)
    expect(storyOccurrences(run, "CompletionClaimDeletionApplied")).toHaveLength(1)
    expect(
      storyOccurrences(run, "DalphSelects").filter(({ operation }) => operation._tag === "ReleaseTaskClaim")
    ).toHaveLength(1)
    expect(eventRecords(run, "IntegrationFinalitySettled")).toHaveLength(1)
    expect(run.history._tag).toBe("ValidWorkflowJournalHistory")
  })

it.effect(
  "resumes exact DS-17 finality after TargetPromotionObservedSuccess durable checkpoint",
  () => verifyDeliveryStoryFinalityRestart("TargetPromotionObservedSuccess"),
  capstoneTimeout
)

it.effect(
  "resumes exact DS-17 finality after CompletionClaimReplaced durable checkpoint",
  () => verifyDeliveryStoryFinalityRestart("CompletionClaimReplaced"),
  capstoneTimeout
)

it.effect(
  "resumes exact DS-17 finality after CompletionTaskAcknowledged durable checkpoint",
  () => verifyDeliveryStoryFinalityRestart("CompletionTaskAcknowledged"),
  capstoneTimeout
)

it.effect(
  "resumes exact DS-17 finality after CompletionClaimDeleted durable checkpoint",
  () => verifyDeliveryStoryFinalityRestart("CompletionClaimDeleted"),
  capstoneTimeout
)

it.effect(
  "resumes exact DS-17 finality after IntegrationFinalitySettled durable checkpoint",
  () => verifyDeliveryStoryFinalityRestart("IntegrationFinalitySettled"),
  capstoneTimeout
)

it.effect(
  "executes DS-14 through DS-17 from rejected exact-head offer through Operator-authorized successor finality",
  () =>
    Effect.gen(function* () {
      const run = yield* cachedDs14ThroughDs17Run
      expect(issue272AcceptanceIssues(run)).toEqual([])
      expect(run.history._tag).toBe("ValidWorkflowJournalHistory")
    }),
  capstoneTimeout
)

it.effect(
  "rejects DS-15 evidence when M or M2 lacks exact ordered head-then-C parents",
  () =>
    Effect.gen(function* () {
      const base = maintainedAuthoredCassetteCatalog.deliveryStoryDs14ThroughDs17
      const malformedCandidates = [
        {
          candidateText: "refs/heads/dalph/integrator-candidate-A",
          candidateCommit: "cccccccccccccccccccccccccccccccccccccccc",
          directParents: ["aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", "1111111111111111111111111111111111111111"]
        },
        {
          candidateText: "refs/heads/dalph/integrator-candidate-A-successor",
          candidateCommit: "dddddddddddddddddddddddddddddddddddddddd",
          directParents: [
            "2222222222222222222222222222222222222222",
            "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
            "eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee"
          ]
        }
      ] as const

      for (const { candidateCommit, candidateText, directParents } of malformedCandidates) {
        const cassette = yield* Schema.decodeUnknownEffect(AuthoredScenarioCassette)({
          ...base,
          name: `DS-15 malformed ${candidateText} parents ${directParents.join("-")}`,
          story: base.story.map((item) =>
            item._tag === "IntegratorGitObservationReturned" && item.candidateText === candidateText
              ? { ...item, observation: { ...item.observation, directParents } }
              : item
          )
        })
        const captures: Array<AuthoredObservationCapture> = []
        const outcome = yield* Effect.exit(
          runAuthoredScenarioCassette(cassette, { onObservationCapture: (capture) => captures.push(capture) }).pipe(
            Effect.provide(NodeCrypto.layer)
          )
        )
        const occurrences = captures.flatMap((capture) =>
          capture._tag === "AuthoredStoryOccurrenceCaptured" ? [capture.occurrence] : []
        )
        expect(outcome._tag).toBe("Failure")
        expect(
          occurrences.filter(
            (occurrence) =>
              occurrence._tag === "IntegratorGitObservationReturned" && occurrence.candidateText === candidateText
          )
        ).toHaveLength(1)
        expect(
          occurrences.filter(
            (occurrence) =>
              (occurrence._tag === "TargetPromotionCompareAndSetReturned" ||
                occurrence._tag === "TargetPromotionCompareAndSetResponseLost") &&
              occurrence.request.candidateCommit === candidateCommit
          )
        ).toHaveLength(0)
        expect(
          occurrences.filter(
            (occurrence) =>
              occurrence._tag === "TargetPromotionCompareAndSetReturned" && occurrence.result._tag === "Applied"
          )
        ).toHaveLength(0)
      }
    }),
  capstoneTimeout
)

it.effect(
  "rejects DS16 evidence without the rejected CAS attempt or with a pre-request stale read",
  () =>
    Effect.gen(function* () {
      const base = maintainedAuthoredCassetteCatalog.deliveryStoryDs14ThroughDs17
      const responseLostCassette = yield* Schema.decodeUnknownEffect(AuthoredScenarioCassette)({
        ...base,
        name: `${base.name}; rejected CAS evidence substituted with response loss`,
        story: base.story.flatMap(
          (item): ReadonlyArray<unknown> =>
            item._tag === "TargetPromotionCompareAndSetReturned" && item.result._tag === "RejectedExpectedHead"
              ? [
                  {
                    _tag: "TargetPromotionCompareAndSetResponseLost",
                    detail: "the rejected exact-head CAS response was lost",
                    request: item.request
                  },
                  {
                    _tag: "TargetPromotionGitReadReturned",
                    candidateCommit: item.request.candidateCommit,
                    observation: {
                      _tag: "CandidateNotInAncestry",
                      currentHeadSha: "2222222222222222222222222222222222222222"
                    },
                    repository: item.request.integrationTarget.repository
                  }
                ]
              : [item]
        )
      })
      const responseLostRun = yield* runAuthoredScenarioCassette(responseLostCassette).pipe(
        Effect.provide(NodeCrypto.layer)
      )
      expect(storyOccurrences(responseLostRun, "TargetPromotionCompareAndSetResponseLost")).toHaveLength(1)
      expect(
        storyOccurrences(responseLostRun, "TargetPromotionCompareAndSetReturned").filter(
          ({ result }) => result._tag === "RejectedExpectedHead"
        )
      ).toHaveLength(0)
      expect(issue272AcceptanceIssues(responseLostRun)).toContain(
        "promotion must use one rejected exact-head CAS followed by one applied successor CAS, never force-update"
      )

      const preRequest = yield* runAuthoredScenarioCassette(
        maintainedAuthoredCassetteCatalog.targetPromotionStaleBeforeCompareAndSet
      ).pipe(Effect.provide(NodeCrypto.layer))
      expect(preRequest.records.filter(({ event }) => event._tag === "TargetPromotionAttemptIntended")).toHaveLength(0)
      expect(eventRecords(preRequest, "TargetPromotionStale")).toHaveLength(1)
      expect(eventRecords(preRequest, "TargetPromotionStale")[0]?.event.basis._tag).toBe("BeforeFirstAttempt")
      expect(
        preRequest.observationCaptures.filter(
          (capture) =>
            capture._tag === "AuthoredStoryOccurrenceCaptured" &&
            capture.occurrence._tag === "TargetPromotionCompareAndSetReturned"
        )
      ).toHaveLength(0)
      expect(preRequest.records.filter(({ event }) => event._tag === "IntegrationQuarantined")).toHaveLength(0)
      expect(
        preRequest.records.filter(({ event }) => event._tag === "IntegrationQuarantineDirectionApplied")
      ).toHaveLength(0)
      expect(preRequest.records.filter(({ event }) => event._tag === "IntegratorSuccessorSessionFixed")).toHaveLength(0)
    }),
  capstoneTimeout
)

it.effect(
  "accepts every DS-14 through DS-17 checkpoint prefix as valid history with at most one recorded successor, promotion, and completion attempt",
  () =>
    Effect.gen(function* () {
      const run = yield* cachedDs14ThroughDs17Run
      const records = run.records
      const directionAt = records.find(({ event }) => event._tag === "IntegrationQuarantineDirectionApplied")?.position
      const checkpoints = [
        records.find(({ event }) => event._tag === "IntegrationStarted"),
        records.find(({ event }) => event._tag === "IntegratorRunCandidateGitObserved"),
        records.find(({ event }) => event._tag === "TargetPromotionAttemptIntended"),
        records.find(({ event }) => event._tag === "TargetPromotionStale"),
        records.find(({ event }) => event._tag === "IntegrationQuarantined"),
        records.find(({ event }) => event._tag === "IntegrationQuarantineDirectionApplied"),
        records.find(
          ({ event, position }) =>
            event._tag === "TargetLineageObserved" && position > (directionAt ?? Number.MAX_SAFE_INTEGER)
        ),
        records.find(({ event }) => event._tag === "IntegratorSuccessorSessionFixed"),
        records.find(({ event }) => event._tag === "TargetPromotionObservedSuccess"),
        records.find(({ event }) => event._tag === "CompletionClaimReplaced"),
        records.find(({ event }) => event._tag === "CompletionTaskAttemptIntended"),
        records.find(({ event }) => event._tag === "CompletionTaskAcknowledged"),
        records.find(({ event }) => event._tag === "TaskClaimReleased"),
        records.find(({ event }) => event._tag === "CompletionClaimDeleted"),
        records.find(({ event }) => event._tag === "IntegrationFinalitySettled")
      ]

      expect(checkpoints.every((checkpoint) => checkpoint !== undefined)).toBe(true)
      for (const checkpoint of checkpoints) {
        if (checkpoint === undefined) return
        const prefix = records.filter(({ position }) => position <= checkpoint.position)
        expect(reduceWorkflowJournalHistory(run.runId, prefix)._tag).toBe("ValidWorkflowJournalHistory")
        expect(
          prefix.filter(({ event }) => event._tag === "IntegratorSuccessorSessionFixed").length
        ).toBeLessThanOrEqual(1)
        expect(prefix.filter(({ event }) => event._tag === "CompletionTaskAttemptIntended").length).toBeLessThanOrEqual(
          1
        )
        expect(
          prefix.filter(({ event }) => event._tag === "TargetPromotionObservedSuccess").length
        ).toBeLessThanOrEqual(1)
      }
    }),
  capstoneTimeout
)

it.effect("DS-01 derives A, B, and C inside capacity while D and E stay outside", () =>
  Effect.gen(function* () {
    const run = yield* runIssue268Ds01Characterization
    const establishedBundle = run.publications.find(({ publication }) => publication.graph._tag === "GraphEstablished")
    if (establishedBundle === undefined) return expect.fail("DS-01 must publish the established G0 graph")
    const established = yield* evaluateDeliveryRuntimeInputBundle(establishedBundle)
    const placements = established.current.ticketDeliveries.source.placements.map(({ placement, taskId }) => ({
      placement: placement._tag,
      taskId
    }))
    const selected = established.current.ticketDeliveries.deliveries.map(({ taskId }) => taskId)
    const candidates = establishedBundle.actionInputs.freshTaskCandidates.map(({ taskId }) => taskId)
    const forbiddenStages = new Set([
      "AcquireTaskClaim",
      "ReadPostClaimGraph",
      "ReadTaskWorkSpecification",
      "RecordTaskAttemptPlan",
      "ReconcileTaskWorktree",
      "BeginPlannedAttemptExecutorWork",
      "ObservePlannedAttemptExecutorWork"
    ])
    const forbiddenEvents = new Set([
      "TaskClaimAcquisitionIntended",
      "TaskClaimAcquired",
      "TaskAttemptPlanned",
      "TaskWorktreeReconciliationIntended",
      "PlannedAttemptExecutorWorkResponsibilityBegan",
      "PlannedAttemptExecutorCommandIntended"
    ])

    expect(placements).toEqual([
      { placement: "Selected", taskId: "A" },
      { placement: "Selected", taskId: "B" },
      { placement: "Selected", taskId: "C" },
      { placement: "EligibleOutsideBound", taskId: "D" },
      { placement: "EligibleOutsideBound", taskId: "E" }
    ])
    expect(candidates).toEqual(["A", "B", "C", "D", "E"])
    expect(selected).toEqual(["A", "B", "C"])
    expect(run.pendingClaimTaskIds).toHaveLength(3)
    expect(new Set(run.pendingClaimTaskIds)).toEqual(new Set(["A", "B", "C"]))
    expect(run.executedActions.filter(({ stage }) => forbiddenStages.has(stage))).toEqual([])
    expect(run.records.filter(({ event }) => forbiddenEvents.has(event._tag))).toEqual([])
    expect(run.claimRequests).toEqual([])
    expect(run.commands).toEqual([])
    expect(run.plans).toEqual([])
  })
)

it.effect("DS-02 starts only A, B, and C through the production workflow algebra", () =>
  Effect.gen(function* () {
    const run = yield* runIssue268Ds02Characterization
    const begun = run.records.flatMap(({ event }) =>
      event._tag === "PlannedAttemptExecutorWorkResponsibilityBegan"
        ? [`${event.plannedAttempt.taskId}:${event.plannedAttempt.attemptId}`]
        : []
    )
    const claimed = run.records.flatMap(({ event }) =>
      event._tag === "TaskClaimAcquisitionIntended" ? [event.operation.acquisition.taskId] : []
    )
    const planned = run.records.flatMap(({ event }) =>
      event._tag === "TaskAttemptPlanned" ? [event.operation.plannedAttempt.taskId] : []
    )
    const prematureOutsideBoundWork = run.records.flatMap(({ event, position }) => {
      const taskId =
        event._tag === "TaskClaimAcquisitionIntended"
          ? event.operation.acquisition.taskId
          : event._tag === "TaskClaimAcquired"
            ? event.claim.taskId
            : event._tag === "TaskAttemptPlanned" || event._tag === "TaskWorktreeReconciliationIntended"
              ? event.operation.plannedAttempt.taskId
              : undefined
      return taskId === "D" || taskId === "E" ? [{ event: event._tag, position, taskId }] : []
    })
    const finalPublication = run.publications.at(-1)
    // Begin returns and journals the exact Executing report. A second passive
    // executor observation would reread evidence already accepted by that boundary.
    const expectedStages = [
      "ReadCurrentTaskGraph",
      "AcquireTaskClaim",
      "ReadPostClaimGraph",
      "ReadTaskWorkSpecification",
      "RecordTaskAttemptPlan",
      "ReconcileTaskWorktree",
      "BeginPlannedAttemptExecutorWork"
    ]
    const stagesByTask = Object.fromEntries(
      ["A", "B", "C", "D", "E"].map((taskId) => [
        taskId,
        run.executedActions.filter((action) => action.taskId === taskId).map(({ stage }) => stage)
      ])
    )
    const commandIntents = run.records.flatMap(({ event }) =>
      event._tag === "PlannedAttemptExecutorCommandIntended"
        ? [{ attemptId: event.plannedAttempt.attemptId, command: event.command, ordinal: event.ordinal }]
        : []
    )
    const commandResponses = run.records.flatMap(({ event }) =>
      event._tag === "PlannedAttemptExecutorCommandResponseObserved"
        ? [{ attemptId: event.plannedAttempt.attemptId, ordinal: event.commandOrdinal, report: event.report }]
        : []
    )
    const acceptedExecutorReports = run.records.flatMap(({ event }) =>
      event._tag === "PlannedAttemptExecutorWorkReported"
        ? [{ attemptId: event.report.correlation.attemptId, ordinal: event.ordinal, report: event.report }]
        : []
    )
    const acquiredClaims = run.records.flatMap(({ event }) => (event._tag === "TaskClaimAcquired" ? [event.claim] : []))
    const durablePlans = run.records.flatMap(({ event }) =>
      event._tag === "TaskAttemptPlanned" ? [event.operation.plannedAttempt] : []
    )

    expect(run.commands).toEqual([
      { attemptId: "attempt:A:1", command: "Begin" },
      { attemptId: "attempt:B:1", command: "Begin" },
      { attemptId: "attempt:C:1", command: "Begin" }
    ])
    expect(begun).toEqual(["A:attempt:A:1", "B:attempt:B:1", "C:attempt:C:1"])
    expect(prematureOutsideBoundWork).toEqual([])
    expect(new Set(contributedTaskIds(run.publications))).toEqual(new Set(["A", "B", "C"]))
    expect(claimed).toHaveLength(3)
    expect(new Set(claimed)).toEqual(new Set(["A", "B", "C"]))
    expect(planned).toEqual(["A", "B", "C"])
    expect(stagesByTask).toEqual({ A: expectedStages, B: expectedStages, C: expectedStages, D: [], E: [] })
    expect(run.claimRequests).toHaveLength(3)
    expect(run.claimRequests).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ owner: "issue-268-controlled-owner", taskId: "A" }),
        expect.objectContaining({ owner: "issue-268-controlled-owner", taskId: "B" }),
        expect.objectContaining({ owner: "issue-268-controlled-owner", taskId: "C" })
      ])
    )
    expect(run.claimReleaseOrder).toEqual(["A", "B", "C"])
    expect(
      run.claimRequests.every(
        ({ operationId, taskId, token }) => token === `issue-268-controlled-claim:${taskId}:${operationId}`
      )
    ).toBe(true)
    expect(acquiredClaims).toEqual(run.claimRequests.map((request) => ({ _tag: "ActiveTaskClaim", ...request })))
    expect(run.plans).toEqual([
      expect.objectContaining({
        attemptId: "attempt:A:1",
        baseSha: controlledScenario.baseSha,
        branch: "refs/heads/dalph/issue-268-a-1",
        executor: "executor:issue-268-controlled",
        runId: controlledScenario.runId,
        taskId: "A",
        taskRevision: controlledScenario.specifications.F1.A.fingerprint,
        worktree: "/dalph/controlled-characterization/issue-268/A-1"
      }),
      expect.objectContaining({
        attemptId: "attempt:B:1",
        baseSha: controlledScenario.baseSha,
        branch: "refs/heads/dalph/issue-268-b-1",
        executor: "executor:issue-268-controlled",
        runId: controlledScenario.runId,
        taskId: "B",
        taskRevision: controlledScenario.specifications.F1.B.fingerprint,
        worktree: "/dalph/controlled-characterization/issue-268/B-1"
      }),
      expect.objectContaining({
        attemptId: "attempt:C:1",
        baseSha: controlledScenario.baseSha,
        branch: "refs/heads/dalph/issue-268-c-1",
        executor: "executor:issue-268-controlled",
        runId: controlledScenario.runId,
        taskId: "C",
        taskRevision: controlledScenario.specifications.F1.C.fingerprint,
        worktree: "/dalph/controlled-characterization/issue-268/C-1"
      })
    ])
    expect(durablePlans).toEqual(run.plans)
    expect(run.worktreeCreateRequests).toEqual(run.plans)
    expect(commandIntents).toEqual([
      { attemptId: "attempt:A:1", command: "Begin", ordinal: 1 },
      { attemptId: "attempt:B:1", command: "Begin", ordinal: 1 },
      { attemptId: "attempt:C:1", command: "Begin", ordinal: 1 }
    ])
    const expectedCommandResponses = run.plans.map((plan) => ({
      attemptId: plan.attemptId,
      ordinal: 1,
      report: { _tag: "ExecutorWorkExecuting" as const, correlation: plannedAttemptExecutorCorrelation(plan) }
    }))
    expect(commandResponses).toEqual(expectedCommandResponses)
    expect(acceptedExecutorReports).toEqual(commandResponses)
    for (const attemptId of ["attempt:A:1", "attempt:B:1", "attempt:C:1"]) {
      const plan = run.plans.find((candidate) => candidate.attemptId === attemptId)
      if (plan === undefined) return expect.fail(`missing exact plan ${attemptId}`)
      const worktreeIntent = run.records.filter(
        ({ event }) =>
          event._tag === "TaskWorktreeReconciliationIntended" && event.operation.plannedAttempt.attemptId === attemptId
      )
      expect(worktreeIntent).toHaveLength(1)
      const worktreeOperationId = worktreeIntent[0]?.event
      if (worktreeOperationId?._tag !== "TaskWorktreeReconciliationIntended") {
        return expect.fail(`missing exact worktree intent ${attemptId}`)
      }
      const worktreeObservations = run.records.filter(
        ({ event }) =>
          event._tag === "TaskWorktreeReady" && event.operationId === worktreeOperationId.operation.operationId
      )
      expect(worktreeObservations).toHaveLength(1)
      expect(worktreeObservations[0]?.event).toMatchObject({
        proof: {
          _tag: "PlannedWorktreeReady",
          baseSha: plan.baseSha,
          branch: plan.branch,
          headSha: plan.baseSha,
          worktree: plan.worktree
        }
      })
      const responsibilityAt = run.records.findIndex(
        ({ event }) =>
          event._tag === "PlannedAttemptExecutorWorkResponsibilityBegan" && event.plannedAttempt.attemptId === attemptId
      )
      const beginIntentAt = run.records.findIndex(
        ({ event }) =>
          event._tag === "PlannedAttemptExecutorCommandIntended" &&
          event.plannedAttempt.attemptId === attemptId &&
          event.command === "Begin"
      )
      expect(responsibilityAt).toBeGreaterThanOrEqual(0)
      expect(beginIntentAt).toBeGreaterThan(responsibilityAt)
    }
    expect(
      finalPublication?.actionInputs.runtimeFacts.taskWork.held
        .map(({ correlation }) => correlation.attemptId)
        .toSorted()
    ).toEqual(["attempt:A:1", "attempt:B:1", "attempt:C:1"])
    expect(run.decision).toMatchObject({ _tag: "RunMustRemainActive" })
  })
)

it.effect("DS-03 accepts Alice's B/F2 and G1 tracker edit without triggering Dalph work", () =>
  Effect.gen(function* () {
    const run = yield* runIssue268Ds03Characterization
    const ds03 = run.ds03
    const executingAttempts = ds03.before.records.flatMap(({ event }) =>
      event._tag === "PlannedAttemptExecutorWorkReported" && event.report._tag === "ExecutorWorkExecuting"
        ? [event.report.correlation.attemptId]
        : []
    )
    const heldAttempts = ds03.before.publications
      .at(-1)
      ?.actionInputs.runtimeFacts.taskWork.held.map(({ correlation }) => correlation.attemptId)
      .toSorted()

    expect(executingAttempts).toEqual(["attempt:A:1", "attempt:B:1", "attempt:C:1"])
    expect(heldAttempts).toEqual(["attempt:A:1", "attempt:B:1", "attempt:C:1"])
    expect(controlledScenario.specifications.F1.B.fingerprint).not.toBe(
      controlledScenario.specifications.F2.B.fingerprint
    )
    expect(ds03.edit).toEqual({
      graphRevision: controlledScenario.graphs.G1.revision,
      nextFingerprint: controlledScenario.specifications.F2.B.fingerprint,
      priorFingerprint: controlledScenario.specifications.F1.B.fingerprint,
      taskId: "B"
    })
    expect(ds03.after).toEqual(ds03.before)
    expect(
      ds03.after.publications.some(
        ({ publication }) =>
          publication.graph._tag === "GraphEstablished" &&
          publication.graph.observation.snapshot.revision === controlledScenario.graphs.G1.revision
      )
    ).toBe(false)
    expect(ds03.after.commands).toEqual([
      { attemptId: "attempt:A:1", command: "Begin" },
      { attemptId: "attempt:B:1", command: "Begin" },
      { attemptId: "attempt:C:1", command: "Begin" }
    ])
  })
)

it.effect(
  "refreshes B from the bounded timer when its notification is lost",
  () =>
    Effect.gen(function* () {
      const run = yield* runIssue268Ds04Characterization
      const ds04 = run.ds04
      const newRecords = ds04.after.records.slice(ds04.beforeTimer.records.length)
      const authorityGraphReads = newRecords.filter(
        ({ event }) =>
          event._tag === "TaskTrackerReadIntentRecorded" &&
          event.operation._tag === "ReadTrackerGraph" &&
          event.operation.cause._tag === "ExecutingWorkAuthorityCheck"
      )
      const acceptedG1 = newRecords.find(
        ({ event }) =>
          event._tag === "TaskTrackerFactsObserved" &&
          event.observation._tag === "CompleteTaskTrackerFacts" &&
          event.observation.factFamilies.some(
            (family) => family.contentIdentity === controlledScenario.graphs.G1.revision
          )
      )
      const specificationReads = newRecords.flatMap(({ event, position }) =>
        event._tag === "TaskTrackerFactsObserved" && event.observation._tag === "FocusedTaskWorkSpecificationFacts"
          ? [
              {
                fingerprint: event.observation.factFamily.fingerprint,
                position,
                taskId: event.observation.factFamily.taskId
              }
            ]
          : []
      )
      const claimReads = newRecords.flatMap(({ event }) =>
        event._tag === "TaskTrackerFactsObserved" && event.observation._tag === "FocusedTaskClaimFacts"
          ? [event.observation.coverage.taskId]
          : []
      )
      const gitReads = newRecords.flatMap(({ event }) =>
        event._tag === "GitReadIntentRecorded"
          ? [{ read: event.operation._tag, taskId: event.operation.plannedAttempt.taskId }]
          : []
      )
      const suspendIntents = newRecords.flatMap(({ event, position }) =>
        event._tag === "PlannedAttemptExecutorCommandIntended" && event.command === "Suspend"
          ? [{ attemptId: event.plannedAttempt.attemptId, ordinal: event.ordinal, position }]
          : []
      )
      const suspendResponses = newRecords.flatMap(({ event, position }) =>
        event._tag === "PlannedAttemptExecutorCommandResponseObserved" && event.commandOrdinal === 2
          ? [{ attemptId: event.plannedAttempt.attemptId, position, report: event.report._tag }]
          : []
      )
      const newActions = ds04.after.executedActions.slice(ds04.beforeTimer.executedActions.length)
      const outsideBoundActions = newActions.filter(({ taskId }) => taskId === "D" || taskId === "E")
      const timerPublications = ds04.after.publications.slice(ds04.beforeTimer.publications.length)
      const heldAttemptsByPublication = timerPublications.map(({ actionInputs }) =>
        actionInputs.runtimeFacts.taskWork.held.map(({ correlation }) => correlation.attemptId).toSorted()
      )
      const bSuspensionPublications = timerPublications.filter(({ publication }) =>
        publication.exactEvidence.some(
          (evidence) =>
            evidence._tag === "ResponsibilityFacts" &&
            evidence.facts.responsibility._tag === "PlannedAttemptExecutorWorkResponsibility" &&
            evidence.facts.responsibility.plannedAttempt.attemptId === controlledScenario.attempts.B1 &&
            evidence.facts.disposition._tag === "PlannedAttemptExecutorSuspensionRequested"
        )
      )
      const heldAttempts = ds04.after.publications
        .at(-1)
        ?.actionInputs.runtimeFacts.taskWork.held.map(({ correlation }) => correlation.attemptId)
        .toSorted()
      const releaseEvidence = newRecords.filter(({ event }) =>
        event._tag === "PlannedAttemptExecutorWorkReported" ||
        event._tag === "PlannedAttemptExecutorCommandResponseObserved"
          ? event.report._tag === "ExecutorWorkSafelySuspended" || event.report._tag === "ExecutorWorkTerminal"
          : false
      )
      const duplicateExecutingReports = newRecords.filter(
        ({ event }) =>
          event._tag === "PlannedAttemptExecutorWorkReported" &&
          [controlledScenario.attempts.A1, controlledScenario.attempts.B1, controlledScenario.attempts.C1].includes(
            event.report.correlation.attemptId
          ) &&
          event.report._tag === "ExecutorWorkExecuting"
      )
      const bSpecification = specificationReads.find(({ taskId }) => taskId === controlledScenario.taskIds.B)

      expect(ds04.activeRefreshSources).toEqual(["Timer"])
      expect(ds04.activeRefreshCount).toBe(1)
      expect(authorityGraphReads).toHaveLength(1)
      expect(acceptedG1).toBeDefined()
      expect(specificationReads).toHaveLength(3)
      expect(specificationReads).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ fingerprint: controlledScenario.specifications.F1.A.fingerprint, taskId: "A" }),
          expect.objectContaining({ fingerprint: controlledScenario.specifications.F2.B.fingerprint, taskId: "B" }),
          expect.objectContaining({ fingerprint: controlledScenario.specifications.F1.C.fingerprint, taskId: "C" })
        ])
      )
      expect(claimReads).toHaveLength(2)
      expect(new Set(claimReads)).toEqual(new Set(["A", "C"]))
      expect(gitReads).toHaveLength(4)
      expect(gitReads).toEqual(
        expect.arrayContaining([
          { read: "ReadTaskWorktree", taskId: "A" },
          { read: "ReadTargetLineage", taskId: "A" },
          { read: "ReadTaskWorktree", taskId: "C" },
          { read: "ReadTargetLineage", taskId: "C" }
        ])
      )
      for (const taskId of ["A", "C"]) {
        expect(gitReads.findIndex((read) => read.taskId === taskId && read.read === "ReadTaskWorktree")).toBeLessThan(
          gitReads.findIndex((read) => read.taskId === taskId && read.read === "ReadTargetLineage")
        )
      }
      expect(suspendIntents).toEqual([expect.objectContaining({ attemptId: "attempt:B:1", ordinal: 2 })])
      expect(suspendResponses).toEqual([
        expect.objectContaining({ attemptId: "attempt:B:1", report: "ExecutorWorkExecuting" })
      ])
      expect(suspendResponses[0]?.position).toBeGreaterThan(suspendIntents[0]?.position ?? 0)
      expect(bSpecification?.position).toBeGreaterThan(acceptedG1?.position ?? 0)
      expect(suspendIntents[0]?.position).toBeGreaterThan(bSpecification?.position ?? 0)
      expect(run.commands).toEqual([
        { attemptId: "attempt:A:1", command: "Begin" },
        { attemptId: "attempt:B:1", command: "Begin" },
        { attemptId: "attempt:C:1", command: "Begin" },
        { attemptId: "attempt:B:1", command: "Suspend" }
      ])
      expect(outsideBoundActions).toEqual([])
      expect(heldAttemptsByPublication.length).toBeGreaterThan(0)
      expect(heldAttemptsByPublication).toEqual(
        heldAttemptsByPublication.map(() => ["attempt:A:1", "attempt:B:1", "attempt:C:1"])
      )
      expect(bSuspensionPublications.length).toBeGreaterThan(0)
      expect(heldAttempts).toEqual(["attempt:A:1", "attempt:B:1", "attempt:C:1"])
      expect(releaseEvidence).toEqual([])
      expect(duplicateExecutingReports).toEqual([])
    }),
  capstoneTimeout
)

it.effect(
  "DS-05 accepts exact B1 Safe and releases only B1's position",
  () =>
    Effect.gen(function* () {
      const run = yield* runIssue268Ds05Characterization
      const ds05 = run.ds05
      const newRecords = ds05.after.records.slice(ds05.beforeSafe.records.length)
      const safeObservations = newRecords.filter(
        ({ event }) =>
          event._tag === "PlannedAttemptExecutorStateObserved" &&
          event.plannedAttempt.attemptId === controlledScenario.attempts.B1 &&
          event.observation._tag === "ExactExecutorReport" &&
          event.observation.report._tag === "ExecutorWorkSafelySuspended"
      )
      const safeObservation = safeObservations[0]
      const safeReports = newRecords.filter(
        ({ event }) =>
          event._tag === "PlannedAttemptExecutorWorkReported" &&
          event.report.correlation.attemptId === controlledScenario.attempts.B1 &&
          event.report._tag === "ExecutorWorkSafelySuspended"
      )
      const safeReport = safeReports[0]
      const priorSuspendResponse = ds05.beforeSafe.records.findLast(
        ({ event }) =>
          event._tag === "PlannedAttemptExecutorCommandResponseObserved" &&
          event.plannedAttempt.attemptId === controlledScenario.attempts.B1 &&
          event.commandOrdinal === 2 &&
          event.report._tag === "ExecutorWorkExecuting"
      )
      const beforeHeld = ds05.beforeSafe.publications
        .at(-1)
        ?.actionInputs.runtimeFacts.taskWork.held.map(({ correlation }) => correlation.attemptId)
        .toSorted()
      const afterHeld = ds05.checkpointPublication.actionInputs.runtimeFacts.taskWork.held
        .map(({ correlation }) => correlation.attemptId)
        .toSorted()
      const runtime = yield* evaluateDeliveryRuntimeInputBundle(ds05.checkpointPublication)
      const bFacts = runtime.current.ticketDeliveries.deliveries
        .find(({ taskId }) => taskId === controlledScenario.taskIds.B)
        ?.standings.flatMap((standing) => (standing._tag === "ResponsibilitySituation" ? [standing.facts] : []))[0]
      if (bFacts === undefined) return expect.fail("DS-05 must retain B1 responsibility facts")
      const changedB = deriveRunnableFrontier({
        freshEligibleTasks: [],
        responsibility: WorkflowResponsibilityState.make({ entries: [bFacts.responsibility] }),
        responsibilityFacts: [bFacts]
      }).explanations.find(
        (explanation) =>
          explanation._tag === "PlannedAttemptTaskSpecificationChangeConstraint" &&
          explanation.taskId === controlledScenario.taskIds.B
      )
      const retainedB = run.plans.find(({ attemptId }) => attemptId === controlledScenario.attempts.B1)
      if (retainedB === undefined) return expect.fail("DS-05 must retain B1's exact durable plan")
      const beforeB = ds05.beforeSafe.plans.find(({ attemptId }) => attemptId === controlledScenario.attempts.B1)
      const afterB = ds05.after.plans.find(({ attemptId }) => attemptId === controlledScenario.attempts.B1)
      const newActions = ds05.after.executedActions.slice(ds05.beforeSafe.executedActions.length)
      const newCommands = ds05.after.commands.slice(ds05.beforeSafe.commands.length)
      const bClaimRecords = ds05.after.records.filter(
        ({ event }) => event._tag === "TaskClaimAcquired" && event.claim.taskId === controlledScenario.taskIds.B
      )
      const bPlanRecords = ds05.after.records.filter(
        ({ event }) =>
          event._tag === "TaskAttemptPlanned" &&
          event.operation.plannedAttempt.attemptId === controlledScenario.attempts.B1
      )
      const bWorktreeIntents = ds05.after.records.filter(
        ({ event }) =>
          event._tag === "TaskWorktreeReconciliationIntended" &&
          event.operation.plannedAttempt.attemptId === controlledScenario.attempts.B1
      )
      const bWorktreeOperationId = bWorktreeIntents[0]?.event
      const bWorktreeReady = ds05.after.records.filter(
        ({ event }) =>
          event._tag === "TaskWorktreeReady" &&
          bWorktreeOperationId?._tag === "TaskWorktreeReconciliationIntended" &&
          event.operationId === bWorktreeOperationId.operation.operationId
      )
      const forbiddenEvents = new Set([
        "TaskClaimReleased",
        "WorktreeCleanupAuthorized",
        "WorktreeCleanupMutationIntended",
        "WorktreeCleanupMutationResultRecorded",
        "WorktreeCleanupSettled",
        "PlannedAttemptExecutorCommandIntended"
      ])
      expect(priorSuspendResponse).toBeDefined()
      expect(safeObservations).toHaveLength(1)
      expect(safeReports).toHaveLength(1)
      expect(safeReport?.event._tag).toBe("PlannedAttemptExecutorWorkReported")
      if (safeReport?.event._tag === "PlannedAttemptExecutorWorkReported") expect(safeReport.event.ordinal).toBe(2)
      expect(safeObservation?.position).toBeGreaterThan(priorSuspendResponse?.position ?? 0)
      expect(safeReport?.position).toBeGreaterThan(safeObservation?.position ?? 0)
      // The release-path test proves publication-before-release at the boundary; this composed run proves
      // the accepted Safe position is present before the post-release A1/C1 projection is published.
      expect(ds05.checkpointPublication.actionInputs.runtimeFacts.acceptedAt).toBeGreaterThanOrEqual(
        safeReport?.position ?? Number.MAX_SAFE_INTEGER
      )
      expect(beforeHeld).toEqual(["attempt:A:1", "attempt:B:1", "attempt:C:1"])
      expect(afterHeld).toEqual(["attempt:A:1", "attempt:C:1"])
      expect(changedB).toMatchObject({
        availableResolutions: ["ContinueExistingAttempt", "RestartTaskImplementation", "StopTaskImplementation"],
        correlation: { attemptId: controlledScenario.attempts.B1, runId: controlledScenario.runId },
        observedFingerprint: controlledScenario.specifications.F2.B.fingerprint,
        plannedFingerprint: controlledScenario.specifications.F1.B.fingerprint,
        taskId: controlledScenario.taskIds.B
      })
      expect(retainedB).toMatchObject({
        attemptId: controlledScenario.attempts.B1,
        baseSha: controlledScenario.baseSha,
        runId: controlledScenario.runId,
        taskId: controlledScenario.taskIds.B,
        taskRevision: controlledScenario.specifications.F1.B.fingerprint
      })
      expect(afterB).toEqual(beforeB)
      expect(run.plans.filter(({ taskId }) => taskId === controlledScenario.taskIds.B)).toHaveLength(1)
      expect(bFacts.responsibility).toMatchObject({
        _tag: "PlannedAttemptExecutorWorkResponsibility",
        plannedAttempt: retainedB
      })
      expect(bClaimRecords).toHaveLength(1)
      expect(bClaimRecords[0]?.event).toMatchObject({
        claim: ds05.after.claimRequests.find(({ taskId }) => taskId === "B")
      })
      expect(bPlanRecords).toHaveLength(1)
      expect(bPlanRecords[0]?.event).toMatchObject({ operation: { plannedAttempt: retainedB } })
      expect(bWorktreeIntents).toHaveLength(1)
      expect(bWorktreeReady).toHaveLength(1)
      expect(bWorktreeReady[0]?.event).toMatchObject({
        proof: {
          _tag: "PlannedWorktreeReady",
          baseSha: retainedB.baseSha,
          branch: retainedB.branch,
          headSha: retainedB.baseSha,
          worktree: retainedB.worktree
        }
      })
      expect(ds05.after.claimRequests).toEqual(ds05.beforeSafe.claimRequests)
      expect(ds05.after.worktreeCreateRequests).toEqual(ds05.beforeSafe.worktreeCreateRequests)
      expect(ds05.lifecycleAttachAttemptIds.toSorted()).toEqual([
        controlledScenario.attempts.A1,
        controlledScenario.attempts.B1,
        controlledScenario.attempts.C1
      ])
      expect(run.ds04.activeRefreshCount).toBe(1)
      expect(newCommands).toEqual([])
      expect(newActions.filter(({ taskId }) => taskId === "D" || taskId === "E")).toEqual([])
      expect(
        newRecords.filter(
          ({ event }) =>
            event._tag === "GitReadIntentRecorded" ||
            (event._tag === "TaskTrackerReadIntentRecorded" && event.operation._tag !== "ReadTrackerGraph")
        )
      ).toEqual([])
      expect(
        newRecords.filter(
          ({ event }) =>
            event._tag === "PlannedAttemptExecutorWorkReported" &&
            event.report.correlation.attemptId !== controlledScenario.attempts.B1 &&
            (event.report._tag === "ExecutorWorkSafelySuspended" || event.report._tag === "ExecutorWorkTerminal")
        )
      ).toEqual([])
      expect(newRecords.filter(({ event }) => forbiddenEvents.has(event._tag))).toEqual([])
    }),
  capstoneTimeout
)

it.effect(
  "DS-06 admits D only after B1 releases and keeps E outside every boundary",
  () =>
    Effect.gen(function* () {
      const run = yield* runIssue268Ds06Characterization
      const ds06 = run.ds06
      const newRecords = ds06.after.records.slice(ds06.beforeD.records.length)
      const newActions = ds06.after.executedActions.slice(ds06.beforeD.executedActions.length)
      const newClaims = ds06.after.claimRequests.slice(ds06.beforeD.claimRequests.length)
      const newCommands = ds06.after.commands.slice(ds06.beforeD.commands.length)
      const newPlans = ds06.after.plans.slice(ds06.beforeD.plans.length)
      const newWorktrees = ds06.after.worktreeCreateRequests.slice(ds06.beforeD.worktreeCreateRequests.length)
      const dPlan = newPlans[0]
      if (dPlan === undefined) return expect.fail("DS-06 must record D1's exact plan")
      const beforeHeld = ds06.beforeD.publications
        .at(-1)
        ?.actionInputs.runtimeFacts.taskWork.held.map(({ correlation }) => correlation.attemptId)
        .toSorted()
      const afterHeld = ds06.checkpointPublication.actionInputs.runtimeFacts.taskWork.held
        .map(({ correlation }) => correlation.attemptId)
        .toSorted()
      const beforeOutsideBoundActions = ds06.beforeD.executedActions.filter(
        ({ taskId }) => taskId === controlledScenario.taskIds.D || taskId === controlledScenario.taskIds.E
      )
      const claimIntent = newRecords.find(({ event }) => event._tag === "TaskClaimAcquisitionIntended")
      const acquiredClaim = newRecords.find(({ event }) => event._tag === "TaskClaimAcquired")
      const postClaimGraphIntent = newRecords.find(
        ({ event }) =>
          event._tag === "TaskTrackerReadIntentRecorded" &&
          event.operation._tag === "ReadTrackerGraph" &&
          event.operation.predecessorOperationIds.length === 1
      )
      const specificationIntent = newRecords.find(
        ({ event }) =>
          event._tag === "TaskTrackerReadIntentRecorded" && event.operation._tag === "ReadTaskWorkSpecification"
      )
      const specificationObservation = newRecords.find(
        ({ event }) =>
          event._tag === "TaskTrackerFactsObserved" && event.observation._tag === "FocusedTaskWorkSpecificationFacts"
      )
      const planRecord = newRecords.find(({ event }) => event._tag === "TaskAttemptPlanned")
      const worktreeIntent = newRecords.find(({ event }) => event._tag === "TaskWorktreeReconciliationIntended")
      const worktreeReady = newRecords.find(({ event }) => event._tag === "TaskWorktreeReady")
      const responsibility = newRecords.find(
        ({ event }) => event._tag === "PlannedAttemptExecutorWorkResponsibilityBegan"
      )
      const beginIntent = newRecords.find(({ event }) => event._tag === "PlannedAttemptExecutorCommandIntended")
      const beginResponse = newRecords.find(
        ({ event }) => event._tag === "PlannedAttemptExecutorCommandResponseObserved"
      )
      const acceptedExecuting = newRecords.find(({ event }) => event._tag === "PlannedAttemptExecutorWorkReported")
      const postClaimGraphObservation = newRecords.find(
        ({ event }) =>
          event._tag === "TaskTrackerFactsObserved" &&
          postClaimGraphIntent?.event._tag === "TaskTrackerReadIntentRecorded" &&
          event.operationId === postClaimGraphIntent.event.operation.operationId
      )
      const forbiddenERecords = newRecords.filter(({ event }) => {
        if (event._tag === "TaskTrackerReadIntentRecorded") {
          return event.operation._tag === "ReadTaskWorkSpecification"
            ? event.operation.taskId === controlledScenario.taskIds.E
            : event.operation._tag === "ReadTrackerGraph"
              ? event.operation.readShape.explicitlyCoveredTaskIds.includes(controlledScenario.taskIds.E)
              : false
        }
        if (
          event._tag === "TaskTrackerFactsObserved" &&
          event.observation._tag === "FocusedTaskWorkSpecificationFacts"
        ) {
          return event.observation.factFamily.taskId === controlledScenario.taskIds.E
        }
        if (event._tag === "TaskClaimAcquisitionIntended") return event.operation.acquisition.taskId === "E"
        if (event._tag === "TaskClaimAcquired") return event.claim.taskId === "E"
        if (event._tag === "TaskAttemptPlanned" || event._tag === "TaskWorktreeReconciliationIntended") {
          return event.operation.plannedAttempt.taskId === "E"
        }
        if (
          event._tag === "PlannedAttemptExecutorWorkResponsibilityBegan" ||
          event._tag === "PlannedAttemptExecutorCommandIntended" ||
          event._tag === "PlannedAttemptExecutorCommandResponseObserved"
        ) {
          return event.plannedAttempt.taskId === "E"
        }
        return false
      })
      const forbiddenReleaseOrCleanup = newRecords.filter(({ event }) =>
        new Set([
          "TaskClaimReleased",
          "WorktreeCleanupAuthorized",
          "WorktreeCleanupMutationIntended",
          "WorktreeCleanupMutationResultRecorded",
          "WorktreeCleanupSettled"
        ]).has(event._tag)
      )
      const runtime = yield* evaluateDeliveryRuntimeInputBundle(ds06.checkpointPublication)
      const retainedB = runtime.current.ticketDeliveries.deliveries
        .find(({ taskId }) => taskId === controlledScenario.taskIds.B)
        ?.standings.flatMap((standing) => (standing._tag === "ResponsibilitySituation" ? [standing.facts] : []))[0]

      expect(ds06.r5ReleaseCount).toBe(1)
      expect(ds06.dActionAbsentBeforeBRelease).toBe(true)
      expect(beforeHeld).toEqual([controlledScenario.attempts.A1, controlledScenario.attempts.C1])
      expect(beforeOutsideBoundActions).toEqual([])
      expect(afterHeld).toEqual([
        controlledScenario.attempts.A1,
        controlledScenario.attempts.C1,
        controlledScenario.attempts.D1
      ])
      // A naturally occurring pre-claim graph read is inventory evidence, not a DS-06 requirement.
      expect(newActions.filter(({ stage }) => stage !== "ReadCurrentTaskGraph")).toEqual(
        [
          "AcquireTaskClaim",
          "ReadPostClaimGraph",
          "ReadTaskWorkSpecification",
          "RecordTaskAttemptPlan",
          "ReconcileTaskWorktree",
          "BeginPlannedAttemptExecutorWork"
        ].map((stage) => ({ stage, taskId: controlledScenario.taskIds.D }))
      )
      expect(newClaims).toEqual([
        expect.objectContaining({ owner: "issue-268-controlled-owner", taskId: controlledScenario.taskIds.D })
      ])
      expect(newClaims[0]?.token).toBe(`issue-268-controlled-claim:D:${newClaims[0]?.operationId}`)
      expect(newCommands).toEqual([{ attemptId: controlledScenario.attempts.D1, command: "Begin" }])
      expect(dPlan).toMatchObject({
        attemptId: controlledScenario.attempts.D1,
        baseSha: controlledScenario.baseSha,
        branch: "refs/heads/dalph/issue-268-d-1",
        executor: "executor:issue-268-controlled",
        runId: controlledScenario.runId,
        taskId: controlledScenario.taskIds.D,
        taskRevision: controlledScenario.specifications.F1.D.fingerprint,
        worktree: "/dalph/controlled-characterization/issue-268/D-1"
      })
      expect(newWorktrees).toEqual([dPlan])
      expect(claimIntent?.event).toMatchObject({ operation: { acquisition: newClaims[0] } })
      expect(acquiredClaim?.event).toMatchObject({ claim: { _tag: "ActiveTaskClaim", ...newClaims[0] } })
      expect(postClaimGraphIntent?.event).toMatchObject({
        operation: {
          predecessorOperationIds: [newClaims[0]?.operationId],
          readShape: { _tag: "CompleteTargetClosure", explicitlyCoveredTaskIds: [controlledScenario.taskIds.D] }
        }
      })
      expect(postClaimGraphObservation?.event).toMatchObject({
        observation: { _tag: "UnchangedTaskTrackerFactsReconfirmed" }
      })
      if (
        postClaimGraphObservation?.event._tag === "TaskTrackerFactsObserved" &&
        postClaimGraphObservation.event.observation._tag === "UnchangedTaskTrackerFactsReconfirmed"
      ) {
        expect(
          postClaimGraphObservation.event.observation.factFamilies.every(
            ({ contentIdentity }) => contentIdentity === controlledScenario.graphs.G1.revision
          )
        ).toBe(true)
      }
      expect(specificationIntent?.event).toMatchObject({
        operation: {
          predecessorOperationIds: [
            postClaimGraphIntent?.event._tag === "TaskTrackerReadIntentRecorded"
              ? postClaimGraphIntent.event.operation.operationId
              : undefined
          ],
          taskId: controlledScenario.taskIds.D
        }
      })
      expect(specificationObservation?.event).toMatchObject({
        observation: {
          factFamily: {
            fingerprint: controlledScenario.specifications.F1.D.fingerprint,
            taskId: controlledScenario.taskIds.D
          }
        }
      })
      expect(planRecord?.event).toMatchObject({ operation: { plannedAttempt: dPlan } })
      expect(worktreeIntent?.event).toMatchObject({ operation: { plannedAttempt: dPlan } })
      expect(worktreeReady?.event).toMatchObject({
        operationId:
          worktreeIntent?.event._tag === "TaskWorktreeReconciliationIntended"
            ? worktreeIntent.event.operation.operationId
            : undefined,
        proof: {
          _tag: "PlannedWorktreeReady",
          baseSha: dPlan.baseSha,
          branch: dPlan.branch,
          headSha: dPlan.baseSha,
          worktree: dPlan.worktree
        }
      })
      expect(newRecords.filter(({ event }) => event._tag === "TaskWorktreeReady")).toHaveLength(1)
      expect(responsibility?.event).toMatchObject({ plannedAttempt: dPlan })
      expect(beginIntent?.event).toMatchObject({ command: "Begin", ordinal: 1, plannedAttempt: dPlan })
      expect(beginResponse?.event).toMatchObject({
        commandOrdinal: 1,
        plannedAttempt: dPlan,
        report: { _tag: "ExecutorWorkExecuting", correlation: plannedAttemptExecutorCorrelation(dPlan) }
      })
      expect(acceptedExecuting?.event).toMatchObject({
        ordinal: 1,
        report: { _tag: "ExecutorWorkExecuting", correlation: plannedAttemptExecutorCorrelation(dPlan) }
      })
      expect(newRecords.filter(({ event }) => event._tag === "PlannedAttemptExecutorWorkReported")).toHaveLength(1)
      expect(acquiredClaim?.position).toBeGreaterThan(claimIntent?.position ?? Number.MAX_SAFE_INTEGER)
      expect(postClaimGraphIntent?.position).toBeGreaterThan(acquiredClaim?.position ?? Number.MAX_SAFE_INTEGER)
      expect(postClaimGraphObservation?.position).toBeGreaterThan(
        postClaimGraphIntent?.position ?? Number.MAX_SAFE_INTEGER
      )
      expect(specificationIntent?.position).toBeGreaterThan(
        postClaimGraphObservation?.position ?? Number.MAX_SAFE_INTEGER
      )
      expect(specificationObservation?.position).toBeGreaterThan(
        specificationIntent?.position ?? Number.MAX_SAFE_INTEGER
      )
      expect(planRecord?.position).toBeGreaterThan(specificationObservation?.position ?? Number.MAX_SAFE_INTEGER)
      expect(worktreeIntent?.position).toBeGreaterThan(planRecord?.position ?? Number.MAX_SAFE_INTEGER)
      expect(worktreeReady?.position).toBeGreaterThan(worktreeIntent?.position ?? Number.MAX_SAFE_INTEGER)
      expect(responsibility?.position).toBeGreaterThan(worktreeReady?.position ?? Number.MAX_SAFE_INTEGER)
      expect(beginIntent?.position).toBeGreaterThan(responsibility?.position ?? Number.MAX_SAFE_INTEGER)
      expect(beginResponse?.position).toBeGreaterThan(beginIntent?.position ?? Number.MAX_SAFE_INTEGER)
      expect(acceptedExecuting?.position).toBeGreaterThan(beginResponse?.position ?? Number.MAX_SAFE_INTEGER)
      expect(ds06.checkpointPublication.actionInputs.runtimeFacts.acceptedAt).toBeGreaterThanOrEqual(
        acceptedExecuting?.position ?? Number.MAX_SAFE_INTEGER
      )
      expect(ds06.after.plans.filter(({ taskId }) => taskId === controlledScenario.taskIds.B)).toEqual(
        ds06.beforeD.plans.filter(({ taskId }) => taskId === controlledScenario.taskIds.B)
      )
      expect(ds06.after.worktreeCreateRequests.filter(({ taskId }) => taskId === controlledScenario.taskIds.B)).toEqual(
        ds06.beforeD.worktreeCreateRequests.filter(({ taskId }) => taskId === controlledScenario.taskIds.B)
      )
      expect(retainedB).toMatchObject({
        _tag: "PlannedAttemptExecutorFreshFacts",
        disposition: {
          _tag: "TaskSpecificationChangeConstraint",
          observedFingerprint: controlledScenario.specifications.F2.B.fingerprint,
          plannedFingerprint: controlledScenario.specifications.F1.B.fingerprint
        },
        responsibility: {
          _tag: "PlannedAttemptExecutorWorkResponsibility",
          plannedAttempt: ds06.beforeD.plans.find(({ attemptId }) => attemptId === controlledScenario.attempts.B1)
        }
      })
      expect(newActions.filter(({ taskId }) => taskId === controlledScenario.taskIds.E)).toEqual([])
      expect(newClaims.filter(({ taskId }) => taskId === controlledScenario.taskIds.E)).toEqual([])
      expect(newPlans.filter(({ taskId }) => taskId === controlledScenario.taskIds.E)).toEqual([])
      expect(newWorktrees.filter(({ taskId }) => taskId === controlledScenario.taskIds.E)).toEqual([])
      expect(forbiddenERecords).toEqual([])
      expect(forbiddenReleaseOrCleanup).toEqual([])
    }),
  capstoneTimeout
)

it.effect(
  "DS-07 applies P2 without evicting the three already-held attempts",
  () =>
    Effect.gen(function* () {
      const run = yield* runIssue268Ds07Characterization
      const ds07 = run.ds07

      const newRecords = ds07.after.records.slice(ds07.beforeCapacity.records.length)
      const capacityRecords = newRecords.filter(({ event }) => event._tag === "TaskWorkCapacityChanged")
      const dExecuting = ds07.beforeCapacity.records.find(
        ({ event }) =>
          event._tag === "PlannedAttemptExecutorWorkReported" &&
          event.ordinal === 1 &&
          event.report._tag === "ExecutorWorkExecuting" &&
          event.report.correlation.attemptId === controlledScenario.attempts.D1
      )
      const ds06AcceptedAt = ds07.checkpointPublication.actionInputs.runtimeFacts.acceptedAt
      const p2Publications = ds07.after.publications.filter(
        ({ actionInputs }) =>
          actionInputs.runtimeFacts.acceptedAt !== null &&
          actionInputs.runtimeFacts.acceptedAt >= ds07.capacityRecord.position
      )
      const postCapacityActions = ds07.after.executedActions.slice(ds07.beforeCapacity.executedActions.length)
      const expectedHeld = [
        controlledScenario.attempts.A1,
        controlledScenario.attempts.C1,
        controlledScenario.attempts.D1
      ].toSorted()
      const latestHolderReports = expectedHeld.map((attemptId) =>
        ds07.beforeCapacity.records
          .flatMap(({ event }) =>
            event._tag === "PlannedAttemptExecutorWorkReported" && event.report.correlation.attemptId === attemptId
              ? [event]
              : []
          )
          .at(lastItemIndex)
      )
      const held = (publication: DeliveryRelationInputBundle) =>
        publication.actionInputs.runtimeFacts.taskWork.held.map(({ correlation }) => correlation.attemptId).toSorted()
      const runtime = yield* evaluateDeliveryRuntimeInputBundle(ds07.p2Publication)
      const retainedB = runtime.current.ticketDeliveries.deliveries
        .find(({ taskId }) => taskId === controlledScenario.taskIds.B)
        ?.standings.flatMap((standing) => (standing._tag === "ResponsibilitySituation" ? [standing.facts] : []))[0]
      const ePlacement = runtime.current.ticketDeliveries.source.placements.find(
        ({ taskId }) => taskId === controlledScenario.taskIds.E
      )?.placement
      const forbiddenPostCapacityEvents = new Set([
        "TaskTrackerReadIntentRecorded",
        "TaskTrackerFactsObserved",
        "GitReadIntentRecorded",
        "TaskClaimAcquisitionIntended",
        "TaskClaimAcquired",
        "TaskClaimReleased",
        "TaskAttemptPlanned",
        "TaskWorktreeReconciliationIntended",
        "TaskWorktreeReady",
        "PlannedAttemptExecutorWorkResponsibilityBegan",
        "PlannedAttemptExecutorCommandIntended",
        "PlannedAttemptExecutorCommandResponseObserved",
        "PlannedAttemptExecutorCommandProjectionObserved",
        "PlannedAttemptExecutorStateObserved",
        "PlannedAttemptExecutorWorkReported",
        "WorktreeCleanupAuthorized",
        "WorktreeCleanupMutationIntended",
        "WorktreeCleanupMutationResultRecorded",
        "WorktreeCleanupSettled"
      ])

      expect(ds07.p1).toEqual({ revision: 1, taskExecutionCapacity: 3 })
      expect(ds07.request).toEqual({
        capacity: controlledScenario.policies.P2,
        expectedRevision: ds07.p1.revision,
        runId: controlledScenario.runId
      })
      expect(ds07.returned).toEqual({ revision: 2, taskExecutionCapacity: 2 })
      expect(ds07.readback).toEqual(ds07.returned)
      expect(capacityRecords).toHaveLength(1)
      expect(ds07.capacityRecord).toEqual(capacityRecords[0])
      expect(ds07.capacityRecord.event).toMatchObject({
        _tag: "TaskWorkCapacityChanged",
        capacity: controlledScenario.policies.P2,
        initiatedBy: { _tag: "Operator" },
        occurrenceClassification: "InitiatedAction",
        previousRevision: 1,
        revision: 2
      })
      expect(dExecuting).toBeDefined()
      expect(ds06AcceptedAt).not.toBeNull()
      expect(ds06AcceptedAt).toBeGreaterThanOrEqual(dExecuting?.position ?? Number.MAX_SAFE_INTEGER)
      expect(ds07.capacityRecord.position).toBeGreaterThan(dExecuting?.position ?? Number.MAX_SAFE_INTEGER)
      expect(ds07.capacityRecord.position).toBeGreaterThan(ds06AcceptedAt ?? Number.MAX_SAFE_INTEGER)
      expect(newRecords).toEqual([ds07.capacityRecord])
      expect(ds07.beforeCapacity.publications.at(-1)).toEqual(ds07.checkpointPublication)
      expect(held(ds07.checkpointPublication)).toEqual(expectedHeld)
      expect(p2Publications.length).toBeGreaterThan(0)
      expect(p2Publications).toEqual(expect.arrayContaining([ds07.p2Publication]))
      for (const publication of p2Publications) {
        expect(publication.publication.policy).toEqual(ds07.returned)
        expect(held(publication)).toEqual(expectedHeld)
      }
      expect(held(ds07.p2Publication)).toEqual(expectedHeld)
      expect(runtime.taskWork.capacity).toBe(controlledScenario.policies.P2)
      expect(latestHolderReports).toMatchObject(
        expectedHeld.map((attemptId) => ({
          _tag: "PlannedAttemptExecutorWorkReported",
          ordinal: 1,
          report: { _tag: "ExecutorWorkExecuting", correlation: { attemptId } }
        }))
      )
      expect(ePlacement).toMatchObject({ _tag: "EligibleOutsideBound" })
      if (runtime.proposedActions._tag !== "DeliveryProposalsAvailable") {
        return expect.fail("DS-07 must retain one coherent, conflict-free proposal frontier")
      }
      expect(runtime.proposedActions.freshTaskCandidates.map(({ taskId }) => taskId)).toContain(
        controlledScenario.taskIds.E
      )
      expect(
        runtime.proposedActions.proposals.flatMap(({ admission }) =>
          admission.taskWorkPosition._tag === "TaskWorkPositionRequired" ? [admission.taskWorkPosition.taskId] : []
        )
      ).not.toContain(controlledScenario.taskIds.E)
      expect(retainedB).toMatchObject({
        _tag: "PlannedAttemptExecutorFreshFacts",
        disposition: {
          _tag: "TaskSpecificationChangeConstraint",
          observedFingerprint: controlledScenario.specifications.F2.B.fingerprint,
          plannedFingerprint: controlledScenario.specifications.F1.B.fingerprint
        },
        responsibility: {
          _tag: "PlannedAttemptExecutorWorkResponsibility",
          plannedAttempt: ds07.beforeCapacity.plans.find(
            ({ attemptId }) => attemptId === controlledScenario.attempts.B1
          )
        }
      })
      // The already-running D1 may be passively observed after P2. That positionless read neither admits work nor
      // commands the executor, and its presence is occurrence-inventory evidence rather than a DS-07 requirement.
      expect(
        postCapacityActions.every(
          ({ stage, taskId }) =>
            stage === "ObservePlannedAttemptExecutorWork" && taskId === controlledScenario.taskIds.D
        )
      ).toBe(true)
      expect(ds07.after.claimRequests.slice(ds07.beforeCapacity.claimRequests.length)).toEqual([])
      expect(ds07.after.plans.slice(ds07.beforeCapacity.plans.length)).toEqual([])
      expect(ds07.after.worktreeCreateRequests.slice(ds07.beforeCapacity.worktreeCreateRequests.length)).toEqual([])
      expect(ds07.after.commands.slice(ds07.beforeCapacity.commands.length)).toEqual([])
      expect(newRecords.filter(({ event }) => forbiddenPostCapacityEvents.has(event._tag))).toEqual([])
      expect(newRecords.filter(({ event }) => event._tag === "TaskWorkCapacityChanged")).toHaveLength(1)
      expect(postCapacityActions.filter(({ taskId }) => taskId === controlledScenario.taskIds.E)).toEqual([])
    }),
  capstoneTimeout
)

it.effect(
  "DS-08 interrupts the first coordinator after published P2 while the external executor state survives",
  () =>
    Effect.gen(function* () {
      const run = yield* runIssue268Ds08Characterization
      const ds08 = run.ds08
      const before = ds08.beforeLoss.snapshot
      const after = ds08.afterLoss
      const expectedHeld = [
        controlledScenario.attempts.A1,
        controlledScenario.attempts.C1,
        controlledScenario.attempts.D1
      ].toSorted()
      const held = ds08.beforeLoss.ds07.p2Publication.actionInputs.runtimeFacts.taskWork.held
        .map(({ correlation }) => correlation.attemptId)
        .toSorted()
      const reportsByAttempt = new Map(
        [...ds08.projectedReports.values()].map((report) => [report.correlation.attemptId, report] as const)
      )
      const p2EraPublicationsAtCut = after.publications.filter(
        ({ actionInputs }) =>
          actionInputs.runtimeFacts.acceptedAt !== null &&
          actionInputs.runtimeFacts.acceptedAt >= ds08.beforeLoss.ds07.capacityRecord.position
      )
      expect(held).toEqual(expectedHeld)
      expect(ds08.beforeLoss.ds07.p2Publication.publication.policy).toEqual(ds08.beforeLoss.ds07.returned)
      expect(ds08.beforeLoss.ds07.after.records).toContainEqual(ds08.beforeLoss.ds07.capacityRecord)
      expect(ds08.firstProcessInterruptionCount).toBe(1)
      expect(ds08.childScopeFinalizationCount).toBe(1)
      expect(ds08.applicationBuildCount).toBe(1)
      expect(ds08.applicationExitTrace).toEqual([])
      expect(ds08.executorObserveCallsAfterLoss).toBe(ds08.executorObserveCallsBeforeLoss)
      expect(ds08.projectedReports).toEqual(ds08.beforeLoss.projectedReports)
      expect(after.records).toEqual(before.records)
      expect(p2EraPublicationsAtCut).toContainEqual(ds08.beforeLoss.ds07.p2Publication)
      for (const publication of p2EraPublicationsAtCut) {
        expect(publication.publication.policy).toEqual(ds08.beforeLoss.ds07.returned)
        expect(
          publication.actionInputs.runtimeFacts.taskWork.held.map(({ correlation }) => correlation.attemptId).toSorted()
        ).toEqual(expectedHeld)
        expect(publication.actionInputs.runtimeFacts.acceptedAt).not.toBeNull()
        expect(publication.actionInputs.runtimeFacts.acceptedAt).toBeGreaterThanOrEqual(
          ds08.beforeLoss.ds07.capacityRecord.position
        )
        const tailRuntime = yield* evaluateDeliveryRuntimeInputBundle(publication)
        if (tailRuntime.proposedActions._tag !== "DeliveryProposalsAvailable") {
          return expect.fail("DS-08 must not leave a conflicting publication at the process-loss cut")
        }
        expect(
          tailRuntime.proposedActions.proposals.flatMap(({ admission }) =>
            admission.taskWorkPosition._tag === "TaskWorkPositionRequired" ? [admission.taskWorkPosition.taskId] : []
          )
        ).not.toContain(controlledScenario.taskIds.E)
      }
      expect(after.commands).toEqual(before.commands)
      expect(after.claimRequests).toEqual(before.claimRequests)
      expect(after.plans).toEqual(before.plans)
      expect(after.worktreeCreateRequests).toEqual(before.worktreeCreateRequests)
      expect(after.requestedTargets).toEqual(before.requestedTargets)
      expect(reportsByAttempt.get(controlledScenario.attempts.A1)).toMatchObject({
        _tag: "ExecutorWorkExecuting",
        correlation: { attemptId: controlledScenario.attempts.A1, runId: controlledScenario.runId }
      })
      expect(reportsByAttempt.get(controlledScenario.attempts.C1)).toMatchObject({
        _tag: "ExecutorWorkExecuting",
        correlation: { attemptId: controlledScenario.attempts.C1, runId: controlledScenario.runId }
      })
      expect(reportsByAttempt.get(controlledScenario.attempts.D1)).toMatchObject({
        _tag: "ExecutorWorkExecuting",
        correlation: { attemptId: controlledScenario.attempts.D1, runId: controlledScenario.runId }
      })
      expect(reportsByAttempt.get(controlledScenario.attempts.B1)).toMatchObject({
        _tag: "ExecutorWorkSafelySuspended",
        correlation: { attemptId: controlledScenario.attempts.B1, runId: controlledScenario.runId }
      })
      expect([...reportsByAttempt.keys()].toSorted()).toEqual(
        [
          controlledScenario.attempts.A1,
          controlledScenario.attempts.B1,
          controlledScenario.attempts.C1,
          controlledScenario.attempts.D1
        ].toSorted()
      )
    }),
  capstoneTimeout
)

it.effect(
  "reattaches three exact attempts after restart without Begin or Resume",
  () =>
    Effect.gen(function* () {
      const run = yield* runIssue268Ds09Characterization
      const ds09 = run.ds09
      const expectedHeld = [
        controlledScenario.attempts.A1,
        controlledScenario.attempts.C1,
        controlledScenario.attempts.D1
      ].toSorted()
      const observations = ds09.executorObservations
      const secondPublications = ds09.after.publications
      const journalSuffix = ds09.after.records.slice(ds09.beforeLoss.snapshot.records.length)
      const trackerRequestSuffix = ds09.after.requestedTargets.slice(ds09.beforeLoss.snapshot.requestedTargets.length)
      const held = (publication: DeliveryRelationInputBundle) =>
        publication.actionInputs.runtimeFacts.taskWork.held.map(({ correlation }) => correlation.attemptId).toSorted()
      const preLossPlans = new Map(
        ds09.beforeLoss.snapshot.plans.map((plannedAttempt) => [plannedAttempt.attemptId, plannedAttempt] as const)
      )

      expect(observations.map(({ correlation }) => correlation.attemptId)).toEqual([
        controlledScenario.attempts.A1,
        controlledScenario.attempts.C1,
        controlledScenario.attempts.D1
      ])
      expect(observations.every(({ purpose }) => purpose._tag === "PassiveLifecycleObservation")).toBe(true)
      for (const { currentGraphPublication } of observations) {
        expect(currentGraphPublication).toMatchObject({
          publication: {
            graph: { _tag: "GraphEstablished", observation: { snapshot: controlledScenario.graphs.G1 } },
            policy: ds09.beforeLoss.ds07.returned
          }
        })
      }
      expect(
        observations.map(({ projection }) =>
          projection._tag === "Exact"
            ? { attemptId: projection.report.correlation.attemptId, report: projection.report._tag }
            : projection
        )
      ).toEqual([
        { attemptId: controlledScenario.attempts.A1, report: "ExecutorWorkExecuting" },
        { attemptId: controlledScenario.attempts.C1, report: "ExecutorWorkExecuting" },
        { attemptId: controlledScenario.attempts.D1, report: "ExecutorWorkExecuting" }
      ])
      expect(observations.map(({ correlation }) => correlation.runId)).toEqual([
        controlledScenario.runId,
        controlledScenario.runId,
        controlledScenario.runId
      ])
      for (const observation of observations) {
        expect(observation.plannedAttempt).toEqual(preLossPlans.get(observation.correlation.attemptId))
        expect(observation.admission.taskWorkPosition).toEqual({
          _tag: "TaskWorkPositionRequired",
          mode: "ReserveOrReuse",
          taskId: observation.plannedAttempt.taskId
        })
        expect(observation.admission.plannedAttemptProtocolCorrelation).toEqual(observation.correlation)
      }
      expect(ds09.after.commands).toEqual([])
      expect(ds09.after.claimRequests).toEqual([])
      expect(ds09.after.plans).toEqual([])
      expect(ds09.after.worktreeCreateRequests).toEqual(ds09.beforeLoss.snapshot.worktreeCreateRequests)
      expect(journalSuffix.map(({ event }) => event._tag)).toEqual([
        "TaskTrackerReadIntentRecorded",
        "TaskTrackerFactsObserved"
      ])
      expect(journalSuffix[0]?.event).toMatchObject({
        operation: { _tag: "ReadTrackerGraph", cause: { _tag: "WorkflowEstablishment" } }
      })
      expect(journalSuffix[1]?.event).toMatchObject({ observation: { _tag: "UnchangedTaskTrackerFactsReconfirmed" } })
      expect(trackerRequestSuffix).toEqual([controlledScenario.target])
      expect(secondPublications.length).toBeGreaterThan(0)
      for (const publication of secondPublications) {
        expect(publication.publication.policy).toEqual(ds09.beforeLoss.ds07.returned)
        expect(held(publication)).toEqual(expectedHeld)
        expect(publication.publication.exactEvidence.some(isIssue268RetainedBResponsibility)).toBe(true)
      }
    }),
  capstoneTimeout
)

it.effect(
  "returns RunnableTransition after strict restart projections before the later refresh",
  () =>
    Effect.gen(function* () {
      const run = yield* runIssue268Ds09Characterization
      const ds09 = run.ds09
      expect(ds09.decision).toEqual({ _tag: "RunMustRemainActive", reason: "RunnableTransition" })
      expect(ds09.applicationBuildCount).toBe(2)
      expect(ds09.firstProcessInterruptionCount).toBe(1)
      expect(ds09.ordinaryOwnerActivationCount).toBe(1)
      expect(ds09.ordinaryOwnerActivationOpportunities).toEqual(["OrdinaryRunEntry"])
      expect(ds09.applicationExitTrace).toEqual([])
      expect(ds09.projectedReports).toEqual(ds09.beforeLoss.projectedReports)
      const expectedHeld = [
        controlledScenario.attempts.A1,
        controlledScenario.attempts.C1,
        controlledScenario.attempts.D1
      ].toSorted()
      const reportsByAttempt = new Map(
        [...ds09.projectedReports.values()].map((report) => [report.correlation.attemptId, report] as const)
      )
      expect(reportsByAttempt.get(controlledScenario.attempts.A1)).toMatchObject({
        _tag: "ExecutorWorkExecuting",
        correlation: { attemptId: controlledScenario.attempts.A1, runId: controlledScenario.runId }
      })
      expect(reportsByAttempt.get(controlledScenario.attempts.C1)).toMatchObject({
        _tag: "ExecutorWorkExecuting",
        correlation: { attemptId: controlledScenario.attempts.C1, runId: controlledScenario.runId }
      })
      expect(reportsByAttempt.get(controlledScenario.attempts.D1)).toMatchObject({
        _tag: "ExecutorWorkExecuting",
        correlation: { attemptId: controlledScenario.attempts.D1, runId: controlledScenario.runId }
      })
      expect(reportsByAttempt.get(controlledScenario.attempts.B1)).toMatchObject({
        _tag: "ExecutorWorkSafelySuspended",
        correlation: { attemptId: controlledScenario.attempts.B1, runId: controlledScenario.runId }
      })
      const publication = ds09.reconstructedPublication
      expect(
        publication.actionInputs.runtimeFacts.taskWork.held.map(({ correlation }) => correlation.attemptId).toSorted()
      ).toEqual(expectedHeld)
      const runtime = yield* evaluateDeliveryRuntimeInputBundle(publication)
      if (runtime.proposedActions._tag !== "DeliveryProposalsAvailable") {
        return expect.fail("DS-09 must retain a coherent capacity-blocked proposal frontier")
      }
      expect(runtime.proposedActions.freshTaskCandidates.map(({ taskId }) => taskId)).toContain(
        controlledScenario.taskIds.E
      )
      expect(
        runtime.proposedActions.proposals.filter(
          ({ order }) => deliveryProposalOrderTaskId(order) === controlledScenario.taskIds.E
        )
      ).toEqual([])
      const ePlacement = runtime.current.ticketDeliveries.source.placements.find(
        ({ taskId }) => taskId === controlledScenario.taskIds.E
      )?.placement
      expect(ePlacement).toMatchObject({ _tag: "EligibleOutsideBound" })
      expect(
        runtime.proposedActions.proposals.flatMap(({ admission }) =>
          admission.taskWorkPosition._tag === "TaskWorkPositionRequired" ? [admission.taskWorkPosition.taskId] : []
        )
      ).not.toContain(controlledScenario.taskIds.E)
    }),
  capstoneTimeout
)

it.effect(
  "refreshes closed C through the same owner and keeps its position",
  () =>
    Effect.gen(function* () {
      const run = yield* runIssue268Ds10Characterization
      const { ds09, ds10 } = run
      const recordSuffix = ds10.after.records.slice(ds09.after.records.length)
      const requestSuffix = ds10.after.requestedTargets.slice(ds09.after.requestedTargets.length)
      const commandSuffix = ds10.after.commands.slice(ds09.after.commands.length)
      const g2Facts = recordSuffix.filter(
        ({ event }) =>
          event._tag === "TaskTrackerFactsObserved" &&
          event.observation._tag === "CompleteTaskTrackerFacts" &&
          event.observation.factFamilies.some(
            ({ contentIdentity }) => contentIdentity === controlledScenario.graphs.G2.revision
          )
      )
      const suspendIntent = recordSuffix.find(
        ({ event }) =>
          event._tag === "PlannedAttemptExecutorCommandIntended" &&
          event.command === "Suspend" &&
          event.plannedAttempt.attemptId === controlledScenario.attempts.C1
      )
      const suspendResponse = recordSuffix.find(
        ({ event }) =>
          event._tag === "PlannedAttemptExecutorCommandResponseObserved" &&
          event.plannedAttempt.attemptId === controlledScenario.attempts.C1
      )
      const focusedTrackerRecords = recordSuffix.filter(
        ({ event }) =>
          event._tag === "TaskTrackerFactsObserved" &&
          (event.observation._tag === "FocusedTaskWorkSpecificationFacts" ||
            event.observation._tag === "FocusedTaskClaimFacts")
      )
      const focusedSpecificationTaskIds = focusedTrackerRecords.flatMap(({ event }) =>
        event._tag === "TaskTrackerFactsObserved" && event.observation._tag === "FocusedTaskWorkSpecificationFacts"
          ? [event.observation.factFamily.taskId]
          : []
      )
      const focusedClaimTaskIds = focusedTrackerRecords.flatMap(({ event }) =>
        event._tag === "TaskTrackerFactsObserved" && event.observation._tag === "FocusedTaskClaimFacts"
          ? [event.observation.coverage.taskId]
          : []
      )
      const focusedGitReads = recordSuffix.flatMap(({ event }) =>
        event._tag === "GitReadIntentRecorded"
          ? [{ operation: event.operation._tag, taskId: event.operation.plannedAttempt.taskId }]
          : []
      )
      const gitIntentByOperationId = new Map(
        recordSuffix.flatMap(({ event }) =>
          event._tag === "GitReadIntentRecorded"
            ? [
                [
                  event.operation.operationId,
                  { operation: event.operation._tag, taskId: event.operation.plannedAttempt.taskId }
                ] as const
              ]
            : []
        )
      )
      const completedGitRecords = recordSuffix.filter(
        ({ event }) => event._tag === "PlannedAttemptWorktreeObserved" || event._tag === "TargetLineageObserved"
      )
      const completedGitReads = completedGitRecords.flatMap(({ event }) => {
        if (event._tag !== "PlannedAttemptWorktreeObserved" && event._tag !== "TargetLineageObserved") return []
        const intent = gitIntentByOperationId.get(event.operationId)
        return intent === undefined ? [] : [{ observation: event._tag, taskId: intent.taskId }]
      })
      const expectedFocusedTaskIds = [controlledScenario.taskIds.A, controlledScenario.taskIds.D]
      const expectedHeldAttemptIds = [
        controlledScenario.attempts.A1,
        controlledScenario.attempts.C1,
        controlledScenario.attempts.D1
      ].toSorted()

      expect(ds10.before).toEqual(ds09)
      expect(ds10.notificationCount).toBe(1)
      expect(ds10.activeRefreshCount).toBe(1)
      expect(ds10.activeRefreshDecision).toBeUndefined()
      expect(ds10.activeRefreshSources).toEqual(["TrackerNotification"])
      expect(ds10.executorObserveCallCount).toBe(
        ds09.beforeLoss.executorObserveCalls + ds09.executorObservations.length
      )
      expect(ds10.idleHandoffCount).toBe(1)
      // Startup publication queued one obligation, upgraded by the notification;
      // accepted G2 then queued one ordinary obligation behind the still-live refresh.
      expect(ds10.trailingActivationCount).toBe(2)
      expect(ds09.ordinaryOwnerActivationCount).toBe(1)
      expect(requestSuffix).toEqual([controlledScenario.target, controlledScenario.target, controlledScenario.target])
      expect(commandSuffix).toEqual([{ attemptId: controlledScenario.attempts.C1, command: "Suspend" }])
      expect(ds10.after.claimRequests).toEqual(ds09.after.claimRequests)
      expect(ds10.after.plans).toEqual(ds09.after.plans)
      expect(ds10.after.worktreeCreateRequests).toEqual(ds09.after.worktreeCreateRequests)
      expect(g2Facts).toHaveLength(1)
      expect(focusedSpecificationTaskIds).toEqual(expectedFocusedTaskIds)
      expect(focusedClaimTaskIds).toEqual(expectedFocusedTaskIds)
      expect(focusedGitReads).toEqual([
        { operation: "ReadTaskWorktree", taskId: controlledScenario.taskIds.A },
        { operation: "ReadTaskWorktree", taskId: controlledScenario.taskIds.D },
        { operation: "ReadTargetLineage", taskId: controlledScenario.taskIds.A },
        { operation: "ReadTargetLineage", taskId: controlledScenario.taskIds.D }
      ])
      expect(completedGitReads).toEqual([
        { observation: "PlannedAttemptWorktreeObserved", taskId: controlledScenario.taskIds.A },
        { observation: "PlannedAttemptWorktreeObserved", taskId: controlledScenario.taskIds.D },
        { observation: "TargetLineageObserved", taskId: controlledScenario.taskIds.A },
        { observation: "TargetLineageObserved", taskId: controlledScenario.taskIds.D }
      ])
      expect(suspendIntent?.event).toMatchObject({
        command: "Suspend",
        ordinal: 2,
        plannedAttempt: { attemptId: controlledScenario.attempts.C1, runId: controlledScenario.runId }
      })
      expect(suspendResponse?.event).toMatchObject({
        commandOrdinal: 2,
        report: {
          _tag: "ExecutorWorkExecuting",
          correlation: { attemptId: controlledScenario.attempts.C1, runId: controlledScenario.runId }
        }
      })
      expect(suspendIntent?.position).toBeGreaterThan(g2Facts[0]?.position ?? Number.MAX_SAFE_INTEGER)
      expect(
        focusedTrackerRecords.every(({ position }) => position < (suspendIntent?.position ?? Number.MIN_SAFE_INTEGER))
      ).toBe(true)
      expect(
        completedGitRecords.every(({ position }) => position < (suspendIntent?.position ?? Number.MIN_SAFE_INTEGER))
      ).toBe(true)
      expect(suspendResponse?.position).toBeGreaterThan(suspendIntent?.position ?? Number.MAX_SAFE_INTEGER)
      expect(
        ds10.checkpointPublication.actionInputs.runtimeFacts.taskWork.held
          .map(({ correlation }) => ({ attemptId: correlation.attemptId, runId: correlation.runId }))
          .toSorted((left, right) => left.attemptId.localeCompare(right.attemptId))
      ).toEqual(expectedHeldAttemptIds.map((attemptId) => ({ attemptId, runId: controlledScenario.runId })))
      expect(ds10.checkpointPublication.publication.policy).toEqual(ds09.beforeLoss.ds07.returned)
      expect(ds10.checkpointPublication.publication.graph).toMatchObject({
        _tag: "GraphEstablished",
        observation: { snapshot: controlledScenario.graphs.G2 }
      })
      expect(
        ds10.checkpointPublication.publication.exactEvidence.some(
          (evidence) =>
            evidence._tag === "ResponsibilityFacts" &&
            evidence.facts.responsibility._tag === "PlannedAttemptExecutorWorkResponsibility" &&
            evidence.facts.responsibility.plannedAttempt.attemptId === controlledScenario.attempts.C1 &&
            evidence.facts.disposition._tag === "PlannedAttemptExecutorSuspensionRequested"
        )
      ).toBe(true)
      expect(ds10.checkpointPublication.publication.exactEvidence.some(isIssue268RetainedBResponsibility)).toBe(true)
      const runtime = yield* evaluateDeliveryRuntimeInputBundle(ds10.checkpointPublication)
      expect(
        runtime.current.ticketDeliveries.source.placements.find(({ taskId }) => taskId === controlledScenario.taskIds.E)
          ?.placement
      ).toMatchObject({ _tag: "EligibleOutsideBound" })
      if (runtime.proposedActions._tag !== "DeliveryProposalsAvailable") {
        return expect.fail("DS-10 must retain the capacity-blocked E candidate frontier")
      }
      expect(
        runtime.proposedActions.proposals.filter(
          ({ order }) => deliveryProposalOrderTaskId(order) === controlledScenario.taskIds.E
        )
      ).toEqual([])
    }),
  capstoneTimeout
)

it.effect(
  "accepts exact C1 Safe and releases only C1's position",
  () =>
    Effect.gen(function* () {
      const { ds10, ds11 } = yield* runIssue268Ds11Characterization
      const recordSuffix = ds11.after.records.slice(ds10.after.records.length)
      const safeObservations = recordSuffix.filter(
        ({ event }) =>
          event._tag === "PlannedAttemptExecutorStateObserved" &&
          event.plannedAttempt.attemptId === controlledScenario.attempts.C1 &&
          event.plannedAttempt.runId === controlledScenario.runId &&
          event.observation._tag === "ExactExecutorReport" &&
          event.observation.report._tag === "ExecutorWorkSafelySuspended" &&
          event.observation.report.correlation.attemptId === controlledScenario.attempts.C1 &&
          event.observation.report.correlation.runId === controlledScenario.runId
      )
      const safeReports = recordSuffix.filter(
        ({ event }) =>
          event._tag === "PlannedAttemptExecutorWorkReported" &&
          event.ordinal === 2 &&
          event.report._tag === "ExecutorWorkSafelySuspended" &&
          event.report.correlation.attemptId === controlledScenario.attempts.C1 &&
          event.report.correlation.runId === controlledScenario.runId
      )
      const safeObservation = safeObservations[0]
      const safeReport = safeReports[0]
      const ds10G2 = ds10.after.records.findLast(
        ({ event }) =>
          event._tag === "TaskTrackerFactsObserved" &&
          event.observation._tag === "CompleteTaskTrackerFacts" &&
          event.observation.factFamilies.some(
            ({ contentIdentity }) => contentIdentity === controlledScenario.graphs.G2.revision
          )
      )
      const stabilizationIntents = recordSuffix.filter(
        ({ event }) =>
          event._tag === "TaskTrackerReadIntentRecorded" &&
          event.operation._tag === "ReadTrackerGraph" &&
          event.operation.cause._tag === "PostQuiescenceReconfirmation"
      )
      const stabilizationIntent = stabilizationIntents[0]
      const stabilizationResults = recordSuffix.filter(
        ({ event }) =>
          event._tag === "TaskTrackerFactsObserved" && event.observation._tag === "UnchangedTaskTrackerFactsReconfirmed"
      )
      const stabilizationResult = stabilizationResults[0]
      const expectedHeld = [controlledScenario.attempts.A1, controlledScenario.attempts.D1].map((attemptId) => ({
        attemptId,
        runId: controlledScenario.runId
      }))
      const held = ds11.checkpointPublication.actionInputs.runtimeFacts.taskWork.held
        .map(({ correlation }) => ({ attemptId: correlation.attemptId, runId: correlation.runId }))
        .toSorted((left, right) => left.attemptId.localeCompare(right.attemptId))
      const cResponsibilityBefore = ds10.checkpointPublication.publication.exactEvidence.find(
        (evidence) =>
          evidence._tag === "ResponsibilityFacts" &&
          evidence.facts.responsibility._tag === "PlannedAttemptExecutorWorkResponsibility" &&
          evidence.facts.responsibility.plannedAttempt.attemptId === controlledScenario.attempts.C1 &&
          evidence.facts.responsibility.plannedAttempt.runId === controlledScenario.runId
      )
      const cResponsibilityAfter = ds11.checkpointPublication.publication.exactEvidence.find(
        (evidence) =>
          evidence._tag === "ResponsibilityFacts" &&
          evidence.facts.responsibility._tag === "PlannedAttemptExecutorWorkResponsibility" &&
          evidence.facts.responsibility.plannedAttempt.attemptId === controlledScenario.attempts.C1 &&
          evidence.facts.responsibility.plannedAttempt.runId === controlledScenario.runId
      )

      expect(ds11.before).toEqual(ds10)
      expect(ds11.activeRefreshCount).toBe(1)
      expect(ds11.activeRefreshDecision).toBeUndefined()
      expect(ds11.executorObserveCallCount).toBe(ds10.executorObserveCallCount)
      expect(recordSuffix.map(({ event }) => event._tag)).toEqual([
        "PlannedAttemptExecutorStateObserved",
        "PlannedAttemptExecutorWorkReported",
        "TaskTrackerReadIntentRecorded",
        "TaskTrackerFactsObserved"
      ])
      expect(safeObservations).toHaveLength(1)
      expect(safeReports).toHaveLength(1)
      expect(stabilizationIntents).toHaveLength(1)
      expect(stabilizationResults).toHaveLength(1)
      expect(safeReport?.position).toBeGreaterThan(safeObservation?.position ?? Number.MAX_SAFE_INTEGER)
      expect(stabilizationIntent?.position).toBeGreaterThan(safeReport?.position ?? Number.MAX_SAFE_INTEGER)
      expect(stabilizationIntent?.event).toMatchObject({
        operation: {
          cause: {
            _tag: "PostQuiescenceReconfirmation",
            quiescentGraphOperationId:
              ds10G2?.event._tag === "TaskTrackerFactsObserved" ? ds10G2.event.observation.operationId : undefined
          },
          target: controlledScenario.target
        }
      })
      expect(stabilizationResult?.position).toBeGreaterThan(stabilizationIntent?.position ?? Number.MAX_SAFE_INTEGER)
      expect(stabilizationResult?.event).toMatchObject({
        observation: {
          _tag: "UnchangedTaskTrackerFactsReconfirmed",
          operationId:
            stabilizationIntent?.event._tag === "TaskTrackerReadIntentRecorded"
              ? stabilizationIntent.event.operation.operationId
              : undefined,
          priorFullObservationOperationId:
            ds10G2?.event._tag === "TaskTrackerFactsObserved" ? ds10G2.event.observation.operationId : undefined
        }
      })
      expect(ds11.checkpointPublication.actionInputs.runtimeFacts.acceptedAt).toBeGreaterThanOrEqual(
        stabilizationResult?.position ?? Number.MAX_SAFE_INTEGER
      )
      expect(held).toEqual(expectedHeld)
      expect(ds11.checkpointPublication.publication.graph).toMatchObject({
        _tag: "GraphEstablished",
        observation: { snapshot: controlledScenario.graphs.G2 }
      })
      expect(ds11.checkpointPublication.publication.policy).toEqual(ds10.checkpointPublication.publication.policy)
      expect(cResponsibilityAfter).toMatchObject({
        facts: {
          disposition: { _tag: "TaskLifecycleConstraint", lifecycle: "TerminalWithoutSuccess" },
          responsibility:
            cResponsibilityBefore?._tag === "ResponsibilityFacts"
              ? cResponsibilityBefore.facts.responsibility
              : undefined
        }
      })
      expect(ds11.checkpointPublication.publication.exactEvidence.some(isIssue268RetainedBResponsibility)).toBe(true)
      expect(cResponsibilityAfter).toBeDefined()
      expect(ds11.after.requestedTargets.slice(ds10.after.requestedTargets.length)).toEqual([controlledScenario.target])
      expect(ds11.after.claimRequests).toEqual(ds10.after.claimRequests)
      expect(ds11.after.commands).toEqual(ds10.after.commands)
      expect(ds11.after.executedActions).toEqual(ds10.after.executedActions)
      expect(ds11.after.worktreeCreateRequests).toEqual(ds10.after.worktreeCreateRequests)
    }),
  capstoneTimeout
)

it.effect(
  "keeps active-work refresh before quiescence and stabilization after it",
  () =>
    Effect.gen(function* () {
      const { ds09, ds10, ds11 } = yield* runIssue268Ds11Characterization
      const activeRefreshRecords = ds10.after.records.slice(ds09.after.records.length)
      const afterSafeRecords = ds11.after.records.slice(ds10.after.records.length)
      const g2Results = activeRefreshRecords.filter(
        ({ event }) =>
          event._tag === "TaskTrackerFactsObserved" &&
          event.observation._tag === "CompleteTaskTrackerFacts" &&
          event.observation.factFamilies.some(
            ({ contentIdentity }) => contentIdentity === controlledScenario.graphs.G2.revision
          )
      )
      const g2Result = g2Results[0]
      const g2OperationId =
        g2Result?.event._tag === "TaskTrackerFactsObserved" ? g2Result.event.observation.operationId : undefined
      const g2Intents = activeRefreshRecords.filter(
        ({ event }) =>
          event._tag === "TaskTrackerReadIntentRecorded" &&
          event.operation._tag === "ReadTrackerGraph" &&
          event.operation.operationId === g2OperationId
      )
      const suspendIntents = activeRefreshRecords.filter(
        ({ event }) =>
          event._tag === "PlannedAttemptExecutorCommandIntended" &&
          event.command === "Suspend" &&
          event.plannedAttempt.attemptId === controlledScenario.attempts.C1 &&
          event.plannedAttempt.runId === controlledScenario.runId
      )
      const suspendResponses = activeRefreshRecords.filter(
        ({ event }) =>
          event._tag === "PlannedAttemptExecutorCommandResponseObserved" &&
          event.plannedAttempt.attemptId === controlledScenario.attempts.C1 &&
          event.plannedAttempt.runId === controlledScenario.runId
      )
      const safeObservations = afterSafeRecords.filter(
        ({ event }) =>
          event._tag === "PlannedAttemptExecutorStateObserved" &&
          event.plannedAttempt.attemptId === controlledScenario.attempts.C1 &&
          event.plannedAttempt.runId === controlledScenario.runId &&
          event.observation._tag === "ExactExecutorReport" &&
          event.observation.report._tag === "ExecutorWorkSafelySuspended"
      )
      const safeReports = afterSafeRecords.filter(
        ({ event }) =>
          event._tag === "PlannedAttemptExecutorWorkReported" &&
          event.report._tag === "ExecutorWorkSafelySuspended" &&
          event.report.correlation.attemptId === controlledScenario.attempts.C1 &&
          event.report.correlation.runId === controlledScenario.runId
      )
      const stabilizationIntents = afterSafeRecords.filter(
        ({ event }) =>
          event._tag === "TaskTrackerReadIntentRecorded" &&
          event.operation._tag === "ReadTrackerGraph" &&
          event.operation.cause._tag === "PostQuiescenceReconfirmation"
      )
      const stabilizationIntent = stabilizationIntents[0]
      const stabilizationOperationId =
        stabilizationIntent?.event._tag === "TaskTrackerReadIntentRecorded" &&
        stabilizationIntent.event.operation._tag === "ReadTrackerGraph"
          ? stabilizationIntent.event.operation.operationId
          : undefined
      const stabilizationResults = afterSafeRecords.filter(
        ({ event }) =>
          event._tag === "TaskTrackerFactsObserved" &&
          event.observation._tag === "UnchangedTaskTrackerFactsReconfirmed" &&
          event.observation.operationId === stabilizationOperationId
      )

      expect(ds10.activeRefreshCount).toBe(1)
      expect(ds10.activeRefreshSources).toEqual(["TrackerNotification"])
      expect(ds10.activeRefreshDecision).toBeUndefined()
      expect(ds11.before).toEqual(ds10)
      expect(ds11.activeRefreshCount).toBe(ds10.activeRefreshCount)
      expect(ds11.activeRefreshDecision).toBeUndefined()
      expect(g2Results).toHaveLength(1)
      expect(g2Intents).toHaveLength(1)
      expect(suspendIntents).toHaveLength(1)
      expect(suspendResponses).toHaveLength(1)
      expect(safeObservations).toHaveLength(1)
      expect(safeReports).toHaveLength(1)
      expect(stabilizationIntents).toHaveLength(1)
      expect(stabilizationResults).toHaveLength(1)

      const g2Intent = g2Intents[0]
      const suspendIntent = suspendIntents[0]
      const suspendResponse = suspendResponses[0]
      const safeObservation = safeObservations[0]
      const safeReport = safeReports[0]
      const stabilizationResult = stabilizationResults[0]
      if (
        g2Intent === undefined ||
        g2Result === undefined ||
        suspendIntent === undefined ||
        suspendResponse === undefined ||
        safeObservation === undefined ||
        safeReport === undefined ||
        stabilizationIntent === undefined ||
        stabilizationResult === undefined ||
        suspendIntent.event._tag !== "PlannedAttemptExecutorCommandIntended" ||
        suspendResponse.event._tag !== "PlannedAttemptExecutorCommandResponseObserved" ||
        stabilizationIntent.event._tag !== "TaskTrackerReadIntentRecorded" ||
        stabilizationIntent.event.operation._tag !== "ReadTrackerGraph" ||
        stabilizationIntent.event.operation.cause._tag !== "PostQuiescenceReconfirmation"
      ) {
        return expect.fail("DS-11 characterization lacks the exact active-refresh/stabilization causal chain")
      }

      expect(g2Result.position).toBeGreaterThan(g2Intent.position)
      expect(suspendIntent.position).toBeGreaterThan(g2Result.position)
      expect(suspendResponse.event).toMatchObject({
        commandOrdinal: suspendIntent.event.ordinal,
        plannedAttempt: { attemptId: controlledScenario.attempts.C1, runId: controlledScenario.runId },
        report: {
          _tag: "ExecutorWorkExecuting",
          correlation: { attemptId: controlledScenario.attempts.C1, runId: controlledScenario.runId }
        }
      })
      expect(suspendResponse.position).toBeGreaterThan(suspendIntent.position)
      expect(safeObservation.position).toBeGreaterThan(suspendResponse.position)
      expect(safeReport.position).toBeGreaterThan(safeObservation.position)
      expect(stabilizationIntent.position).toBeGreaterThan(safeReport.position)
      expect(stabilizationIntent.event.operation.operationId).not.toBe(g2OperationId)
      expect(stabilizationIntent.event.operation.cause.quiescentGraphOperationId).toBe(g2OperationId)
      expect(stabilizationIntent.event.operation.predecessorOperationIds).toContain(g2OperationId)
      expect(stabilizationResult.position).toBeGreaterThan(stabilizationIntent.position)
      expect(stabilizationResult.event).toMatchObject({
        observation: {
          _tag: "UnchangedTaskTrackerFactsReconfirmed",
          operationId: stabilizationIntent.event.operation.operationId,
          priorFullObservationOperationId: g2OperationId
        }
      })
      expect(ds11.checkpointPublication.actionInputs.runtimeFacts.acceptedAt).toBeGreaterThanOrEqual(
        stabilizationResult.position
      )
    }),
  capstoneTimeout
)

it.effect(
  "accepts exact B1 Continue but defers Resume while A1 and D1 fill capacity",
  () =>
    Effect.gen(function* () {
      const { ds11, ds12 } = yield* runIssue268Ds12Characterization
      const recordSuffix = ds12.after.records.slice(ds11.after.records.length)
      const choiceRecords = recordSuffix.filter(
        ({ event }) => event._tag === "AttemptChoiceApplied" && event.choice === "ContinueExistingAttempt"
      )
      const continuationAuthorizations = recordSuffix.filter(
        ({ event }) => event._tag === "PlannedAttemptContinuationAuthorized"
      )
      const resumeIntents = recordSuffix.filter(
        ({ event }) => event._tag === "PlannedAttemptExecutorCommandIntended" && event.command === "Resume"
      )
      const focusedTaskIds = recordSuffix.flatMap(({ event }) => {
        if (event._tag !== "TaskTrackerFactsObserved") return []
        if (event.observation._tag === "FocusedTaskWorkSpecificationFacts") {
          return [event.observation.factFamily.taskId]
        }
        return event.observation._tag === "FocusedTaskClaimFacts" ? [event.observation.coverage.taskId] : []
      })
      const runtime = yield* evaluateDeliveryRuntimeInputBundle(ds12.checkpointPublication)
      const bResumeProposals =
        runtime.proposedActions._tag === "DeliveryProposalsAvailable"
          ? runtime.proposedActions.proposals.filter(
              ({ order, route }) =>
                deliveryProposalOrderTaskId(order) === controlledScenario.taskIds.B &&
                route._tag === "IdentityFreeWorkflowRoute" &&
                route.transition._tag === "ResumePlannedAttemptExecutorWorkAfterCurrentFacts" &&
                route.transition.plannedAttempt.attemptId === controlledScenario.attempts.B1
            )
          : []
      const held = ds12.checkpointPublication.actionInputs.runtimeFacts.taskWork.held
        .map(({ correlation }) => correlation.attemptId)
        .toSorted()
      const occupiedTaskIds = [
        ...ds12.checkpointPublication.actionInputs.runtimeFacts.taskWork.occupied.keys()
      ].toSorted()
      const graphIntent = recordSuffix.find(
        ({ event }) =>
          event._tag === "TaskTrackerReadIntentRecorded" &&
          event.operation._tag === "ReadTrackerGraph" &&
          event.operation.cause._tag === "AttemptContinuation"
      )
      const graphOperationId =
        graphIntent?.event._tag === "TaskTrackerReadIntentRecorded"
          ? graphIntent.event.operation.operationId
          : undefined
      const graphResult = recordSuffix.find(
        ({ event }) => event._tag === "TaskTrackerFactsObserved" && event.operationId === graphOperationId
      )
      const specificationIntent = recordSuffix.find(
        ({ event }) =>
          event._tag === "TaskTrackerReadIntentRecorded" && event.operation._tag === "ReadTaskWorkSpecification"
      )
      const specificationOperationId =
        specificationIntent?.event._tag === "TaskTrackerReadIntentRecorded"
          ? specificationIntent.event.operation.operationId
          : undefined
      const specificationResult = recordSuffix.find(
        ({ event }) => event._tag === "TaskTrackerFactsObserved" && event.operationId === specificationOperationId
      )
      const claimIntent = recordSuffix.find(
        ({ event }) => event._tag === "TaskTrackerReadIntentRecorded" && event.operation._tag === "ReadTaskClaim"
      )
      const claimOperationId =
        claimIntent?.event._tag === "TaskTrackerReadIntentRecorded"
          ? claimIntent.event.operation.operationId
          : undefined
      const claimResult = recordSuffix.find(
        ({ event }) => event._tag === "TaskTrackerFactsObserved" && event.operationId === claimOperationId
      )
      const worktreeIntent = recordSuffix.find(
        ({ event }) => event._tag === "GitReadIntentRecorded" && event.operation._tag === "ReadTaskWorktree"
      )
      const worktreeOperationId =
        worktreeIntent?.event._tag === "GitReadIntentRecorded" ? worktreeIntent.event.operation.operationId : undefined
      const worktreeResult = recordSuffix.find(
        ({ event }) => event._tag === "PlannedAttemptWorktreeObserved" && event.operationId === worktreeOperationId
      )
      const lineageIntent = recordSuffix.find(
        ({ event }) => event._tag === "GitReadIntentRecorded" && event.operation._tag === "ReadTargetLineage"
      )
      const lineageOperationId =
        lineageIntent?.event._tag === "GitReadIntentRecorded" ? lineageIntent.event.operation.operationId : undefined
      const lineageResult = recordSuffix.find(
        ({ event }) => event._tag === "TargetLineageObserved" && event.operationId === lineageOperationId
      )
      const cResponsibility = ds12.checkpointPublication.publication.exactEvidence.find(
        (evidence) =>
          evidence._tag === "ResponsibilityFacts" &&
          evidence.facts.responsibility._tag === "PlannedAttemptExecutorWorkResponsibility" &&
          evidence.facts.responsibility.plannedAttempt.attemptId === controlledScenario.attempts.C1
      )
      const bResponsibilities = ds12.checkpointPublication.publication.exactEvidence.filter(
        (evidence) =>
          evidence._tag === "ResponsibilityFacts" &&
          evidence.facts._tag === "PlannedAttemptExecutorFreshFacts" &&
          evidence.facts.responsibility.plannedAttempt.attemptId === controlledScenario.attempts.B1
      )
      const ePlacement = runtime.current.ticketDeliveries.source.placements.find(
        ({ taskId }) => taskId === controlledScenario.taskIds.E
      )?.placement

      expect(ds12.before).toEqual(ds11)
      expect(recordSuffix.filter(({ event }) => event._tag === "TaskTrackerReadIntentRecorded")).toHaveLength(3)
      expect(recordSuffix.filter(({ event }) => event._tag === "TaskTrackerFactsObserved")).toHaveLength(3)
      expect(recordSuffix.filter(({ event }) => event._tag === "GitReadIntentRecorded")).toHaveLength(2)
      expect(recordSuffix.filter(({ event }) => event._tag === "PlannedAttemptWorktreeObserved")).toHaveLength(1)
      expect(recordSuffix.filter(({ event }) => event._tag === "TargetLineageObserved")).toHaveLength(1)
      expect(ds12.choice).toMatchObject({ _tag: "ContinueApplied", application: choiceRecords[0] })
      expect(choiceRecords).toHaveLength(1)
      expect(choiceRecords[0]?.event).toMatchObject({
        choice: "ContinueExistingAttempt",
        requestId: ds12.request.requestId,
        subject: {
          observedTaskRevision: controlledScenario.specifications.F2.B.fingerprint,
          plannedAttempt: ds12.request.subject.plannedAttempt
        }
      })
      expect(ds11.checkpointPublication.actionInputs.runtimeFacts.acceptedAt).toBeLessThan(
        choiceRecords[0]?.position ?? 0
      )
      expect(graphIntent?.event).toMatchObject({
        operation: {
          _tag: "ReadTrackerGraph",
          cause: { _tag: "AttemptContinuation" },
          target: controlledScenario.target
        }
      })
      expect(graphResult?.event).toMatchObject({
        observation: {
          _tag: "UnchangedTaskTrackerFactsReconfirmed",
          operationId:
            graphIntent?.event._tag === "TaskTrackerReadIntentRecorded"
              ? graphIntent.event.operation.operationId
              : undefined
        }
      })
      expect(specificationIntent?.event).toMatchObject({
        operation: { _tag: "ReadTaskWorkSpecification", taskId: controlledScenario.taskIds.B }
      })
      expect(specificationResult?.event).toMatchObject({
        observation: {
          _tag: "FocusedTaskWorkSpecificationFacts",
          factFamily: {
            contentIdentity: controlledScenario.specifications.F2.B.fingerprint,
            taskId: controlledScenario.taskIds.B
          },
          operationId:
            specificationIntent?.event._tag === "TaskTrackerReadIntentRecorded"
              ? specificationIntent.event.operation.operationId
              : undefined
        }
      })
      expect(claimIntent?.event).toMatchObject({
        operation: { _tag: "ReadTaskClaim", taskId: controlledScenario.taskIds.B }
      })
      expect(claimResult?.event).toMatchObject({
        observation: {
          _tag: "FocusedTaskClaimFacts",
          coverage: { taskId: controlledScenario.taskIds.B },
          operationId:
            claimIntent?.event._tag === "TaskTrackerReadIntentRecorded"
              ? claimIntent.event.operation.operationId
              : undefined
        }
      })
      expect(worktreeIntent?.event).toMatchObject({
        operation: { _tag: "ReadTaskWorktree", plannedAttempt: ds12.request.subject.plannedAttempt }
      })
      expect(worktreeResult?.event).toMatchObject({
        operationId:
          worktreeIntent?.event._tag === "GitReadIntentRecorded"
            ? worktreeIntent.event.operation.operationId
            : undefined,
        observation: {
          _tag: "PlannedWorktreeReady",
          baseSha: ds12.request.subject.plannedAttempt.baseSha,
          branch: ds12.request.subject.plannedAttempt.branch,
          worktree: ds12.request.subject.plannedAttempt.worktree
        }
      })
      expect(lineageIntent?.event).toMatchObject({
        operation: { _tag: "ReadTargetLineage", plannedAttempt: ds12.request.subject.plannedAttempt }
      })
      expect(lineageResult?.event).toMatchObject({
        operationId:
          lineageIntent?.event._tag === "GitReadIntentRecorded" ? lineageIntent.event.operation.operationId : undefined,
        observation: {
          plannedBaseIsAncestorOfTargetHead: true,
          plannedBaseSha: ds12.request.subject.plannedAttempt.baseSha
        },
        plannedAttempt: ds12.request.subject.plannedAttempt
      })
      expect(ds12.checkpointPublication.actionInputs.runtimeFacts.acceptedAt).toBeGreaterThanOrEqual(
        lineageResult?.position ?? Number.MAX_SAFE_INTEGER
      )
      expect(focusedTaskIds).toEqual([controlledScenario.taskIds.B, controlledScenario.taskIds.B])
      expect(ds12.activeRefreshCount).toBe(1)
      expect(ds12.activeRefreshDecision).toBeUndefined()
      expect(ds12.applicationBuildCount).toBe(2)
      expect(ds12.applicationBuildCount).toBe(ds11.before.before.applicationBuildCount)
      expect(ds12.ordinaryOwnerActivationCount).toBe(1)
      expect(ds12.executorObserveCallCount).toBe(ds11.executorObserveCallCount)
      expect(held).toEqual([controlledScenario.attempts.A1, controlledScenario.attempts.D1].toSorted())
      expect(occupiedTaskIds).toEqual([controlledScenario.taskIds.A, controlledScenario.taskIds.D].toSorted())
      expect(bResumeProposals).toHaveLength(1)
      expect(bResumeProposals[0]).toMatchObject({
        admission: {
          plannedAttemptProtocol: {
            _tag: "PlannedAttemptProtocolRequired",
            correlation: { attemptId: controlledScenario.attempts.B1, runId: controlledScenario.runId }
          },
          taskWorkPosition: {
            _tag: "TaskWorkPositionRequired",
            mode: "ReserveOrReuse",
            taskId: controlledScenario.taskIds.B
          }
        },
        route: {
          transition: {
            _tag: "ResumePlannedAttemptExecutorWorkAfterCurrentFacts",
            plannedAttempt: ds12.request.subject.plannedAttempt
          }
        }
      })
      expect(bResponsibilities).toHaveLength(1)
      expect(bResponsibilities[0]).toMatchObject({ facts: { disposition: { _tag: "Ready" } } })
      expect(cResponsibility).toMatchObject({
        facts: { disposition: { _tag: "TaskLifecycleConstraint", lifecycle: "TerminalWithoutSuccess" } }
      })
      expect(ePlacement).toMatchObject({ _tag: "EligibleOutsideBound" })
      expect(continuationAuthorizations).toEqual([])
      expect(resumeIntents).toEqual([])
      expect(ds12.after.commands).toEqual(ds11.after.commands)
      expect(ds12.after.claimRequests).toEqual(ds11.after.claimRequests)
      expect(ds12.after.plans).toEqual(ds11.after.plans)
      expect(ds12.after.worktreeCreateRequests).toEqual(ds11.after.worktreeCreateRequests)
      expect(
        runtime.proposedActions._tag === "DeliveryProposalsAvailable"
          ? runtime.proposedActions.proposals.filter(
              ({ order }) => deliveryProposalOrderTaskId(order) === controlledScenario.taskIds.E
            )
          : []
      ).toEqual([])
    }),
  capstoneTimeout
)

it.effect(
  "resumes retained B1 after A1 accepts and does not create B2",
  () =>
    Effect.gen(function* () {
      const { ds12, ds13 } = yield* runIssue268Ds13Characterization
      const recordSuffix = ds13.after.records.slice(ds12.after.records.length)
      const aStateObservations = recordSuffix.filter(
        ({ event }) =>
          event._tag === "PlannedAttemptExecutorStateObserved" &&
          event.plannedAttempt.runId === controlledScenario.runId &&
          event.plannedAttempt.attemptId === controlledScenario.attempts.A1 &&
          event.observation._tag === "ExactExecutorReport" &&
          event.observation.report._tag === "ExecutorWorkTerminal" &&
          event.observation.report.result._tag === "Accepted"
      )
      const aReports = recordSuffix.filter(
        ({ event }) =>
          event._tag === "PlannedAttemptExecutorWorkReported" &&
          event.report.correlation.runId === controlledScenario.runId &&
          event.report.correlation.attemptId === controlledScenario.attempts.A1 &&
          event.report._tag === "ExecutorWorkTerminal" &&
          event.report.result._tag === "Accepted"
      )
      const authorizations = recordSuffix.filter(
        ({ event }) =>
          event._tag === "PlannedAttemptContinuationAuthorized" &&
          event.plannedAttempt.runId === controlledScenario.runId &&
          event.plannedAttempt.attemptId === controlledScenario.attempts.B1
      )
      const resumeIntents = recordSuffix.filter(
        ({ event }) =>
          event._tag === "PlannedAttemptExecutorCommandIntended" &&
          event.command === "Resume" &&
          event.plannedAttempt.runId === controlledScenario.runId &&
          event.plannedAttempt.attemptId === controlledScenario.attempts.B1
      )
      const resumeResponses = recordSuffix.filter(
        ({ event }) =>
          event._tag === "PlannedAttemptExecutorCommandResponseObserved" &&
          event.plannedAttempt.runId === controlledScenario.runId &&
          event.plannedAttempt.attemptId === controlledScenario.attempts.B1 &&
          event.report._tag === "ExecutorWorkExecuting"
      )
      const bReports = recordSuffix.filter(
        ({ event }) =>
          event._tag === "PlannedAttemptExecutorWorkReported" &&
          event.report.correlation.runId === controlledScenario.runId &&
          event.report.correlation.attemptId === controlledScenario.attempts.B1 &&
          event.report._tag === "ExecutorWorkExecuting"
      )
      const aStateObservation = aStateObservations[0]
      const aReport = aReports[0]
      const authorization = authorizations[0]
      const resumeIntent = resumeIntents[0]
      const resumeResponse = resumeResponses[0]
      const bReport = bReports[0]
      const ds12Suffix = ds12.after.records.slice(ds12.before.after.records.length)
      const graphOperationId = ds12Suffix.find(
        ({ event }) =>
          event._tag === "TaskTrackerReadIntentRecorded" &&
          event.operation._tag === "ReadTrackerGraph" &&
          event.operation.cause._tag === "AttemptContinuation"
      )
      const specificationOperationId = ds12Suffix.find(
        ({ event }) =>
          event._tag === "TaskTrackerReadIntentRecorded" && event.operation._tag === "ReadTaskWorkSpecification"
      )
      const claimOperationId = ds12Suffix.find(
        ({ event }) => event._tag === "TaskTrackerReadIntentRecorded" && event.operation._tag === "ReadTaskClaim"
      )
      const worktreeOperationId = ds12Suffix.find(
        ({ event }) => event._tag === "GitReadIntentRecorded" && event.operation._tag === "ReadTaskWorktree"
      )
      const lineageOperationId = ds12Suffix.find(
        ({ event }) => event._tag === "GitReadIntentRecorded" && event.operation._tag === "ReadTargetLineage"
      )
      const runtime = yield* evaluateDeliveryRuntimeInputBundle(ds13.checkpointPublication)
      const held = ds13.checkpointPublication.actionInputs.runtimeFacts.taskWork.held
        .map(({ correlation }) => correlation.attemptId)
        .toSorted()
      const occupied = [...ds13.checkpointPublication.actionInputs.runtimeFacts.taskWork.occupied.values()]
        .flatMap((position) => (position._tag === "ExactAttemptHeld" ? [position.plannedAttempt.attemptId] : []))
        .toSorted()
      const bEvidence = ds13.checkpointPublication.publication.exactEvidence.filter(
        (evidence) =>
          evidence._tag === "ResponsibilityFacts" &&
          evidence.facts.responsibility._tag === "PlannedAttemptExecutorWorkResponsibility" &&
          evidence.facts.responsibility.plannedAttempt.runId === controlledScenario.runId &&
          evidence.facts.responsibility.plannedAttempt.attemptId === controlledScenario.attempts.B1
      )
      const cEvidence = ds13.checkpointPublication.publication.exactEvidence.filter(
        (evidence) =>
          evidence._tag === "ResponsibilityFacts" &&
          evidence.facts.responsibility._tag === "PlannedAttemptExecutorWorkResponsibility" &&
          evidence.facts.responsibility.plannedAttempt.runId === controlledScenario.runId &&
          evidence.facts.responsibility.plannedAttempt.attemptId === controlledScenario.attempts.C1
      )
      const ePlacement = runtime.current.ticketDeliveries.source.placements.find(
        ({ taskId }) => taskId === controlledScenario.taskIds.E
      )?.placement

      expect(ds13.before).toEqual(ds12)
      expect(aStateObservations).toHaveLength(1)
      expect(aReports).toHaveLength(1)
      expect(authorizations).toHaveLength(1)
      expect(resumeIntents).toHaveLength(1)
      expect(resumeResponses).toHaveLength(1)
      expect(bReports).toHaveLength(1)
      expect(aReport?.position).toBeGreaterThan(aStateObservation?.position ?? Number.MAX_SAFE_INTEGER)
      expect(authorization?.position).toBeGreaterThan(aReport?.position ?? Number.MAX_SAFE_INTEGER)
      expect(resumeIntent?.position).toBeGreaterThan(authorization?.position ?? Number.MAX_SAFE_INTEGER)
      expect(resumeResponse?.position).toBeGreaterThan(resumeIntent?.position ?? Number.MAX_SAFE_INTEGER)
      expect(bReport?.position).toBeGreaterThan(resumeResponse?.position ?? Number.MAX_SAFE_INTEGER)
      expect(aStateObservation?.event).toMatchObject({ observation: { report: ds13.terminalReport } })
      expect(aReport?.event).toMatchObject({ ordinal: 2, report: ds13.terminalReport })
      expect(authorization?.event).toMatchObject({
        plannedAttempt: ds12.request.subject.plannedAttempt,
        witness: {
          activeTaskContinuationRead: {
            graphObservationOperationId:
              graphOperationId?.event._tag === "TaskTrackerReadIntentRecorded"
                ? graphOperationId.event.operation.operationId
                : undefined,
            taskClaimObservationOperationId:
              claimOperationId?.event._tag === "TaskTrackerReadIntentRecorded"
                ? claimOperationId.event.operation.operationId
                : undefined,
            taskWorkSpecificationObservationOperationId:
              specificationOperationId?.event._tag === "TaskTrackerReadIntentRecorded"
                ? specificationOperationId.event.operation.operationId
                : undefined
          },
          targetLineageObservationOperationId:
            lineageOperationId?.event._tag === "GitReadIntentRecorded"
              ? lineageOperationId.event.operation.operationId
              : undefined,
          worktreeObservationOperationId:
            worktreeOperationId?.event._tag === "GitReadIntentRecorded"
              ? worktreeOperationId.event.operation.operationId
              : undefined
        }
      })
      expect(resumeIntent?.event).toMatchObject({
        command: "Resume",
        plannedAttempt: ds12.request.subject.plannedAttempt
      })
      expect(resumeResponse?.event).toMatchObject({
        commandOrdinal:
          resumeIntent?.event._tag === "PlannedAttemptExecutorCommandIntended" ? resumeIntent.event.ordinal : undefined,
        plannedAttempt: ds12.request.subject.plannedAttempt,
        report: { _tag: "ExecutorWorkExecuting" }
      })
      expect(bReport?.event).toMatchObject({
        ordinal:
          resumeIntent?.event._tag === "PlannedAttemptExecutorCommandIntended" ? resumeIntent.event.ordinal : undefined,
        report: { _tag: "ExecutorWorkExecuting" }
      })
      expect(ds13.checkpointPublication.actionInputs.runtimeFacts.acceptedAt).toBeGreaterThanOrEqual(
        bReport?.position ?? Number.MAX_SAFE_INTEGER
      )
      expect(held).toEqual([controlledScenario.attempts.B1, controlledScenario.attempts.D1].toSorted())
      expect(occupied).toEqual(held)
      expect(bEvidence).toHaveLength(1)
      expect(cEvidence).toHaveLength(1)
      expect(ePlacement).toMatchObject({ _tag: "EligibleOutsideBound" })
      expect(ds13.activeRefreshCount).toBe(1)
      expect(ds13.activeRefreshDecision).toBeUndefined()
      expect(ds13.applicationBuildCount).toBe(ds12.applicationBuildCount)
      expect(ds13.ordinaryOwnerActivationCount).toBe(ds12.ordinaryOwnerActivationCount)
      expect(ds13.executorObserveCallCount - ds12.executorObserveCallCount).toBeGreaterThanOrEqual(0)
      expect(ds13.executorObserveCallCount - ds12.executorObserveCallCount).toBeLessThanOrEqual(1)
      expect(ds13.integrationQueueActionCount).toBeGreaterThanOrEqual(0)
      expect(ds13.integrationQueueActionCount).toBeLessThanOrEqual(1)
      expect(ds13.after.commands.slice(ds12.after.commands.length)).toEqual([
        { attemptId: controlledScenario.attempts.B1, command: "Resume" }
      ])
      expect(ds13.after.claimRequests).toEqual(ds12.after.claimRequests)
      expect(ds13.after.plans).toEqual(ds12.after.plans)
      expect(ds13.after.worktreeCreateRequests).toEqual(ds12.after.worktreeCreateRequests)
      expect(
        ds13.after.records.filter(
          ({ event }) =>
            event._tag === "TaskAttemptPlanned" &&
            event.operation.plannedAttempt.taskId === controlledScenario.taskIds.B
        )
      ).toHaveLength(1)
      expect(recordSuffix.filter(({ event }) => event._tag === "TaskAttemptPlanned")).toEqual([])
      expect(
        recordSuffix.filter(
          ({ event }) =>
            event._tag === "TaskTrackerReadIntentRecorded" &&
            event.operation._tag === "ReadTrackerGraph" &&
            event.operation.cause._tag === "PostQuiescenceReconfirmation"
        )
      ).toEqual([])
      expect(
        runtime.proposedActions._tag === "DeliveryProposalsAvailable"
          ? runtime.proposedActions.proposals.filter(
              ({ order }) => deliveryProposalOrderTaskId(order) === controlledScenario.taskIds.E
            )
          : []
      ).toEqual([])
    }),
  boundedContinuationTimeout
)

it.effect(
  "retains exact Run attempt claim and resource identities across DS01 through DS13",
  () =>
    Effect.gen(function* () {
      const { ds09, ds13 } = yield* runIssue268Ds13Characterization
      const boundaryCapture = ds09.beforeLoss.snapshot
      const finalRecords = ds13.afterProcessStop.records
      const expectedPlans = [
        {
          attemptId: controlledScenario.attempts.A1,
          baseSha: controlledScenario.baseSha,
          branch: "refs/heads/dalph/issue-268-a-1",
          executor: "executor:issue-268-controlled",
          runId: controlledScenario.runId,
          taskId: controlledScenario.taskIds.A,
          taskRevision: controlledScenario.specifications.F1.A.fingerprint,
          worktree: "/dalph/controlled-characterization/issue-268/A-1"
        },
        {
          attemptId: controlledScenario.attempts.B1,
          baseSha: controlledScenario.baseSha,
          branch: "refs/heads/dalph/issue-268-b-1",
          executor: "executor:issue-268-controlled",
          runId: controlledScenario.runId,
          taskId: controlledScenario.taskIds.B,
          taskRevision: controlledScenario.specifications.F1.B.fingerprint,
          worktree: "/dalph/controlled-characterization/issue-268/B-1"
        },
        {
          attemptId: controlledScenario.attempts.C1,
          baseSha: controlledScenario.baseSha,
          branch: "refs/heads/dalph/issue-268-c-1",
          executor: "executor:issue-268-controlled",
          runId: controlledScenario.runId,
          taskId: controlledScenario.taskIds.C,
          taskRevision: controlledScenario.specifications.F1.C.fingerprint,
          worktree: "/dalph/controlled-characterization/issue-268/C-1"
        },
        {
          attemptId: controlledScenario.attempts.D1,
          baseSha: controlledScenario.baseSha,
          branch: "refs/heads/dalph/issue-268-d-1",
          executor: "executor:issue-268-controlled",
          runId: controlledScenario.runId,
          taskId: controlledScenario.taskIds.D,
          taskRevision: controlledScenario.specifications.F1.D.fingerprint,
          worktree: "/dalph/controlled-characterization/issue-268/D-1"
        }
      ]
      const expectedPlanByAttempt = new Map(expectedPlans.map((plan) => [plan.attemptId, plan]))
      const expectedClaimRequests = [
        { operationOrdinal: 4, taskId: controlledScenario.taskIds.A },
        { operationOrdinal: 5, taskId: controlledScenario.taskIds.B },
        { operationOrdinal: 6, taskId: controlledScenario.taskIds.C },
        { operationOrdinal: 31, taskId: controlledScenario.taskIds.D }
      ].map(({ operationOrdinal, taskId }) => {
        const operationId = `issue-268:${controlledScenario.runId}:startup:${operationOrdinal}`
        return {
          operationId,
          owner: "issue-268-controlled-owner",
          taskId,
          token: `issue-268-controlled-claim:${taskId}:${operationId}`
        }
      })
      const sortPlans = <Plan extends { readonly attemptId: string }>(plans: ReadonlyArray<Plan>) =>
        plans.toSorted((left, right) => left.attemptId.localeCompare(right.attemptId))
      const durablePlans = finalRecords.flatMap(({ event }) =>
        event._tag === "TaskAttemptPlanned" ? [event.operation.plannedAttempt] : []
      )
      const acquiredClaims = finalRecords.flatMap(({ event }) =>
        event._tag === "TaskClaimAcquired" ? [event.claim] : []
      )
      const responsibilities = finalRecords.flatMap(({ event }) =>
        event._tag === "PlannedAttemptExecutorWorkResponsibilityBegan" ? [event.plannedAttempt] : []
      )
      const planBearingExecutorEvents = finalRecords.flatMap(({ event }) => {
        if (
          event._tag === "PlannedAttemptExecutorCommandIntended" ||
          event._tag === "PlannedAttemptExecutorCommandProjectionObserved" ||
          event._tag === "PlannedAttemptExecutorCommandResponseObserved" ||
          event._tag === "PlannedAttemptExecutorCommandResponseContradicted" ||
          event._tag === "PlannedAttemptExecutorStateObserved" ||
          event._tag === "PlannedAttemptContinuationAuthorized"
        ) {
          return [event.plannedAttempt]
        }
        return []
      })
      const executorReports = finalRecords.flatMap(({ event }) =>
        event._tag === "PlannedAttemptExecutorWorkReported" ? [event.report] : []
      )
      const finalEvidence = ds13.checkpointPublication.publication.exactEvidence
      const finalClaimResponsibilities = finalEvidence.flatMap((evidence) =>
        evidence._tag === "ResponsibilityFacts" && evidence.facts.responsibility._tag === "TaskClaimResponsibility"
          ? [evidence.facts.responsibility.acquisition]
          : []
      )
      const finalWorktreePlans = finalEvidence.flatMap((evidence) =>
        evidence._tag === "ResponsibilityFacts" && evidence.facts.responsibility._tag === "TaskWorktreeResponsibility"
          ? [evidence.facts.responsibility.operation.plannedAttempt]
          : []
      )
      const finalExecutorPlans = finalEvidence.flatMap((evidence) =>
        evidence._tag === "ResponsibilityFacts" &&
        evidence.facts.responsibility._tag === "PlannedAttemptExecutorWorkResponsibility"
          ? [evidence.facts.responsibility.plannedAttempt]
          : []
      )
      const finalAcceptedPlans = finalEvidence.flatMap((evidence) =>
        evidence._tag === "AcceptedAwaitingIntegration" ? [evidence.accepted.plannedAttempt] : []
      )
      const finalHeldCorrelations = ds13.checkpointPublication.actionInputs.runtimeFacts.taskWork.held.map(
        ({ correlation }) => correlation
      )
      const finalOccupiedEntries = [...ds13.checkpointPublication.actionInputs.runtimeFacts.taskWork.occupied.entries()]
      const finalOccupiedPlans = finalOccupiedEntries.flatMap(([, position]) =>
        position._tag === "ExactAttemptHeld" ? [position.plannedAttempt] : []
      )

      expect(new Set(finalRecords.map(({ runId }) => runId))).toEqual(new Set([controlledScenario.runId]))
      expect(sortPlans(boundaryCapture.plans)).toEqual(sortPlans(expectedPlans))
      expect(sortPlans(durablePlans)).toEqual(sortPlans(expectedPlans))
      expect(sortPlans(boundaryCapture.worktreeCreateRequests)).toEqual(sortPlans(expectedPlans))
      expect(sortPlans(responsibilities)).toEqual(sortPlans(expectedPlans))

      expect(boundaryCapture.claimRequests).toEqual(expectedClaimRequests)
      expect(acquiredClaims).toEqual(expectedClaimRequests.map((request) => ({ _tag: "ActiveTaskClaim", ...request })))

      for (const expectedPlan of expectedPlans) {
        const worktreeIntent = finalRecords.filter(
          ({ event }) =>
            event._tag === "TaskWorktreeReconciliationIntended" &&
            event.operation.plannedAttempt.attemptId === expectedPlan.attemptId
        )
        expect(worktreeIntent).toHaveLength(1)
        expect(worktreeIntent[0]?.event).toMatchObject({ operation: { plannedAttempt: expectedPlan } })
        const worktreeOperationId = worktreeIntent[0]?.event
        if (worktreeOperationId?._tag !== "TaskWorktreeReconciliationIntended") {
          return expect.fail(`missing exact worktree intent for ${expectedPlan.attemptId}`)
        }
        expect(
          finalRecords.filter(
            ({ event }) =>
              event._tag === "TaskWorktreeReady" && event.operationId === worktreeOperationId.operation.operationId
          )
        ).toEqual([
          expect.objectContaining({
            event: expect.objectContaining({
              proof: {
                _tag: "PlannedWorktreeReady",
                baseSha: expectedPlan.baseSha,
                branch: expectedPlan.branch,
                headSha: expectedPlan.baseSha,
                worktree: expectedPlan.worktree
              }
            })
          })
        ])
      }

      for (const observedPlan of planBearingExecutorEvents) {
        expect(observedPlan).toEqual(expectedPlanByAttempt.get(observedPlan.attemptId))
      }
      for (const report of executorReports) {
        const expectedPlan = expectedPlanByAttempt.get(report.correlation.attemptId)
        expect(expectedPlan).toBeDefined()
        expect(report.correlation).toEqual(
          expectedPlan === undefined ? undefined : { attemptId: expectedPlan.attemptId, runId: expectedPlan.runId }
        )
      }
      expect(finalEvidence).toHaveLength(13)
      expect(finalClaimResponsibilities).toEqual(expectedClaimRequests)
      expect(sortPlans(finalWorktreePlans)).toEqual(sortPlans(expectedPlans))
      expect(sortPlans(finalExecutorPlans)).toEqual(sortPlans(expectedPlans))
      expect(finalAcceptedPlans).toEqual([expectedPlans[0]])
      expect(finalOccupiedEntries).toHaveLength(2)
      expect(finalOccupiedEntries.every(([, position]) => position._tag === "ExactAttemptHeld")).toBe(true)
      expect(finalOccupiedEntries.map(([taskId]) => taskId).toSorted()).toEqual(
        [controlledScenario.taskIds.B, controlledScenario.taskIds.D].toSorted()
      )
      expect(sortPlans(finalOccupiedPlans)).toEqual(
        sortPlans(
          expectedPlans.filter(
            ({ attemptId }) =>
              attemptId === controlledScenario.attempts.B1 || attemptId === controlledScenario.attempts.D1
          )
        )
      )
      expect(finalHeldCorrelations.toSorted((left, right) => left.attemptId.localeCompare(right.attemptId))).toEqual(
        [controlledScenario.attempts.B1, controlledScenario.attempts.D1]
          .map((attemptId) => ({ attemptId, runId: controlledScenario.runId }))
          .toSorted((left, right) => left.attemptId.localeCompare(right.attemptId))
      )
    }),
  boundedContinuationTimeout
)

it.effect(
  "emits the exact DS01 through DS13 delivery checkpoint table",
  () =>
    Effect.gen(function* () {
      const run = yield* runIssue268ControlledDeliveryCassette(
        issue268ControlledDeliveryCassetteCatalog.issue268Ds01ThroughDs13
      )
      expect(run.cassette).toMatchObject({
        acceptedOrderDigest: "ccae78199aa01062521d470c017524e665d0ea3a5bdbf3a9f29030c79440bd4d",
        acceptedSourceSha: "7100fe3af2103bba753e089e8ec78279c5426eb5",
        occurrenceCount: 1_014,
        readinessProfile: "R0ThroughR11",
        schemaVersion: 1,
        stop: "DS13Checkpoint"
      })
      expect(run.consumption).toEqual({ _tag: "AcceptedOccurrenceOrderConsumed", occurrenceCount: 1_014 })
      const { ds09, ds10, ds11, ds12, ds13 } = run.characterization
      const { ds01, ds02, ds03, ds04, ds05, ds06, ds07 } = ds09.beforeLoss
      const ds01Publication = ds01.snapshot.publications.find(
        ({ publication }) => publication.graph._tag === "GraphEstablished"
      )
      if (ds01Publication === undefined) return expect.fail("DS-01 checkpoint lacks its accepted G0 publication")
      const ds01Runtime = yield* evaluateDeliveryRuntimeInputBundle(ds01Publication)
      const ds02Publication = ds02.snapshot.publications.at(lastItemIndex)
      if (ds02Publication === undefined) return expect.fail("DS-02 checkpoint lacks its executing publication")
      const ds04Publication = ds04.after.publications.at(lastItemIndex)
      if (ds04Publication === undefined) return expect.fail("DS-04 checkpoint lacks its suspension publication")
      const ds02Held = ds02Publication.actionInputs.runtimeFacts.taskWork.held
        .map(({ correlation }) => correlation.attemptId)
        .toSorted()
      const expectedStartupAttempts = [
        controlledScenario.attempts.A1,
        controlledScenario.attempts.B1,
        controlledScenario.attempts.C1
      ].toSorted()
      const expectedRestartAttempts = [
        controlledScenario.attempts.A1,
        controlledScenario.attempts.C1,
        controlledScenario.attempts.D1
      ]
      const rows = [
        {
          beat: "DS01",
          assert: () => {
            expect(ds01.pendingClaimTaskIds).toEqual([
              controlledScenario.taskIds.A,
              controlledScenario.taskIds.B,
              controlledScenario.taskIds.C
            ])
            expect(ds01Runtime.current.ticketDeliveries.deliveries.map(({ taskId }) => taskId)).toEqual([
              controlledScenario.taskIds.A,
              controlledScenario.taskIds.B,
              controlledScenario.taskIds.C
            ])
            expect(
              ds01Runtime.current.ticketDeliveries.source.placements.map(({ placement, taskId }) => ({
                placement: placement._tag,
                taskId
              }))
            ).toEqual([
              { placement: "Selected", taskId: controlledScenario.taskIds.A },
              { placement: "Selected", taskId: controlledScenario.taskIds.B },
              { placement: "Selected", taskId: controlledScenario.taskIds.C },
              { placement: "EligibleOutsideBound", taskId: controlledScenario.taskIds.D },
              { placement: "EligibleOutsideBound", taskId: controlledScenario.taskIds.E }
            ])
          }
        },
        {
          beat: "DS02",
          assert: () => {
            expect(ds02Held).toEqual(expectedStartupAttempts)
            expect(ds02.snapshot.claimRequests.map(({ taskId }) => taskId)).toEqual([
              controlledScenario.taskIds.A,
              controlledScenario.taskIds.B,
              controlledScenario.taskIds.C
            ])
            expect(ds02.snapshot.plans.map(({ attemptId }) => attemptId).toSorted()).toEqual(expectedStartupAttempts)
            expect(ds02.snapshot.commands).toEqual(
              expectedStartupAttempts.toSorted().map((attemptId) => ({ attemptId, command: "Begin" }))
            )
          }
        },
        {
          beat: "DS03",
          assert: () => {
            expect(ds03.edit).toEqual({
              graphRevision: controlledScenario.graphs.G1.revision,
              nextFingerprint: controlledScenario.specifications.F2.B.fingerprint,
              priorFingerprint: controlledScenario.specifications.F1.B.fingerprint,
              taskId: controlledScenario.taskIds.B
            })
            expect(ds03.after.commands).toEqual(ds03.before.commands)
            expect(ds03.after.records).toEqual(ds03.before.records)
          }
        },
        {
          beat: "DS04",
          assert: () =>
            expect(
              isIssue268Ds04CompleteCheckpoint(
                ds04Publication,
                ds04.after.records.slice(ds04.beforeTimer.records.length),
                controlledScenario.attempts.B1
              )
            ).toBe(true)
        },
        {
          beat: "DS05",
          assert: () =>
            expect(isIssue268Ds05CompleteCheckpoint(ds05.checkpointPublication, ds05.after.records)).toBe(true)
        },
        {
          beat: "DS06",
          assert: () =>
            expect(isIssue268Ds06CompleteCheckpoint(ds06.checkpointPublication, ds06.after.records)).toBe(true)
        },
        {
          beat: "DS07",
          assert: () => expect(isIssue268Ds07CompleteCheckpoint(ds07.p2Publication, ds07.after.records)).toBe(true)
        },
        {
          beat: "DS08",
          assert: () => {
            expect(ds09.firstProcessInterruptionCount).toBe(1)
            expect(ds09.beforeLoss.ds07.returned.taskExecutionCapacity).toBe(2)
            expect(ds09.projectedReports).toEqual(ds09.beforeLoss.projectedReports)
          }
        },
        {
          beat: "DS09",
          assert: () => {
            expect(ds09.decision).toEqual({ _tag: "RunMustRemainActive", reason: "RunnableTransition" })
            expect(ds09.executorObservations.map(({ correlation }) => correlation.attemptId)).toEqual(
              expectedRestartAttempts
            )
            expect(ds09.after.commands).toEqual([])
          }
        },
        {
          beat: "DS10",
          assert: () =>
            expect(isIssue268Ds10CompleteCheckpoint(ds10.checkpointPublication, ds10.after.records)).toBe(true)
        },
        {
          beat: "DS11",
          assert: () =>
            expect(isIssue268Ds11CompleteCheckpoint(ds11.checkpointPublication, ds11.after.records)).toBe(true)
        },
        {
          beat: "DS12",
          assert: () =>
            expect(isIssue268Ds12CompleteCheckpoint(ds12.checkpointPublication, ds12.after.records)).toBe(true)
        },
        {
          beat: "DS13",
          assert: () =>
            expect(isIssue268Ds13CompleteCheckpoint(ds13.checkpointPublication, ds13.after.records)).toBe(true)
        }
      ] as const

      expect(rows.map(({ beat }) => beat)).toEqual([
        "DS01",
        "DS02",
        "DS03",
        "DS04",
        "DS05",
        "DS06",
        "DS07",
        "DS08",
        "DS09",
        "DS10",
        "DS11",
        "DS12",
        "DS13"
      ])
      for (const row of rows) row.assert()
    }),
  boundedContinuationTimeout
)

it.effect(
  "records the complete cassette-free controlled issue 268 occurrence order",
  () =>
    Effect.gen(function* () {
      const { ds09, ds13, occurrenceEvidence } = yield* runIssue268Ds13Characterization
      const occurrencesOf = (source: (typeof occurrenceEvidence.observedOccurrences)[number]["source"]) =>
        occurrenceEvidence.observedOccurrences.filter((occurrence) => occurrence.source === source)
      const occurrencesWithKind = (kind: string) =>
        occurrenceEvidence.observedOccurrences.filter((occurrence) => occurrence.kind === kind)
      expect(issue268OccurrenceEvidenceIsComplete(occurrenceEvidence)).toBe(true)
      expect(
        issue268OccurrenceEvidenceIsComplete({
          ...occurrenceEvidence,
          observedOccurrences: occurrenceEvidence.observedOccurrences.slice(0, lastItemIndex)
        })
      ).toBe(false)
      const firstOccurrence = occurrenceEvidence.observedOccurrences[0]
      if (firstOccurrence === undefined) return expect.fail("issue 268 occurrence evidence is empty")
      expect(
        issue268OccurrenceEvidenceIsComplete({
          observedOccurrences: [
            { ...firstOccurrence, sourceSequence: firstOccurrence.sourceSequence + 1 },
            ...occurrenceEvidence.observedOccurrences.slice(1)
          ]
        })
      ).toBe(false)
      const lastOccurrence = occurrenceEvidence.observedOccurrences.at(lastItemIndex)
      if (lastOccurrence === undefined) return expect.fail("issue 268 occurrence evidence has no last item")
      expect(
        issue268OccurrenceEvidenceIsComplete({
          observedOccurrences: [
            ...occurrenceEvidence.observedOccurrences,
            {
              ...lastOccurrence,
              ordinal: lastOccurrence.ordinal + 1,
              sourceSequence: lastOccurrence.sourceSequence + 1
            }
          ]
        })
      ).toBe(false)
      const actionOccurrences = occurrencesOf("Action")
      const lastAction = actionOccurrences.at(lastItemIndex)
      if (lastAction === undefined) return expect.fail("issue 268 occurrence evidence has no action")
      expect(
        issue268OccurrenceEvidenceIsComplete({
          observedOccurrences: [
            ...occurrenceEvidence.observedOccurrences,
            {
              detail: "negative-control",
              kind: "UnknownBoundaryOccurrence",
              ordinal: lastOccurrence.ordinal + 1,
              source: "Action",
              sourceSequence: lastAction.sourceSequence + 1
            }
          ]
        })
      ).toBe(false)
      expect(new Set(occurrenceEvidence.observedOccurrences.map(({ source }) => source))).toEqual(
        new Set(["Action", "Control", "Executor", "Git", "Journal", "Publication", "Tracker", "Trace"])
      )
      expect(occurrenceEvidence.observedOccurrences.length).toBeGreaterThan(0)
      expect(occurrenceEvidence.observedOccurrences.at(0)?.ordinal).toBe(1)
      expect(occurrenceEvidence.observedOccurrences.at(lastItemIndex)?.ordinal).toBe(
        occurrenceEvidence.observedOccurrences.length
      )
      expect(
        occurrencesOf("Journal").filter(
          ({ kind }) => kind !== "JournalRecoveryReadCalled" && kind !== "JournalRecoveryReadReturned"
        )
      ).toHaveLength(ds13.after.records.length)
      expect(occurrencesWithKind("JournalRecoveryReadCalled").length).toBeGreaterThan(0)
      expect(occurrencesWithKind("JournalRecoveryReadReturned")).toHaveLength(
        occurrencesWithKind("JournalRecoveryReadCalled").length
      )
      expect(occurrencesWithKind("DeliveryPublicationObserved")).toHaveLength(
        ds09.afterLoss.publications.length + ds13.afterProcessStop.publications.length
      )
      expect(occurrencesOf("Trace")).toHaveLength(ds09.afterLoss.trace.length + ds13.afterProcessStop.trace.length)
      expect(occurrencesWithKind("TaskClaimAcquireCalled")).toHaveLength(
        ds09.afterLoss.claimRequests.length + ds13.afterProcessStop.claimRequests.length
      )
      expect(
        occurrencesWithKind("TrackerGraphReadCalled").length +
          occurrencesWithKind("TaskWorkSpecificationReadCalled").length
      ).toBe(ds13.afterProcessStop.requestedTargets.length)
      expect(occurrencesWithKind("WorktreeCreateCalled")).toHaveLength(
        ds13.afterProcessStop.worktreeCreateRequests.length
      )
      expect(occurrencesWithKind("ExecutorObserveCalled")).toHaveLength(ds13.executorObserveCallCount)
      expect(
        ["ExecutorBeginCalled", "ExecutorSuspendCalled", "ExecutorResumeCalled"].flatMap(occurrencesWithKind)
      ).toHaveLength(ds09.afterLoss.commands.length + ds13.afterProcessStop.commands.length)
      expect(occurrencesOf("Action").length).toBeGreaterThanOrEqual(
        ds09.afterLoss.executedActions.length + ds13.afterProcessStop.executedActions.length
      )
    }),
  boundedContinuationTimeout
)

it.effect(
  "consumes exactly the accepted issue 268 occurrence inventory",
  () =>
    Effect.gen(function* () {
      const run = yield* runIssue268ControlledDeliveryCassette(
        issue268ControlledDeliveryCassetteCatalog.issue268Ds01ThroughDs13
      )
      const actual = run.characterization.occurrenceEvidence.observedOccurrences
      expect(run.cassette).toMatchObject({
        acceptedOrderDigest: "ccae78199aa01062521d470c017524e665d0ea3a5bdbf3a9f29030c79440bd4d",
        acceptedSourceSha: "7100fe3af2103bba753e089e8ec78279c5426eb5",
        occurrenceCount: 1_014,
        readinessProfile: "R0ThroughR11",
        schemaVersion: 1,
        stop: "DS13Checkpoint"
      })
      expect(run.consumption).toEqual({ _tag: "AcceptedOccurrenceOrderConsumed", occurrenceCount: 1_014 })

      const missing = consumeIssue268AcceptedOccurrenceOrder(run.cassette.occurrences, actual.slice(0, -1))
      expect(missing._tag).toBe("OccurrenceOrderMismatch")
      if (missing._tag === "OccurrenceOrderMismatch") {
        expect(missing.mismatch).toMatchObject({ _tag: "UnconsumedExpectedOccurrence", position: 1_014 })
      }

      const finalOccurrence = actual.at(-1)
      if (finalOccurrence === undefined) return expect.fail("accepted issue 268 occurrence inventory is empty")
      const unexpected = consumeIssue268AcceptedOccurrenceOrder(run.cassette.occurrences, [
        ...actual,
        { ...finalOccurrence, ordinal: finalOccurrence.ordinal + 1, sourceSequence: finalOccurrence.sourceSequence + 1 }
      ])
      expect(unexpected._tag).toBe("OccurrenceOrderMismatch")
      if (unexpected._tag === "OccurrenceOrderMismatch") {
        expect(unexpected.mismatch).toMatchObject({ _tag: "UnexpectedOccurrence", position: 1_015 })
      }

      const substituted = actual.map((occurrence, index) =>
        index === 0 ? { ...occurrence, detail: `${occurrence.detail}:substituted` } : occurrence
      )
      const identityMismatch = consumeIssue268AcceptedOccurrenceOrder(run.cassette.occurrences, substituted)
      expect(identityMismatch._tag).toBe("OccurrenceOrderMismatch")
      if (identityMismatch._tag === "OccurrenceOrderMismatch") {
        expect(identityMismatch.mismatch).toMatchObject({ _tag: "DifferentOccurrence", position: 1 })
      }
      const combined = substituted.map((occurrence, index) =>
        index === substituted.length - 1 ? { ...occurrence, ordinal: occurrence.ordinal + 1 } : occurrence
      )
      const firstCombinedMismatch = consumeIssue268AcceptedOccurrenceOrder(run.cassette.occurrences, combined)
      expect(firstCombinedMismatch._tag).toBe("OccurrenceOrderMismatch")
      if (firstCombinedMismatch._tag === "OccurrenceOrderMismatch") {
        expect(firstCombinedMismatch.mismatch).toMatchObject({ _tag: "DifferentOccurrence", position: 1 })
      }

      const swapped = [actual[1], actual[0], ...actual.slice(2)].flatMap((occurrence) =>
        occurrence === undefined ? [] : [occurrence]
      )
      const sourceSequences = new Map<Issue268OccurrenceSource, number>()
      const restamped = swapped.map((occurrence, index) => {
        const sourceSequence = (sourceSequences.get(occurrence.source) ?? 0) + 1
        sourceSequences.set(occurrence.source, sourceSequence)
        return { ...occurrence, ordinal: index + 1, sourceSequence }
      })
      const orderMismatch = consumeIssue268AcceptedOccurrenceOrder(run.cassette.occurrences, restamped)
      expect(orderMismatch._tag).toBe("OccurrenceOrderMismatch")
      if (orderMismatch._tag === "OccurrenceOrderMismatch") {
        expect(orderMismatch.mismatch).toMatchObject({ _tag: "DifferentOccurrence", position: 1 })
      }
    }),
  boundedContinuationTimeout
)

it.skipIf(c4AlreadyRunsOutsideCoverage)(
  "repeats the complete issue 268 cassette twenty times with one identical order",
  async () => {
    const result = await runIssue268C4()
    expect(result).toMatchObject({
      acceptedOrderDigest: "ccae78199aa01062521d470c017524e665d0ea3a5bdbf3a9f29030c79440bd4d",
      iterations: Array.from({ length: 20 }, (_, index) => ({
        acceptedOrderDigest: "ccae78199aa01062521d470c017524e665d0ea3a5bdbf3a9f29030c79440bd4d",
        iteration: index + 1,
        occurrenceCount: 1_014,
        status: "PASS"
      })),
      occurrenceCount: 1_014
    })
  },
  c4RepeatabilityTimeout
)

it.effect(
  "rejects each required issue 268 edge reversal",
  () =>
    Effect.gen(function* () {
      const { occurrenceEvidence } = yield* runIssue268Ds13Characterization
      const observed = occurrenceEvidence.observedOccurrences
      const required = (
        source: Issue268OccurrenceSource,
        kind: string,
        fragments: ReadonlyArray<string> = [],
        after = 0
      ): Issue268ObservedOccurrence => {
        const found = observed.find(
          (occurrence) =>
            occurrence.ordinal > after &&
            occurrence.source === source &&
            occurrence.kind === kind &&
            fragments.every((fragment) => occurrence.detail.includes(fragment))
        )
        if (found === undefined)
          return expect.fail(`missing issue 268 occurrence ${source}:${kind} ${fragments.join(" ")}`)
        return found
      }
      let edges: ReadonlyArray<Issue268RequiredEdge> = []
      let landmarks: ReadonlyArray<Issue268CausalLandmark> = []
      const addEdge = (
        claim: number,
        id: string,
        before: Issue268ObservedOccurrence,
        after: Issue268ObservedOccurrence
      ) => {
        const beforeKey = `${id}:before`
        const afterKey = `${id}:after`
        edges = [...edges, { after: afterKey, before: beforeKey, claim, id }]
        landmarks = [...landmarks, { ...before, key: beforeKey }, { ...after, key: afterKey }]
      }
      const addChain = (claim: number, id: string, chain: ReadonlyArray<Issue268ObservedOccurrence>) => {
        for (let index = 0; index < chain.length - 1; index++) {
          const before = chain[index]
          const after = chain[index + 1]
          if (before === undefined || after === undefined) return expect.fail(`incomplete edge chain ${id}`)
          addEdge(claim, `${id}:${index + 1}`, before, after)
        }
      }
      const journalTask = (kind: string, taskId: string, after = 0) =>
        required("Journal", kind, [`taskId=${taskId}`], after)
      const journalAttempt = (kind: string, attemptId: string, after = 0, extra: ReadonlyArray<string> = []) =>
        required("Journal", kind, [`attemptId=${attemptId}`, ...extra], after)
      const occurrenceAfter = (
        source: Issue268OccurrenceSource,
        kind: string,
        after: Issue268ObservedOccurrence,
        fragments: ReadonlyArray<string> = []
      ) => required(source, kind, fragments, after.ordinal)
      const identityValue = (occurrence: Issue268ObservedOccurrence, key: string) => {
        const value = occurrence.detail
          .split("|")
          .find((part) => part.startsWith(`${key}=`))
          ?.slice(key.length + 1)
        return value === undefined ? expect.fail(`missing ${key} in ${occurrence.kind}`) : value
      }

      const g0Observation = required("Journal", "TaskTrackerFactsObserved", ["contentIdentity=G0"])
      for (const taskId of ["A", "B", "C"]) {
        const eligibility = occurrenceAfter("Publication", "TaskEligibilityPublished", g0Observation, [taskId])
        addEdge(1, `G0-before-${taskId}-eligibility`, g0Observation, eligibility)
      }

      for (const taskId of ["A", "B", "C", "D"]) {
        const intent = journalTask("TaskClaimAcquisitionIntended", taskId)
        const call = occurrenceAfter("Tracker", "TaskClaimAcquireCalled", intent, [`${taskId}:`])
        const returned = occurrenceAfter("Tracker", "TaskClaimAcquireReturned", call, [`${taskId}:`])
        const observation = occurrenceAfter("Journal", "TaskClaimAcquired", returned, [`taskId=${taskId}`])
        addChain(2, `${taskId}-claim`, [intent, call, returned, observation])
      }

      const readyByTask = new Map<string, Issue268ObservedOccurrence>()
      for (const [taskId, attemptId] of [
        ["A", "attempt:A:1"],
        ["B", "attempt:B:1"],
        ["C", "attempt:C:1"],
        ["D", "attempt:D:1"]
      ] as const) {
        const plan = journalAttempt("TaskAttemptPlanned", attemptId)
        const worktreeIntent = journalAttempt("TaskWorktreeReconciliationIntended", attemptId, plan.ordinal)
        const createCall = occurrenceAfter("Git", "WorktreeCreateCalled", worktreeIntent, [`${taskId}:${attemptId}`])
        const createReturn = occurrenceAfter("Git", "WorktreeCreateReturned", createCall, [`${taskId}:${attemptId}`])
        const ready = occurrenceAfter("Journal", "TaskWorktreeReady", createReturn, [
          `operationId=${identityValue(worktreeIntent, "operation.operationId")}`
        ])
        readyByTask.set(taskId, ready)
        addChain(3, `${taskId}-plan-worktree`, [plan, worktreeIntent, createCall, createReturn, ready])
        const beginIntent = journalAttempt("PlannedAttemptExecutorCommandIntended", attemptId, ready.ordinal, [
          "command=Begin"
        ])
        const beginCall = occurrenceAfter("Executor", "ExecutorBeginCalled", beginIntent, [attemptId])
        const beginResponse = journalAttempt(
          "PlannedAttemptExecutorCommandResponseObserved",
          attemptId,
          beginCall.ordinal
        )
        addChain(4, `${taskId}-begin`, [ready, beginIntent, beginCall, beginResponse])
      }

      const f2Edit = required("Control", "AliceTaskSpecificationEditAccepted")
      const g1Observation = occurrenceAfter("Journal", "TaskTrackerFactsObserved", f2Edit, ["contentIdentity=G1"])
      addEdge(5, "F2-before-G1", f2Edit, g1Observation)
      const bSpecification = occurrenceAfter("Journal", "TaskTrackerFactsObserved", g1Observation, [
        "FocusedTaskWorkSpecificationFacts",
        "taskId=B"
      ])
      const bSuspendIntent = journalAttempt("PlannedAttemptExecutorCommandIntended", "attempt:B:1", 0, [
        "command=Suspend"
      ])
      addEdge(6, "G1-before-B-suspend", g1Observation, bSuspendIntent)
      addEdge(6, "B-facts-before-suspend", bSpecification, bSuspendIntent)
      const bSuspendCall = occurrenceAfter("Executor", "ExecutorSuspendCalled", bSuspendIntent, ["attempt:B:1"])
      const bSuspendResponse = journalAttempt(
        "PlannedAttemptExecutorCommandResponseObserved",
        "attempt:B:1",
        bSuspendCall.ordinal
      )
      addChain(7, "B-suspend", [bSuspendIntent, bSuspendCall, bSuspendResponse])
      const bSafe = journalAttempt("PlannedAttemptExecutorWorkReported", "attempt:B:1", bSuspendResponse.ordinal, [
        "ExecutorWorkSafelySuspended"
      ])
      const bRelease = occurrenceAfter("Publication", "TaskWorkPositionReleased", bSafe, ["attempt:B:1"])
      addEdge(8, "B-safe-before-release", bSafe, bRelease)
      const dAdmission = occurrenceAfter("Publication", "TaskWorkPositionAdmissionBound", bRelease, ["D:D:"])
      addEdge(9, "B-release-before-D-admission", bRelease, dAdmission)
      const dReady = readyByTask.get("D")
      if (dReady === undefined) return expect.fail("missing D ready occurrence")
      const dBegin = occurrenceAfter("Executor", "ExecutorBeginCalled", dReady, ["attempt:D:1"])
      addEdge(10, "D-worktree-before-begin", dReady, dBegin)

      const processLoss = required("Control", "CoordinatorProcessLoss")
      const reconstruction = occurrenceAfter("Journal", "JournalRecoveryReadReturned", processLoss)
      const passiveAttemptIds = ["attempt:A:1", "attempt:C:1", "attempt:D:1"]
      const passiveCalls = passiveAttemptIds.map((attemptId) =>
        occurrenceAfter("Executor", "ExecutorObserveCalled", reconstruction, [attemptId])
      )
      for (const [index, passiveCall] of passiveCalls.entries()) {
        addEdge(11, `reconstruction-before-passive-${index + 1}`, reconstruction, passiveCall)
      }
      const passiveReturns = passiveCalls.map((call, index) =>
        occurrenceAfter("Executor", "ExecutorObserveReturned", call, [passiveAttemptIds[index] ?? "missing-attempt"])
      )
      const activationReturn = occurrenceAfter(
        "Control",
        "OrdinaryActivationReturned",
        passiveReturns.at(-1) ?? reconstruction
      )
      for (const [index, passiveReturn] of passiveReturns.entries()) {
        addEdge(12, `passive-before-return-${index + 1}`, passiveReturn, activationReturn)
      }
      const activeRefresh = occurrenceAfter("Control", "ActiveRefreshStarted", activationReturn)
      addEdge(12, "return-before-later-refresh", activationReturn, activeRefresh)

      const cClose = required("Control", "AliceTaskClosure")
      const g2ReadReturn = occurrenceAfter("Tracker", "TrackerGraphReadReturned", cClose, ["G2"])
      addEdge(13, "C-close-before-G2", cClose, g2ReadReturn)
      const g2Observation = occurrenceAfter("Journal", "TaskTrackerFactsObserved", g2ReadReturn, ["contentIdentity=G2"])
      const cSuspendIntent = journalAttempt(
        "PlannedAttemptExecutorCommandIntended",
        "attempt:C:1",
        g2Observation.ordinal,
        ["command=Suspend"]
      )
      const cSuspendCall = occurrenceAfter("Executor", "ExecutorSuspendCalled", cSuspendIntent, ["attempt:C:1"])
      addChain(14, "G2-C-suspend", [g2Observation, cSuspendIntent, cSuspendCall])
      const cSafe = journalAttempt("PlannedAttemptExecutorWorkReported", "attempt:C:1", cSuspendCall.ordinal, [
        "ExecutorWorkSafelySuspended"
      ])
      const cRelease = occurrenceAfter("Publication", "TaskWorkPositionReleased", cSafe, ["attempt:C:1"])
      addEdge(15, "C-safe-before-release", cSafe, cRelease)

      const continueReturn = required("Control", "OperatorContinueReturned")
      const bResumeResponsibility = occurrenceAfter("Publication", "B1ResumeResponsibilityPublished", continueReturn, [
        "attempt:B:1"
      ])
      addEdge(16, "continue-before-resume-responsibility", continueReturn, bResumeResponsibility)
      for (const [id, fact] of [
        ["graph", occurrenceAfter("Tracker", "TrackerGraphReadReturned", continueReturn, ["G2"])],
        ["specification", occurrenceAfter("Tracker", "TaskWorkSpecificationReadReturned", continueReturn, ["B:"])],
        ["claim", occurrenceAfter("Tracker", "TaskClaimReadReturned", continueReturn, ["B:"])],
        ["worktree", occurrenceAfter("Git", "WorktreeReadReturned", continueReturn, ["B:attempt:B:1"])],
        ["lineage", occurrenceAfter("Git", "TargetLineageReadReturned", continueReturn)]
      ] as const) {
        addEdge(16, `${id}-before-resume-responsibility`, fact, bResumeResponsibility)
      }
      const aTerminal = journalAttempt("PlannedAttemptExecutorWorkReported", "attempt:A:1", 0, ["Accepted"])
      const aRelease = occurrenceAfter("Publication", "TaskWorkPositionReleased", aTerminal, ["attempt:A:1"])
      addEdge(17, "A-terminal-before-release", aTerminal, aRelease)
      const bBinding = occurrenceAfter("Publication", "TaskWorkPositionAdmissionBound", aRelease, [
        "B:B:ReserveOrReuse:ResumePlannedAttemptExecutorWorkAfterCurrentFacts"
      ])
      const resumeIntent = journalAttempt("PlannedAttemptExecutorCommandIntended", "attempt:B:1", bBinding.ordinal, [
        "command=Resume"
      ])
      const resumeCall = occurrenceAfter("Executor", "ExecutorResumeCalled", resumeIntent, ["attempt:B:1"])
      addEdge(18, "A-release-before-B-binding", aRelease, bBinding)
      addEdge(18, "A-release-before-B-resume-intent", aRelease, resumeIntent)
      addEdge(18, "A-release-before-B-resume-call", aRelease, resumeCall)

      const cSuspendActionReturned = occurrenceAfter("Action", "DeliveryActionReturned", cSuspendCall, ["C"])
      const quiescence = occurrenceAfter("Control", "PostQuiescenceWitnessObserved", cSuspendActionReturned)
      addChain(19, "refresh-work-quiescence", [activeRefresh, cSuspendActionReturned, quiescence])
      const quiescenceIntent = occurrenceAfter("Journal", "TaskTrackerReadIntentRecorded", quiescence, [
        "PostQuiescenceReconfirmation"
      ])
      addEdge(20, "quiescence-before-reconfirmation", quiescence, quiescenceIntent)

      const orderedLandmarks = landmarks.toSorted((left, right) => left.ordinal - right.ordinal)
      expect(edges).toHaveLength(75)
      const expectedClaimCardinalities = [3, 12, 16, 12, 1, 2, 2, 1, 1, 1, 3, 4, 1, 2, 1, 6, 1, 3, 2, 1]
      expect(
        expectedClaimCardinalities.every(
          (expected, index) => edges.filter(({ claim }) => claim === index + 1).length === expected
        )
      ).toBe(true)
      expect(issue268RequiredClaimCoverageIsComplete(edges)).toBe(true)
      expect(validateIssue268RequiredEdges(orderedLandmarks, edges)).toEqual([])
      for (const edge of edges) {
        const reversed = reverseIssue268RequiredEdge(orderedLandmarks, edge)
        expect(validateIssue268RequiredEdges(reversed, [edge])).toEqual([{ edge, reason: "AfterNotAfterBefore" }])
      }
    }),
  boundedContinuationTimeout
)

it.effect(
  "consumes a staggered graph while restart-added X waits for recovered capacity",
  () =>
    Effect.gen(function* () {
      const run = yield* cachedRun
      const established = run.deliveryFrames.filter(({ graph }) => graph._tag === "Established")
      const completeTopology = established.find(
        ({ graph }) => graph._tag === "Established" && graph.tasks.length === 10
      )
      const edges =
        completeTopology?.graph._tag === "Established"
          ? completeTopology.graph.tasks.flatMap(({ id, prerequisiteIds }) =>
              prerequisiteIds.map((prerequisiteId) => `${prerequisiteId}->${id}`)
            )
          : []
      const heldSets = run.deliveryFrames.map(({ heldPositions }) =>
        heldPositions
          .map(({ taskId }) => taskId)
          .toSorted()
          .join("+")
      )
      const eligibleSets = established.map(({ frontier }) =>
        frontier
          .filter(({ standing }) => standing === "Eligible")
          .map(({ taskId }) => taskId)
          .toSorted()
          .join("+")
      )
      const expectedFrontiers = ["A", "B+C", "B+C+X", "D+X", "E+F", "H+I", "G", ""]
      let previousFrontier = lastItemIndex
      const frontierPositions = expectedFrontiers.map((frontier) => {
        previousFrontier = eligibleSets.indexOf(frontier, previousFrontier + 1)
        return previousFrontier
      })
      const expectedOverlaps = ["B+C", "C", "X", "D", "E+F", "F", "H+I", "I", "G"]
      let previousOverlap = lastItemIndex
      const overlapPositions = expectedOverlaps.map((overlap) => {
        previousOverlap = heldSets.indexOf(overlap, previousOverlap + 1)
        return previousOverlap
      })
      const taskByAttempt = new Map(
        run.records.flatMap(({ event }) =>
          event._tag === "PlannedAttemptExecutorWorkResponsibilityBegan"
            ? [[event.plannedAttempt.attemptId, event.plannedAttempt.taskId] as const]
            : []
        )
      )
      const taskWork = run.records.flatMap(({ event }) =>
        event._tag === "PlannedAttemptExecutorWorkResponsibilityBegan"
          ? [`began:${event.plannedAttempt.taskId}`]
          : event._tag === "PlannedAttemptExecutorWorkReported" && event.report._tag === "ExecutorWorkTerminal"
            ? [`terminal:${taskByAttempt.get(event.report.correlation.attemptId)}`]
            : []
      )
      const taskIds = ["A", "B", "C", "D", "E", "F", "G", "H", "I", "X"]
      const expectedExecutionOrder = ["A", "B", "C", "X", "D", "E", "F", "H", "I", "G"]
      const currentTaskGraphReads = run.records.flatMap(({ event }) =>
        event._tag === "TaskTrackerReadIntentRecorded" &&
        event.operation._tag === "ReadTrackerGraph" &&
        event.operation.cause._tag === "WorkflowEstablishment" &&
        event.operation.predecessorOperationIds.length === 0 &&
        event.operation.readShape.explicitlyCoveredTaskIds.length === 1
          ? event.operation.readShape.explicitlyCoveredTaskIds
          : []
      )
      const claimIntents = run.records.flatMap(({ event }) =>
        event._tag === "TaskClaimAcquisitionIntended" ? [event.operation.acquisition.taskId] : []
      )

      expect(completeTopology).toBeDefined()
      expect(edges.toSorted()).toEqual([
        "A->B",
        "A->C",
        "A->X",
        "B->D",
        "C->D",
        "D->E",
        "D->F",
        "E->H",
        "F->I",
        "H->G",
        "I->G",
        "X->G"
      ])
      expect(completeTopology?.frontier).toHaveLength(10)
      expect(overlapPositions.every((position) => position >= 0)).toBe(true)
      expect(frontierPositions.every((position) => position >= 0)).toBe(true)
      expect(
        run.deliveryFrames.every(({ capacity, heldPositions }) => capacity === 2 && heldPositions.length <= 2)
      ).toBe(true)
      expect(taskWork.toSorted()).toEqual(
        taskIds.flatMap((taskId) => [`began:${taskId}`, `terminal:${taskId}`]).toSorted()
      )
      expect(currentTaskGraphReads).toEqual(expectedExecutionOrder)
      expect(claimIntents).toEqual(expectedExecutionOrder)
      const aSettledAt = run.records.findIndex(
        ({ event }) => event._tag === "IntegrationFinalitySettled" && event.claim.plannedAttempt.taskId === "A"
      )
      const bBeganAt = run.records.findIndex(
        ({ event }) =>
          event._tag === "PlannedAttemptExecutorWorkResponsibilityBegan" && event.plannedAttempt.taskId === "B"
      )
      expect(aSettledAt).toBeGreaterThanOrEqual(0)
      expect(bBeganAt).toBeGreaterThan(aSettledAt)
      expect(
        run.records.flatMap(({ event }) =>
          event._tag === "IntegrationFinalitySettled" ? [event.claim.plannedAttempt.taskId] : []
        )
      ).toEqual(["A", "B", "C", "X", "D", "E", "F", "H", "I", "G"])
      expect(
        run.records.some(
          ({ event }) =>
            event._tag === "PlannedAttemptExecutorWorkReported" &&
            event.report._tag === "ExecutorWorkTerminal" &&
            event.report.result._tag === "Completed"
        )
      ).toBe(false)
      expect(run.records.at(lastItemIndex)?.event._tag).toBe("WorkflowRunTerminated")
      expect(run.deliveryFrames.at(lastItemIndex)?.heldPositions).toEqual([])
      expect(run.cassette.story.at(lastItemIndex)?._tag).toBe("ExpectedBehavior")
    }),
  capstoneTimeout
)

it.effect(
  "preserves the double-diamond middle positions across coordinator restart",
  () =>
    Effect.gen(function* () {
      const run = yield* cachedRun
      const initial = run.deliveryFrames.find(
        ({ heldPositions }) =>
          heldPositions.some(({ taskId }) => taskId === "B") && heldPositions.some(({ taskId }) => taskId === "C")
      )
      const later = run.deliveryFrames.find(
        ({ activationOrdinal }) => initial !== undefined && activationOrdinal > initial.activationOrdinal
      )
      const correlations = (frame: NonNullable<typeof initial>) =>
        frame.heldPositions
          .filter(({ taskId }) => taskId === "B" || taskId === "C")
          .map(({ attemptId, runId, taskId }) => `${taskId}:${runId}:${attemptId}`)
          .toSorted()

      expect(initial).toBeDefined()
      expect(later).toBeDefined()
      if (initial === undefined || later === undefined) return
      expect(later.heldPositions.map(({ taskId }) => taskId).toSorted()).toEqual(["B", "C"])
      expect(correlations(later)).toEqual(correlations(initial))
      const xObservedWithBothPositions = run.deliveryFrames.findIndex(
        ({ graph, heldPositions }) =>
          graph._tag === "Established" &&
          graph.tasks.some(({ id }) => id === "X") &&
          ["B", "C"].every((taskId) => heldPositions.some((position) => position.taskId === taskId))
      )
      const xHeld = run.deliveryFrames.findIndex(({ heldPositions }) =>
        heldPositions.some(({ taskId }) => taskId === "X")
      )
      expect(xObservedWithBothPositions).toBeGreaterThanOrEqual(0)
      expect(xHeld).toBeGreaterThan(xObservedWithBothPositions)
      expect(run.deliveryFrames[xHeld]?.heldPositions.some(({ taskId }) => taskId === "B" || taskId === "C")).toBe(
        false
      )
    }),
  capstoneTimeout
)
