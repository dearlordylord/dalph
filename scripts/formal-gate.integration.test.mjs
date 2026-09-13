import assert from "node:assert/strict"
import { spawn, spawnSync } from "node:child_process"
import {
  chmodSync,
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  watch,
  writeFileSync
} from "node:fs"
import { createRequire } from "node:module"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { test } from "node:test"
import {
  atomicRecord,
  digest,
  readRecord,
  repositoryLocation,
  withoutInheritedCustody
} from "./gate-custody-records.mjs"
import { readRunEvidence } from "./gate-run-evidence.mjs"
import { createQuintEffectiveProfile } from "./quint-effective-profile.mjs"

// The production command, workflow, profile execution, admission, publication and
// evidence validation execute unchanged in disposable repositories. Only installed
// checker/server and input-observation boundaries are controlled here. S7's actual
// Linux observer is used by the realObservation fixture variant below; the
// smaller adapter continues to isolate admission/publication-only scenarios.
const rootScripts = fileURLToPath(new URL("./", import.meta.url))
const inputAdapter = `
import {readFileSync,appendFileSync} from 'node:fs'
import {join} from 'node:path'
import {digest} from './gate-custody-records.mjs'
const event=(root,value)=>appendFileSync(join(root,'.scratch','events'),value+'\\n')
export const createFormalEnvironment=(environment)=>({...environment})
export const formalInputPolicyVersion=2
export const resolveFormalToolchain=async({worktree})=>{
 event(worktree,'prepare');return {nodeExecutable:process.execPath,quintEntryPoint:join(worktree,'node_modules','@informalsystems','quint','dist','src','cli.js'),javaExecutable:join(worktree,'fake-java.cjs'),javaUserHome:worktree,javaArguments:['-Duser.home='+worktree],
 apalacheJar:join(worktree,'.quint','apalache-dist-0.56.1','apalache','lib','apalache.jar'),
 evaluatorPath:join(worktree,'.quint','evaluator')}
}
export const startFormalInputGuard=async({worktree,profile,toolchain})=>{
 event(worktree,'guard-start')
 const bytes=readFileSync(join(worktree,'formal-input'))
 const profileDigest=digest(JSON.stringify(profile))
 const identity={version:2,worktree,profileDigest,toolchain,inputDigest:digest(Buffer.concat([bytes,Buffer.from(profileDigest)]))}
 return {identity,assertUnchanged:async()=>{},finish:async()=>{
 event(worktree,'guard-finish')
 if(!bytes.equals(readFileSync(join(worktree,'formal-input'))))throw Error('fixture input changed')
 return {version:2,observerVersion:1,ready:true,drained:true,unchanged:true,inputDigest:identity.inputDigest}
 },close:async()=>event(worktree,'guard-close')}
}
`
const serverAdapter = `
import {appendFileSync,readdirSync,readFileSync,existsSync,watch} from 'node:fs'
import {join} from 'node:path'
import {atomicRecord,inheritedCustody,readRecord,wallClockTimestamp,newIdentity} from './gate-custody-records.mjs'
import {runBoundedCommand} from './run-bounded-command.mjs'
export const withOwnedQuintServer=async({environment,remainingExecutionMilliseconds,runProfile,javaExecutable,javaArguments,apalacheJar})=>{
 const context=inheritedCustody();const root=context.run.worktree
 const ready=join(root,'.scratch','ready-'+newIdentity())
 const name='controlled invocation-owned server'
 const controller=new AbortController()
 const serverEndpoint='127.0.0.1:34567'
 const promise=runBoundedCommand({executable:javaExecutable,args:[...javaArguments,'-jar',apalacheJar,'--out-dir='+join(context.runDirectory,'owned-server-output',context.parentId),'server','--port=34567'],
 environment:{...environment,DALPH_FIXTURE_SERVER_READY:ready},name,signal:controller.signal,captureOutput:true,forwardOutput:false,
 timeoutMilliseconds:remainingExecutionMilliseconds(name),terminationGraceMilliseconds:5000,
 processGroupAbsenceTimeoutMilliseconds:2000}).catch(error=>error)
 const obligation=readdirSync(join(context.runDirectory,'obligations')).map(file=>readRecord(join(context.runDirectory,'obligations',file)))
 .find(item=>item.parentId===context.parentId&&item.command.name===name)
 if(!obligation)throw Error('server launch not recorded')
 await new Promise((resolve,reject)=>{
  const observer=watch(join(root,'.scratch'),()=>{if(existsSync(ready)){observer.close();resolve()}})
  if(existsSync(ready)){observer.close();resolve()}
  promise.then(()=>{observer.close();reject(Error('server exited before ready'))})
 })
 appendFileSync(join(root,'.scratch','events'),'server-start\\n')
 let profileResult;let failure;let stopPath
 try {
 profileResult=await runProfile({serverEndpoint,environment,remainingExecutionMilliseconds,signal:controller.signal})
 stopPath=join(context.runDirectory,'owned-server-stops',obligation.obligationId+'.json')
 atomicRecord(stopPath,{version:1,runId:context.run.runId,obligationId:obligation.obligationId,
 processGroup:obligation.processGroup,serverEndpoint,disposition:'profile-complete',requestedAt:wallClockTimestamp()})
 }catch(error){failure=error}finally{controller.abort();await promise}
 appendFileSync(join(root,'.scratch','events'),'server-stopped\\n')
 if(failure)throw failure
 return {profileResult,serverEvidence:{obligationId:obligation.obligationId,processGroup:obligation.processGroup,
 serverEndpoint,stopPath,receiptPath:join(context.runDirectory,'receipts',obligation.obligationId+'.json')}}
}
`
const checkerAdapter = `
const fs=require('fs');const path=require('path');const root=process.cwd()
const args=process.argv.slice(2);const control=path.join(root,'.scratch','control.json')
const configuration=JSON.parse(fs.readFileSync(control,'utf8'))
const pointerDirectory=path.join(process.env.DALPH_GATE_RUN_DIRECTORY,'..','..','formal')
const pointers=fs.readdirSync(pointerDirectory).map(file=>JSON.parse(fs.readFileSync(path.join(pointerDirectory,file),'utf8')))
if(!pointers.some(pointer=>pointer.state==='started'))throw Error('checker launched before durable attempt')
fs.appendFileSync(path.join(root,'.scratch','events'),'checker '+args[0]+' '+args[1]+'\\n')
try{fs.writeFileSync(path.join(root,'.scratch','checker-path'),process.env.PATH,{flag:'wx'})}catch(error){if(error.code!=='EEXIST')throw error}
const execute=()=>{
 if(configuration.fail){console.error('controlled checker failure');process.exit(23)}
 if(args[0]==='run'){
 const start=args.indexOf('--witnesses')+1;let end=start;while(end<args.length&&!args[end].startsWith('--'))end++
 for(const witness of args.slice(start,end))console.log(witness+' was witnessed in 1 trace(s) out of 1 explored (100.00%)')
 }
 if(args[0]==='test'&&args[1]==='specs/taskFactReconciliation_test.qnt')
 console.log('ok safeSuspensionAndExactFreshFactsAtomicallyRecordCleanP2Test passed 1 test(s)')
 if(args.includes('--temporal')){
 if(args[1].includes('negative')){console.log('[violation] Found an issue');process.exit(1)}
 console.log('[ok] No violation found')
 }
}
if(configuration.hold&&args[0]==='typecheck'){
 const release=path.join(root,'.scratch','release')
 fs.writeFileSync(path.join(root,'.scratch','checker-ready'),'ready')
 const observer=fs.watch(path.join(root,'.scratch'),()=>{if(fs.existsSync(release)){observer.close();execute()}})
 if(fs.existsSync(release)){observer.close();execute()}
}else execute()
`

// S5/S7/S12 use the production filesystem enumeration and native inotify
// observer. Controlled installed tool identities avoid provider/checker work;
// their declared external roots remain outside the candidate source boundary.
const observedInputAdapter = `
import {readFileSync,writeFileSync,appendFileSync} from 'node:fs'
import {spawnSync} from 'node:child_process'
import {join} from 'node:path'
import {platform,arch} from 'node:os'
import {createFormalEnvironment,startFormalInputGuard as originalGuard,formalInputPolicyVersion} from './controlled-original-formal-input-policy.mjs'
import {startInputObserver} from './gate-input-observer.mjs'
export {createFormalEnvironment,formalInputPolicyVersion}
const event=(root,value)=>appendFileSync(join(root,'.scratch','events'),value+'\\n')
const control=root=>JSON.parse(readFileSync(join(root,'.scratch','control.json'),'utf8'))
export const resolveFormalToolchain=async({worktree})=>{
 event(worktree,'prepare');const roots=[join(worktree,'node_modules'),join(worktree,'.quint'),join(worktree,'fake-java.cjs'),worktree+'-tools'];
 return {version:formalInputPolicyVersion,platform:platform(),architecture:arch(),roots,allowedRoots:roots,requiredRoots:roots,pythonExecutable:'/usr/bin/python3',versions:{quint:'0.32.0',fixture:'1'},
 nodeExecutable:process.execPath,quintEntryPoint:join(worktree,'node_modules','@informalsystems','quint','dist','src','cli.js'),javaExecutable:join(worktree,'fake-java.cjs'),javaUserHome:worktree,
 javaArguments:['-Duser.home='+worktree],apalacheJar:join(worktree,'.quint','apalache-dist-0.56.1','apalache','lib','apalache.jar'),evaluatorPath:join(worktree,'.quint','evaluator')}
}
export const startFormalInputGuard=async(options)=>{
 const root=options.worktree;event(root,'guard-start');let observer;
 const guard=await originalGuard({...options,startObserver:async configuration=>{observer=await startInputObserver(configuration);return observer}})
 if(control(root).overflow){
  await observer.pause();event(root,'native-observer-paused');
  const path=join(root+'-tools','runtime.so');const peer=join(root+'-tools','overflow-peer.so');const bytes=readFileSync(path);const peerBytes=readFileSync(peer);
  const limit=Number(readFileSync('/proc/sys/fs/inotify/max_queued_events','utf8'));
  const result=spawnSync('/usr/bin/python3',['-I','-S','-c','import os,sys; a=os.open(sys.argv[1],os.O_WRONLY); b=os.open(sys.argv[2],os.O_WRONLY); [(os.pwrite(a,b"x",0),os.pwrite(b,b"y",0)) for _ in range(int(sys.argv[3]))]; os.close(a); os.close(b)',path,peer,String(limit+64)],{timeout:10000,encoding:'utf8'});
  writeFileSync(path,bytes);writeFileSync(peer,peerBytes);if(result.status!==0)throw Error('overflow burst failed: '+result.stderr)
 }
 let finishes=0;
 return {...guard,finish:async options=>{
  const result=await guard.finish(options);event(root,'guard-finish');finishes++;
  if(control(root).postFormal==='final-drain'&&finishes===2){
   writeFileSync(join(root,'.scratch','final-snapshot-ready'),'ready')
  }
  return result
 },close:async()=>{await guard.close();event(root,'guard-close')}}
}
`
const omittedExecutionAdapter = `
import {appendFileSync} from 'node:fs'
import {runBoundedCommand as original} from './controlled-original-bounded.mjs'
export * from './controlled-original-bounded.mjs'
let omitted=false;
export const runBoundedCommand=async options=>{
 if(!omitted&&options.args?.[1]==='typecheck'){
  omitted=true;appendFileSync('.scratch/events','omitted-checker-obligation\\n');
  return {exitCode:0,output:'',gateObligationId:'omitted-no-receipt'}
 }
 return original(options)
}
`

const fixture = ({ omitObligation = false, publicationCrashes = false, realObservation = false } = {}) => {
  const root = mkdtempSync(join(tmpdir(), "dalph-formal-dispatch-"))
  const git = (...args) => {
    const result = spawnSync("git", args, { cwd: root, encoding: "utf8" })
    assert.equal(result.status, 0, result.stderr)
    return result.stdout.trim()
  }
  git("init", "-q")
  cpSync(rootScripts, join(root, "scripts"), { recursive: true })
  if (publicationCrashes) instrumentFixturePublication(root)
  const put = (file, content) => {
    mkdirSync(join(root, file, ".."), { recursive: true })
    writeFileSync(join(root, file), content)
  }
  if (realObservation) {
    put(
      "scripts/controlled-original-formal-input-policy.mjs",
      readFileSync(join(rootScripts, "formal-input-policy.mjs"), "utf8")
    )
    put("scripts/formal-input-policy.mjs", observedInputAdapter)
    const require = createRequire(import.meta.url)
    const acornRoot = dirname(require.resolve("acorn/package.json"))
    cpSync(acornRoot, join(root, "node_modules", "acorn"), { recursive: true })
    const resolverPath = require.resolve("@informalsystems/quint/dist/src/parsing/sourceResolver.js")
    const quintRequire = createRequire(resolverPath)
    put("node_modules/@informalsystems/quint/dist/src/parsing/sourceResolver.js", readFileSync(resolverPath, "utf8"))
    const lexerPath = require.resolve("@informalsystems/quint/dist/src/generated/QuintLexer.js")
    put("node_modules/@informalsystems/quint/dist/src/generated/QuintLexer.js", readFileSync(lexerPath, "utf8"))
    for (const dependency of ["eol", "@sweet-monads/either", "antlr4ts"]) {
      let packageRoot = dirname(quintRequire.resolve(dependency))
      while (!existsSync(join(packageRoot, "package.json"))) {
        assert.notEqual(packageRoot, dirname(packageRoot), `Cannot identify installed fixture dependency ${dependency}`)
        packageRoot = dirname(packageRoot)
      }
      cpSync(packageRoot, join(root, "node_modules", dependency), { recursive: true })
    }
    for (const command of createQuintEffectiveProfile({ purpose: "local-guarded" }).commands)
      for (const argument of command.args) if (argument.endsWith(".qnt")) put(argument, "module fixture {}\n")
    put("pnpm-lock.yaml", "lockfileVersion: '9.0'\n")
    put("pnpm-workspace.yaml", "packages: []\n")
    put(".github/workflows/ci.yml", "name: controlled\n")
    mkdirSync(root + "-tools", { recursive: true })
    writeFileSync(join(root + "-tools", "runtime.so"), "identified external tool")
    writeFileSync(join(root + "-tools", "overflow-peer.so"), "identified peer tool")
  } else put("scripts/formal-input-policy.mjs", inputAdapter)
  if (omitObligation) {
    // Only the disposable installed execution boundary is altered. Canonical
    // expected105 profile and production evidence/publication stay unchanged.
    put("scripts/controlled-original-bounded.mjs", readFileSync(join(rootScripts, "run-bounded-command.mjs"), "utf8"))
    put("scripts/run-bounded-command.mjs", omittedExecutionAdapter)
  }
  put("scripts/quint-owned-server.mjs", serverAdapter)
  put(
    "fake-java.cjs",
    `#!${process.execPath}\nrequire("fs").writeFileSync(process.env.DALPH_FIXTURE_SERVER_READY,"ready");setInterval(()=>{},1000)\n`
  )
  chmodSync(join(root, "fake-java.cjs"), 0o755)
  put(
    "node_modules/@informalsystems/quint/package.json",
    JSON.stringify({ name: "@informalsystems/quint", version: "0.32.0" })
  )
  put("node_modules/@informalsystems/quint/dist/src/cli.js", checkerAdapter)
  put(
    "node_modules/@informalsystems/quint/dist/src/rust/binaryManager.js",
    "exports.QUINT_EVALUATOR_VERSION='fixture';exports.getRustEvaluatorPath=()=>{throw Error('unexpected preparation')}"
  )
  put("package.json", JSON.stringify({ type: "module" }))
  put(".gitignore", ".scratch/\nnode_modules/\n.quint/\n")
  put(".quint/evaluator", "controlled evaluator bytes")
  put(".quint/apalache-dist-0.56.1/apalache/lib/apalache.jar", "controlled prepared jar")
  put("formal-input", "accepted formal fixture")
  put(".scratch/events", "")
  put(".scratch/control.json", JSON.stringify({ fail: false, hold: false }))
  git("add", ".")
  git("-c", "user.name=Fixture", "-c", "user.email=fixture@example.invalid", "commit", "-qm", "base")
  const base = git("rev-parse", "HEAD")
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
  const location = repositoryLocation(root)
  const events = () =>
    readFileSync(join(root, ".scratch", "events"), "utf8")
      .trim()
      .split("\n")
      .filter(Boolean)
  const controls = (settings) => put(".scratch/control.json", JSON.stringify({ fail: false, hold: false, ...settings }))
  const saved = (excludedAttemptId) => {
    const pointer = readdirSync(join(location.custodyRoot, "formal"))
      .filter((file) => file.endsWith(".json"))
      .map((file) => readRecord(join(location.custodyRoot, "formal", file)))
      .find((item) => readRecord(item.recordPath).worktree === root && item.attemptId !== excludedAttemptId)
    assert.ok(pointer)
    return { pointer, success: readRecord(pointer.recordPath) }
  }
  return {
    root,
    git,
    base,
    location,
    events,
    controls,
    saved,
    put,
    cleanup: () => {
      rmSync(root, { recursive: true, force: true })
      rmSync(root + "-tools", { recursive: true, force: true })
    }
  }
}
const launch = (
  f,
  {
    environment: environmentOverrides = {},
    force = false,
    gateArguments = [],
    gateFile = "run-formal-gate.mjs",
    nested = false,
    reaped = false,
    slots
  } = {}
) => {
  const environment = withoutInheritedCustody(process.env)
  for (const name of ["DALPH_QUALIFICATION_ENV_CAPTURE", "DALPH_RUN_REAL_CODEX_QUALIFICATION", "npm_execpath"])
    delete environment[name]
  if (slots !== undefined) environment.DALPH_GATE_SLOTS = String(slots)
  environment.DALPH_COVERAGE_BASE_SHA = f.base
  environment.QUINT_HOME = join(f.root, ".quint")
  Object.assign(environment, environmentOverrides)
  const wrapper = join(f.root, "scripts", "with-gate-slot.mjs")
  const gate = join(f.root, "scripts", gateFile)
  const arguments_ = [
    wrapper,
    "--",
    process.execPath,
    ...(nested ? [wrapper, "--", process.execPath] : []),
    gate,
    ...(force ? ["--force"] : []),
    ...gateArguments
  ]
  const harness = `import ctypes, os, subprocess, sys
assert ctypes.CDLL(None).prctl(36,1,0,0,0)==0, 'Linux subreaper unavailable'
p=subprocess.Popen(sys.argv[1:])
code=p.wait()
while True:
    try: os.waitpid(-1,0)
    except ChildProcessError: break
sys.exit(code)
`
  const child = spawn(
    reaped ? "python3" : process.execPath,
    reaped ? ["-c", harness, process.execPath, ...arguments_] : arguments_,
    { cwd: f.root, env: environment, stdio: ["ignore", "pipe", "pipe"] }
  )
  let stdout = ""
  let stderr = ""
  child.stdout.on("data", (chunk) => {
    stdout += chunk
  })
  child.stderr.on("data", (chunk) => {
    stderr += chunk
  })
  const completion = new Promise((resolve, reject) => {
    child.once("error", reject)
    child.once("close", (code, signal) => resolve({ code, signal, stdout, stderr }))
  })
  return { child, completion, output: () => ({ stdout, stderr }) }
}

test("standalone formal entry stabilizes PATH before its guarded workflow child", async () => {
  const f = fixture()
  try {
    const home = join(f.root, "codex-home")
    const shim = join(home, ".codex", "tmp", "arg0", "codex-arg0Cd34Ef")
    mkdirSync(shim, { recursive: true })
    writeFileSync(join(shim, ".lock"), "controlled shim\n")
    f.put(
      "scripts/run-formal-workflow.mjs",
      `import {writeFileSync} from 'node:fs';import {pathToFileURL} from 'node:url';export const parseFormalArguments=args=>{if(args.length)throw Error('unexpected argument')};if(process.argv[1]&&pathToFileURL(process.argv[1]).href===import.meta.url)writeFileSync('.scratch/formal-entry.json',JSON.stringify({path:process.env.PATH,identity:{environmentPath:process.env.PATH}}));`
    )
    const result = await launch(f, { environment: { HOME: home, PATH: `${shim}:/usr/local/bin:/usr/bin:/bin` } })
      .completion
    assert.equal(result.code, 0, result.stderr)
    const observation = JSON.parse(readFileSync(join(f.root, ".scratch", "formal-entry.json"), "utf8"))
    assert.equal(observation.path.includes("/.codex/tmp/arg0/"), false)
    assert.equal(observation.identity.environmentPath, observation.path)
  } finally {
    f.cleanup()
  }
})

test(
  "standalone formal entry gives actual formal identity and checker child one stabilized PATH",
  { timeout: 90000 },
  async () => {
    const f = fixture({ realObservation: true })
    try {
      const home = join(f.root, "codex-home")
      const shim = join(home, ".codex", "tmp", "arg0", "codex-arg0Kl78Mn")
      mkdirSync(shim, { recursive: true })
      writeFileSync(join(shim, ".lock"), "controlled shim\n")
      const result = await launch(f, { environment: { HOME: home, PATH: `${shim}:/usr/local/bin:/usr/bin:/bin` } })
        .completion
      assert.equal(result.code, 0, result.stderr)
      const childPath = readFileSync(join(f.root, ".scratch", "checker-path"), "utf8")
      assert.equal(childPath.includes("/.codex/tmp/arg0/"), false)
      assert.equal(f.saved().success.identity.environmentDigests.PATH.digest, digest(childPath))
    } finally {
      f.cleanup()
    }
  }
)

test("standalone formal entry refuses a shim-supplied Java before launching its workflow child", async () => {
  const f = fixture()
  try {
    const home = join(f.root, "codex-home")
    const shim = join(home, ".codex", "tmp", "arg0", "codex-arg0Gh56Ij")
    mkdirSync(shim, { recursive: true })
    writeFileSync(join(shim, "java"), "#!/bin/sh\nexit 0\n", { mode: 0o755 })
    f.put(
      "scripts/run-formal-workflow.mjs",
      `import {writeFileSync} from 'node:fs';import {pathToFileURL} from 'node:url';export const parseFormalArguments=()=>{};if(process.argv[1]&&pathToFileURL(process.argv[1]).href===import.meta.url)writeFileSync('.scratch/forbidden-formal-child','launched')`
    )
    const result = await launch(f, { environment: { HOME: home, PATH: `${shim}:/usr/local/bin:/usr/bin:/bin` } })
      .completion
    assert.equal(result.code, 1)
    assert.match(result.stderr, /declared tool resolution changes: java/u)
    assert.equal(existsSync(join(f.root, ".scratch", "forbidden-formal-child")), false)
  } finally {
    f.cleanup()
  }
})
const waitForFile = async (file, process_) => {
  if (existsSync(file)) return
  await new Promise((resolve, reject) => {
    const observer = watch(join(file, ".."), () => {
      if (existsSync(file)) {
        observer.close()
        resolve()
      }
    })
    if (existsSync(file)) {
      observer.close()
      resolve()
    }
    process_.completion.then((result) => {
      observer.close()
      reject(new Error(`Formal child stopped before readiness: ${result.stderr}`))
    })
  })
}
const waitForStderr = async (process_, expected) => {
  if (process_.output().stderr.includes(expected)) return
  await new Promise((resolve, reject) => {
    const observe = () => {
      if (process_.output().stderr.includes(expected)) {
        process_.child.stderr.off("data", observe)
        resolve()
      }
    }
    process_.child.stderr.on("data", observe)
    process_.completion.then(() => {
      process_.child.stderr.off("data", observe)
      reject(new Error(`Process stopped before ${expected}`))
    })
  })
}

test(
  "records complete formal success only after obligations and terminal evidence then reuses the original without launches",
  { timeout: 120000 },
  async () => {
    const f = fixture()
    try {
      const first = await launch(f).completion
      assert.equal(first.code, 0, first.stderr)
      assert.match(first.stdout, /complete profile passed/)
      const original = f.saved()
      const report = readRecord(original.success.execution.reportPath)
      assert.equal(report.profileResult.commands.length, 105)
      assert.deepEqual(report.profileResult.profile, createQuintEffectiveProfile({ purpose: "local-guarded" }))
      const firstEvents = f.events()
      assert.equal(firstEvents.filter((event) => event.startsWith("checker ")).length, 105)
      assert.equal(firstEvents.filter((event) => event === "server-start").length, 1)
      assert.ok(firstEvents.indexOf("guard-start") < firstEvents.indexOf("server-start"))
      assert.ok(firstEvents.indexOf("server-stopped") < firstEvents.indexOf("guard-finish"))
      for (const command of report.profileResult.commands) {
        const receipt = readRecord(join(original.success.runDirectory, "receipts", `${command.obligationId}.json`))
        assert.equal(receipt.outcome, "passed")
        assert.equal(receipt.groupAbsent, true)
      }
      const second = await launch(f).completion
      assert.equal(second.code, 0, second.stderr)
      assert.match(second.stdout, /zero checkers or servers started/)
      assert.deepEqual(f.saved(), original)
      assert.equal(f.events().filter((event) => event.startsWith("checker ")).length, 105)
      assert.equal(f.events().filter((event) => event === "server-start").length, 1)
      assert.equal(f.saved().success.finishedAt, original.success.finishedAt)
    } finally {
      f.cleanup()
    }
  }
)

test(
  "unrelated test-only repair reuses complete formal success with zero checker or server launches",
  { timeout: 120000 },
  async () => {
    const f = fixture({ realObservation: true })
    try {
      const first = await launch(f).completion
      assert.equal(first.code, 0, first.stderr)
      const checkerCount = f.events().filter((event) => event.startsWith("checker ")).length
      const serverCount = f.events().filter((event) => event === "server-start").length
      assert.equal(checkerCount, 105)
      assert.equal(serverCount, 1)
      f.put("scripts/unrelated-repair.test.mjs", "assert.equal(actual, corrected)\n")
      const second = await launch(f).completion
      assert.equal(second.code, 0, second.stderr)
      assert.match(second.stdout, /zero checkers or servers started/u)
      assert.equal(f.events().filter((event) => event.startsWith("checker ")).length, checkerCount)
      assert.equal(f.events().filter((event) => event === "server-start").length, serverCount)
    } finally {
      f.cleanup()
    }
  }
)

test(
  "waits then rereads without duplicate formal launches and nested inherited admission does not deadlock",
  { timeout: 120000 },
  async () => {
    const f = fixture()
    try {
      f.controls({ hold: true })
      const first = launch(f)
      await waitForFile(join(f.root, ".scratch", "checker-ready"), first)
      const second = launch(f, { nested: true })
      await waitForStderr(second, "waiting for worktree writer")
      assert.equal(f.events().filter((event) => event === "server-start").length, 1)
      f.put(".scratch/release", "release")
      const [firstResult, secondResult] = await Promise.all([first.completion, second.completion])
      assert.equal(firstResult.code, 0, firstResult.stderr)
      assert.equal(secondResult.code, 0, secondResult.stderr)
      assert.match(secondResult.stdout, /zero checkers or servers started/)
      assert.equal(f.events().filter((event) => event.startsWith("checker ")).length, 105)
      assert.equal(f.events().filter((event) => event === "server-start").length, 1)
    } finally {
      f.cleanup()
    }
  }
)

test(
  "failed force prevents fallback to older success and retry runs every obligation",
  { timeout: 120000 },
  async () => {
    const f = fixture()
    try {
      const first = await launch(f).completion
      assert.equal(first.code, 0, first.stderr)
      const original = f.saved()
      f.controls({ fail: true })
      const forced = await launch(f, { force: true }).completion
      assert.equal(forced.code, 1)
      assert.match(forced.stderr, /controlled checker failure/)
      const failed = f.saved()
      assert.equal(failed.pointer.state, "started")
      assert.notEqual(failed.pointer.attemptId, original.pointer.attemptId)
      assert.equal(readRecord(original.success.recordPath).state, "passed")
      const afterFailure = f.events().filter((event) => event.startsWith("checker ")).length
      assert.equal(afterFailure, 106)
      f.controls({})
      const retry = await launch(f).completion
      assert.equal(retry.code, 0, retry.stderr)
      assert.match(retry.stdout, /running complete profile/)
      assert.equal(f.events().filter((event) => event.startsWith("checker ")).length, afterFailure + 105)
      assert.notEqual(f.saved().pointer.attemptId, original.pointer.attemptId)
    } finally {
      f.cleanup()
    }
  }
)

test(
  "unresolved worktree custody refuses the actual formal dispatch before any preparation or checker",
  { timeout: 15000 },
  async () => {
    const f = fixture()
    try {
      atomicRecord(f.location.worktreeFence, { version: 1, runId: "unresolved-fixture", worktree: f.root })
      const result = await launch(f).completion
      assert.equal(result.code, 1)
      assert.match(result.stderr, /requires reconciliation of gate run unresolved-fixture; no writer launched/)
      assert.deepEqual(f.events(), [])
      assert.equal(existsSync(join(f.location.custodyRoot, "formal")), false)
    } finally {
      f.cleanup()
    }
  }
)

test(
  "corrupted required evidence launches the whole profile while a missing optional console log preserves reuse",
  { timeout: 120000 },
  async () => {
    const f = fixture()
    try {
      const first = await launch(f).completion
      assert.equal(first.code, 0, first.stderr)
      const original = f.saved()
      const report = readRecord(original.success.execution.reportPath)
      const optionalLog = join(
        f.root,
        ".scratch",
        "quality-gates",
        original.success.runId,
        "logs",
        `${report.profileResult.commands[0].obligationId}.log`
      )
      assert.equal(existsSync(optionalLog), true)
      rmSync(optionalLog)
      const warm = await launch(f).completion
      assert.equal(warm.code, 0, warm.stderr)
      assert.match(warm.stdout, /zero checkers or servers started/)
      assert.equal(f.events().filter((event) => event.startsWith("checker ")).length, 105)
      assert.deepEqual(f.saved(), original)
      writeFileSync(original.success.execution.reportPath, "{")
      const fresh = await launch(f).completion
      assert.equal(fresh.code, 0, fresh.stderr)
      assert.match(fresh.stdout, /running complete profile/)
      assert.equal(f.events().filter((event) => event.startsWith("checker ")).length, 210)
      assert.equal(f.events().filter((event) => event === "server-start").length, 2)
      assert.notEqual(f.saved().pointer.attemptId, original.pointer.attemptId)
    } finally {
      f.cleanup()
    }
  }
)

test(
  "different worktrees obey clone capacity and execute separate complete profiles without sharing success or servers",
  { timeout: 120000 },
  async () => {
    const f = fixture()
    const linkedRoot = `${f.root}-linked`
    try {
      f.git("worktree", "add", "-q", "-b", "linked-fixture", linkedRoot, "HEAD")
      cpSync(join(f.root, "node_modules"), join(linkedRoot, "node_modules"), { recursive: true })
      cpSync(join(f.root, ".quint"), join(linkedRoot, ".quint"), { recursive: true })
      mkdirSync(join(linkedRoot, ".scratch"))
      writeFileSync(join(linkedRoot, ".scratch", "events"), "")
      writeFileSync(join(linkedRoot, ".scratch", "control.json"), JSON.stringify({ fail: false, hold: false }))
      const linked = {
        ...f,
        root: linkedRoot,
        location: repositoryLocation(linkedRoot),
        events: () =>
          readFileSync(join(linkedRoot, ".scratch", "events"), "utf8")
            .trim()
            .split("\n")
            .filter(Boolean)
      }
      assert.equal(linked.location.commonDirectory, f.location.commonDirectory)
      f.controls({ hold: true })
      const first = launch(f, { slots: 1 })
      await waitForFile(join(f.root, ".scratch", "checker-ready"), first)
      const second = launch(linked, { slots: 1 })
      await waitForStderr(second, "waiting; holders:")
      assert.deepEqual(linked.events(), [])
      assert.equal(f.events().filter((event) => event === "server-start").length, 1)
      f.put(".scratch/release", "release")
      const [firstResult, secondResult] = await Promise.all([first.completion, second.completion])
      assert.equal(firstResult.code, 0, firstResult.stderr)
      assert.equal(secondResult.code, 0, secondResult.stderr)
      assert.match(secondResult.stdout, /running complete profile/)
      assert.equal(f.events().filter((event) => event.startsWith("checker ")).length, 105)
      assert.equal(linked.events().filter((event) => event.startsWith("checker ")).length, 105)
      assert.equal(linked.events().filter((event) => event === "server-start").length, 1)
      const pointers = readdirSync(join(f.location.custodyRoot, "formal")).map((file) =>
        readRecord(join(f.location.custodyRoot, "formal", file))
      )
      assert.equal(pointers.length, 2)
      const successes = pointers.map((pointer) => readRecord(pointer.recordPath))
      assert.deepEqual(new Set(successes.map((success) => success.worktree)), new Set([f.root, linkedRoot]))
      assert.equal(new Set(successes.map((success) => success.runId)).size, 2)
      const serverIds = successes.map((success) => readRecord(success.execution.reportPath).serverEvidence.obligationId)
      assert.equal(new Set(serverIds).size, 2)
    } finally {
      if (existsSync(linkedRoot)) f.git("worktree", "remove", "--force", linkedRoot)
      f.cleanup()
    }
  }
)

// Only the disposable copy wraps real publication operations. Production files,
// temp-file creation/fsync/rename ordering, publication data and receipt writes
// remain unchanged. No production command or environment accepts this hook.
const instrumentFixturePublication = (root) => {
  const recordsPath = join(root, "scripts", "gate-custody-records.mjs")
  let source = readFileSync(recordsPath, "utf8")
  const hook = `
const fixturePublicationBoundary=(path,value,phase,temporary)=>{
 if(value.state!=='passed')return
 let control;try{control=JSON.parse(readFileSync(join(process.cwd(),'.scratch','crash-control.json'),'utf8'))}catch(error){if(error.code==='ENOENT')return;throw error}
 const target=phase==='before'?path.includes('/formal-attempts/'):path.includes('/formal/')
 if(control.phase!==phase||!target)return
 const ready=join(process.cwd(),'.scratch','crash-ready.json')
 writeFileSync(ready+'.tmp',JSON.stringify({version:1,workflowPid:process.pid,runId:process.env.DALPH_GATE_RUN_ID,path,phase,temporary}))
 renameSync(ready+'.tmp',ready)
 process.kill(process.pid,'SIGSTOP')
}
`
  assert.ok(source.includes("export const atomicRecord = (path, value) => {"))
  source = source.replace(
    "export const atomicRecord = (path, value) => {",
    `${hook}\nexport const atomicRecord = (path, value) => {\n  fixturePublicationBoundary(path,value,"before")`
  )
  assert.ok(source.includes("  renameSync(temporary, path)"))
  source = source.replace(
    "  renameSync(temporary, path)",
    '  fixturePublicationBoundary(path,value,"during",temporary)\n  renameSync(temporary, path)'
  )
  const end = "    closeSync(directory)\n  }\n}\nexport const readRecord"
  assert.ok(source.includes(end))
  source = source.replace(
    end,
    '    closeSync(directory)\n  }\n  fixturePublicationBoundary(path,value,"after")\n}\nexport const readRecord'
  )
  writeFileSync(recordsPath, source)
}
const killFixturePublication = (f, barrier) => {
  const runDirectory = join(f.location.custodyRoot, "runs", barrier.runId)
  const run = readRecord(join(runDirectory, "run.json"))
  const obligations = readdirSync(join(runDirectory, "obligations")).map((file) =>
    readRecord(join(runDirectory, "obligations", file))
  )
  const workflow = obligations.find((item) => item.command.name === "guarded formal workflow")
  const command = obligations.find((item) => item.command.name === "admitted gate command")
  assert.ok(workflow)
  assert.ok(command)
  assert.equal(workflow.processGroup, barrier.workflowPid)
  for (const [pid, expectedScript] of [
    [run.ownerPid, "run-admitted-gate.mjs"],
    [workflow.processGroup, "run-formal-workflow.mjs"],
    [command.processGroup, "run-formal-gate.mjs"]
  ]) {
    assert.ok(readFileSync(`/proc/${pid}/cmdline`, "utf8").includes(join(f.root, "scripts", expectedScript)))
  }
  // The coordinator dies first, retaining its genuine unresolved fences. Then
  // stop only the two recorded live fixture writers, which the subreaper reaps.
  for (const target of [run.ownerPid, -workflow.processGroup, -command.processGroup]) {
    try {
      process.kill(target, "SIGKILL")
    } catch (error) {
      if (error.code !== "ESRCH") throw error
    }
  }
  return { run, runDirectory }
}

test(
  "publication crashes before during and after durable rename accept only complete stopped evidence after reconciliation",
  { timeout: 300000 },
  async () => {
    const f = fixture({ publicationCrashes: true })
    let active
    let crashed
    try {
      const first = await launch(f, { reaped: true }).completion
      assert.equal(first.code, 0, first.stderr)
      let previous = f.saved()
      for (const phase of ["before", "during", "after"]) {
        const beforeCount = f.events().filter((event) => event.startsWith("checker ")).length
        f.put(".scratch/crash-control.json", JSON.stringify({ phase }))
        rmSync(join(f.root, ".scratch", "crash-ready.json"), { force: true })
        active = launch(f, { force: true, reaped: true })
        await waitForFile(join(f.root, ".scratch", "crash-ready.json"), active)
        const barrier = readRecord(join(f.root, ".scratch", "crash-ready.json"))
        assert.equal(barrier.phase, phase)
        assert.equal(f.events().filter((event) => event.startsWith("checker ")).length, beforeCount + 105)
        const atPublication = f.saved()
        assert.notEqual(atPublication.pointer.attemptId, previous.pointer.attemptId)
        assert.equal(atPublication.pointer.state, phase === "after" ? "passed" : "started")
        if (phase === "during") {
          assert.equal(readRecord(barrier.temporary).state, "passed")
          assert.equal(readRecord(barrier.path).state, "started")
        }
        assert.equal(readRecord(previous.success.recordPath).state, "passed")
        crashed = killFixturePublication(f, barrier)
        const killed = await active.completion
        active = undefined
        assert.equal(killed.code, 1)
        assert.equal(existsSync(crashed.run.worktreeFence), true)
        assert.equal(existsSync(crashed.run.slotFence), true)
        const rejected = await launch(f).completion
        assert.equal(rejected.code, 1)
        assert.match(rejected.stderr, /requires reconciliation/)
        assert.equal(f.events().filter((event) => event.startsWith("checker ")).length, beforeCount + 105)
        const reconcile = spawnSync(
          process.execPath,
          [join(f.root, "scripts", "reconcile-gate-run.mjs"), crashed.run.runId],
          { cwd: f.root, env: withoutInheritedCustody(process.env), encoding: "utf8", timeout: 15000 }
        )
        assert.equal(reconcile.status, 0, reconcile.stderr)
        assert.deepEqual(JSON.parse(reconcile.stdout), {
          runId: crashed.run.runId,
          custody: "stopped",
          qualification: "UNPROVEN"
        })
        assert.equal(readRecord(join(crashed.runDirectory, "reconciled.json")).custody, "stopped")
        assert.equal(existsSync(crashed.run.worktreeFence), false)
        assert.equal(existsSync(crashed.run.slotFence), false)
        f.put(".scratch/crash-control.json", JSON.stringify({ phase: "disabled" }))
        const retried = await launch(f, { reaped: true }).completion
        assert.equal(retried.code, 0, retried.stderr)
        if (phase === "after") {
          assert.match(retried.stdout, /zero checkers or servers started/)
          assert.deepEqual(f.saved(), atPublication)
          assert.equal(f.events().filter((event) => event.startsWith("checker ")).length, beforeCount + 105)
        } else {
          assert.match(retried.stdout, /running complete profile/)
          assert.notEqual(f.saved().pointer.attemptId, atPublication.pointer.attemptId)
          assert.equal(f.events().filter((event) => event.startsWith("checker ")).length, beforeCount + 210)
        }
        previous = f.saved()
        crashed = undefined
      }
    } finally {
      if (active !== undefined) {
        const ready = join(f.root, ".scratch", "crash-ready.json")
        if (existsSync(ready)) killFixturePublication(f, readRecord(ready))
        await active.completion
      }
      f.cleanup()
    }
  }
)

// S4/S8/S12/S14: the real quality workflow acquires genuine controlled formal
// receipts after preflight, always crosses that boundary on resume, and retains
// mandatory verdict bytes independently of exact optional diagnostic logs.
test("quality handoff retains formal evidence through application checks, warm execution and full-prefix resume", async () => {
  const f = fixture()
  try {
    f.put(
      "scripts/controlled-quality.mjs",
      `
import {appendFileSync,readFileSync,writeFileSync} from 'node:fs';import {join} from 'node:path';
import {executeResumableQualityGate} from './gate-quality-run.mjs';import {runBoundedCommand} from './run-bounded-command.mjs';
const sources=["require('fs').appendFileSync('.scratch/events','preflight\\\\n')","require('fs').appendFileSync('.scratch/events','application-check\\\\n');if(require('fs').existsSync('.scratch/mutate-formal'))require('fs').writeFileSync('formal-input','changed after formal')"];
const manifest=sources.map((source,ordinal)=>({id:['preflight','application-check'][ordinal],name:['preflight','application-check'][ordinal],boundary:ordinal===0?'preflight':'qualification',args:[source],timeout:10000,artifactRoots:[],execution:{executable:process.execPath,args:['-e',source],cwd:process.cwd(),name:['preflight','application-check'][ordinal],timeoutMilliseconds:10000,acceptedExitCodes:[0],relayParentSignals:false,terminationGraceMilliseconds:5000,processGroupAbsenceTimeoutMilliseconds:2000}}));
const logicalInvocation={mode:'check:all',commandArguments:[process.execPath,process.argv[1]],baseSha:${JSON.stringify(f.base)},stageManifest:manifest,toolExecutables:[]};
await executeResumableQualityGate({logicalInvocation,stageManifest:manifest,resumeRunId:process.argv[2]?.slice('--resume='.length),prepareFreshInputs:()=>{},
startGuard:async({logicalInvocation})=>{const identity={version:2,observerVersion:1,inputDigest:'controlled-quality',sourceInputDigest:'controlled-source',logicalInvocation};return {identity,assertUnchanged:async()=>{},protectArtifacts:async()=>{},finish:async()=>({version:1,observerVersion:1,ready:true,drained:true,unchanged:true,inputDigest:identity.inputDigest,sourceInputDigest:identity.sourceInputDigest}),close:async()=>{}}},
runStage:stage=>runBoundedCommand({executable:process.execPath,args:['-e',stage.args[0]],name:stage.name,timeoutMilliseconds:10000})});
`
    )
    const quality = (resume) =>
      launch(f, { gateFile: "controlled-quality.mjs", gateArguments: resume ? [`--resume=${resume}`] : [] }).completion
    const qualityRecords = () =>
      readdirSync(join(f.location.custodyRoot, "runs"))
        .map((runId) => ({ runId, runDirectory: join(f.location.custodyRoot, "runs", runId) }))
        .filter(({ runDirectory }) => existsSync(join(runDirectory, "composite.json")))
        .map((item) => ({ ...readRunEvidence(item), runDirectory: item.runDirectory }))
    const fresh = await quality()
    assert.equal(fresh.code, 0, fresh.stderr)
    const original = qualityRecords()[0]
    assert.equal(original.resume.complete, true)
    assert.equal(original.resume.formal.disposition, "executed")
    assert.equal(f.events().filter((event) => event.startsWith("checker ")).length, 105)
    assert.ok(f.events().indexOf("preflight") < f.events().indexOf("server-start"))
    assert.ok(f.events().indexOf("server-stopped") < f.events().indexOf("application-check"))
    f.put("unrelated-app", "ordinary application edit")
    const warm = await quality()
    assert.equal(warm.code, 0, warm.stderr)
    assert.equal(f.events().filter((event) => event.startsWith("checker ")).length, 105)
    assert.equal(f.events().filter((event) => event === "application-check").length, 2)
    const resumed = await quality(original.runId)
    assert.equal(resumed.code, 0, resumed.stderr)
    const all = qualityRecords()
    const fullResume = all.find(
      (record) =>
        record.runId !== original.runId && record.resume.composite.entries.every((entry) => entry.kind === "reused")
    )
    assert.ok(fullResume)
    assert.equal(fullResume.resume.formal.disposition, "reused")
    assert.equal(fullResume.resume.formal.recordPath, original.resume.formal.recordPath)
    assert.equal(fullResume.resume.complete, true)
    assert.equal(f.events().filter((event) => event === "application-check").length, 2)
    const report = readRecord(f.saved().success.execution.reportPath)
    const optional = original.stages.find(
      (stage) => stage.obligationId === report.profileResult.commands[0].obligationId
    )
    rmSync(optional.logPath)
    assert.equal(readRunEvidence({ runDirectory: original.runDirectory, runId: original.runId }).resume.complete, true)
    const mandatory = original.stages.find((stage) => stage.command.name === "application-check")
    const bytes = readFileSync(mandatory.logPath)
    rmSync(mandatory.logPath)
    assert.throws(
      () => readRunEvidence({ runDirectory: original.runDirectory, runId: original.runId }),
      /quality stage verdict/u
    )
    writeFileSync(mandatory.logPath, bytes)
    const prior = f.saved()
    atomicRecord(
      prior.pointer.pointerPath ??
        join(
          f.location.custodyRoot,
          "formal",
          readdirSync(join(f.location.custodyRoot, "formal")).find((file) => file.endsWith(".json"))
        ),
      { ...prior.pointer, state: "started" }
    )
    const invalidatedResume = await quality(original.runId)
    assert.equal(invalidatedResume.code, 0, invalidatedResume.stderr)
    assert.equal(readRunEvidence({ runDirectory: original.runDirectory, runId: original.runId }).resume.complete, true)
    assert.equal(f.events().filter((event) => event.startsWith("checker ")).length, 210)
    assert.equal(f.events().filter((event) => event === "application-check").length, 2)
    // S12: a real failed checker child at the mandatory formal boundary
    // rejects this handoff before any application check launch.
    const latest = f.saved()
    atomicRecord(latest.success.pointerPath, { ...latest.pointer, state: "started" })
    f.controls({ fail: true })
    const failedFormal = await quality()
    assert.equal(failedFormal.code, 1)
    assert.match(failedFormal.stderr, /controlled checker failure/u)
    assert.ok(f.events().filter((event) => event.startsWith("checker ")).length > 210)
    assert.equal(f.events().filter((event) => event === "application-check").length, 2)
    f.controls({ fail: false })
    f.put(".scratch/mutate-formal", "trigger")
    const mutation = await quality()
    assert.equal(mutation.code, 1)
    assert.match(mutation.stderr, /fixture input changed/u)
  } finally {
    f.cleanup()
  }
})

// S1/#362 omission: actual installed execution adapter leaves exactly one
// command without a process/receipt. Complete canonical profile stays105.
test("an omitted actual checker obligation cannot publish complete formal success", { timeout: 90000 }, async () => {
  const f = fixture({ omitObligation: true })
  try {
    const result = await launch(f).completion
    assert.equal(result.code, 1, result.stdout + result.stderr)
    assert.match(result.stderr, /Missing or duplicate formal checker receipt/u)
    assert.equal(f.events().filter((event) => event.startsWith("checker ")).length, 104)
    assert.equal(f.events().filter((event) => event === "omitted-checker-obligation").length, 1)
    assert.equal(f.events().filter((event) => event === "server-start").length, 1)
    assert.equal(f.events().filter((event) => event === "server-stopped").length, 1)
    assert.equal(f.saved().pointer.state, "started")
    assert.equal(f.saved().success.state, "started")
  } finally {
    f.cleanup()
  }
})

// S5: unchanged advertised package version cannot hide changed installed bytes.
test(
  "same-version installed checker bytes invalidate actual reuse and run every obligation",
  { timeout: 120000 },
  async () => {
    const f = fixture({ realObservation: true })
    try {
      const fresh = await launch(f).completion
      assert.equal(fresh.code, 0, fresh.stderr)
      const original = f.saved()
      const packageFile = join(f.root, "node_modules/@informalsystems/quint/package.json")
      const packageBytes = readFileSync(packageFile)
      const checker = join(f.root, "node_modules/@informalsystems/quint/dist/src/cli.js")
      writeFileSync(checker, readFileSync(checker, "utf8") + "\n// changed installed bytes under the same version\n")
      const changed = await launch(f).completion
      assert.equal(changed.code, 0, changed.stderr)
      assert.match(changed.stdout, /running complete profile/u)
      assert.deepEqual(readFileSync(packageFile), packageBytes)
      assert.equal(JSON.parse(packageBytes).version, "0.32.0")
      assert.equal(f.events().filter((event) => event.startsWith("checker ")).length, 210)
      assert.equal(f.events().filter((event) => event === "server-start").length, 2)
      const next = f.saved(original.pointer.attemptId)
      assert.notEqual(next.pointer.attemptId, original.pointer.attemptId)
      assert.notEqual(next.success.identity.inputDigest, original.success.identity.inputDigest)
      assert.equal(readRecord(next.success.execution.reportPath).profileResult.commands.length, 105)
      const warm = await launch(f).completion
      assert.equal(warm.code, 0, warm.stderr)
      assert.match(warm.stdout, /zero checkers or servers started/u)
      assert.equal(f.events().filter((event) => event.startsWith("checker ")).length, 210)
      assert.deepEqual(f.saved(original.pointer.attemptId), next)
    } finally {
      f.cleanup()
    }
  }
)

// S7: pause is the existing native observer control, not a simulated dirty
// verdict. The real kernel queue is overflowed without changing sysctl policy.
test("native observer overflow refuses actual warm and fresh qualification", { timeout: 120000 }, async () => {
  const f = fixture({ realObservation: true })
  try {
    const fresh = await launch(f).completion
    assert.equal(fresh.code, 0, fresh.stderr)
    const original = f.saved()
    f.controls({ overflow: true })
    const warm = await launch(f).completion
    assert.equal(warm.code, 1, warm.stdout + warm.stderr)
    assert.match(warm.stderr, /IN_Q_OVERFLOW/u)
    assert.equal(f.events().filter((event) => event.startsWith("checker ")).length, 105)
    assert.equal(f.events().filter((event) => event === "server-start").length, 1)
    assert.deepEqual(f.saved(), original)
    const forced = await launch(f, { force: true }).completion
    assert.equal(forced.code, 1, forced.stdout + forced.stderr)
    assert.match(forced.stderr, /IN_Q_OVERFLOW/u)
    assert.equal(f.events().filter((event) => event.startsWith("checker ")).length, 210)
    assert.equal(f.events().filter((event) => event === "server-start").length, 2)
    assert.equal(f.events().filter((event) => event === "server-stopped").length, 2)
    assert.equal(f.events().filter((event) => event === "native-observer-paused").length, 2)
    assert.equal(f.saved().pointer.state, "started")
  } finally {
    f.cleanup()
  }
})

// S12: production quality retains the real formal observer for declared tool
// roots outside candidate source. Test both stage-time and final-drain races.
test(
  "external tool edit and revert after formal completion rejects actual quality handoff",
  { timeout: 120000 },
  async () => {
    const f = fixture({ realObservation: true })
    try {
      f.put(
        "scripts/controlled-external-quality.mjs",
        `
import {readFileSync,writeFileSync,existsSync,rmSync,appendFileSync} from 'node:fs';import {join} from 'node:path';
import {executeResumableQualityGate} from './gate-quality-run.mjs';import {runBoundedCommand} from './run-bounded-command.mjs';
const sources=["require('fs').appendFileSync('.scratch/events','preflight\\\\n')", "const fs=require('fs');fs.appendFileSync('.scratch/events','application-check\\\\n');if(JSON.parse(fs.readFileSync('.scratch/control.json','utf8')).postFormal==='stage'){const path=process.cwd()+'-tools/runtime.so';const bytes=fs.readFileSync(path);fs.writeFileSync(path,'changed after formal');fs.writeFileSync(path,bytes);fs.appendFileSync('.scratch/events','external-edit-revert-stage\\\\n')}"];
const manifest=sources.map((source,ordinal)=>({id:['preflight','application-check'][ordinal],name:['preflight','application-check'][ordinal],boundary:ordinal===0?'preflight':'qualification',args:[source],timeout:10000,artifactRoots:[],execution:{executable:process.execPath,args:['-e',source],cwd:process.cwd(),name:['preflight','application-check'][ordinal],timeoutMilliseconds:10000,acceptedExitCodes:[0],relayParentSignals:false,terminationGraceMilliseconds:5000,processGroupAbsenceTimeoutMilliseconds:2000}}));
const logicalInvocation={mode:'check:all',commandArguments:[process.execPath,process.argv[1]],baseSha:${JSON.stringify(f.base)},stageManifest:manifest,toolExecutables:[]};
rmSync('.scratch/final-snapshot-ready',{force:true});
await executeResumableQualityGate({logicalInvocation,stageManifest:manifest,prepareFreshInputs:()=>{},
startGuard:async({logicalInvocation})=>{const identity={version:2,observerVersion:1,inputDigest:'controlled-external-quality',sourceInputDigest:'controlled-source',logicalInvocation};return {identity,assertUnchanged:async()=>{
 if(existsSync('.scratch/final-snapshot-ready')){rmSync('.scratch/final-snapshot-ready');const path=process.cwd()+'-tools/runtime.so';const bytes=readFileSync(path);writeFileSync(path,'changed after final formal snapshot');writeFileSync(path,bytes);appendFileSync('.scratch/events','external-edit-revert-final-drain\\n')}
},protectArtifacts:async()=>{},finish:async()=>({version:1,observerVersion:1,ready:true,drained:true,unchanged:true,inputDigest:identity.inputDigest,sourceInputDigest:identity.sourceInputDigest}),close:async()=>{}}},
runStage:stage=>runBoundedCommand({executable:process.execPath,args:['-e',stage.args[0]],name:stage.name,timeoutMilliseconds:10000})});
`
      )
      const quality = () => launch(f, { gateFile: "controlled-external-quality.mjs" }).completion
      const fresh = await quality()
      assert.equal(fresh.code, 0, fresh.stderr)
      const original = f.saved()
      const composites = () =>
        readdirSync(join(f.location.custodyRoot, "runs")).filter((runId) =>
          existsSync(join(f.location.custodyRoot, "runs", runId, "composite.json"))
        )
      assert.equal(composites().length, 1)
      const tool = join(f.root + "-tools", "runtime.so")
      const bytes = readFileSync(tool)
      for (const phase of ["stage", "final-drain"]) {
        f.controls({ postFormal: phase })
        const rejected = await quality()
        assert.equal(rejected.code, 1, rejected.stdout + rejected.stderr)
        assert.match(rejected.stderr, /dirty:.*runtime\.so/u)
        assert.equal(f.events().filter((event) => event.startsWith("checker ")).length, 105)
        assert.equal(f.events().filter((event) => event === "server-start").length, 1)
        assert.deepEqual(readFileSync(tool), bytes)
        assert.deepEqual(f.saved(), original)
        assert.equal(composites().length, 1)
        assert.equal(f.events().filter((event) => event === "external-edit-revert-" + phase).length, 1)
      }
      assert.equal(f.events().filter((event) => event === "application-check").length, 3)
    } finally {
      f.cleanup()
    }
  }
)
