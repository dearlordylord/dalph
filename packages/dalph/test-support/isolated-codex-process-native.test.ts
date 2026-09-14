import { expect, it } from "vitest"
import { nodeCodexProcessNativeService } from "../src/application/codex-process-native.js"
import {
  makeIsolatedCodexProcessNativeService,
  processEntryReadProvesAbsence
} from "./isolated-codex-process-native.js"

const errorWithCode = (code: string): Error & { readonly code: string } => Object.assign(new Error(code), { code })
const linuxStatPaddingLength = 16
const linuxStat = (pid: number, parentPid: number, processGroupId: number = pid) =>
  `${pid} (fixture) S ${parentPid} ${processGroupId} ${Array.from({ length: linuxStatPaddingLength }, () => "0").join(" ")} 1\n`

it.each(["ENOENT", "ESRCH"] as const)("treats %s as a proven process-entry absence race", (code) => {
  expect(processEntryReadProvesAbsence(errorWithCode(code))).toBe(true)
})

it("does not treat permission denial or unrelated failures as process absence", () => {
  expect(processEntryReadProvesAbsence(errorWithCode("EACCES"))).toBe(false)
  expect(processEntryReadProvesAbsence(errorWithCode("EIO"))).toBe(false)
  expect(processEntryReadProvesAbsence(new Error("process changed identity"))).toBe(false)
})

it("restricts the fixture census to its process and descendants before reading environments", async () => {
  const native = makeIsolatedCodexProcessNativeService({
    ...nodeCodexProcessNativeService,
    pid: 500,
    platform: "linux",
    readdir: async () => ["self", "500", "501", "900"],
    readFile: async (filename) => {
      if (filename === "/proc/500/stat") return linuxStat(500, 1)
      if (filename === "/proc/501/stat") return linuxStat(501, 500)
      if (filename === "/proc/900/stat") return linuxStat(900, 1)
      return Promise.reject(errorWithCode("EACCES"))
    }
  })
  expect(await native.readdir("/proc")).toEqual(["self", "500", "501"])
})

it.each(["ENOENT", "ESRCH"] as const)(
  "keeps the fixture process view absent when a descendant environment later returns %s",
  async (code) => {
    const native = makeIsolatedCodexProcessNativeService({
      ...nodeCodexProcessNativeService,
      pid: 500,
      platform: "linux",
      readdir: async () => ["500", "501"],
      readFile: async (filename) => {
        if (filename === "/proc/500/stat") return linuxStat(500, 1)
        if (filename === "/proc/501/stat") return linuxStat(501, 500)
        return Promise.reject(errorWithCode(code))
      }
    })
    expect(await native.readdir("/proc")).toEqual(["500", "501"])
    await expect(native.readFile("/proc/501/environ")).rejects.toMatchObject({ code: "ENOENT" })
  }
)

const linuxStatus = (real: number, effective: number) =>
  `Name:\tfixture\nUid:\t${real}\t${effective}\t${effective}\t${effective}\n`

const permissionDeniedNative = (candidateEffectiveUid: number) => ({
  ...nodeCodexProcessNativeService,
  pid: 500,
  platform: "linux" as const,
  readdir: async () => ["501"],
  readFile: async (filename: string) => {
    if (filename === "/proc/501/environ") return Promise.reject(errorWithCode("EACCES"))
    if (filename === "/proc/501/status") return linuxStatus(candidateEffectiveUid, candidateEffectiveUid)
    if (filename === "/proc/500/status") return linuxStatus(1000, 1000)
    return Promise.reject(errorWithCode("ENOENT"))
  }
})

it("excludes an EACCES process only after its effective UID proves foreign ownership", async () => {
  const native = makeIsolatedCodexProcessNativeService(permissionDeniedNative(2000))
  await expect(native.readFile("/proc/501/environ")).rejects.toMatchObject({ code: "ENOENT" })
})

it("fails closed when an owned process environment returns EACCES", async () => {
  const native = makeIsolatedCodexProcessNativeService(permissionDeniedNative(1000))
  await expect(native.readFile("/proc/501/environ")).rejects.toMatchObject({ code: "EACCES" })
})

it("keeps a later foreign EACCES absent from the established fixture view", async () => {
  const native = makeIsolatedCodexProcessNativeService({
    ...permissionDeniedNative(2000),
    readdir: async () => ["500", "501"],
    readFile: async (filename) => {
      if (filename === "/proc/501/stat") return linuxStat(501, 500)
      if (filename === "/proc/500/stat") return linuxStat(500, 1)
      if (filename === "/proc/501/environ") return Promise.reject(errorWithCode("EACCES"))
      if (filename === "/proc/501/status") return linuxStatus(2000, 2000)
      if (filename === "/proc/500/status") return linuxStatus(1000, 1000)
      return Promise.reject(errorWithCode("ENOENT"))
    }
  })
  expect(await native.readdir("/proc")).toEqual(["500", "501"])
  await expect(native.readFile("/proc/501/environ")).rejects.toMatchObject({ code: "ENOENT" })
})

it("keeps a later owned EACCES visible instead of proving false quiescence", async () => {
  const denied = errorWithCode("EACCES")
  const native = makeIsolatedCodexProcessNativeService({
    ...permissionDeniedNative(1000),
    readdir: async () => ["500", "501"],
    readFile: async (filename) => {
      if (filename === "/proc/501/stat") return linuxStat(501, 500)
      if (filename === "/proc/500/stat") return linuxStat(500, 1)
      if (filename === "/proc/501/environ") return Promise.reject(denied)
      if (filename === "/proc/501/status" || filename === "/proc/500/status") return linuxStatus(1000, 1000)
      return Promise.reject(errorWithCode("ENOENT"))
    }
  })
  expect(await native.readdir("/proc")).toEqual(["500", "501"])
  await expect(native.readFile("/proc/501/environ")).rejects.toBe(denied)
})

it.each([errorWithCode("EIO"), new Error("process changed identity")])(
  "preserves unexpected environment-read failure %s after enumeration",
  async (error) => {
    let reads = 0
    const native = makeIsolatedCodexProcessNativeService({
      ...nodeCodexProcessNativeService,
      pid: 500,
      platform: "linux",
      readdir: async () => ["500", "501"],
      readFile: async (filename) => {
        if (filename === "/proc/500/stat") return linuxStat(500, 1)
        if (filename === "/proc/501/stat") return linuxStat(501, 500)
        reads += 1
        return Promise.reject(error)
      }
    })
    expect(await native.readdir("/proc")).toEqual(["500", "501"])
    await expect(native.readFile("/proc/501/environ")).rejects.toBe(error)
    expect(reads).toBe(1)
  }
)
