import { Effect } from "effect"
import {
  targetVerificationCorrelationEquals,
  type TargetVerificationRequestId,
  type TargetVerificationRequest,
  type TargetVerificationTerminal
} from "../../workflow/protocols/target-verification/events.js"
import {
  decodeTerminal,
  parseWrapperMessage,
  RepositoryVerificationRun,
  RepositoryVerificationTerminalObservation,
  RepositoryVerificationWrapperFailure,
  RepositoryVerificationWrapperInterrupted,
  type FailedObservation,
  type InterruptedObservation,
  type RepositoryVerificationObservation,
  type RepositoryVerificationWrapperMessage
} from "./repository-resource-lock-protocol.js"

type LifecyclePhase = "Initial" | "Waiting" | "Acquired" | "Terminal" | "Interrupted" | "Failed" | "Released"
type LifecycleOutcome = "None" | "Terminal" | "Interrupted" | "Failed"

interface LifecycleState {
  readonly acquired: boolean
  readonly observations: ReadonlyArray<RepositoryVerificationObservation>
  readonly outcome: LifecycleOutcome
  readonly phase: LifecyclePhase
  readonly terminal: TargetVerificationTerminal | null
}

const initialLifecycleState: LifecycleState = {
  acquired: false,
  observations: [],
  outcome: "None",
  phase: "Initial",
  terminal: null
}

const appendObservation = (
  state: LifecycleState,
  phase: LifecyclePhase,
  observation: RepositoryVerificationObservation,
  outcome: LifecycleOutcome = state.outcome,
  terminal: TargetVerificationTerminal | null = state.terminal
): LifecycleState => ({
  acquired: state.acquired || phase === "Acquired" || state.phase === "Acquired",
  observations: [...state.observations, observation],
  outcome,
  phase,
  terminal
})

const wrapperFailure = (
  requestId: TargetVerificationRequestId,
  state: LifecycleState,
  detail: string
): RepositoryVerificationWrapperFailure =>
  new RepositoryVerificationWrapperFailure({ detail, observations: [...state.observations], requestId })

const wrapperInterrupted = (
  requestId: TargetVerificationRequestId,
  state: LifecycleState,
  detail: string,
  signal: string
): RepositoryVerificationWrapperInterrupted =>
  new RepositoryVerificationWrapperInterrupted({ detail, observations: [...state.observations], requestId, signal })

const transitionWaiting = (
  state: LifecycleState,
  message: Extract<RepositoryVerificationWrapperMessage, { readonly _tag: "Waiting" }>,
  requestId: TargetVerificationRequestId
): Effect.Effect<LifecycleState, RepositoryVerificationWrapperFailure> =>
  message.requestId !== requestId || state.phase !== "Initial"
    ? Effect.fail(wrapperFailure(requestId, state, "wrapper emitted duplicate or late waiting"))
    : Effect.succeed(appendObservation(state, "Waiting", message))

const transitionAcquired = (
  state: LifecycleState,
  message: Extract<RepositoryVerificationWrapperMessage, { readonly _tag: "Acquired" }>,
  requestId: TargetVerificationRequestId
): Effect.Effect<LifecycleState, RepositoryVerificationWrapperFailure> =>
  message.requestId !== requestId || (state.phase !== "Initial" && state.phase !== "Waiting")
    ? Effect.fail(wrapperFailure(requestId, state, "wrapper emitted duplicate or late acquisition"))
    : Effect.succeed({ ...appendObservation(state, "Acquired", message), acquired: true })

const transitionTerminal = (
  state: LifecycleState,
  message: Extract<RepositoryVerificationWrapperMessage, { readonly _tag: "Terminal" }>,
  request: TargetVerificationRequest
) => {
  if (state.phase !== "Acquired") {
    return Effect.fail(wrapperFailure(request.requestId, state, "wrapper emitted terminal before acquisition"))
  }
  if (!targetVerificationCorrelationEquals(request, message.result.correlation)) {
    return Effect.fail(wrapperFailure(request.requestId, state, "wrapper emitted a foreign terminal correlation"))
  }
  return decodeTerminal(message.result, request.requestId, state.observations).pipe(
    Effect.map((terminal) =>
      appendObservation(
        state,
        "Terminal",
        RepositoryVerificationTerminalObservation.make({ terminal }),
        "Terminal",
        terminal
      )
    )
  )
}

const transitionInterrupted = (
  state: LifecycleState,
  message: Extract<RepositoryVerificationWrapperMessage, { readonly _tag: "Interrupted" }>,
  requestId: TargetVerificationRequestId
): Effect.Effect<LifecycleState, RepositoryVerificationWrapperFailure> =>
  message.requestId !== requestId ||
  state.phase === "Terminal" ||
  state.phase === "Interrupted" ||
  state.phase === "Failed" ||
  state.phase === "Released"
    ? Effect.fail(wrapperFailure(requestId, state, "wrapper emitted interruption after settling"))
    : Effect.succeed(appendObservation(state, "Interrupted", message, "Interrupted"))

const transitionFailed = (
  state: LifecycleState,
  message: Extract<RepositoryVerificationWrapperMessage, { readonly _tag: "Failed" }>,
  requestId: TargetVerificationRequestId
): Effect.Effect<LifecycleState, RepositoryVerificationWrapperFailure> =>
  message.requestId !== requestId ||
  state.phase === "Terminal" ||
  state.phase === "Interrupted" ||
  state.phase === "Failed" ||
  state.phase === "Released"
    ? Effect.fail(wrapperFailure(requestId, state, "wrapper emitted failure after settling"))
    : Effect.succeed(appendObservation(state, "Failed", message, "Failed"))

const transitionReleased = (
  state: LifecycleState,
  message: Extract<RepositoryVerificationWrapperMessage, { readonly _tag: "Released" }>,
  requestId: TargetVerificationRequestId
): Effect.Effect<LifecycleState, RepositoryVerificationWrapperFailure> =>
  message.requestId !== requestId ||
  !state.acquired ||
  (state.phase !== "Terminal" && state.phase !== "Interrupted" && state.phase !== "Failed")
    ? Effect.fail(wrapperFailure(requestId, state, "wrapper emitted release without acquired ownership"))
    : Effect.succeed(appendObservation(state, "Released", message))

const transitionMessage = (
  state: LifecycleState,
  message: RepositoryVerificationWrapperMessage,
  request: TargetVerificationRequest
): Effect.Effect<LifecycleState, RepositoryVerificationWrapperFailure> => {
  switch (message._tag) {
    case "Waiting":
      return transitionWaiting(state, message, request.requestId)
    case "Acquired":
      return transitionAcquired(state, message, request.requestId)
    case "Terminal":
      return transitionTerminal(state, message, request)
    case "Interrupted":
      return transitionInterrupted(state, message, request.requestId)
    case "Failed":
      return transitionFailed(state, message, request.requestId)
    case "Released":
      return transitionReleased(state, message, request.requestId)
  }
}

export const wrapperInterruptedExitCode = 143
const sigintExitCode = 130
const sigkillExitCode = 137
const signalForExitCode = (exitCode: number): string | undefined =>
  exitCode === sigintExitCode
    ? "SIGINT"
    : exitCode === sigkillExitCode
      ? "SIGKILL"
      : exitCode === wrapperInterruptedExitCode
        ? "SIGTERM"
        : undefined

const interruptionFromState = (
  requestId: TargetVerificationRequestId,
  state: LifecycleState,
  exitCode: number,
  stderr: string
) => {
  const interrupted = state.observations.find(
    (observation): observation is InterruptedObservation => observation._tag === "Interrupted"
  )
  return wrapperInterrupted(
    requestId,
    state,
    interrupted?.detail ?? (stderr.trim() || "wrapper interrupted before a terminal result"),
    interrupted?.signal ?? signalForExitCode(exitCode) ?? "unknown"
  )
}

const failureFromState = (
  requestId: TargetVerificationRequestId,
  state: LifecycleState,
  detail: string
): RepositoryVerificationWrapperFailure => {
  const failed = state.observations.find(
    (observation): observation is FailedObservation => observation._tag === "Failed"
  )
  return wrapperFailure(requestId, state, failed?.detail ?? detail)
}

const reduceLifecycle = (
  request: TargetVerificationRequest,
  lines: ReadonlyArray<string>
): Effect.Effect<LifecycleState, RepositoryVerificationWrapperFailure> =>
  Effect.reduce(
    lines,
    () => initialLifecycleState,
    (state, line) =>
      parseWrapperMessage(line, request.requestId, state.observations).pipe(
        Effect.flatMap((message) => transitionMessage(state, message, request))
      )
  )

const settleIncomplete = (
  request: TargetVerificationRequest,
  state: LifecycleState,
  exitCode: number,
  stderr: string
): Effect.Effect<
  RepositoryVerificationRun,
  RepositoryVerificationWrapperFailure | RepositoryVerificationWrapperInterrupted
> => {
  const signal = signalForExitCode(exitCode)
  return signal === undefined
    ? Effect.fail(
        failureFromState(request.requestId, state, stderr.trim() || "wrapper did not provide a complete lifecycle")
      )
    : Effect.fail(interruptionFromState(request.requestId, state, exitCode, stderr))
}

const settleComplete = (
  request: TargetVerificationRequest,
  state: LifecycleState,
  exitCode: number,
  stderr: string
): Effect.Effect<RepositoryVerificationRun, RepositoryVerificationWrapperFailure> => {
  const terminal = state.terminal
  if (terminal === null) {
    return Effect.fail(failureFromState(request.requestId, state, "wrapper did not provide a terminal result"))
  }
  if (terminal._tag === "Passed" && exitCode !== 0) {
    return Effect.fail(
      failureFromState(request.requestId, state, stderr.trim() || `wrapper exited ${exitCode} after reporting Passed`)
    )
  }
  return Effect.succeed(RepositoryVerificationRun.make({ observations: [...state.observations], terminal }))
}

const settleLifecycle = (
  request: TargetVerificationRequest,
  state: LifecycleState,
  exitCode: number,
  stderr: string
): Effect.Effect<
  RepositoryVerificationRun,
  RepositoryVerificationWrapperFailure | RepositoryVerificationWrapperInterrupted
> => {
  if (state.outcome === "Interrupted")
    return Effect.fail(interruptionFromState(request.requestId, state, exitCode, stderr))
  if (state.outcome === "Failed")
    return Effect.fail(failureFromState(request.requestId, state, "wrapper reported failure"))
  return state.phase !== "Released" || state.terminal === null
    ? settleIncomplete(request, state, exitCode, stderr)
    : settleComplete(request, state, exitCode, stderr)
}

/** Validates the complete wrapper lifecycle before exposing a terminal result. */
export const validateRun = Effect.fn("RepositoryVerificationWrapper.validateRun")(function* (
  request: TargetVerificationRequest,
  lines: ReadonlyArray<string>,
  exitCode: number,
  stderr: string
) {
  const state = yield* reduceLifecycle(request, lines)
  return yield* settleLifecycle(request, state, exitCode, stderr)
})
