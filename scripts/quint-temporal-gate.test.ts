import { access, mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { expect, test } from "vitest"

// @ts-expect-error The production quality-gate helper is an executable JavaScript module.
import * as temporalGate from "./quint-temporal-gate.mjs"

const { assertCleanTemporalVerdict, assertViolatedTemporalVerdict, runPreparedTemporalCheck } = temporalGate

test("accepts only a real TLC success marker", () => {
  expect(() =>
    assertCleanTemporalVerdict(
      { exitCode: 0, output: "[ok] No violation found (42ms)" },
      "suspensionRequestEventuallyReleasesPosition"
    )
  ).not.toThrow()
  expect(() =>
    assertCleanTemporalVerdict({ exitCode: 0, output: "" }, "suspensionRequestEventuallyReleasesPosition")
  ).toThrow("no supported TLC success verdict")
  expect(() =>
    assertCleanTemporalVerdict(
      { exitCode: 0, output: "unsupported fairness operator" },
      "suspensionRequestEventuallyReleasesPosition"
    )
  ).toThrow("no supported TLC success verdict")
})

test("requires a real nonzero TLC violation for the temporal mutant", () => {
  expect(() =>
    assertViolatedTemporalVerdict(
      { exitCode: 1, output: "[violation] Found an issue" },
      "suspensionRequestNeverReleasesPosition"
    )
  ).not.toThrow()
  expect(() =>
    assertViolatedTemporalVerdict({ exitCode: 1, output: "backend crashed" }, "suspensionRequestNeverReleasesPosition")
  ).toThrow("not rejected by a real TLC violation")
})

test("prepares the TLC artifact before temporal verification", async () => {
  const directory = await mkdtemp(join(tmpdir(), "dalph-quint-cold-cache-"))
  const artifact = join(directory, "apalache.jar")
  try {
    await expect(access(artifact)).rejects.toThrow()
    await runPreparedTemporalCheck({
      prepareArtifact: async () => {
        await writeFile(artifact, "prepared")
      },
      verifyTemporal: async () => {
        await access(artifact)
      }
    })
  } finally {
    await rm(directory, { force: true, recursive: true })
  }

  let temporalWasInvoked = false
  await expect(
    runPreparedTemporalCheck({
      prepareArtifact: async () => {
        throw new Error("artifact unavailable")
      },
      verifyTemporal: async () => {
        temporalWasInvoked = true
      }
    })
  ).rejects.toThrow("artifact unavailable")
  expect(temporalWasInvoked).toBe(false)
})
