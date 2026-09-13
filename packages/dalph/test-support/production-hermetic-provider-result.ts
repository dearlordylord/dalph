import { GitCommitSha, PlannedAttemptExecutorCorrelation } from "@dalph/contracts"
import { GitCommand } from "@dalph/orchestrator"
import { Effect, FileSystem, Schema } from "effect"
import { CodexAppServerFailure } from "../src/application/codex-app-server.js"
import type { ProductionRepositoryHostConfiguration } from "../src/application/production-configuration.js"

export const providerFailure = (
  operation: "thread/start" | "thread/read" | "thread/resume" | "turn/start",
  detail: string
) => new CodexAppServerFailure({ operation, kind: "Protocol", detail })

const promptFact = (text: string, name: string) => {
  const prefix = `${name}: `
  const entries = text.split("\n").filter((line) => line.startsWith(prefix))
  return entries.length === 1 ? entries[0]?.slice(prefix.length) : undefined
}

/** Controlled result production uses the original real planned worktrees and verifies C/M ancestry. */
export const makeHermeticProviderResult = Effect.fn("HermeticProvider.makeResult")(function* (
  configuration: ProductionRepositoryHostConfiguration
) {
  const fileSystem = yield* FileSystem.FileSystem
  const git = yield* GitCommand
  const runGit = Effect.fn("HermeticProvider.runGit")(function* (cwd: string, args: ReadonlyArray<string>) {
    const result = yield* git.runInWorktree(cwd, args)
    if (result.exitCode !== 0) return yield* providerFailure("turn/start", "controlled Git command failed")
    return result.stdout.trim()
  })
  const produceIntegrationResult = Effect.fn("HermeticProvider.produceIntegrationResult")(function* (
    cwd: string,
    text: string
  ) {
    if (
      !cwd.startsWith(`${configuration.integratorCandidateWorktreeRoot}/`) ||
      promptFact(text, "Candidate worktree") !== cwd
    )
      return yield* providerFailure("turn/start", "foreign candidate worktree")
    const head = yield* Schema.decodeUnknownEffect(GitCommitSha)(promptFact(text, "Unchanged target head H"))
    const accepted = yield* Schema.decodeUnknownEffect(GitCommitSha)(promptFact(text, "Accepted commit C"))
    if ((yield* runGit(cwd, ["rev-parse", "HEAD"])) !== head)
      return yield* providerFailure("turn/start", "candidate head differs from supplied H")
    yield* runGit(cwd, [
      "-c",
      "user.name=Hermetic provider",
      "-c",
      "user.email=hermetic@example.invalid",
      "merge",
      "--no-ff",
      "--no-edit",
      accepted
    ])
    const candidate = yield* Schema.decodeUnknownEffect(GitCommitSha)(yield* runGit(cwd, ["rev-parse", "HEAD"]))
    if ((yield* runGit(cwd, ["show", "-s", "--format=%P", candidate])) !== `${head} ${accepted}`)
      return yield* providerFailure("turn/start", "candidate parents differ from H C")
    return JSON.stringify({ version: 1, outcome: "PreparedCandidate", candidate })
  })
  const produceTaskResult = Effect.fn("HermeticProvider.produceTaskResult")(function* (cwd: string, text: string) {
    if (!cwd.startsWith(`${configuration.plannedAttemptWorktreeRoot}/`) || promptFact(text, "worktree") !== cwd)
      return yield* providerFailure("turn/start", "foreign task worktree")
    const correlation = yield* Schema.decodeUnknownEffect(PlannedAttemptExecutorCorrelation)({
      runId: promptFact(text, "run_id"),
      attemptId: promptFact(text, "attempt_id")
    })
    const base = yield* Schema.decodeUnknownEffect(GitCommitSha)(promptFact(text, "base_sha"))
    if (base !== configuration.plannedAttemptBaseSha || (yield* runGit(cwd, ["rev-parse", "HEAD"])) !== base)
      return yield* providerFailure("turn/start", "task head differs from planned Base")
    yield* fileSystem.writeFileString(`${cwd}/hermetic-result.txt`, "Controlled immutable accepted result.\n")
    yield* runGit(cwd, ["add", "hermetic-result.txt"])
    yield* runGit(cwd, [
      "-c",
      "user.name=Hermetic provider",
      "-c",
      "user.email=hermetic@example.invalid",
      "commit",
      "-m",
      "controlled accepted result"
    ])
    const commit = yield* Schema.decodeUnknownEffect(GitCommitSha)(yield* runGit(cwd, ["rev-parse", "HEAD"]))
    return JSON.stringify({ commit, correlation })
  })
  const produceResult = Effect.fn("HermeticProvider.produceResult")(function* (cwd: string, text: string) {
    return yield* text.startsWith("You are the Dalph integration provider.\n")
      ? produceIntegrationResult(cwd, text)
      : produceTaskResult(cwd, text)
  })
  return produceResult
})
