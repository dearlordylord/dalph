/* eslint-disable import/no-nodejs-modules -- Qualification reads bounded native process metadata, never provider payloads. */
import { execFile } from "node:child_process"
import type { PlannedAttemptExecutorCorrelation } from "@dalph/contracts"
import { Effect, Layer, Option, Ref, Schema } from "effect"
import {
  CodexAppServer,
  CodexOwnedActivityCensus,
  makeNodeCodexOwnedActivityCensusService
} from "../application/codex-app-server.js"
import type { CodexAttemptStoreService } from "../application/codex-attempt-store.js"

const missingThreadProcessMetadata = (detail: string): Effect.Effect<string> => {
  const pid = /process (\d+) has no exact Codex thread identity/.exec(detail)?.[1]
  if (pid === undefined) return Effect.succeed("")
  return Effect.promise(
    () =>
      new Promise<string>((resolve) => {
        execFile(
          "ps",
          ["-p", pid, "-o", "pid=,ppid=,pgid=,comm="],
          { timeout: 1000, maxBuffer: 4096 },
          (error, stdout) => {
            resolve(error === null ? `/process=${stdout.trim()}` : "/processMetadata=Unavailable")
          }
        )
      })
  )
}

/** Qualification retains bounded census metadata and delegates every production decision unchanged. */
export const makeQualificationCensusDiagnostic = Effect.gen(function* () {
  const lastCensus = yield* Ref.make("Unavailable")
  const layer = Layer.effect(
    CodexOwnedActivityCensus,
    Effect.map(CodexAppServer, (app) => {
      const census = makeNodeCodexOwnedActivityCensusService(undefined, app.serverPid, app.incarnation)
      return {
        ...census,
        observe: (...args: Parameters<typeof census.observe>) =>
          census.observe(...args).pipe(
            Effect.tap((observation) =>
              Effect.gen(function* () {
                const metadata =
                  observation._tag === "Unreadable" ? yield* missingThreadProcessMetadata(observation.detail) : ""
                yield* Ref.set(
                  lastCensus,
                  `${observation._tag}/thread=${args[0].status}/settled=${args[3] === true}${
                    observation._tag === "ExactLive"
                      ? `/activities=${[...new Set(observation.activities.map((activity) => activity._tag))].join(",")}`
                      : ""
                  }${metadata}`
                )
              })
            )
          )
      }
    })
  )
  return { lastCensus, layer }
})

/** Separate bounded postmortem read; an unavailable store cannot extend the observation deadline. */
export const readQualificationRetainedAttemptState = (
  store: CodexAttemptStoreService,
  correlation: PlannedAttemptExecutorCorrelation
) =>
  store.readAttempt(correlation.runId, correlation.attemptId).pipe(
    Effect.map((record) =>
      Option.isNone(record)
        ? "Missing"
        : record.value._tag === "Terminal"
          ? `Terminal/${record.value.terminal._tag}`
          : record.value._tag
    ),
    Effect.catch(() => Effect.succeed("Unreadable")),
    Effect.timeoutOption("1 second"),
    Effect.map(Option.getOrElse(() => "Unavailable"))
  )

export const qualificationFailureDetail = (cause: unknown): string => {
  const decoded = Schema.decodeUnknownOption(Schema.Struct({ detail: Schema.String }))(cause)
  return Option.isSome(decoded) ? decoded.value.detail : String(cause)
}

/** Status-only observation distinguishes retained Resume from dispatch without exposing provider payloads. */
export const qualificationResumeObservation = (
  store: CodexAttemptStoreService,
  app: CodexAppServer["Service"],
  correlation: PlannedAttemptExecutorCorrelation
) =>
  Effect.gen(function* () {
    const found = yield* store.readAttempt(correlation.runId, correlation.attemptId)
    if (Option.isNone(found) || !("threadId" in found.value))
      return {
        retainedState: Option.isNone(found) ? "Missing" : found.value._tag,
        threadStatus: "Unavailable",
        ownedTurnStatus: "Unavailable",
        persistedTurnStatus: "Unavailable"
      }
    const record = found.value
    const thread = yield* app.readThread(record.threadId)
    const turnId = "observedTurnId" in record ? record.observedTurnId : undefined
    const persisted = app.listThreadTurns === undefined ? thread.turns : yield* app.listThreadTurns(record.threadId)
    return {
      retainedState: record._tag,
      threadStatus: thread.status,
      ownedTurnStatus: thread.turns.find((turn) => turn.id === turnId)?.status ?? "Missing",
      persistedTurnStatus: persisted.find((turn) => turn.id === turnId)?.status ?? "Missing"
    }
  }).pipe(
    Effect.timeoutOption("1 second"),
    Effect.map(
      Option.getOrElse(() => ({
        retainedState: "Unavailable",
        threadStatus: "Unavailable",
        ownedTurnStatus: "Unavailable",
        persistedTurnStatus: "Unavailable"
      }))
    ),
    Effect.catch(() =>
      Effect.succeed({
        retainedState: "Unreadable",
        threadStatus: "Unreadable",
        ownedTurnStatus: "Unreadable",
        persistedTurnStatus: "Unreadable"
      })
    ),
    Effect.map((observation) => ({ event: "resume-observation", ...observation }))
  )
