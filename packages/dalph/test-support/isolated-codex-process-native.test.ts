import { expect, it } from "vitest"
import { processEntryReadIsUnavailable } from "./isolated-codex-process-native.js"

const errorWithCode = (code: string): Error & { readonly code: string } => Object.assign(new Error(code), { code })

it.each(["EACCES", "ENOENT", "ESRCH"] as const)("excludes a process entry after a %s environment-read race", (code) => {
  expect(processEntryReadIsUnavailable(errorWithCode(code))).toBe(true)
})

it("keeps unrelated process-read failures visible", () => {
  expect(processEntryReadIsUnavailable(errorWithCode("EIO"))).toBe(false)
  expect(processEntryReadIsUnavailable(new Error("process changed identity"))).toBe(false)
})
