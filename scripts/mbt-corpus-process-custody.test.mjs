import assert from "node:assert/strict"
import { mkdtempSync, readFileSync, writeFileSync, existsSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import test from "node:test"
import { runBoundedCommand } from "./run-bounded-command.mjs"
import { bindMbtGenerationProcessGroup, proveMbtGenerationProcessGroupAbsent } from "./mbt-corpus-process-custody.mjs"

const root = resolve(".")
const execute = async ({ hang = false, inherited }) => {
  const directory = mkdtempSync(join(tmpdir(), "dalph-mbt-custody-"))
  const fake = join(directory, "quint.mjs")
  writeFileSync(
    fake,
    `#!/usr/bin/env node
import { readFileSync, writeFileSync } from "node:fs";
const stat=readFileSync("/proc/"+process.pid+"/stat","utf8");
const groupId=Number(stat.slice(stat.lastIndexOf(")")+2).split(" ")[2]);
writeFileSync(process.env.MBT_TEST_DIRECTORY+"/quint.json",JSON.stringify({pid:process.pid,groupId}));
if(process.env.MBT_TEST_HANG==="true"){process.on("SIGTERM",()=>{});setInterval(()=>{},1000);}
`,
    { mode: 0o700 }
  )
  const worker = join(directory, "worker.mjs")
  writeFileSync(
    worker,
    `
import { readFileSync, existsSync } from "node:fs";
import { bindMbtGenerationProcessGroup } from ${JSON.stringify(new URL("./mbt-corpus-process-custody.mjs", import.meta.url).href)};
bindMbtGenerationProcessGroup(process.env.MBT_TEST_DIRECTORY);
if(process.env.MBT_TEST_INHERITED!=="true")delete process.env.DALPH_QUINT_PARENT_OWNED_GROUP;
const {Effect}=await import(${JSON.stringify(new URL("../node_modules/effect/dist/index.js", import.meta.url).href)});
const {TraceGeneration,traceGenerationLayer}=await import(${JSON.stringify(new URL("../node_modules/@firfi/quint-connect/dist/effect.js", import.meta.url).href)});
const work=Effect.runPromise(Effect.gen(function*(){const generator=yield* TraceGeneration;return yield* generator.generate({spec:"specs/taskScheduler.qnt",numTraces:1,maxSteps:1,quintBin:process.env.MBT_TEST_QUINT,traceDir:process.env.MBT_TEST_DIRECTORY+"/raw"});}).pipe(Effect.provide(traceGenerationLayer))).catch(()=>{});
if(process.env.MBT_TEST_HANG==="true"){
 while(!existsSync(process.env.MBT_TEST_DIRECTORY+"/quint.json"))await new Promise(r=>setTimeout(r,10));
 process.removeAllListeners("SIGTERM");process.on("SIGTERM",()=>{});
}
await work;
`
  )
  let result, error
  try {
    result = await runBoundedCommand({
      executable: process.execPath,
      args: [worker],
      cwd: root,
      environment: {
        ...process.env,
        MBT_TEST_DIRECTORY: directory,
        MBT_TEST_QUINT: fake,
        MBT_TEST_INHERITED: String(inherited),
        MBT_TEST_HANG: String(hang)
      },
      name: "MBT actual adapter custody control",
      timeoutMilliseconds: 5000,
      terminationGraceMilliseconds: 100,
      captureOutput: true,
      forwardOutput: false
    })
  } catch (caught) {
    error = caught
  }
  const group = JSON.parse(readFileSync(join(directory, "generator-group.json"), "utf8"))
  const quint = JSON.parse(readFileSync(join(directory, "quint.json"), "utf8"))
  return { directory, group, quint, result, error }
}

test(
  "generation refuses a worker outside its bounded group before starting Quint",
  { skip: process.platform !== "linux" },
  () => {
    const directory = mkdtempSync(join(tmpdir(), "dalph-mbt-unowned-"))
    try {
      assert.throws(() => bindMbtGenerationProcessGroup(directory), /exact group leader/)
      assert.equal(existsSync(join(directory, "generator-group.json")), false)
    } finally {
      rmSync(directory, { recursive: true })
    }
  }
)

test(
  "the real pinned TraceGeneration adapter inherits its recorded worker group",
  { skip: process.platform !== "linux" },
  async () => {
    const sample = await execute({ inherited: true })
    try {
      assert.equal(sample.result.exitCode, 0)
      assert.equal(sample.quint.groupId, sample.group.groupId)
      assert.notEqual(sample.quint.pid, sample.group.pid)
      proveMbtGenerationProcessGroupAbsent(sample.directory)
      assert.equal(JSON.parse(readFileSync(join(sample.directory, "generator-stopped.json"), "utf8")).groupAbsent, true)
    } finally {
      rmSync(sample.directory, { recursive: true })
    }
  }
)

test(
  "negative control exposes the original detached Quint group without orphaning a process",
  { skip: process.platform !== "linux" },
  async () => {
    const sample = await execute({ inherited: false })
    try {
      assert.equal(sample.result.exitCode, 0)
      assert.notEqual(sample.quint.groupId, sample.group.groupId)
      assert.equal(sample.quint.groupId, sample.quint.pid)
    } finally {
      rmSync(sample.directory, { recursive: true })
    }
  }
)

test(
  "forced worker termination retains exact custody and proves the inherited Quint group absent",
  { skip: process.platform !== "linux" },
  async () => {
    const sample = await execute({ inherited: true, hang: true })
    try {
      assert.match(String(sample.error), /exceeded|timed|timeout|deadline/i)
      assert.equal(sample.quint.groupId, sample.group.groupId)
      proveMbtGenerationProcessGroupAbsent(sample.directory)
      assert.throws(() => process.kill(sample.quint.pid, 0), { code: "ESRCH" })
    } finally {
      rmSync(sample.directory, { recursive: true })
    }
  }
)

test("a missing or foreign custody record cannot authorize publication", { skip: process.platform !== "linux" }, () => {
  const directory = mkdtempSync(join(tmpdir(), "dalph-mbt-missing-"))
  try {
    assert.throws(() => proveMbtGenerationProcessGroupAbsent(directory), { code: "ENOENT" })
    writeFileSync(
      join(directory, "generator-group.json"),
      JSON.stringify({ version: 1, pid: 1, groupId: 1, startTicks: "1", bootId: "foreign" })
    )
    assert.throws(() => proveMbtGenerationProcessGroupAbsent(directory), /another boot/)
    assert.equal(existsSync(join(directory, "generator-stopped.json")), false)
  } finally {
    rmSync(directory, { recursive: true })
  }
})
