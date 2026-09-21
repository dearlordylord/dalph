import { makeTaskWorkSpecification } from "@dalph/contracts"
import { NodeCrypto } from "@effect/platform-node"
import { it } from "@effect/vitest"
import { Context, Effect, Layer, Ref } from "effect"
import { expect } from "vitest"
import {
  CompletionTaskAcknowledgedEvent,
  CompletionTaskAcknowledgement,
  CompletionTaskAttemptIntendedEvent,
  CompletionTaskAuthorization,
  CompletionTaskAuthorizationReadOrdinal,
  CompletionTaskFocusedReadPurpose,
  CompletionTaskIntendedEvent,
  CompletionTaskRequestLookup,
  CompletionTaskRequestOrdinal,
  InRunJournal,
  JournalPosition,
  type JournalRecord,
  TargetPromotionGit,
  TrackerRevision,
  describeJournalEvent,
  makeCompletionTaskFactsObservationOperation,
  reduceWorkflowJournalHistory,
  taskTrackerReadIntent,
  workflowJournalEventVersion
} from "@dalph/orchestrator"
import { journalLayer } from "../../../orchestrator/src/coordination/delivery/journal.js"
import { integrationFinalityFixture } from "../../../orchestrator/src/workflow/protocols/integration-finality/fixtures.js"
import { completionTaskCandidateAncestryReadOperationIdFor } from "../../../orchestrator/src/workflow/protocols/integration-finality/completion-task-operation-identity.js"
import {
  CompletionTaskAttemptAuthorization,
  runCompletionTaskProtocol
} from "../../../orchestrator/src/workflow/protocols/integration-finality/completion-task-protocol.js"
import {
  CompletionTaskCandidateAncestryObservedEvent,
  CompletionTaskCandidateAncestryReadIntendedEvent,
  type CompletionTaskBoundaryService
} from "../../../orchestrator/src/workflow/protocols/integration-finality/events.js"
import { integratorCorrelationFor } from "../../../orchestrator/src/workflow/protocols/integrator/session.js"
import {
  makeFocusedTaskCompletionFactsObserved,
  taskTrackerFactsObservedEvent
} from "../../../orchestrator/src/workflow/task-tracker-facts/observation.js"
import { makeAcceptedIntegrationHistory } from "../../../orchestrator/test/support/accepted-integration-history.js"
import { makePromotedIntegrationHistory } from "../../../orchestrator/test/support/promoted-integration-history.js"
import { maintainedAuthoredCassetteCatalog, runAuthoredScenarioCassette } from "../../src/cassettes/index.js"
import {
  expectedRecoveryPrefix,
  type RecoveryPrefix,
  recoveryPrefixMismatch,
  replayRecoveryPrefix,
  type RecoveryStoreLane,
  withRecoveryPrefixStore
} from "./recovery-store-lanes.js"
import {
  trackerCompletionRecoveryPrefixes,
  trackerCompletionRecoveryTrace
} from "./tracker-completion-recovery-trace.js"

const lanes: ReadonlyArray<RecoveryStoreLane> = ["memory", "sqlite"]

const maintainedCompletionRun = () =>
  runAuthoredScenarioCassette(maintainedAuthoredCassetteCatalog[trackerCompletionRecoveryTrace.cassetteKey]).pipe(
    Effect.provide(NodeCrypto.layer)
  )

it.effect("reopens every tracker-completion cut through memory and SQLite with the same projection", () =>
  Effect.gen(function* () {
    const source = yield* maintainedCompletionRun()
    const prefixes = trackerCompletionRecoveryPrefixes(source.records)
    expect(prefixes).toHaveLength(7)
    if (prefixes.length !== 7) return yield* Effect.die("maintained completion cassette lacks P0-P6 endpoints")

    const executions = yield* Effect.forEach(prefixes, (prefix) =>
      Effect.gen(function* () {
        const expected = yield* expectedRecoveryPrefix(prefix)
        expect(expected.historyTag, `${prefix.cut} must be a legal retained history`).toBe(
          "ValidWorkflowJournalHistory"
        )
        return yield* Effect.forEach(lanes, (lane) =>
          Effect.gen(function* () {
            const actual = yield* replayRecoveryPrefix(prefix, lane)
            const mismatch = recoveryPrefixMismatch(prefix.cut, lane, expected, actual)
            expect(mismatch, `${prefix.cut} / ${lane} (${prefix.endpoint})`).toBeUndefined()
            return { cut: prefix.cut, lane }
          })
        )
      })
    )

    expect(executions.flat()).toHaveLength(trackerCompletionRecoveryTrace.executionCount)
  })
)

it.effect("rejects a recovery cut whose retained prefix or expected projection is inconsistent", () =>
  Effect.gen(function* () {
    const source = yield* maintainedCompletionRun()
    const prefixes = trackerCompletionRecoveryPrefixes(source.records)
    expect(prefixes).toHaveLength(7)
    if (prefixes.length !== 7) return yield* Effect.die("maintained completion cassette lacks P0-P6 endpoints")

    const prefix = prefixes[4]
    if (prefix === undefined) return yield* Effect.die("P4 completion prefix is missing")
    const expected = yield* expectedRecoveryPrefix(prefix)
    const actual = yield* replayRecoveryPrefix(prefix, "sqlite")
    const inconsistent = { ...actual, decodedRecords: actual.decodedRecords.slice(1) }

    expect(recoveryPrefixMismatch("P4", "sqlite", expected, inconsistent)).toBe(
      "recovery prefix P4 / sqlite: canonical decoded history differs"
    )
  })
)

const source = integrationFinalityFixture
const specification = makeTaskWorkSpecification({
  body: "Recover task completion after every initial finality cut.",
  taskId: source.taskId,
  title: "Recover task completion"
})
const accepted = makeAcceptedIntegrationHistory({
  acceptedResult: source.qualifiedCandidate.run.session.acceptedResult,
  activeClaim: source.activeClaim,
  integrationTarget: source.integrationTarget,
  plannedAttempt: { ...source.plannedAttempt, taskRevision: specification.fingerprint },
  runId: source.runId,
  targetHeadSha: source.qualifiedCandidate.run.session.expectedTargetHead,
  taskSpecification: specification,
  trackerTarget: source.target
})
const promoted = makePromotedIntegrationHistory({
  candidateCommit: source.qualifiedCandidate.candidateCommit,
  candidateText: source.qualifiedCandidate.candidateText,
  originalClaim: accepted.activeClaim,
  records: accepted.records,
  session: integratorCorrelationFor(accepted)
})
const request = promoted.completionRequest
const runId = request.claim.plannedAttempt.runId

const appendRecord = (
  records: ReadonlyArray<JournalRecord>,
  event: JournalRecord["event"]
): ReadonlyArray<JournalRecord> => [
  ...records,
  { event, key: describeJournalEvent(event).expectedKey, position: JournalPosition.make(records.length + 1), runId }
]

const authorizationEvents = (
  ordinal: CompletionTaskRequestOrdinal,
  authorizationOrdinal: CompletionTaskAuthorizationReadOrdinal
) => {
  const purpose = CompletionTaskFocusedReadPurpose.cases.Authorization.make({
    attemptOrdinal: ordinal,
    authorizationOrdinal
  })
  const operation = makeCompletionTaskFactsObservationOperation(request, source.target, purpose)
  const facts = {
    currentClaim: request.claim,
    lifecycle: "Open" as const,
    operationId: operation.operationId,
    target: source.target,
    targetMembership: "Member" as const,
    taskId: request.taskId,
    taskRevision: request.taskRevision,
    trackerRevision: TrackerRevision.make(`completion-recovery-${Number(ordinal)}-${Number(authorizationOrdinal)}`),
    unfinishedPrerequisiteTaskIds: []
  }
  const gitReadOperationId = completionTaskCandidateAncestryReadOperationIdFor(request, purpose)
  const events = [
    taskTrackerReadIntent(operation),
    taskTrackerFactsObservedEvent(operation.operationId, makeFocusedTaskCompletionFactsObserved(operation, facts)),
    CompletionTaskCandidateAncestryReadIntendedEvent.make({
      attemptOrdinal: ordinal,
      operationId: gitReadOperationId,
      request,
      version: workflowJournalEventVersion
    }),
    CompletionTaskCandidateAncestryObservedEvent.make({
      attemptOrdinal: ordinal,
      observation: {
        _tag: "CandidateCurrent",
        currentHeadSha: request.claim.promotionCorrelation.qualifiedCandidate.candidateCommit
      },
      operationId: gitReadOperationId,
      request,
      version: workflowJournalEventVersion
    })
  ] as const
  return {
    authorization: CompletionTaskAuthorization.make({
      candidateAncestry: "Current",
      focusedFacts: facts,
      gitReadOperationId,
      target: source.target
    }),
    events
  }
}

const appendAuthorization = Effect.fn("CompletionTaskRecovery.appendAuthorization")(function* (
  journal: InRunJournal["Service"],
  ordinal: CompletionTaskRequestOrdinal
) {
  const current = yield* journal.read(runId)
  const authorizationOrdinal = CompletionTaskAuthorizationReadOrdinal.make(
    current.filter(
      ({ event }) =>
        event._tag === "TaskTrackerReadIntentRecorded" &&
        event.operation._tag === "ReadCompletionTaskFacts" &&
        event.operation.request.operationId === request.operationId &&
        event.operation.purpose._tag === "Authorization" &&
        event.operation.purpose.attemptOrdinal === ordinal
    ).length + 1
  )
  const authored = authorizationEvents(ordinal, authorizationOrdinal)
  for (const event of authored.events) {
    yield* journal.append(runId, describeJournalEvent(event).expectedKey, event)
  }
  return CompletionTaskAttemptAuthorization.cases.ReadyToComplete.make({ authorization: authored.authorization })
})

const firstOrdinal = CompletionTaskRequestOrdinal.make(1)
const firstAuthorization = authorizationEvents(firstOrdinal, CompletionTaskAuthorizationReadOrdinal.make(1))
const authorized = firstAuthorization.events.reduce(appendRecord, promoted.replacedRecords)
const intended = appendRecord(
  authorized,
  CompletionTaskIntendedEvent.make({ request, version: workflowJournalEventVersion })
)
const attempted = appendRecord(
  intended,
  CompletionTaskAttemptIntendedEvent.make({
    attemptOrdinal: firstOrdinal,
    focusedFactsOperationId: firstAuthorization.authorization.focusedFacts.operationId,
    gitReadOperationId: firstAuthorization.authorization.gitReadOperationId,
    request,
    version: workflowJournalEventVersion
  })
)
const acknowledged = appendRecord(
  attempted,
  CompletionTaskAcknowledgedEvent.make({
    acknowledgement: CompletionTaskAcknowledgement.make({ operationId: request.operationId, taskId: request.taskId }),
    attemptOrdinal: firstOrdinal,
    request,
    version: workflowJournalEventVersion
  })
)

const prefix = <Cut extends string>(
  cut: Cut,
  endpoint: string,
  records: ReadonlyArray<JournalRecord>
): RecoveryPrefix<Cut> => {
  const beginning = records[0]
  return beginning === undefined
    ? expect.fail("completion recovery prefix lost WorkflowRunBegan")
    : { cut, endpoint, records: [beginning, ...records.slice(1)] }
}

it.effect(
  "recovers task-close intent, lost response, acknowledgement loss, and stopped sender cuts through both stores",
  () =>
    Effect.gen(function* () {
      const scenarios = [
        {
          completionCalls: 1,
          focusedLifecycle: "Open",
          focusedOutcome: false,
          label: "durable completion intent",
          lookupCalls: 0,
          prefix: prefix("CompletionIntent", "CompletionTaskIntended", intended)
        },
        {
          completionCalls: 0,
          focusedLifecycle: "CompletedSuccessfully",
          focusedOutcome: true,
          label: "applied completion response lost",
          lookupCalls: 0,
          prefix: prefix("CompletionAppliedResponseLost", "CompletionTaskAttemptIntended", attempted)
        },
        {
          completionCalls: 1,
          focusedLifecycle: "Open",
          focusedOutcome: false,
          label: "stopped unapplied completion sender",
          lookupCalls: 1,
          prefix: prefix("CompletionUnappliedResponseLost", "CompletionTaskAttemptIntended", attempted)
        },
        {
          completionCalls: 0,
          focusedLifecycle: "Open",
          focusedOutcome: false,
          label: "completion acknowledgement lost",
          lookupCalls: 0,
          prefix: prefix("CompletionAcknowledged", "CompletionTaskAcknowledged", acknowledged)
        }
      ] as const
      yield* Effect.forEach(
        scenarios,
        (scenario) =>
          Effect.forEach(
            lanes,
            (lane) =>
              withRecoveryPrefixStore(scenario.prefix, lane, (storage) =>
                Effect.scoped(
                  Effect.gen(function* () {
                    const retained = yield* storage.read(runId)
                    const history = reduceWorkflowJournalHistory(runId, retained)
                    if (history._tag === "InvalidWorkflowJournalHistory") return yield* Effect.die(history)
                    const context = yield* Layer.build(journalLayer(runId, source.target, history, storage))
                    const journal = Context.get(context, InRunJournal)
                    const completionCalls = yield* Ref.make(0)
                    const lookupCalls = yield* Ref.make(0)
                    const publicationReads = yield* Ref.make(0)
                    const boundary: CompletionTaskBoundaryService = {
                      completeTask: (received) =>
                        Ref.update(completionCalls, (count) => count + 1).pipe(
                          Effect.as(
                            CompletionTaskAcknowledgement.make({
                              operationId: received.operationId,
                              taskId: received.taskId
                            })
                          )
                        ),
                      readCompletionRequest: (received) =>
                        Ref.update(lookupCalls, (count) => count + 1).pipe(
                          Effect.as(CompletionTaskRequestLookup.cases.NotApplied.make({ request: received }))
                        ),
                      readFocusedTaskCompletion: ({ operationId }) =>
                        Effect.succeed({
                          ...firstAuthorization.authorization.focusedFacts,
                          lifecycle: scenario.focusedLifecycle,
                          operationId
                        })
                    }
                    const outcome = yield* runCompletionTaskProtocol(boundary, request, source.target, (ordinal) =>
                      appendAuthorization(journal, ordinal).pipe(Effect.orDie)
                    ).pipe(
                      Effect.provide(context),
                      Effect.provideService(
                        TargetPromotionGit,
                        TargetPromotionGit.of({
                          compareAndSet: () => Effect.die("completion recovery must not mutate Git"),
                          read: () =>
                            Ref.update(publicationReads, (count) => count + 1).pipe(
                              Effect.andThen(Effect.die("completion recovery must reuse durable publication proof"))
                            )
                        })
                      )
                    )
                    expect(outcome, scenario.label + " / " + lane).toMatchObject(
                      scenario.focusedOutcome
                        ? { _tag: "FocusedCompletedTaskObservation", claim: request.claim, taskId: request.taskId }
                        : { operationId: request.operationId, taskId: request.taskId }
                    )
                    expect(yield* Ref.get(completionCalls), scenario.label + " / " + lane).toBe(
                      scenario.completionCalls
                    )
                    expect(yield* Ref.get(lookupCalls), scenario.label + " / " + lane).toBe(scenario.lookupCalls)
                    expect(yield* Ref.get(publicationReads), scenario.label + " / " + lane).toBe(0)
                    const recovered = yield* storage.read(runId)
                    expect(
                      recovered.filter(({ event }) => event._tag === "RemotePublicationSucceeded"),
                      scenario.label + " / " + lane
                    ).toHaveLength(1)
                  })
                )
              ),
            { concurrency: 1 }
          ),
        { concurrency: 1 }
      )
    }),
  120_000
)
