/* eslint-disable import/no-nodejs-modules -- this test owns disposable real-Git repositories. */

import { execFile as nodeExecFile } from "node:child_process"
import { access, mkdtemp, mkdir, readFile, realpath, rm, writeFile } from "node:fs/promises"
import nodePath from "node:path"
import nodeProcess from "node:process"
import { setTimeout as nodeSetTimeout } from "node:timers/promises"
import { NodeServices } from "@effect/platform-node"
import {
  GitCommitSha,
  GitRepositoryLocator,
  RemotePublicationBranchRef,
  RemotePublicationEndpoint
} from "@dalph/contracts"
import { type Duration, Effect, Layer, Stream } from "effect"
import { ChildProcessSpawner } from "effect/unstable/process"
import { TestClock } from "effect/testing"
import { describe, expect, it } from "vitest"
import {
  GitCommand,
  GitCommandInvocationFailure,
  nodeGitCommandLayer,
  type GitCommandResult,
  type GitCommandService
} from "./command.js"
import { nodeGitDirectPublicationLayer } from "./direct-publication.js"
import { GitSenderCustody, GitSenderToken } from "./sender-custody.js"
import {
  RemotePublicationAttemptOrdinal,
  RemotePublicationAdmissionObservation,
  RemotePublicationGit,
  RemotePublicationGitObservation,
  RemotePublicationGitRequest,
  RemotePublicationRequestId
} from "../../workflow/protocols/direct-publication/events.js"

interface GitResult {
  readonly exitCode: number
  readonly stderr: string
  readonly stdout: string
}

interface Fixture {
  readonly remote: string
  readonly root: string
  readonly source: string
}

const custodyScriptPollDelay = 25
const custodyScriptPollLimit = 80

interface FixtureProcessIdentity {
  readonly pid: number
  readonly startTime: string
}

const fixtureProcessIdentity = (stat: string): FixtureProcessIdentity => ({
  pid: Number(stat.slice(0, stat.indexOf(" "))),
  startTime:
    stat
      .slice(stat.lastIndexOf(") ") + 2)
      .trim()
      .split(/\s+/u)[19] ?? ""
})

const processIsAlive = async (identity: FixtureProcessIdentity): Promise<boolean> => {
  try {
    const current = fixtureProcessIdentity(await readFile(`/proc/${identity.pid}/stat`, "utf8"))
    return current.startTime === identity.startTime
  } catch (error: unknown) {
    if (
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      (error.code === "ENOENT" || error.code === "ESRCH")
    )
      return false
    throw error
  }
}

const stopProcess = async (identity: FixtureProcessIdentity | undefined): Promise<void> => {
  if (identity === undefined || !(await processIsAlive(identity))) return
  try {
    nodeProcess.kill(identity.pid, "SIGKILL")
  } catch (error: unknown) {
    if (typeof error !== "object" || error === null || !("code" in error) || error.code !== "ESRCH") throw error
  }
  for (let attempt = 0; attempt < custodyScriptPollLimit; attempt += 1) {
    if (!(await processIsAlive(identity))) return
    await nodeSetTimeout(custodyScriptPollDelay)
  }
  throw new Error(`Fixture process ${identity.pid}:${identity.startTime} did not disappear`)
}

const makeCustodyScript = async (prefix: string, body: string) => {
  const root = await realpath(await mkdtemp(nodePath.join(nodeProcess.env["TMPDIR"] ?? "/tmp", prefix)))
  const script = nodePath.join(root, "run.sh")
  const pidFile = nodePath.join(root, "child.pid")
  await writeFile(script, `#!/bin/sh\nset -eu\n${body}\n`, { mode: 0o755 })
  return { pidFile, root, script }
}

const runGit = (directory: string, ...args: ReadonlyArray<string>): Promise<GitResult> =>
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

const makeFixture = async (): Promise<Fixture> => {
  const root = await realpath(await mkdtemp(nodePath.join(nodeProcess.env["TMPDIR"] ?? "/tmp", "dalph-direct-git-")))
  const source = nodePath.join(root, "source")
  const remote = nodePath.join(root, "remote.git")
  await Promise.all([mkdir(source), mkdir(remote)])
  await successfulGit(source, "init", "--initial-branch=main")
  await successfulGit(source, "config", "user.email", "dalph@example.invalid")
  await successfulGit(source, "config", "user.name", "Dalph direct publication test")
  await successfulGit(remote, "init", "--bare")
  return { remote, root, source }
}

const withFixture = async <A>(use: (fixture: Fixture) => Promise<A>): Promise<A> => {
  const fixture = await makeFixture()
  try {
    return await use(fixture)
  } finally {
    await rm(fixture.root, { force: true, recursive: true })
  }
}

const commit = async (fixture: Fixture, contents: string, message: string): Promise<GitCommitSha> => {
  await writeFile(nodePath.join(fixture.source, "file"), contents)
  await successfulGit(fixture.source, "add", "file")
  await successfulGit(fixture.source, "commit", "-m", message)
  const sha = await successfulGit(fixture.source, "rev-parse", "HEAD")
  return GitCommitSha.make(sha)
}

const requestFor = (candidateCommit: GitCommitSha, endpoint: string, branch = "refs/heads/main") =>
  RemotePublicationGitRequest.make({
    candidateCommit,
    requestId: RemotePublicationRequestId.make("direct-publication-adapter-test"),
    target: { branch: RemotePublicationBranchRef.make(branch), endpoint: RemotePublicationEndpoint.make(endpoint) }
  })

const runWithAdapter = <A, E>(
  source: string,
  program: Effect.Effect<A, E, RemotePublicationGit>,
  calls?: Array<ReadonlyArray<string>>
): Promise<A> => {
  const repository = GitRepositoryLocator.make(`${source}/.git`)
  const custody = Layer.succeed(
    GitSenderCustody,
    GitSenderCustody.of({
      reserve: () => Effect.void,
      begin: () => Effect.succeed(GitSenderToken.make("direct-publication-adapter-test-token")),
      reconcile: () => Effect.void,
      spawned: () => Effect.void
    })
  )
  const recordedCommands = Layer.effect(
    GitCommand,
    Effect.gen(function* () {
      const commands = yield* GitCommand
      const bounded = commands.runBoundedInRepository
      if (bounded === undefined) throw new Error("real Git fixture requires bounded commands")
      return GitCommand.of({
        ...commands,
        runBoundedInRepository: (...args) => {
          calls?.push(args[1])
          return bounded(...args)
        }
      })
    })
  ).pipe(Layer.provide(nodeGitCommandLayer.pipe(Layer.provide(custody))))
  const layer = nodeGitDirectPublicationLayer(repository).pipe(
    Layer.provide(recordedCommands),
    Layer.provide(NodeServices.layer)
  )
  return Effect.runPromise(program.pipe(Effect.provide(layer)))
}

const boundedScriptLayer = (
  responses: ReadonlyArray<GitCommandResult>,
  advanceBy: ReadonlyArray<Duration.Input>,
  calls: Array<ReadonlyArray<string>>
): Layer.Layer<GitCommand> => {
  let index = 0
  const unavailable = () => Effect.fail(new GitCommandInvocationFailure({ detail: "unused test operation" }))
  const service: GitCommandService = {
    prepareSenderCustody: () => Effect.void,
    reconcileSenderCustody: () => Effect.void,
    run: unavailable,
    runBytesInWorktree: unavailable,
    runInWorktree: unavailable,
    runBoundedInRepository: (_repository, args) =>
      Effect.gen(function* () {
        calls.push(args)
        const advance = advanceBy[index]
        if (advance !== undefined) yield* TestClock.adjust(advance)
        const response = responses[index]
        index += 1
        if (response === undefined) throw new Error("test bounded script exhausted")
        return response
      })
  }
  return Layer.succeed(GitCommand, service)
}

const observe = (request: RemotePublicationGitRequest) =>
  Effect.gen(function* () {
    const git = yield* RemotePublicationGit
    return yield* git.observe(request)
  })

const admit = (target: RemotePublicationGitRequest["target"]) =>
  Effect.gen(function* () {
    const git = yield* RemotePublicationGit
    return yield* git.admit(target)
  })

const push = (request: RemotePublicationGitRequest) =>
  Effect.gen(function* () {
    const git = yield* RemotePublicationGit
    const ordinal = RemotePublicationAttemptOrdinal.make(1)
    yield* git.prepareSenderCustody(request, ordinal)
    return yield* git.push(request, ordinal)
  })

describe("direct publication Git authority", () => {
  it("observes exact current, both safe fast-forward directions, compatible competition, unrelated history, and a missing branch", async () =>
    withFixture(async (fixture) => {
      const base = await commit(fixture, "base\n", "base")
      const head = await commit(fixture, "head\n", "head")
      await successfulGit(fixture.source, "push", fixture.remote, `${base}:refs/heads/safe-forward`)
      await successfulGit(fixture.source, "push", fixture.remote, `${head}:refs/heads/main`)

      const admitted = await runWithAdapter(fixture.source, admit(requestFor(head, fixture.remote).target))
      expect(admitted).toEqual(RemotePublicationAdmissionObservation.cases.ExistingBranch.make({ remoteHead: head }))
      const admittedMissing = await runWithAdapter(
        fixture.source,
        admit(requestFor(head, fixture.remote, "refs/heads/missing").target)
      )
      expect(admittedMissing).toEqual(RemotePublicationAdmissionObservation.cases.TargetMissing.make({}))

      const current = await runWithAdapter(fixture.source, observe(requestFor(head, fixture.remote)))
      expect(current).toEqual(RemotePublicationGitObservation.cases.CandidateCurrent.make({ remoteHead: head }))

      const ancestor = await runWithAdapter(fixture.source, observe(requestFor(base, fixture.remote)))
      expect(ancestor).toEqual(RemotePublicationGitObservation.cases.CandidateAncestor.make({ remoteHead: head }))

      const remoteAncestor = await runWithAdapter(
        fixture.source,
        observe(requestFor(head, fixture.remote, "refs/heads/safe-forward"))
      )
      expect(remoteAncestor).toEqual(
        RemotePublicationGitObservation.cases.RemoteAncestorOfCandidate.make({ remoteHead: base })
      )

      await successfulGit(fixture.source, "switch", "--detach", base)
      const competing = await commit(fixture, "competing\n", "competing")
      await successfulGit(fixture.source, "push", fixture.remote, `${competing}:refs/heads/competing`)
      await successfulGit(fixture.source, "switch", "--detach", head)
      const compatible = await runWithAdapter(
        fixture.source,
        observe(requestFor(head, fixture.remote, "refs/heads/competing"))
      )
      expect(compatible).toEqual(
        RemotePublicationGitObservation.cases.CompatibleCompetingHead.make({ mergeBase: base, remoteHead: competing })
      )

      const foreignRoot = nodePath.join(fixture.root, "foreign")
      await mkdir(foreignRoot)
      await successfulGit(foreignRoot, "init", "--initial-branch=main")
      await successfulGit(foreignRoot, "config", "user.email", "foreign@example.invalid")
      await successfulGit(foreignRoot, "config", "user.name", "foreign")
      await writeFile(nodePath.join(foreignRoot, "foreign"), "foreign\n")
      await successfulGit(foreignRoot, "add", "foreign")
      await successfulGit(foreignRoot, "commit", "-m", "foreign")
      const foreign = GitCommitSha.make(await successfulGit(foreignRoot, "rev-parse", "HEAD"))
      await successfulGit(foreignRoot, "push", fixture.remote, `${foreign}:refs/heads/other`)
      const foreignObservation = await runWithAdapter(
        fixture.source,
        observe(requestFor(base, fixture.remote, "refs/heads/other"))
      )
      expect(foreignObservation).toEqual(
        RemotePublicationGitObservation.cases.IncompatibleLineage.make({ remoteHead: foreign })
      )

      const missing = await runWithAdapter(
        fixture.source,
        observe(requestFor(base, fixture.remote, "refs/heads/missing"))
      )
      expect(missing).toEqual(RemotePublicationGitObservation.cases.TargetMissing.make({}))
      expect(await runGit(fixture.source, "for-each-ref", "--format=%(refname)")).toEqual(
        expect.objectContaining({ exitCode: 0 })
      )
      await expect(access(nodePath.join(fixture.source, ".git", "FETCH_HEAD"))).rejects.toThrow()
    }))

  it("keeps ancestry unavailable when merge-base cannot produce conclusive evidence", async () => {
    const candidate = GitCommitSha.make("a".repeat(40))
    const remoteHead = GitCommitSha.make("b".repeat(40))
    const target = requestFor(candidate, "/tmp/direct-publication-remote.git")
    const calls: Array<ReadonlyArray<string>> = []
    const commandLayer = boundedScriptLayer(
      [
        { exitCode: 1, stderr: "", stdout: "" },
        { exitCode: 0, stderr: "", stdout: `${remoteHead}\t${target.target.branch}` },
        { exitCode: 1, stderr: "", stdout: "" },
        { exitCode: 0, stderr: "", stdout: "" },
        { exitCode: 1, stderr: "", stdout: "" },
        { exitCode: 1, stderr: "", stdout: "" },
        { exitCode: 128, stderr: "fatal: cannot inspect ancestry", stdout: "" }
      ],
      [],
      calls
    )
    const failure = await Effect.runPromise(
      observe(target).pipe(
        Effect.provide(nodeGitDirectPublicationLayer(GitRepositoryLocator.make("/tmp/repository.git"))),
        Effect.provide(commandLayer),
        Effect.provide(TestClock.layer())
      )
    ).catch((error: unknown) => error)
    expect(failure).toMatchObject({ _tag: "RemotePublicationObservationFailure", reason: "AncestryUnavailable" })
    expect(calls.at(-1)).toEqual(["merge-base", candidate, remoteHead])
  })

  it("pushes the exact candidate, recognizes up-to-date, and rejects stale non-fast-forward updates", async () =>
    withFixture(async (fixture) => {
      const base = await commit(fixture, "base\n", "base")
      const target = requestFor(base, fixture.remote)
      const applied = await runWithAdapter(fixture.source, push(target))
      expect(applied).toEqual({ _tag: "Applied", remoteHead: base })

      const upToDate = await runWithAdapter(fixture.source, push(target))
      expect(upToDate).toEqual({ _tag: "UpToDate", remoteHead: base })

      const head = await commit(fixture, "head\n", "head")
      const advanced = await runWithAdapter(fixture.source, push(requestFor(head, fixture.remote)))
      expect(advanced).toEqual({ _tag: "Applied", remoteHead: head })

      const stale = await runWithAdapter(fixture.source, push(target))
      expect(stale).toEqual({ _tag: "RejectedNonFastForward" })
      const advertised = await successfulGit(
        fixture.source,
        "ls-remote",
        "--exit-code",
        "--refs",
        "--heads",
        "--",
        fixture.remote,
        "refs/heads/main"
      )
      expect(advertised).toBe(`${head}\trefs/heads/main`)
    }))

  it("recreates only the named branch when it is deleted after admission and before an ordinary push", async () =>
    withFixture(async (fixture) => {
      const base = await commit(fixture, "base\n", "base")
      await successfulGit(
        fixture.source,
        "push",
        fixture.remote,
        `${base}:refs/heads/main`,
        `${base}:refs/heads/untouched`
      )
      const candidate = await commit(fixture, "candidate\n", "candidate")
      await successfulGit(fixture.source, "tag", "local-only-tag", candidate)
      const request = requestFor(candidate, fixture.remote)
      const admitted = await runWithAdapter(fixture.source, admit(request.target))
      expect(admitted).toEqual(RemotePublicationAdmissionObservation.cases.ExistingBranch.make({ remoteHead: base }))
      expect(await runWithAdapter(fixture.source, observe(request))).toEqual(
        RemotePublicationGitObservation.cases.RemoteAncestorOfCandidate.make({ remoteHead: base })
      )
      await successfulGit(fixture.remote, "update-ref", "-d", "refs/heads/main", base)
      expect(await successfulGit(fixture.remote, "for-each-ref", "--format=%(refname) %(objectname)")).toBe(
        `refs/heads/untouched ${base}`
      )
      const calls: Array<ReadonlyArray<string>> = []
      expect(await runWithAdapter(fixture.source, push(request), calls)).toEqual({
        _tag: "Applied",
        remoteHead: candidate
      })
      expect(calls.filter((args) => args.includes("push"))).toEqual([
        [
          "-c",
          `url.${fixture.remote}.insteadOf=${fixture.remote}`,
          "-c",
          `url.${fixture.remote}.pushInsteadOf=${fixture.remote}`,
          "push",
          "--porcelain",
          "--no-follow-tags",
          "--recurse-submodules=no",
          "--",
          fixture.remote,
          `${candidate}:refs/heads/main`
        ]
      ])
      expect(await successfulGit(fixture.remote, "for-each-ref", "--format=%(refname) %(objectname)")).toBe(
        `refs/heads/main ${candidate}\nrefs/heads/untouched ${base}`
      )
    }))

  it("keeps authentication and throttling denials distinct without returning diagnostics", async () => {
    const candidate = GitCommitSha.make("a".repeat(40))
    const target = requestFor(candidate, "/tmp/direct-publication-remote.git")
    const runScript = (pushResult: GitCommandResult, calls: Array<ReadonlyArray<string>>) => {
      const commandLayer = boundedScriptLayer([{ exitCode: 1, stderr: "", stdout: "" }, pushResult], [], calls)
      return Effect.runPromise(
        push(target).pipe(
          Effect.provide(nodeGitDirectPublicationLayer(GitRepositoryLocator.make("/tmp/repository.git"))),
          Effect.provide(commandLayer),
          Effect.provide(TestClock.layer())
        )
      )
    }
    const authenticationCalls: Array<ReadonlyArray<string>> = []
    const authentication = await runScript(
      { exitCode: 128, stderr: "Permission denied", stdout: "" },
      authenticationCalls
    )
    expect(authentication).toEqual({ _tag: "RejectedDefinite", cause: "Authentication" })
    expect(authenticationCalls[1]).toEqual([
      "-c",
      `url.${target.target.endpoint}.insteadOf=${target.target.endpoint}`,
      "-c",
      `url.${target.target.endpoint}.pushInsteadOf=${target.target.endpoint}`,
      "push",
      "--porcelain",
      "--no-follow-tags",
      "--recurse-submodules=no",
      "--",
      target.target.endpoint,
      `${candidate}:${target.target.branch}`
    ])
    const throttled = await runScript({ exitCode: 128, stderr: "rate limit exceeded", stdout: "" }, [])
    expect(throttled).toEqual({ _tag: "Throttled" })
  })

  it("fails closed when a configured URL rewrite does not resolve to the pinned endpoint", async () =>
    withFixture(async (fixture) => {
      const base = await commit(fixture, "base\n", "base")
      await successfulGit(fixture.source, "config", "url.other.example/rewrite.insteadOf", fixture.remote)
      await expect(
        Effect.runPromise(
          observe(requestFor(base, fixture.remote)).pipe(
            Effect.provide(
              nodeGitDirectPublicationLayer(GitRepositoryLocator.make(`${fixture.source}/.git`)).pipe(
                Layer.provide(nodeGitCommandLayer),
                Layer.provide(NodeServices.layer)
              )
            )
          )
        )
      ).rejects.toMatchObject({ reason: "EndpointMappingChanged" })
    }))

  it("uses one decreasing observation budget across config, advertisement, and ancestry preparation", async () => {
    const candidate = GitCommitSha.make("a".repeat(40))
    const remoteHead = GitCommitSha.make("b".repeat(40))
    const target = requestFor(candidate, "/tmp/direct-publication-remote.git")
    const calls: Array<ReadonlyArray<string>> = []
    const commandLayer = boundedScriptLayer(
      [
        { exitCode: 1, stderr: "", stdout: "" },
        { exitCode: 0, stderr: "", stdout: `${remoteHead}\t${target.target.branch}` }
      ],
      ["16 seconds", "16 seconds"],
      calls
    )
    const failure = await Effect.runPromise(
      observe(target).pipe(
        Effect.provide(nodeGitDirectPublicationLayer(GitRepositoryLocator.make("/tmp/repository.git"))),
        Effect.provide(commandLayer),
        Effect.provide(TestClock.layer())
      )
    ).catch((error: unknown) => error)
    expect(failure).toMatchObject({ _tag: "RemotePublicationObservationFailure", reason: "ResponseDeadline" })
    expect(calls).toHaveLength(2)
  })

  it("exposes a bounded command that stops and proves a detached child group", async () => {
    const commandResult = await Effect.runPromise(
      Effect.gen(function* () {
        const git = yield* GitCommand
        const runBounded = git.runBoundedInRepository
        if (runBounded === undefined) throw new Error("Node Git layer did not provide bounded execution")
        return yield* runBounded(GitRepositoryLocator.make("/tmp"), ["--version"], "5 seconds")
      }).pipe(Effect.provide(nodeGitCommandLayer), Effect.provide(NodeServices.layer))
    )
    expect(commandResult).toEqual(expect.objectContaining({ exitCode: 0 }))
    expect((commandResult as GitCommandResult).stdout).toContain("git version")
  })

  it("reports the response deadline after proving the timed-out sender stopped", async () => {
    const custody = await makeCustodyScript(
      "dalph-git-custody-stopped-",
      ['cat /proc/$$/stat > "$1"', "exec sleep 30"].join("\n")
    )
    let sender: FixtureProcessIdentity | undefined
    try {
      const failure = await Effect.runPromise(
        Effect.gen(function* () {
          const git = yield* GitCommand
          const runBounded = git.runBoundedInRepository
          if (runBounded === undefined) throw new Error("Node Git layer did not provide bounded execution")
          return yield* runBounded(
            GitRepositoryLocator.make("/tmp"),
            ["-c", `alias.dalph-stopped=!${custody.script}`, "dalph-stopped", custody.pidFile],
            "1 second"
          )
        }).pipe(Effect.provide(nodeGitCommandLayer), Effect.provide(NodeServices.layer))
      ).catch((error: unknown) => error)
      sender = fixtureProcessIdentity(await readFile(custody.pidFile, "utf8"))
      expect(Number.isSafeInteger(sender.pid) && sender.pid > 0 && sender.startTime.length > 0).toBe(true)
      expect(failure).toMatchObject({ _tag: "GitCommandResponseDeadline" })
      expect(await processIsAlive(sender)).toBe(false)
    } finally {
      await stopProcess(sender)
      await rm(custody.root, { force: true, recursive: true })
    }
  })

  it("fails closed when a detached child appears after the initial census and survives group termination", async () => {
    const custody = await makeCustodyScript(
      "dalph-git-custody-detached-",
      [
        "read -r release",
        "setsid sh -c 'trap \"\" TERM; exec sleep 30' &",
        "child_pid=$!",
        'cat /proc/$child_pid/stat > "$1"',
        'while kill -0 "$child_pid" 2>/dev/null; do sleep 1; done'
      ].join("\n")
    )
    // Stream collection starts after the adapter's initial custody census.
    // Keep the helper unborn until the real stdin sink releases the script.
    const releaseAfterCensus = Layer.effect(
      ChildProcessSpawner.ChildProcessSpawner,
      Effect.gen(function* () {
        const actual = yield* ChildProcessSpawner.ChildProcessSpawner
        return ChildProcessSpawner.make((command) =>
          actual
            .spawn(command)
            .pipe(
              Effect.map((handle) =>
                ChildProcessSpawner.makeHandle({
                  ...handle,
                  stdout: Stream.unwrap(
                    Stream.make(new TextEncoder().encode("go\n")).pipe(
                      Stream.run(handle.stdin),
                      Effect.as(handle.stdout)
                    )
                  )
                })
              )
            )
        )
      })
    )
    let detached: FixtureProcessIdentity | undefined
    try {
      const failure = await Effect.runPromise(
        Effect.gen(function* () {
          const git = yield* GitCommand
          const runBounded = git.runBoundedInRepository
          if (runBounded === undefined) throw new Error("Node Git layer did not provide bounded execution")
          return yield* runBounded(
            GitRepositoryLocator.make("/tmp"),
            ["-c", `alias.dalph-detached=!${custody.script}`, "dalph-detached", custody.pidFile],
            "1 second"
          )
        }).pipe(
          Effect.provide(nodeGitCommandLayer),
          Effect.provide(releaseAfterCensus),
          Effect.provide(NodeServices.layer)
        )
      ).catch((error: unknown) => error)
      detached = fixtureProcessIdentity(await readFile(custody.pidFile, "utf8"))
      expect(Number.isSafeInteger(detached.pid) && detached.pid > 0 && detached.startTime.length > 0).toBe(true)
      expect(await processIsAlive(detached)).toBe(true)
      expect(failure).toMatchObject({ _tag: "GitCommandSenderStopUnproven" })
    } finally {
      await stopProcess(detached)
      await rm(custody.root, { force: true, recursive: true })
    }
  })
})
