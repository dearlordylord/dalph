import { expect, test } from "vitest"

import {
  deliveryRepeatabilityExpectedAcceptedOrderDigest,
  deliveryRepeatabilityExpectedOccurrenceCount,
  deliveryRepeatabilityTargetTestName,
  deliveryRepeatabilityTargetTestPath,
  runDeliveryRepeatability,
  runWarmedDeliveryTarget
  // @ts-expect-error The executable repeatability runner is JavaScript test support without declarations.
} from "./run-delivery-repeatability.mjs"

const candidateSha = "0123456789abcdef0123456789abcdef01234567"

type IterationRecord = Record<string, unknown>
// eslint-disable-next-line functional/no-mixed-types -- Test doubles intentionally combine callbacks and scalar controls.
type WarmRunnerOptions = {
  readonly beforeIteration: (iteration: number) => Promise<void>
  readonly iterations: number
  readonly onIteration: (record: IterationRecord) => void
}
// eslint-disable-next-line functional/no-mixed-types -- Test doubles intentionally combine callbacks and scalar controls.
type FreshRunnerOptions = { readonly iterations: number; readonly onIteration: (record: IterationRecord) => void }

const passedWarmResult = () => ({
  testModules: [
    {
      tasks: [
        {
          fullTestName: deliveryRepeatabilityTargetTestName,
          name: deliveryRepeatabilityTargetTestName,
          result: { state: "pass" },
          type: "test"
        }
      ],
      type: "module"
    }
  ],
  unhandledErrors: []
})

test("runs the warmed target repeatedly through one persistent Vitest instance", async () => {
  const calls: Array<unknown> = []
  const iterations: Array<IterationRecord> = []
  const specification = { moduleId: deliveryRepeatabilityTargetTestPath }
  const vitest = {
    close: async () => calls.push("close"),
    getRelevantTestSpecifications: async (filters: Array<string>) => {
      calls.push({ filters })
      return [specification]
    },
    init: async () => calls.push("init"),
    runTestSpecifications: async (specifications: Array<unknown>, allTestsRun: boolean) => {
      calls.push({ allTestsRun, specifications })
      return passedWarmResult()
    }
  }
  const result = await runWarmedDeliveryTarget({
    createVitest: async (mode: string, options: Record<string, unknown>) => {
      calls.push({ mode, options })
      return vitest
    },
    iterations: 3,
    onIteration: (record: Record<string, unknown>) => iterations.push(record)
  })

  expect(calls[0]).toMatchObject({
    mode: "test",
    options: {
      fileParallelism: false,
      isolate: false,
      maxWorkers: 1,
      minWorkers: 1,
      pool: "forks",
      reporters: [],
      testNamePattern: expect.any(String),
      watch: false
    }
  })
  expect(calls.filter((call) => typeof call === "object" && call !== null && "specifications" in call)).toHaveLength(3)
  expect(calls.filter((call) => call === "init")).toHaveLength(1)
  expect(calls.at(-1)).toBe("close")
  expect(result).toHaveLength(3)
  expect(iterations.map(({ iteration, mode, status }) => ({ iteration, mode, status }))).toEqual([
    { iteration: 1, mode: "warm", status: "PASS" },
    { iteration: 2, mode: "warm", status: "PASS" },
    { iteration: 3, mode: "warm", status: "PASS" }
  ])
})

test("warm mode retains a fresh-process sample and labels both execution phases", async () => {
  const progress: Array<IterationRecord> = []
  const warmCalls: Array<WarmRunnerOptions> = []
  const freshCalls: Array<FreshRunnerOptions> = []
  const candidateTrees = ["", "", "", "", ""]
  const candidateShas = [candidateSha, candidateSha, candidateSha, candidateSha]
  const warmRecords = [
    {
      acceptedOrderDigest: deliveryRepeatabilityExpectedAcceptedOrderDigest,
      iteration: 1,
      occurrenceCount: deliveryRepeatabilityExpectedOccurrenceCount,
      status: "PASS"
    },
    {
      acceptedOrderDigest: deliveryRepeatabilityExpectedAcceptedOrderDigest,
      iteration: 2,
      occurrenceCount: deliveryRepeatabilityExpectedOccurrenceCount,
      status: "PASS"
    }
  ]
  const result = await runDeliveryRepeatability({
    freshSampleIterations: 1,
    iterations: 2,
    mode: "warm",
    onIteration: (record: IterationRecord) => progress.push(record),
    resolveCandidateSha: async () => candidateShas.shift(),
    resolveCandidateTree: async () => candidateTrees.shift(),
    runFreshTarget: async (options: FreshRunnerOptions) => {
      freshCalls.push(options)
      options.onIteration({
        acceptedOrderDigest: deliveryRepeatabilityExpectedAcceptedOrderDigest,
        elapsedMilliseconds: 1,
        iteration: 1,
        iterations: 1,
        occurrenceCount: deliveryRepeatabilityExpectedOccurrenceCount,
        status: "PASS"
      })
      return {
        acceptedOrderDigest: deliveryRepeatabilityExpectedAcceptedOrderDigest,
        candidateSha,
        elapsedMilliseconds: 1,
        iterations: [
          {
            acceptedOrderDigest: deliveryRepeatabilityExpectedAcceptedOrderDigest,
            iteration: 1,
            occurrenceCount: deliveryRepeatabilityExpectedOccurrenceCount,
            status: "PASS"
          }
        ],
        occurrenceCount: deliveryRepeatabilityExpectedOccurrenceCount
      }
    },
    runWarmTarget: async (options: WarmRunnerOptions) => {
      warmCalls.push(options)
      for (let iteration = 1; iteration <= options.iterations; iteration += 1) {
        await options.beforeIteration(iteration)
        const record = warmRecords[iteration - 1]
        if (record === undefined) throw new Error(`missing warm record ${iteration}`)
        options.onIteration(record)
      }
      return warmRecords
    }
  })

  expect(warmCalls).toHaveLength(1)
  expect(freshCalls).toHaveLength(1)
  expect(freshCalls[0]).toMatchObject({ iterations: 1 })
  expect(result).toMatchObject({
    acceptedOrderDigest: deliveryRepeatabilityExpectedAcceptedOrderDigest,
    candidateSha,
    freshSampleIterationCount: 1,
    mode: "warm",
    occurrenceCount: deliveryRepeatabilityExpectedOccurrenceCount,
    warmIterationCount: 2
  })
  expect(result.iterations).toHaveLength(2)
  expect(result.freshSample.iterations).toHaveLength(1)
  expect(progress.map(({ mode, phase }) => ({ mode, phase }))).toEqual([
    { mode: "warm", phase: "warm" },
    { mode: "warm", phase: "warm" },
    { mode: "fresh", phase: "fresh-sample" }
  ])
  expect(warmCalls[0]?.beforeIteration).toEqual(expect.any(Function))
})

test("keeps fresh mode as the default and delegates its acceptance runner", async () => {
  const calls: Array<FreshRunnerOptions> = []
  const result = await runDeliveryRepeatability({
    iterations: 2,
    onIteration: () => undefined,
    runFreshTarget: async (options: FreshRunnerOptions) => {
      calls.push(options)
      return {
        acceptedOrderDigest: deliveryRepeatabilityExpectedAcceptedOrderDigest,
        candidateSha,
        elapsedMilliseconds: 1,
        iterations: [],
        occurrenceCount: deliveryRepeatabilityExpectedOccurrenceCount
      }
    }
  })

  expect(calls).toHaveLength(1)
  expect(calls[0]).toMatchObject({ iterations: 2 })
  expect(result).toMatchObject({
    acceptedOrderDigest: deliveryRepeatabilityExpectedAcceptedOrderDigest,
    candidateSha,
    mode: "fresh",
    occurrenceCount: deliveryRepeatabilityExpectedOccurrenceCount
  })
})

test("rejects an invalid warmed target result before reporting a pass", async () => {
  await expect(
    runWarmedDeliveryTarget({
      createVitest: async () => ({
        close: async () => undefined,
        getRelevantTestSpecifications: async () => [{ moduleId: deliveryRepeatabilityTargetTestPath }],
        init: async () => undefined,
        runTestSpecifications: async () => ({ testModules: [], unhandledErrors: [] })
      }),
      iterations: 1
    })
  ).rejects.toThrow(/did not contain exactly one target/u)
})

test("rejects unknown repeatability modes before starting a runner", async () => {
  await expect(runDeliveryRepeatability({ mode: "unknown" })).rejects.toThrow(/mode must be one of fresh, warm/u)
})
