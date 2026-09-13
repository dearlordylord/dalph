import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { test } from "node:test"
import { fileURLToPath } from "node:url"
import { repositoryLocation, withoutInheritedCustody } from "./gate-custody-records.mjs"
import { ownedQuintServerEnvironment } from "./quint-owned-server.mjs"

const wrapper = fileURLToPath(new URL("./with-gate-slot.mjs", import.meta.url))
const helper = new URL("./quint-owned-server.mjs", import.meta.url).href
const inputGuard = new URL("./gate-resume-inputs.mjs", import.meta.url).href
const boundedCommand = new URL("./run-bounded-command.mjs", import.meta.url).href
const custodyModule = new URL("./gate-custody-records.mjs", import.meta.url).href
const fixture = (mode) => {
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
import {writeFileSync} from 'node:fs';
import {startInputGuard} from ${JSON.stringify(inputGuard)};
import {runBoundedCommand} from ${JSON.stringify(boundedCommand)};
import {inheritedCustody} from ${JSON.stringify(custodyModule)};
const mode=${JSON.stringify(mode)};
const ambient=createServer(socket=>socket.end('ambient'));
await new Promise(resolve=>ambient.listen(0,'127.0.0.1',resolve));
const ambientPort=ambient.address().port;
const exchange=(port,message)=>new Promise((resolve,reject)=>{const socket=connect(port,'127.0.0.1');socket.once('error',reject);socket.once('data',data=>{if(message)socket.write(message);else socket.end();resolve(data.toString());});});
let checks=0;
const controller=new AbortController();
const boundaries={assertPrerequisites:()=>{if(mode==='prerequisite-failure')throw Error('missing patched owned-server readiness');},readiness:async({port})=>{if(mode==='readiness-timeout')await new Promise(()=>{});if(mode==='readiness-failure')throw Error('fixture reflection refused');if(await exchange(port)!=='owned')throw Error('wrong readiness responder');}};
if(mode==='ownership-failure')boundaries.reservePort=async()=>ambientPort;
if(mode==='shutdown-failure')boundaries.listeningSockets=()=>[{family:'tcp',address:'fixture',inode:'retained'}];
let result,error,qualification,qualificationError;
if(mode==='output-route-old')boundaries.runBoundedCommand=options=>runBoundedCommand({...options,args:options.args.filter(argument=>!argument.startsWith('--out-dir='))});
const guard=mode.startsWith('output-route')?await startInputGuard({worktree:process.cwd(),effectiveEnvironment:process.env,generatedOutputRoots:[inheritedCustody().run.reportDirectory],logicalInvocation:{mode:'check:all',commandArguments:[process.execPath,process.argv[1]],baseSha:process.env.DALPH_COVERAGE_BASE_SHA,stageManifest:[],toolExecutables:[]}}):undefined;
try{result=await withOwnedQuintServer({javaExecutable:process.execPath,javaArguments:[${JSON.stringify(server)},mode==='wrong-java-home'?'-Duser.home=/forged':${JSON.stringify("-Duser.home=" + root)}],javaUserHome:mode==='missing-java-home'?undefined:${JSON.stringify(root)},apalacheJar:'fixture-identified-jar',environment:{...process.env,DALPH_QUINT_OWNED_SERVER_ENDPOINT:'caller-forged:8822',DALPH_QUINT_JAVA_EXECUTABLE:'/caller-forged/java',DALPH_QUINT_JAVA_USER_HOME:'/caller-forged/home'},remainingExecutionMilliseconds:()=>mode==='readiness-timeout'?400:5000,terminationGraceMilliseconds:50,processGroupAbsenceTimeoutMilliseconds:1000,boundaries,signal:controller.signal,runProfile:async({serverEndpoint,environment,signal})=>{checks++;if(mode==='interruption'){await new Promise((resolve,reject)=>{signal.addEventListener('abort',()=>reject(Error('profile interrupted')),{once:true});controller.abort(Error('fixture interrupted'));});}if(environment.DALPH_QUINT_OWNED_SERVER_ENDPOINT!==serverEndpoint||environment.DALPH_QUINT_JAVA_EXECUTABLE!==process.execPath||environment.DALPH_QUINT_JAVA_USER_HOME!==${JSON.stringify(root)})throw Error('caller transport retained');if(mode==='early-death'){await exchange(Number(serverEndpoint.split(':')[1]),'die');await new Promise((resolve,reject)=>{signal.addEventListener('abort',()=>reject(Error('profile cancelled on server death')),{once:true});});}return {obligations:1};}});}catch(e){error=e.message;}
try{if(guard)qualification=await guard.finish();}catch(e){qualificationError=e.message;}finally{await guard?.close();}
const ambientReply=await exchange(ambientPort);
await new Promise(resolve=>ambient.close(resolve));
writeFileSync(${JSON.stringify(join(root, ".scratch", "result.json"))},JSON.stringify({result,error,checks,ambientReply,qualification,qualificationError,cwd:process.cwd()}));
if((mode==='success'||mode.startsWith('output-route'))&&!result)throw Error(error);
if(mode==='output-route'&&qualificationError)throw Error(qualificationError);
if(mode==='output-route-old'&&!qualificationError)throw Error('old output route incorrectly qualified');
if(mode!=='success'&&!mode.startsWith('output-route')&&!error)throw Error('failure fixture incorrectly qualified');
`
  )
  const environment = withoutInheritedCustody(process.env)
  // This disposable repository owns its candidate base; an admitted parent
  // may name a commit that does not exist here.
  environment.DALPH_COVERAGE_BASE_SHA = git("rev-parse", "HEAD^")
  // The parent's secret-scan history contract does not describe this fixture.
  delete environment.DALPH_GATE_GIT_HISTORY
  delete environment.npm_execpath
  delete environment.DALPH_QUALIFICATION_ENV_CAPTURE
  delete environment.DALPH_RUN_REAL_CODEX_QUALIFICATION
  const processResult = spawnSync(process.execPath, [wrapper, "--", process.execPath, script], {
    cwd: root,
    env: environment,
    encoding: "utf8",
    timeout: 15000
  })
  assert.equal(processResult.status, mode === "output-route-old" ? 1 : 0, processResult.stdout + processResult.stderr)
  const result = JSON.parse(readFileSync(join(root, ".scratch", "result.json")))
  const location = repositoryLocation(root)
  const runs = readdirSync(join(location.custodyRoot, "runs"))
  const runDirectory = join(location.custodyRoot, "runs", runs[0])
  const receipts = readdirSync(join(runDirectory, "receipts")).map((file) =>
    JSON.parse(readFileSync(join(runDirectory, "receipts", file)))
  )
  return { root, result, receipts, runDirectory, cleanup: () => rmSync(root, { recursive: true, force: true }) }
}

test("replaces caller authored owned-server transport metadata", () => {
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

test("uses and terminates only the identified owned server", () => {
  const f = fixture("success")
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

test("refuses another process endpoint without checking or stopping the ambient listener", () => {
  const f = fixture("ownership-failure")
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

test("failed owned-server readiness stops its child and launches no profile", () => {
  const f = fixture("readiness-failure")
  try {
    assert.match(f.result.error, /fixture reflection refused/u)
    assert.equal(f.result.checks, 0)
    assert.equal(f.result.ambientReply, "ambient")
    assert.ok(f.receipts.some((r) => r.command.name.startsWith("owned Apalache server") && r.groupAbsent))
  } finally {
    f.cleanup()
  }
})

test("unexpected owned-server exit cancels active checking and cannot qualify", () => {
  const f = fixture("early-death")
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

test("owned-server shutdown absence failure refuses success", () => {
  const f = fixture("shutdown-failure")
  try {
    assert.match(f.result.error, /still has a listener/u)
    assert.equal(f.result.checks, 1)
    assert.equal(f.result.result, undefined)
    assert.equal(f.result.ambientReply, "ambient")
  } finally {
    f.cleanup()
  }
})

test("missing inherited admission refuses owned-server launch", () => {
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

test("unsupported owned-server prerequisites refuse launch before custody registration", () => {
  const f = fixture("prerequisite-failure")
  try {
    assert.match(f.result.error, /missing patched owned-server readiness/u)
    assert.equal(f.result.checks, 0)
    assert.equal(f.receipts.filter((r) => r.command.name.startsWith("owned Apalache server")).length, 0)
    assert.equal(f.result.ambientReply, "ambient")
  } finally {
    f.cleanup()
  }
})

test("server readiness consumes finite execution allowance and cannot qualify on timeout", () => {
  const f = fixture("readiness-timeout")
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

test("interruption during checking stops the owned server without planned success", () => {
  const f = fixture("interruption")
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

test("missing Java user.home refuses server launch", () => {
  const f = fixture("missing-java-home")
  try {
    assert.match(f.result.error, /identified absolute Java executable and user.home/u)
    assert.equal(f.result.checks, 0)
    assert.equal(f.receipts.filter((r) => r.command.name.startsWith("owned Apalache server")).length, 0)
  } finally {
    f.cleanup()
  }
})

test("Java arguments with another user.home refuse server launch", () => {
  const f = fixture("wrong-java-home")
  try {
    assert.match(f.result.error, /arguments do not enforce the identified user.home/u)
    assert.equal(f.result.checks, 0)
    assert.equal(f.receipts.filter((r) => r.command.name.startsWith("owned Apalache server")).length, 0)
  } finally {
    f.cleanup()
  }
})

// Fresh output must respect the same candidate observer that surrounds handoff.
// Only the native socket child replaces Java; custody and observation are real.
test("fresh owned server output stays in its admitted helper directory without changing candidate inputs", () => {
  const f = fixture("output-route")
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

test("dropping only the owned server output argument makes native candidate observation refuse fresh qualification", () => {
  const f = fixture("output-route-old")
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
