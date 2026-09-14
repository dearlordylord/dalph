import assert from "node:assert/strict"
import { test } from "node:test"

import { classifyFormalChangeBetween } from "./classify-docs-only-change.mjs"
import { obtainCandidateFormalEvidence, validateFormalClassification } from "./gate-quality-run.mjs"

const baseSha = "1".repeat(40)
const headSha = "2".repeat(40)
const classify = (changedPaths, formalInputPaths) =>
  classifyFormalChangeBetween({
    baseSha,
    headSha,
    listChangedPaths: () => changedPaths,
    listFormalInputPaths: () => formalInputPaths
  })

test("an unaffected candidate records formal not applicable and starts no formal workflow", async () => {
  for (const classification of [classify([], ["specs/model.qnt"]), classify(["docs/note.md"], ["specs/model.qnt"])]) {
    let workflows = 0
    const reports = []
    const result = await obtainCandidateFormalEvidence({
      classification,
      report: (line) => reports.push(line),
      runWorkflow: async () => {
        workflows += 1
        throw new Error("unaffected candidate started the formal workflow")
      }
    })
    assert.equal(workflows, 0)
    assert.equal(result.retained, undefined)
    assert.deepEqual(result.disposition, { version: 1, disposition: "not-applicable", classification })
    assert.match(reports.join("\n"), /zero checkers or servers started/u)
  }
})

test("a model or executable conformance adapter requires exactly one formal workflow", async () => {
  for (const path of [
    "specs/plannedAttemptExecutor.qnt",
    "packages/dalph/test/conformance/planned-attempt-executor.mbt.test.ts"
  ]) {
    const classification = classify([path], [path])
    let workflows = 0
    const retained = { status: "executed" }
    const result = await obtainCandidateFormalEvidence({
      classification,
      report: () => undefined,
      runWorkflow: async (options) => {
        workflows += 1
        assert.equal(options.retainGuard, true)
        return retained
      }
    })
    assert.equal(workflows, 1)
    assert.equal(result.retained, retained)
    assert.equal(result.disposition, undefined)
  }
})

test("unavailable formal classification fails closed before qualification children", () => {
  let children = 0
  const startChild = () => {
    children += 1
  }
  assert.throws(
    () =>
      validateFormalClassification(
        { version: 1, status: "unavailable", baseSha, headSha, changedPaths: [], affectedPaths: [] },
        { baseSha, gitHistory: { headSha } }
      ),
    /unavailable or inconsistent/u
  )
  assert.equal(children, 0)
  void startChild
})

test("resume retains the exact unaffected classification and starts no formal workflow", async () => {
  const classification = classify(["packages/dalph/src/index.ts"], ["specs/model.qnt"])
  const invocation = { baseSha, gitHistory: { headSha }, formalClassification: classification }
  assert.equal(validateFormalClassification(classification, invocation), classification)
  let workflows = 0
  for (const run of ["fresh", "resume"]) {
    const result = await obtainCandidateFormalEvidence({
      classification: validateFormalClassification(invocation.formalClassification, invocation),
      report: () => undefined,
      runWorkflow: async () => {
        workflows += 1
      }
    })
    assert.equal(result.disposition.disposition, "not-applicable", run)
    assert.equal(result.disposition.classification, classification, run)
  }
  assert.equal(workflows, 0)
})
