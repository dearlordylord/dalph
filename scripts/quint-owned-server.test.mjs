import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { existsSync, mkdtempSync, watch, readFileSync, readdirSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { test } from "node:test"
import { fileURLToPath } from "node:url"
import { repositoryLocation, wallClockTimestamp, withoutInheritedCustody } from "./gate-custody-records.mjs"
import { runBoundedCommand } from "./run-bounded-command.mjs"
import { disposeOwnedServerFixture, disposeProvenFixture } from "./owned-server-fixture.mjs"
import {
  ownedQuintServerEnvironment,
  quintSocketCanServeOwnedEndpoint,
  validateOwnedQuintJava
} from "./quint-owned-server.mjs"

const wrapper = fileURLToPath(new URL("./with-gate-slot.mjs", import.meta.url))
const helper = new URL("./quint-owned-server.mjs", import.meta.url).href
const inputGuard = new URL("./gate-resume-inputs.mjs", import.meta.url).href
const boundedCommand = new URL("./run-bounded-command.mjs", import.meta.url).href
const custodyModule = new URL("./gate-custody-records.mjs", import.meta.url).href
const fixture = async (mode) => {
  const root = mkdtempSync(join(tmpdir(), "dalph-owned-quint-"))
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
  const server = join(root, "server.mjs")
  writeFileSync(
    server,
    `import {createServer} from 'node:net';
import {mkdirSync,writeFileSync} from 'node:fs';import {join} from 'node:path';
if(${JSON.stringify(mode.startsWith("output-route"))}){
 const outputArgument=process.argv.find(argument=>argument.startsWith('--out-dir='));
 const output=join(outputArgument?outputArgument.slice('--out-dir='.length):'_apalache-out','server','fresh-session');
 mkdirSync(output,{recursive:true});writeFileSync(join(output,'diagnostics.log'),'fresh server diagnostics');
}
const port=Number(process.argv.find(a=>a.startsWith('--port=')).slice(7));
const server=createServer(socket=>{socket.write('owned');socket.on('data',data=>{if(data.toString()==='die'){socket.end();server.close(()=>process.exit(9));}})});
server.listen(port,'127.0.0.1');
process.on('SIGTERM',()=>server.close(()=>process.exit(0)));
`
  )
  const script = join(root, "probe.mjs")
  writeFileSync(
    script,
    `import {withOwnedQuintServer} from ${JSON.stringify(helper)};
import {createServer,connect} from 'node:net';
import {existsSync,writeFileSync} from 'node:fs';
import {startInputGuard} from ${JSON.stringify(inputGuard)};
import {runBoundedCommand} from ${JSON.stringify(boundedCommand)};
import {inheritedCustody} from ${JSON.stringify(custodyModule)};
const mode=${JSON.stringify(mode)};
const ambient=createServer(socket=>socket.end('ambient'));
const ambientHost=mode==='success'?'127.0.0.2':'127.0.0.1';
await new Promise(resolve=>ambient.listen(0,ambientHost,resolve));
const ambientPort=ambient.address().port;
const exchange=(port,message,host='127.0.0.1')=>new Promise((resolve,reject)=>{const socket=connect(port,host);socket.once('error',reject);socket.once('data',data=>{if(message)socket.write(message);else socket.end();resolve(data.toString());});});
let checks=0;
const controller=new AbortController();
const began=Date.now();const phase=name=>console.error(JSON.stringify({phase:name,elapsedMilliseconds:Date.now()-began}));
process.once('SIGTERM',()=>controller.abort(Error('fixture interrupted')));
const boundaries={assertPrerequisites:()=>{if(mode==='prerequisite-failure')throw Error('missing patched owned-server readiness');},readiness:async({port})=>{if(mode==='readiness-timeout')await new Promise(()=>{});if(mode==='readiness-failure')throw Error('fixture reflection refused');if(await exchange(port)!=='owned')throw Error('wrong readiness responder');}};
if(mode==='ownership-failure'||mode==='success')boundaries.reservePort=async()=>ambientPort;
if(mode==='shutdown-failure')boundaries.listeningSockets=()=>[{family:'tcp',address:'fixture',inode:'retained'}];
let result,error,qualification,qualificationError;
if(mode==='output-route-old')boundaries.runBoundedCommand=options=>runBoundedCommand({...options,args:options.args.filter(argument=>!argument.startsWith('--out-dir='))});
phase('guard-start');
const guard=mode.startsWith('output-route')?await startInputGuard({worktree:process.cwd(),effectiveEnvironment:process.env,generatedOutputRoots:[inheritedCustody().run.reportDirectory],logicalInvocation:{mode:'check:all',commandArguments:[process.execPath,process.argv[1]],baseSha:process.env.DALPH_COVERAGE_BASE_SHA,stageManifest:[],toolExecutables:[]}}):undefined;
phase('guard-ready');
try{result=await withOwnedQuintServer({javaExecutable:process.execPath,javaArguments:[${JSON.stringify(server)},mode==='wrong-java-home'?'-Duser.home=/forged':${JSON.stringify("-Duser.home=" + root)}],javaUserHome:mode==='missing-java-home'?undefined:${JSON.stringify(root)},apalacheJar:'fixture-identified-jar',environment:{...process.env,DALPH_QUINT_OWNED_SERVER_ENDPOINT:'caller-forged:8822',DALPH_QUINT_JAVA_EXECUTABLE:'/caller-forged/java',DALPH_QUINT_JAVA_USER_HOME:'/caller-forged/home'},remainingExecutionMilliseconds:()=>mode==='readiness-timeout'?400:5000,terminationGraceMilliseconds:50,processGroupAbsenceTimeoutMilliseconds:1000,boundaries,signal:controller.signal,runProfile:async({serverEndpoint,environment,signal})=>{checks++;if(mode==='busy-interruption'){writeFileSync('busy-ready','ready');const stop=Date.now()+5000;while(!existsSync('interruption-sent')&&Date.now()<stop)Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,10);if(!existsSync('interruption-sent'))throw Error('outer signal handshake missing');await new Promise((resolve,reject)=>{signal.addEventListener('abort',()=>reject(Error('fixture interrupted')),{once:true});});}if(mode==='interruption'){await new Promise((resolve,reject)=>{signal.addEventListener('abort',()=>reject(Error('profile interrupted')),{once:true});controller.abort(Error('fixture interrupted'));});}if(environment.DALPH_QUINT_OWNED_SERVER_ENDPOINT!==serverEndpoint||environment.DALPH_QUINT_JAVA_EXECUTABLE!==process.execPath||environment.DALPH_QUINT_JAVA_USER_HOME!==${JSON.stringify(root)})throw Error('caller transport retained');if(mode==='early-death'){await exchange(Number(serverEndpoint.split(':')[1]),'die');await new Promise((resolve,reject)=>{signal.addEventListener('abort',()=>reject(Error('profile cancelled on server death')),{once:true});});}return {obligations:1};}});}catch(e){error=e.message;}
phase('server-finished');
try{if(guard)qualification=await guard.finish();}catch(e){qualificationError=e.message;}finally{await guard?.close();}
phase('guard-finished');
const ambientReply=await exchange(ambientPort,undefined,ambientHost);
await new Promise(resolve=>ambient.close(resolve));
writeFileSync(${JSON.stringify(join(root, ".scratch", "result.json"))},JSON.stringify({result,error,checks,ambientReply,qualification,qualificationError,cwd:process.cwd()}));
if((mode==='success'||mode.startsWith('output-route'))&&!result)throw Error(error);
if(mode==='output-route'&&qualificationError)throw Error(qualificationError);
if(mode==='output-route-old'&&!qualificationError)throw Error('old output route incorrectly qualified');
if(mode!=='success'&&!mode.startsWith('output-route')&&!error)throw Error('failure fixture incorrectly qualified');
`
  )
  // Reproduce the enclosing quality gate even when this test runs standalone.
  const environment = withoutInheritedCustody({
    ...process.env,
    DALPH_GATE_GIT_HISTORY: "candidate-ancestry",
    DALPH_DPRINT_INCREMENTAL: "disabled"
  })
  // This disposable repository owns its candidate base; an admitted parent
  // may name a commit that does not exist here.
  environment.DALPH_COVERAGE_BASE_SHA = git("rev-parse", "HEAD^")
  // Parent secret-scan and formatter contracts do not describe this fixture.
  delete environment.DALPH_GATE_GIT_HISTORY
  delete environment.DALPH_DPRINT_INCREMENTAL
  delete environment.npm_execpath
  delete environment.DALPH_QUALIFICATION_ENV_CAPTURE
  delete environment.DALPH_RUN_REAL_CODEX_QUALIFICATION
  // The gate owns the execution deadline; the enclosing runner allows its
  // five-second termination grace and two-second absence observation to finish.
  const gateBudgetMilliseconds = 15000
  const outerController = new AbortController()
  const watcher =
    mode === "busy-interruption"
      ? watch(root, (event, filename) => {
          if (filename === "busy-ready") {
            outerController.abort()
            writeFileSync(join(root, "interruption-sent"), "sent")
          }
        })
      : undefined
  environment.DALPH_GATE_DEADLINE = new Date(Date.parse(wallClockTimestamp()) + gateBudgetMilliseconds).toISOString()
  let processResult
  try {
    processResult = await runBoundedCommand({
      executable: process.execPath,
      args: [wrapper, "--", process.execPath, script],
      cwd: root,
      environment,
      name: `owned-server fixture ${mode}`,
      captureOutput: true,
      forwardOutput: false,
      relayParentSignals: true,
      signal: outerController.signal,
      acceptedExitCodes: mode === "output-route-old" || mode === "busy-interruption" ? [1] : [0],
      timeoutMilliseconds: gateBudgetMilliseconds + 10000
    })
  } catch (cause) {
    if (
      mode === "busy-interruption" &&
      cause.quintCommandResult === "cancelled" &&
      cause.stoppedWritersProven === true
    ) {
      processResult = cause
    } else {
      // Reconciliation refuses a live/unreadable descendant and preserves its
      // registration and fences. Never delete a failed fixture in an assertion.
      try {
        disposeOwnedServerFixture(root, { remove: () => {} })
      } catch (cleanupError) {
        throw new AggregateError([cause, cleanupError], `Fixture retained at ${root}`)
      }
      throw new Error(`Owned-server fixture failed; evidence retained at ${root}`, { cause })
    }
  } finally {
    watcher?.close()
  }
  if (process.env.DALPH_QUINT_FIXTURE_PHASE_DIAGNOSTIC === "1") console.error(mode, processResult.output)
  const result = JSON.parse(readFileSync(join(root, ".scratch", "result.json")))
  const location = repositoryLocation(root)
  const runs = readdirSync(join(location.custodyRoot, "runs"))
  const runDirectory = join(location.custodyRoot, "runs", runs[0])
  const receipts = readdirSync(join(runDirectory, "receipts")).map((file) =>
    JSON.parse(readFileSync(join(runDirectory, "receipts", file)))
  )
  return { root, result, receipts, runDirectory, cleanup: () => disposeOwnedServerFixture(root) }
}

void test("owned endpoint socket selection excludes only proven unrelated IPv4 addresses", () => {
  for (const address of ["0100007F:813B", "00000000:813B", "unknown", "0100007F:invalid"])
    assert.equal(quintSocketCanServeOwnedEndpoint({ family: "tcp", address }), true, address)
  for (const address of ["0200007F:813B", "0100000A:813B"])
    assert.equal(quintSocketCanServeOwnedEndpoint({ family: "tcp", address }), false, address)
  for (const family of ["tcp6", "unknown"])
    assert.equal(quintSocketCanServeOwnedEndpoint({ family, address: "0200007F:813B" }), true, family)
})

void test("replaces caller authored owned-server transport metadata", () => {
  assert.deepEqual(
    ownedQuintServerEnvironment(
      {
        KEEP: "",
        DALPH_QUINT_OWNED_SERVER_ENDPOINT: "ambient:8822",
        DALPH_QUINT_JAVA_EXECUTABLE: "/forged/java",
        DALPH_QUINT_JAVA_USER_HOME: "/forged/home"
      },
      "127.0.0.1:40000",
      { javaExecutable: "/identified/java", javaUserHome: "/identified/home" }
    ),
    {
      KEEP: "",
      DALPH_QUINT_OWNED_SERVER_ENDPOINT: "127.0.0.1:40000",
      DALPH_QUINT_JAVA_EXECUTABLE: "/identified/java",
      DALPH_QUINT_JAVA_USER_HOME: "/identified/home"
    }
  )
})

void test("uses and terminates only the identified owned server with a foreign same-port IPv4 listener", async () => {
  const f = await fixture("success")
  try {
    assert.equal(f.result.checks, 1)
    assert.equal(f.result.ambientReply, "ambient")
    const evidence = f.result.result.serverEvidence
    assert.equal(evidence.receipt.outcome, "cancelled")
    assert.equal(evidence.receipt.exitCode, 0)
    assert.equal(evidence.receipt.groupAbsent, true)
    assert.equal(evidence.stop.disposition, "profile-complete")
    assert.deepEqual(JSON.parse(readFileSync(evidence.stopPath)), evidence.stop)
    assert.deepEqual(JSON.parse(readFileSync(evidence.receiptPath)), evidence.receipt)
    assert.ok(evidence.ownedSockets.length > 0)
    assert.ok(
      Object.values(evidence.timing).every((milliseconds) => Number.isFinite(milliseconds) && milliseconds >= 0)
    )
    assert.ok(evidence.timing.launchToReadyMilliseconds >= evidence.timing.launchToOwnedSocketMilliseconds)
    assert.ok(evidence.timing.launchToReadyMilliseconds >= evidence.timing.reflectionReadinessMilliseconds)
  } finally {
    f.cleanup()
  }
})

void test("refuses another process endpoint without checking or stopping the ambient listener", async () => {
  const f = await fixture("ownership-failure")
  try {
    // The colliding child can exit while ownership is being observed. Losing
    // access to that exact process also refuses checking and preserves ambient.
    assert.match(
      f.result.error,
      /another process|stopped before planned shutdown|EACCES: permission denied, scandir '\/proc\/\d+\/fd'/u
    )
    assert.equal(f.result.checks, 0)
    assert.equal(f.result.ambientReply, "ambient")
  } finally {
    f.cleanup()
  }
})

void test("failed owned-server readiness stops its child and launches no profile", async () => {
  const f = await fixture("readiness-failure")
  try {
    assert.match(f.result.error, /fixture reflection refused/u)
    assert.equal(f.result.checks, 0)
    assert.equal(f.result.ambientReply, "ambient")
    assert.ok(f.receipts.some((r) => r.command.name.startsWith("owned Apalache server") && r.groupAbsent))
  } finally {
    f.cleanup()
  }
})

void test("unexpected owned-server exit cancels active checking and cannot qualify", async () => {
  const f = await fixture("early-death")
  try {
    assert.match(f.result.error, /stopped before planned shutdown/u)
    assert.equal(f.result.checks, 1)
    assert.equal(f.result.ambientReply, "ambient")
    assert.ok(
      f.receipts.some((r) => r.command.name.startsWith("owned Apalache server") && r.exitCode === 9 && r.groupAbsent)
    )
  } finally {
    f.cleanup()
  }
})

void test("owned-server shutdown absence failure refuses success", async () => {
  const f = await fixture("shutdown-failure")
  try {
    assert.match(f.result.error, /still has a listener/u)
    assert.equal(f.result.checks, 1)
    assert.equal(f.result.result, undefined)
    assert.equal(f.result.ambientReply, "ambient")
  } finally {
    f.cleanup()
  }
})

void test("missing inherited admission refuses owned-server launch", () => {
  // The test suite itself can run inside admitted preflight custody. This
  // separate child removes that custody without changing other tests' context.
  const result = spawnSync(
    process.execPath,
    [
      "--input-type=module",
      "--eval",
      `import assert from 'node:assert/strict';
import {withOwnedQuintServer} from ${JSON.stringify(helper)};
let calls=0;
const forbidden=()=>{calls++;throw Error('must not cross boundary');};
await assert.rejects(withOwnedQuintServer({javaExecutable:process.execPath,javaUserHome:'/identified/home',javaArguments:['-Duser.home=/identified/home'],apalacheJar:'absent',environment:{},remainingExecutionMilliseconds:forbidden,runProfile:forbidden,boundaries:{assertPrerequisites:forbidden,runBoundedCommand:forbidden}}),/inherited exact-worktree admission/u);
assert.equal(calls,0);
`
    ],
    { env: withoutInheritedCustody(process.env), encoding: "utf8", timeout: 5000 }
  )
  assert.equal(result.status, 0, result.stdout + result.stderr)
})

void test("unsupported owned-server prerequisites refuse launch before custody registration", async () => {
  const f = await fixture("prerequisite-failure")
  try {
    assert.match(f.result.error, /missing patched owned-server readiness/u)
    assert.equal(f.result.checks, 0)
    assert.equal(f.receipts.filter((r) => r.command.name.startsWith("owned Apalache server")).length, 0)
    assert.equal(f.result.ambientReply, "ambient")
  } finally {
    f.cleanup()
  }
})

void test("server readiness consumes finite execution allowance and cannot qualify on timeout", async () => {
  const f = await fixture("readiness-timeout")
  try {
    assert.match(f.result.error, /stopped before planned shutdown.*exceeded/u)
    assert.equal(f.result.checks, 0)
    assert.ok(
      f.receipts.some(
        (r) => r.command.name.startsWith("owned Apalache server") && r.outcome === "timed-out" && r.groupAbsent
      )
    )
    assert.equal(f.result.ambientReply, "ambient")
  } finally {
    f.cleanup()
  }
})

void test("interruption during checking stops the owned server without planned success", async () => {
  const f = await fixture("interruption")
  try {
    assert.match(f.result.error, /interrupted/u)
    assert.equal(f.result.checks, 1)
    assert.equal(f.result.result, undefined)
    assert.ok(
      f.receipts.some(
        (r) => r.command.name.startsWith("owned Apalache server") && r.outcome === "cancelled" && r.groupAbsent
      )
    )
    assert.equal(f.result.ambientReply, "ambient")
  } finally {
    f.cleanup()
  }
})

void test("Java launch prerequisites reject missing, foreign and duplicate home without a process", () => {
  const valid = {
    javaExecutable: process.execPath,
    javaUserHome: "/identified/home",
    javaArguments: ["-Duser.home=/identified/home"]
  }
  validateOwnedQuintJava(valid)
  for (const options of [
    { ...valid, javaUserHome: undefined },
    { ...valid, javaExecutable: "java" }
  ]) {
    assert.throws(() => validateOwnedQuintJava(options), /identified absolute Java executable and user.home/u)
  }
  for (const javaArguments of [[], ["-Duser.home=/forged"], [...valid.javaArguments, ...valid.javaArguments]]) {
    assert.throws(() => validateOwnedQuintJava({ ...valid, javaArguments }), /arguments do not enforce/u)
  }
})

// Fresh output must respect the same candidate observer that surrounds handoff.
// Only the native socket child replaces Java; custody and observation are real.
void test("fresh owned server output stays in its admitted helper directory without changing candidate inputs", async () => {
  const f = await fixture("output-route")
  try {
    assert.equal(f.result.cwd, f.root)
    assert.equal(f.result.checks, 1)
    assert.equal(f.result.qualification.unchanged, true)
    const serverReceipt = f.result.result.serverEvidence.receipt
    const obligation = JSON.parse(
      readFileSync(join(f.runDirectory, "obligations", serverReceipt.obligationId + ".json"))
    )
    const output = join(f.runDirectory, "owned-server-output", obligation.parentId)
    assert.equal(serverReceipt.command.cwd, f.root)
    assert.equal(serverReceipt.command.args.filter((argument) => argument.startsWith("--out-dir=")).length, 1)
    assert.ok(serverReceipt.command.args.indexOf("--out-dir=" + output) < serverReceipt.command.args.indexOf("server"))
    assert.equal(
      readFileSync(join(output, "server", "fresh-session", "diagnostics.log"), "utf8"),
      "fresh server diagnostics"
    )
    assert.equal(existsSync(join(f.root, "_apalache-out")), false)
    assert.equal(serverReceipt.groupAbsent, true)
  } finally {
    f.cleanup()
  }
})

void test("dropping only the owned server output argument makes native candidate observation refuse fresh qualification", async () => {
  const f = await fixture("output-route-old")
  try {
    assert.equal(f.result.result.serverEvidence.receipt.groupAbsent, true)
    assert.equal(f.result.checks, 1)
    assert.equal(f.result.cwd, f.root)
    assert.match(f.result.qualificationError, /dirty:.*_apalache-out/u)
    assert.equal(f.result.qualification, undefined)
    assert.equal(existsSync(join(f.root, "_apalache-out", "server", "fresh-session", "diagnostics.log")), true)
    assert.equal(
      f.result.result.serverEvidence.receipt.command.args.some((argument) => argument.startsWith("--out-dir=")),
      false
    )
  } finally {
    f.cleanup()
  }
})

void test("delayed fixture event loop still settles cancellation and exact server absence", async () => {
  const f = await fixture("busy-interruption")
  try {
    assert.match(f.result.error, /interrupted/u)
    assert.equal(f.result.result, undefined)
    assert.equal(f.result.ambientReply, "ambient")
    assert.ok(f.receipts.some((r) => r.command.name.startsWith("owned Apalache server") && r.groupAbsent))
  } finally {
    f.cleanup()
  }
})

void test("fixture disposal proves every registered run before deleting evidence", () => {
  const calls = []
  disposeProvenFixture({
    root: "fixture",
    runDirectories: ["first", "second"],
    prove: (run) => calls.push(run),
    remove: (root) => calls.push(root)
  })
  assert.deepEqual(calls, ["first", "second", "fixture"])
})

for (const refusal of ["live writer", "unreadable identity", "unobserved registration"]) {
  void test(`fixture disposal preserves all evidence after ${refusal}`, () => {
    const calls = []
    assert.throws(
      () =>
        disposeProvenFixture({
          root: "fixture",
          runDirectories: ["first", "second"],
          prove: (run) => {
            calls.push(run)
            if (run === "second") throw Error(refusal)
          },
          remove: (root) => calls.push(root)
        }),
      /retained.*unproven/u
    )
    assert.deepEqual(calls, ["first", "second"])
  })
}
