import { NodeTerminal } from "@effect/platform-node"
import {
  type FixtureReader,
  fixtureReaderFileLayer,
  githubTrackerGraphReaderNodeLayer,
  TrackerAdapterReadContext,
  TrackerAdapterReadError,
  TrackerAdapterReadFailureReason,
  TrackerGraphReader,
  trackerGraphReaderLayer
} from "@dalph/orchestrator"
import { type Config, Effect, FileSystem, Layer, Path, PlatformError, Sink } from "effect"
import { ChildProcessSpawner } from "effect/unstable/process"
import { githubTokenRequirementDetail, runCliFromStdio } from "./cli.js"
import { dryRunOperationIdAllocatorLayer } from "./composition.js"
import { traceOutputStdioLayer } from "../presentation/stdio-trace-output.js"
import { workflowTraceOutputLayer } from "../presentation/workflow-trace.js"

const denied = (method: string) =>
  PlatformError.systemError({ _tag: "PermissionDenied", module: "DalphDryRun", method })

const denyMutation = (method: string) => () => Effect.fail(denied(method))

const deniedFileSystemLayer = Layer.succeed(
  FileSystem.FileSystem,
  FileSystem.makeNoop({
    chmod: denyMutation("FileSystem.chmod"),
    chown: denyMutation("FileSystem.chown"),
    copy: denyMutation("FileSystem.copy"),
    copyFile: denyMutation("FileSystem.copyFile"),
    link: denyMutation("FileSystem.link"),
    makeDirectory: denyMutation("FileSystem.makeDirectory"),
    makeTempDirectory: denyMutation("FileSystem.makeTempDirectory"),
    makeTempDirectoryScoped: denyMutation("FileSystem.makeTempDirectoryScoped"),
    makeTempFile: denyMutation("FileSystem.makeTempFile"),
    makeTempFileScoped: denyMutation("FileSystem.makeTempFileScoped"),
    open: denyMutation("FileSystem.open"),
    remove: denyMutation("FileSystem.remove"),
    rename: denyMutation("FileSystem.rename"),
    sink: () => Sink.fail(denied("FileSystem.sink")),
    symlink: denyMutation("FileSystem.symlink"),
    truncate: denyMutation("FileSystem.truncate"),
    utimes: denyMutation("FileSystem.utimes"),
    writeFile: denyMutation("FileSystem.writeFile"),
    writeFileString: denyMutation("FileSystem.writeFileString")
  })
)

const deniedChildProcessLayer = Layer.succeed(
  ChildProcessSpawner.ChildProcessSpawner,
  ChildProcessSpawner.make(() => Effect.fail(denied("ChildProcessSpawner.spawn")))
)

export const dryCliEnvironmentLayer = Layer.mergeAll(
  deniedChildProcessLayer,
  deniedFileSystemLayer,
  NodeTerminal.layer,
  Path.layer
)

/** A missing live-read credential is a typed adapter-selection failure, not a fixture fallback. */
const githubTokenStartupFailure = new TrackerAdapterReadError({
  context: TrackerAdapterReadContext.cases.Github.make({ operation: "GithubTrackerGraphReader.selectAdapter" }),
  detail: githubTokenRequirementDetail,
  reason: TrackerAdapterReadFailureReason.cases.Transport.make({})
})

const readThrough = <A, E>(
  readerLayer: Layer.Layer<TrackerGraphReader, Config.ConfigError, never>,
  read: (reader: TrackerGraphReader["Service"]) => Effect.Effect<A, E>
) =>
  Effect.gen(function* () {
    const reader = yield* TrackerGraphReader
    return yield* read(reader)
  }).pipe(
    Effect.provide(readerLayer),
    Effect.catchTag("ConfigError", () => Effect.fail(githubTokenStartupFailure))
  )

/** Routes one already-decoded target to exactly one tracker adapter. */
export const makeDryRunTrackerGraphReaderLayer = (
  fixtureReaderLayer: Layer.Layer<FixtureReader>,
  githubReaderLayer: Layer.Layer<TrackerGraphReader, Config.ConfigError, never> = githubTrackerGraphReaderNodeLayer
) => {
  const fixtureLayer = trackerGraphReaderLayer.pipe(Layer.provide(fixtureReaderLayer))
  return Layer.succeed(
    TrackerGraphReader,
    TrackerGraphReader.of({
      read: (target) =>
        readThrough(typeof target === "string" ? fixtureLayer : githubReaderLayer, (reader) => reader.read(target)),
      readTaskWorkSpecification: (target, taskId) =>
        readThrough(typeof target === "string" ? fixtureLayer : githubReaderLayer, (reader) =>
          reader.readTaskWorkSpecification(target, taskId)
        )
    })
  )
}

export const makeDryRunCliApplication = (
  fixtureReaderLayer: Layer.Layer<FixtureReader>,
  githubReaderLayer: Layer.Layer<TrackerGraphReader, Config.ConfigError, never> = githubTrackerGraphReaderNodeLayer
) => {
  const dryRunTrackerGraphReaderLayer = makeDryRunTrackerGraphReaderLayer(fixtureReaderLayer, githubReaderLayer)
  const dryRunTraceLayer = workflowTraceOutputLayer.pipe(Layer.provide(traceOutputStdioLayer))

  return runCliFromStdio.pipe(
    Effect.provide(
      Layer.mergeAll(
        dryRunTrackerGraphReaderLayer,
        dryRunTraceLayer,
        dryRunOperationIdAllocatorLayer,
        dryCliEnvironmentLayer
      )
    )
  )
}

// Live GitHub dry-run CLI registration owner:
// https://github.com/dearlordylord/dalph/issues/103
export const dryRunCliApplication = makeDryRunCliApplication(fixtureReaderFileLayer)
