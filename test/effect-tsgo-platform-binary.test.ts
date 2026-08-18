import { describe, expect, it } from "vitest"
import { ensureEffectTsgoPlatformBinaryExecutable } from "../scripts/effect-tsgo-platform-binary.mjs"

describe("Effect diagnostics platform binary", () => {
  it("makes the selected Unix platform binary executable", () => {
    const chmodCalls: Array<readonly [path: string, mode: number]> = []
    ensureEffectTsgoPlatformBinaryExecutable({
      architecture: "x64",
      chmod: (path, mode) => void chmodCalls.push([path, mode]),
      platform: "linux",
      resolvePackageJson: (platform, architecture) => `/packages/@effect/tsgo-${platform}-${architecture}/package.json`
    })

    expect(chmodCalls).toEqual([["/packages/@effect/tsgo-linux-x64/lib/tsc", 0o755]])
  })

  it("does not change executable permissions on Windows", () => {
    const chmodCalls: Array<readonly [path: string, mode: number]> = []
    let resolvedPackage = false
    ensureEffectTsgoPlatformBinaryExecutable({
      architecture: "x64",
      chmod: (path, mode) => void chmodCalls.push([path, mode]),
      platform: "win32",
      resolvePackageJson: () => {
        resolvedPackage = true
        return "/unreachable/package.json"
      }
    })

    expect(chmodCalls).toEqual([])
    expect(resolvedPackage).toBe(false)
  })
})
