/* eslint-disable import/no-nodejs-modules -- Qualification reads bounded native process metadata, never provider payloads. */
import { execFile } from "node:child_process"
import type { PlannedAttemptExecutorCorrelation } from "@dalph/contracts"
import { Effect, Layer, Option, Ref } from "effect"
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
