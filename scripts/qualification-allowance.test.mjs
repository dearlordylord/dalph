import assert from "node:assert/strict"
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, test } from "node:test"
import fc from "fast-check"
import {
  defaultQualificationAllowanceMilliseconds,
  qualificationAllowancePath,
  resolveQualificationAllowance
} from "./qualification-allowance.mjs"

const firstBase = "1".repeat(40)
const secondBase = "2".repeat(40)
const start = Date.parse("2026-09-22T12:00:00.000Z")
const fixtureRoots = []

afterEach(() => {
  for (const root of fixtureRoots.splice(0)) rmSync(root, { force: true, recursive: true })
})

const fixture = () => {
  const root = mkdtempSync(join(tmpdir(), "dalph-qualification-allowance-"))
  fixtureRoots.push(root)
  return { location: { custodyRoot: join(root, "custody"), worktree: join(root, "worktree") } }
}

void test("independent gates for one worktree and planned Base reuse one absolute allowance", () => {
  const { location } = fixture()
  const first = resolveQualificationAllowance({ baseSha: firstBase, location, now: start })
  const later = resolveQualificationAllowance({ baseSha: firstBase, location, now: start + 30 * 60 * 1000 })

  assert.equal(first.record.deadline, new Date(start + defaultQualificationAllowanceMilliseconds).toISOString())
  assert.equal(later.record.deadline, first.record.deadline)
  assert.equal(later.path, first.path)
  assert.equal(later.deadline, new Date(start + 90 * 60 * 1000).toISOString())
})

void test("an expired allowance refuses another independent gate instead of resetting", () => {
  const { location } = fixture()
  resolveQualificationAllowance({ baseSha: firstBase, location, now: start })

  assert.throws(
    () =>
      resolveQualificationAllowance({
        baseSha: firstBase,
        location,
        now: start + defaultQualificationAllowanceMilliseconds
      }),
    /Qualification allowance expired/u
  )
})

void test("a distinct planned Base has a distinct allowance in the same worktree", () => {
  const { location } = fixture()
  const first = resolveQualificationAllowance({ baseSha: firstBase, location, now: start })
  const second = resolveQualificationAllowance({ baseSha: secondBase, location, now: start + 1000 })

  assert.notEqual(second.path, first.path)
  assert.notEqual(second.record.deadline, first.record.deadline)
})

void test("a shorter per-command deadline remains authoritative", () => {
  const { location } = fixture()
  const commandDeadline = new Date(start + 10 * 60 * 1000).toISOString()
  const result = resolveQualificationAllowance({
    baseSha: firstBase,
    configuredGateDeadline: commandDeadline,
    location,
    now: start
  })

  assert.equal(result.deadline, commandDeadline)
})

void test("a corrupt or foreign allowance fails closed", () => {
  const { location } = fixture()
  const first = resolveQualificationAllowance({ baseSha: firstBase, location, now: start })
  const record = JSON.parse(readFileSync(first.path, "utf8"))
  writeFileSync(first.path, `${JSON.stringify({ ...record, baseSha: secondBase })}\n`)

  assert.throws(
    () => resolveQualificationAllowance({ baseSha: firstBase, location, now: start + 1000 }),
    /identity does not match/u
  )
})

void test("the effective gate deadline never exceeds either live allowance", () => {
  fc.assert(
    fc.property(
      fc.integer({ min: 1, max: defaultQualificationAllowanceMilliseconds }),
      fc.integer({ min: 1, max: defaultQualificationAllowanceMilliseconds }),
      (gateRemaining, qualificationRemaining) => {
        const { location } = fixture()
        const allowance = resolveQualificationAllowance({ baseSha: firstBase, location, now: start })
        const record = { ...allowance.record, deadline: new Date(start + qualificationRemaining).toISOString() }
        writeFileSync(allowance.path, `${JSON.stringify(record)}\n`)
        const result = resolveQualificationAllowance({
          baseSha: firstBase,
          configuredGateDeadline: new Date(start + gateRemaining).toISOString(),
          location,
          now: start
        })

        assert.equal(Date.parse(result.deadline), start + Math.min(gateRemaining, qualificationRemaining))
      }
    ),
    { numRuns: 100 }
  )
})

void test("allowance paths bind both the canonical worktree and planned Base", () => {
  const { location } = fixture()
  assert.notEqual(
    qualificationAllowancePath(location, firstBase),
    qualificationAllowancePath({ ...location, worktree: `${location.worktree}-other` }, firstBase)
  )
  assert.notEqual(qualificationAllowancePath(location, firstBase), qualificationAllowancePath(location, secondBase))
})
