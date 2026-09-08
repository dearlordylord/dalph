import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { afterEach, describe, expect, it } from "vitest"

import { readQuintEvaluatorProvenance, renderQuintEvaluatorProvenance } from "./quint-evaluator-provenance.mjs"

const temporaryDirectories: Array<string> = []

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { force: true, recursive: true })))
})

describe("Quint evaluator provenance", () => {
  it("distinguishes evaluator artifacts that claim the same package and evaluator versions", async () => {
    const directory = await mkdtemp(join(tmpdir(), "dalph-quint-provenance-"))
    temporaryDirectories.push(directory)
    const olderArtifact = join(directory, "older-quint-evaluator")
    const currentArtifact = join(directory, "current-quint-evaluator")
    await writeFile(olderArtifact, "older mutable release artifact")
    await writeFile(currentArtifact, "current mutable release artifact")

    const older = await readQuintEvaluatorProvenance(olderArtifact)
    const current = await readQuintEvaluatorProvenance(currentArtifact)

    expect(older.quintPackageVersion).toBe(current.quintPackageVersion)
    expect(older.evaluatorVersion).toBe(current.evaluatorVersion)
    expect(older.sha256).not.toBe(current.sha256)
    expect(current.sha256).toMatch(/^[0-9a-f]{64}$/)
    expect(current.bytes).toBe(Buffer.byteLength("current mutable release artifact"))
    expect(renderQuintEvaluatorProvenance(current)).toContain(`sha256=${current.sha256}`)
  })
})
