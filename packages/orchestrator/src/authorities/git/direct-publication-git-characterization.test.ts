/* eslint-disable import/no-nodejs-modules -- this test owns a disposable real-Git fixture. */

import { execFile as nodeExecFile } from "node:child_process"
import { access, mkdtemp, mkdir, realpath, readFile, rm, writeFile } from "node:fs/promises"
import nodePath from "node:path"
import nodeProcess from "node:process"
import { describe, expect, it } from "vitest"

import { GitCommitSha, GitRepositoryLocator, IntegrationTarget, IntegrationTargetRef } from "@dalph/contracts"
import { Effect, Layer } from "effect"
import { GitCommand, GitCommandInvocationFailure } from "./command.js"
import { nodeGitRemoteBaselineLayer } from "./remote-baseline.js"
import {
  RemoteBaselineGit,
  remoteBaselineCorrelationFor
} from "../../workflow/protocols/direct-publication/baseline-events.js"
import { integrationFinalityFixture } from "../../workflow/protocols/integration-finality/fixtures.js"
import { integratorResponsibilityFactsFromCorrelation } from "../../workflow/protocols/integrator/state.js"
import { remotePublicationTargetForTest } from "../../../test/support/direct-publication.js"

interface GitCommandResult {
  readonly exitCode: number
  readonly stderr: string
  readonly stdout: string
}

interface GitFixture {
  readonly local: string
  readonly remote: string
  readonly root: string
  readonly source: string
}

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

const successfulGit = async (directory: string, ...args: ReadonlyArray<string>): Promise<string> => {
  const result = await runGit(directory, ...args)
  expect(result.exitCode, `git ${args.join(" ")} stderr: ${result.stderr}`).toBe(0)
  return result.stdout.trim()
}

const pathExists = async (path: string): Promise<boolean> => {
  try {
    await access(path)
    return true
  } catch {
    return false
  }
}

const makeFixture = async (): Promise<GitFixture> => {
  const root = await realpath(
    await mkdtemp(nodePath.join(nodeProcess.env["TMPDIR"] ?? "/tmp", "dalph-direct-publication-git-"))
  )
  const source = nodePath.join(root, "source")
  const remote = nodePath.join(root, "remote.git")
  const local = nodePath.join(root, "local")
  await Promise.all([mkdir(source), mkdir(remote), mkdir(local)])
  await successfulGit(source, "init", "--initial-branch=main")
  await successfulGit(source, "config", "user.email", "dalph@example.invalid")
  await successfulGit(source, "config", "user.name", "Dalph direct-publication characterization")
  await successfulGit(remote, "init", "--bare")
  await successfulGit(local, "init", "--initial-branch=local")
  return { local, remote, root, source }
}

const withFixture = async <A>(use: (fixture: GitFixture) => Promise<A>): Promise<A> => {
  const fixture = await makeFixture()
  try {
    return await use(fixture)
  } finally {
    await rm(fixture.root, { force: true, recursive: true })
  }
}

const commit = async (fixture: GitFixture, contents: string, message: string): Promise<string> => {
  await writeFile(nodePath.join(fixture.source, "file"), contents)
  await successfulGit(fixture.source, "add", "file")
  await successfulGit(fixture.source, "commit", "-m", message)
  return successfulGit(fixture.source, "rev-parse", "HEAD")
}

describe("direct-publication real-Git characterization", () => {
  it("fetches an exact advertised head into objects without FETCH_HEAD or refs", async () =>
    withFixture(async (fixture) => {
      const base = await commit(fixture, "base\n", "base")
      const head = await commit(fixture, "head\n", "head")
      await successfulGit(fixture.source, "push", fixture.remote, `${head}:refs/heads/main`)

      const advertised = await runGit(
        fixture.local,
        "ls-remote",
        "--exit-code",
        "--refs",
        "--heads",
        "--",
        fixture.remote,
        "refs/heads/main"
      )
      expect(advertised.exitCode).toBe(0)
      expect(advertised.stdout.trim()).toBe(`${head}\trefs/heads/main`)

      const fetched = await runGit(
        fixture.local,
        "fetch",
        "--no-write-fetch-head",
        "--no-tags",
        "--recurse-submodules=no",
        "--",
        fixture.remote,
        head
      )
      expect(fetched.exitCode).toBe(0)
      expect(await pathExists(nodePath.join(fixture.local, ".git", "FETCH_HEAD"))).toBe(false)
      expect(await successfulGit(fixture.local, "for-each-ref", "--format=%(refname)")).toBe("")
      expect((await runGit(fixture.local, "cat-file", "-e", `${head}^{commit}`)).exitCode).toBe(0)
      expect((await runGit(fixture.local, "merge-base", "--is-ancestor", base, head)).exitCode).toBe(0)
      expect((await runGit(fixture.local, "merge-base", "--is-ancestor", head, base)).exitCode).toBe(1)
    }))

  it("reports exact per-ref porcelain results while dry-run leaves the remote unchanged", async () =>
    withFixture(async (fixture) => {
      const base = await commit(fixture, "base\n", "base")
      const dryRun = await runGit(
        fixture.source,
        "push",
        "--dry-run",
        "--porcelain",
        "--no-follow-tags",
        "--recurse-submodules=no",
        "--",
        fixture.remote,
        `${base}:refs/heads/main`
      )
      expect(dryRun.exitCode).toBe(0)
      expect(dryRun.stdout).toContain(`*\t${base}:refs/heads/main\t[new branch]`)
      expect(
        (
          await runGit(
            fixture.source,
            "ls-remote",
            "--exit-code",
            "--refs",
            "--heads",
            "--",
            fixture.remote,
            "refs/heads/main"
          )
        ).exitCode
      ).toBe(2)

      const applied = await runGit(
        fixture.source,
        "push",
        "--porcelain",
        "--no-follow-tags",
        "--recurse-submodules=no",
        "--",
        fixture.remote,
        `${base}:refs/heads/main`
      )
      expect(applied.exitCode).toBe(0)
      expect(applied.stdout).toContain(`*\t${base}:refs/heads/main\t[new branch]`)

      const upToDate = await runGit(
        fixture.source,
        "push",
        "--porcelain",
        "--no-follow-tags",
        "--recurse-submodules=no",
        "--",
        fixture.remote,
        `${base}:refs/heads/main`
      )
      expect(upToDate.exitCode).toBe(0)
      expect(upToDate.stdout).toContain(`=\t${base}:refs/heads/main\t[up to date]`)

      const head = await commit(fixture, "head\n", "head")
      const fastForward = await runGit(
        fixture.source,
        "push",
        "--porcelain",
        "--no-follow-tags",
        "--recurse-submodules=no",
        "--",
        fixture.remote,
        `${head}:refs/heads/main`
      )
      expect(fastForward.exitCode).toBe(0)
      expect(fastForward.stdout).toContain(` \t${head}:refs/heads/main\t${base.slice(0, 7)}..${head.slice(0, 7)}`)

      const stale = await runGit(
        fixture.source,
        "push",
        "--dry-run",
        "--porcelain",
        "--no-follow-tags",
        "--recurse-submodules=no",
        "--",
        fixture.remote,
        `${base}:refs/heads/main`
      )
      expect(stale.exitCode).toBe(1)
      expect(stale.stdout).toContain(`!\t${base}:refs/heads/main\t[rejected] (non-fast-forward)`)

      const current = await runGit(
        fixture.source,
        "ls-remote",
        "--exit-code",
        "--refs",
        "--heads",
        "--",
        fixture.remote,
        "refs/heads/main"
      )
      expect(current.exitCode).toBe(0)
      expect(current.stdout.trim()).toBe(`${head}\trefs/heads/main`)
    }))
})

const catchUpLocal = (directory: string, base: string, head: string, reconcile = false, malformed = false) => {
  const session = integrationFinalityFixture.qualifiedCandidate.run.session
  const localTarget = IntegrationTarget.make({
    ...session.integrationTarget,
    repository: GitRepositoryLocator.make(directory),
    ref: IntegrationTargetRef.make("refs/heads/catch-up")
  })
  const correlation = remoteBaselineCorrelationFor(
    session.plannedAttempt.runId,
    { ...integratorResponsibilityFactsFromCorrelation(session), integrationTarget: localTarget },
    localTarget,
    remotePublicationTargetForTest
  )
  const run = (repository: string, args: ReadonlyArray<string>) =>
    Effect.tryPromise({
      try: () => runGit(repository, ...args),
      catch: () => new GitCommandInvocationFailure({ detail: "fixture Git failed" })
    })
  const commands = Layer.succeed(GitCommand, {
    run,
    runInWorktree: run,
    runBytesInWorktree: (repository, args) =>
      run(repository, args).pipe(
        Effect.map((result) => ({ ...result, stdout: new TextEncoder().encode(result.stdout) }))
      ),
    runBoundedInRepository: (repository, args) =>
      malformed && args[0] === "worktree"
        ? Effect.succeed({ exitCode: 0, stdout: "unreadable", stderr: "" })
        : run(repository, args)
  })
  return Effect.runPromise(
    Effect.gen(function* () {
      const git = yield* RemoteBaselineGit
      return yield* (reconcile ? git.reconcileCatchUp : git.catchUp)(
        correlation,
        GitCommitSha.make(base),
        GitCommitSha.make(head)
      )
    }).pipe(Effect.provide(nodeGitRemoteBaselineLayer), Effect.provide(commands), Effect.result)
  )
}

const targetRef = "refs/heads/catch-up"

describe("initial local catch-up real Git custody", () => {
  it("characterizes update-ref accepting an occupied dirty branch without updating its index", async () =>
    withFixture(async (fixture) => {
      const base = await commit(fixture, "base\n", "base")
      const head = await commit(fixture, "head\n", "head")
      await successfulGit(fixture.source, "checkout", "--detach", base)
      await successfulGit(fixture.source, "branch", "occupied", base)
      await successfulGit(fixture.source, "checkout", "occupied")
      await writeFile(nodePath.join(fixture.source, "file"), "foreign work\n")
      await successfulGit(fixture.source, "update-ref", "refs/heads/occupied", head, base)
      expect(await successfulGit(fixture.source, "rev-parse", "HEAD")).toBe(head)
      expect(await successfulGit(fixture.source, "show", ":file")).toBe("base")
      expect(await readFile(nodePath.join(fixture.source, "file"), "utf8")).toBe("foreign work\n")
      expect(await successfulGit(fixture.source, "status", "--porcelain")).toBe("MM file")
    }))

  it("refuses a backward catch-up before mutation", async () =>
    withFixture(async (fixture) => {
      const base = await commit(fixture, "base\n", "base")
      const head = await commit(fixture, "head\n", "head")
      await successfulGit(fixture.source, "update-ref", targetRef, head)
      expect(await catchUpLocal(fixture.source, head, base)).toMatchObject({
        _tag: "Failure",
        failure: { reason: "AncestryUnavailable" }
      })
      expect(await successfulGit(fixture.source, "rev-parse", targetRef)).toBe(head)
    }))

  it("fast-forwards an unoccupied target and reconciles the applied intent without another mutation", async () =>
    withFixture(async (fixture) => {
      const base = await commit(fixture, "base\n", "base")
      const head = await commit(fixture, "head\n", "head")
      await successfulGit(fixture.source, "update-ref", targetRef, base)
      expect(await catchUpLocal(fixture.source, base, head)).toMatchObject({
        _tag: "Success",
        success: { _tag: "Applied", newHead: head }
      })
      expect(await catchUpLocal(fixture.source, base, head, true)).toMatchObject({
        _tag: "Success",
        success: { _tag: "AlreadyCurrent", currentHead: head }
      })
      expect(await successfulGit(fixture.source, "rev-parse", targetRef)).toBe(head)
    }))

  it.each([false, true])("rejects a checked-out target without changing its index or files (dirty=%s)", async (dirty) =>
    withFixture(async (fixture) => {
      const base = await commit(fixture, "base\n", "base")
      const head = await commit(fixture, "head\n", "head")
      await successfulGit(fixture.source, "update-ref", targetRef, base)
      const occupied = nodePath.join(fixture.root, "occupied")
      await successfulGit(fixture.source, "worktree", "add", occupied, targetRef.slice("refs/heads/".length))
      if (dirty) await writeFile(nodePath.join(occupied, "file"), "foreign work\n")
      const before = await successfulGit(occupied, "status", "--porcelain")
      expect(await catchUpLocal(fixture.source, base, head)).toMatchObject({
        _tag: "Failure",
        failure: { reason: "TargetUnreadable" }
      })
      expect(await catchUpLocal(fixture.source, base, head, true)).toMatchObject({
        _tag: "Failure",
        failure: { reason: "TargetUnreadable" }
      })
      expect(await successfulGit(fixture.source, "rev-parse", targetRef)).toBe(base)
      expect(await successfulGit(occupied, "status", "--porcelain")).toBe(before)
      expect(await readFile(nodePath.join(occupied, "file"), "utf8")).toBe(dirty ? "foreign work\n" : "base\n")
    })
  )

  it("rejects ambiguous worktree inventory and symbolic target ownership before mutation", async () =>
    withFixture(async (fixture) => {
      const base = await commit(fixture, "base\n", "base")
      const head = await commit(fixture, "head\n", "head")
      await successfulGit(fixture.source, "update-ref", targetRef, base)
      expect(await catchUpLocal(fixture.source, base, head, false, true)).toMatchObject({
        _tag: "Failure",
        failure: { reason: "TargetUnreadable" }
      })
      expect(await successfulGit(fixture.source, "rev-parse", targetRef)).toBe(base)
      await successfulGit(fixture.source, "symbolic-ref", targetRef, "refs/heads/main")
      expect(await catchUpLocal(fixture.source, head, base)).toMatchObject({
        _tag: "Failure",
        failure: { reason: "TargetUnreadable" }
      })
      expect(await successfulGit(fixture.source, "rev-parse", "HEAD")).toBe(head)
    }))
})
