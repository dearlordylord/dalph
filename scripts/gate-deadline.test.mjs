import assert from "node:assert/strict"
import { test } from "node:test"
import {
  defaultGateBudgetMilliseconds,
  gateCommandTimeout,
  remainingGateMilliseconds,
  resolveGateDeadline
} from "./gate-deadline.mjs"

const now = Date.parse("2026-09-22T05:00:00.000Z")
const deadline = "2026-09-22T05:10:00.000Z"

void test("one default budget starts before admission and decreases across nesting", () => {
  assert.equal(Date.parse(resolveGateDeadline({ now })), now + defaultGateBudgetMilliseconds)
  assert.equal(resolveGateDeadline({ inherited: deadline, now: now + 1000 }), deadline)
  assert.equal(remainingGateMilliseconds(deadline, now + 1000), 599000)
})

void test("nested callers can shorten but never extend a persisted deadline", () => {
  const earlier = "2026-09-22T05:05:00.000Z"
  assert.equal(resolveGateDeadline({ configured: earlier, inherited: deadline, now }), earlier)
  assert.throws(() => resolveGateDeadline({ configured: deadline, inherited: earlier, now }), /cannot extend/u)
})

void test("expired and malformed deadlines fail before launching work", () => {
  for (const configured of ["", "later", "2026-09-22", "2026-09-22T05:10:00Z"])
    assert.throws(() => resolveGateDeadline({ configured, now }), /ISO UTC/u)
  assert.throws(() => remainingGateMilliseconds(deadline, Date.parse(deadline)), /expired/u)
})

void test("timer installation consumes registration latency and immediately stops an already registered late child", () => {
  assert.equal(gateCommandTimeout({ requested: 600000, deadline, now: now + 1500 }), 598500)
  assert.equal(gateCommandTimeout({ requested: 600000, deadline, now: Date.parse(deadline) + 1 }), 0)
  assert.equal(gateCommandTimeout({ requested: 200, deadline, now }), 200)
  assert.equal(gateCommandTimeout({ requested: 200, now }), 200)
})
