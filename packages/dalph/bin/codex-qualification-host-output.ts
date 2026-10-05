/* eslint-disable import/no-nodejs-modules -- native qualification owns process stdout. */
import nodeProcess from "node:process"
import type { PlannedAttemptExecutorProjection, PlannedAttemptExecutorReport } from "@dalph/contracts"
import { Effect, Schema } from "effect"
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
