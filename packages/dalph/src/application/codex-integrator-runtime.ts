import { Effect, Schema } from "effect"
import { CodexThreadWorkingDirectory, type CodexAppServer, type CodexThreadSnapshot } from "./codex-app-server.js"
import type { CodexThreadId } from "./codex-attempt-store.js"
import type { IntegratorCandidateWorktreePath } from "./codex-integrator-private-store.js"

/** Provider boundary failures deliberately expose only a safe detail string. */
export class CodexIntegratorProviderFailure extends Schema.TaggedError<CodexIntegratorProviderFailure>()(
  "CodexIntegratorProviderFailure",
  { detail: Schema.String }
) {}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value)

export const errorDetail = (error: unknown): string => {
  if (isRecord(error) && typeof error["detail"] === "string" && error["detail"].length > 0) {
    return error["detail"]
  }
  if (error instanceof Error && error.message.length > 0) return error.message
  const rendered = String(error)
  return rendered.length > 0 ? rendered : "provider boundary failed without detail"
}

export const providerFailure = (detail: string): CodexIntegratorProviderFailure =>
  new CodexIntegratorProviderFailure({ detail })

export const boundary = <A, E, R>(
  effect: Effect.Effect<A, E, R>
): Effect.Effect<A, CodexIntegratorProviderFailure, R> =>
  effect.pipe(Effect.mapError((error) => providerFailure(errorDetail(error))))

/** Re-read a provider thread and accept it only when its id and candidate cwd are exact. */
export const observedThread = (
  app: CodexAppServer["Service"],
  threadId: CodexThreadId,
  candidatePath: IntegratorCandidateWorktreePath
): Effect.Effect<CodexThreadSnapshot, CodexIntegratorProviderFailure> =>
  boundary(app.resumeThread(threadId, candidatePath)).pipe(
    Effect.flatMap((thread) =>
      thread.id !== threadId ||
      thread.cwd !== CodexThreadWorkingDirectory.make(candidatePath) ||
      thread.correlation !== undefined
        ? Effect.fail(providerFailure("Codex thread identity or cwd is foreign"))
        : Effect.succeed(thread)
    )
  )
