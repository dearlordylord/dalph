import { CodexThreadId, CodexTurnId } from "../src/application/codex-attempt-store.js"
import {
  ExecutorGuidanceRequestId,
  type PlannedAttemptExecutorService,
  type PlannedTaskAttempt
} from "@dalph/contracts"
import { Effect, Option, Schema } from "effect"
import { CodexClientUserMessageId, type CodexAppServerService } from "../src/application/codex-app-server.js"
import type { CodexAttemptStoreService } from "../src/application/codex-attempt-store.js"
import { awaitQualificationGuidanceSelection } from "../src/qualification/codex-guidance-readiness.js"

class NativeGuidanceFailure extends Schema.TaggedError<NativeGuidanceFailure>()("NativeGuidanceFailure", {
  detail: Schema.String
}) {}

/** Observe native steering through the existing owner before its enclosing scope closes. */
export const exerciseNativeGuidance = (
  executor: PlannedAttemptExecutorService,
  app: CodexAppServerService,
  attempt: PlannedTaskAttempt,
  store: CodexAttemptStoreService,
  writeEvent: (value: unknown) => Effect.Effect<void>,
  settle: Effect.Effect<void, unknown>,
  censusDiagnostic: Effect.Effect<string>,
  fixtureReady: Effect.Effect<void>
): Effect.Effect<void, unknown> =>
  Effect.gen(function* () {
    const select = executor.selectGuidanceTarget
    const send = executor.sendGuidance
    if (select === undefined || send === undefined)
      return yield* new NativeGuidanceFailure({ detail: "native guidance capability unavailable" })
    // Begin identifies T1 before its first model request necessarily arrives.
    // The fixture releases this read-only exercise after observing that request.
    yield* fixtureReady.pipe(
      Effect.timeoutOrElse({
        duration: "10 seconds",
        orElse: () => new NativeGuidanceFailure({ detail: "guidance fixture readiness not released" })
      })
    )
    const launch = yield* store.readServerLaunch()
    const selected = yield* awaitQualificationGuidanceSelection(select(attempt), censusDiagnostic)
    if (selected._tag !== "Selected")
      return yield* new NativeGuidanceFailure({
        detail: `native active guidance target refused: ${selected.reason}/census=${yield* censusDiagnostic}`
      })
    yield* writeEvent({
      event: "guidance",
      phase: "Active",
      sameOwner: Option.isSome(launch),
      disposition: yield* send(
        selected.target,
        ExecutorGuidanceRequestId.make("native-guidance-active"),
        "Informational guidance: preserve the original task and its Base."
      )
    })
    yield* settle
    const disposition = yield* send(
      selected.target,
      ExecutorGuidanceRequestId.make("native-guidance-completed"),
      "This must not reopen the completed turn."
    )
    const steer = app.steerTurn
    if (steer === undefined) return yield* new NativeGuidanceFailure({ detail: "native steer operation unavailable" })
    // Exercise Codex's own expected-turn precondition after the adapter has already
    // refused the completed target, using the same retained provider and T1.
    const providerResult = yield* steer(
      CodexThreadId.make(selected.target.session),
      CodexTurnId.make(selected.target.turn),
      "This completed turn must reject input.",
      CodexClientUserMessageId.make("native-guidance-provider-precondition")
    ).pipe(Effect.result)
    if (providerResult._tag !== "Failure")
      return yield* new NativeGuidanceFailure({ detail: "native completed turn accepted steering" })
    if (providerResult.failure.operation !== "turn/steer" || providerResult.failure.kind !== "Protocol")
      return yield* new NativeGuidanceFailure({
        detail: `native completed turn returned ${providerResult.failure.kind}`
      })
    const currentLaunch = yield* store.readServerLaunch()
    yield* writeEvent({
      event: "guidance",
      phase: "Completed",
      providerPreconditionRejected: true,
      disposition,
      sameOwner:
        Option.isSome(launch) &&
        Option.isSome(currentLaunch) &&
        launch.value.incarnation === currentLaunch.value.incarnation &&
        launch.value.pid === currentLaunch.value.pid
    })
  })
