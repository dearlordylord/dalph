import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import { test } from "node:test"
import ts from "typescript"
import { fullQualityGateManifest } from "./quality-gate-stage-policy.mjs"
import { createQualityGateStagePlan } from "./quality-gate-stage-plan.mjs"

void test("all inventoried replay suites route generation names exclusively through validated corpus replay", async () => {
  const manifest = JSON.parse(await readFile("scripts/mbt-corpus-manifest.json", "utf8"))
  assert.equal(manifest.selection.files.length, 15)
  assert.equal(manifest.lanes.length, 39)
  for (const source of manifest.selection.files) {
    const text = await readFile(source, "utf8")
    const syntax = ts.createSourceFile(source, text, ts.ScriptTarget.Latest, true)
    for (const node of syntax.statements) {
      if (!ts.isImportDeclaration(node) || !node.moduleSpecifier.text.startsWith("@firfi/quint-connect")) continue
      const bindings = node.importClause?.namedBindings
      if (!bindings || !ts.isNamedImports(bindings)) continue
      for (const binding of bindings.elements)
        assert.ok(
          !["quintRun", "quintIt", "generateTraces"].includes((binding.propertyName ?? binding.name).text),
          source
        )
    }
    if (manifest.lanes.some((lane) => lane.source === source))
      assert.ok(
        syntax.statements.some(
          (node) =>
            ts.isVariableStatement(node) &&
            node.declarationList.declarations.some(
              ({ initializer }) =>
                initializer &&
                ts.isCallExpression(initializer) &&
                initializer.expression.getText(syntax) === "corpusReplayFor" &&
                initializer.arguments.length === 1 &&
                ts.isStringLiteral(initializer.arguments[0]) &&
                initializer.arguments[0].text === source
            )
        ),
        source
      )
  }
  const scripts = JSON.parse(await readFile("package.json", "utf8")).scripts
  assert.equal(scripts["test:mbt"], "node scripts/replay-mbt-corpus.mjs")
  assert.equal(scripts["mbt:replay"], scripts["test:mbt"])
  assert.equal(scripts["mbt:generate"], "node scripts/generate-mbt-corpus.mjs")
})

void test("local and hosted plans require exactly one bounded replay command for narrow broad and unknown changes", () => {
  const baseSha = "a".repeat(40)
  const candidateSha = "b".repeat(40)
  for (const changedPaths of [
    undefined,
    [],
    ["packages/orchestrator/src/coordination/run/frontier.ts"],
    ["package.json"]
  ]) {
    const local = fullQualityGateManifest(baseSha, { changedPaths })
    const hosted = createQualityGateStagePlan({ baseSha, candidateSha, nodeVersions: ["24.20.0"], changedPaths })
    const stage = local.filter(({ id }) => id === "mbt-replay")
    assert.equal(stage.length, 1)
    assert.deepEqual(stage[0].args, ["test:mbt"])
    assert.equal(stage[0].timeout, 600000)
    const cells = hosted.stages.filter(({ stageId }) => stageId === "mbt-replay")
    assert.equal(cells.length, 1)
    assert.deepEqual(cells[0].command.args.slice(2), ["test:mbt"])
  }
})
