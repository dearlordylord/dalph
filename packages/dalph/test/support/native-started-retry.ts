/* eslint-disable import/no-nodejs-modules -- Native qualification observes the disposable Git boundary. */
import { Effect, ManagedRuntime } from "effect"
import { expect } from "vitest"
import { ActiveTaskClaim } from "../../../orchestrator/src/authorities/task-tracker/claim-mutation.js"
import { ClaimOwner, ClaimToken } from "../../../orchestrator/src/authorities/task-tracker/claim.js"
import { FixtureTarget } from "../../../orchestrator/src/authorities/task-tracker/fixture/target.js"
import { makeAcceptedIntegrationHistory } from "../../../orchestrator/test/support/accepted-integration-history.js"
import { liveJournalTestLayer } from "../../../orchestrator/src/coordination/delivery/live-journal-test-layer.js"
import { OperationId } from "../../../orchestrator/src/workflow/identity.js"
import { workflowJournalEventVersion } from "../../../orchestrator/src/workflow/kernel/event.js"
import {
  GitReadIntentRecordedEvent,
  TargetLineageObservedEvent
} from "../../../orchestrator/src/workflow/registry/event.js"
import { makeTargetLineageObservationOperation } from "../../../orchestrator/src/workflow/registry/operation.js"
import { intentRecordKey, outcomeRecordKey } from "../../../orchestrator/src/workflow-journal/record-key.js"
import { InRunJournal, JournalStore } from "../../../orchestrator/src/workflow-journal/store.js"
import {
  Integrator,
  IntegratorCallFailure,
  IntegratorGit,
  prepareIntegrationCandidateRun
} from "../../../orchestrator/src/workflow/protocols/integrator/protocol.js"
import {
  IntegratorRunOrdinal,
  IntegratorGitObservation,
  type IntegratorRequest,
  type IntegratorResult,
  type IntegratorSessionCorrelation
} from "../../../orchestrator/src/workflow/protocols/integrator/events.js"
import {
  integratorCorrelationFor,
  integratorRunCorrelationForSession
} from "../../../orchestrator/src/workflow/protocols/integrator/session.js"
import { appendInitialConclusiveIntegrationQuarantine } from "../../../orchestrator/src/workflow/protocols/integration-quarantine/initial-conclusive.js"
import { makeIntegrationQuarantineDirectionControl } from "../../../orchestrator/src/workflow/protocols/integration-quarantine/control.js"
import {
  IntegrationQuarantineDirectionFingerprint,
  IntegrationQuarantineDirectionRequestId
} from "../../../orchestrator/src/workflow/protocols/integration-quarantine/events.js"
import { GitCommitSha, makeTaskWorkSpecification } from "@dalph/contracts"

const retryOrdinal = 2

/** Uses the live accepted-journal owner and production protocol around the native provider. */
export const makeNativeStartedRetryFixture = (input: {
  readonly session: IntegratorSessionCorrelation
  readonly prepare: (request: IntegratorRequest) => Promise<IntegratorResult>
  readonly git: (...args: ReadonlyArray<string>) => Promise<string>
  readonly afterUncertainResponse: () => Promise<void>
}) => {
  const specification = makeTaskWorkSpecification({
    body: "Native Started Retry qualification",
    title: "Started Retry",
    taskId: input.session.plannedAttempt.taskId
  })
  const plannedAttempt = { ...input.session.plannedAttempt, taskRevision: specification.fingerprint }
  const runId = plannedAttempt.runId
  const target = FixtureTarget.make("native-started-retry")
  const history = makeAcceptedIntegrationHistory({
    acceptedResult: input.session.acceptedResult,
    activeClaim: ActiveTaskClaim.make({
      operationId: OperationId.make("native-claim"),
      owner: ClaimOwner.make("native-owner"),
      taskId: plannedAttempt.taskId,
      token: ClaimToken.make("native-claim-token")
    }),
    integrationTarget: input.session.integrationTarget,
    plannedAttempt,
    runId,
    targetHeadSha: input.session.expectedTargetHead,
    trackerTarget: target,
    taskSpecification: specification
  })
  const initial = {
    responsibility: history.responsibility,
    targetLineage: history.targetLineage,
    targetLineageObservedAt: history.targetLineageObservedAt
  }
  const session = integratorCorrelationFor(initial)
  const runtime = ManagedRuntime.make(liveJournalTestLayer({ runId, target, records: history.records }))
  const readRecords = () => runtime.runPromise(Effect.flatMap(JournalStore, (store) => store.read(runId)))
  const native = Integrator.of({ prepare: (request) => Effect.promise(() => input.prepare(request)) })
  const candidateGit = IntegratorGit.of({
    readCandidate: (_target, candidateText) =>
      Effect.gen(function* () {
        const commit = yield* Effect.promise(() => input.git("rev-parse", candidateText))
        const parents = yield* Effect.promise(() => input.git("show", "-s", "--format=%P", commit))
        return IntegratorGitObservation.cases.Commit.make({
          candidateText,
          commit: GitCommitSha.make(commit),
          directParents: parents.split(" ").map((parent) => GitCommitSha.make(parent))
        })
      })
  })
  const readFreshLineage = (name: string) =>
    runtime.runPromise(
      Effect.gen(function* () {
        const operationId = OperationId.make(name)
        const journal = yield* InRunJournal
        yield* journal.append(
          runId,
          intentRecordKey(operationId),
          GitReadIntentRecordedEvent.make({
            initiatedBy: { _tag: "DalphCoordinator" },
            occurrenceClassification: "InitiatedAction",
            operation: makeTargetLineageObservationOperation({
              integrationTarget: session.integrationTarget,
              operationId,
              plannedAttempt,
              predecessorOperationIds: []
            }),
            version: workflowJournalEventVersion
          })
        )
        const head = yield* Effect.promise(() => input.git("rev-parse", session.integrationTarget.ref))
        const base = yield* Effect.promise(() => input.git("merge-base", plannedAttempt.baseSha, head))
        const observation = {
          plannedBaseIsAncestorOfTargetHead: base === plannedAttempt.baseSha,
          plannedBaseSha: plannedAttempt.baseSha,
          targetHeadSha: GitCommitSha.make(head)
        }
        const record = yield* journal.append(
          runId,
          outcomeRecordKey(operationId),
          TargetLineageObservedEvent.make({
            observation,
            occurrenceClassification: "NonActionOccurrence",
            operationId,
            plannedAttempt,
            version: workflowJournalEventVersion
          })
        )
        return {
          responsibility: history.responsibility,
          targetLineage: observation,
          targetLineageObservedAt: record.position
        }
      })
    )
  const runOne = integratorRunCorrelationForSession(session, IntegratorRunOrdinal.make(1))
  const runTwo = integratorRunCorrelationForSession(session, IntegratorRunOrdinal.make(retryOrdinal))
  return {
    session,
    initial: () =>
      runtime.runPromise(
        prepareIntegrationCandidateRun({ preparation: initial, run: runOne }).pipe(
          Effect.provideService(Integrator, native),
          Effect.provideService(IntegratorGit, candidateGit)
        )
      ),
    authorizeStarted: async () => {
      await runtime.runPromise(
        Effect.gen(function* () {
          const records = yield* (yield* JournalStore).read(runId)
          const first = records.find(({ event }) => event._tag === "IntegratorRunResultRecorded")
          if (first?.event._tag !== "IntegratorRunResultRecorded" || first.event.result._tag !== "NotPrepared")
            return yield* Effect.die("native first run must be NotPrepared")
          const quarantine = yield* appendInitialConclusiveIntegrationQuarantine({
            _tag: "NotPrepared",
            run: runOne,
            detail: first.event.result.detail
          })
          const control = yield* makeIntegrationQuarantineDirectionControl(yield* InRunJournal)
          yield* control.apply({
            fingerprint: IntegrationQuarantineDirectionFingerprint.make({
              direction: "Retry",
              quarantineAt: quarantine.position,
              sessionId: session.sessionId
            }),
            requestId: IntegrationQuarantineDirectionRequestId.make({ nonce: "one-native-human-Retry", runId })
          })
        })
      )
      const original = await readFreshLineage("native-original-Retry-L")
      // The outer protocol records Started before the native provider boundary.
      const unadmitted = Integrator.of({
        prepare: () =>
          Effect.fail(
            new IntegratorCallFailure({ correlation: runTwo, detail: "process lost before native admission" })
          )
      })
      const stopped = await runtime.runPromise(
        Effect.exit(
          prepareIntegrationCandidateRun({ preparation: original, run: runTwo }).pipe(
            Effect.provideService(Integrator, unadmitted),
            Effect.provideService(IntegratorGit, candidateGit)
          )
        )
      )
      expect(stopped._tag).toBe("Failure")
      return original
    },
    reopen: async () => {
      const before = await readRecords()
      const preparation = await readFreshLineage("native-reopen-Started-L")
      let calls = 0
      const lostResponse = Integrator.of({
        prepare: (request) =>
          native.prepare(request).pipe(
            Effect.tap(() =>
              Effect.sync(() => {
                calls += 1
              })
            ),
            Effect.andThen(
              Effect.fail(new IntegratorCallFailure({ correlation: runTwo, detail: "lost outer response" }))
            )
          )
      })
      const lost = await runtime.runPromise(
        Effect.exit(
          prepareIntegrationCandidateRun({ preparation, run: runTwo }).pipe(
            Effect.provideService(Integrator, lostResponse),
            Effect.provideService(IntegratorGit, candidateGit)
          )
        )
      )
      expect(lost._tag).toBe("Failure")
      expect(calls).toBe(1)
      await input.afterUncertainResponse()
      expect((await readRecords()).filter(({ event }) => event._tag === "IntegratorRunResultRecorded")).toHaveLength(1)
      const fresh = await readFreshLineage("native-recorded-token-reopen-L")
      const result = await runtime.runPromise(
        prepareIntegrationCandidateRun({ preparation: fresh, run: runTwo }).pipe(
          Effect.provideService(Integrator, native),
          Effect.provideService(IntegratorGit, candidateGit)
        )
      )
      expect(
        await runtime.runPromise(
          prepareIntegrationCandidateRun({ preparation: fresh, run: runTwo }).pipe(
            Effect.provideService(Integrator, native),
            Effect.provideService(IntegratorGit, candidateGit)
          )
        )
      ).toEqual(result)
      const after = await readRecords()
      expect(after.filter(({ event }) => event._tag === "IntegratorRunStarted")).toHaveLength(retryOrdinal)
      expect(after.filter(({ event }) => event._tag === "IntegratorSessionFixed")).toHaveLength(1)
      expect(after.filter(({ event }) => event._tag === "IntegrationQuarantineDirectionApplied")).toHaveLength(1)
      expect(after.find(({ event }) => event._tag === "IntegratorRunResultRecorded")).toEqual(
        before.find(({ event }) => event._tag === "IntegratorRunResultRecorded")
      )
      return { result, before, after }
    },
    dispose: () => runtime.dispose()
  }
}
