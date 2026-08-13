import { it } from "@effect/vitest"
import { TaskId } from "@dalph/contracts"
import {
  FixtureReader,
  FixtureTarget,
  GithubIssueNumber,
  GithubIssueTarget,
  GithubRepositoryName,
  GithubRepositoryOwner,
  projectTrackerSnapshot,
  TrackerGraphReader
} from "@dalph/orchestrator"
import type { PlatformError } from "effect"
import { ConfigProvider, Effect, FileSystem, Layer, Option, Ref, Sink, Stdio, Stream } from "effect"
import type { Stdio as StdioService } from "effect/Stdio"
import { ChildProcess, ChildProcessSpawner } from "effect/unstable/process"
import { expect } from "vitest"
import { dryCliEnvironmentLayer, dryRunCliApplication, makeDryRunCliApplication } from "./dry-run.js"
import { GithubTokenRequiredError } from "./cli.js"

type IsExactly<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false
type Assert<T extends true> = T
type DryApplicationRequiresOnlyStdio = Assert<IsExactly<Effect.Services<typeof dryRunCliApplication>, StdioService>>

const dryApplicationEnvironmentIsNarrow: DryApplicationRequiresOnlyStdio = true

const deniedFilesystemMutation = <A>(
  method: string,
  effect: Effect.Effect<A, PlatformError.PlatformError>
): readonly [string, Effect.Effect<void, PlatformError.PlatformError>] => [method, Effect.asVoid(effect)]

const githubTarget = GithubIssueTarget.make({
  issueNumber: GithubIssueNumber.make(42),
  owner: GithubRepositoryOwner.make("octo"),
  repository: GithubRepositoryName.make("dalph")
})

const githubSnapshot = Option.getOrThrow(
  Option.fromUndefinedOr(
    (() => {
      const projection = projectTrackerSnapshot({
        revision: "github-dry-run-revision",
        tasks: [
          {
            id: TaskId.make("github-dry-run-root"),
            lifecycle: { _tag: "Open" },
            parentTaskId: null,
            prerequisiteIds: []
          }
        ]
      })
      return projection._tag === "Valid" ? projection.snapshot : undefined
    })()
  )
)

it.effect("runs the complete dry CLI with only Stdio left to supply", () =>
  Effect.gen(function* () {
    const chunks = yield* Ref.make<ReadonlyArray<string>>([])
    const target = new URL("../../../orchestrator/fixtures/singleton.json", import.meta.url).pathname
    const stdioLayer = Stdio.layerTest({
      args: Effect.succeed(["run", "--dry", target]),
      stdout: () =>
        Sink.forEach((chunk: string | Uint8Array) => {
          const text = typeof chunk === "string" ? chunk : new TextDecoder().decode(chunk)
          return Ref.update(chunks, (current) => [...current, text])
        })
    })

    yield* dryRunCliApplication.pipe(Effect.provide(stdioLayer))

    expect(dryApplicationEnvironmentIsNarrow).toBe(true)
    expect(yield* Ref.get(chunks)).toHaveLength(17)
  })
)

it.effect("replaces fixture reads at the complete dry CLI boundary", () =>
  Effect.gen(function* () {
    const requestedTargets = yield* Ref.make<ReadonlyArray<FixtureTarget>>([])
    const fixtureReaderLayer = Layer.succeed(
      FixtureReader,
      FixtureReader.of({
        read: Effect.fn("FixtureReader.Test.read")(function* (target) {
          yield* Ref.update(requestedTargets, (targets) => [...targets, target])
          return JSON.stringify({ revision: "injected-fixture-v1", tasks: [] })
        })
      })
    )
    const target = FixtureTarget.make("injected://empty")
    const stdioLayer = Stdio.layerTest({ args: Effect.succeed(["run", "--dry", target]) })

    yield* makeDryRunCliApplication(fixtureReaderLayer).pipe(Effect.provide(stdioLayer))

    expect(yield* Ref.get(requestedTargets)).toEqual([target, target])
  })
)

it.effect("selects the production GitHub reader for an explicit GitHub target", () =>
  Effect.gen(function* () {
    const requestedTargets = yield* Ref.make<ReadonlyArray<unknown>>([])
    const githubReaderLayer = Layer.succeed(
      TrackerGraphReader,
      TrackerGraphReader.of({
        read: Effect.fn("TrackerGraphReader.GithubCliTest.read")(function* (target) {
          yield* Ref.update(requestedTargets, (current) => [...current, target])
          return githubSnapshot
        }),
        readTaskWorkSpecification: () => Effect.die("the GitHub dry run must not request focused task content")
      })
    )
    const fixtureReaderLayer = Layer.succeed(
      FixtureReader,
      FixtureReader.of({ read: () => Effect.die("the GitHub target must not use fixture reads") })
    )
    const chunks = yield* Ref.make<ReadonlyArray<string>>([])
    const stdioLayer = Stdio.layerTest({
      args: Effect.succeed(["run", "github:octo/dalph#42", "--dry"]),
      stdout: () =>
        Sink.forEach((chunk: string | Uint8Array) => {
          const text = typeof chunk === "string" ? chunk : new TextDecoder().decode(chunk)
          return Ref.update(chunks, (current) => [...current, text])
        })
    })

    yield* makeDryRunCliApplication(fixtureReaderLayer, githubReaderLayer).pipe(Effect.provide(stdioLayer))

    expect(yield* Ref.get(requestedTargets)).toEqual([githubTarget])
    expect((yield* Ref.get(chunks)).join("")).toContain('"TaskTrackerFactsObserved"')
  })
)

it.effect("selects the default production GitHub reader and reports its missing token as a typed startup failure", () =>
  Effect.gen(function* () {
    const fixtureReaderLayer = Layer.succeed(
      FixtureReader,
      FixtureReader.of({ read: () => Effect.die("the GitHub target must not use fixture reads") })
    )
    const stdioLayer = Stdio.layerTest({ args: Effect.succeed(["run", "github:octo/dalph#42", "--dry"]) })
    const failure = yield* makeDryRunCliApplication(fixtureReaderLayer).pipe(
      Effect.provide(stdioLayer),
      Effect.provide(ConfigProvider.layer(ConfigProvider.fromUnknown({}))),
      Effect.flip
    )

    expect(failure).toBeInstanceOf(GithubTokenRequiredError)
    if (failure._tag !== "Cli.GithubTokenRequired") return
    expect(failure.variable).toBe("GITHUB_TOKEN")
  })
)

it.effect("denies Effect CLI filesystem and child-process operations", () =>
  Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem
    const spawner = yield* ChildProcessSpawner.ChildProcessSpawner
    const filesystemMutations = [
      deniedFilesystemMutation("FileSystem.chmod", fileSystem.chmod("not-authorized", 0)),
      deniedFilesystemMutation("FileSystem.chown", fileSystem.chown("not-authorized", 0, 0)),
      deniedFilesystemMutation("FileSystem.copy", fileSystem.copy("not-authorized", "destination")),
      deniedFilesystemMutation("FileSystem.copyFile", fileSystem.copyFile("not-authorized", "destination")),
      deniedFilesystemMutation("FileSystem.link", fileSystem.link("not-authorized", "destination")),
      deniedFilesystemMutation("FileSystem.makeDirectory", fileSystem.makeDirectory("not-authorized")),
      deniedFilesystemMutation("FileSystem.makeTempDirectory", fileSystem.makeTempDirectory()),
      deniedFilesystemMutation(
        "FileSystem.makeTempDirectoryScoped",
        Effect.scoped(fileSystem.makeTempDirectoryScoped())
      ),
      deniedFilesystemMutation("FileSystem.makeTempFile", fileSystem.makeTempFile()),
      deniedFilesystemMutation("FileSystem.makeTempFileScoped", Effect.scoped(fileSystem.makeTempFileScoped())),
      deniedFilesystemMutation("FileSystem.open", Effect.scoped(fileSystem.open("not-authorized", { flag: "w" }))),
      deniedFilesystemMutation("FileSystem.remove", fileSystem.remove("not-authorized")),
      deniedFilesystemMutation("FileSystem.rename", fileSystem.rename("not-authorized", "destination")),
      deniedFilesystemMutation("FileSystem.sink", Stream.run(Stream.empty, fileSystem.sink("not-authorized"))),
      deniedFilesystemMutation("FileSystem.symlink", fileSystem.symlink("not-authorized", "destination")),
      deniedFilesystemMutation("FileSystem.truncate", fileSystem.truncate("not-authorized")),
      deniedFilesystemMutation("FileSystem.utimes", fileSystem.utimes("not-authorized", 0, 0)),
      deniedFilesystemMutation("FileSystem.writeFile", fileSystem.writeFile("not-authorized", new Uint8Array())),
      deniedFilesystemMutation("FileSystem.writeFileString", fileSystem.writeFileString("not-authorized", "content"))
    ]
    const fileErrors = yield* Effect.forEach(filesystemMutations, ([method, mutation]) =>
      mutation.pipe(
        Effect.flip,
        Effect.map((error) => ({ error, method }))
      )
    )
    const processError = yield* spawner.exitCode(ChildProcess.make("not-authorized")).pipe(Effect.flip, Effect.orDie)

    expect(fileErrors).toHaveLength(filesystemMutations.length)
    for (const { error, method } of fileErrors) {
      expect(error._tag).toBe("PlatformError")
      expect(error.reason._tag).toBe("PermissionDenied")
      expect(error.reason.method).toBe(method)
    }
    expect(processError._tag).toBe("PlatformError")
    expect(processError.reason._tag).toBe("PermissionDenied")
  }).pipe(Effect.provide(dryCliEnvironmentLayer))
)
