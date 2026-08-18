/* eslint-disable import/no-nodejs-modules -- this module is the one explicit process-observation adapter. */
import nodeProcess from "node:process"
import nodeFsPromises from "node:fs/promises"
import { execFile } from "node:child_process"
import { setTimeout as nodeSetTimeout } from "node:timers"
import { Context, Effect, Layer } from "effect"

/** The native signal and process observations used by the Codex ownership boundary. */
// eslint-disable-next-line functional/no-mixed-types -- The adapter carries immutable host identity facts alongside its boundary calls.
export interface CodexProcessNativeService {
  readonly platform: NodeJS.Platform
  readonly pid: number
  readonly kill: (pid: number, signal: number | NodeJS.Signals) => void
  readonly readFile: (filename: string) => Promise<string>
  readonly readdir: (directory: string) => Promise<ReadonlyArray<string>>
  readonly execFile: (file: string, arguments_: ReadonlyArray<string>) => Promise<{ readonly stdout: string }>
  readonly wait: (milliseconds: number) => Effect.Effect<void>
}

/** Effect environment for host process, procfs, and bounded polling observations. */
export class CodexProcessNative extends Context.Service<CodexProcessNative, CodexProcessNativeService>()(
  "@dalph/CodexProcessNative"
) {}

const runExecFile = (file: string, arguments_: ReadonlyArray<string>): Promise<{ readonly stdout: string }> =>
  new Promise((resolve, reject) => {
    execFile(file, arguments_, { encoding: "utf8" }, (error, stdout) => {
      if (error !== null) {
        reject(error)
      } else {
        resolve({ stdout })
      }
    })
  })

/** Node's production process/filesystem adapter. */
export const nodeCodexProcessNativeService: CodexProcessNativeService = {
  platform: nodeProcess.platform,
  pid: nodeProcess.pid,
  kill: (pid, signal) => nodeProcess.kill(pid, signal),
  readFile: (filename) => nodeFsPromises.readFile(filename, "utf8"),
  readdir: (directory) => nodeFsPromises.readdir(directory, "utf8"),
  execFile: runExecFile,
  wait: (milliseconds) => Effect.promise(() => new Promise<void>((resolve) => nodeSetTimeout(resolve, milliseconds)))
}

/** Controlled host process observations for deterministic ownership-policy tests. */
export const controlledCodexProcessNativeLayer = (
  service: CodexProcessNativeService
): Layer.Layer<CodexProcessNative> => Layer.succeed(CodexProcessNative, service)

/** Production Layer for the Node process/filesystem adapter. */
export const nodeCodexProcessNativeLayer: Layer.Layer<CodexProcessNative> = Layer.succeed(
  CodexProcessNative,
  nodeCodexProcessNativeService
)
