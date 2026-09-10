import { expect, it } from "vitest"
import { existsSync, readFileSync } from "node:fs"
import { runQualityGateFixture } from "./quality-gate-test-fixture.js"

it("runs only declared package commands whose local scripts exist", async () => {
  const manifest = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"))
  const { invocations, result } = await runQualityGateFixture({ fixtureName: "command-contract" })

  expect(result.exitCode).toBe(0)
  for (const command of invocations) {
    expect(manifest.scripts).toHaveProperty(command)
  }
  for (const command of Object.values(manifest.scripts)) {
    expect(typeof command).toBe("string")
    if (typeof command !== "string") continue
    for (const match of command.matchAll(/\bnode (scripts\/[^\s]+\.mjs)\b/gu)) {
      expect(existsSync(new URL(`../${match[1]}`, import.meta.url))).toBe(true)
    }
  }
})
