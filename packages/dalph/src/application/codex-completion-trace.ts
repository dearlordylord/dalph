import { Effect, Logger } from "effect"

/** Completion diagnostics use stderr so production child stdout remains canonical public NDJSON. */
const completionTraceLogger = Logger.withConsoleError(Logger.make(({ message }) => String(message)))

export const logCodexCompletionTrace = (record: Readonly<Record<string, unknown>>) =>
  Effect.logInfo(JSON.stringify(record)).pipe(Effect.provide(Logger.layer([completionTraceLogger])))
