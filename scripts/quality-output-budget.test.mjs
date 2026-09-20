import assert from "node:assert/strict"
import { test } from "node:test"
import {
  addSuccessfulOutputLines,
  createConsoleOutputPresenter,
  presentCapturedFailureOutput
} from "./quality-output-budget.mjs"

void test("counts noisy successful output without a qualification ceiling", () => {
  assert.equal(
    addSuccessfulOutputLines({ currentOutputLines: 550, stageName: "fixture", stageOutputLines: 1000 }),
    1550
  )
})

void test("rejects malformed output evidence rather than excessive output", () => {
  for (const stageOutputLines of [-1, NaN, Infinity, 0.5, Number.MAX_SAFE_INTEGER])
    assert.throws(
      () => addSuccessfulOutputLines({ currentOutputLines: 1, stageName: "fixture", stageOutputLines }),
      /Invalid output count/
    )
})

const fixture = (limits = {}) => {
  const chunks = []
  const reports = []
  const presenter = createConsoleOutputPresenter({
    name: "fixture",
    logPath: "/retained/child.log",
    report: (text) => reports.push(text),
    ...limits
  })
  return { presenter, chunks, reports, destination: { write: (bytes) => chunks.push(Buffer.from(bytes)) } }
}

void test("forwards ordinary output unchanged across chunk boundaries", () => {
  const f = fixture()
  f.presenter.write(Buffer.from("first\nsec"), f.destination)
  f.presenter.write(Buffer.from("ond\n"), f.destination)
  f.presenter.finish({ failed: false })
  assert.equal(Buffer.concat(f.chunks).toString(), "first\nsecond\n")
  assert.deepEqual(f.reports, [])
})

void test("bounds noisy output and gives one complete-log pointer without changing success", () => {
  const f = fixture({ maximumLines: 2 })
  for (const chunk of ["one\n", "two\nthree\n", "four\n"]) f.presenter.write(Buffer.from(chunk), f.destination)
  f.presenter.finish({ failed: false })
  assert.equal(Buffer.concat(f.chunks).toString(), "one\ntwo\n")
  assert.equal(f.reports.length, 1)
  assert.match(f.reports[0], /console output truncated; complete log: \/retained\/child.log/)
})

void test("bounds newline-free output and retains a bounded failure tail", () => {
  const f = fixture({ maximumBytes: 4, tailBytes: 5 })
  f.presenter.write(Buffer.from("0123456789"), f.destination)
  f.presenter.write(Buffer.from("FAIL"), f.destination)
  f.presenter.finish({ failed: true })
  assert.equal(Buffer.concat(f.chunks).toString(), "0123")
  assert.match(f.reports.join(""), /failed; final retained output/)
  assert.equal(f.reports[2], "9FAIL")
  assert.match(f.reports.at(-1), /Complete log: \/retained\/child.log/)
})

void test("failure tail includes the bounded prefix immediately before slight overflow", () => {
  const f = fixture({ maximumBytes: 4, tailBytes: 5 })
  f.presenter.write(Buffer.from("0123"), f.destination)
  f.presenter.write(Buffer.from("45"), f.destination)
  f.presenter.finish({ failed: true })
  assert.equal(f.reports[2], "12345")
})

void test("failure tail rolls through large overflow and ends at the final observed bytes", () => {
  const f = fixture({ maximumBytes: 4, tailBytes: 5 })
  f.presenter.write(Buffer.from("0123"), f.destination)
  f.presenter.write(Buffer.from(`${"x".repeat(10000)}FINAL`), f.destination)
  f.presenter.finish({ failed: true })
  assert.equal(f.reports[2], "FINAL")
})

void test("presents captured failure output once through the same budget", () => {
  const reports = []
  presentCapturedFailureOutput({
    name: "formal profile",
    logPath: "/retained/formal.log",
    output: `${"line\n".repeat(600)}${"tail".repeat(3000)}`,
    report: (text) => reports.push(text),
    maximumLines: 2,
    maximumBytes: 64,
    tailBytes: 8
  })
  const rendered = reports.join("")
  assert.match(rendered, /formal profile: console output truncated; complete log: \/retained\/formal.log/)
  assert.match(rendered, /formal profile: failed; final retained output \(up to 8 bytes\)/)
  assert.ok(Buffer.byteLength(rendered) < 500)
})
