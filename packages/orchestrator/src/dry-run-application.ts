import { NodeTerminal } from "@effect/platform-node"
import { Effect, FileSystem, Layer, Path, PlatformError, Random, Sink } from "effect"
import { ChildProcessSpawner } from "effect/unstable/process"
import { runCliFromStdio } from "./cli.js"
import { dryRunWorkflowInterpreterLayer } from "./dry-run-simulator.js"
import { traceOutputStdioLayer } from "./trace-output.js"
import { type FixtureReader, fixtureReaderFileLayer, trackerGraphReaderLayer } from "./tracker-graph-reader.js"
import { workflowTraceOutputLayer } from "./workflow.js"

const denied = (method: string) =>
  PlatformError.systemError({
    _tag: "PermissionDenied",
    module: "DalphDryRun",
    method
  })

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

// Dry-run demonstration seed policy: https://github.com/dearlordylord/dalph/issues/99
const defaultDryRunRandomSeed = "dry-run-v1"

const defaultDryRunRandomLayer = Layer.effect(
  Random.Random,
  Random.Random.pipe(Random.withSeed(defaultDryRunRandomSeed))
)

const defaultDryRunWorkflowInterpreterLayer = dryRunWorkflowInterpreterLayer.pipe(
  Layer.provide(defaultDryRunRandomLayer)
)

export const makeDryRunCliApplication = (
  fixtureReaderLayer: Layer.Layer<FixtureReader>
) =>
  runCliFromStdio.pipe(
    Effect.provide(workflowTraceOutputLayer),
    Effect.provide(traceOutputStdioLayer),
    Effect.provide(defaultDryRunWorkflowInterpreterLayer),
    Effect.provide(trackerGraphReaderLayer),
    Effect.provide(fixtureReaderLayer),
    Effect.provide(dryCliEnvironmentLayer)
  )

export const dryRunCliApplication = makeDryRunCliApplication(
  fixtureReaderFileLayer
)
