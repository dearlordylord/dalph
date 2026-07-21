import { NodeTerminal } from "@effect/platform-node"
import { Effect, FileSystem, Layer, Path, PlatformError, Random } from "effect"
import { ChildProcessSpawner } from "effect/unstable/process"
import { runCliFromStdio } from "./cli.js"
import { dryRunWorkflowInterpreterLayer } from "./dry-run-simulator.js"
import { traceOutputStdioLayer } from "./trace-output.js"
import { trackerGraphReaderFileLayer } from "./tracker-graph-reader.js"
import { workflowTraceOutputLayer } from "./workflow.js"

const denied = (method: string) =>
  PlatformError.systemError({
    _tag: "PermissionDenied",
    module: "DalphDryRun",
    method
  })

const deniedFileSystemLayer = Layer.succeed(
  FileSystem.FileSystem,
  FileSystem.makeNoop({
    remove: () => Effect.fail(denied("FileSystem.remove"))
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

export const dryRunCliApplication = runCliFromStdio.pipe(
  Effect.provide(workflowTraceOutputLayer),
  Effect.provide(traceOutputStdioLayer),
  Effect.provide(defaultDryRunWorkflowInterpreterLayer),
  Effect.provide(trackerGraphReaderFileLayer),
  Effect.provide(dryCliEnvironmentLayer)
)
