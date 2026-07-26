import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { describe, expect, it } from "vitest"
import {
  decodeTrace,
  type ArtifactProvenance,
  type MbtComparableProjection,
  TraceDecodeError
} from "./trace.mjs"

const fixtureRoot = resolve(import.meta.dirname, "..", "fixtures")
const manifest = JSON.parse(
  readFileSync(resolve(fixtureRoot, "normal.manifest.json"), "utf8")
) as {
  readonly implementationProjection: string
  readonly provenance: ArtifactProvenance
  readonly rawItf: string
}
const raw = JSON.parse(
  readFileSync(resolve(fixtureRoot, manifest.rawItf), "utf8")
) as { readonly states: ReadonlyArray<Record<string, unknown>> }
const implementationFixture = JSON.parse(
  readFileSync(
    resolve(fixtureRoot, manifest.implementationProjection),
    "utf8"
  )
) as {
  readonly frames: ReadonlyArray<MbtComparableProjection>
}
const implementation = implementationFixture.frames

const clone = <A,>(value: A): A => structuredClone(value)

const modelState = (
  state: Record<string, unknown>
): Record<string, unknown> => {
  const key = Object.keys(state).find((candidate) => candidate.endsWith("::state"))
  if (key === undefined) throw new Error("fixture has no model state")
  return state[key] as Record<string, unknown>
}

const selector = (
  state: Record<string, unknown>
): Record<string, unknown> =>
  modelState(state).selectorProjection as Record<string, unknown>

const expectReason = (
  input: unknown,
  reason: TraceDecodeError["reason"]
): void => {
  expect(() => decodeTrace(input, manifest.provenance)).toThrowError(
    expect.objectContaining({ reason })
  )
}

describe("ITF to normalized frame boundary", () => {
  it("preserves every displayed selector value from the raw ITF state", () => {
    const trace = decodeTrace(raw, manifest.provenance)
    expect(trace.frames[0]).toMatchObject({
      action: "init",
      admission: [{
        modelOperationId: "-1",
        modelTaskId: "0",
        transitionTag: "CommitFreshTaskClaimIntent"
      }],
      capacity: "1",
      coordinatorStatus: "Running",
      explanations: [{
        modelTaskId: "2",
        tag: "CapacityWait",
        wakeCondition: "CapacityReleasedOrReconstructedStateChanged"
      }],
      occupiedModelTaskIds: [],
      position: "S0",
      reservedModelTaskIds: ["0"]
    })
    expect(trace.frames[0]?.rawItfState).toEqual(raw.states[0])
  })

  it("equals the existing version-3 MBT comparable projection at every step", () => {
    const trace = decodeTrace(raw, manifest.provenance, implementation)
    expect(trace.frames.map(({ comparison }) => comparison)).toEqual(
      implementation.map(() => ({ status: "Match" }))
    )
  })

  it("reports the first implementation divergence without deciding correctness", () => {
    const divergent = clone(implementation) as Array<MbtComparableProjection>
    divergent[1] = { ...divergent[1]!, admissionCapacity: "2" }
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
    const retainedManifest = JSON.parse(
      readFileSync(resolve(fixtureRoot, `${name}.manifest.json`), "utf8")
    ) as {
      readonly provenance: ArtifactProvenance
      readonly rawItf: string
    }
    const retainedRaw = JSON.parse(
      readFileSync(
        resolve(fixtureRoot, retainedManifest.rawItf),
        "utf8"
      )
    )
    const trace = decodeTrace(retainedRaw, retainedManifest.provenance)
    expect(trace.frames).toHaveLength(frameCount)
    expect(trace.frames.at(-1)?.action).toBe(finalAction)
  })
})

describe("fail-closed inputs", () => {
  it("rejects an unknown action", () => {
    const changed = clone(raw)
    changed.states[0]!["mbt::actionTaken"] = "inventAnotherScheduler"
    expectReason(changed, "UnknownAction")
  })

  it("rejects a malformed task identity", () => {
    const changed = clone(raw)
    const frontier = selector(changed.states[0]!).frontierTaskIds as {
      readonly "#set": Array<{ "#bigint": string }>
    }
    frontier["#set"][0]!["#bigint"] = "99"
    expectReason(changed, "MalformedIdentity")
  })

  it("rejects a lossy state index", () => {
    const changed = clone(raw)
    changed.states[0]!["#meta"] = {
      index: Number.MAX_SAFE_INTEGER + 1
    }
    expectReason(changed, "LossyInteger")
  })

  it("rejects removal of a decision-bearing field", () => {
    const changed = clone(raw)
    delete selector(changed.states[0]!).reservationTaskIds
    expectReason(changed, "MissingDecisionField")
  })
})
