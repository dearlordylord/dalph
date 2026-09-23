/* eslint-disable import/no-nodejs-modules -- this test correlates accepted S2 history with disposable real Git repositories. */

import { execFile as nodeExecFile } from "node:child_process"
import { mkdtemp, mkdir, readFile, realpath, rm, writeFile } from "node:fs/promises"
import nodePath from "node:path"
import nodeProcess from "node:process"

import { GitCommitSha } from "@dalph/contracts"
import { Context, Effect, Layer } from "effect"
import { describe, expect, it } from "vitest"
import { makeSuccessorPrefix } from "../../../../test/support/automatic-successor-history.js"
import { journalLayer } from "../../../coordination/delivery/journal.js"
import { reduceWorkflowJournalHistory } from "../../../coordination/reconstruction/history.js"
import { GitCommand, GitCommandInvocationFailure, type GitCommandResult } from "../../../authorities/git/command.js"
import { nodeGitRemoteBaselineLayer } from "../../../authorities/git/remote-baseline.js"
import { memoryJournalStoreLayer } from "../../../workflow-journal/adapters/memory-store.js"
import { JournalStore, type JournalRecord } from "../../../workflow-journal/store.js"
import type { RemoteBaselineReadIntendedEvent } from "./baseline-events.js"
import { establishRemoteBaseline } from "./baseline-protocol-engine.js"

const acceptedEndpoint = "ssh://git@example.invalid/repository.git"
const targetRef = "refs/heads/main"
const trackedFile = "tracked.txt"

type GitFixture = {
  readonly bareLocalRepository: boolean
  readonly localRepository: string
  readonly remoteRepository: string
  readonly root: string
  readonly targetWorktree: string
}

type LocalStateCase = {
  readonly name: string
  readonly setup: "ahead" | "diverged" | "dirty" | "symbolic" | "foreign" | "ambiguous" | "checked-out"
  readonly expectedObservation?: "LocalAhead" | "Diverged"
}

const localStateCases: ReadonlyArray<LocalStateCase> = [
  { expectedObservation: "LocalAhead", name: "local target is ahead of H2", setup: "ahead" },
  { expectedObservation: "Diverged", name: "local target diverges from H2", setup: "diverged" },
  { name: "clean local target is checked out", setup: "checked-out" },
  { name: "dirty checked-out target retains staged, unstaged, and file state", setup: "dirty" },
  { name: "target ref resolves through symbolic ownership", setup: "symbolic" },
  { name: "target branch is checked out in a foreign linked worktree", setup: "foreign" },
  { name: "worktree inventory is ambiguous", setup: "ambiguous" }
]

const runGit = (directory: string, ...args: ReadonlyArray<string>): Promise<GitCommandResult> =>
  new Promise((resolve, reject) => {
    nodeExecFile("git", ["-C", directory, ...args], { encoding: "utf8" }, (error, stdout, stderr) => {
      if (error === null) {
        resolve({ exitCode: 0, stderr, stdout })
      } else if (typeof error.code === "number") {
        resolve({ exitCode: error.code, stderr, stdout })
      } else {
        reject(error)
      }
    })
  })

const runBareGit = (directory: string, ...args: ReadonlyArray<string>): Promise<GitCommandResult> =>
  new Promise((resolve, reject) => {
    nodeExecFile("git", [`--git-dir=${directory}`, ...args], { encoding: "utf8" }, (error, stdout, stderr) => {
      if (error === null) {
        resolve({ exitCode: 0, stderr, stdout })
      } else if (typeof error.code === "number") {
        resolve({ exitCode: error.code, stderr, stdout })
      } else {
        reject(error)
      }
    })
  })

const successfulGit = async (directory: string, ...args: ReadonlyArray<string>): Promise<string> => {
  const result = await runGit(directory, ...args)
  expect(result.exitCode, `git ${args.join(" ")} stderr: ${result.stderr}`).toBe(0)
  return result.stdout.trim()
}

const successfulBareGit = async (directory: string, ...args: ReadonlyArray<string>): Promise<string> => {
  const result = await runBareGit(directory, ...args)
  expect(result.exitCode, `git --git-dir ${args.join(" ")} stderr: ${result.stderr}`).toBe(0)
  return result.stdout.trim()
}

const commit = async (directory: string, contents: string, message: string): Promise<string> => {
  await writeFile(nodePath.join(directory, trackedFile), contents)
  await successfulGit(directory, "add", trackedFile)
  await successfulGit(directory, "commit", "-m", message)
  return successfulGit(directory, "rev-parse", "HEAD")
}

const makeFixture = async (
  scenario: LocalStateCase
): Promise<{ readonly fixture: GitFixture; readonly h: string; readonly h2: string }> => {
  const root = await realpath(await mkdtemp(nodePath.join(nodeProcess.env["TMPDIR"] ?? "/tmp", "dalph-auto-s2-git-")))
  const sourceRepository = nodePath.join(root, "source")
  const remoteRepository = nodePath.join(root, "remote.git")
  const localRepository = nodePath.join(root, scenario.setup === "foreign" ? "local.git" : "local")
  const targetWorktree = scenario.setup === "foreign" ? nodePath.join(root, "foreign-worktree") : localRepository
  await Promise.all([mkdir(sourceRepository), mkdir(remoteRepository)])
  await successfulGit(sourceRepository, "init", "--initial-branch=main")
  await successfulGit(sourceRepository, "config", "user.email", "dalph@example.invalid")
  await successfulGit(sourceRepository, "config", "user.name", "Dalph automatic S2 real-Git safety")
  await successfulGit(remoteRepository, "init", "--bare")
  const h = await commit(sourceRepository, "H\n", "H")
  await successfulGit(sourceRepository, "push", remoteRepository, `${h}:${targetRef}`)
  await successfulBareGit(remoteRepository, "symbolic-ref", "HEAD", targetRef)

  const bareLocalRepository = scenario.setup === "foreign"
  if (scenario.setup === "ahead") {
    const h2 = await commit(sourceRepository, "H2\n", "H2")
    await successfulGit(sourceRepository, "push", remoteRepository, `${h2}:${targetRef}`)
    const clone = await runGit(root, "clone", remoteRepository, localRepository)
    expect(clone.exitCode, clone.stderr).toBe(0)
    await successfulGit(localRepository, "config", "user.email", "dalph@example.invalid")
    await successfulGit(localRepository, "config", "user.name", "Dalph automatic S2 real-Git safety")
    await commit(localRepository, "local-ahead\n", "local ahead")
    const fixture = { bareLocalRepository, localRepository, remoteRepository, root, targetWorktree }
    return { fixture, h, h2 }
  }

  if (bareLocalRepository) {
    const clone = await runGit(root, "clone", "--bare", remoteRepository, localRepository)
    expect(clone.exitCode, clone.stderr).toBe(0)
    const added = await runBareGit(localRepository, "worktree", "add", targetWorktree, "main")
    expect(added.exitCode, added.stderr).toBe(0)
  } else {
    const clone = await runGit(root, "clone", remoteRepository, localRepository)
    expect(clone.exitCode, clone.stderr).toBe(0)
    await successfulGit(localRepository, "config", "user.email", "dalph@example.invalid")
    await successfulGit(localRepository, "config", "user.name", "Dalph automatic S2 real-Git safety")
    if (scenario.setup === "diverged") await commit(localRepository, "local-divergent\n", "local divergence")
  }

  const h2 = await commit(sourceRepository, "H2\n", "H2")
  await successfulGit(sourceRepository, "push", remoteRepository, `${h2}:${targetRef}`)
  if (scenario.setup === "dirty") {
    await writeFile(nodePath.join(targetWorktree, trackedFile), "staged local edit\n")
    await successfulGit(targetWorktree, "add", trackedFile)
    await writeFile(nodePath.join(targetWorktree, trackedFile), "unstaged local edit\n")
  }
  if (scenario.setup === "symbolic") {
    await successfulGit(targetWorktree, "branch", "main-alias", h)
    await successfulGit(targetWorktree, "symbolic-ref", targetRef, "refs/heads/main-alias")
  }
  const fixture = { bareLocalRepository, localRepository, remoteRepository, root, targetWorktree }
  return { fixture, h, h2 }
}

const localGit = (fixture: GitFixture, ...args: ReadonlyArray<string>) =>
  fixture.bareLocalRepository ? runBareGit(fixture.localRepository, ...args) : runGit(fixture.localRepository, ...args)

const localGitText = async (fixture: GitFixture, ...args: ReadonlyArray<string>) => {
  const result = await localGit(fixture, ...args)
  expect(result.exitCode, `git ${args.join(" ")} stderr: ${result.stderr}`).toBe(0)
  return result.stdout.trim()
}

const snapshot = async (fixture: GitFixture) => {
  const indexPath = await successfulGit(
    fixture.targetWorktree,
    "rev-parse",
    "--path-format=absolute",
    "--git-path",
    "index"
  )
  const fileContents = await readFile(nodePath.join(fixture.targetWorktree, trackedFile), "utf8")
  const symbolicTarget = await localGit(fixture, "symbolic-ref", "--quiet", targetRef)
  return {
    fileContents,
    indexBytes: (await readFile(indexPath)).toString("hex"),
    stagedDiff: await successfulGit(fixture.targetWorktree, "diff", "--cached", "--binary"),
    status: await successfulGit(fixture.targetWorktree, "status", "--porcelain=v1", "--untracked-files=all"),
    symbolicTarget,
    unstagedDiff: await successfulGit(fixture.targetWorktree, "diff", "--binary")
  }
}

const makeCommands = (fixture: GitFixture, malformedInventory: boolean, commandLog: Array<ReadonlyArray<string>>) => {
  const invoke = (args: ReadonlyArray<string>) =>
    Effect.tryPromise({
      try: async () => {
        commandLog.push(args)
        if (malformedInventory && args[0] === "worktree" && args[1] === "list") {
          return {
            exitCode: 0,
            stderr: "",
            stdout: `worktree ${fixture.root}/duplicate\0branch ${targetRef}\0branch ${targetRef}\0\0`
          }
        }
        const translated = args.map((argument) => (argument === acceptedEndpoint ? fixture.remoteRepository : argument))
        return fixture.bareLocalRepository
          ? await runBareGit(fixture.localRepository, ...translated)
          : await runGit(fixture.localRepository, ...translated)
      },
      catch: () => new GitCommandInvocationFailure({ detail: "real Git command failed before producing a result" })
    })
  const commands = GitCommand.of({
    run: (_repository, args) => invoke(args),
    runBoundedInRepository: (_repository, args) => invoke(args),
    runBytesInWorktree: (_worktree, args) =>
      invoke(args).pipe(Effect.map((result) => ({ ...result, stdout: new TextEncoder().encode(result.stdout) }))),
    runInWorktree: (_worktree, args) => invoke(args)
  })
  return Layer.succeed(GitCommand, commands)
}

describe("automatic S2 real-Git catch-up safety", () => {
  it.each(localStateCases)("retains exact authorized S2 without changing Git state when $name", async (scenario) => {
    const { fixture, h, h2 } = await makeFixture(scenario)
    try {
      const prefix = makeSuccessorPrefix({
        competingHead: GitCommitSha.make(h2),
        expectedTargetHead: GitCommitSha.make(h)
      })
      const records = prefix.records()
      const authorization = records.find(({ event }) => event._tag === "IntegratorCompetingHeadSuccessorAuthorized")
      const readIntent = records.find(
        (record): record is JournalRecord & { readonly event: RemoteBaselineReadIntendedEvent } =>
          record.event._tag === "RemoteBaselineReadIntended"
      )
      if (
        authorization?.event._tag !== "IntegratorCompetingHeadSuccessorAuthorized" ||
        readIntent?.event._tag !== "RemoteBaselineReadIntended"
      ) {
        throw new Error("accepted S2 prefix must include its exact authorization and authorization-scoped baseline")
      }
      expect(readIntent.event.correlation.automaticCompetingHeadAuthorizationAt).toBe(authorization.position)
      expect(authorization.event.remoteHead).toBe(GitCommitSha.make(h2))
      const seed = records.filter(({ position }) => Number(position) < Number(readIntent.position))
      const context = await Effect.runPromise(Effect.scoped(Layer.build(memoryJournalStoreLayer)))
      const store = Context.get(context, JournalStore)
      const [beginning, ...remaining] = seed
      if (beginning?.event._tag !== "WorkflowRunBegan") throw new Error("S2 prefix must begin with its pinned Run")
      await Effect.runPromise(
        store.beginRun(
          prefix.runId,
          beginning.event.target,
          beginning.event.initialControlPolicy,
          beginning.event.remotePublicationTarget
        )
      )
      for (const record of remaining) {
        if (record.event._tag === "WorkflowRunBegan" || record.event._tag === "WorkflowRunTerminated") {
          throw new Error("authorization prefix cannot contain another Run lifecycle event")
        }
        await Effect.runPromise(store.append(prefix.runId, record.key, record.event))
      }

      const commandLog: Array<ReadonlyArray<string>> = []
      const commands = makeCommands(fixture, scenario.setup === "ambiguous", commandLog)
      const activate = () =>
        Effect.runPromise(
          Effect.scoped(
            Effect.gen(function* () {
              const persisted = yield* store.read(prefix.runId)
              const history = reduceWorkflowJournalHistory(prefix.runId, persisted)
              if (history._tag === "InvalidWorkflowJournalHistory") {
                return yield* Effect.die(
                  `exact S2 authorization prefix was rejected: ${JSON.stringify(history.issues)}`
                )
              }
              return yield* establishRemoteBaseline(readIntent.event.correlation).pipe(
                Effect.provide(journalLayer(prefix.runId, prefix.accepted.trackerTarget, history, store))
              )
            })
          ).pipe(Effect.provide(nodeGitRemoteBaselineLayer), Effect.provide(commands))
        )

      const localRefBefore = await localGitText(fixture, "rev-parse", "--verify", `${targetRef}^{commit}`)
      const remoteRefBefore = await successfulBareGit(
        fixture.remoteRepository,
        "rev-parse",
        "--verify",
        `${targetRef}^{commit}`
      )
      const worktreeBefore = await snapshot(fixture)
      const first = await activate()
      let finalState = first
      if (scenario.expectedObservation === undefined) {
        expect(first._tag).toBe("CatchUpRequired")
        expect((await activate())._tag).toBe("CatchUpPending")
        finalState = await activate()
        expect(finalState).toMatchObject({
          _tag: "Retained",
          cause: { _tag: "CatchUpUnavailable", reason: "TargetUnreadable" }
        })
      } else {
        expect(first).toMatchObject({
          _tag: "Retained",
          cause: { _tag: "UnsafeObservation", observation: { _tag: scenario.expectedObservation } }
        })
      }

      const localRefAfter = await localGitText(fixture, "rev-parse", "--verify", `${targetRef}^{commit}`)
      const remoteRefAfter = await successfulBareGit(
        fixture.remoteRepository,
        "rev-parse",
        "--verify",
        `${targetRef}^{commit}`
      )
      const worktreeAfter = await snapshot(fixture)
      expect(localRefAfter).toBe(localRefBefore)
      expect(remoteRefAfter).toBe(remoteRefBefore)
      expect(worktreeAfter).toEqual(worktreeBefore)
      expect(commandLog.filter((args) => args[0] === "update-ref")).toHaveLength(0)

      const persisted = await Effect.runPromise(store.read(prefix.runId))
      expect(persisted.filter(({ event }) => event._tag === "IntegratorCompetingHeadSuccessorAuthorized")).toEqual([
        authorization
      ])
      expect(persisted.filter(({ event }) => event._tag === "IntegratorAutomaticSuccessorSessionFixed")).toHaveLength(0)
      expect(persisted.filter(({ event }) => event._tag === "IntegratorRunStarted")).toHaveLength(1)
      expect(persisted.filter(({ event }) => event._tag === "RemoteBaselineReadIntended")).toHaveLength(1)
      expect(persisted.filter(({ event }) => event._tag === "RemoteBaselineObserved")).toHaveLength(1)
      const observations = persisted.filter(({ event }) => event._tag === "RemoteBaselineObserved")
      expect(observations[0]?.event).toMatchObject({
        correlation: readIntent.event.correlation,
        observation:
          scenario.expectedObservation === undefined
            ? { _tag: "LocalAncestor", localHead: GitCommitSha.make(h), remoteHead: GitCommitSha.make(h2) }
            : {
                _tag: scenario.expectedObservation,
                localHead: GitCommitSha.make(localRefBefore),
                remoteHead: GitCommitSha.make(h2)
              }
      })
      const catchUpIntents = persisted.filter(({ event }) => event._tag === "LocalTargetCatchUpIntended")
      const catchUpObservations = persisted.filter(({ event }) => event._tag === "LocalTargetCatchUpObserved")
      if (scenario.expectedObservation === undefined) {
        expect(catchUpIntents).toHaveLength(1)
        expect(catchUpObservations).toMatchObject([
          {
            event: {
              correlation: readIntent.event.correlation,
              expectedLocalHead: GitCommitSha.make(h),
              remoteHead: GitCommitSha.make(h2),
              result: { _tag: "Unavailable", reason: "TargetUnreadable" }
            }
          }
        ])
      } else {
        expect(catchUpIntents).toHaveLength(0)
        expect(catchUpObservations).toHaveLength(0)
      }
      expect(finalState._tag).toBe("Retained")
    } finally {
      await rm(fixture.root, { force: true, recursive: true })
    }
  })
})
