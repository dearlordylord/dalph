/* eslint-disable max-lines -- Kimi lifecycle, reconciliation, and private-state transitions stay co-located. */

import {
  decodeOwnedSemanticCandidate,
  publishProviderResultEvidence,
  providerResultGitBoundary,
  validateOwnedSemanticCandidate,
  ProviderResultAuthorityUnavailable,
  ProviderResultRejectionReason,
  semanticCandidateInstructions
} from "./provider-semantic-result.js"
import {
  GitCommitSha,
  PlannedAttemptExecutor,
  PlannedAttemptExecutorCommandFailure,
  PlannedAttemptExecutorLifecycleObservation,
  PlannedAttemptExecutorProjection,
  PlannedAttemptExecutorReport,
  PlannedAttemptRejectedResultReport,
  PlannedAttemptExecutorResult,
  PlannedAttemptExecutorCorrelation,
  type PlannedAttemptExecutorRequest,
  type PlannedAttemptExecutorReport as PlannedAttemptExecutorReportType,
  type PlannedTaskAttempt,
  plannedAttemptExecutorCorrelation,
  plannedAttemptExecutorCorrelationKey,
  samePlannedAttemptExecutorProjection
} from "@dalph/contracts"
import { EvidenceStore, GitCommand } from "@dalph/orchestrator"
import { Context, Crypto, Data, Effect, Layer, Option, Ref, Schema, Stream } from "effect"
import {
  KimiAcpClient,
  KimiAcpFailure,
  KimiAcpPromptToken,
  type KimiAcpSessionId,
  type KimiAcpSessionObservation
} from "./kimi-acp.js"
import type { KimiAttemptPrivatePhase, KimiAttemptStoreFailure } from "./kimi-attempt-store.js"
import { KimiAttemptPrivateRecord, KimiAttemptPrivateStore } from "./kimi-attempt-store.js"

import { KimiResultCycle, prepareKimiResultCorrection } from "./kimi-result-cycle.js"
import { KimiPromptRequestHistory } from "./kimi-prompt-history.js"
import {
  ProviderResultRequestToken,
  ProviderResultInstantMilliseconds,
  providerResultResponseExpired,
  withinProviderResultDeadline,
  type ProviderResultCycle
} from "./provider-result-correction.js"

type AttemptContext = Pick<PlannedTaskAttempt, "attemptId" | "baseSha" | "executor" | "runId" | "worktree">
const sameAttemptContext = (left: AttemptContext, right: AttemptContext): boolean =>
  left.attemptId === right.attemptId &&
  left.baseSha === right.baseSha &&
  left.executor === right.executor &&
  left.runId === right.runId &&
  left.worktree === right.worktree

type AttemptState = {
  readonly attempt: AttemptContext
  readonly sessionId: KimiAcpSessionId
  readonly status: "executing" | "suspended" | "terminal" | "unavailable"
  readonly phase: KimiAttemptPrivatePhase
  readonly terminal?: PlannedAttemptExecutorResult
  readonly resultCycle?: ProviderResultCycle
  readonly promptRequests?: KimiPromptRequestHistory
  readonly kimiResultCycle?: KimiResultCycle
  readonly resultRejection?: PlannedAttemptRejectedResultReport
  readonly sessionClosed: boolean
}

const lastPromptOffset = -1
const maximumSuspensionObservations = 4
const suspensionObservationInterval = "100 millis"

const correlationOf = plannedAttemptExecutorCorrelation
const correlationForContext = (attempt: AttemptContext): PlannedAttemptExecutorCorrelation =>
  PlannedAttemptExecutorCorrelation.make({ attemptId: attempt.attemptId, runId: attempt.runId })

const executing = (correlation: PlannedAttemptExecutorCorrelation): PlannedAttemptExecutorReportType =>
  PlannedAttemptExecutorReport.cases.ExecutorWorkExecuting.make({ correlation })

const suspended = (correlation: PlannedAttemptExecutorCorrelation): PlannedAttemptExecutorReportType =>
  PlannedAttemptExecutorReport.cases.ExecutorWorkSafelySuspended.make({ correlation })

const terminal = (
  correlation: PlannedAttemptExecutorCorrelation,
  result: PlannedAttemptExecutorResult
): PlannedAttemptExecutorReportType =>
  PlannedAttemptExecutorReport.cases.ExecutorWorkTerminal.make({ correlation, result })

const commandFailure = (
  command: "Begin" | "Resume" | "Suspend",
  correlation: PlannedAttemptExecutorCorrelation,
  error: unknown
): PlannedAttemptExecutorCommandFailure =>
  new PlannedAttemptExecutorCommandFailure({
    command,
    correlation,
    detail: error instanceof KimiAcpFailure ? error.detail : error instanceof Error ? error.message : String(error)
  })

const semanticTaskText = (body: string): string => `${body}\n\n${semanticCandidateInstructions}`

const textFrom = (observation: KimiAcpSessionObservation): string | undefined => observation.lastMessage

/** Absence preserves legacy prose completion; an explicit invalid proposal fails closed. */
type TerminalCandidate = Data.TaggedEnum<{
  NoCandidate: Record<never, never>
  InvalidCandidate: Record<never, never>
  Candidate: { readonly commit: GitCommitSha }
}>
const TerminalCandidate = Data.taggedEnum<TerminalCandidate>()

const commitFromMessage = (
  message: string | undefined,
  correlation: PlannedAttemptExecutorCorrelation
): TerminalCandidate => {
  if (message === undefined || message.trim() === "") return TerminalCandidate.NoCandidate()
  const candidate = decodeOwnedSemanticCandidate(message, correlation)
  if (Option.isSome(candidate)) return TerminalCandidate.Candidate({ commit: candidate.value.commit })
  try {
    JSON.parse(message)
    return TerminalCandidate.InvalidCandidate()
  } catch {
    return ["{", "[", '"', "`"].some((prefix) => message.trim().startsWith(prefix))
      ? TerminalCandidate.InvalidCandidate()
      : TerminalCandidate.NoCandidate()
  }
}

const readHead = Effect.fn("KimiPlannedAttemptExecutor.readHead")(function* (
  git: GitCommand["Service"],
  attempt: Pick<PlannedTaskAttempt, "worktree">
) {
  const result = yield* git.runInWorktree(attempt.worktree, ["rev-parse", "HEAD"])
  if (result.exitCode !== 0) return Option.none<GitCommitSha>()
  try {
    return Option.some(GitCommitSha.make(result.stdout.trim()))
  } catch {
    return Option.none<GitCommitSha>()
  }
})

const resultForTerminal = Effect.fn("KimiPlannedAttemptExecutor.resultForTerminal")(function* (
  state: AttemptState,
  observation: KimiAcpSessionObservation,
  git: Option.Option<GitCommand["Service"]>,
  evidence: Option.Option<EvidenceStore["Service"]>,
  crypto: Option.Option<Crypto.Crypto>
) {
  const correlation = correlationForContext(state.attempt)
  const candidate = commitFromMessage(textFrom(observation), correlation)
  if (candidate._tag === "InvalidCandidate")
    return PlannedAttemptExecutorResult.cases.Failed.make({ failureCode: "ResultEnvelopeInvalid" })
  if (Option.isNone(git) || Option.isNone(evidence) || Option.isNone(crypto)) {
    return PlannedAttemptExecutorResult.cases.Completed.make({})
  }
  if (candidate._tag === "NoCandidate") {
    const head = yield* readHead(git.value, state.attempt)
    if (Option.isNone(head)) {
      if (state.kimiResultCycle !== undefined)
        return yield* new KimiAcpFailure({
          kind: "Unavailable",
          operation: "session/prompt",
          detail: "Kimi result authority unavailable at Head"
        })
      return PlannedAttemptExecutorResult.cases.Failed.make({ failureCode: "GitUnavailable" })
    }
    return head.value === state.attempt.baseSha
      ? PlannedAttemptExecutorResult.cases.Completed.make({})
      : PlannedAttemptExecutorResult.cases.Failed.make({
          failureCode: "ResultEnvelopeInvalid",
          observedHead: head.value
        })
  }
  const acceptedResult = yield* validateOwnedSemanticCandidate(textFrom(observation) ?? "", correlation, {
    proveOwnership:
      observation.sessionId === state.sessionId &&
      observation.cwd === state.attempt.worktree &&
      observation.status === "terminal"
        ? Effect.void
        : Effect.fail(
            new ProviderResultAuthorityUnavailable({
              boundary: "Ownership",
              detail: "Kimi terminal session ownership is unproven"
            })
          ),
    ...providerResultGitBoundary(git.value, state.attempt.worktree, state.attempt.baseSha),
    publishAndVerifyEvidence: (commit, ownedCorrelation) =>
      publishProviderResultEvidence(evidence.value, crypto.value, commit, ownedCorrelation)
  }).pipe(
    Effect.map((acceptedResult) => PlannedAttemptExecutorResult.cases.Accepted.make({ acceptedResult })),
    Effect.catchTag("ProviderResultRejected", (rejection) =>
      Effect.succeed(
        PlannedAttemptExecutorResult.cases.Failed.make({
          failureCode: rejection.reason === "CandidateLineageInvalid" ? "LineageUnproven" : rejection.reason,
          ...(rejection.observedHead === undefined ? {} : { observedHead: rejection.observedHead })
        })
      )
    ),
    Effect.mapError(
      (error) =>
        new KimiAcpFailure({
          kind: "Protocol",
          operation: "session/prompt",
          detail:
            error.boundary === "Evidence"
              ? "Kimi accepted-result evidence could not be verified"
              : `Kimi result authority unavailable at ${error.boundary}`
        })
    )
  )
  return acceptedResult
})

/** Kimi ACP implementation of the provider-neutral planned-attempt boundary. */
export const kimiPlannedAttemptExecutorLayer = Layer.effectContext(
  Effect.gen(function* () {
    const client = yield* KimiAcpClient
    const states = yield* Ref.make<ReadonlyMap<string, AttemptState>>(new Map())
    const git = yield* Effect.serviceOption(GitCommand)
    const evidence = yield* Effect.serviceOption(EvidenceStore)
    const crypto = yield* Effect.serviceOption(Crypto.Crypto)
    const privateStore = yield* Effect.serviceOption(KimiAttemptPrivateStore)

    const privateFailure = (error: KimiAttemptStoreFailure): KimiAcpFailure =>
      new KimiAcpFailure({ detail: error.detail, kind: "Unavailable", operation: "session/load" })

    const readPrivate = (runId: AttemptContext["runId"], attemptId: AttemptContext["attemptId"]) =>
      Option.isNone(privateStore)
        ? Effect.succeed(Option.none<KimiAttemptPrivateRecord>())
        : privateStore.value.read(runId, attemptId).pipe(Effect.mapError(privateFailure))

    const privateRecord = (state: AttemptState, phase: KimiAttemptPrivatePhase): KimiAttemptPrivateRecord =>
      KimiAttemptPrivateRecord.make({
        attemptId: state.attempt.attemptId,
        baseSha: state.attempt.baseSha,
        executor: state.attempt.executor,
        phase,
        runId: state.attempt.runId,
        sessionId: state.sessionId,
        worktree: state.attempt.worktree,
        sessionClosed: state.sessionClosed,
        ...(state.resultCycle === undefined ? {} : { resultCycle: state.resultCycle }),
        ...(state.promptRequests === undefined ? {} : { promptRequests: state.promptRequests }),
        ...(state.kimiResultCycle === undefined ? {} : { kimiResultCycle: state.kimiResultCycle }),
        ...(state.resultRejection === undefined ? {} : { resultRejection: state.resultRejection }),
        ...(state.terminal === undefined ? {} : { terminal: state.terminal })
      })

    const persist = (state: AttemptState) =>
      Option.isNone(privateStore)
        ? Effect.void
        : privateStore.value.write(privateRecord(state, state.phase)).pipe(Effect.mapError(privateFailure))

    const stateFor = (correlation: PlannedAttemptExecutorCorrelation) =>
      Ref.get(states).pipe(Effect.map((current) => current.get(plannedAttemptExecutorCorrelationKey(correlation))))
    const put = (state: AttemptState) =>
      Ref.update(
        states,
        (current) =>
          new Map([
            ...current,
            [plannedAttemptExecutorCorrelationKey(correlationForContext(state.attempt)), state] as const
          ])
      )
    const putAndPersist = Effect.fn("KimiPlannedAttemptExecutor.putAndPersist")(function* (state: AttemptState) {
      yield* put(state)
      yield* persist(state)
    })

    const acknowledgePromptCycle = Effect.fn("KimiPlannedAttemptExecutor.acknowledgePromptCycle")(function* (
      cycle: KimiResultCycle | undefined,
      token: KimiAcpPromptToken | undefined
    ) {
      if (cycle === undefined) return undefined
      const current = cycle.responses.at(lastPromptOffset)
      if (current?._tag !== "RequestIntended") return cycle
      if (token === undefined || current.intent.token !== ProviderResultRequestToken.make(token))
        return yield* new KimiAcpFailure({
          kind: "Protocol",
          operation: "session/prompt",
          detail: "Kimi acknowledgement names another result response"
        })
      return yield* Schema.decodeUnknownEffect(KimiResultCycle)({
        ...cycle,
        responses: [
          ...cycle.responses.slice(0, lastPromptOffset),
          { _tag: "PromptAcknowledged", intent: current.intent }
        ]
      })
    })

    const sendPrompt = Effect.fn("KimiPlannedAttemptExecutor.sendPrompt")(function* (
      state: AttemptState,
      body: string,
      command: "Begin" | "Resume",
      correlation: PlannedAttemptExecutorCorrelation,
      prepared?: { readonly token: KimiAcpPromptToken; readonly cycle: KimiResultCycle }
    ) {
      // Legacy controlled services without Crypto retain their original lifecycle contract.
      const token =
        prepared?.token ??
        (Option.isSome(crypto) ? KimiAcpPromptToken.make(yield* crypto.value.randomUUIDv4) : undefined)
      const intendedAt =
        prepared?.cycle.responses.at(lastPromptOffset)?.intent.intendedAt ??
        (yield* Effect.clockWith((clock) => clock.currentTimeMillis))
      const promptRequests =
        token === undefined
          ? state.promptRequests
          : yield* Schema.decodeUnknownEffect(KimiPromptRequestHistory)([
              ...(state.promptRequests ?? []),
              { token, intendedAt, response: "Pending" }
            ])
      const kimiResultCycle =
        prepared?.cycle ??
        state.kimiResultCycle ??
        (token !== undefined && Option.isSome(privateStore) && state.phase === "SessionCreated"
          ? yield* Schema.decodeUnknownEffect(KimiResultCycle)({
              cycleId: token,
              plannedBaseSha: state.attempt.baseSha,
              responses: [{ _tag: "RequestIntended", intent: { _tag: "Initial", ordinal: 1, token, intendedAt } }]
            })
          : undefined)
      const intent: AttemptState = {
        ...state,
        ...(kimiResultCycle === undefined ? {} : { kimiResultCycle }),
        phase: "PromptIntentRecorded",
        status: "executing",
        ...(promptRequests === undefined ? {} : { promptRequests })
      }
      yield* putAndPersist(intent)
      const prompt = client
        .prompt(state.sessionId, semanticTaskText(body), token)
        .pipe(Effect.mapError((error) => commandFailure(command, correlation, error)))
      const allowance = kimiResultCycle?.responses.at(lastPromptOffset)?.intent
      yield* allowance === undefined ? prompt : withinProviderResultDeadline(allowance, prompt)
      const acknowledged =
        token === undefined || promptRequests === undefined
          ? promptRequests
          : yield* Schema.decodeUnknownEffect(KimiPromptRequestHistory)(
              promptRequests.map((entry) => (entry.token === token ? { ...entry, response: "Observed" } : entry))
            )
      const acknowledgedCycle = yield* acknowledgePromptCycle(kimiResultCycle, token)
      yield* putAndPersist({
        ...intent,
        phase: "Executing",
        ...(acknowledged === undefined ? {} : { promptRequests: acknowledged }),
        ...(acknowledgedCycle === undefined ? {} : { kimiResultCycle: acknowledgedCycle })
      })
      return executing(correlation)
    })

    const rejectAndStop = Effect.fn("KimiPlannedAttemptExecutor.rejectAndStop")(function* (
      state: AttemptState,
      reason: PlannedAttemptRejectedResultReport["reason"],
      recoveryCause: PlannedAttemptRejectedResultReport["recoveryCause"]
    ) {
      const report = yield* Schema.decodeUnknownEffect(PlannedAttemptRejectedResultReport)({
        _tag: "ExecutorWorkResultRejected",
        correlation: correlationForContext(state.attempt),
        reason,
        recoveryCause,
        responseCount: state.kimiResultCycle?.responses.length,
        custody: { _tag: "Unresolved" }
      })
      const intended: AttemptState = {
        ...state,
        phase: "ResultStopIntended",
        status: "unavailable",
        resultRejection: report
      }
      yield* putAndPersist(intended)
      yield* client.cancel(state.sessionId).pipe(Effect.result)
      yield* client.closeSession(state.sessionId).pipe(Effect.result)
      // ACP session closure is not native stopped-writer proof. Never release custody from its acknowledgement.
      yield* putAndPersist({ ...intended, phase: "ResultRejected" })
      return PlannedAttemptExecutorProjection.cases.Exact.make({ report })
    })

    const expireCycle = Effect.fn("KimiPlannedAttemptExecutor.expireCycle")(function* (state: AttemptState) {
      const rejected = state.kimiResultCycle?.responses.findLast((entry) => entry._tag === "ResponseRejected")
      if (rejected?._tag !== "ResponseRejected")
        return yield* new KimiAcpFailure({
          kind: "Protocol",
          operation: "session/prompt",
          detail: "expired correction lacks its predecessor rejection"
        })
      return yield* rejectAndStop(state, rejected.reason, "Deadline")
    })

    const statusForPhase = (phase: KimiAttemptPrivatePhase): AttemptState["status"] => {
      switch (phase) {
        case "Suspended":
          return "suspended"
        case "Terminal":
          return "terminal"
        case "Unavailable":
        case "ResultStopIntended":
        case "ResultRejected":
          return "unavailable"
        case "SessionCreated":
        case "PromptIntentRecorded":
        case "ResumeIntentRecorded":
        case "Executing":
          return "executing"
      }
    }

    const contextForRecord = (record: KimiAttemptPrivateRecord): AttemptContext => ({
      attemptId: record.attemptId,
      baseSha: record.baseSha,
      executor: record.executor,
      runId: record.runId,
      worktree: record.worktree
    })

    const recoveredState = Effect.fn("KimiPlannedAttemptExecutor.recoveredState")(function* (
      record: KimiAttemptPrivateRecord,
      attempt?: AttemptContext
    ) {
      const context = attempt ?? contextForRecord(record)
      if (!sameAttemptContext(context, contextForRecord(record))) {
        return yield* Effect.fail(
          new KimiAcpFailure({
            detail: "Kimi private session is bound to a different attempt",
            kind: "Protocol",
            operation: "session/load"
          })
        )
      }
      // An unavailable record is a typed stop from a prior process. Do not
      // manufacture a new ACP session while merely observing it.
      if (
        record.phase !== "Unavailable" &&
        record.phase !== "ResultStopIntended" &&
        record.phase !== "ResultRejected" &&
        !(record.phase === "Terminal" && record.sessionClosed === true)
      ) {
        const loaded = yield* client.loadSession(record.sessionId, record.worktree)
        if (loaded !== record.sessionId) {
          return yield* Effect.fail(
            new KimiAcpFailure({
              detail: "Kimi loaded another session identity",
              kind: "Protocol",
              operation: "session/load"
            })
          )
        }
      }
      const state: AttemptState = {
        attempt: context,
        phase: record.phase,
        sessionId: record.sessionId,
        status: statusForPhase(record.phase),
        ...(record.terminal === undefined ? {} : { terminal: record.terminal }),
        ...(record.resultCycle === undefined ? {} : { resultCycle: record.resultCycle }),
        ...(record.promptRequests === undefined ? {} : { promptRequests: record.promptRequests }),
        ...(record.kimiResultCycle === undefined ? {} : { kimiResultCycle: record.kimiResultCycle }),
        ...(record.resultRejection === undefined ? {} : { resultRejection: record.resultRejection }),
        sessionClosed: record.sessionClosed
      }
      yield* put(state)
      return state
    })

    const recoverForAttempt = Effect.fn("KimiPlannedAttemptExecutor.recoverForAttempt")(function* (
      attempt: AttemptContext
    ) {
      const record = yield* readPrivate(attempt.runId, attempt.attemptId)
      return Option.isNone(record)
        ? Option.none<AttemptState>()
        : Option.some(yield* recoveredState(record.value, attempt))
    })

    const recoverForCorrelation = Effect.fn("KimiPlannedAttemptExecutor.recoverForCorrelation")(function* (
      correlation: PlannedAttemptExecutorCorrelation
    ) {
      const record = yield* readPrivate(correlation.runId, correlation.attemptId)
      return Option.isNone(record) ? Option.none<AttemptState>() : Option.some(yield* recoveredState(record.value))
    })

    const observeClient = Effect.fn("KimiPlannedAttemptExecutor.observeOwnedSession")(function* (state: AttemptState) {
      const observation = yield* client.observe(state.sessionId)
      if (observation.sessionId !== state.sessionId || observation.cwd !== state.attempt.worktree) {
        return yield* Effect.fail(
          new KimiAcpFailure({
            detail: "Kimi observation belongs to another session or worktree",
            kind: "Protocol",
            operation: "session/prompt"
          })
        )
      }
      return observation
    })
    const confirmIdleAfterCancel = Effect.fn("KimiPlannedAttemptExecutor.confirmIdleAfterCancel")(function* (
      sessionId: KimiAcpSessionId
    ) {
      let observed = yield* client.observe(sessionId)
      for (let attempt = 0; attempt < maximumSuspensionObservations && observed.status !== "idle"; attempt += 1) {
        yield* Effect.sleep(suspensionObservationInterval)
        observed = yield* client.observe(sessionId)
      }
      return observed
    })
    const projection = Effect.fn("KimiPlannedAttemptExecutor.project")(function* (
      correlation: PlannedAttemptExecutorCorrelation,
      initialState: AttemptState
    ): Effect.fn.Return<PlannedAttemptExecutorProjection, unknown, never> {
      let state = initialState
      if (state.resultRejection !== undefined)
        return PlannedAttemptExecutorProjection.cases.Exact.make({ report: state.resultRejection })
      const activeResponse = state.kimiResultCycle?.responses.at(lastPromptOffset)
      if (
        activeResponse !== undefined &&
        providerResultResponseExpired(
          activeResponse.intent,
          ProviderResultInstantMilliseconds.make(yield* Effect.clockWith((clock) => clock.currentTimeMillis))
        )
      ) {
        const previous = state.kimiResultCycle?.responses.findLast((entry) => entry._tag === "ResponseRejected")
        if (previous?._tag !== "ResponseRejected")
          return yield* new KimiAcpFailure({
            kind: "Protocol",
            operation: "session/prompt",
            detail: "expired correction lacks its predecessor rejection"
          })
        return yield* rejectAndStop(state, previous.reason, "Deadline")
      }

      if (state.phase === "Terminal" && state.terminal !== undefined && state.sessionClosed) {
        return PlannedAttemptExecutorProjection.cases.Exact.make({ report: terminal(correlation, state.terminal) })
      }
      const observationRead = observeClient(state)
      const observedWithinAllowance = yield* activeResponse === undefined
        ? observationRead.pipe(Effect.map(Option.some))
        : withinProviderResultDeadline(activeResponse.intent, observationRead).pipe(
            Effect.map(Option.some),
            Effect.catchTag("ProviderResultDeadlineElapsed", () =>
              Effect.succeed(Option.none<KimiAcpSessionObservation>())
            )
          )
      if (Option.isNone(observedWithinAllowance)) return yield* expireCycle(state)
      const observed = observedWithinAllowance.value
      const pending = state.promptRequests?.at(lastPromptOffset)
      if (pending?.response === "Pending") {
        if (observed.promptRequest?.token !== pending.token || observed.promptRequest.response !== "Observed")
          return PlannedAttemptExecutorProjection.cases.Unreadable.make({
            correlation,
            detail: "Kimi prompt acknowledgement is unproven; retained request cannot be resent"
          })
        const acknowledged = yield* Schema.decodeUnknownEffect(KimiPromptRequestHistory)(
          state.promptRequests?.map((entry) =>
            entry.token === pending.token ? { ...entry, response: "Observed" } : entry
          )
        )
        const acknowledgedCycle = yield* acknowledgePromptCycle(state.kimiResultCycle, pending.token)
        state = {
          ...state,
          promptRequests: acknowledged,
          ...(acknowledgedCycle === undefined ? {} : { kimiResultCycle: acknowledgedCycle })
        }

        yield* putAndPersist(state)
      }
      if (observed.status === "unavailable") {
        yield* putAndPersist({ ...state, phase: "Unavailable", status: "unavailable" })
        return PlannedAttemptExecutorProjection.cases.TemporarilyUnavailable.make({ correlation })
      }
      if (observed.status === "executing") {
        yield* putAndPersist({ ...state, phase: "Executing", status: "executing" })
        return PlannedAttemptExecutorProjection.cases.Exact.make({ report: executing(correlation) })
      }
      if (observed.status === "idle" && state.status === "suspended") {
        if (state.phase === "ResumeIntentRecorded") {
          yield* putAndPersist({ ...state, phase: "Suspended", status: "suspended" })
        }
        return PlannedAttemptExecutorProjection.cases.Exact.make({ report: suspended(correlation) })
      }
      if (observed.status === "idle" && state.phase === "PromptIntentRecorded") {
        return PlannedAttemptExecutorProjection.cases.Unreadable.make({
          correlation,
          detail: "Kimi prompt outcome is ambiguous after restart"
        })
      }
      if (observed.status === "idle" && state.phase === "SessionCreated") {
        return PlannedAttemptExecutorProjection.cases.Unreadable.make({
          correlation,
          detail: "Kimi session has no recorded prompt"
        })
      }
      if (observed.status === "terminal") {
        const validation =
          state.terminal === undefined
            ? resultForTerminal(state, observed, git, evidence, crypto)
            : Effect.succeed(state.terminal)
        const validatedWithinAllowance = yield* activeResponse === undefined
          ? validation.pipe(Effect.map(Option.some))
          : withinProviderResultDeadline(activeResponse.intent, validation).pipe(
              Effect.map(Option.some),
              Effect.catchTag("ProviderResultDeadlineElapsed", () =>
                Effect.succeed(Option.none<PlannedAttemptExecutorResult>())
              )
            )
        if (Option.isNone(validatedWithinAllowance)) return yield* expireCycle(state)
        const result = validatedWithinAllowance.value
        if (
          state.kimiResultCycle !== undefined &&
          result._tag === "Failed" &&
          (result.failureCode === "ResultEnvelopeInvalid" ||
            result.failureCode === "CandidateHeadMismatch" ||
            result.failureCode === "LineageUnproven")
        ) {
          const cycle = state.kimiResultCycle
          const current = cycle.responses.at(lastPromptOffset)
          if (current?._tag !== "PromptAcknowledged")
            return yield* new KimiAcpFailure({
              kind: "Protocol",
              operation: "session/prompt",
              detail: "invalid answer lacks exact prompt acknowledgement"
            })
          const reason = yield* Schema.decodeUnknownEffect(ProviderResultRejectionReason)(
            result.failureCode === "LineageUnproven" ? "CandidateLineageInvalid" : result.failureCode
          )
          const now = ProviderResultInstantMilliseconds.make(
            yield* Effect.clockWith((clock) => clock.currentTimeMillis)
          )
          const rejectedCycle = yield* Schema.decodeUnknownEffect(KimiResultCycle)({
            ...cycle,
            responses: [
              ...cycle.responses.slice(0, lastPromptOffset),
              { _tag: "ResponseRejected", intent: current.intent, reason, responseObservedAt: now }
            ]
          })
          state = { ...state, kimiResultCycle: rejectedCycle }
          yield* putAndPersist(state)
          if (Option.isNone(crypto))
            return yield* new KimiAcpFailure({
              kind: "Unavailable",
              operation: "session/prompt",
              detail: "result correction identity allocator is unavailable"
            })
          const token = KimiAcpPromptToken.make(yield* crypto.value.randomUUIDv4)
          const decision = yield* prepareKimiResultCorrection(rejectedCycle, token, now)
          if (decision._tag === "Exhausted") return yield* rejectAndStop(state, reason, "CorrectionExhausted")
          if (decision._tag !== "CorrectionPrepared")
            return yield* new KimiAcpFailure({
              kind: "Protocol",
              operation: "session/prompt",
              detail: "rejected response did not authorize a correction"
            })
          const started = yield* sendPrompt(
            state,
            `The final result was rejected: ${reason}. Verify the current worktree and applicable checks again; return a fresh final JSON answer. You retain full access.`,
            "Begin",
            correlation,
            { token, cycle: decision.cycle }
          ).pipe(
            Effect.map((report) => PlannedAttemptExecutorProjection.cases.Exact.make({ report })),
            Effect.catchTag("ProviderResultDeadlineElapsed", () =>
              Effect.gen(function* () {
                const retained = yield* stateFor(correlation)
                return yield* rejectAndStop(retained ?? state, reason, "Deadline")
              })
            )
          )
          return started
        }
        const terminalState = { ...state, phase: "Terminal" as const, status: "terminal" as const, terminal: result }
        yield* putAndPersist(terminalState)
        if (!terminalState.sessionClosed) {
          yield* client.closeSession(terminalState.sessionId)
          yield* putAndPersist({ ...terminalState, sessionClosed: true })
        }
        return PlannedAttemptExecutorProjection.cases.Exact.make({ report: terminal(correlation, result) })
      }
      return PlannedAttemptExecutorProjection.cases.Exact.make({ report: executing(correlation) })
    })

    const begin = Effect.fn("KimiPlannedAttemptExecutor.begin")(function* (request: PlannedAttemptExecutorRequest) {
      const attempt = request.plannedAttempt
      const correlation = correlationOf(attempt)
      const context: AttemptContext = {
        attemptId: attempt.attemptId,
        baseSha: attempt.baseSha,
        executor: attempt.executor,
        runId: attempt.runId,
        worktree: attempt.worktree
      }
      const existingInMemory = yield* stateFor(correlation)
      const existing = existingInMemory ?? Option.getOrUndefined(yield* recoverForAttempt(context))
      if (existing !== undefined) {
        if (!sameAttemptContext(context, existing.attempt))
          return yield* commandFailure(
            "Begin",
            correlation,
            new KimiAcpFailure({
              detail: "Kimi private session is bound to a different attempt",
              kind: "Protocol",
              operation: "session/load"
            })
          )
        if (existing.phase === "SessionCreated") {
          return yield* sendPrompt(existing, request.specification.body, "Begin", correlation)
        }
        const result = yield* projection(correlation, existing)
        if (result._tag === "Exact") return result.report
        return yield* Effect.fail(
          commandFailure(
            "Begin",
            correlation,
            result._tag === "Unreadable" ? (result.detail ?? result._tag) : result._tag
          )
        )
      }
      yield* client
        .initialize(attempt.worktree)
        .pipe(Effect.mapError((error) => commandFailure("Begin", correlation, error)))
      const sessionId = yield* client.newSession(attempt.worktree)
      const fresh: AttemptState = {
        attempt: context,
        phase: "SessionCreated",
        sessionId,
        status: "executing",
        sessionClosed: false
      }
      // The session is retained in the adapter state before the prompt crosses ACP.
      yield* putAndPersist(fresh)
      return yield* sendPrompt(fresh, request.specification.body, "Begin", correlation)
    })

    const suspend = Effect.fn("KimiPlannedAttemptExecutor.suspend")(function* (attempt: PlannedTaskAttempt) {
      const correlation = correlationOf(attempt)
      const existingInMemory = yield* stateFor(correlation)
      const existing =
        existingInMemory ??
        Option.getOrUndefined(
          yield* recoverForAttempt({
            attemptId: attempt.attemptId,
            baseSha: attempt.baseSha,
            executor: attempt.executor,
            runId: attempt.runId,
            worktree: attempt.worktree
          })
        )
      if (existing === undefined)
        return yield* Effect.fail(commandFailure("Suspend", correlation, "Kimi session is unknown"))
      yield* client
        .cancel(existing.sessionId)
        .pipe(Effect.mapError((error) => commandFailure("Suspend", correlation, error)))
      const afterCancel = yield* confirmIdleAfterCancel(existing.sessionId).pipe(
        Effect.mapError((error) => commandFailure("Suspend", correlation, error))
      )
      if (afterCancel.status !== "idle")
        return yield* Effect.fail(
          commandFailure(
            "Suspend",
            correlation,
            new KimiAcpFailure({
              detail: "Kimi did not confirm an idle session after cancellation",
              kind: "Provider",
              operation: "session/cancel"
            })
          )
        )
      const next = { ...existing, phase: "Suspended" as const, status: "suspended" as const }
      yield* putAndPersist(next)
      return suspended(correlation)
    })

    const resume = Effect.fn("KimiPlannedAttemptExecutor.resume")(function* (request: PlannedAttemptExecutorRequest) {
      const attempt = request.plannedAttempt
      const correlation = correlationOf(attempt)
      const existingInMemory = yield* stateFor(correlation)
      const existing =
        existingInMemory ??
        Option.getOrUndefined(
          yield* recoverForAttempt({
            attemptId: attempt.attemptId,
            baseSha: attempt.baseSha,
            executor: attempt.executor,
            runId: attempt.runId,
            worktree: attempt.worktree
          })
        )
      if (existing === undefined)
        return yield* Effect.fail(commandFailure("Resume", correlation, "Kimi session is unknown"))
      if (existing.resultRejection !== undefined)
        return yield* Effect.fail(
          commandFailure("Resume", correlation, "rejected results require explicit recovery authorization")
        )
      if (existing.phase === "PromptIntentRecorded") {
        const reconciled = yield* projection(correlation, existing)
        if (reconciled._tag === "Exact") return reconciled.report
        return yield* Effect.fail(
          commandFailure("Resume", correlation, reconciled._tag === "Unreadable" ? reconciled.detail : reconciled._tag)
        )
      }
      const resumeIntent = { ...existing, phase: "ResumeIntentRecorded" as const, status: "suspended" as const }
      yield* putAndPersist(resumeIntent)
      yield* client
        .resumeSession(existing.sessionId, attempt.worktree)
        .pipe(Effect.mapError((error) => commandFailure("Resume", correlation, error)))
      return yield* sendPrompt(resumeIntent, request.specification.body, "Resume", correlation)
    })

    const executor = PlannedAttemptExecutor.of({
      observe: (correlation, _purpose): Effect.Effect<PlannedAttemptExecutorProjection> => {
        const state = stateFor(correlation).pipe(
          Effect.flatMap((current) =>
            current === undefined ? recoverForCorrelation(correlation) : Effect.succeed(Option.some(current))
          ),
          Effect.map((current) => (Option.isNone(current) ? undefined : current.value))
        )
        return state.pipe(
          Effect.flatMap((current) =>
            current === undefined
              ? Effect.succeed(PlannedAttemptExecutorProjection.cases.NoReport.make({ correlation }))
              : projection(correlation, current)
          ),
          Effect.catch((error) =>
            Effect.succeed(
              error instanceof KimiAcpFailure
                ? PlannedAttemptExecutorProjection.cases.Unreadable.make({ correlation, detail: error.detail })
                : PlannedAttemptExecutorProjection.cases.Unreadable.make({ correlation, detail: String(error) })
            )
          )
        )
      },
      begin: (request) =>
        begin(request).pipe(
          Effect.mapError((error) =>
            error instanceof PlannedAttemptExecutorCommandFailure
              ? error
              : commandFailure("Begin", correlationOf(request.plannedAttempt), error)
          )
        ),
      requestSuspension: (attempt) =>
        suspend(attempt).pipe(
          Effect.mapError((error) =>
            error instanceof PlannedAttemptExecutorCommandFailure
              ? error
              : commandFailure("Suspend", correlationOf(attempt), error)
          )
        ),
      resume: (request) =>
        resume(request).pipe(
          Effect.mapError((error) =>
            error instanceof PlannedAttemptExecutorCommandFailure
              ? error
              : commandFailure("Resume", correlationOf(request.plannedAttempt), error)
          )
        )
    })
    const lifecycle = PlannedAttemptExecutorLifecycleObservation.of({
      attach: (correlation) =>
        stateFor(correlation).pipe(
          Effect.map((state) => {
            const current =
              state === undefined
                ? PlannedAttemptExecutorProjection.cases.NoReport.make({ correlation })
                : PlannedAttemptExecutorProjection.cases.Exact.make({ report: executing(correlation) })
            const changes =
              state === undefined
                ? Stream.empty
                : Stream.fromEffect(
                    projection(correlation, state).pipe(
                      Effect.catch(() =>
                        Effect.succeed(
                          PlannedAttemptExecutorProjection.cases.Unreadable.make({
                            correlation,
                            detail: "Kimi lifecycle observation failed"
                          })
                        )
                      )
                    )
                  )
            return {
              current,
              // Lifecycle attachment performs one immediate passive read so a
              // terminal/unavailable provider state is not hidden behind an
              // empty stream. The generic observer still filters unchanged
              // projections below.
              changes,
              close: Effect.void
            }
          }),
          Effect.map((attachment) => ({
            ...attachment,
            changes: attachment.changes.pipe(
              Stream.filter((candidate) => !samePlannedAttemptExecutorProjection(candidate, attachment.current))
            )
          }))
        )
    })
    return Context.empty().pipe(
      Context.add(PlannedAttemptExecutor, executor),
      Context.add(PlannedAttemptExecutorLifecycleObservation, lifecycle)
    )
  })
)

export const nodeKimiPlannedAttemptExecutorLayer = kimiPlannedAttemptExecutorLayer
