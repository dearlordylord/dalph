/* eslint-disable import/no-nodejs-modules -- native qualification owns process stdout. */
import nodeProcess from "node:process"
import type { PlannedAttemptExecutorProjection, PlannedAttemptExecutorReport } from "@dalph/contracts"
import { Cause, Effect, Exit, Logger, Schema } from "effect"
import { qualificationFailureDetail } from "../src/qualification/codex-census-diagnostic.js"
import { CodexQualificationHostEvent } from "./codex-qualification-host-contract.js"

export const writeEvent = (value: unknown): Effect.Effect<void, never> =>
  Schema.decodeUnknownEffect(CodexQualificationHostEvent)(value).pipe(
    Effect.flatMap((event) => Effect.sync(() => nodeProcess.stdout.write(`${JSON.stringify(event)}\n`))),
    Effect.orDie
  )

export const reportEvent = (
  command: "Begin" | "Observe" | "Resume" | "Suspend" | "ContinueRejectedResult",
  report: PlannedAttemptExecutorReport
) => ({ event: "report" as const, command, report })

export const projectionEvent = (projection: PlannedAttemptExecutorProjection) => ({
  event: "projection" as const,
  projection
})

/** Complete one native qualification process without discarding its typed detail. */
export const runQualificationProgram = (program: Effect.Effect<unknown, unknown>): void => {
  void Effect.runPromiseExit(program.pipe(Effect.provideService(Logger.LogToStderr, true)))
    .then((exit) => {
      if (Exit.isSuccess(exit)) return
      const detail = qualificationFailureDetail(Cause.squash(exit.cause)) || Cause.pretty(exit.cause)
      nodeProcess.stdout.write(`${JSON.stringify({ event: "failure", detail })}\n`)
      nodeProcess.exitCode = 70
    })
    .catch((cause: unknown) => {
      nodeProcess.stdout.write(`${JSON.stringify({ event: "failure", detail: qualificationFailureDetail(cause) })}\n`)
      nodeProcess.exitCode = 70
    })
}
