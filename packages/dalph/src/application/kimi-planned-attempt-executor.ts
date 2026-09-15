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
  type PlannedAttemptExecutorCorrelation,
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

type AttemptState = {
  readonly attempt: PlannedTaskAttempt
  readonly sessionId: KimiAcpSessionId
  readonly status: "executing" | "suspended" | "terminal" | "unavailable"
  readonly terminal?: PlannedAttemptExecutorResult
}

type JsonRecord = Record<string, unknown>
const hexRadix = 16
const hexByteWidth = 2
const maximumSuspensionObservations = 4
const suspensionObservationInterval = "100 millis"

const isJsonRecord = (value: unknown): value is JsonRecord => typeof value === "object" && value !== null

const correlationOf = plannedAttemptExecutorCorrelation

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
  attempt: PlannedTaskAttempt
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
  const correlation = correlationOf(state.attempt)
  const commit = commitFromMessage(textFrom(observation), correlation)
  if (commit === undefined || Option.isNone(git) || Option.isNone(evidence) || Option.isNone(crypto)) {
    return PlannedAttemptExecutorResult.cases.Completed.make({})
  }
  const head = yield* readHead(git.value, state.attempt)
  if (Option.isNone(head) || head.value !== commit) return PlannedAttemptExecutorResult.cases.Failed.make({})
  const reference = yield* publishEvidence(crypto.value, evidence.value, commit, correlation)
  return PlannedAttemptExecutorResult.cases.Accepted.make({ acceptedResult: { commit, evidenceManifest: reference } })
})

/** Kimi ACP implementation of the provider-neutral planned-attempt boundary. */
export const kimiPlannedAttemptExecutorLayer = Layer.effectContext(
  Effect.gen(function* () {
    const client = yield* KimiAcpClient
    const states = yield* Ref.make<ReadonlyMap<string, AttemptState>>(new Map())
    const git = yield* Effect.serviceOption(GitCommand)
    const evidence = yield* Effect.serviceOption(EvidenceStore)
    const crypto = yield* Effect.serviceOption(Crypto.Crypto)

    const stateFor = (correlation: PlannedAttemptExecutorCorrelation) =>
      Ref.get(states).pipe(Effect.map((current) => current.get(plannedAttemptExecutorCorrelationKey(correlation))))
    const put = (state: AttemptState) =>
      Ref.update(
        states,
        (current) =>
          new Map([...current, [plannedAttemptExecutorCorrelationKey(correlationOf(state.attempt)), state] as const])
      )
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
      const observed = yield* observeClient(state)
      if (observed.status === "unavailable") {
        yield* put({ ...state, status: "unavailable" })
        return PlannedAttemptExecutorProjection.cases.TemporarilyUnavailable.make({ correlation })
      }
      if (observed.status === "executing") {
        yield* put({ ...state, status: "executing" })
        return PlannedAttemptExecutorProjection.cases.Exact.make({ report: executing(correlation) })
      }
      if (observed.status === "idle" && state.status === "suspended") {
        return PlannedAttemptExecutorProjection.cases.Exact.make({ report: suspended(correlation) })
      }
      if (observed.status === "terminal") {
        const result = state.terminal ?? (yield* resultForTerminal(state, observed, git, evidence, crypto))
        yield* put({ ...state, status: "terminal", terminal: result })
        return PlannedAttemptExecutorProjection.cases.Exact.make({ report: terminal(correlation, result) })
      }
      return PlannedAttemptExecutorProjection.cases.Exact.make({ report: executing(correlation) })
    })

    const begin = Effect.fn("KimiPlannedAttemptExecutor.begin")(function* (request: PlannedAttemptExecutorRequest) {
      const attempt = request.plannedAttempt
      const correlation = correlationOf(attempt)
      const existing = yield* stateFor(correlation)
      if (existing !== undefined) {
        const result = yield* projection(correlation, existing)
        return result._tag === "Exact" ? result.report : executing(correlation)
      }
      yield* client
        .initialize(attempt.worktree)
        .pipe(Effect.mapError((error) => commandFailure("Begin", correlation, error)))
      const sessionId = yield* client.newSession(attempt.worktree)
      const fresh: AttemptState = { attempt, sessionId, status: "executing" }
      // The session is retained in the adapter state before the prompt crosses ACP.
      yield* put(fresh)
      yield* client
        .prompt(sessionId, request.specification.body)
        .pipe(Effect.mapError((error) => commandFailure("Begin", correlation, error)))
      return executing(correlation)
    })

    const suspend = Effect.fn("KimiPlannedAttemptExecutor.suspend")(function* (attempt: PlannedTaskAttempt) {
      const correlation = correlationOf(attempt)
      const existing = yield* stateFor(correlation)
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
      const next = { ...existing, status: "suspended" as const }
      yield* put(next)
      return suspended(correlation)
    })

    const resume = Effect.fn("KimiPlannedAttemptExecutor.resume")(function* (request: PlannedAttemptExecutorRequest) {
      const attempt = request.plannedAttempt
      const correlation = correlationOf(attempt)
      const existing = yield* stateFor(correlation)
      if (existing === undefined)
        return yield* Effect.fail(commandFailure("Resume", correlation, "Kimi session is unknown"))
      yield* client
        .resumeSession(existing.sessionId, attempt.worktree)
        .pipe(Effect.mapError((error) => commandFailure("Resume", correlation, error)))
      yield* client
        .prompt(existing.sessionId, request.specification.body)
        .pipe(Effect.mapError((error) => commandFailure("Resume", correlation, error)))
      yield* put({ ...existing, status: "executing" })
      return executing(correlation)
    })

    const executor = PlannedAttemptExecutor.of({
      observe: (correlation, _purpose): Effect.Effect<PlannedAttemptExecutorProjection> => {
        const state = stateFor(correlation)
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
