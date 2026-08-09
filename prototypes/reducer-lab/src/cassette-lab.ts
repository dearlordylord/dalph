import { Cause, Crypto, Effect, Exit, Layer, Option } from "effect"
import * as TestConsole from "effect/testing/TestConsole"
import * as TestClock from "effect/testing/TestClock"
import { sha1 } from "@noble/hashes/legacy.js"
import { sha256, sha384, sha512 } from "@noble/hashes/sha2.js"
import {
  type AuthoredDeliveryFrame,
  type AuthoredDeliveryPublication,
  evaluateAuthoredDeliveryPublication,
  runAuthoredScenarioCassette
} from "../../../packages/dalph/src/cassettes/authored-runner.ts"
import { maintainedAuthoredCassetteCatalog } from "../../../packages/dalph/src/cassettes/catalog.ts"
import { renderAuthoredStoryItemLyric } from "../../../packages/dalph/src/cassettes/authored-presentation.ts"
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

export type CassetteCategory = "Authored" | "IntegrationFinality" | "TargetPromotion"

interface CassetteCategoryMetadata {
  readonly controlledBoundaries: string
  readonly itemName: "interactions" | "steps"
  readonly label: string
  readonly runnerName: string
}

const cassetteCategoryMetadata = {
  Authored: {
    controlledBoundaries: "tracker, claims, Git, executor, journal, verification, and promotion",
    itemName: "interactions",
    label: "Authored coordinator stories",
    runnerName: "runAuthoredScenarioCassette"
  },
  IntegrationFinality: {
    controlledBoundaries: "completion-claim tracker boundary and journal",
    itemName: "steps",
    label: "Integration finality protocol",
    runnerName: "runIntegrationFinalityProtocolCassette"
  },
  TargetPromotion: {
    controlledBoundaries: "target Git boundary, exact target leases, and journal",
    itemName: "steps",
    label: "Target promotion protocol",
    runnerName: "runTargetPromotionProtocolCassette"
  }
} as const satisfies Record<CassetteCategory, CassetteCategoryMetadata>

interface CassetteExecution {
  readonly activationOrdinals: ReadonlyArray<number>
  readonly deliveryFrames: ReadonlyArray<AuthoredDeliveryFrame> | null
  readonly evidence: unknown
  readonly journalRecords: ReadonlyArray<unknown>
  readonly runId: string | null
}

interface MaintainedCassetteDescriptor {
  readonly catalogKey: MaintainedCassetteKey
  readonly category: CassetteCategory
  readonly execute: (observer?: CassetteRunObserver) => Promise<Exit.Exit<CassetteExecution, unknown>>
  readonly input: unknown
  readonly surface: CassetteDeliverySurface
  readonly story: ReadonlyArray<{ readonly _tag: string }>
  readonly storyItemSummaries: ReadonlyArray<string>
  readonly storyName: string
}

/** Read-only progress from one selected cassette; it never feeds state back into production. */
export interface CassetteRunObserver {
  readonly onDeliveryFrame: (frame: AuthoredDeliveryFrame) => void
}

interface DeclaredTaskGraph {
  readonly revision: string
  readonly tasks: ReadonlyArray<{
    readonly id: string
    readonly lifecycle: string
    readonly parentTaskId: string | null
    readonly prerequisiteIds: ReadonlyArray<string>
    readonly title: string
  }>
}

type CassetteDeliverySurface =
  | { readonly _tag: "AuthoredDeliverySurface"; readonly declaredGraph: DeclaredTaskGraph }
  | { readonly _tag: "DirectProtocolSurface" }

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
      readonly activationOrdinals: ReadonlyArray<number>
      readonly catalogKey: MaintainedCassetteKey
      readonly category: CassetteCategory
      readonly consumedItemCount: number
      readonly deliveryFrames: ReadonlyArray<AuthoredDeliveryFrame> | null
      readonly executionEvidence: unknown
      readonly journalRecordCount: number
      readonly journalRecords: ReadonlyArray<unknown>
      readonly runnerName: string
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
      readonly runnerName: string
      readonly storyName: string
      readonly totalItemCount: number
    }

/** Computes the Effect Crypto digest contract without requiring a secure browser origin. */
export const browserDigest = (algorithm: Crypto.DigestAlgorithm, data: Uint8Array): Uint8Array => {
  switch (algorithm) {
    case "SHA-1":
      return sha1(data)
    case "SHA-256":
      return sha256(data)
    case "SHA-384":
      return sha384(data)
    case "SHA-512":
      return sha512(data)
  }
}

const browserCryptoLayer = Layer.succeed(
  Crypto.Crypto,
  Crypto.make({
    digest: (algorithm, data) => Effect.sync(() => browserDigest(algorithm, data)),
    randomBytes: (size) => globalThis.crypto.getRandomValues(new Uint8Array(size))
  })
)

const cassetteRuntimeLayer = Layer.mergeAll(browserCryptoLayer, TestClock.layer(), TestConsole.layer)

const authoredDescriptors: ReadonlyArray<MaintainedCassetteDescriptor> = Object.entries(
  maintainedAuthoredCassetteCatalog
).map(([key, cassette]) => ({
  catalogKey: `authored:${key}` as AuthoredCassetteKey,
  category: "Authored",
  execute: async (observer) => {
    let projectionQueue: Promise<void> = Promise.resolve()
    const onDeliveryPublication = observer === undefined
      ? undefined
      : (publication: AuthoredDeliveryPublication) => {
          projectionQueue = projectionQueue.then(async () => {
            const frame = await Effect.runPromise(evaluateAuthoredDeliveryPublication(publication))
            observer.onDeliveryFrame(frame)
          })
        }
    const exit = await Effect.runPromiseExit(
      runAuthoredScenarioCassette(
        cassette,
        onDeliveryPublication === undefined ? {} : { onDeliveryPublication }
      ).pipe(Effect.provide(cassetteRuntimeLayer))
    )
    await projectionQueue
    return Exit.map(exit, (run) => ({
      activationOrdinals: run.activationOrdinals,
      deliveryFrames: run.deliveryFrames,
      evidence: run,
      journalRecords: run.records,
      runId: run.runId
    }))
  },
  input: cassette,
  surface: {
    _tag: "AuthoredDeliverySurface",
    declaredGraph: {
      revision: cassette.startingFacts.trackerGraph.revision,
      tasks: cassette.startingFacts.trackerGraph.tasks.map((task) => ({
        id: task.id,
        lifecycle: task.lifecycle._tag,
        parentTaskId: task.parentTaskId,
        prerequisiteIds: task.prerequisiteIds,
        title: cassette.startingFacts.taskWorkSpecifications.find(({ taskId }) => taskId === task.id)?.title
          ?? task.id
      }))
    }
  },
  story: cassette.story,
  storyItemSummaries: cassette.story.map(renderAuthoredStoryItemLyric),
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
      activationOrdinals: [],
      deliveryFrames: null,
      evidence: run,
      journalRecords: run.records,
      runId: null
    }))
  },
  input: cassette,
  surface: { _tag: "DirectProtocolSurface" },
  story: cassette.story,
  storyItemSummaries: cassette.story.map((item) => storyItemSummary(item)),
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
      activationOrdinals: [],
      deliveryFrames: null,
      evidence: run,
      journalRecords: run.records,
      runId: null
    }))
  },
  input: cassette,
  surface: { _tag: "DirectProtocolSurface" },
  story: cassette.story,
  storyItemSummaries: cassette.story.map((item) => storyItemSummary(item)),
  storyName: cassette.name
}))

const descriptors = [
  ...authoredDescriptors,
  ...targetPromotionDescriptors,
  ...integrationFinalityDescriptors
] as const

const descriptorByKey = new Map(descriptors.map((descriptor) => [descriptor.catalogKey, descriptor]))

export const maintainedCassetteKeys = descriptors.map(({ catalogKey }) => catalogKey)

function storyItemSummary(item: Readonly<Record<string, unknown>>): string {
  const fragments: Array<string> = [String(item._tag)]
  const visit = (value: unknown, path: string, depth: number): void => {
    if (depth > 4 || fragments.length >= 8 || typeof value !== "object" || value === null) return
    if (Array.isArray(value)) {
      for (const nested of value) visit(nested, path, depth + 1)
      return
    }
    for (const [key, nested] of Object.entries(value)) {
      const nestedPath = path.length === 0 ? key : `${path}.${key}`
      if (key === "_tag" && typeof nested === "string" && nested !== item._tag) {
        fragments.push(`${path || "value"}=${nested}`)
      } else if (
        /(attemptId|candidateId|detail|failureTag|operationId|owner|reason|requestId|sessionId|taskId)$/u.test(key)
        && (typeof nested === "string" || typeof nested === "number" || typeof nested === "boolean")
      ) {
        fragments.push(`${nestedPath}=${nested}`)
      } else visit(nested, nestedPath, depth + 1)
      if (fragments.length >= 8) return
    }
  }
  visit(item, "", 0)
  return fragments.join(" · ")
}

const storyItemLandmark = (item: Readonly<Record<string, unknown>>): string | null => {
  if (item._tag === "TrackerGraphReadReturned") {
    const graph = typeof item.graph === "object" && item.graph !== null
      ? item.graph as Readonly<Record<string, unknown>>
      : undefined
    const tasks = Array.isArray(graph?.tasks) ? graph.tasks : []
    const taskStates = tasks.flatMap((task) => {
      if (typeof task !== "object" || task === null) return []
      const record = task as Readonly<Record<string, unknown>>
      const lifecycle = typeof record.lifecycle === "object" && record.lifecycle !== null
        ? (record.lifecycle as Readonly<Record<string, unknown>>)._tag
        : undefined
      return [`task ${String(record.id ?? "unknown")} ${String(lifecycle ?? "unknown lifecycle")}`]
    })
    return `Tracker returned graph ${String(graph?.revision ?? "without a revision")}${taskStates.length === 0 ? " with no tasks" : `: ${taskStates.join("; ")}`}`
  }
  if (
    item._tag === "OperatorAppliesControlDirection"
    || item._tag === "OperatorAppliesControlDirectionWhileExecutorRequestInFlight"
  ) {
    const subject = typeof item.subject === "object" && item.subject !== null
      ? item.subject as Readonly<Record<string, unknown>>
      : undefined
    const target = subject?._tag === "Run" ? "the Run" : `task ${String(subject?.taskId ?? "unknown")}`
    return `Operator ${String(item.direction).toLowerCase()}d ${target}${item._tag.endsWith("WhileExecutorRequestInFlight") ? " while its executor request was in flight" : ""}`
  }
  if (item._tag === "PlannedAttemptExecutorWorkReported") {
    const report = typeof item.report === "object" && item.report !== null
      ? item.report as Readonly<Record<string, unknown>>
      : undefined
    const attemptId = String(report?.attemptId ?? "unknown attempt")
    const taskId = /attempt:(?<task>[^:]+):/u.exec(attemptId)?.groups?.task
    return `${taskId === undefined ? attemptId : `Task ${taskId}`} reported ${String(report?._tag ?? "executor state")}${report?._tag === "SafelySuspended" ? "; its held position can now be released" : ""}`
  }
  if (item._tag === "CoordinatorProcessDies") return "The coordinator process died; the next activation reconstructs accepted journal history"
  return null
}

export const maintainedCassetteRows = descriptors.map(({
  catalogKey,
  category,
  input,
  story,
  storyItemSummaries,
  storyName,
  surface
}) => {
  const metadata = cassetteCategoryMetadata[category]
  return {
    catalogKey,
    category,
    categoryLabel: metadata.label,
    controlledBoundaries: metadata.controlledBoundaries,
    declaredInputText: JSON.stringify(input, null, 2),
    itemName: metadata.itemName,
    runnerName: metadata.runnerName,
    surface,
    storyItemTags: story.map(({ _tag }) => _tag),
    storyItemLandmarks: story.map((item) => storyItemLandmark(item)),
    storyItemSummaries,
    storyName,
    totalItemCount: story.length
  }
})

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
    runnerName: cassetteCategoryMetadata[descriptor.category].runnerName,
    storyName: descriptor.storyName,
    totalItemCount: descriptor.story.length
  }
}

const completedResult = (
  descriptor: MaintainedCassetteDescriptor,
  execution: CassetteExecution
): CassetteLabResult => ({
  _tag: "Completed",
  activationOrdinals: execution.activationOrdinals,
  catalogKey: descriptor.catalogKey,
  category: descriptor.category,
    consumedItemCount: descriptor.story.length,
    deliveryFrames: execution.deliveryFrames,
  executionEvidence: execution.evidence,
  journalRecordCount: execution.journalRecords.length,
  journalRecords: execution.journalRecords,
  runnerName: cassetteCategoryMetadata[descriptor.category].runnerName,
  runId: execution.runId,
  storyName: descriptor.storyName,
  totalItemCount: descriptor.story.length
})

/** Runs one exact checked-in cassette through the production runner that owns its catalog. */
export const runMaintainedCassette = async (
  catalogKey: MaintainedCassetteKey,
  observer?: CassetteRunObserver
): Promise<CassetteLabResult> => {
  const descriptor = descriptorByKey.get(catalogKey)
  if (descriptor === undefined) throw new Error(`Unknown maintained cassette: ${catalogKey}`)
  const exit = await descriptor.execute(observer)
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
        activationOrdinals: exit.value.activationOrdinals,
        deliveryFrames: exit.value.deliveryFrames,
        evidence: exit.value,
        journalRecords: exit.value.records,
        runId: exit.value.runId
      })
}

/** Runs all maintained catalogs independently; one failure never becomes a passing summary. */
export const runEveryMaintainedCassette = (): Promise<ReadonlyArray<CassetteLabResult>> =>
  Promise.all(maintainedCassetteKeys.map((catalogKey) => runMaintainedCassette(catalogKey)))
