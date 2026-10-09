import assert from "node:assert/strict"
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { test } from "node:test"
import { runBoundedCommand } from "./run-bounded-command.mjs"

test("hosted TLC diagnostics retain both streams without changing success or violation exits", async () => {
  const root = mkdtempSync(join(tmpdir(), "dalph-tlc-output-"))
  const java = join(root, "controlled-java")
  const jarDirectory = join(root, "apalache-dist-0.56.1", "apalache", "lib")
  mkdirSync(jarDirectory, { recursive: true })
  writeFileSync(join(jarDirectory, "apalache.jar"), "controlled stream fixture, not a model proof")
  writeFileSync(
    java,
    "#!/bin/sh\nprintf '%s\\n' 'controlled TLC stdout'\nprintf '%s\\n' 'controlled TLC stderr' >&2\nexit \"$TLC_FIXTURE_EXIT\"\n",
    { mode: 0o755 }
  )
  const packageJson = fileURLToPath(new URL("../package.json", import.meta.url))
  const source = `
import { createRequire } from 'node:module';
const { verify } = createRequire(${JSON.stringify(packageJson)})('@informalsystems/quint/dist/src/tlc.js');
const result = await verify({moduleName:'Controlled',tlaCode:'---- MODULE Controlled ----\\n====',hasInvariant:false,hasTemporal:false},'0.56.1',{},1);
console.log('VERDICT '+JSON.stringify({success:result.isRight(),violation:result.isLeft()&&result.value.isViolation}));
`
  try {
    for (const scenario of [
      { flag: "0", exit: "0", success: true, violation: false, streams: false },
      { flag: "1", exit: "0", success: true, violation: false, streams: true },
      { flag: "1", exit: "12", success: false, violation: true, streams: true }
    ]) {
      const result = await runBoundedCommand({
        executable: process.execPath,
        args: ["--input-type=module", "--eval", source],
        environment: {
          ...process.env,
          QUINT_HOME: root,
          DALPH_QUINT_OWNED_SERVER_ENDPOINT: "127.0.0.1:1",
          DALPH_QUINT_JAVA_EXECUTABLE: java,
          DALPH_QUINT_JAVA_USER_HOME: root,
          DALPH_QUINT_TLC_DIAGNOSTICS: scenario.flag,
          TLC_FIXTURE_EXIT: scenario.exit
        },
        name: "controlled TLC output boundary",
        timeoutMilliseconds: 5000,
        captureOutput: true,
        relayParentSignals: true
      })
      const verdict = JSON.parse(result.output.match(/^VERDICT (.+)$/mu)[1])
      assert.deepEqual(verdict, { success: scenario.success, violation: scenario.violation })
      assert.equal(result.output.includes("controlled TLC stdout"), scenario.streams)
      assert.equal(result.output.includes("controlled TLC stderr"), scenario.streams)
    }
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
