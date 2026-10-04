import type { PlannedAttemptExecutorCorrelation } from "@dalph/contracts"
import { Effect, Layer, Option, Ref } from "effect"
import {
  CodexAppServer,
  CodexOwnedActivityCensus,
  makeNodeCodexOwnedActivityCensusService
} from "../application/codex-app-server.js"
import type { CodexAttemptStoreService } from "../application/codex-attempt-store.js"

/** Qualification retains census tags only and delegates every production boundary unchanged. */
export const makeQualificationCensusDiagnostic = Effect.gen(function* () {
  const lastCensus = yield* Ref.make("Unavailable")
  const layer = Layer.effect(
    CodexOwnedActivityCensus,
    Effect.map(CodexAppServer, (app) => {
      const census = makeNodeCodexOwnedActivityCensusService(undefined, app.serverPid, app.incarnation)
      return {
        ...census,
        observe: (...args: Parameters<typeof census.observe>) =>
          census
            .observe(...args)
            .pipe(
              Effect.tap((observation) =>
                Ref.set(
                  lastCensus,
                  `${observation._tag}/thread=${args[0].status}/settled=${args[3] === true}${
                    observation._tag === "ExactLive"
                      ? `/activities=${[...new Set(observation.activities.map((activity) => activity._tag))].join(",")}`
                      : ""
                  }`
                )
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
