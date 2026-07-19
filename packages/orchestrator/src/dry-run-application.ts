import { NodeTerminal } from "@effect/platform-node"
import { Effect, FileSystem, Layer, Path, PlatformError } from "effect"
import { ChildProcessSpawner } from "effect/unstable/process"
import { runCliFromStdio } from "./cli.js"
import { traceOutputStdioLayer } from "./trace-output.js"
import { trackerGraphReaderFileLayer } from "./tracker-graph-reader.js"
import { dryRunWorkflowInterpreterLayer, workflowTraceOutputLayer } from "./workflow.js"

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

export const dryRunCliApplication = runCliFromStdio.pipe(
  Effect.provide(workflowTraceOutputLayer),
  Effect.provide(traceOutputStdioLayer),
  Effect.provide(dryRunWorkflowInterpreterLayer),
  Effect.provide(trackerGraphReaderFileLayer),
  Effect.provide(dryCliEnvironmentLayer)
)
