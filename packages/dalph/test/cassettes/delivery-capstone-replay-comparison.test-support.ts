import { Option, Schema } from "effect"
import { type EvidenceReference, RunId, TaskId, TaskRevision } from "@dalph/contracts"

const diagnosticIndent = 2
const diagnosticFunctionSourceLimit = 240

const freshTaskCandidateIdentity = Schema.fromJsonString(
  Schema.Tuple([Schema.Literal("fresh-task-candidate"), RunId, TaskId, TaskRevision])
)

/** The only opaque embedding is AcceptedFreshTaskDeliveryProposal.freshCandidateId. */
const comparisonEmbeddedFreshTaskCandidateId = (id: string, freshRun: string, referenceRun: string) => {
  const decoded = Schema.decodeUnknownOption(freshTaskCandidateIdentity)(id)
  if (Option.isNone(decoded)) return id
  const [tag, runId, taskId, taskRevision] = decoded.value
  if (runId !== freshRun || JSON.stringify(decoded.value) !== id) return id
  return JSON.stringify([tag, referenceRun, taskId, taskRevision])
}
const releaseEvidenceEntryArity = 2

/**
 * These fields carry identities whose constructors include the fresh Run atom.
 * No task, attempt, instruction, Git, ordinal, position, or state field belongs
 * here. Array fields retain their exact element order and cardinality.
 */
const derivedIdentityFields = new Set([
  // Canonical OperationId fields: continuation/replacement witnesses, registry
  // events, cleanup/finality protocols, status, causal presentation and inventories.
  "acceptedOperationIds",
  "actionOperationId",
  "claimObservationOperationId",
  "completedReadOperationIds",
  "currentGraphOperationId",
  "focusedFactsOperationId",
  "freshnessOperationId",
  "gitReadOperationId",
  "graphObservationOperationId",
  "liveOperationIds",
  "observationOperationId",
  "oldWorktreeObservationOperationId",
  "operationId",
  "operationIds",
  "originatingActionOperationId",
  "pendingReadOperationIds",
  "planOperationId",
  "postClaimGraphOperationId",
  "predecessorOperationId",
  "predecessorOperationIds",
  "priorFullObservationOperationId",
  "quiescentGraphOperationId",
  "rejectedClaimOperationId",
  "relatedOperationIds",
  "replacementOperationId",
  "requiredOperationIds",
  "settlementOperationId",
  "specificationObservationOperationId",
  "specificationOperationId",
  "successorOperationId",
  "successorPlanOperationId",
  "targetLineageObservationOperationId",
  "taskClaimObservationOperationId",
  "taskWorkSpecificationObservationOperationId",
  "worktreeCleanupOperationId",
  "worktreeObservationOperationId",
  "worktreeOperationId",
  "claimOperationId",
  "deletionOperationId",
  "waitsForLiveOperationId",
  "sessionId",
  "candidateResource",
  "requestId",
  "token",
  "key"
])

/**
 * RunId's r1 base64url codec has no colon. Cassette operation allocation,
 * deterministic claim tokens, initial/FullRerun Integrator material, promotion
 * requests, completion operations, and their journal keys compose colon atoms.
 * Replace only the whole fresh Run atom in those named identity fields. Keeping
 * every other atom proves that a different session/attempt or correlation is
 * still different; in particular S2's repeated predecessor material is retained.
 */
const substituteRunAtom = (value: string, freshRun: string, referenceRun: string) =>
  value
    .split(":")
    .map((atom) => (atom === freshRun ? referenceRun : atom))
    .join(":")

interface ReadonlyCollectionSnapshotSource extends Iterable<unknown> {
  readonly size: number
}

/** Only the two canonical frozen facade shapes, at their declared public fields. */
const isReadonlyCollectionFacade = (value: unknown, field: string): value is ReadonlyCollectionSnapshotSource => {
  if (value === null || typeof value !== "object" || !Object.isFrozen(value)) return false
  const methods =
    field === "entryCapableTaskIds"
      ? ["entries", "forEach", "has", "keys", "values"]
      : field === "occupied" || field === "releaseEvidence"
        ? ["entries", "forEach", "get", "has", "keys", "values"]
        : undefined
  if (methods === undefined || !("size" in value) || typeof value.size !== "number") return false
  const keys = Reflect.ownKeys(value)
  const expectedKeys = ["size", ...methods, Symbol.iterator]
  return (
    keys.length === expectedKeys.length &&
    expectedKeys.every((key) => keys.includes(key)) &&
    [...methods, Symbol.iterator].every((key) => typeof Reflect.get(value, key) === "function")
  )
}

/** Release lookup keys encode only this exact task and claim-operation witness. */
const comparisonMapEntry = (
  entry: unknown,
  freshRun: string,
  referenceRun: string,
  field: string,
  manifests?: ReadonlyMap<string, EvidenceReference>
): unknown => {
  if (!Array.isArray(entry) || entry.length !== releaseEvidenceEntryArity)
    return comparisonValue(entry, freshRun, referenceRun, "", manifests)
  const [key, evidence]: [unknown, unknown] = [entry[0], entry[1]]
  let normalizedKey = key
  if (
    field === "releaseEvidence" &&
    evidence !== null &&
    typeof evidence === "object" &&
    "taskId" in evidence &&
    "claimOperationId" in evidence &&
    typeof evidence.claimOperationId === "string" &&
    key === JSON.stringify([evidence.taskId, evidence.claimOperationId])
  )
    normalizedKey = JSON.stringify([
      evidence.taskId,
      substituteRunAtom(evidence.claimOperationId, freshRun, referenceRun)
    ])
  return [normalizedKey, comparisonValue(evidence, freshRun, referenceRun, "", manifests)]
}

/** Only the formatter's segment backed by the complete typed proposal may change. */
const comparisonSummary = (summary: string, exact: string, freshRun: string, referenceRun: string) => {
  const proposal: unknown = JSON.parse(exact)
  if (
    proposal === null ||
    typeof proposal !== "object" ||
    !("waitsForLiveOperationId" in proposal) ||
    typeof proposal.waitsForLiveOperationId !== "string"
  )
    return summary
  const operationId = proposal.waitsForLiveOperationId
  const segment = `waits for live operation ${operationId}`
  return summary
    .split(" · ")
    .map((part) =>
      part === segment ? `waits for live operation ${substituteRunAtom(operationId, freshRun, referenceRun)}` : part
    )
    .join(" · ")
}

/** The authored focused-read revision is generated from these exact sibling facts. */
const comparisonTrackerRevision = (value: object, revision: string, freshRun: string, referenceRun: string) => {
  if (
    !("taskId" in value) ||
    typeof value.taskId !== "string" ||
    !("operationId" in value) ||
    typeof value.operationId !== "string"
  )
    return revision
  const generated = `authored-completion:${value.taskId}:${value.operationId}`
  return revision === generated ? substituteRunAtom(generated, freshRun, referenceRun) : revision
}

/** The candidate constructor pairs this exact JSON identity with these sibling facts. */
const comparisonFreshTaskCandidateId = (value: object, id: string, freshRun: string, referenceRun: string) => {
  if (!("_tag" in value) || value._tag !== "FreshTaskCandidate") return id
  if (!("runId" in value) || !("taskId" in value) || !("taskRevision" in value)) return id
  const original = JSON.stringify(["fresh-task-candidate", value.runId, value.taskId, value.taskRevision])
  return id === original && value.runId === freshRun
    ? JSON.stringify(["fresh-task-candidate", referenceRun, value.taskId, value.taskRevision])
    : id
}

/** Decode the canonical length-prefixed status identity before changing only a typed proposal's Run. */
const comparisonStatusEntryIdentity = (
  value: string,
  freshRun: string,
  referenceRun: string,
  manifests?: ReadonlyMap<string, EvidenceReference>
): string => {
  const components: Array<{ readonly kind: string; readonly value: string }> = []
  let offset = 0
  while (offset < value.length) {
    const header = /^([sn])(0|[1-9][0-9]*):/u.exec(value.slice(offset))
    if (header === null) return value
    const kind = header[1]
    const lengthText = header[2]
    if (kind === undefined || lengthText === undefined) return value
    const length = Number(lengthText)
    const start = offset + header[0].length
    const end = start + length
    if (!Number.isSafeInteger(length) || end > value.length) return value
    components.push({ kind, value: value.slice(start, end) })
    offset = end
  }
  return components
    .map((component) => {
      const normalized =
        component.kind === "s" && component.value.startsWith("delivery:")
          ? comparisonValue(component.value, freshRun, referenceRun, "id", manifests)
          : component.value
      const exact = typeof normalized === "string" ? normalized : component.value
      return `${component.kind}${exact.length}:${exact}`
    })
    .join("")
}

/** Structural comparison copy, never a global replacement in mutable text. */
export const comparisonValue = (
  value: unknown,
  freshRun: string,
  referenceRun: string,
  field = "",
  manifests?: ReadonlyMap<string, EvidenceReference>
): unknown => {
  if (typeof value === "string") {
    if (field === "runId") return value === freshRun ? referenceRun : value
    if (field === "entryIdentity") return comparisonStatusEntryIdentity(value, freshRun, referenceRun, manifests)
    // This named capability field retains the complete constructor tuple. The
    // ordinary candidate.id path below still requires its paired sibling facts.
    if (field === "freshCandidateId") return comparisonEmbeddedFreshTaskCandidateId(value, freshRun, referenceRun)
    // Candidate cleanup observations use the same locator constructor as candidateResource.
    if (field === "locator" && value.startsWith("integrator-resource:"))
      return substituteRunAtom(value, freshRun, referenceRun)
    // Production proposal IDs encode the canonical route and Run as JSON.
    if (field === "id" && value.startsWith("delivery:")) {
      const route: unknown = JSON.parse(value.slice("delivery:".length))
      return `delivery:${JSON.stringify(comparisonValue(route, freshRun, referenceRun, "", manifests))}`
    }
    // Authored diagnostics retain the complete typed proposal/obligation JSON.
    // Parse fields before substitution, preserving all payload fields and order.
    if (field === "exact") {
      const diagnostic: unknown = JSON.parse(value)
      return JSON.stringify(
        comparisonValue(diagnostic, freshRun, referenceRun, "", manifests),
        null,
        value.includes("\n") ? diagnosticIndent : undefined
      )
    }
    return derivedIdentityFields.has(field) ? substituteRunAtom(value, freshRun, referenceRun) : value
  }
  if (Array.isArray(value))
    return value.map((item: unknown) => comparisonValue(item, freshRun, referenceRun, field, manifests))
  // Ordered arrays, not Map/Set equality, retain every entry and its storage order.
  if (value instanceof Map)
    return {
      collection: "Map",
      size: value.size,
      entries: Array.from(value, (entry: [unknown, unknown]) =>
        comparisonMapEntry(entry, freshRun, referenceRun, field, manifests)
      )
    }
  if (value instanceof Set)
    return {
      collection: "Set",
      size: value.size,
      values: Array.from(value, (item: unknown) => comparisonValue(item, freshRun, referenceRun, field, manifests))
    }
  if (isReadonlyCollectionFacade(value, field))
    return field === "entryCapableTaskIds"
      ? { collection: "ReadonlySetFacade", size: value.size, values: Array.from(value) }
      : {
          collection: "ReadonlyMapFacade",
          size: value.size,
          entries: Array.from(value, (entry) => comparisonMapEntry(entry, freshRun, referenceRun, field, manifests))
        }
  if (value !== null && typeof value === "object") {
    if (
      field === "evidenceManifest" &&
      "digest" in value &&
      typeof value.digest === "string" &&
      "byteLength" in value &&
      typeof value.byteLength === "number"
    ) {
      const verified = manifests?.get(`${value.byteLength}:${value.digest}`)
      if (verified !== undefined) return { ...value, byteLength: verified.byteLength, digest: verified.digest }
    }
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [
        key,
        key === "summary" && typeof entry === "string" && "exact" in value && typeof value.exact === "string"
          ? comparisonSummary(entry, value.exact, freshRun, referenceRun)
          : key === "trackerRevision" && typeof entry === "string"
            ? comparisonTrackerRevision(value, entry, freshRun, referenceRun)
            : key === "id" && typeof entry === "string" && "_tag" in value && value._tag === "FreshTaskCandidate"
              ? comparisonFreshTaskCandidateId(value, entry, freshRun, referenceRun)
              : comparisonValue(entry, freshRun, referenceRun, key, manifests)
      ])
    )
  }
  return value
}

const diagnosticValue = (value: unknown): string => {
  if (typeof value === "function")
    return `function ${value.name}: ${String(value).slice(0, diagnosticFunctionSourceLimit)}`
  if (typeof value === "symbol") return `symbol ${String(value)}`
  if (typeof value === "object" && value !== null)
    return `${Object.prototype.toString.call(value)} keys=${JSON.stringify(Object.keys(value))}`
  return `${typeof value} ${String(value)}`
}

/** Collection entries retain iteration order; this diagnostic does not replace the full assertion. */
const diagnosticEntries = (value: object): ReadonlyArray<readonly [string, unknown]> => {
  if (value instanceof Map)
    return Array.from(
      value,
      ([key, entry]: [unknown, unknown], offset) =>
        [
          [`Map[${offset}].key`, key],
          [`Map[${offset}].value`, entry]
        ] as const
    ).flat()
  if (value instanceof Set) return Array.from(value, (entry: unknown, offset) => [`Set[${offset}]`, entry] as const)
  if (Array.isArray(value)) return [["length", value.length], ...Object.entries(value)]
  return Object.entries(value)
}

/** Finds reference-only differences that Vitest's visual serializer cannot display. */
export const firstDifference = (actual: unknown, reference: unknown, path = "$replay"): string | undefined => {
  if (Object.is(actual, reference)) return undefined
  if (typeof actual !== "object" || actual === null || typeof reference !== "object" || reference === null)
    return `${path}: actual=${diagnosticValue(actual)}; reference=${diagnosticValue(reference)}`
  if (Object.getPrototypeOf(actual) !== Object.getPrototypeOf(reference))
    return `${path}.prototype: actual=${diagnosticValue(Object.getPrototypeOf(actual))}; reference=${diagnosticValue(Object.getPrototypeOf(reference))}`
  const actualEntries = diagnosticEntries(actual)
  const referenceEntries = diagnosticEntries(reference)
  if (actualEntries.length !== referenceEntries.length)
    return `${path}.entries.length: actual=${actualEntries.length}; reference=${referenceEntries.length}`
  for (const [offset, [key, value]] of actualEntries.entries()) {
    const expectedEntry = referenceEntries[offset]
    if (expectedEntry === undefined || key !== expectedEntry[0])
      return `${path}.entries[${offset}].key: actual=${key}; reference=${expectedEntry?.[0]}`
    const difference = firstDifference(value, expectedEntry[1], `${path}[${JSON.stringify(key)}]`)
    if (difference !== undefined) return difference
  }
  return undefined
}
