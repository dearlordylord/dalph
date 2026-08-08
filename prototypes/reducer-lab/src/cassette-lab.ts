import { Cause, Crypto, Effect, Exit, Layer, Option } from "effect"
import * as TestClock from "effect/testing/TestClock"
import * as TestConsole from "effect/testing/TestConsole"
import { runAuthoredScenarioCassette } from "../../../packages/dalph/src/cassettes/authored-runner.ts"
import { maintainedAuthoredCassetteCatalog } from "../../../packages/dalph/src/cassettes/catalog.ts"
import {
  maintainedIntegrationFinalityProtocolCassetteCatalog
} from "../../../packages/dalph/src/cassettes/integration-finality-protocol-cassette-domain.ts"
import {
  runIntegrationFinalityProtocolCassette
} from "../../../packages/dalph/src/cassettes/integration-finality-protocol-cassette.ts"
import {
  maintainedTargetPromotionProtocolCassetteCatalog
} from "../../../packages/dalph/src/cassettes/target-promotion-protocol-cassette-domain.ts"
import {
  runTargetPromotionProtocolCassette
} from "../../../packages/dalph/src/cassettes/target-promotion-protocol-cassette.ts"

type AuthoredCassetteKey = `authored:${keyof typeof maintainedAuthoredCassetteCatalog & string}`
type IntegrationFinalityCassetteKey =
  `integration-finality:${keyof typeof maintainedIntegrationFinalityProtocolCassetteCatalog & string}`
type TargetPromotionCassetteKey =
  `target-promotion:${keyof typeof maintainedTargetPromotionProtocolCassetteCatalog & string}`

export type MaintainedCassetteKey =
  | AuthoredCassetteKey
  | IntegrationFinalityCassetteKey
  | TargetPromotionCassetteKey

type CassetteCategory = "Authored" | "IntegrationFinality" | "TargetPromotion"

interface CassetteExecution {
  readonly activations: ReadonlyArray<"Fresh" | "Recovered">
  readonly evidence: unknown
  readonly journalRecords: ReadonlyArray<unknown>
  readonly runId: string | null
}

interface MaintainedCassetteDescriptor {
  readonly catalogKey: MaintainedCassetteKey
  readonly category: CassetteCategory
  readonly execute: () => Promise<Exit.Exit<CassetteExecution, unknown>>
  readonly story: ReadonlyArray<{ readonly _tag: string }>
  readonly storyName: string
}

export type CassetteFailureLocation =
  | {
      readonly _tag: "Known"
      readonly consumedItemCount: number
      readonly failedItemTag: string
      readonly storyPosition: number
    }
  | { readonly _tag: "Unknown" }

export type CassetteLabResult =
  | {
      readonly _tag: "Completed"
      readonly activations: ReadonlyArray<"Fresh" | "Recovered">
      readonly catalogKey: MaintainedCassetteKey
      readonly category: CassetteCategory
      readonly consumedItemCount: number
      readonly executionEvidence: unknown
      readonly journalRecordCount: number
      readonly journalRecords: ReadonlyArray<unknown>
      readonly runId: string | null
      readonly storyName: string
      readonly totalItemCount: number
    }
  | {
      readonly _tag: "Failed"
      readonly catalogKey: MaintainedCassetteKey
      readonly category: CassetteCategory
      readonly detail: string
      readonly location: CassetteFailureLocation
      readonly storyName: string
      readonly totalItemCount: number
    }

export const controlledBoundaryProvenance =
  "Tracker, Git, executor, and journal boundaries are controlled in memory; implemented Dalph coordinator and protocol code runs through the production cassette runners."

const browserCryptoLayer = Layer.succeed(
  Crypto.Crypto,
  Crypto.make({
    digest: (algorithm, data) =>
      Effect.promise(async () =>
        new Uint8Array(await globalThis.crypto.subtle.digest(algorithm, Uint8Array.from(data).buffer))
      ),
    randomBytes: (size) => globalThis.crypto.getRandomValues(new Uint8Array(size))
  })
)

const cassetteRuntimeLayer = Layer.mergeAll(browserCryptoLayer, TestClock.layer(), TestConsole.layer)

const authoredDescriptors: ReadonlyArray<MaintainedCassetteDescriptor> = Object.entries(
  maintainedAuthoredCassetteCatalog
).map(([key, cassette]) => ({
  catalogKey: `authored:${key}` as AuthoredCassetteKey,
  category: "Authored",
  execute: async () => {
    const exit = await Effect.runPromiseExit(
      runAuthoredScenarioCassette(cassette).pipe(Effect.provide(cassetteRuntimeLayer))
    )
    return Exit.map(exit, (run) => ({
      activations: run.coordinatorActivations,
      evidence: run,
      journalRecords: run.records,
      runId: run.runId
    }))
  },
  story: cassette.story,
  storyName: cassette.name
}))

const targetPromotionDescriptors: ReadonlyArray<MaintainedCassetteDescriptor> = Object.entries(
  maintainedTargetPromotionProtocolCassetteCatalog
).map(([key, cassette]) => ({
  catalogKey: `target-promotion:${key}` as TargetPromotionCassetteKey,
  category: "TargetPromotion",
  execute: async () => {
    const exit = await Effect.runPromiseExit(
      runTargetPromotionProtocolCassette(cassette).pipe(Effect.provide(cassetteRuntimeLayer))
    )
    return Exit.map(exit, (run) => ({
      activations: [],
      evidence: run,
      journalRecords: run.records,
      runId: null
    }))
  },
  story: cassette.story,
  storyName: cassette.name
}))

const integrationFinalityDescriptors: ReadonlyArray<MaintainedCassetteDescriptor> = Object.entries(
  maintainedIntegrationFinalityProtocolCassetteCatalog
).map(([key, cassette]) => ({
  catalogKey: `integration-finality:${key}` as IntegrationFinalityCassetteKey,
  category: "IntegrationFinality",
  execute: async () => {
    const exit = await Effect.runPromiseExit(
      runIntegrationFinalityProtocolCassette(cassette).pipe(Effect.provide(cassetteRuntimeLayer))
    )
    return Exit.map(exit, (run) => ({
      activations: [],
      evidence: run,
      journalRecords: run.records,
      runId: null
    }))
  },
  story: cassette.story,
  storyName: cassette.name
}))

const descriptors = [
  ...authoredDescriptors,
  ...targetPromotionDescriptors,
  ...integrationFinalityDescriptors
] as const

const descriptorByKey = new Map(descriptors.map((descriptor) => [descriptor.catalogKey, descriptor]))

export const maintainedCassetteKeys = descriptors.map(({ catalogKey }) => catalogKey)

export const maintainedCassetteRows = descriptors.map(({ catalogKey, category, story, storyName }) => ({
  catalogKey,
  category,
  storyName,
  totalItemCount: story.length
}))

const failurePosition = (cause: Cause.Cause<unknown>): number | null => {
  const error = Option.getOrUndefined(Cause.findErrorOption(cause))
  if (typeof error !== "object" || error === null) return null
  if ("storyPosition" in error) {
    const position = Reflect.get(error, "storyPosition")
    if (typeof position === "number" && Number.isInteger(position) && position >= 0) return position
  }
  const detail = "detail" in error ? Reflect.get(error, "detail") : null
  if (typeof detail !== "string") return null
  const match = /story position (?<position>\d+)/u.exec(detail)
  const position = Number(match?.groups?.position)
  return Number.isInteger(position) && position >= 0 ? position : null
}

const failedResult = (
  descriptor: MaintainedCassetteDescriptor,
  cause: Cause.Cause<unknown>
): CassetteLabResult => {
  const position = failurePosition(cause)
  const error = Option.getOrUndefined(Cause.findErrorOption(cause))
  const errorDetail = typeof error === "object" && error !== null && "detail" in error
    ? Reflect.get(error, "detail")
    : null
  const failedItemTag = position === null ? undefined : descriptor.story[position]?._tag
  const location: CassetteFailureLocation = position === null || failedItemTag === undefined
    ? { _tag: "Unknown" }
    : { _tag: "Known", consumedItemCount: position, failedItemTag, storyPosition: position }
  return {
    _tag: "Failed",
    catalogKey: descriptor.catalogKey,
    category: descriptor.category,
    detail: typeof errorDetail === "string" ? `${Cause.pretty(cause)}\n${errorDetail}` : Cause.pretty(cause),
    location,
    storyName: descriptor.storyName,
    totalItemCount: descriptor.story.length
  }
}

const completedResult = (
  descriptor: MaintainedCassetteDescriptor,
  execution: CassetteExecution
): CassetteLabResult => ({
  _tag: "Completed",
  activations: execution.activations,
  catalogKey: descriptor.catalogKey,
  category: descriptor.category,
  consumedItemCount: descriptor.story.length,
  executionEvidence: execution.evidence,
  journalRecordCount: execution.journalRecords.length,
  journalRecords: execution.journalRecords,
  runId: execution.runId,
  storyName: descriptor.storyName,
  totalItemCount: descriptor.story.length
})

/** Runs one exact checked-in cassette through the production runner that owns its catalog. */
export const runMaintainedCassette = async (catalogKey: MaintainedCassetteKey): Promise<CassetteLabResult> => {
  const descriptor = descriptorByKey.get(catalogKey)
  if (descriptor === undefined) throw new Error(`Unknown maintained cassette: ${catalogKey}`)
  const exit = await descriptor.execute()
  return Exit.isFailure(exit) ? failedResult(descriptor, exit.cause) : completedResult(descriptor, exit.value)
}

/** Test seam for proving that an authored interaction mismatch reports its exact cursor position. */
export const runAuthoredCassetteInput = async (
  catalogKey: keyof typeof maintainedAuthoredCassetteCatalog,
  input: unknown
): Promise<CassetteLabResult> => {
  const descriptor = authoredDescriptors.find(({ catalogKey: key }) => key === `authored:${catalogKey}`)
  if (descriptor === undefined) throw new Error(`Unknown maintained authored cassette: ${catalogKey}`)
  const exit = await Effect.runPromiseExit(
    runAuthoredScenarioCassette(input).pipe(Effect.provide(cassetteRuntimeLayer))
  )
  const inputStory = typeof input === "object" && input !== null && "story" in input && Array.isArray(input.story)
    ? input.story.filter((item): item is { readonly _tag: string } =>
        typeof item === "object" && item !== null && "_tag" in item && typeof item._tag === "string"
      )
    : descriptor.story
  const inputDescriptor = { ...descriptor, story: inputStory }
  return Exit.isFailure(exit)
    ? failedResult(inputDescriptor, exit.cause)
    : completedResult(inputDescriptor, {
        activations: exit.value.coordinatorActivations,
        evidence: exit.value,
        journalRecords: exit.value.records,
        runId: exit.value.runId
      })
}

/** Runs all maintained catalogs independently; one failure never becomes a passing summary. */
export const runEveryMaintainedCassette = (): Promise<ReadonlyArray<CassetteLabResult>> =>
  Promise.all(maintainedCassetteKeys.map(runMaintainedCassette))
