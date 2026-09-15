/* eslint-disable max-lines -- Kimi lifecycle, reconciliation, and private-state transitions stay co-located. */

import {
  AcceptedResultEvidenceManifest,
  EvidenceDigest,
  EvidenceReference,
  GitCommitSha,
  PlannedAttemptExecutor,
  PlannedAttemptExecutorCommandFailure,
  PlannedAttemptExecutorLifecycleObservation,
  PlannedAttemptExecutorProjection,
  PlannedAttemptExecutorReport,
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
import { Context, Crypto, Effect, Layer, Option, Ref, Stream } from "effect"
import { KimiAcpClient, KimiAcpFailure, type KimiAcpSessionId, type KimiAcpSessionObservation } from "./kimi-acp.js"
import type { KimiAttemptPrivatePhase, KimiAttemptStoreFailure } from "./kimi-attempt-store.js"
import { KimiAttemptPrivateRecord, KimiAttemptPrivateStore } from "./kimi-attempt-store.js"

type AttemptContext = Pick<PlannedTaskAttempt, "attemptId" | "baseSha" | "executor" | "runId" | "worktree">
type AttemptState = {
  readonly attempt: AttemptContext
  readonly sessionId: KimiAcpSessionId
  readonly status: "executing" | "suspended" | "terminal" | "unavailable"
  readonly phase: KimiAttemptPrivatePhase
  readonly terminal?: PlannedAttemptExecutorResult
  readonly sessionClosed: boolean
}

type JsonRecord = Record<string, unknown>

const hexRadix = 16
const hexByteWidth = 2
const maximumSuspensionObservations = 4
const suspensionObservationInterval = "100 millis"

const isJsonRecord = (value: unknown): value is JsonRecord => typeof value === "object" && value !== null

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

const textFrom = (observation: KimiAcpSessionObservation): string | undefined => observation.lastMessage

const commitFromMessage = (
  message: string | undefined,
  correlation: PlannedAttemptExecutorCorrelation
): GitCommitSha | undefined => {
  if (message === undefined) return undefined
  try {
    const value: unknown = JSON.parse(message)
    if (!isJsonRecord(value)) return undefined
    const record = value
    const nested = record["correlation"]
    if (!isJsonRecord(nested)) return undefined
    const nestedRecord = nested
    if (nestedRecord["runId"] !== correlation.runId || nestedRecord["attemptId"] !== correlation.attemptId)
      return undefined
    const commit = record["commit"]
    return typeof commit === "string" && /^[0-9a-f]{40}$/u.test(commit) ? GitCommitSha.make(commit) : undefined
  } catch {
    return undefined
  }
}

const sameBytes = (left: Uint8Array, right: Uint8Array): boolean =>
  left.byteLength === right.byteLength && left.every((value, index) => value === right[index])

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

const publishEvidence = Effect.fn("KimiPlannedAttemptExecutor.publishEvidence")(function* (
  crypto: Crypto.Crypto,
  evidence: EvidenceStore["Service"],
  commit: GitCommitSha,
  correlation: PlannedAttemptExecutorCorrelation
) {
  const manifest = AcceptedResultEvidenceManifest.make({
    commit,
    correlation,
    formatVersion: 1,
    outcome: "Accepted",
    predecessor: null
  })
  const bytes = new TextEncoder().encode(JSON.stringify(manifest))
  const reference = yield* evidence.put(bytes)
  const reread = yield* evidence.read(reference)
  const digestBytes = yield* crypto.digest("SHA-256", reread)
  const digest = EvidenceDigest.make(
    Array.from(digestBytes, (value) => value.toString(hexRadix).padStart(hexByteWidth, "0")).join("")
  )
  if (!sameBytes(bytes, reread) || digest !== reference.digest) {
    return yield* Effect.fail(
      new KimiAcpFailure({
        detail: "Kimi accepted-result evidence could not be verified",
        kind: "Protocol",
        operation: "session/prompt"
      })
    )
  }
  return EvidenceReference.make({ byteLength: bytes.byteLength, digest })
})

const resultForTerminal = Effect.fn("KimiPlannedAttemptExecutor.resultForTerminal")(function* (
  state: AttemptState,
  observation: KimiAcpSessionObservation,
  git: Option.Option<GitCommand["Service"]>,
  evidence: Option.Option<EvidenceStore["Service"]>,
  crypto: Option.Option<Crypto.Crypto>
): Effect.fn.Return<PlannedAttemptExecutorResult, unknown, never> {
  const correlation = correlationForContext(state.attempt)
  const commit = commitFromMessage(textFrom(observation), correlation)
  if (Option.isNone(git) || Option.isNone(evidence) || Option.isNone(crypto)) {
    return PlannedAttemptExecutorResult.cases.Completed.make({})
  }
  const head = yield* readHead(git.value, state.attempt)
  if (Option.isNone(head)) return PlannedAttemptExecutorResult.cases.Failed.make({})
  const acceptedCommit =
    commit === undefined
      ? head.value === state.attempt.baseSha
        ? undefined
        : head.value
      : head.value === commit
        ? commit
        : null
  if (acceptedCommit === undefined) return PlannedAttemptExecutorResult.cases.Completed.make({})
  if (acceptedCommit === null) return PlannedAttemptExecutorResult.cases.Failed.make({})
  const reference = yield* publishEvidence(crypto.value, evidence.value, acceptedCommit, correlation)
  return PlannedAttemptExecutorResult.cases.Accepted.make({
    acceptedResult: { commit: acceptedCommit, evidenceManifest: reference }
  })
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

    const statusForPhase = (phase: KimiAttemptPrivatePhase): AttemptState["status"] => {
      switch (phase) {
        case "Suspended":
          return "suspended"
        case "Terminal":
          return "terminal"
        case "Unavailable":
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
      if (
        context.attemptId !== record.attemptId ||
        context.runId !== record.runId ||
        context.worktree !== record.worktree ||
        context.executor !== record.executor
      ) {
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
      if (record.phase !== "Unavailable" && !(record.phase === "Terminal" && record.sessionClosed === true)) {
        yield* client.loadSession(record.sessionId, record.worktree).pipe(Effect.mapError((error) => error))
      }
      const state: AttemptState = {
        attempt: context,
        phase: record.phase,
        sessionId: record.sessionId,
        status: statusForPhase(record.phase),
        ...(record.terminal === undefined ? {} : { terminal: record.terminal }),
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

    const observeClient = (state: AttemptState) => client.observe(state.sessionId)
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
      state: AttemptState
    ): Effect.fn.Return<PlannedAttemptExecutorProjection, unknown, never> {
      if (state.phase === "Terminal" && state.terminal !== undefined && state.sessionClosed) {
        return PlannedAttemptExecutorProjection.cases.Exact.make({ report: terminal(correlation, state.terminal) })
      }
      const observed = yield* observeClient(state)
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
        const result = state.terminal ?? (yield* resultForTerminal(state, observed, git, evidence, crypto))
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
        if (existing.phase === "SessionCreated") {
          const intent = { ...existing, phase: "PromptIntentRecorded" as const, status: "executing" as const }
          yield* putAndPersist(intent)
          yield* client
            .prompt(existing.sessionId, request.specification.body)
            .pipe(Effect.mapError((error) => commandFailure("Begin", correlation, error)))
          yield* putAndPersist({ ...intent, phase: "Executing" as const })
          return executing(correlation)
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
      const intent = { ...fresh, phase: "PromptIntentRecorded" as const }
      yield* putAndPersist(intent)
      yield* client
        .prompt(sessionId, request.specification.body)
        .pipe(Effect.mapError((error) => commandFailure("Begin", correlation, error)))
      yield* putAndPersist({ ...intent, phase: "Executing" as const })
      return executing(correlation)
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
      const promptIntent = { ...resumeIntent, phase: "PromptIntentRecorded" as const }
      yield* putAndPersist(promptIntent)
      yield* client
        .prompt(existing.sessionId, request.specification.body)
        .pipe(Effect.mapError((error) => commandFailure("Resume", correlation, error)))
      yield* putAndPersist({ ...promptIntent, phase: "Executing" as const, status: "executing" as const })
      return executing(correlation)
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
