import { expect, it } from "vitest"
import { nodeCodexProcessNativeService } from "../src/application/codex-process-native.js"
import {
  makeIsolatedCodexProcessNativeService,
  processEntryReadIsUnavailable
} from "./isolated-codex-process-native.js"

const errorWithCode = (code: string): Error & { readonly code: string } => Object.assign(new Error(code), { code })

it.each(["EACCES", "ENOENT", "ESRCH"] as const)("excludes a process entry after a %s environment-read race", (code) => {
  expect(processEntryReadIsUnavailable(errorWithCode(code))).toBe(true)
})

it("keeps unrelated process-read failures visible", () => {
  expect(processEntryReadIsUnavailable(errorWithCode("EIO"))).toBe(false)
  expect(processEntryReadIsUnavailable(new Error("process changed identity"))).toBe(false)
})

it.each(["EACCES", "ENOENT", "ESRCH"] as const)(
  "keeps the fixture process view absent when an enumerated readable environment later returns %s",
  async (code) => {
    let reads = 0
    const native = makeIsolatedCodexProcessNativeService({
      ...nodeCodexProcessNativeService,
      platform: "linux",
      readdir: async () => ["501"],
      readFile: async () => {
        reads += 1
        return reads === 1 ? "UNRELATED_PROCESS=1\u0000" : Promise.reject(errorWithCode(code))
      }
    })
    expect(await native.readdir("/proc")).toEqual(["501"])
    await expect(native.readFile("/proc/501/environ")).rejects.toMatchObject({ code: "ENOENT" })
    expect(reads).toBe(2)
  }
)

it.each([errorWithCode("EIO"), new Error("process changed identity")])(
  "preserves unexpected environment-read failure %s after enumeration",
  async (error) => {
    let reads = 0
    const native = makeIsolatedCodexProcessNativeService({
      ...nodeCodexProcessNativeService,
      platform: "linux",
      readdir: async () => ["501"],
      readFile: async () => {
        reads += 1
        return reads === 1 ? "UNRELATED_PROCESS=1\u0000" : Promise.reject(error)
      }
    })
    expect(await native.readdir("/proc")).toEqual(["501"])
    await expect(native.readFile("/proc/501/environ")).rejects.toBe(error)
  }
)
