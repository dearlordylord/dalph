/* eslint-disable import/no-nodejs-modules -- this module is the private-store native adapter. */
import nodeFsPromises, { type FileHandle } from "node:fs/promises"
import type { Stats } from "node:fs"
import nodeProcess from "node:process"
import nodePath from "node:path"
import { flock, type FlockFlagString } from "fs-ext-extra-prebuilt"
import { Context, Layer } from "effect"

/** Native filesystem and descriptor-lock calls owned by the private Codex store. */
// eslint-disable-next-line functional/no-mixed-types -- The adapter carries the immutable path API alongside its filesystem boundary calls.
export interface CodexAttemptStoreNativeService {
  readonly processUid: () => number | undefined
  readonly path: Pick<typeof nodePath, "join" | "parse" | "sep">
  readonly lstat: (filename: string) => Promise<Stats>
  readonly mkdir: (directory: string, options: { readonly mode: number }) => Promise<void>
  readonly open: (filename: string, flags: number, mode?: number) => Promise<FileHandle>
  readonly lock: (file: FileHandle, flags: FlockFlagString) => Promise<void>
}

/** Effect environment for the private store's native path, descriptor, and lock boundaries. */
export class CodexAttemptStoreNative extends Context.Service<CodexAttemptStoreNative, CodexAttemptStoreNativeService>()(
  "@dalph/CodexAttemptStoreNative"
) {}

const nativeLock = (file: FileHandle, flags: FlockFlagString): Promise<void> =>
  new Promise((resolve, reject) => {
    flock(file.fd, flags, (failure) => (failure === null ? resolve() : reject(failure)))
  })

/** Node's production private-store filesystem and descriptor-lock adapter. */
export const nodeCodexAttemptStoreNativeService: CodexAttemptStoreNativeService = {
  processUid: () => (typeof nodeProcess.getuid === "function" ? nodeProcess.getuid() : undefined),
  path: nodePath,
  lstat: (filename) => nodeFsPromises.lstat(filename),
  mkdir: (directory, options) => nodeFsPromises.mkdir(directory, options),
  open: (filename, flags, mode) => nodeFsPromises.open(filename, flags, mode),
  lock: nativeLock
}

/** Controlled private-store native calls for deterministic descriptor and lease tests. */
export const controlledCodexAttemptStoreNativeLayer = (
  service: CodexAttemptStoreNativeService
): Layer.Layer<CodexAttemptStoreNative> => Layer.succeed(CodexAttemptStoreNative, service)

/** Production Layer for the Node private-store native adapter. */
export const nodeCodexAttemptStoreNativeLayer: Layer.Layer<CodexAttemptStoreNative> = Layer.succeed(
  CodexAttemptStoreNative,
  nodeCodexAttemptStoreNativeService
)
