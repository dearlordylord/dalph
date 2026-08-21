/* eslint-disable import/no-nodejs-modules -- controlled descriptor doubles exercise the private filesystem boundary. */
import nodePath from "node:path"
import type { Stats } from "node:fs"
import type { FileHandle } from "node:fs/promises"
import { Effect, Exit } from "effect"
import { expect, it } from "vitest"
import {
  appendPrivateSnapshot,
  CodexAttemptStoreNativeFailure,
  CodexAttemptStoreFailure,
  acquireLeaseReadFailure,
  acquireDescriptorFailure,
  configurationFailureFromDescriptor,
  configurationFailureFromUnknown,
  ensurePrivateDirectory,
  errorCode,
  inspectPrivateDescriptor,
  inspectPrivateFile,
  invalidStateDirectory,
  leaseLockIsContended,
  nativeFailureDetail,
  nativeErrorCode,
  openPrivateAppendDescriptor,
  openPrivateLeaseDescriptor,
  privateDirectoryStatFailure,
  privateFileStatFailure,
  processUid,
  readPrivateDescriptor,
  readPrivateFile,
  closeLeaseDescriptor,
  releaseAfterAcquireFailure,
  releaseLeaseNativeFailure,
  storeOperationFailure,
  validatePrivateDescriptor
} from "./codex-attempt-store.js"
import {
  CodexAttemptStoreNative,
  controlledCodexAttemptStoreNativeLayer,
  type CodexAttemptStoreNativeService
} from "./codex-attempt-store-native.js"

const controlledNative = (overrides: Partial<CodexAttemptStoreNativeService> = {}): CodexAttemptStoreNativeService => ({
  processUid: () => 1_000,
  path: nodePath,
  lstat: async () => {
    throw Object.assign(new Error("absent"), { code: "ENOENT" })
  },
  mkdir: async () => undefined,
  open: async () => {
    throw new Error("open failed")
  },
  lock: async () => undefined,
  ...overrides
})

const fakeStat = ({
  directory = true,
  file = true,
  mode = 0o600,
  symbolicLink = false,
  uid = 1_000
}: {
  readonly directory?: boolean
  readonly file?: boolean
  readonly mode?: number
  readonly symbolicLink?: boolean
  readonly uid?: number
} = {}): Stats =>
  ({ isDirectory: () => directory, isFile: () => file, isSymbolicLink: () => symbolicLink, mode, uid }) as Stats

const descriptorWithStat = (stat: () => Promise<Stats>): FileHandle => ({ stat }) as FileHandle

const descriptorWithRead = (stat: () => Promise<Stats>, readFile: () => Promise<string>): FileHandle =>
  ({ stat, readFile, close: async () => undefined }) as FileHandle

it("classifies primitive and native coded failures", () => {
  expect(errorCode("failure")).toBe("")
  expect(errorCode({ code: "EAGAIN" })).toBe("EAGAIN")
  expect(nativeErrorCode(null)).toBe("")
  expect(nativeErrorCode({ code: "ENOENT" })).toBe("ENOENT")
  expect(configurationFailureFromUnknown("invalid")).toMatchObject({ detail: "invalid", operation: "configure" })
  expect(configurationFailureFromDescriptor({ detail: "unsafe descriptor" })).toMatchObject({
    detail: "unsafe descriptor",
    operation: "configure"
  })
  expect(acquireDescriptorFailure({ message: "unsafe lease" })).toMatchObject({
    detail: "unsafe lease",
    operation: "acquireServerLease"
  })
  const typed = new CodexAttemptStoreFailure({ detail: "typed", operation: "readAttempt" })
  expect(storeOperationFailure("writeAttempt", typed)).toBe(typed)
  expect(storeOperationFailure("writeAttempt", new CodexAttemptStoreNativeFailure({ cause: "native" }))).toMatchObject({
    detail: "Error: native",
    operation: "writeAttempt"
  })
  expect(storeOperationFailure("writeAttempt", "foreign")).toMatchObject({
    detail: "foreign",
    operation: "writeAttempt"
  })
  expect(releaseLeaseNativeFailure(new CodexAttemptStoreNativeFailure({ cause: "unlock" }))).toMatchObject({
    detail: "unlock",
    operation: "releaseServerLease"
  })
  expect(acquireLeaseReadFailure(typed)).toBe(typed)
  expect(acquireLeaseReadFailure(new CodexAttemptStoreNativeFailure({ cause: "lease read" }))).toMatchObject({
    detail: "Error: lease read",
    operation: "acquireServerLease"
  })
  expect(acquireLeaseReadFailure("foreign")).toMatchObject({ detail: "foreign", operation: "acquireServerLease" })
  expect(["EACCES", "EAGAIN", "EWOULDBLOCK"].every(leaseLockIsContended)).toBe(true)
  expect(leaseLockIsContended("EIO")).toBe(false)
})

it("classifies every private directory and descriptor disposition", async () => {
  const uid = 1_000
  const native = controlledNative({ processUid: () => uid })
  expect(privateDirectoryStatFailure(fakeStat({ symbolicLink: true }), "/state", true, uid)).toContain("symlink")
  expect(privateDirectoryStatFailure(fakeStat({ directory: false }), "/state", true, uid)).toContain("not a directory")
  expect(privateDirectoryStatFailure(fakeStat({ uid: uid + 1 }), "/state", true, uid)).toContain("foreign")
  expect(privateDirectoryStatFailure(fakeStat({ mode: 0o755 }), "/state", true, uid)).toContain("not owner-only")
  expect(privateDirectoryStatFailure(fakeStat(), "/state", false, uid)).toBeUndefined()

  const cases: ReadonlyArray<{ readonly file: FileHandle; readonly tag: "Failure" | "Present" }> = [
    { file: descriptorWithStat(async () => fakeStat({ file: false })), tag: "Failure" },
    { file: descriptorWithStat(async () => fakeStat({ uid: uid + 1 })), tag: "Failure" },
    { file: descriptorWithStat(async () => fakeStat({ mode: 0o644 })), tag: "Failure" },
    { file: descriptorWithStat(async () => fakeStat()), tag: "Present" },
    {
      file: descriptorWithStat(async () => {
        throw new Error("descriptor failed")
      }),
      tag: "Failure"
    }
  ]
  for (const { file, tag } of cases) {
    expect((await inspectPrivateDescriptor(file, "/state/private.json", native))._tag).toBe(tag)
    expect(
      Exit.isFailure(await Effect.runPromiseExit(validatePrivateDescriptor(file, "/state/private.json", native)))
    ).toBe(tag === "Failure")
  }
})

it("rejects every non-canonical locator and unsafe private-file disposition", async () => {
  expect(invalidStateDirectory("", nodePath)).toBe(true)
  expect(invalidStateDirectory(" /state", nodePath)).toBe(true)
  expect(invalidStateDirectory("/state\u0000", nodePath)).toBe(true)
  expect(invalidStateDirectory("relative/state", nodePath)).toBe(true)
  expect(invalidStateDirectory("/state/../state", nodePath)).toBe(true)
  expect(invalidStateDirectory("/", nodePath)).toBe(false)
  expect(invalidStateDirectory("/state", nodePath)).toBe(false)

  const native = controlledNative()
  const uid = processUid(native)
  expect(privateFileStatFailure(fakeStat({ symbolicLink: true }), "/state/file", uid)).toContain("symlink")
  expect(privateFileStatFailure(fakeStat({ file: false }), "/state/file", uid)).toContain("not a regular file")
  if (uid !== undefined) {
    expect(privateFileStatFailure(fakeStat({ uid: uid + 1 }), "/state/file", uid)).toContain("foreign")
  }
  expect(privateFileStatFailure(fakeStat({ mode: 0o644 }), "/state/file", uid)).toContain("not owner-only")
  expect(privateFileStatFailure(fakeStat(), "/state/file", uid)).toBeUndefined()
  expect((await inspectPrivateFile("/state/missing", native))._tag).toBe("Absent")
  expect(
    (
      await inspectPrivateFile(
        "/state/unreadable",
        controlledNative({ lstat: async () => Promise.reject(new Error("unreadable")) })
      )
    )._tag
  ).toBe("Failure")
  expect((await ensurePrivateDirectory(nodePath.parse("/").root, native))._tag).toBe("Failure")
  expect((await ensurePrivateDirectory("/invalid\u0000private-directory", native))._tag).toBe("Failure")
  expect(
    (
      await ensurePrivateDirectory(
        "/state",
        controlledNative({ lstat: async () => Promise.reject(new Error("EACCES")) })
      )
    )._tag
  ).toBe("Failure")
  expect(nativeFailureDetail(new CodexAttemptStoreNativeFailure({ cause: "native" }))).toBe("Error: native")
  expect(processUid(controlledNative({ processUid: () => undefined }))).toBeUndefined()
})

it("keeps descriptor read and append failures inside the typed Effect boundary", async () => {
  const zeroRead = { stat: async () => ({ size: 3 }), read: async () => ({ bytesRead: 0 }) } as FileHandle
  expect(await readPrivateDescriptor(zeroRead)).toBe("")

  const appendFailure = {
    writeFile: async () => Promise.reject(new Error("append failed")),
    chmod: async () => undefined,
    sync: async () => undefined
  }
  expect(Exit.isFailure(await Effect.runPromiseExit(appendPrivateSnapshot(appendFailure, "payload")))).toBe(true)
  const failingNative = controlledNative()
  expect(Exit.isFailure(await Effect.runPromiseExit(readPrivateFile("/state/missing", failingNative)))).toBe(true)
  const readableFile = descriptorWithRead(
    async () => fakeStat(),
    async () => "private payload"
  )
  expect(
    await Effect.runPromise(readPrivateFile("/state/readable", controlledNative({ open: async () => readableFile })))
  ).toBe("private payload")
  const nonRegularFile = descriptorWithRead(
    async () => fakeStat({ file: false }),
    async () => "never read"
  )
  expect(
    Exit.isFailure(
      await Effect.runPromiseExit(
        readPrivateFile("/state/non-regular", controlledNative({ open: async () => nonRegularFile }))
      )
    )
  ).toBe(true)
  await expect(openPrivateAppendDescriptor("/state/missing", failingNative)).rejects.toBeDefined()
  await expect(openPrivateLeaseDescriptor("/state/missing", failingNative)).rejects.toBeDefined()
})

it("selects controlled native calls through an Effect Layer", async () => {
  const uid = await Effect.runPromise(
    Effect.gen(function* () {
      return (yield* CodexAttemptStoreNative).processUid()
    }).pipe(Effect.provide(controlledCodexAttemptStoreNativeLayer(controlledNative())))
  )
  expect(uid).toBe(1_000)
})

it("retains both failures when lease cleanup compounds", async () => {
  const unlockFailure = { cause: "unlock failed" }
  const closeFailure = new CodexAttemptStoreFailure({ detail: "close failed", operation: "releaseServerLease" })
  const release = await Effect.runPromise(
    Effect.flip(closeLeaseDescriptor(Effect.fail(unlockFailure), Effect.fail(closeFailure)))
  )
  expect(release.detail).toContain("unlock failed")
  expect(release.detail).toContain("close failed")

  const acquisition = new CodexAttemptStoreFailure({ detail: "persist failed", operation: "acquireServerLease" })
  const compensation = await Effect.runPromise(
    Effect.flip(releaseAfterAcquireFailure(acquisition, Effect.fail(unlockFailure)))
  )
  expect(compensation.detail).toContain("persist failed")
  expect(compensation.detail).toContain("unlock failed")
})
