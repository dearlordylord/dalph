/* eslint-disable import/no-nodejs-modules -- controlled descriptor doubles exercise the private filesystem boundary. */
import nodeProcess from "node:process"
import nodePath from "node:path"
import nodeOs from "node:os"
import nodeFsPromises from "node:fs/promises"
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
  releaseLeaseNativeFailure,
  storeOperationFailure,
  validatePrivateDescriptor
} from "./codex-attempt-store.js"

const fakeStat = ({
  directory = true,
  file = true,
  mode = 0o600,
  symbolicLink = false,
  uid = typeof nodeProcess.getuid === "function" ? nodeProcess.getuid() : 0
}: {
  readonly directory?: boolean
  readonly file?: boolean
  readonly mode?: number
  readonly symbolicLink?: boolean
  readonly uid?: number
} = {}): Stats =>
  ({ isDirectory: () => directory, isFile: () => file, isSymbolicLink: () => symbolicLink, mode, uid }) as Stats

const descriptorWithStat = (stat: () => Promise<Stats>): FileHandle => ({ stat }) as FileHandle

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
  const uid = typeof nodeProcess.getuid === "function" ? nodeProcess.getuid() : 0
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
    expect((await inspectPrivateDescriptor(file, "/state/private.json"))._tag).toBe(tag)
    expect(Exit.isFailure(await Effect.runPromiseExit(validatePrivateDescriptor(file, "/state/private.json")))).toBe(
      tag === "Failure"
    )
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

  const uid = processUid()
  expect(privateFileStatFailure(fakeStat({ symbolicLink: true }), "/state/file", uid)).toContain("symlink")
  expect(privateFileStatFailure(fakeStat({ file: false }), "/state/file", uid)).toContain("not a regular file")
  if (uid !== undefined) {
    expect(privateFileStatFailure(fakeStat({ uid: uid + 1 }), "/state/file", uid)).toContain("foreign")
  }
  expect(privateFileStatFailure(fakeStat({ mode: 0o644 }), "/state/file", uid)).toContain("not owner-only")
  expect(privateFileStatFailure(fakeStat(), "/state/file", uid)).toBeUndefined()
  expect((await inspectPrivateFile("/definitely/missing/dalph-private-file"))._tag).toBe("Absent")
  expect((await inspectPrivateFile("/invalid\u0000private-file"))._tag).toBe("Failure")
  expect((await ensurePrivateDirectory(nodePath.parse(nodeProcess.cwd()).root))._tag).toBe("Failure")
  expect((await ensurePrivateDirectory("/invalid\u0000private-directory"))._tag).toBe("Failure")
  expect(nativeFailureDetail(new CodexAttemptStoreNativeFailure({ cause: "native" }))).toBe("Error: native")

  const originalGetuid = nodeProcess.getuid
  try {
    Object.defineProperty(nodeProcess, "getuid", { configurable: true, value: undefined })
    expect(processUid()).toBeUndefined()
  } finally {
    Object.defineProperty(nodeProcess, "getuid", { configurable: true, value: originalGetuid })
  }
})

it("keeps descriptor read and append failures inside the typed Effect boundary", async () => {
  const zeroRead = { stat: async () => ({ size: 3 }), read: async () => ({ bytesRead: 0 }) } as FileHandle
  expect(await readPrivateDescriptor(zeroRead)).toBe("")

  const temporaryDirectory = await nodeFsPromises.mkdtemp(nodePath.join(nodeOs.tmpdir(), "dalph-closed-descriptor-"))
  try {
    const appendFailure = await nodeFsPromises.open(nodePath.join(temporaryDirectory, "snapshot"), "a")
    await appendFailure.close()
    expect(Exit.isFailure(await Effect.runPromiseExit(appendPrivateSnapshot(appendFailure, "payload")))).toBe(true)
  } finally {
    await nodeFsPromises.rm(temporaryDirectory, { recursive: true })
  }
  expect(Exit.isFailure(await Effect.runPromiseExit(readPrivateFile("/definitely/missing/dalph-private-state")))).toBe(
    true
  )
  expect(Exit.isFailure(await Effect.runPromiseExit(readPrivateFile(nodeProcess.cwd())))).toBe(true)
  await expect(openPrivateAppendDescriptor("/definitely/missing/dalph-private-state")).rejects.toBeDefined()
  await expect(openPrivateLeaseDescriptor("/definitely/missing/dalph-private-lease")).rejects.toBeDefined()
})
