import { AttemptId, RunId } from "@dalph/contracts"
import { Effect, Stream } from "effect"
import { describe, expect, it } from "vitest"
import {
  CodexAppServer,
  CodexAppServerFailure,
  CodexThreadWorkingDirectory,
  type CodexAppServerService,
  type CodexThreadSnapshot
} from "./codex-app-server.js"
import { CodexServerIncarnation, CodexThreadId } from "./codex-attempt-store.js"
import { IntegratorCandidateWorktreePath } from "./codex-integrator-private-store.js"
import { errorDetail, observedThread } from "./codex-integrator-runtime.js"

const threadId = CodexThreadId.make("runtime-thread")
const candidatePath = IntegratorCandidateWorktreePath.make("/tmp/runtime-candidate")
const exactThread: CodexThreadSnapshot = {
  id: threadId,
  cwd: CodexThreadWorkingDirectory.make(candidatePath),
  status: "idle",
  turns: []
}

const appFor = (resume: CodexAppServerService["resumeThread"]): CodexAppServerService =>
  CodexAppServer.of({
    attachOwnedActivityHints: Effect.succeed(Stream.empty),
    attachTurnCompletedHints: Effect.succeed(Stream.empty),
    incarnation: CodexServerIncarnation.make("runtime-incarnation"),
    startThread: () => Effect.succeed(exactThread),
    readThread: () => Effect.succeed(exactThread),
    resumeThread: resume,
    startTurn: () => Effect.die("unused"),
    interruptTurn: () => Effect.void,
    listBackgroundTerminals: () => Effect.succeed([]),
    terminateBackgroundTerminal: () => Effect.succeed(true),
    close: Effect.void
  })

describe("Codex Integrator runtime boundary", () => {
  it("renders typed, native, and foreign failures without leaking payloads", () => {
    expect(errorDetail({ detail: "typed detail" })).toBe("typed detail")
    expect(errorDetail({ detail: "" })).toBe("[object Object]")
    expect(errorDetail({ detail: 42 })).toBe("[object Object]")
    expect(errorDetail(new Error("native detail"))).toBe("native detail")
    expect(errorDetail(new Error(""))).toBe("Error")
    expect(errorDetail({ toString: () => "" })).toBe("provider boundary failed without detail")
    expect(errorDetail(null)).toBe("null")
  })

  it("accepts only the exact resumed thread identity", async () => {
    const exact = await Effect.runPromise(
      observedThread(
        appFor(() => Effect.succeed(exactThread)),
        threadId,
        candidatePath
      )
    )
    expect(exact).toBe(exactThread)

    const foreignId = await Effect.runPromise(
      Effect.exit(
        observedThread(
          appFor(() => Effect.succeed({ ...exactThread, id: CodexThreadId.make("foreign-thread") })),
          threadId,
          candidatePath
        )
      )
    )
    const foreignCwd = await Effect.runPromise(
      Effect.exit(
        observedThread(
          appFor(() =>
            Effect.succeed({ ...exactThread, cwd: CodexThreadWorkingDirectory.make("/tmp/foreign-candidate") })
          ),
          threadId,
          candidatePath
        )
      )
    )
    const foreignCorrelation = await Effect.runPromise(
      Effect.exit(
        observedThread(
          appFor(() =>
            Effect.succeed({
              ...exactThread,
              correlation: { runId: RunId.make("foreign"), attemptId: AttemptId.make("foreign") }
            })
          ),
          threadId,
          candidatePath
        )
      )
    )
    const boundaryFailure = await Effect.runPromise(
      Effect.exit(
        observedThread(
          appFor(() =>
            Effect.fail(
              new CodexAppServerFailure({ operation: "thread/resume", kind: "Unavailable", detail: "offline" })
            )
          ),
          threadId,
          candidatePath
        )
      )
    )
    expect(Effect.isEffect(exact)).toBe(false)
    expect(String(foreignId)).toContain("CodexIntegratorProviderFailure")
    expect(String(foreignCwd)).toContain("CodexIntegratorProviderFailure")
    expect(String(foreignCorrelation)).toContain("CodexIntegratorProviderFailure")
    expect(String(boundaryFailure)).toContain("CodexIntegratorProviderFailure")
  })
})
