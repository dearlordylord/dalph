import { fileURLToPath } from "node:url"
import { expect, it } from "vitest"
import { resolveVitestConfig } from "./quality-gate-test-fixture.js"

const exactSourceEntries = {
  "@dalph/contracts": fileURLToPath(new URL("../packages/contracts/src/index.ts", import.meta.url)),
  "@dalph/orchestrator": fileURLToPath(new URL("../packages/orchestrator/src/index.ts", import.meta.url)),
  "@dalph/dalph": fileURLToPath(new URL("../packages/dalph/src/index.ts", import.meta.url))
}
const mbtTestPattern = "packages/**/*.mbt.test.ts"

const requireCurrentSourceResolution = (resolve: ReturnType<typeof resolveVitestConfig>["resolve"]) => {
  expect(resolve?.alias).toEqual(exactSourceEntries)
}

it("keeps both inline MBT projects in the same current-source implementation as ordinary tests", () => {
  const ordinary = resolveVitestConfig("test")
  const mbt = resolveVitestConfig("mbt")
  requireCurrentSourceResolution(ordinary.resolve)
  const projects = mbt.test?.projects
  if (!Array.isArray(projects)) throw new Error("MBT must declare its two inline projects")
  expect(projects).toHaveLength(2)
  for (const project of projects) {
    if (typeof project !== "object" || !("resolve" in project)) {
      throw new Error("inline MBT project lacks its own source resolution")
    }
    expect(project.resolve).toBe(mbt.resolve)
    requireCurrentSourceResolution(project.resolve)
  }
})

it("excludes MBT files from ordinary and coverage selection while retaining explicit MBT mode", () => {
  for (const mode of ["test", "coverage"]) {
    expect(resolveVitestConfig(mode).test?.exclude).toContain(mbtTestPattern)
  }
  expect(resolveVitestConfig("mbt").test?.exclude).not.toContain(mbtTestPattern)
})

it.each([0, 1])("detects missing aliases in inline MBT project %i even when the root has aliases", (index) => {
  requireCurrentSourceResolution(resolveVitestConfig("test").resolve)
  const projects = resolveVitestConfig("mbt").test?.projects
  if (!Array.isArray(projects)) throw new Error("MBT must declare its two inline projects")
  const project = projects[index]
  if (typeof project !== "object" || project instanceof Promise) throw new Error("MBT project must be inline")
  const missingResolution = { ...project, resolve: undefined }
  expect(() => requireCurrentSourceResolution(missingResolution.resolve)).toThrow()
})
