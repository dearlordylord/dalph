import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import { test } from "node:test"
import {
  corpusManifestPath,
  deriveCorpusManifest,
  digest,
  validateCorpus,
  validateCorpusManifest
} from "./mbt-corpus-contract.mjs"

const expected = await deriveCorpusManifest()
const manifest = JSON.parse(await readFile(new URL(`../${corpusManifestPath}`, import.meta.url), "utf8"))
const clone = (value) => structuredClone(value)

void test("the maintained manifest binds every selected file, option site, and model closure", () => {
  validateCorpusManifest(manifest, expected)
  assert.equal(manifest.selection.files.length, 15)
  assert.equal(manifest.lanes.length, 39)
  assert.equal(new Set(manifest.lanes.map(({ corpus }) => corpus)).size, 39)
  assert.equal(manifest.lanes.filter(({ declared }) => !declared.includes("maxSamples")).length, 8)
  for (const lane of manifest.lanes) {
    assert.ok(manifest.modelClosures[lane.spec].includes(lane.spec))
    for (const path of manifest.modelClosures[lane.spec]) assert.match(manifest.semanticInputs[path], /^[a-f0-9]{64}$/u)
    assert.ok(lane.options.maxSamples > 0)
    assert.ok(lane.limits.states > 0)
    assert.ok(lane.limits.bytes > 0)
    assert.ok(manifest.replayBoundaries[lane.source].length > 0)
  }
})

for (const [label, mutate] of [
  [
    "missing model",
    (m) => {
      delete m.semanticInputs[m.lanes[0].spec]
    }
  ],
  [
    "changed imported model",
    (m) => {
      m.semanticInputs[m.modelClosures["specs/acceptedResultIntegration.qnt"].at(-1)] = "a".repeat(64)
    }
  ],
  [
    "malformed model digest",
    (m) => {
      m.semanticInputs[m.lanes[0].spec] = "bad"
    }
  ],
  [
    "missing tool",
    (m) => {
      delete m.tools.quint
    }
  ],
  [
    "changed tool",
    (m) => {
      m.tools.quint = "0.0.0"
    }
  ],
  [
    "malformed tool",
    (m) => {
      m.tools.node = 24
    }
  ],
  [
    "missing options",
    (m) => {
      delete m.lanes[0].options
    }
  ],
  [
    "changed options",
    (m) => {
      m.lanes[0].options.maxSamples++
    }
  ],
  [
    "malformed options",
    (m) => {
      m.lanes[0].options.maxSteps = "thirty-five"
    }
  ],
  [
    "missing seed",
    (m) => {
      delete m.lanes[0].options.seed
    }
  ],
  [
    "changed seed",
    (m) => {
      m.lanes[0].options.seed = "58"
    }
  ],
  [
    "malformed seed",
    (m) => {
      m.lanes[0].options.seed = 57
    }
  ],
  [
    "missing lane",
    (m) => {
      m.lanes.pop()
    }
  ],
  [
    "changed state check",
    (m) => {
      m.lanes[0].stateCheck = "none"
    }
  ],
  [
    "unknown field",
    (m) => {
      m.fallback = true
    }
  ]
])
  void test(`refuses ${typeof label === "string" ? label : "invalid control label"} before a replay consumer can run`, () => {
    const invalid = clone(manifest)
    mutate(invalid)
    let invoked = false
    assert.throws(() => {
      validateCorpusManifest(invalid, expected)
      invoked = true
    }, /provenance/u)
    assert.equal(invoked, false)
  })

const canonical = (value) =>
  JSON.stringify(value, (_, item) =>
    item !== null && typeof item === "object" && !Array.isArray(item)
      ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => a.localeCompare(b)))
      : item
  )
const lane = manifest.lanes.find(({ id }) => id === "result-recovery-direction/2")
const bytes = Buffer.from(JSON.stringify([{ states: [{ "mbt::actionTaken": "init", "mbt::nondetPicks": {} }] }]))
const receipt = {
  version: 1,
  lane: lane.id,
  provenanceSha256: digest(canonical(manifest)),
  corpusSha256: digest(bytes)
}

void test("accepts matching provenance and corpus bytes without generation", () => {
  assert.equal(validateCorpus(receipt, bytes, manifest, expected, lane.id).length, 1)
})
for (const [label, changedReceipt, changedBytes] of [
  ["missing receipt", undefined, bytes],
  ["stale corpus", receipt, Buffer.from("[]")],
  ["wrong lane", { ...receipt, lane: "other" }, bytes],
  ["missing provenance", { ...receipt, provenanceSha256: undefined }, bytes],
  ["malformed receipt", { ...receipt, corpusSha256: 12 }, bytes]
])
  void test(`refuses ${typeof label === "string" ? label : "invalid control label"}`, () => {
    assert.throws(() => validateCorpus(changedReceipt, changedBytes, manifest, expected, lane.id), /invalid/u)
  })
void test("refuses matching receipts for missing traces or excessive state depth", () => {
  for (const traces of [[], [{ states: [] }], [{ states: Array.from({ length: 8 }, () => ({})) }]]) {
    const invalid = Buffer.from(JSON.stringify(traces))
    assert.throws(
      () => validateCorpus({ ...receipt, corpusSha256: digest(invalid) }, invalid, manifest, expected, lane.id),
      /budget/u
    )
  }
})
void test("even a rehashed receipt cannot authorize changed model/options provenance", () => {
  const invalid = clone(manifest)
  invalid.lanes[0].options.seed = "58"
  assert.throws(
    () =>
      validateCorpus({ ...receipt, provenanceSha256: digest(canonical(invalid)) }, bytes, invalid, expected, lane.id),
    /provenance/u
  )
})

void test("refuses empty and oversized bytes even when their receipt hashes match", () => {
  const bounded = clone(manifest)
  bounded.lanes.find(({ id }) => id === lane.id).limits.bytes = bytes.byteLength - 1
  assert.throws(
    () =>
      validateCorpus({ ...receipt, provenanceSha256: digest(canonical(bounded)) }, bytes, bounded, bounded, lane.id),
    /size invalid/u
  )
  const empty = Buffer.alloc(0)
  assert.throws(
    () => validateCorpus({ ...receipt, corpusSha256: digest(empty) }, empty, manifest, expected, lane.id),
    /size invalid/u
  )
})
