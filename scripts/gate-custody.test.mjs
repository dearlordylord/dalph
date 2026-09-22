import { performance } from "node:perf_hooks"
import assert from "node:assert/strict"
import { spawn, spawnSync } from "node:child_process"
import {
  chmodSync,
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync
} from "node:fs"
import { tmpdir } from "node:os"
import { basename, join } from "node:path"
import { setTimeout } from "node:timers/promises"
import { fileURLToPath } from "node:url"
import { test } from "node:test"
import {
  atomicRecord,
  epochMilliseconds,
  custodyVersion,
  readRecord,
  repositoryLocation,
  withoutInheritedCustody
} from "./gate-custody-records.mjs"
import { readRunEvidence } from "./gate-run-evidence.mjs"
import { reconcileGateRun } from "./reconcile-gate-run.mjs"
import { registerSpawn } from "./gate-registration.mjs"

// The admitted parent boundary already registered this controlled test process.
// Its synthetic temporary-repository protocols start with explicit fixture custody.
for (const name of [
  "DALPH_GATE_RUN_DIRECTORY",
  "DALPH_GATE_RUN_ID",
  "DALPH_GATE_OBLIGATION",
  "DALPH_GATE_SLOT",
  "DALPH_COVERAGE_DIRECTORY"
])
  delete process.env[name]

const wrapper = fileURLToPath(new URL("./with-gate-slot.mjs", import.meta.url))
const bounded = fileURLToPath(new URL("./run-bounded-command.mjs", import.meta.url))
const environment = () => {
  const env = withoutInheritedCustody(process.env)
  for (const key of [
    "DALPH_COVERAGE_BASE_SHA",
    "DALPH_GATE_DEADLINE",
    "DALPH_QUALIFICATION_ENV_CAPTURE",
    "DALPH_RUN_REAL_CODEX_QUALIFICATION",
    "npm_execpath"
  ])
    delete env[key]
  return env
}
const fixture = () => {
  const root = mkdtempSync(join(tmpdir(), "dalph-custody-"))
  const git = (...args) => {
    const result = spawnSync("git", args, { cwd: root, encoding: "utf8" })
    assert.equal(result.status, 0, result.stderr)
    return result.stdout.trim()
  }
  git("init", "-q")
  writeFileSync(join(root, ".gitignore"), ".scratch/\n")
  git("add", ".gitignore")
  git("-c", "user.name=Fixture", "-c", "user.email=fixture@example.invalid", "commit", "-qm", "base")
  git(
    "-c",
    "user.name=Fixture",
    "-c",
    "user.email=fixture@example.invalid",
    "commit",
    "--allow-empty",
    "-qm",
    "candidate"
  )
  mkdirSync(join(root, ".scratch"))
  return { root, git, cleanup: () => rmSync(root, { recursive: true, force: true }) }
}
const start = (root, args, env = {}) => {
  const child = spawn(process.execPath, [wrapper, "--", ...args], {
    cwd: root,
    env: { ...environment(), ...env },
    stdio: ["ignore", "pipe", "pipe"]
  })
  let output = ""
  child.stdout.on("data", (chunk) => {
    output += chunk
  })
  child.stderr.on("data", (chunk) => {
    output += chunk
  })
  const done = new Promise((resolve) => child.once("close", (code, signal) => resolve({ code, signal, output })))
  return { child, done }
}
const until = async (predicate) => {
  const deadline = performance.now() + 10_000
  while (!predicate()) {
    assert.ok(performance.now() < deadline, "controlled fixture reached its barrier deadline")
    await setTimeout(10)
  }
}
const runs = (root) => {
  const location = repositoryLocation(root)
  try {
    return readdirSync(join(location.custodyRoot, "runs")).map((runId) => ({
      runId,
      runDirectory: join(location.custodyRoot, "runs", runId)
    }))
  } catch {
    return []
  }
}

void test("gate deadline expires a quiet writer and preserves stopped custody evidence", async () => {
  const f = fixture()
  try {
    const deadline = new Date(epochMilliseconds() + 2000).toISOString()
    const result = await start(f.root, [process.execPath, "-e", "setInterval(()=>{},1000)"], {
      DALPH_GATE_DEADLINE: deadline
    }).done
    assert.equal(result.code, 1, result.output)
    const entry = runs(f.root)[0]
    assert.ok(entry, result.output)
    assert.equal(readRecord(join(entry.runDirectory, "run.json")).deadline, deadline)
    const terminal = readRecord(join(entry.runDirectory, "terminal.json"))
    assert.equal(terminal.custody, "stopped")
    assert.notEqual(terminal.outcome, "passed")
    assert.equal(existsSync(repositoryLocation(f.root).worktreeFence), false)
  } finally {
    f.cleanup()
  }
})

void test("worktree lock waiting consumes the deadline without launching a second writer", async () => {
  const f = fixture()
  try {
    const ready = join(f.root, ".scratch", "deadline-ready")
    const release = join(f.root, ".scratch", "deadline-release")
    const forbidden = join(f.root, ".scratch", "forbidden-writer")
    const first = start(f.root, [
      process.execPath,
      "-e",
      `require('fs').writeFileSync(${JSON.stringify(ready)},'ready');const timer=setInterval(()=>{if(require('fs').existsSync(${JSON.stringify(release)}))clearInterval(timer)},10)`
    ])
    try {
      await until(() => existsSync(ready))
      const second = await start(
        f.root,
        [process.execPath, "-e", `require('fs').writeFileSync(${JSON.stringify(forbidden)},'bad')`],
        { DALPH_GATE_DEADLINE: new Date(epochMilliseconds() + 500).toISOString() }
      ).done
      assert.equal(second.code, 1, second.output)
      assert.match(second.output, /deadline expired/u)
      assert.equal(existsSync(forbidden), false)
      assert.equal(runs(f.root).length, 1)
    } finally {
      writeFileSync(release, "release")
      assert.equal((await first.done).code, 0)
    }
  } finally {
    f.cleanup()
  }
})

void test("a contracted deadline survives a replacement child environment", async () => {
  const f = fixture()
  try {
    const script = join(f.root, ".scratch", "deadline-contraction.mjs")
    writeFileSync(
      script,
      `import {runBoundedCommand} from ${JSON.stringify(new URL(`file://${bounded}`).href)};
      const deadline=new Date(Date.now()+3000).toISOString();
      process.env.DALPH_GATE_DEADLINE=deadline;
      await runBoundedCommand({executable:process.execPath,args:['-e','console.log(process.env.DALPH_GATE_DEADLINE)'],environment:{},name:'contracted child',timeoutMilliseconds:10000});
      console.log('expected='+deadline);`
    )
    const result = await start(f.root, [process.execPath, script], {
      DALPH_GATE_DEADLINE: new Date(epochMilliseconds() + 10000).toISOString()
    }).done
    assert.equal(result.code, 0, result.output)
    const expected = /expected=(\S+)/u.exec(result.output)?.[1]
    assert.ok(expected, result.output)
    assert.ok(result.output.split("\n").includes(expected), result.output)
    const stage = readRunEvidence(runs(f.root)[0]).stages.find((entry) => entry.command.name === "contracted child")
    assert.ok(stage.command.timeoutMilliseconds <= 3000)
  } finally {
    f.cleanup()
  }
})

void test("direct bounded spawns reject expired, extended, and malformed child deadlines before registration", async () => {
  const f = fixture()
  try {
    const script = join(f.root, ".scratch", "deadline-rejection.mjs")
    writeFileSync(
      script,
      `import assert from 'node:assert/strict';import {runBoundedCommand} from ${JSON.stringify(new URL(`file://${bounded}`).href)};
      for(const deadline of [new Date(Date.now()-1).toISOString(),new Date(Date.now()+60000).toISOString(),'later']) {
        await assert.rejects(runBoundedCommand({executable:process.execPath,args:['-e','console.log("forbidden-child")'],environment:{DALPH_GATE_DEADLINE:deadline},name:'forbidden child',timeoutMilliseconds:10000}),/deadline|ISO UTC/);
      }`
    )
    const result = await start(f.root, [process.execPath, script], {
      DALPH_GATE_DEADLINE: new Date(epochMilliseconds() + 10000).toISOString()
    }).done
    assert.equal(result.code, 0, result.output)
    assert.doesNotMatch(result.output, /forbidden-child/u)
    assert.equal(readRecord(join(runs(f.root)[0].runDirectory, "registration.json")).obligations.length, 1)
  } finally {
    f.cleanup()
  }
})

void test("same-worktree writers never overlap; nested bounded commands have registered obligations and logs", async () => {
  const f = fixture()
  try {
    const ready = join(f.root, ".scratch", "ready")
    const release = join(f.root, ".scratch", "release")
    const second = join(f.root, ".scratch", "second")
    const source = `import { writeFileSync, existsSync } from "node:fs"; import { setTimeout } from "node:timers/promises"; import { runBoundedCommand } from ${JSON.stringify(new URL(`file://${bounded}`).href)}; await runBoundedCommand({ executable: process.execPath, args: ["-e", ${JSON.stringify(`require('fs').writeFileSync(${JSON.stringify(ready)},'ready'); const t=setInterval(()=>{if(require('fs').existsSync(${JSON.stringify(release)})){clearInterval(t)}},10)`)}], name: "nested writer", timeoutMilliseconds: 5000 });`
    const script = join(f.root, ".scratch", "writer.mjs")
    writeFileSync(script, source)
    const a = start(f.root, [process.execPath, script])
    await until(() => {
      try {
        return readFileSync(ready, "utf8") === "ready"
      } catch {
        return false
      }
    })
    const b = start(f.root, [process.execPath, "-e", `require('fs').writeFileSync(${JSON.stringify(second)},'second')`])
    await until(() => runs(f.root).length === 1)
    await setTimeout(100)
    assert.equal(runs(f.root).length, 1)
    writeFileSync(release, "release")
    assert.equal((await a.done).code, 0)
    assert.equal((await b.done).code, 0)
    assert.equal(readFileSync(second, "utf8"), "second")
    const first = runs(f.root)
      .map(readRunEvidence)
      .find((entry) => entry.stages.length === 2)
    assert.equal(first.registration, "closed")
    assert.equal(first.stages.length, 2)
    assert.ok(first.stages.every((stage) => stage.groupAbsent && stage.exitCode === 0))
    assert.ok(first.stages.every((stage) => typeof readFileSync(stage.logPath, "utf8") === "string"))
  } finally {
    f.cleanup()
  }
})

void test("records a supplied relayed-signal grace without changing the default command shape", async () => {
  const f = fixture()
  try {
    const script = join(f.root, ".scratch", "relay-grace-shape.mjs")
    writeFileSync(
      script,
      `import {runBoundedCommand} from ${JSON.stringify(new URL(`file://${bounded}`).href)};const command={args:['-e','process.exit(0)'],executable:process.execPath,relayParentSignals:true,timeoutMilliseconds:2000};await runBoundedCommand({...command,name:'default relay grace shape'});await runBoundedCommand({...command,name:'supplied relay grace shape',relayedSignalGraceMilliseconds:4000});`
    )
    const result = await start(f.root, [process.execPath, script]).done
    assert.equal(result.code, 0, result.output)
    const entry = runs(f.root)[0]
    const obligations = readRecord(join(entry.runDirectory, "registration.json")).obligations.map((id) =>
      readRecord(join(entry.runDirectory, "obligations", `${id}.json`))
    )
    const defaultCommand = obligations.find((record) => record.command.name === "default relay grace shape")
    const suppliedCommand = obligations.find((record) => record.command.name === "supplied relay grace shape")
    assert.ok(defaultCommand)
    assert.ok(suppliedCommand)
    assert.equal(Object.hasOwn(defaultCommand.command, "relayedSignalGraceMilliseconds"), false)
    assert.equal(suppliedCommand.command.relayedSignalGraceMilliseconds, 4000)
  } finally {
    f.cleanup()
  }
})

for (const exitCode of [0, 7])
  void test(`noisy admitted child preserves its complete log and exit ${exitCode}`, async () => {
    const f = fixture()
    try {
      const expected = "line\n".repeat(700) + "FINAL_DIAGNOSTIC\n"
      const childSource = `process.stdout.write(${JSON.stringify(expected)}); process.exitCode=${exitCode}`
      const source = `import {runBoundedCommand} from ${JSON.stringify(new URL(`file://${bounded}`).href)}; try { await runBoundedCommand({executable:process.execPath,args:['-e',${JSON.stringify(childSource)}],name:'noisy retained child',timeoutMilliseconds:5000}) } catch(error) { console.error(error.message); process.exitCode=${exitCode} }`
      const result = await start(f.root, [process.execPath, "--input-type=module", "-e", source]).done
      assert.equal(result.code, exitCode, result.output)
      assert.match(result.output, /console output truncated; complete log:/)
      const evidence = runs(f.root).map(readRunEvidence)[0]
      const receipt = evidence.stages.find((stage) => stage.command.name === "noisy retained child")
      assert.equal(receipt.exitCode, exitCode)
      assert.equal(receipt.outputLineCount, 701)
      assert.equal(receipt.groupAbsent, true)
      assert.equal(readFileSync(receipt.logPath, "utf8"), expected)
      if (exitCode === 0) assert.doesNotMatch(result.output, /FINAL_DIAGNOSTIC/)
      else assert.match(result.output, /FINAL_DIAGNOSTIC/)
    } finally {
      f.cleanup()
    }
  })

for (const mode of ["create", "append"])
  void test(`retained-log ${mode} failure is visible and cannot qualify an admitted child`, async () => {
    const f = fixture()
    try {
      const progressPath = join(f.root, ".scratch", `retained-log-${mode}-progress.jsonl`)
      const script = join(f.root, ".scratch", `retained-log-${mode}.mjs`)
      const boundedUrl = new URL(`file://${bounded}`).href
      const expected = `line\n`.repeat(700) + `RETAINED_LOG_${mode.toUpperCase()}_TAIL\n`
      const childSource =
        mode === "create"
          ? `process.stdout.write(${JSON.stringify(expected)})`
          : `const fs=require('fs');const path=require('path');const run=JSON.parse(fs.readFileSync(path.join(process.env.DALPH_GATE_RUN_DIRECTORY,'run.json'),'utf8'));const log=path.join(run.reportDirectory,'logs',process.env.DALPH_GATE_OBLIGATION+'.log');fs.rmSync(log,{recursive:true,force:true});fs.mkdirSync(log);process.stdout.write(${JSON.stringify(expected)})`
      const source = `
        import {appendFileSync,existsSync,mkdirSync,readFileSync,renameSync,rmSync,writeFileSync} from 'node:fs'
        import {join} from 'node:path'
        import {runBoundedCommand} from ${JSON.stringify(boundedUrl)}
        const runDirectory=process.env.DALPH_GATE_RUN_DIRECTORY
        const run=JSON.parse(readFileSync(join(runDirectory,'run.json'),'utf8'))
        const logs=join(run.reportDirectory,'logs')
        const backup=logs+'.retained-log-${mode}-backup-'+process.pid
        const events=[]
        let failure
        if (${JSON.stringify(mode)} === 'create') { renameSync(logs,backup); writeFileSync(logs,'blocked') }
        try {
          await runBoundedCommand({
            executable:process.execPath,
            args:['-e',${JSON.stringify(childSource)}],
            captureOutput:true,
            forwardOutput:true,
            name:'retained log ${mode} failure',
            progress:{emit:event=>events.push(event),identity:{position:0,kind:'test',name:'retained log ${mode} failure'}},
            timeoutMilliseconds:5000
          })
          process.exitCode=42
        } catch(error) {
          failure=error
          process.stderr.write(error.message+'\\n')
          process.exitCode=23
        } finally {
          if (${JSON.stringify(mode)} === 'create') { rmSync(logs,{recursive:true,force:true}); renameSync(backup,logs) }
          else {
            const registration=JSON.parse(readFileSync(join(runDirectory,'registration.json'),'utf8'))
            const nested=registration.obligations.map(id=>JSON.parse(readFileSync(join(runDirectory,'obligations',id+'.json'),'utf8'))).find(item=>item.command.name==='retained log ${mode} failure')
            if (nested) { const nestedLog=join(run.reportDirectory,'logs',nested.obligationId+'.log'); rmSync(nestedLog,{recursive:true,force:true}); writeFileSync(nestedLog,'') }
          }
          appendFileSync(${JSON.stringify(progressPath)},events.map(event=>JSON.stringify(event)).join('\\n')+'\\n')
        }
        if (failure===undefined) process.exitCode=42
      `
      writeFileSync(script, source)
      const result = await start(f.root, [process.execPath, script]).done
      assert.equal(result.code, 23, result.output)
      assert.match(result.output, /retained log (?:create|append) failed/u)
      assert.match(result.output, /complete log unavailable/u)
      assert.match(result.output, /failed; final retained output/u)
      assert.match(result.output, new RegExp(`RETAINED_LOG_${mode.toUpperCase()}_TAIL`, "u"))
      const progress = readFileSync(progressPath, "utf8")
        .trim()
        .split("\n")
        .map((line) => JSON.parse(line))
      assert.deepEqual(
        progress.map((event) => event.type),
        ["start", "terminal"]
      )
      assert.equal(progress.at(-1).outcome, "logging-failed")
      const entry = runs(f.root)[0]
      const evidence = readRunEvidence(entry)
      assert.equal(evidence.qualification, "UNPROVEN")
      const registration = readRecord(join(entry.runDirectory, "registration.json"))
      const nested = registration.obligations
        .map((id) => readRecord(join(entry.runDirectory, "obligations", `${id}.json`)))
        .find((item) => item.command.name === `retained log ${mode} failure`)
      assert.ok(nested)
      assert.equal(existsSync(join(entry.runDirectory, "receipts", `${nested.obligationId}.json`)), false)
      assert.equal(
        readRecord(join(entry.runDirectory, "absence", `${nested.obligationId}.json`)).processGroup,
        nested.processGroup
      )
      assert.equal(evidence.stages.find((stage) => stage.obligationId === nested.obligationId).outcome, "UNPROVEN")
    } finally {
      f.cleanup()
    }
  })

void test("retained-log append failure preserves a nonaccepted child exit and custody absence", async () => {
  const f = fixture()
  try {
    const progressPath = join(f.root, ".scratch", "retained-log-append-exit-progress.jsonl")
    const script = join(f.root, ".scratch", "retained-log-append-exit.mjs")
    const childSource = `const fs=require('fs');const path=require('path');const run=JSON.parse(fs.readFileSync(path.join(process.env.DALPH_GATE_RUN_DIRECTORY,'run.json'),'utf8'));const log=path.join(run.reportDirectory,'logs',process.env.DALPH_GATE_OBLIGATION+'.log');fs.rmSync(log,{recursive:true,force:true});fs.mkdirSync(log);process.stderr.write('append failure child\\n');process.exitCode=7`
    writeFileSync(
      script,
      `import {appendFileSync,readFileSync,rmSync,writeFileSync} from 'node:fs';import {join} from 'node:path';import {runBoundedCommand} from ${JSON.stringify(new URL(`file://${bounded}`).href)};const runDirectory=process.env.DALPH_GATE_RUN_DIRECTORY;const events=[];let failure;try{await runBoundedCommand({executable:process.execPath,args:['-e',${JSON.stringify(childSource)}],captureOutput:true,forwardOutput:true,name:'retained log append exit failure',progress:{emit:event=>events.push(event),identity:{position:0,kind:'test',name:'retained log append exit failure'}},timeoutMilliseconds:5000})}catch(error){failure=error;process.stderr.write(JSON.stringify({result:error.quintCommandResult,loggingFailure:error.loggingFailure})+'\\n');process.exitCode=23}finally{const registration=JSON.parse(readFileSync(join(runDirectory,'registration.json'),'utf8'));const nested=registration.obligations.map(id=>JSON.parse(readFileSync(join(runDirectory,'obligations',id+'.json'),'utf8'))).find(item=>item.command.name==='retained log append exit failure');if(nested){const run=JSON.parse(readFileSync(join(runDirectory,'run.json'),'utf8'));const nestedLog=join(run.reportDirectory,'logs',nested.obligationId+'.log');rmSync(nestedLog,{recursive:true,force:true});writeFileSync(nestedLog,'')}appendFileSync(${JSON.stringify(progressPath)},events.map(event=>JSON.stringify(event)).join('\\n')+'\\n')}if(failure===undefined)process.exitCode=42`
    )
    const result = await start(f.root, [process.execPath, script]).done
    assert.equal(result.code, 23, result.output)
    assert.match(result.output, /"result":"exit:7"/u)
    assert.match(result.output, /"phase":"append"/u)
    const events = readFileSync(progressPath, "utf8")
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line))
    assert.deepEqual(
      events.map((event) => event.type),
      ["start", "terminal"]
    )
    assert.equal(events.at(-1).outcome, "exit:7")
    const entry = runs(f.root)[0]
    const evidence = readRunEvidence(entry)
    assert.equal(evidence.qualification, "UNPROVEN")
    const registration = readRecord(join(entry.runDirectory, "registration.json"))
    const nested = registration.obligations
      .map((id) => readRecord(join(entry.runDirectory, "obligations", `${id}.json`)))
      .find((item) => item.command.name === "retained log append exit failure")
    assert.ok(nested)
    assert.equal(existsSync(join(entry.runDirectory, "receipts", `${nested.obligationId}.json`)), false)
    assert.equal(
      readRecord(join(entry.runDirectory, "absence", `${nested.obligationId}.json`)).processGroup,
      nested.processGroup
    )
    assert.equal(evidence.stages.find((stage) => stage.obligationId === nested.obligationId).outcome, "UNPROVEN")
  } finally {
    f.cleanup()
  }
})

void test("observed stopped custody reconciles without inventing a missing exit; delayed old-run registration refuses", async () => {
  const f = fixture()
  try {
    const a = start(f.root, [process.execPath, "-e", "process.stdout.write('durable log')"])
    assert.equal((await a.done).code, 0)
    const entry = runs(f.root)[0]
    const run = readRecord(join(entry.runDirectory, "run.json"))
    const registration = readRecord(join(entry.runDirectory, "registration.json"))
    const obligationId = registration.obligations[0]
    rmSync(join(entry.runDirectory, "receipts", `${obligationId}.json`))
    const fence = { version: custodyVersion, ...entry, worktree: run.worktree, slot: run.slot }
    atomicRecord(run.worktreeFence, fence)
    atomicRecord(run.slotFence, fence)
    const refused = await start(f.root, [process.execPath, "-e", "throw Error('must not launch')"]).done
    assert.equal(refused.code, 1)
    assert.ok(refused.output.includes(entry.runId))
    assert.deepEqual(reconcileGateRun(entry), { runId: entry.runId, custody: "stopped", qualification: "UNPROVEN" })
    assert.equal(readRunEvidence(entry).stages[0].outcome, "UNPROVEN")
    let spawned = false
    assert.throws(
      () =>
        registerSpawn({
          command: {},
          environment: {
            ...environment(),
            DALPH_GATE_RUN_DIRECTORY: entry.runDirectory,
            DALPH_GATE_RUN_ID: entry.runId,
            DALPH_GATE_OBLIGATION: obligationId
          },
          spawnChild: () => {
            spawned = true
          }
        }),
      /closed/u
    )
    assert.equal(spawned, false)
    assert.equal((await start(f.root, [process.execPath, "-e", ""]).done).code, 0)
  } finally {
    f.cleanup()
  }
})

void test("unobserved intent and corrupt inventory remain fenced", async () => {
  const f = fixture()
  try {
    assert.equal((await start(f.root, [process.execPath, "-e", ""]).done).code, 0)
    const entry = runs(f.root)[0]
    const registration = readRecord(join(entry.runDirectory, "registration.json"))
    const id = registration.obligations[0]
    const path = join(entry.runDirectory, "obligations", `${id}.json`)
    const obligation = readRecord(path)
    const intent = { ...obligation, state: "intent" }
    delete intent.processGroup
    atomicRecord(path, intent)
    assert.throws(() => reconcileGateRun(entry), /Unobserved/u)
    rmSync(path)
    assert.throws(() => reconcileGateRun(entry), /Missing or corrupt/u)
  } finally {
    f.cleanup()
  }
})

for (const [name, value] of [
  ["DALPH_RUN_REAL_CODEX_QUALIFICATION", "1"],
  ["DALPH_QUALIFICATION_ENV_CAPTURE", "/tmp/unconfined-capture"]
]) {
  void test(`rejects ambient ${name} before any admitted writer launch`, async () => {
    const f = fixture()
    try {
      const result = await start(f.root, [process.execPath, "-e", "throw Error('must not launch')"], { [name]: value })
        .done
      assert.equal(result.code, 1)
      assert.ok(result.output.includes("outside supported gate custody"))
      assert.equal(runs(f.root).length, 0)
    } finally {
      f.cleanup()
    }
  })
}

const startReaped = (root, args) => {
  assert.equal(process.platform, "linux", "Custody death acceptance requires Linux prctl subreaper support")
  const setup = spawnSync("python3", ["-c", "import ctypes; assert ctypes.CDLL(None).prctl(36,1,0,0,0)==0"], {
    encoding: "utf8"
  })
  assert.equal(
    setup.status,
    0,
    `Unrun custody death evidence: python3 test subreaper setup unavailable: ${setup.error?.message ?? setup.stderr}`
  )
  const harness = `import ctypes, os, subprocess, sys, time
ctypes.CDLL(None).prctl(36, 1, 0, 0, 0)
p = subprocess.Popen(sys.argv[1:])
code = p.wait()
while True:
    try: os.waitpid(-1, 0)
    except ChildProcessError: break
sys.exit(code)
`
  const child = spawn("python3", ["-c", harness, process.execPath, wrapper, "--", ...args], {
    cwd: root,
    env: environment(),
    stdio: ["ignore", "pipe", "pipe"]
  })
  let output = ""
  child.stdout.on("data", (chunk) => {
    output += chunk
  })
  child.stderr.on("data", (chunk) => {
    output += chunk
  })
  let terminal
  return {
    child,
    get output() {
      return output
    },
    get terminal() {
      return terminal
    },
    done: new Promise((resolve) =>
      child.once("close", (code) => {
        terminal = { code, output }
        resolve(terminal)
      })
    )
  }
}

void test("killed custody owner retains both fences until observed surviving writer stops; reconciliation then permits progress", async () => {
  const f = fixture()
  let harness
  try {
    const ready = join(f.root, ".scratch", "crash-ready")
    const release = join(f.root, ".scratch", "crash-release")
    const source = `const fs=require('fs');fs.writeFileSync(${JSON.stringify(ready)},'ready');const t=setInterval(()=>{if(fs.existsSync(${JSON.stringify(release)}))clearInterval(t)},10)`
    harness = startReaped(f.root, [process.execPath, "-e", source])
    await until(() => {
      try {
        return readFileSync(ready, "utf8") === "ready"
      } catch {
        return false
      }
    })
    const entry = runs(f.root)[0]
    const run = readRecord(join(entry.runDirectory, "run.json"))
    process.kill(run.ownerPid, "SIGKILL")
    const rejected = await start(f.root, [process.execPath, "-e", "throw Error('must not launch')"]).done
    assert.equal(rejected.code, 1)
    assert.ok(rejected.output.includes(entry.runId))
    assert.throws(() => reconcileGateRun(entry), /not proven absent/u)
    writeFileSync(release, "release")
    await harness.done
    assert.equal(reconcileGateRun(entry).custody, "stopped")
    assert.equal(readRunEvidence(entry).stages[0].outcome, "UNPROVEN")
    assert.equal((await start(f.root, [process.execPath, "-e", ""]).done).code, 0)
  } finally {
    if (harness !== undefined) {
      writeFileSync(join(f.root, ".scratch", "crash-release"), "release")
      await harness.done
    }
    f.cleanup()
  }
})

void test("clone-slot waiting consumes the deadline without creating a run or writer", async () => {
  const f = fixture()
  try {
    const other = join(f.root, ".scratch", "deadline-other-worktree")
    f.git("worktree", "add", "-qb", "deadline-other", other)
    const ready = join(f.root, ".scratch", "slot-deadline-ready")
    const release = join(f.root, ".scratch", "slot-deadline-release")
    const first = start(
      f.root,
      [
        process.execPath,
        "-e",
        `const fs=require('fs');fs.writeFileSync(${JSON.stringify(ready)},'ready');const timer=setInterval(()=>{if(fs.existsSync(${JSON.stringify(release)}))clearInterval(timer)},10)`
      ],
      { DALPH_GATE_SLOTS: "1" }
    )
    try {
      await until(() => existsSync(ready))
      const result = await start(other, [process.execPath, "-e", "console.log('forbidden-slot-writer')"], {
        DALPH_GATE_SLOTS: "1",
        DALPH_GATE_DEADLINE: new Date(epochMilliseconds() + 500).toISOString()
      }).done
      assert.equal(result.code, 1, result.output)
      assert.match(result.output, /deadline expired/u)
      assert.doesNotMatch(result.output, /forbidden-slot-writer/u)
      assert.equal(runs(f.root).length, 1)
      assert.equal(existsSync(repositoryLocation(other).worktreeFence), false)
    } finally {
      writeFileSync(release, "release")
      assert.equal((await first.done).code, 0)
    }
  } finally {
    f.cleanup()
  }
})

void test("another worktree runs while a same-worktree waiter consumes no spare clone slot", async () => {
  const f = fixture()
  try {
    const other = join(f.root, ".scratch", "other-worktree")
    f.git("worktree", "add", "-qb", "other", other)
    const ready = join(f.root, ".scratch", "parallel-ready")
    const release = join(f.root, ".scratch", "parallel-release")
    const a = start(f.root, [
      process.execPath,
      "-e",
      `const fs=require('fs');fs.writeFileSync(${JSON.stringify(ready)},'ready');const t=setInterval(()=>{if(fs.existsSync(${JSON.stringify(release)}))clearInterval(t)},10)`
    ])
    await until(() => {
      try {
        return readFileSync(ready, "utf8") === "ready"
      } catch {
        return false
      }
    })
    const b = start(f.root, [process.execPath, "-e", ""])
    const c = await start(other, [process.execPath, "-e", "process.stdout.write('other worktree ran')"]).done
    assert.equal(c.code, 0, c.output)
    assert.ok(c.output.includes("other worktree ran"))
    writeFileSync(release, "release")
    assert.equal((await a.done).code, 0)
    assert.equal((await b.done).code, 0)
  } finally {
    f.cleanup()
  }
})

void test("spawn intent is durable before the spawn boundary; an unobserved boundary cannot be reconciled", async () => {
  const f = fixture()
  try {
    assert.equal((await start(f.root, [process.execPath, "-e", ""]).done).code, 0)
    const entry = runs(f.root)[0]
    atomicRecord(join(entry.runDirectory, "registration.json"), {
      version: custodyVersion,
      runId: entry.runId,
      state: "open",
      obligations: []
    })
    for (const name of readdirSync(join(entry.runDirectory, "obligations")))
      rmSync(join(entry.runDirectory, "obligations", name))
    let reachedBoundary = false
    const failure = new Error("lost spawn observation")
    assert.throws(
      () =>
        registerSpawn({
          command: { name: "cut" },
          environment: {
            ...environment(),
            DALPH_GATE_RUN_DIRECTORY: entry.runDirectory,
            DALPH_GATE_RUN_ID: entry.runId,
            DALPH_GATE_OBLIGATION: "root"
          },
          spawnChild: () => {
            const inventory = readRecord(join(entry.runDirectory, "registration.json"))
            assert.equal(inventory.obligations.length, 1)
            assert.equal(
              readRecord(join(entry.runDirectory, "obligations", `${inventory.obligations[0]}.json`)).state,
              "intent"
            )
            reachedBoundary = true
            throw failure
          }
        }),
      (error) => error === failure
    )
    assert.equal(reachedBoundary, true)
    assert.throws(() => reconcileGateRun(entry), /Unobserved/u)
  } finally {
    f.cleanup()
  }
})

void test("definite no-child spawn failure releases custody but records a failing genuine outcome", async () => {
  const f = fixture()
  try {
    const a = await start(f.root, [join(f.root, "missing-executable")]).done
    assert.equal(a.code, 1)
    const evidence = readRunEvidence(runs(f.root)[0])
    assert.equal(evidence.custody, "stopped")
    assert.equal(evidence.qualification, "UNPROVEN")
    assert.equal(evidence.stages[0].outcome, "launch-failed")
    assert.equal(evidence.stages[0].exitCode, null)
    assert.equal((await start(f.root, [process.execPath, "-e", ""]).done).code, 0)
  } finally {
    f.cleanup()
  }
})

void test("launch failure publishes one launch-failed lifecycle terminal without success evidence", async () => {
  const f = fixture()
  try {
    const progressPath = join(f.root, ".scratch", "launch-failure-progress.jsonl")
    const script = join(f.root, ".scratch", "launch-failure-progress.mjs")
    writeFileSync(
      script,
      `import {appendFileSync} from 'node:fs';import {runBoundedCommand} from ${JSON.stringify(new URL(`file://${bounded}`).href)};const events=[];try{await runBoundedCommand({executable:${JSON.stringify(join(f.root, "missing-progress-executable"))},args:[],name:'progress launch failure',progress:{emit:event=>events.push(event),identity:{position:0,kind:'test',name:'progress launch failure'}},timeoutMilliseconds:2000})}catch(error){process.stderr.write(error.message+'\\n');process.exitCode=23}finally{appendFileSync(${JSON.stringify(progressPath)},events.map(event=>JSON.stringify(event)).join('\\n')+'\\n')}`
    )
    const result = await start(f.root, [process.execPath, script]).done
    assert.equal(result.code, 23, result.output)
    const events = readFileSync(progressPath, "utf8")
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line))
    assert.deepEqual(
      events.map((event) => event.type),
      ["start", "terminal"]
    )
    assert.equal(events.at(-1).outcome, "launch-failed")
    const entry = runs(f.root)[0]
    const evidence = readRunEvidence(entry)
    assert.equal(evidence.qualification, "UNPROVEN")
    const nested = evidence.stages.find((stage) => stage.command.name === "progress launch failure")
    assert.equal(nested.outcome, "launch-failed")
    assert.equal(nested.exitCode, null)
    assert.equal(nested.groupAbsent, true)
  } finally {
    f.cleanup()
  }
})

void test("formal progress advertises a shorter child timeout instead of the enclosing gate deadline", async () => {
  const f = fixture()
  try {
    const progressPath = join(f.root, ".scratch", "short-child-progress.jsonl")
    const script = join(f.root, ".scratch", "short-child-progress.mjs")
    writeFileSync(
      script,
      `import {writeFileSync} from 'node:fs';import {runBoundedCommand} from ${JSON.stringify(new URL(`file://${bounded}`).href)};const events=[];await runBoundedCommand({executable:process.execPath,args:['-e',''],name:'short progress child',progress:{emit:event=>events.push(event),identity:{position:0,kind:'test',name:'short progress child'}},timeoutMilliseconds:2000});writeFileSync(${JSON.stringify(progressPath)},events.map(event=>JSON.stringify(event)).join('\\n')+'\\n')`
    )
    const result = await start(f.root, [process.execPath, script]).done
    assert.equal(result.code, 0, result.output)
    const [started] = readFileSync(progressPath, "utf8")
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line))
    assert.equal(started.type, "start")
    const advertisedMilliseconds = Date.parse(started.deadline) - Date.parse(started.startedAt)
    assert.ok(advertisedMilliseconds > 0, `expected a future deadline, received ${advertisedMilliseconds}`)
    assert.ok(advertisedMilliseconds <= 2000, `expected child deadline <= 2000ms, received ${advertisedMilliseconds}`)
  } finally {
    f.cleanup()
  }
})

void test("OS-signal interruption emits the genuine interrupted terminal and preserves custody evidence", async () => {
  const f = fixture()
  try {
    const ready = join(f.root, ".scratch", "progress-interrupt-ready")
    const progressPath = join(f.root, ".scratch", "progress-interrupt.jsonl")
    const script = join(f.root, ".scratch", "progress-interrupt.mjs")
    const childSource = `const fs=require('fs');fs.writeFileSync(${JSON.stringify(ready)},'ready');setInterval(()=>{},1000)`
    writeFileSync(
      script,
      `import {appendFileSync} from 'node:fs';import {runBoundedCommand} from ${JSON.stringify(new URL(`file://${bounded}`).href)};const events=[];try{await runBoundedCommand({executable:process.execPath,args:['-e',${JSON.stringify(childSource)}],name:'progress signal interruption',relayParentSignals:true,progress:{emit:event=>events.push(event),identity:{position:0,kind:'test',name:'progress signal interruption'}},terminationGraceMilliseconds:100,timeoutMilliseconds:5000})}catch(error){process.stderr.write(error.message+'\\n')}finally{appendFileSync(${JSON.stringify(progressPath)},events.map(event=>JSON.stringify(event)).join('\\n')+'\\n')}`
    )
    const running = start(f.root, [process.execPath, script])
    await until(() => {
      try {
        return readFileSync(ready, "utf8") === "ready"
      } catch {
        return false
      }
    })
    running.child.kill("SIGTERM")
    await running.done
    const events = readFileSync(progressPath, "utf8")
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line))
    assert.deepEqual(
      events.map((event) => event.type),
      ["start", "terminal"]
    )
    assert.equal(events.at(-1).outcome, "interrupted")
    assert.notEqual(events.at(-1).outcome, "exit:0")
    const evidence = readRunEvidence(runs(f.root)[0])
    const stage = evidence.stages.find((item) => item.command.name === "progress signal interruption")
    assert.equal(stage.outcome, "interrupted")
    assert.equal(stage.signal, "SIGTERM")
    assert.equal(stage.groupAbsent, true)
    assert.equal(evidence.custody, "stopped")
    assert.equal((await start(f.root, [process.execPath, "-e", ""]).done).code, 0)
  } finally {
    f.cleanup()
  }
})

void test("malformed, wrong-version, wrong-input and invented successful receipts are never successful evidence", async () => {
  const f = fixture()
  try {
    assert.equal(
      (await start(f.root, [process.execPath, "-e", "process.stdout.write('readable after terminal loss')"]).done).code,
      0
    )
    const entry = runs(f.root)[0]
    const evidence = readRunEvidence(entry)
    assert.equal(evidence.qualification, "passed")
    assert.equal(readFileSync(evidence.stages[0].logPath, "utf8"), "readable after terminal loss")
    const receiptPath = join(entry.runDirectory, "receipts", `${evidence.stages[0].obligationId}.json`)
    const original = readFileSync(receiptPath, "utf8")
    const receipt = JSON.parse(original)
    for (const corrupted of [
      "{",
      JSON.stringify({ ...receipt, version: 2 }),
      JSON.stringify({ ...receipt, signal: "SIGTERM" }),
      JSON.stringify({ ...receipt, signal: undefined }),
      JSON.stringify({ ...receipt, inputDigest: "wrong" }),
      JSON.stringify({ ...receipt, exitCode: null, outcome: "passed" }),
      JSON.stringify({ ...receipt, runId: "wrong" })
    ]) {
      writeFileSync(receiptPath, corrupted)
      assert.throws(() => readRunEvidence(entry))
    }
    writeFileSync(receiptPath, original)
    assert.equal(readRunEvidence(entry).qualification, "passed")
  } finally {
    f.cleanup()
  }
})

for (const [name, value] of [
  ["DALPH_RUN_REAL_CODEX_QUALIFICATION", "1"],
  ["DALPH_QUALIFICATION_ENV_CAPTURE", "/tmp/unconfined-capture"]
]) {
  void test(`inherited admission rejects ${name} before its requested writer launch`, async () => {
    const f = fixture()
    try {
      const source = `const r=require('child_process').spawnSync(process.execPath,[${JSON.stringify(wrapper)},'--',process.execPath,'-e',"throw Error('must not launch')"],{env:{...process.env,${name}:${JSON.stringify(value)}},encoding:'utf8'}); if(r.status!==1||!r.stderr.includes('outside supported gate custody'))process.exit(23);process.stdout.write('refused inherited launch')`
      const result = await start(f.root, [process.execPath, "-e", source]).done
      assert.equal(result.code, 0, result.output)
      const evidence = readRunEvidence(runs(f.root)[0])
      assert.equal(evidence.stages.length, 1)
    } finally {
      f.cleanup()
    }
  })
}

for (const signal of ["SIGTERM", "SIGINT"]) {
  void test(`proven ${signal} termination permits a fresh run and retains genuine signal outcome`, async () => {
    const f = fixture()
    try {
      const ready = join(f.root, ".scratch", `signal-${signal}`)
      const a = start(f.root, [
        process.execPath,
        "-e",
        `require('fs').writeFileSync(${JSON.stringify(ready)},'ready');setInterval(()=>{},1000)`
      ])
      await until(() => {
        try {
          return readFileSync(ready, "utf8") === "ready"
        } catch {
          return false
        }
      })
      a.child.kill(signal)
      const terminated = await a.done
      const entry = runs(f.root)[0]
      const evidence = readRunEvidence(entry)
      assert.equal(evidence.custody, "stopped", terminated.output)
      assert.ok(evidence.stages[0].outcome.includes("interrupted"))
      assert.equal(evidence.stages[0].signal, "SIGTERM")
      assert.equal((await start(f.root, [process.execPath, "-e", ""]).done).code, 0)
    } finally {
      f.cleanup()
    }
  })
}

void test("direct exit 0 with a surviving group keeps worktree and clone capacity fenced until proven reconciliation", async () => {
  const f = fixture()
  let harness
  try {
    const ready = join(f.root, ".scratch", "descendant-ready")
    const release = join(f.root, ".scratch", "descendant-release")
    const descendant = `const fs=require('fs');fs.writeFileSync(${JSON.stringify(ready)},'ready');const t=setInterval(()=>{if(fs.existsSync(${JSON.stringify(release)}))clearInterval(t)},10)`
    const source = `const c=require('child_process').spawn(process.execPath,['-e',${JSON.stringify(descendant)}],{stdio:'ignore'});c.unref()`
    harness = startReaped(f.root, [process.execPath, "-e", source])
    await until(() => {
      try {
        return readFileSync(ready, "utf8") === "ready"
      } catch {
        return false
      }
    })
    const entry = runs(f.root)[0]
    await until(() => {
      try {
        return readRunEvidence(entry).stages[0].groupAbsent === false
      } catch {
        return false
      }
    })
    const evidence = readRunEvidence(entry)
    assert.equal(evidence.stages[0].exitCode, 0)
    assert.equal(evidence.qualification, "UNPROVEN")
    assert.equal(evidence.custody, "UNRESOLVED")
    const other = join(f.root, ".scratch", "fenced-other")
    f.git("worktree", "add", "-qb", "fenced-other", other)
    const refused = await start(other, [process.execPath, "-e", "throw Error('must not launch')"], {
      DALPH_GATE_SLOTS: "1"
    }).done
    assert.equal(refused.code, 1)
    assert.ok(refused.output.includes("All clone gate slots require reconciliation"))
    assert.throws(() => reconcileGateRun(entry), /not proven absent/u)
    writeFileSync(release, "release")
    await harness.done
    assert.equal(reconcileGateRun(entry).custody, "stopped")
    assert.equal(readRunEvidence(entry).stages[0].exitCode, 0)
  } finally {
    if (harness !== undefined) {
      writeFileSync(join(f.root, ".scratch", "descendant-release"), "release")
      await harness.done
    }
    f.cleanup()
  }
})

void test("a killed nested bounded runner cannot abandon its detached writer custody", async () => {
  const f = fixture()
  let harness
  try {
    const ready = join(f.root, ".scratch", "nested-crash-ready")
    const release = join(f.root, ".scratch", "nested-crash-release")
    const source = `import {runBoundedCommand} from ${JSON.stringify(new URL(`file://${bounded}`).href)}; await runBoundedCommand({executable:process.execPath,args:['-e',${JSON.stringify(`const fs=require('fs');fs.writeFileSync(${JSON.stringify(ready)},'ready');const t=setInterval(()=>{if(fs.existsSync(${JSON.stringify(release)}))clearInterval(t)},10)`)}],name:'surviving nested writer',timeoutMilliseconds:10000})`
    const script = join(f.root, ".scratch", "nested-crash.mjs")
    writeFileSync(script, source)
    harness = startReaped(f.root, [process.execPath, script])
    await until(() => {
      try {
        return readFileSync(ready, "utf8") === "ready"
      } catch {
        return false
      }
    })
    const entry = runs(f.root)[0]
    const inventory = readRecord(join(entry.runDirectory, "registration.json"))
    const top = inventory.obligations
      .map((id) => readRecord(join(entry.runDirectory, "obligations", `${id}.json`)))
      .find((obligation) => obligation.parentId === "root")
    process.kill(top.processGroup, "SIGKILL")
    await until(() => {
      try {
        return readRunEvidence(entry).registration === "closed"
      } catch {
        return false
      }
    })
    const refused = await start(f.root, [process.execPath, "-e", "throw Error('must not launch')"]).done
    assert.equal(refused.code, 1)
    assert.throws(() => reconcileGateRun(entry), /not proven absent/u)
    writeFileSync(release, "release")
    await harness.done
    assert.equal(reconcileGateRun(entry).custody, "stopped")
    assert.ok(readRunEvidence(entry).stages.some((stage) => stage.outcome === "UNPROVEN"))
  } finally {
    if (harness !== undefined) {
      writeFileSync(join(f.root, ".scratch", "nested-crash-release"), "release")
      await harness.done
    }
    f.cleanup()
  }
})

void test("parent loss leaves only live progress, keeps exact custody fences, and emits no synthetic terminal", async () => {
  const f = fixture()
  let harness
  try {
    const ready = join(f.root, ".scratch", "progress-parent-loss-ready")
    const release = join(f.root, ".scratch", "progress-parent-loss-release")
    const progressPath = join(f.root, ".scratch", "progress-parent-loss.jsonl")
    const childSource = `const fs=require('fs');fs.writeFileSync(${JSON.stringify(ready)},'ready');const t=setInterval(()=>{if(fs.existsSync(${JSON.stringify(release)})){clearInterval(t);process.exit(0)}},10)`
    const source = `import {appendFileSync} from 'node:fs';import {runBoundedCommand} from ${JSON.stringify(new URL(`file://${bounded}`).href)};await runBoundedCommand({executable:process.execPath,args:['-e',${JSON.stringify(childSource)}],name:'parent loss progress child',progress:{emit:event=>appendFileSync(${JSON.stringify(progressPath)},JSON.stringify(event)+'\\n'),identity:{position:1,kind:'verify',name:'parent loss progress child'}},progressHeartbeatMilliseconds:20,timeoutMilliseconds:10000})`
    const script = join(f.root, ".scratch", "progress-parent-loss.mjs")
    writeFileSync(script, source)
    harness = startReaped(f.root, [process.execPath, script])
    await until(() => {
      try {
        return readFileSync(ready, "utf8") === "ready"
      } catch {
        return false
      }
    })
    await until(() => {
      try {
        return readFileSync(progressPath, "utf8").includes('"type":"heartbeat"')
      } catch {
        return false
      }
    })
    const entry = runs(f.root)[0]
    const registrationPath = join(entry.runDirectory, "registration.json")
    const obligations = () =>
      readRecord(registrationPath).obligations.map((id) =>
        readRecord(join(entry.runDirectory, "obligations", `${id}.json`))
      )
    const nested = () => obligations().find((obligation) => obligation.command.name === "parent loss progress child")
    await until(() => nested()?.state === "observed")
    const nestedObligation = nested()
    assert.ok(nestedObligation)
    const parent = obligations().find((obligation) => obligation.parentId === "root")
    assert.ok(parent)
    process.kill(parent.processGroup, "SIGKILL")
    await until(() => readRecord(registrationPath).state === "closed")
    const progressBeforeRelease = readFileSync(progressPath, "utf8")
    assert.match(progressBeforeRelease, /"type":"start"/u)
    assert.match(progressBeforeRelease, /"type":"heartbeat"/u)
    assert.doesNotMatch(progressBeforeRelease, /"type":"terminal"/u)
    assert.equal(existsSync(join(entry.runDirectory, "receipts", `${nestedObligation.obligationId}.json`)), false)
    const run = readRecord(join(entry.runDirectory, "run.json"))
    assert.equal(existsSync(run.worktreeFence), true)
    assert.equal(existsSync(run.slotFence), true)
    assert.throws(() => reconcileGateRun(entry), /not proven absent/u)
    writeFileSync(release, "release")
    await harness.done
    assert.equal(readFileSync(progressPath, "utf8"), progressBeforeRelease)
    assert.deepEqual(reconcileGateRun(entry), { runId: entry.runId, custody: "stopped", qualification: "UNPROVEN" })
    assert.equal(existsSync(run.worktreeFence), false)
    assert.equal(existsSync(run.slotFence), false)
    assert.equal(
      readRecord(join(entry.runDirectory, "absence", `${nestedObligation.obligationId}.json`)).processGroup,
      nestedObligation.processGroup
    )
    const evidence = readRunEvidence(entry)
    assert.equal(evidence.qualification, "UNPROVEN")
    assert.equal(
      evidence.stages.find((stage) => stage.obligationId === nestedObligation.obligationId).outcome,
      "UNPROVEN"
    )
  } finally {
    if (harness !== undefined) {
      writeFileSync(join(f.root, ".scratch", "progress-parent-loss-release"), "release")
      await harness.done
    }
    f.cleanup()
  }
})

void test("admitted closed reporting transport stops heartbeat without fabricating a terminal", async () => {
  const f = fixture()
  try {
    const transportPath = join(f.root, ".scratch", "closed-reporting-transport.jsonl")
    const lifecyclePath = join(f.root, ".scratch", "closed-reporting-lifecycle.jsonl")
    const resultPath = join(f.root, ".scratch", "closed-reporting-result.json")
    const summaryPath = join(f.root, ".scratch", "closed-reporting-summary.json")
    const faultPath = join(f.root, ".scratch", "closed-reporting-fault.txt")
    const childSource = `
      const fs = require('node:fs')
      fs.writeSync(3, JSON.stringify({version:1,type:'start',position:12,kind:'verify',name:'closed reporting child'})+'\\n')
      fs.writeSync(3, '{"version":1,"type":"terminal","outcome":"exit:99"')
      fs.closeSync(3)
      setTimeout(() => process.exit(0), 150)
    `
    const source = `
      import {appendFileSync,readFileSync,writeFileSync} from 'node:fs'
      import {setTimeout} from 'node:timers/promises'
      import {runBoundedCommand} from ${JSON.stringify(new URL(`file://${bounded}`).href)}
      const append = (path, event) => appendFileSync(path, JSON.stringify(event)+'\\n')
      process.on('unhandledRejection', error => { writeFileSync(${JSON.stringify(faultPath)}, 'unhandled:'+String(error)); process.exitCode=91 })
      process.on('uncaughtException', error => { writeFileSync(${JSON.stringify(faultPath)}, 'uncaught:'+String(error)); process.exitCode=92 })
      let result
      try {
        result = await runBoundedCommand({
          executable:process.execPath,
          args:['-e',${JSON.stringify(childSource)}],
          name:'closed reporting transport child',
          progress:{emit:event=>append(${JSON.stringify(lifecyclePath)},event),identity:{position:12,kind:'verify',name:'closed reporting child'}},
          progressHeartbeatMilliseconds:20,
          progressTransport:{onEvent:event=>append(${JSON.stringify(transportPath)},event)},
          timeoutMilliseconds:2000
        })
        writeFileSync(${JSON.stringify(resultPath)}, JSON.stringify({exitCode:result.exitCode,outputLineCount:result.outputLineCount}))
      } catch(error) {
        writeFileSync(${JSON.stringify(resultPath)}, JSON.stringify({error:error.message,result:error.quintCommandResult}))
        process.exitCode=23
      }
      const before = readFileSync(${JSON.stringify(lifecyclePath)}, 'utf8')
      await setTimeout(80)
      const after = readFileSync(${JSON.stringify(lifecyclePath)}, 'utf8')
      writeFileSync(${JSON.stringify(summaryPath)}, JSON.stringify({before,after,transport:readFileSync(${JSON.stringify(transportPath)},'utf8')}))
    `
    const script = join(f.root, ".scratch", "closed-reporting-transport.mjs")
    writeFileSync(script, source)
    const result = await start(f.root, [process.execPath, script]).done
    assert.equal(result.code, 0, result.output)
    assert.equal(existsSync(faultPath), false, result.output)

    const commandResult = JSON.parse(readFileSync(resultPath, "utf8"))
    assert.deepEqual(commandResult, { exitCode: 0, outputLineCount: 0 })
    const summary = JSON.parse(readFileSync(summaryPath, "utf8"))
    const lifecycleBefore = summary.before
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line))
    const lifecycleAfter = summary.after
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line))
    const transport = summary.transport
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line))
    assert.ok(lifecycleBefore.some((event) => event.type === "heartbeat"))
    assert.deepEqual(lifecycleBefore, lifecycleAfter)
    assert.deepEqual(
      lifecycleAfter.filter((event) => event.type === "terminal").map((event) => event.outcome),
      ["exit:0"]
    )
    // The child closes fd3 after a complete start and an incomplete terminal frame, then remains alive.
    // The real reader therefore has a parent-loss/EOF boundary before the genuine child exit; cleanup
    // discards the incomplete frame and never invents a terminal for the closed reporting transport.
    assert.deepEqual(
      transport.map((event) => event.type),
      ["start"]
    )

    const entry = runs(f.root)[0]
    const evidence = readRunEvidence(entry)
    assert.equal(evidence.registration, "closed")
    assert.equal(evidence.custody, "stopped")
    assert.equal(evidence.qualification, "passed")
    const registration = readRecord(join(entry.runDirectory, "registration.json"))
    const nested = registration.obligations
      .map((id) => readRecord(join(entry.runDirectory, "obligations", `${id}.json`)))
      .find((obligation) => obligation.command.name === "closed reporting transport child")
    assert.ok(nested)
    const receipt = readRecord(join(entry.runDirectory, "receipts", `${nested.obligationId}.json`))
    assert.deepEqual(
      {
        outcome: receipt.outcome,
        exitCode: receipt.exitCode,
        signal: receipt.signal,
        groupAbsent: receipt.groupAbsent
      },
      { outcome: "passed", exitCode: 0, signal: null, groupAbsent: true }
    )
    const absence = readRecord(join(entry.runDirectory, "absence", `${nested.obligationId}.json`))
    assert.deepEqual(
      { state: absence.state, processGroup: absence.processGroup },
      { state: "observed", processGroup: nested.processGroup }
    )
    const run = readRecord(join(entry.runDirectory, "run.json"))
    assert.equal(existsSync(run.worktreeFence), false)
    assert.equal(existsSync(run.slotFence), false)
  } finally {
    f.cleanup()
  }
})

void test("a bare inherited slot ordinal cannot bypass fresh admission", async () => {
  const f = fixture()
  try {
    assert.equal((await start(f.root, [process.execPath, "-e", ""], { DALPH_GATE_SLOT: "1" }).done).code, 0)
    assert.equal(runs(f.root).length, 1)
    assert.equal(readRunEvidence(runs(f.root)[0]).custody, "stopped")
  } finally {
    f.cleanup()
  }
})

void test("finished failed coverage runs retain distinct captured report evidence and the exact base/source association", async () => {
  const f = fixture()
  try {
    const script = join(f.root, ".scratch", "coverage-fixture.mjs")
    writeFileSync(
      script,
      `import {mkdirSync,writeFileSync} from 'node:fs';import {join} from 'node:path';const d=process.env.DALPH_COVERAGE_DIRECTORY;mkdirSync(d,{recursive:true});writeFileSync(join(d,'coverage-final.json'),'{}');writeFileSync(join(d,'coverage-summary.json'),'{}');process.stdout.write('coverage failed diagnostics');process.exit(23)`
    )
    for (let count = 0; count < 2; count += 1)
      assert.equal((await start(f.root, [process.execPath, script, "coverage:body"]).done).code, 23)
    const evidence = runs(f.root).map(readRunEvidence)
    assert.equal(evidence.length, 2)
    assert.notEqual(evidence[0].coverage.final.path, evidence[1].coverage.final.path)
    for (const run of evidence) {
      assert.equal(run.baseSha, f.git("rev-parse", "HEAD^"))
      assert.equal(run.custody, "stopped")
      assert.equal(run.qualification, "UNPROVEN")
      assert.equal(run.stages[0].exitCode, 23)
      assert.equal(run.stages[0].coverage.final.sha256, run.coverage.final.sha256)
      assert.equal(run.coverage.final.bytes, 2)
      assert.equal(readFileSync(run.coverage.final.path, "utf8"), "{}")
      assert.ok(readFileSync(run.stages[0].logPath, "utf8").includes("coverage failed diagnostics"))
    }
  } finally {
    f.cleanup()
  }
})

void test("changed source cannot be reported as a qualified original input even when the command exits zero", async () => {
  const f = fixture()
  try {
    const source = `require('fs').appendFileSync('.gitignore','changed-input\\n')`
    const result = await start(f.root, [process.execPath, "-e", source]).done
    assert.equal(result.code, 1)
    const evidence = readRunEvidence(runs(f.root)[0])
    assert.equal(evidence.terminal.commandExit, 0)
    assert.equal(evidence.terminal.sourceUnchanged, false)
    assert.equal(evidence.qualification, "UNPROVEN")
  } finally {
    f.cleanup()
  }
})

void test("missing or changed logs cannot prove qualification, and incompatible terminal/registration evidence is refused", async () => {
  const f = fixture()
  try {
    assert.equal((await start(f.root, [process.execPath, "-e", "process.stdout.write('original log')"]).done).code, 0)
    const entry = runs(f.root)[0]
    const evidence = readRunEvidence(entry)
    const logPath = evidence.stages[0].logPath
    writeFileSync(logPath, "changed log")
    assert.equal(readRunEvidence(entry).stages[0].outcome, "UNPROVEN")
    assert.equal(readRunEvidence(entry).qualification, "UNPROVEN")
    rmSync(logPath)
    assert.equal(readRunEvidence(entry).qualification, "UNPROVEN")
    writeFileSync(logPath, "original log")
    const terminalPath = join(entry.runDirectory, "terminal.json")
    const terminal = readRecord(terminalPath)
    atomicRecord(terminalPath, { ...terminal, custody: "unresolved" })
    assert.throws(() => readRunEvidence(entry), /terminal/u)
    atomicRecord(terminalPath, terminal)
    const registrationPath = join(entry.runDirectory, "registration.json")
    const registration = readRecord(registrationPath)
    atomicRecord(registrationPath, { ...registration, state: "open" })
    assert.throws(() => readRunEvidence(entry), /terminal/u)
    atomicRecord(registrationPath, { ...registration, obligations: [] })
    assert.throws(() => readRunEvidence(entry), /inventory/u)
  } finally {
    f.cleanup()
  }
})

void test("coverage verifiers consume the admitted run's report directory without starting Vitest", async () => {
  const f = fixture()
  try {
    const summaryVerifier = fileURLToPath(new URL("./verify-coverage-summary.mjs", import.meta.url))
    const changedVerifier = fileURLToPath(new URL("./verify-changed-coverage.mjs", import.meta.url))
    const script = join(f.root, ".scratch", "verify-paths.mjs")
    writeFileSync(
      script,
      `import {mkdirSync,writeFileSync} from 'node:fs';import {join} from 'node:path';import {spawnSync} from 'node:child_process';const d=process.env.DALPH_COVERAGE_DIRECTORY;mkdirSync(d,{recursive:true});const metric={total:1,covered:1,skipped:0,pct:100};writeFileSync(join(d,'coverage-summary.json'),JSON.stringify({total:{statements:metric,branches:metric,functions:metric,lines:metric}}));writeFileSync(join(d,'coverage-final.json'),'{}');for(const path of ${JSON.stringify([summaryVerifier, changedVerifier])}){const r=spawnSync(process.execPath,[path],{stdio:'inherit'});if(r.status!==0)process.exit(r.status??1)}`
    )
    const result = await start(f.root, [process.execPath, script, "coverage:body"]).done
    assert.equal(result.code, 0, result.output)
    const evidence = readRunEvidence(runs(f.root)[0])
    assert.equal(evidence.coverage.final.path, join(evidence.reportDirectory, "coverage", "coverage-final.json"))
    assert.equal(evidence.qualification, "passed")
    assert.equal(evidence.stages.length, 1)
    assert.ok(evidence.stages[0].command.args.includes("coverage:body"))
  } finally {
    f.cleanup()
  }
})

void test("killing the outer launcher does not release a healthy writer's exact worktree ownership", async () => {
  const f = fixture()
  try {
    const ready = join(f.root, ".scratch", "launcher-ready")
    const release = join(f.root, ".scratch", "launcher-release")
    const a = start(f.root, [
      process.execPath,
      "-e",
      `const fs=require('fs');fs.writeFileSync(${JSON.stringify(ready)},'ready');const t=setInterval(()=>{if(fs.existsSync(${JSON.stringify(release)}))clearInterval(t)},10)`
    ])
    await until(() => {
      try {
        return readFileSync(ready, "utf8") === "ready"
      } catch {
        return false
      }
    })
    a.child.kill("SIGKILL")
    const b = start(f.root, [process.execPath, "-e", ""])
    await setTimeout(100)
    assert.equal(runs(f.root).length, 1)
    writeFileSync(release, "release")
    await a.done
    assert.equal((await b.done).code, 0)
    assert.ok(
      runs(f.root)
        .map(readRunEvidence)
        .every((run) => run.custody === "stopped")
    )
  } finally {
    f.cleanup()
  }
})

void test("a real crash inside the unobserved spawn boundary remains fenced even when its owner group is absent", async () => {
  const f = fixture()
  try {
    const registrationModule = fileURLToPath(new URL("./gate-registration.mjs", import.meta.url))
    const source = `import {registerSpawn} from ${JSON.stringify(new URL(`file://${registrationModule}`).href)};registerSpawn({command:{executable:process.execPath,args:[],cwd:process.cwd(),name:'unobserved spawn',acceptedExitCodes:[0],timeoutMilliseconds:1000},environment:process.env,spawnChild:()=>process.kill(process.pid,'SIGKILL')})`
    const script = join(f.root, ".scratch", "unknown-cut.mjs")
    writeFileSync(script, source)
    assert.equal((await start(f.root, [process.execPath, script]).done).code, 1)
    const entry = runs(f.root)[0]
    assert.throws(() => reconcileGateRun(entry), /Unobserved/u)
    const refused = await start(f.root, [process.execPath, "-e", "throw Error('must not launch')"]).done
    assert.equal(refused.code, 1)
    assert.ok(refused.output.includes(entry.runId))
  } finally {
    f.cleanup()
  }
})

void test("a delayed admitted bootstrap cannot spawn after reconciliation closed its registration", async () => {
  const f = fixture()
  try {
    assert.equal((await start(f.root, [process.execPath, "-e", ""]).done).code, 0)
    const entry = runs(f.root)[0]
    const evidence = readRunEvidence(entry)
    const env = {
      DALPH_GATE_RUN_DIRECTORY: entry.runDirectory,
      DALPH_GATE_RUN_ID: entry.runId,
      DALPH_GATE_OBLIGATION: evidence.stages[0].obligationId
    }
    assert.equal(reconcileGateRun(entry).custody, "stopped")
    const marker = join(f.root, ".scratch", "forbidden-old-write")
    const late = await start(
      f.root,
      [process.execPath, "-e", `require('fs').writeFileSync(${JSON.stringify(marker)},'forbidden')`],
      env
    ).done
    assert.equal(late.code, 1)
    assert.ok(late.output.includes("closed"))
    assert.equal(readRunEvidence(entry).stages.length, 1)
    const other = join(f.root, ".scratch", "wrong-worktree")
    f.git("worktree", "add", "-qb", "wrong-worktree", other)
    const wrong = await start(other, [process.execPath, "-e", "throw Error('must not launch')"], env).done
    assert.equal(wrong.code, 1)
    assert.ok(wrong.output.includes("another worktree"))
  } finally {
    f.cleanup()
  }
})

void test("failed input fingerprinting launches no writer and stopped custody can be reconciled independently", async () => {
  const f = fixture()
  try {
    const result = await start(f.root, [process.execPath, "-e", "throw Error('must not launch')"], {
      npm_execpath: join(f.root, "missing-pnpm")
    }).done
    assert.equal(result.code, 1)
    const entry = runs(f.root)[0]
    const before = readRunEvidence(entry)
    assert.equal(before.stages.length, 0)
    assert.equal(before.custody, "UNRESOLVED")
    assert.equal(reconcileGateRun(entry).custody, "stopped")
    const after = readRunEvidence(entry)
    assert.equal(after.custody, "stopped")
    assert.equal(after.qualification, "UNPROVEN")
  } finally {
    f.cleanup()
  }
})

void test("an explicit replacement child environment cannot omit the admitted owner's custody", async () => {
  const f = fixture()
  try {
    const script = join(f.root, ".scratch", "explicit-environment.mjs")
    writeFileSync(
      script,
      `import {runBoundedCommand} from ${JSON.stringify(new URL(`file://${bounded}`).href)};await runBoundedCommand({environment:{CONTROLLED_VALUE:'yes'},executable:process.execPath,args:['-e',"if(process.env.CONTROLLED_VALUE!=='yes'||!process.env.DALPH_GATE_OBLIGATION)process.exit(23)"],name:'replacement environment child',timeoutMilliseconds:2000})`
    )
    const result = await start(f.root, [process.execPath, script]).done
    assert.equal(result.code, 0, result.output)
    assert.equal(readRunEvidence(runs(f.root)[0]).stages.length, 2)
  } finally {
    f.cleanup()
  }
})

void test("missing ambient custody records cannot silently drop registration when the child environment omits them", async () => {
  const f = fixture()
  try {
    const script = join(f.root, ".scratch", "missing-owner.mjs")
    writeFileSync(
      script,
      `import {runBoundedCommand} from ${JSON.stringify(new URL(`file://${bounded}`).href)};process.env.DALPH_GATE_RUN_DIRECTORY+='/missing';let refused=false;try{await runBoundedCommand({environment:{},executable:process.execPath,args:['-e',"throw Error('must not launch')"],name:'missing owner child',timeoutMilliseconds:2000})}catch{refused=true}if(!refused)process.exit(23)`
    )
    const result = await start(f.root, [process.execPath, script]).done
    assert.equal(result.code, 0, result.output)
    assert.equal(readRunEvidence(runs(f.root)[0]).stages.length, 1)
  } finally {
    f.cleanup()
  }
})

void test("the private fresh runner refuses direct invocation without the acquiring shell's exact lock", () => {
  const f = fixture()
  try {
    const runner = fileURLToPath(new URL("./run-admitted-gate.mjs", import.meta.url))
    const result = spawnSync(
      process.execPath,
      [runner, "--", process.execPath, "-e", "throw Error('must not launch')"],
      { cwd: f.root, env: environment(), encoding: "utf8" }
    )
    assert.equal(result.status, 1)
    assert.ok(result.stderr.includes("exact worktree lock"))
    assert.equal(runs(f.root).length, 0)
  } finally {
    f.cleanup()
  }
})

for (const mode of ["census", "formal-copy"]) {
  void test(`${mode} observer death preserves registered detached writer custody before any next launch`, async () => {
    const f = fixture()
    let harness
    const copy = join(f.root, ".scratch", "formal-negative-copy")
    const ready = join(copy, "ready")
    const release = join(copy, "release")
    const next = join(copy, "next-launch")
    try {
      mkdirSync(copy)
      const writer = `const fs=require('fs');fs.writeFileSync(${JSON.stringify(ready)},'ready');const t=setInterval(()=>{if(fs.existsSync(${JSON.stringify(release)}))clearInterval(t)},10)`
      const observer = join(copy, "observer.mjs")
      writeFileSync(
        observer,
        `import {runBoundedCommand} from ${JSON.stringify(new URL(`file://${bounded}`).href)};await runBoundedCommand({executable:process.execPath,args:['-e',${JSON.stringify(writer)}],name:'formal fixture detached writer',timeoutMilliseconds:10000})`
      )
      const top = join(copy, "top.mjs")
      const invocation = `{executable:process.execPath,args:${JSON.stringify(mode === "census" ? [observer] : [wrapper, "--", process.execPath, observer])},cwd:${JSON.stringify(copy)},name:'fixture stage observer',timeoutMilliseconds:10000}`
      writeFileSync(
        top,
        mode === "census"
          ? `import {runBoundedCommand} from ${JSON.stringify(new URL(`file://${bounded}`).href)};import {runPreflightCensus} from ${JSON.stringify(new URL("./preflight-census.mjs", import.meta.url).href)};import fs from 'node:fs';await runPreflightCensus({gates:[{name:'first',args:[]},{name:'next',args:[]}],runStage:async gate=>{if(gate.name==='next'){fs.writeFileSync(${JSON.stringify(next)},'launched');return {outputLineCount:0}}return runBoundedCommand(${invocation})}})`
          : `import {runBoundedCommand} from ${JSON.stringify(new URL(`file://${bounded}`).href)};await runBoundedCommand(${invocation})`
      )
      assert.equal(
        spawnSync("git", ["rev-parse", "--show-toplevel"], { cwd: copy, encoding: "utf8" }).stdout.trim(),
        f.root
      )
      harness = startReaped(f.root, [process.execPath, top])
      await until(() => {
        try {
          return readFileSync(ready, "utf8") === "ready"
        } catch {
          return false
        }
      }).catch((error) => {
        const diagnostics = fileURLToPath(
          new URL(`../.scratch/custody-readiness-${mode}-${basename(f.root)}/`, import.meta.url)
        )
        let snapshotContext
        try {
          cpSync(f.root, diagnostics, { recursive: true })
          writeFileSync(
            join(diagnostics, "harness-diagnostic.json"),
            JSON.stringify(
              {
                mode,
                fixtureRoot: f.root,
                harnessPid: harness.child.pid,
                terminal: harness.terminal ?? null,
                output: harness.output
              },
              null,
              2
            )
          )
          snapshotContext = `retained fixture: ${diagnostics}`
        } catch (snapshotError) {
          snapshotContext = `fixture snapshot failed: ${snapshotError.code ?? "unknown"}: ${snapshotError.message}`
        }
        const context = `${snapshotContext}; harness terminal: ${JSON.stringify(harness.terminal ?? null)}; harness output: ${harness.output}`
        error.message += `; ${context}`
        error.stack += `\nCustody readiness diagnostic: ${context}`
        throw error
      })
      const entry = runs(f.root)[0]
      const readObligations = () =>
        readRecord(join(entry.runDirectory, "registration.json")).obligations.map((id) =>
          readRecord(join(entry.runDirectory, "obligations", `${id}.json`))
        )
      // Child-visible readiness can precede the parent's post-spawn observation record.
      // The custody mutation below is meaningful only after that exact variant is durable.
      await until(() =>
        readObligations().some(
          (record) => record.command.name === "formal fixture detached writer" && record.state === "observed"
        )
      )
      const records = readObligations()
      const killed = records.find((record) =>
        mode === "census" ? record.command.name === "fixture stage observer" : record.parentId === "root"
      )
      // Commands record their diagnostic name separately from executable identity.
      assert.ok(killed)
      process.kill(killed.processGroup, "SIGKILL")
      await until(() => readRecord(join(entry.runDirectory, "registration.json")).state === "closed")
      assert.equal(spawnSync("test", ["-e", next]).status, 1, "next census check must not launch")
      assert.throws(() => reconcileGateRun(entry), /not proven absent/u)
      if (mode === "formal-copy") {
        const live = records.find((record) => record.command.name === "formal fixture detached writer")
        assert.equal(live.state, "observed", "negative control requires the observed writer variant")
        const path = join(entry.runDirectory, "obligations", `${live.obligationId}.json`)
        atomicRecord(path, { ...live, state: "no-child" })
        assert.throws(() => readRunEvidence(entry), /Invalid custody obligation variant/u)
        assert.throws(() => reconcileGateRun(entry), /Invalid custody obligation variant/u)
        const run = readRecord(join(entry.runDirectory, "run.json"))
        assert.equal(readRecord(run.worktreeFence).runId, entry.runId)
        assert.equal(readRecord(run.slotFence).runId, entry.runId)
        atomicRecord(path, live)
      }
      writeFileSync(release, "release")
      await harness.done
      assert.equal(reconcileGateRun(entry).custody, "stopped")
    } finally {
      if (harness !== undefined) {
        writeFileSync(release, "release")
        await harness.done
      }
      f.cleanup()
    }
  })
}

void test("an admitted negative test qualifies its successful verdict while retaining genuine nested failures", async () => {
  const f = fixture()
  try {
    const script = join(f.root, ".scratch", "expected-failure.mjs")
    writeFileSync(
      script,
      `import {runBoundedCommand} from ${JSON.stringify(new URL(`file://${bounded}`).href)};let failed=false;try{await runBoundedCommand({executable:process.execPath,args:['-e','process.exit(23)'],name:'required failing child',timeoutMilliseconds:10000})}catch(error){if(error.quintCommandResult!=='exit:23')throw error;failed=true}if(!failed)throw Error('negative control did not fail')`
    )
    const result = await start(f.root, [process.execPath, script]).done
    assert.equal(result.code, 0, result.output)
    const entry = runs(f.root)[0]
    const evidence = readRunEvidence(entry)
    assert.equal(evidence.qualification, "passed")
    const failed = evidence.stages.find((stage) => stage.command.name === "required failing child")
    assert.equal(failed.exitCode, 23)
    assert.equal(failed.outcome, "exit:23")
    const runPath = join(entry.runDirectory, "run.json")
    const run = readRecord(runPath)
    atomicRecord(runPath, { ...run, commandArguments: [...run.commandArguments, "unrelated-command"] })
    assert.equal(readRunEvidence(entry).qualification, "UNPROVEN")
    atomicRecord(runPath, run)
    const terminalPath = join(entry.runDirectory, "terminal.json")
    const terminal = readRecord(terminalPath)
    atomicRecord(terminalPath, { ...terminal, commandExit: 23 })
    assert.equal(readRunEvidence(entry).qualification, "UNPROVEN")
    atomicRecord(terminalPath, terminal)
    const receiptPath = join(entry.runDirectory, "receipts", `${failed.obligationId}.json`)
    const receipt = readFileSync(receiptPath, "utf8")
    const failedReceipt = JSON.parse(receipt)
    for (const contradictory of [
      { ...failedReceipt, exitCode: 24 },
      { ...failedReceipt, exitCode: null },
      { ...failedReceipt, outcome: "exit:24" },
      { ...failedReceipt, outcome: "launch-failed" },
      { ...failedReceipt, outcome: "unknown" }
    ]) {
      atomicRecord(receiptPath, contradictory)
      assert.throws(() => readRunEvidence(entry), /stage evidence/u)
    }
    // Observer cancellation/timeout/failure may retain an eventual ordinary child exit.
    for (const outcome of ["timed-out", "interrupted", "cancelled", "failed"]) {
      atomicRecord(receiptPath, { ...failedReceipt, outcome })
      assert.equal(readRunEvidence(entry).qualification, "passed")
      assert.equal(
        readRunEvidence(entry).stages.find((stage) => stage.obligationId === failed.obligationId).exitCode,
        23
      )
    }
    writeFileSync(receiptPath, receipt)
    rmSync(receiptPath)
    assert.equal(readRunEvidence(entry).qualification, "UNPROVEN")
    writeFileSync(receiptPath, "{")
    assert.throws(() => readRunEvidence(entry))
    writeFileSync(receiptPath, receipt)
    rmSync(failed.logPath)
    assert.equal(readRunEvidence(entry).qualification, "UNPROVEN")
  } finally {
    f.cleanup()
  }
})

void test("an admitted bounded result explicitly identifies its genuine registered obligation", async () => {
  const f = fixture()
  try {
    const script = join(f.root, ".scratch", "explicit-result.mjs")
    writeFileSync(
      script,
      `import {runBoundedCommand} from ${JSON.stringify(new URL(`file://${bounded}`).href)};const result=await runBoundedCommand({executable:process.execPath,args:['-e',''],name:'identified child result',timeoutMilliseconds:10000});process.stdout.write(JSON.stringify(result))`
    )
    const result = await start(f.root, [process.execPath, script]).done
    assert.equal(result.code, 0, result.output)
    const evidence = readRunEvidence(runs(f.root)[0])
    const enclosing = evidence.stages.find((stage) => stage.command.args.includes(script))
    const captured = JSON.parse(readFileSync(enclosing.logPath, "utf8"))
    assert.match(captured.gateObligationId, /^[0-9a-f-]{36}$/u)
    const child = evidence.stages.find((stage) => stage.obligationId === captured.gateObligationId)
    assert.equal(child.command.name, "identified child result")
    assert.equal(captured.exitCode, child.exitCode)
    assert.equal(captured.outputLineCount, child.outputLineCount)
  } finally {
    f.cleanup()
  }
})

for (const mode of ["publish", "owner-death"]) {
  void test(
    mode === "publish"
      ? "an early child waits for observed parent publication before launching its own writer"
      : "parent death before publication refuses the early child and retains both fences",
    async () => {
      const f = fixture()
      let harness
      const release = join(f.root, ".scratch", "publication-release")
      const attempt = join(f.root, ".scratch", "publication-lock-attempt")
      const refused = join(f.root, ".scratch", "publication-refused")
      const validated = join(f.root, ".scratch", "publication-validated")
      const writer = join(f.root, ".scratch", "publication-writer")
      const parentPid = join(f.root, ".scratch", "publication-parent-pid")
      try {
        const tools = join(f.root, ".scratch", "publication-tools")
        mkdirSync(tools)
        const flock = join(tools, "flock")
        // Observe the real lock acquisition boundary; this adapter still execs system flock.
        writeFileSync(
          flock,
          '#!/bin/sh\nif [ -n "$DALPH_PUBLICATION_LOCK_ATTEMPT" ]; then printf attempted > "$DALPH_PUBLICATION_LOCK_ATTEMPT"; fi\nexec /usr/bin/flock "$@"\n'
        )
        chmodSync(flock, 0o755)
        const records = new URL("./gate-custody-records.mjs", import.meta.url).href
        const registration = new URL("./gate-registration.mjs", import.meta.url).href
        const child = join(f.root, ".scratch", "publication-child.mjs")
        writeFileSync(
          child,
          `import fs from 'node:fs';import {inheritedCustody} from ${JSON.stringify(records)};import {runBoundedCommand} from ${JSON.stringify(new URL(`file://${bounded}`).href)};try{inheritedCustody();fs.writeFileSync(${JSON.stringify(validated)},'validated');await runBoundedCommand({executable:process.execPath,args:['-e',${JSON.stringify(`require('fs').appendFileSync(${JSON.stringify(writer)},'writer\\n')`)}],name:'publication nested writer',relayParentSignals:true,timeoutMilliseconds:10000})}catch(error){fs.writeFileSync(${JSON.stringify(refused)},error.message);process.exitCode=23}`
        )
        const parent = join(f.root, ".scratch", "publication-parent.mjs")
        const wait = `const fs=require('fs');const t=setInterval(()=>{if(fs.existsSync(${JSON.stringify(release)})){clearInterval(t)}},10)`
        writeFileSync(
          parent,
          `import fs from 'node:fs';import {spawn,spawnSync} from 'node:child_process';import {registerSpawn} from ${JSON.stringify(registration)};fs.writeFileSync(${JSON.stringify(parentPid)},String(process.pid));const registered=registerSpawn({command:{executable:process.execPath,args:[${JSON.stringify(child)}],cwd:process.cwd(),name:'publication early child',timeoutMilliseconds:10000,acceptedExitCodes:[0]},environment:process.env,spawnChild:environment=>{const child=spawn(process.execPath,[${JSON.stringify(child)}],{detached:true,stdio:'inherit',env:{...environment,PATH:${JSON.stringify(tools)}+':'+environment.PATH,DALPH_PUBLICATION_LOCK_ATTEMPT:${JSON.stringify(attempt)}}});const waited=spawnSync(process.execPath,['-e',${JSON.stringify(wait)}],{timeout:10000});if(waited.status!==0)throw Error('publication release barrier failed');return child}});await new Promise(resolve=>registered.child.once('close',code=>{process.exitCode=code;resolve()}));`
        )
        harness = startReaped(f.root, [process.execPath, parent])
        await until(() => {
          try {
            return readFileSync(attempt, "utf8") === "attempted" || readFileSync(refused, "utf8").length > 0
          } catch {
            try {
              return readFileSync(refused, "utf8").length > 0
            } catch {
              return false
            }
          }
        })
        let refusal
        try {
          refusal = readFileSync(refused, "utf8")
        } catch (error) {
          if (error.code !== "ENOENT") throw error
        }
        assert.equal(refusal, undefined, "child must not refuse while observed publication holds the lock")
        assert.equal(readFileSync(attempt, "utf8"), "attempted", "child must wait at the real registration lock")
        assert.throws(() => readFileSync(validated), /ENOENT/u)
        assert.throws(() => readFileSync(writer), /ENOENT/u)
        const entry = runs(f.root)[0]
        const obligations = readRecord(join(entry.runDirectory, "registration.json")).obligations.map((id) =>
          readRecord(join(entry.runDirectory, "obligations", `${id}.json`))
        )
        const early = obligations.find((record) => record.command.name === "publication early child")
        assert.equal(early.state, "intent", "the child arrived before observed publication")
        if (mode === "publish") {
          writeFileSync(release, "release")
          const result = await harness.done
          // This primitive registration fixture publishes no observer receipt;
          // custody is stopped, while qualification must remain unproven.
          assert.equal(result.code, 1, result.output)
          assert.ok(
            result.output.includes("Gate qualification UNPROVEN: terminal evidence is incomplete"),
            result.output
          )
          assert.equal(readFileSync(writer, "utf8"), "writer\n")
          const final = readRecord(join(entry.runDirectory, "registration.json")).obligations.map((id) =>
            readRecord(join(entry.runDirectory, "obligations", `${id}.json`))
          )
          assert.equal(final.filter((record) => record.command.name === "publication nested writer").length, 1)
          assert.equal(
            readRecord(join(entry.runDirectory, "obligations", `${early.obligationId}.json`)).state,
            "observed"
          )
          assert.equal(reconcileGateRun(entry).custody, "stopped")
        } else {
          process.kill(-Number(readFileSync(parentPid, "utf8")), "SIGKILL")
          assert.equal((await harness.done).code, 1)
          assert.equal(readFileSync(refused, "utf8"), "Invalid inherited parent obligation")
          assert.throws(() => readFileSync(writer), /ENOENT/u)
          assert.throws(() => reconcileGateRun(entry), /Unobserved/u)
          const run = readRecord(join(entry.runDirectory, "run.json"))
          assert.equal(readRecord(run.worktreeFence).runId, entry.runId)
          assert.equal(readRecord(run.slotFence).runId, entry.runId)
        }
      } finally {
        writeFileSync(release, "release")
        if (harness !== undefined) await harness.done
        f.cleanup()
      }
    }
  )
}
