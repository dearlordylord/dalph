import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { Context, Effect, Layer, Schema } from "effect"
import { describe, expect, it } from "vitest"
import { TaskWorkCapacity } from "../../../packages/orchestrator/src/domain.js"
import {
  JournalStore,
  memoryJournalStoreLayer
} from "../../../packages/orchestrator/src/journal-store.js"
import {
  frontierRecoveryReconstructionActions,
  frontierRecoveryReconstructionConformanceVersion
} from "../../../packages/orchestrator/test/frontier-recovery/frontier-recovery-conformance.js"
import type {
  FrontierRecoveryReconstructionProjection
} from "../../../packages/orchestrator/test/frontier-recovery/frontier-recovery-projection.js"
import {
  makeFrontierRecoveryReconstructionControls
} from "../../../packages/orchestrator/test/frontier-recovery/frontier-recovery-reconstruction.js"
import {
  AdmissionCapacity,
  BigIntWire,
  decodeTrace,
  DisplayedModelStateWire,
  FixtureManifestSchema,
  ImplementationFixtureSchema,
  ItfEnvelopeWire,
  type MbtComparableProjection,
  ModelOperationId,
  ModelTaskId,
  retainedReconstructionActions,
  SelectorProjectionWire,
  TraceDecodeError
} from "./trace.mjs"
import {
  buildObservedStateDag,
  renderObservedDagHtml
} from "./render.mjs"

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
const decode = (
  input: unknown,
  provenance = manifest.provenance,
  suppliedImplementation: ReadonlyArray<MbtComparableProjection> = []
) => Effect.runSync(decodeTrace(input, provenance, suppliedImplementation))

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

const reverseItfCollections = (value: unknown): void => {
  if (Array.isArray(value)) {
    value.forEach(reverseItfCollections)
    return
  }
  if (!isRecord(value)) return
  for (const [key, entry] of Object.entries(value)) {
    if ((key === "#set" || key === "#map") && Array.isArray(entry)) {
      entry.reverse()
    }
    reverseItfCollections(entry)
  }
}

const mutableSelector = (
  state: Readonly<Record<string, unknown>>
): Record<string, unknown> => {
  const stateRecord = mutableModelState(state)
  const projection = stateRecord.selectorProjection
  if (!isRecord(projection)) throw new Error("fixture selector is not a record")
  return projection
}

const mutableModelState = (
  state: Readonly<Record<string, unknown>>
): Record<string, unknown> => {
  const key = Object.keys(state).find((candidate) => candidate.endsWith("::state"))
  if (key === undefined) throw new Error("fixture has no model state")
  const stateRecord = state[key]
  if (!isRecord(stateRecord)) throw new Error("fixture model state is not a record")
  return stateRecord
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
  readonly executorResourceUse: string
  readonly modelTaskId: string
  readonly transitionOperation:
    | { readonly _tag: "FreshTransitionWithoutOperation" }
    | {
      readonly _tag: "DurableTransitionOperation"
      readonly modelOperationId: string
    }
  readonly transitionTag: string
}> => {
  const resourceUses = new Map(
    projection.executorResourceUses["#map"].map(([task, resourceUse]) => [
      task["#bigint"],
      resourceUse.tag
    ])
  )
  const operations = new Map(
    projection.transitionOperations["#map"].map(([task, operation]) => [
      task["#bigint"],
      operation.tag === "FreshTransitionWithoutOperation"
        ? { _tag: "FreshTransitionWithoutOperation" as const }
        : {
          _tag: "DurableTransitionOperation" as const,
          modelOperationId: integer(
            Schema.decodeUnknownSync(
              Schema.Struct({ operationId: BigIntWire })
            )(operation.value).operationId
          )
        }
    ])
  )
  const tags = new Map(
    projection.transitionTags["#map"].map(([task, tag]) => [
      task["#bigint"],
      tag
    ])
  )
  return taskIds.map((modelTaskId) => {
    const executorResourceUse = resourceUses.get(modelTaskId)
    const transitionOperation = operations.get(modelTaskId)
    const transitionTag = tags.get(modelTaskId)
    if (
      executorResourceUse === undefined
      || transitionOperation === undefined
      || transitionTag === undefined
    ) {
      throw new Error(`fixture lacks decision mapping for ${modelTaskId}`)
    }
    return {
      executorResourceUse,
      modelTaskId,
      transitionOperation,
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

const productionComparableFrom = (
  state: FrontierRecoveryReconstructionProjection
): MbtComparableProjection => {
  const taskId = (value: bigint) =>
    Schema.decodeUnknownSync(ModelTaskId)(value.toString())
  const operationId = (value: bigint) =>
    Schema.decodeUnknownSync(ModelOperationId)(value.toString())
  const transitionOperation = (
    operation: FrontierRecoveryReconstructionProjection[
      "frontierTransitionOperations"
    ][number]
  ): MbtComparableProjection["frontierTransitionOperations"][number] =>
    operation._tag === "FreshTransitionWithoutOperation"
      ? { _tag: "FreshTransitionWithoutOperation" }
      : {
        _tag: "DurableTransitionOperation",
        modelOperationId: operationId(operation.modelOperationId)
      }
  return {
    activation: {
      activationInProgressModelTaskIds:
        state.activation.activationInProgressModelTaskIds.map(taskId),
      derivedModelTaskIds:
        state.activation.derivedModelTaskIds.map(taskId),
      freshlyObservedModelTaskIds:
        state.activation.freshlyObservedModelTaskIds.map(taskId),
      isolatedModelTaskIds:
        state.activation.isolatedModelTaskIds.map(taskId),
      owners: state.activation.owners.map((owner) => ({
        ...(owner.modelOperationId === undefined
          ? {}
          : { modelOperationId: operationId(owner.modelOperationId) }),
        modelTaskId: taskId(owner.modelTaskId),
        phase: owner.phase
      })),
      postIntentExitedModelTaskIds:
        state.activation.postIntentExitedModelTaskIds.map(taskId),
      preIntentInterruptedModelTaskIds:
        state.activation.preIntentInterruptedModelTaskIds.map(taskId),
      providerConsumingModelTaskIds:
        state.activation.providerConsumingModelTaskIds.map(taskId),
      reservedPositions: state.activation.reservedPositions.map((position) => ({
        correlation: position.correlation,
        ...(position.modelOperationId === undefined
          ? {}
          : { modelOperationId: operationId(position.modelOperationId) }),
        modelTaskId: taskId(position.modelTaskId)
      })),
      resultsRecordedModelTaskIds:
        state.activation.resultsRecordedModelTaskIds.map(taskId),
      runnerModelTaskIds:
        state.activation.runnerModelTaskIds.map(taskId),
      selectedModelTaskIds:
        state.activation.selectedModelTaskIds.map(taskId),
      triggerPending: state.activation.triggerPending
    },
    admissionCapacity: Schema.decodeUnknownSync(AdmissionCapacity)(
      state.admissionCapacity.toString()
    ),
    admittedModelTaskIds: state.admittedModelTaskIds.map(taskId),
    admittedTransitionOperations:
      state.admittedTransitionOperations.map(transitionOperation),
    admittedTransitionTags: state.admittedTransitionTags,
    admissionExplanations: state.admissionExplanations.map((explanation) => ({
      modelTaskId: taskId(explanation.modelTaskId),
      tag: explanation.tag,
      wakeCondition: explanation.wakeCondition
    })),
    admissionReservedModelTaskIds:
      state.admissionReservedModelTaskIds.map(taskId),
    coordinatorRunning: state.coordinatorRunning,
    frontierModelTaskIds: state.frontierModelTaskIds.map(taskId),
    frontierTransitionOperations:
      state.frontierTransitionOperations.map(transitionOperation),
    frontierTransitionTags: state.frontierTransitionTags,
    occupiedModelTaskIds: state.occupiedModelTaskIds.map(taskId)
  }
}

const expectReason = (
  input: unknown,
  reason: TraceDecodeError["reason"],
  provenance = manifest.provenance
): void => {
  expect(
    Effect.runSync(Effect.flip(decodeTrace(input, provenance)))
  ).toMatchObject({ reason })
}

describe("ITF to normalized frame boundary", () => {
  it("renders the frame table as semantic HTML", () => {
    const trace = decode(raw)
    const html = renderObservedDagHtml([trace], trace, trace)
    expect(html).toContain("<table>")
    expect(html).toContain("<th>Step</th>")
    expect(html).toContain("<th>What changed</th>")
    expect(html).toContain("<td><code>0</code></td>")
    expect(html).not.toContain("<section><h2>Frame table</h2><pre>")
  })

  it("merges identical model states into a branching graph", () => {
    const sampled = decode(raw)
    const restartManifest = Schema.decodeUnknownSync(FixtureManifestSchema)(
      readJson(resolve(fixtureRoot, "restart.manifest.json"))
    )
    const restart = decode(
      Schema.decodeUnknownSync(ItfEnvelopeWire)(
        readJson(resolve(fixtureRoot, restartManifest.rawItf))
      ),
      restartManifest.provenance
    )
    const counterexampleManifest = Schema.decodeUnknownSync(
      FixtureManifestSchema
    )(readJson(resolve(fixtureRoot, "counterexample.manifest.json")))
    const counterexample = decode(
      Schema.decodeUnknownSync(ItfEnvelopeWire)(
        readJson(resolve(fixtureRoot, counterexampleManifest.rawItf))
      ),
      counterexampleManifest.provenance
    )

    const dag = buildObservedStateDag([sampled, restart, counterexample])

    expect(dag.nodes.length).toBeLessThan(
      sampled.frames.length
        + restart.frames.length
        + counterexample.frames.length
    )
    expect(
      dag.nodes.filter((node) => node.firstSeenStep === 0)
    ).toHaveLength(1)
    expect(
      dag.edges.filter((edge) => edge.source === dag.nodes[0]?.id)
        .map((edge) => edge.action)
    ).toEqual([
      "orchestratorCommitsNextFreshTaskClaimIntent",
      "taskTrackerReturnsTargetClosureReadWithPredecessor",
      "weakenedCapacityStep(task 0)"
    ])
    expect(dag.nodes[0]?.occurrences).toHaveLength(3)
  })

  it("treats ITF set and map serialization order as semantically irrelevant", () => {
    const sampled = decode(raw)
    const reorderedRaw = clone(raw)
    reverseItfCollections(reorderedRaw)
    const reordered = decode(reorderedRaw)

    const singleGraph = buildObservedStateDag([sampled])
    const graph = buildObservedStateDag([sampled, reordered])

    expect(graph.nodes).toHaveLength(singleGraph.nodes.length)
    expect(
      graph.nodes.reduce(
        (total, node) => total + node.occurrences.length,
        0
      )
    ).toBe(sampled.frames.length * 2)
  })

  it("uses one node for an equal model state at a later trace position", () => {
    const sampled = decode(raw)
    const first = sampled.frames[0]
    const second = sampled.frames[1]
    if (first === undefined || second === undefined) {
      throw new Error("sampled fixture must have two frames")
    }
    const repeatedState = {
      ...sampled,
      frames: [
        first,
        { ...second, rawItfState: first.rawItfState }
      ]
    }

    const dag = buildObservedStateDag([repeatedState])

    expect(dag.nodes).toHaveLength(1)
    expect(dag.nodes[0]?.occurrences).toHaveLength(2)
    expect(dag.edges).toMatchObject([
      { source: "N0", target: "N0" }
    ])
  })

  it("renders five interactive stories and demotes the observed graph", () => {
    const trace = decode(raw)
    const html = renderObservedDagHtml([trace], trace, trace)

    expect(html).toContain("<h1>Quint workflow stories</h1>")
    expect(html).toContain('data-view-panel="crash"')
    expect(html).toContain('data-view-panel="pause"')
    expect(html).toContain('data-view-panel="completion"')
    expect(html).toContain('data-view-panel="success"')
    expect(html).toContain('data-view-panel="changes"')
    expect(html).toContain("Observed paths · not exhaustive")
    expect(html).toContain('data-node-id="N0"')
    expect(html).toContain("addEventListener")
    expect(html).not.toContain("Generated path visual")
    expect(html).not.toContain("stateDiagram-v2")
  })

  it("shows capacity one choosing an existing responsibility before fresh work", () => {
    const fresh = decode(raw)
    const responsibilityManifest = Schema.decodeUnknownSync(
      FixtureManifestSchema
    )(readJson(resolve(fixtureRoot, "responsibility-first.manifest.json")))
    const responsibility = decode(
      Schema.decodeUnknownSync(ItfEnvelopeWire)(
        readJson(resolve(fixtureRoot, responsibilityManifest.rawItf))
      ),
      responsibilityManifest.provenance
    )

    const html = renderObservedDagHtml(
      [fresh],
      fresh,
      responsibility
    )

    expect(html).toContain(
      "Story 2 · Pause preserves work but invalidates permission to continue"
    )
    expect(html).toContain("Task A: Unowned · Task C: Outstanding")
    expect(html).toContain("<small>Admitted</small><strong>{C}</strong>")
    expect(html).toContain("<small>CapacityWait</small><strong>{A}</strong>")
  })

  it("shows real nondeterministic paths reconverging by exact state", () => {
    const storyNames = [
      "explore-claim-c-then-claim-loss",
      "explore-claim-loss-then-claim-c",
      "explore-claim-c-then-git-rewrite",
      "explore-git-rewrite-then-claim-c",
      "explore-claim-c-then-authority-conflict",
      "explore-authority-conflict-then-claim-c"
    ]
    const stories = storyNames.map((name) => {
      const storyManifest = Schema.decodeUnknownSync(FixtureManifestSchema)(
        readJson(resolve(fixtureRoot, `${name}.manifest.json`))
      )
      return decode(
        Schema.decodeUnknownSync(ItfEnvelopeWire)(
          readJson(resolve(fixtureRoot, storyManifest.rawItf))
        ),
        storyManifest.provenance
      )
    })

    const dag = buildObservedStateDag(stories)
    const predecessorCounts = dag.nodes.map(({ id }) =>
      new Set(
        dag.edges
          .filter(({ target }) => target === id)
          .map(({ source }) => source)
      ).size
    )

    expect(dag.nodes).toHaveLength(14)
    expect(predecessorCounts.filter((count) => count === 2)).toHaveLength(3)
    expect(Math.max(...predecessorCounts)).toBe(2)
  })

  it("preserves every displayed value from every sampled ITF state", () => {
    const trace = decode(raw)
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

  it("uses the existing version-5 closed reconstruction action inventory", () => {
    expect(frontierRecoveryReconstructionConformanceVersion).toBe(5)
    expect([...retainedReconstructionActions].sort()).toEqual(
      [...frontierRecoveryReconstructionActions].sort()
    )
  })

  it("equals the existing version-5 MBT comparable projection at every step", () => {
    const trace = decode(raw, manifest.provenance, implementation)
    expect(trace.frames.map(({ comparison }) => comparison)).toEqual(
      implementation.map(() => ({ status: "Match" }))
    )
  })

  it("equals fresh production-backed version-5 reconstruction projections", async () => {
    const services = Effect.runSync(
      Layer.build(memoryJournalStoreLayer).pipe(Effect.scoped)
    )
    const controls = Effect.runSync(
      makeFrontierRecoveryReconstructionControls({
        capacity: TaskWorkCapacity.make(1),
        coordinatorRunning: true,
        journal: Context.get(services, JournalStore)
      }).pipe(Effect.orDie)
    )
    try {
      const production = []
      await Effect.runPromise(controls.init())
      production.push(productionComparableFrom(
        await Effect.runPromise(controls.getState())
      ))
      await Effect.runPromise(
        controls.orchestratorCommitsNextFreshTaskClaimIntent()
      )
      production.push(productionComparableFrom(
        await Effect.runPromise(controls.getState())
      ))
      await Effect.runPromise(
        controls.orchestratorCommitsNextFreshTaskClaimIntent()
      )
      production.push(productionComparableFrom(
        await Effect.runPromise(controls.getState())
      ))

      const trace = decode(raw, manifest.provenance, production)
      expect(trace.frames.map(({ comparison }) => comparison)).toEqual(
        production.map(() => ({ status: "Match" }))
      )
    } finally {
      await Effect.runPromise(controls.close())
    }
  })

  it("reports the first implementation divergence without deciding correctness", () => {
    const divergent: Array<MbtComparableProjection> = [...clone(implementation)]
    const second = divergent[1]
    if (second === undefined) throw new Error("fixture has no second frame")
    divergent[1] = {
      ...second,
      admissionCapacity: Schema.decodeUnknownSync(AdmissionCapacity)("2")
    }
    const trace = decode(raw, manifest.provenance, divergent)
    expect(trace.frames[1]?.comparison).toEqual({
      firstDivergentField: "admissionCapacity",
      status: "Mismatch"
    })
  })

  it("is byte-identical when decoding the same trace twice", () => {
    expect(JSON.stringify(decode(raw))).toBe(
      JSON.stringify(decode(raw))
    )
  })

  it.each([
    ["activation", 5, "claimActivationOwnership"],
    ["restart", 7, "restart"],
    ["counterexample", 3, "weakenedCapacityStep"]
  ] as const)("decodes the retained %s trace", (name, frameCount, finalAction) => {
    const retainedManifest = Schema.decodeUnknownSync(FixtureManifestSchema)(
      readJson(resolve(fixtureRoot, `${name}.manifest.json`))
    )
    const retainedRaw = Schema.decodeUnknownSync(ItfEnvelopeWire)(
      readJson(resolve(fixtureRoot, retainedManifest.rawItf))
    )
    const trace = decode(retainedRaw, retainedManifest.provenance)
    expect(trace.frames).toHaveLength(frameCount)
    expect(trace.frames.at(-1)?.action).toBe(finalAction)
  })
})

describe("fail-closed inputs", () => {
  const storyFixture = (): {
    readonly manifest: typeof FixtureManifestSchema.Type
    readonly raw: typeof ItfEnvelopeWire.Type
  } => {
    const storyManifest = Schema.decodeUnknownSync(FixtureManifestSchema)(
      readJson(resolve(fixtureRoot, "story-claim-loss.manifest.json"))
    )
    return {
      manifest: storyManifest,
      raw: Schema.decodeUnknownSync(ItfEnvelopeWire)(
        readJson(resolve(fixtureRoot, storyManifest.rawItf))
      )
    }
  }

  it("rejects a negative durable implementation operation identity", () => {
    const changed: unknown = clone(implementationFixture)
    if (!isRecord(changed) || !Array.isArray(changed.frames)) {
      throw new Error("implementation fixture has no frames")
    }
    const first = changed.frames[0]
    if (!isRecord(first) || !Array.isArray(first.admittedTransitionOperations)) {
      throw new Error("implementation fixture has no admitted transition operations")
    }
    first.admittedTransitionOperations[0] = {
      _tag: "DurableTransitionOperation",
      modelOperationId: "-1"
    }
    expect(() =>
      Schema.decodeUnknownSync(ImplementationFixtureSchema)(changed)
    ).toThrow()
  })

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
    expectReason(
      counterexample,
      "InvalidItf",
      counterexampleManifest.provenance
    )
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

  it("rejects removal of activation ownership", () => {
    const activationManifest = Schema.decodeUnknownSync(
      FixtureManifestSchema
    )(readJson(resolve(fixtureRoot, "activation.manifest.json")))
    const changed = clone(
      Schema.decodeUnknownSync(ItfEnvelopeWire)(
        readJson(resolve(fixtureRoot, activationManifest.rawItf))
      )
    )
    delete mutableModelState(requiredState(changed.states, 4)).activation
    expectReason(changed, "MissingDecisionField", activationManifest.provenance)
  })

  it("rejects an unknown closed Quint story variant", () => {
    const story = storyFixture()
    const changed = clone(story.raw)
    const authority = mutableModelState(
      requiredState(changed.states, 0)
    ).authority
    if (!isRecord(authority) || !Array.isArray(authority["#map"])) {
      throw new Error("story fixture authority is not an ITF map")
    }
    const first = authority["#map"][0]
    if (!Array.isArray(first) || !isRecord(first[1])) {
      throw new Error("story fixture has no authority entry")
    }
    const claim = first[1].claim
    if (!isRecord(claim)) throw new Error("story fixture claim is not tagged")
    claim.tag = "InventedClaim"
    expectReason(changed, "MissingDecisionField", story.manifest.provenance)
  })

  it("rejects removal of a displayed story revision", () => {
    const story = storyFixture()
    const changed = clone(story.raw)
    const knowledge = mutableModelState(
      requiredState(changed.states, 0)
    ).knowledge
    if (!isRecord(knowledge) || !Array.isArray(knowledge["#map"])) {
      throw new Error("story fixture knowledge is not an ITF map")
    }
    const first = knowledge["#map"][0]
    if (!Array.isArray(first) || !isRecord(first[1])) {
      throw new Error("story fixture has no knowledge entry")
    }
    delete first[1].durableRevision
    expectReason(changed, "MissingDecisionField", story.manifest.provenance)
  })

  it("requires complete and internally consistent story provenance", () => {
    const incomplete = clone(
      readJson(resolve(fixtureRoot, "story-claim-loss.manifest.json"))
    )
    if (
      !isRecord(incomplete)
      || !isRecord(incomplete.provenance)
    ) {
      throw new Error("story fixture has no provenance")
    }
    delete incomplete.provenance.scenarioTestSourceSha256
    expect(() =>
      Schema.decodeUnknownSync(FixtureManifestSchema)(incomplete)
    ).toThrow()

    const mismatched = clone(
      readJson(resolve(fixtureRoot, "story-claim-loss.manifest.json"))
    )
    if (
      !isRecord(mismatched)
      || !isRecord(mismatched.provenance)
    ) {
      throw new Error("story fixture has no provenance")
    }
    mismatched.provenance.init = "anotherTest"
    expect(() =>
      Schema.decodeUnknownSync(FixtureManifestSchema)(mismatched)
    ).toThrow()
  })
})
