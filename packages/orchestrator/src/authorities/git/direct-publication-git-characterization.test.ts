/* eslint-disable import/no-nodejs-modules -- this test owns a disposable real-Git fixture. */

import { execFile as nodeExecFile } from "node:child_process"
import { access, mkdtemp, mkdir, realpath, rm, writeFile } from "node:fs/promises"
import nodePath from "node:path"
import nodeProcess from "node:process"
import { describe, expect, it } from "vitest"

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
