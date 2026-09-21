import assert from "node:assert/strict"
import { test } from "node:test"
import { prewarmVitest } from "./prewarm-vitest.mjs"

void test("prewarms ordinary test modules without executing a test or provider", async () => {
  const calls = []
  const modules = new Map([
    ["/fixture/one.test.ts", { importedModules: new Set([{ id: "/fixture/dependency.ts" }]) }],
    ["/fixture/dependency.ts", { importedModules: new Set() }],
    ["/fixture/two.test.ts", { importedModules: new Set() }]
  ])
  const project = {
    _fetcher: async (moduleId, importer, environment, cacheFs) => {
      calls.push(["fetch", moduleId, importer, environment, cacheFs])
      return { id: moduleId }
    },
    config: { environment: "node" },
    vite: { environments: { ssr: { moduleGraph: { getModuleById: (moduleId) => modules.get(moduleId) } } } }
  }
  const specifications = [
    { moduleId: "/fixture/one.test.ts", project },
    { moduleId: "/fixture/two.test.ts", project }
  ]
  const instance = {
    close: async () => calls.push("close"),
    experimental_parseSpecifications: async (received, options) => {
      calls.push(["parse", received, options])
    },
    getRelevantTestSpecifications: async () => {
      calls.push("discover")
      return specifications
    },
    runTestSpecifications: () => {
      throw new Error("prewarm must not execute tests")
    },
    standalone: async () => calls.push("standalone")
  }
  const createVitest = async () => async (mode, options) => {
    calls.push(["create", mode, options])
    return instance
  }

  const result = await prewarmVitest({
    concurrency: 3,
    createVitest,
    root: "/fixture",
    configPath: "/fixture/vitest.config.ts"
  })

  assert.deepEqual(result, { concurrency: 3, transformedFileCount: 2, warmedModuleCount: 3 })
  assert.deepEqual(calls.slice(0, 4), [
    ["create", "test", { config: "/fixture/vitest.config.ts", root: "/fixture", run: true, watch: false }],
    "standalone",
    "discover",
    ["parse", specifications, { concurrency: 3 }]
  ])
  assert.deepEqual(
    calls
      .filter((call) => Array.isArray(call) && call[0] === "fetch")
      .map((call) => call[1])
      .sort((left, right) => left.localeCompare(right)),
    ["/fixture/dependency.ts", "/fixture/one.test.ts", "/fixture/two.test.ts"]
  )
  assert.equal(calls.at(-1), "close")
})

void test("prewarm restores qualification environment controls after a failed cache operation", async () => {
  const priorQualification = process.env.DALPH_RUN_QUALIFICATION_TESTS
  const priorDelivery = process.env.DALPH_RUN_DELIVERY_REPEATABILITY
  const priorCoverage = process.env.DALPH_COVERAGE_DIRECTORY
  const priorNodeEnvironment = process.env.NODE_ENV
  process.env.DALPH_RUN_QUALIFICATION_TESTS = "1"
  process.env.DALPH_RUN_DELIVERY_REPEATABILITY = "1"
  process.env.DALPH_COVERAGE_DIRECTORY = "/tmp/prewarm-test-coverage"
  try {
    await assert.rejects(
      prewarmVitest({
        createVitest: async () => async () => {
          throw new Error("cache operation failed")
        }
      }),
      /cache operation failed/u
    )
    assert.equal(process.env.DALPH_RUN_QUALIFICATION_TESTS, "1")
    assert.equal(process.env.DALPH_RUN_DELIVERY_REPEATABILITY, "1")
    assert.equal(process.env.DALPH_COVERAGE_DIRECTORY, "/tmp/prewarm-test-coverage")
    assert.equal(process.env.NODE_ENV, priorNodeEnvironment)
  } finally {
    if (priorQualification === undefined) delete process.env.DALPH_RUN_QUALIFICATION_TESTS
    else process.env.DALPH_RUN_QUALIFICATION_TESTS = priorQualification
    if (priorDelivery === undefined) delete process.env.DALPH_RUN_DELIVERY_REPEATABILITY
    else process.env.DALPH_RUN_DELIVERY_REPEATABILITY = priorDelivery
    if (priorCoverage === undefined) delete process.env.DALPH_COVERAGE_DIRECTORY
    else process.env.DALPH_COVERAGE_DIRECTORY = priorCoverage
    if (priorNodeEnvironment === undefined) delete process.env.NODE_ENV
    else process.env.NODE_ENV = priorNodeEnvironment
  }
})
