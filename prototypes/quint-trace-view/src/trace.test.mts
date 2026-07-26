import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { Schema } from "effect"
import { describe, expect, it } from "vitest"
import {
  frontierRecoveryReconstructionActions,
  frontierRecoveryReconstructionConformanceVersion
} from "../../../packages/orchestrator/test/frontier-recovery/frontier-recovery-conformance.js"
import {
  AdmissionCapacity,
  BigIntWire,
  decodeTrace,
  DisplayedModelStateWire,
  FixtureManifestSchema,
  ImplementationFixtureSchema,
  ItfEnvelopeWire,
  type MbtComparableProjection,
  retainedReconstructionActions,
  SelectorProjectionWire,
  TraceDecodeError
} from "./trace.mjs"

const fixtureRoot = resolve(import.meta.dirname, "..", "fixtures")
const readJson = (path: string): unknown =>
  JSON.parse(readFileSync(path, "utf8"))
const manifest = Schema.decodeUnknownSync(FixtureManifestSchema)(
  readJson(resolve(fixtureRoot, "normal.manifest.json"))
)
if (manifest.implementationProjection === undefined) {
  throw new Error("normal fixture must name its implementation projection")
}
const raw = Schema.decodeUnknownSync(ItfEnvelopeWire)(
  readJson(resolve(fixtureRoot, manifest.rawItf))
)
const implementationFixture = Schema.decodeUnknownSync(
  ImplementationFixtureSchema
)(
  readJson(resolve(fixtureRoot, manifest.implementationProjection))
)
const implementation = implementationFixture.frames

const clone = <A,>(value: A): A => structuredClone(value)

const modelState = (
  state: Readonly<Record<string, unknown>>
): typeof DisplayedModelStateWire.Type => {
  const key = Object.keys(state).find((candidate) => candidate.endsWith("::state"))
  if (key === undefined) throw new Error("fixture has no model state")
  return Schema.decodeUnknownSync(DisplayedModelStateWire)(state[key])
}

const selector = (
  state: Readonly<Record<string, unknown>>
): typeof SelectorProjectionWire.Type =>
  modelState(state).selectorProjection

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value)

const mutableSelector = (
  state: Readonly<Record<string, unknown>>
): Record<string, unknown> => {
  const key = Object.keys(state).find((candidate) => candidate.endsWith("::state"))
  if (key === undefined) throw new Error("fixture has no model state")
  const stateRecord = state[key]
  if (!isRecord(stateRecord)) throw new Error("fixture model state is not a record")
  const projection = stateRecord.selectorProjection
  if (!isRecord(projection)) throw new Error("fixture selector is not a record")
  return projection
}

const requiredState = (
  states: ReadonlyArray<Record<string, unknown>>,
  index: number
): Record<string, unknown> => {
  const state = states[index]
  if (state === undefined) throw new Error(`fixture has no state ${index}`)
  return state
}

const integer = (value: unknown): string =>
  Schema.decodeUnknownSync(BigIntWire)(value)["#bigint"]

const setValues = (
  value: { readonly "#set": ReadonlyArray<typeof BigIntWire.Type> }
): ReadonlyArray<string> =>
  value["#set"].map((entry) => entry["#bigint"])

const expectedEntries = (
  taskIds: ReadonlyArray<string>,
  projection: typeof SelectorProjectionWire.Type
): ReadonlyArray<{
  readonly modelOperationId: string
  readonly modelTaskId: string
  readonly transitionTag: string
}> => {
  const operations = new Map(
    projection.operationIds["#map"].map(([task, operation]) => [
      task["#bigint"],
      operation["#bigint"]
    ])
  )
  const tags = new Map(
    projection.transitionTags["#map"].map(([task, tag]) => [
      task["#bigint"],
      tag
    ])
  )
  return taskIds.map((modelTaskId) => {
    const modelOperationId = operations.get(modelTaskId)
    const transitionTag = tags.get(modelTaskId)
    if (
      modelOperationId === undefined
      || transitionTag === undefined
    ) {
      throw new Error(`fixture lacks decision mapping for ${modelTaskId}`)
    }
    return {
      modelOperationId,
      modelTaskId,
      transitionTag
    }
  })
}

const expectedPickedTask = (
  state: Readonly<Record<string, unknown>>
): string | undefined => {
  const picks = Schema.decodeUnknownSync(
    Schema.Record(Schema.String, Schema.Unknown)
  )(state["mbt::nondetPicks"])
  if (!("task" in picks)) return undefined
  const picked = Schema.decodeUnknownSync(Schema.Union([
    BigIntWire,
    Schema.Struct({ tag: Schema.Literal("None") }),
    Schema.Struct({ tag: Schema.Literal("Some"), value: BigIntWire })
  ]))(picks.task)
  if ("tag" in picked) {
    return picked.tag === "None" ? undefined : picked.value["#bigint"]
  }
  return picked["#bigint"]
}

const expectReason = (
  input: unknown,
  reason: TraceDecodeError["reason"]
): void => {
  expect(() => decodeTrace(input, manifest.provenance)).toThrowError(
    expect.objectContaining({ reason })
  )
}

describe("ITF to normalized frame boundary", () => {
  it("preserves every displayed value from every sampled ITF state", () => {
    const trace = decodeTrace(raw, manifest.provenance)
    trace.frames.forEach((frame, index) => {
      const rawState = requiredState(raw.states, index)
      const projection = selector(rawState)
      const frontierTaskIds = setValues(projection.frontierTaskIds)
        .sort((left, right) => Number(left) - Number(right))
      const admittedTaskIds = setValues(projection.admittedTaskIds)
        .sort((left, right) => Number(left) - Number(right))
      const pickedModelTaskId = expectedPickedTask(rawState)
      expect(frame).toMatchObject({
        action: rawState["mbt::actionTaken"],
        admission: expectedEntries(admittedTaskIds, projection),
        capacity: integer(projection.capacity),
        coordinatorStatus:
          modelState(rawState).coordinator.running ? "Running" : "Crashed",
        explanations: projection.explanations["#set"].map(
          ({ tag, taskId, wakeCondition }) => ({
            modelTaskId: taskId["#bigint"],
            tag,
            wakeCondition
          })
        ),
        frontier: expectedEntries(frontierTaskIds, projection),
        occupiedModelTaskIds: setValues(projection.occupiedTaskIds),
        ...(pickedModelTaskId === undefined ? {} : { pickedModelTaskId }),
        position: `S${index}`,
        reservedModelTaskIds: setValues(projection.reservationTaskIds),
        step: index
      })
      expect(frame.rawItfState).toEqual(rawState)
    })
  })

  it("uses the existing version-3 closed reconstruction action inventory", () => {
    expect(frontierRecoveryReconstructionConformanceVersion).toBe(3)
    expect([...retainedReconstructionActions].sort()).toEqual(
      [...frontierRecoveryReconstructionActions].sort()
    )
  })

  it("equals the existing version-3 MBT comparable projection at every step", () => {
    const trace = decodeTrace(raw, manifest.provenance, implementation)
    expect(trace.frames.map(({ comparison }) => comparison)).toEqual(
      implementation.map(() => ({ status: "Match" }))
    )
  })

  it("reports the first implementation divergence without deciding correctness", () => {
    const divergent: Array<MbtComparableProjection> = [...clone(implementation)]
    const second = divergent[1]
    if (second === undefined) throw new Error("fixture has no second frame")
    divergent[1] = {
      ...second,
      admissionCapacity: Schema.decodeUnknownSync(AdmissionCapacity)("2")
    }
    const trace = decodeTrace(raw, manifest.provenance, divergent)
    expect(trace.frames[1]?.comparison).toEqual({
      firstDivergentField: "admissionCapacity",
      status: "Mismatch"
    })
  })

  it("is byte-identical when decoding the same trace twice", () => {
    expect(JSON.stringify(decodeTrace(raw, manifest.provenance))).toBe(
      JSON.stringify(decodeTrace(raw, manifest.provenance))
    )
  })

  it.each([
    ["restart", 7, "restart"],
    ["counterexample", 3, "weakenedCapacityStep"]
  ] as const)("decodes the retained %s trace", (name, frameCount, finalAction) => {
    const retainedManifest = Schema.decodeUnknownSync(FixtureManifestSchema)(
      readJson(resolve(fixtureRoot, `${name}.manifest.json`))
    )
    const retainedRaw = Schema.decodeUnknownSync(ItfEnvelopeWire)(
      readJson(resolve(fixtureRoot, retainedManifest.rawItf))
    )
    const trace = decodeTrace(retainedRaw, retainedManifest.provenance)
    expect(trace.frames).toHaveLength(frameCount)
    expect(trace.frames.at(-1)?.action).toBe(finalAction)
  })
})

describe("fail-closed inputs", () => {
  it("rejects a violation mislabeled as a sampled trace", () => {
    const changed = clone(raw)
    changed["#meta"].status = "violation"
    expectReason(changed, "InvalidItf")
  })

  it("rejects an ok trace mislabeled as a counterexample", () => {
    const counterexampleManifest = Schema.decodeUnknownSync(
      FixtureManifestSchema
    )(readJson(resolve(fixtureRoot, "counterexample.manifest.json")))
    const counterexample = Schema.decodeUnknownSync(ItfEnvelopeWire)(
      readJson(resolve(fixtureRoot, counterexampleManifest.rawItf))
    )
    counterexample["#meta"].status = "ok"
    expect(() =>
      decodeTrace(counterexample, counterexampleManifest.provenance)
    ).toThrowError(expect.objectContaining({ reason: "InvalidItf" }))
  })

  it("rejects an unknown action", () => {
    const changed = clone(raw)
    requiredState(changed.states, 0)["mbt::actionTaken"] =
      "inventAnotherScheduler"
    expectReason(changed, "UnknownAction")
  })

  it("rejects a malformed task identity", () => {
    const changed = clone(raw)
    const projection = mutableSelector(requiredState(changed.states, 0))
    const frontier = projection.frontierTaskIds
    if (!isRecord(frontier) || !Array.isArray(frontier["#set"])) {
      throw new Error("fixture frontier is not an ITF set")
    }
    const first = frontier["#set"][0]
    if (!isRecord(first)) throw new Error("fixture has no frontier identity")
    first["#bigint"] = "99"
    expectReason(changed, "MalformedIdentity")
  })

  it("rejects a lossy state index", () => {
    const changed = clone(raw)
    requiredState(changed.states, 0)["#meta"] = {
      index: Number.MAX_SAFE_INTEGER + 1
    }
    expectReason(changed, "LossyInteger")
  })

  it("rejects removal of a decision-bearing field", () => {
    const changed = clone(raw)
    delete mutableSelector(requiredState(changed.states, 0)).reservationTaskIds
    expectReason(changed, "MissingDecisionField")
  })
})
