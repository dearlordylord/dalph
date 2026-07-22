import { NodeTerminal } from "@effect/platform-node"
import { Effect, FileSystem, Layer, Path, PlatformError, Sink } from "effect"
import { ChildProcessSpawner } from "effect/unstable/process"
import { runCliFromStdio } from "./cli.js"
import { GitCommitSha, RunId, WorktreeLocator } from "./domain.js"
import { dryRunWorkflowInterpreterLayer } from "./dry-run-simulator.js"
import { deterministicOperationIdAllocatorLayer, deterministicPlannedTaskAttemptLayer } from "./task-work-planning.js"
import { traceOutputStdioLayer } from "./trace-output.js"
import { type FixtureReader, fixtureReaderFileLayer, trackerGraphReaderLayer } from "./tracker-graph-reader.js"
import { workflowTraceOutputLayer } from "./workflow-trace-output.js"

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

const dryRunOperationIdAllocatorLayer = deterministicOperationIdAllocatorLayer(
  "dry-run-operation"
)

const dryRunPlannedTaskAttemptLayer = deterministicPlannedTaskAttemptLayer({
  baseSha: GitCommitSha.make("0000000000000000000000000000000000000000"),
  runId: RunId.make("dry-run"),
  worktreeRoot: WorktreeLocator.make("/dalph/dry-run")
})

export const makeDryRunCliApplication = (
  fixtureReaderLayer: Layer.Layer<FixtureReader>
) =>
  runCliFromStdio.pipe(
    Effect.provide(dryRunWorkflowInterpreterLayer),
    Effect.provide(workflowTraceOutputLayer),
    Effect.provide(traceOutputStdioLayer),
    Effect.provide(dryRunOperationIdAllocatorLayer),
    Effect.provide(dryRunPlannedTaskAttemptLayer),
    Effect.provide(trackerGraphReaderLayer),
    Effect.provide(fixtureReaderLayer),
    Effect.provide(dryCliEnvironmentLayer)
  )

// Live GitHub dry-run CLI registration owner:
// https://github.com/dearlordylord/dalph/issues/103
export const dryRunCliApplication = makeDryRunCliApplication(
  fixtureReaderFileLayer
)
