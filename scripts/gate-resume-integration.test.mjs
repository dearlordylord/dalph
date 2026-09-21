import assert from "node:assert/strict"
import { test } from "node:test"
import {
  chmodSync,
  existsSync,
  statSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync
} from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { spawnSync } from "node:child_process"
import { fileURLToPath } from "node:url"
import { withoutInheritedCustody, repositoryLocation } from "./gate-custody-records.mjs"
import { readRunEvidence } from "./gate-run-evidence.mjs"
import {
  controlledFormalWorkflowSource,
  copyQualityRuntimeFixture,
  seedQualityFormalBoundary
} from "./formal-quality-test-fixture.mjs"

const wrapper = fileURLToPath(new URL("./with-gate-slot.mjs", import.meta.url))
const bounded = new URL("./run-bounded-command.mjs", import.meta.url).href
const fixture = () => {
  const root = mkdtempSync(join(tmpdir(), "dalph-resume-"))
  const git = (...args) => {
    const result = spawnSync("git", args, { cwd: root, encoding: "utf8" })
    assert.equal(result.status, 0, result.stderr)
    return result.stdout.trim()
  }
  git("init", "-q")
  copyQualityRuntimeFixture(root)
  writeFileSync(join(root, "package.json"), JSON.stringify({ type: "module" }))
  writeFileSync(
    join(root, "scripts", "effect-tsgo-platform-binary.mjs"),
    "export const ensureEffectTsgoPlatformBinaryExecutable=()=>{}"
  )
  writeFileSync(
    join(root, "scripts", "run-formal-workflow.mjs"),
    controlledFormalWorkflowSource("Formal: controlled boundary reuses independently validated synthetic records")
  )

  writeFileSync(join(root, ".gitignore"), ".scratch/\ndist/\n")
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
  writeFileSync(join(root, ".scratch", "controlled-formal-path"), seedQualityFormalBoundary(root))
  return { root, git, cleanup: () => rmSync(root, { recursive: true, force: true }) }
}
const launch = (root, script, resumeRunId, reap = false) => {
  const env = withoutInheritedCustody(process.env)
  for (const key of [
    "DALPH_COVERAGE_BASE_SHA",
    "DALPH_GATE_GIT_HISTORY",
    "DALPH_QUALIFICATION_ENV_CAPTURE",
    "DALPH_RUN_REAL_CODEX_QUALIFICATION",
    "npm_execpath"
  ])
    delete env[key]
  const args = [
    process.execPath,
    wrapper,
    "--",
    process.execPath,
    script,
    ...(resumeRunId ? [`--resume=${resumeRunId}`] : [])
  ]
  const reaper = `import ctypes, os, subprocess, sys, time
assert ctypes.CDLL(None).prctl(36,1,0,0,0)==0, 'Unrun custody cleanup acceptance: Linux prctl subreaper unavailable'
p=subprocess.Popen(sys.argv[1:])
code=None
while True:
    try: pid,status=os.waitpid(-1,os.WNOHANG)
    except ChildProcessError: break
    if pid==p.pid: code=os.waitstatus_to_exitcode(status)
    if pid==0: time.sleep(.005)
sys.exit(code if code is not None else 1)
`
  return spawnSync(reap ? "python3" : args[0], reap ? ["-c", reaper, ...args] : args.slice(1), {
    cwd: root,
    env,
    encoding: "utf8",
    timeout: 20_000
  })
}
const runs = (root) => {
  const location = repositoryLocation(root)
  return readdirSync(join(location.custodyRoot, "runs"))
    .filter(
      (runId) =>
        JSON.parse(readFileSync(join(location.custodyRoot, "runs", runId, "run.json"), "utf8")).fixtureFormalSeed !==
        true
    )
    .map((runId) => readRunEvidence({ runId, runDirectory: join(location.custodyRoot, "runs", runId) }))
}
void test("an unaffected candidate resumes proven stages with not-applicable formal evidence and no formal workflow", () => {
  const f = fixture()
  let completed = false
  try {
    const counter = join(f.root, ".scratch", "counter")
    const release = join(f.root, ".scratch", "release")
    const script = join(f.root, ".scratch", "quality.mjs")
    const stageSources = [
      `if(process.env.GIT_OPTIONAL_LOCKS!=='0')throw Error('guarded child optional locks were not disabled');const fs=require('fs');fs.appendFileSync(${JSON.stringify(counter)},'build\\n');fs.mkdirSync('dist',{recursive:true});fs.writeFileSync('dist/result','built')`,
      `const fs=require('fs');fs.appendFileSync(${JSON.stringify(counter)},'negative\\n');const {runBoundedCommand}=await import(${JSON.stringify(bounded)});let failed=false;try{await runBoundedCommand({executable:process.execPath,args:['-e','process.exit(23)'],name:'expected failing child',timeoutMilliseconds:10000})}catch(error){if(error.quintCommandResult!=='exit:23')throw error;failed=true}if(!failed)throw Error('negative did not fail')`,
      `const fs=require('fs');fs.appendFileSync(${JSON.stringify(counter)},'coverage\\n');const d=process.env.DALPH_COVERAGE_DIRECTORY;fs.mkdirSync(d,{recursive:true});fs.writeFileSync(d+'/coverage-final.json','{}');fs.writeFileSync(d+'/coverage-summary.json','{}')`,
      `const fs=require('fs');fs.appendFileSync(${JSON.stringify(counter)},'late\\n');if(!fs.existsSync(${JSON.stringify(release)}))process.exit(24)`
    ]
    writeFileSync(
      script,
      `import {executeResumableQualityGate} from ${JSON.stringify(new URL(`file://${join(f.root, "scripts", "gate-quality-run.mjs")}`).href)};import {runBoundedCommand} from ${JSON.stringify(bounded)};
const sources=${JSON.stringify(stageSources)};
const executableSources=sources.map(source=>"import {createRequire} from 'node:module';const require=createRequire(import.meta.url);"+source);
const manifest=sources.map((source,ordinal)=>({execution:{executable:process.execPath,args:['--input-type=module','-e',executableSources[ordinal]],cwd:process.cwd(),name:'fixture '+ordinal,timeoutMilliseconds:10000,acceptedExitCodes:[0],relayParentSignals:false,terminationGraceMilliseconds:5000,processGroupAbsenceTimeoutMilliseconds:2000},id:['build','negative','coverage','late'][ordinal],name:'fixture '+ordinal,boundary:'qualification',args:[source],timeout:10000,artifactRoots:ordinal===0?['dist']:ordinal===2?['@coverage']:[]}));
const logicalInvocation={mode:'check:all',commandArguments:[process.execPath,process.argv[1]],baseSha:${JSON.stringify(f.git("rev-parse", "HEAD^"))},stageManifest:manifest,toolExecutables:[]};
logicalInvocation.formalClassification={version:1,status:'unaffected',baseSha:logicalInvocation.baseSha,headSha:undefined,changedPaths:['application-only-input'],affectedPaths:[]};
await executeResumableQualityGate({stageManifest:manifest,logicalInvocation,resumeRunId:process.argv[2]?.slice('--resume='.length),runStage:async stage=>{
return runBoundedCommand({executable:process.execPath,args:['--input-type=module','-e',"import {createRequire} from 'node:module';const require=createRequire(import.meta.url);"+stage.args[0]],name:stage.name,timeoutMilliseconds:10000})}});`
    )
    const failed = launch(f.root, script)
    assert.equal(failed.status, 1, failed.stderr)
    assert.match(failed.stderr, /Formal: not applicable; zero checkers or servers started/u)
    assert.doesNotMatch(failed.stderr, /controlled boundary reuses/u)
    const prior = runs(f.root)[0]
    assert.equal(prior.custody, "stopped")
    assert.equal(prior.resume.stages[0].outcome, "passed", JSON.stringify(prior.stages))
    writeFileSync(release, "release")
    const resumed = launch(f.root, script, prior.runId)
    assert.equal(resumed.status, 0, resumed.stderr)
    const evidence = runs(f.root).find((run) => run.runId !== prior.runId)
    assert.equal(evidence.qualification, "passed")
    assert.equal(evidence.resume.formal.disposition, "not-applicable")
    assert.equal(evidence.resume.formalProven, true)
    assert.doesNotMatch(resumed.stderr, /controlled boundary reuses/u)
    assert.deepEqual(readFileSync(counter, "utf8").trim().split("\n"), [
      "build",
      "negative",
      "coverage",
      "late",
      "late"
    ])
    assert.equal(evidence.resume.composite.entries.filter((entry) => entry.kind === "reused").length, 3)
    assert.ok(evidence.coverage.final.path.startsWith(evidence.reportDirectory))
    assert.equal(readFileSync(evidence.coverage.final.path, "utf8"), "{}")
    assert.notEqual(evidence.coverage.final.path, prior.coverage.final.path)
    const fresh = launch(f.root, script)
    assert.equal(fresh.status, 0, fresh.stderr)
    const freshEvidence = runs(f.root).find((run) => run.runId !== prior.runId && run.runId !== evidence.runId)
    assert.equal(freshEvidence.resume.formal.disposition, "not-applicable")
    assert.deepEqual(
      freshEvidence.resume.stages.map((stage) => stage.outcome),
      evidence.resume.stages.map((stage) => stage.outcome)
    )
    for (const successful of [evidence, freshEvidence]) {
      const directory = join(repositoryLocation(f.root).custodyRoot, "runs", successful.runId)
      assert.equal(JSON.parse(readFileSync(join(directory, "run.json"), "utf8")).requiresQualityComposite, true)
      const contractPath = join(directory, "resume-contract.json")
      const contract = readFileSync(contractPath, "utf8")
      rmSync(contractPath)
      assert.throws(
        () => readRunEvidence({ runDirectory: directory, runId: successful.runId }),
        /Missing required resumable gate contract/u
      )
      writeFileSync(contractPath, contract)
    }
    const beforeRefusal = readFileSync(counter, "utf8")
    writeFileSync(join(f.root, "dist", "uncredited-extra"), "extra")
    const changedArtifact = launch(f.root, script, prior.runId)
    assert.equal(changedArtifact.status, 1)
    assert.ok(changedArtifact.stderr.includes("Required generated artifact changed"))
    assert.equal(readFileSync(counter, "utf8"), beforeRefusal, "artifact refusal launches no suffix")
    rmSync(join(f.root, "dist", "uncredited-extra"))
    const expectedChild = prior.stages.find((stage) => stage.command.name === "expected failing child")
    const childReceipt = join(
      repositoryLocation(f.root).custodyRoot,
      "runs",
      prior.runId,
      "receipts",
      `${expectedChild.obligationId}.json`
    )
    rmSync(childReceipt)
    const missingChild = launch(f.root, script, prior.runId)
    assert.equal(missingChild.status, 1)
    assert.ok(missingChild.stderr.includes("Invalid passing quality stage verdict"))
    assert.equal(readFileSync(counter, "utf8"), beforeRefusal, "missing required child refuses before suffix")
    completed = true
  } catch (error) {
    console.error(`Retained failed resume fixture: ${f.root}`)
    throw error
  } finally {
    if (completed) f.cleanup()
  }
})

void test("local qualification collects every ordinary suffix failure in canonical manifest order", () => {
  const f = fixture()
  try {
    const script = join(f.root, ".scratch", "qualification-fail-slow.mjs")
    const sources = ["process.exit(23)", "process.stdout.write('catalog pass\\n')", "process.exit(25)"]
    writeFileSync(
      script,
      `import {executeResumableQualityGate} from ${JSON.stringify(new URL(`file://${join(f.root, "scripts", "gate-quality-run.mjs")}`).href)};import {runBoundedCommand} from ${JSON.stringify(bounded)};
const sources=${JSON.stringify(sources)};const ids=['delivery-repeatability','recorded-catalog','coverage'];const manifest=sources.map((source,ordinal)=>({execution:{executable:process.execPath,args:['-e',source],cwd:process.cwd(),name:ids[ordinal],timeoutMilliseconds:10000,acceptedExitCodes:[0],relayParentSignals:false,terminationGraceMilliseconds:5000,processGroupAbsenceTimeoutMilliseconds:2000},id:ids[ordinal],name:ids[ordinal],boundary:'qualification',args:[ids[ordinal]],timeout:10000,artifactRoots:[]}));
const logicalInvocation={mode:'check:all',commandArguments:[process.execPath,process.argv[1]],baseSha:${JSON.stringify(f.git("rev-parse", "HEAD^"))},stageManifest:manifest,toolExecutables:[]};logicalInvocation.formalClassification={version:1,status:'unaffected',baseSha:logicalInvocation.baseSha,headSha:undefined,changedPaths:['application-only-input'],affectedPaths:[]};await executeResumableQualityGate({stageManifest:manifest,logicalInvocation,prepareFreshInputs:()=>{},runStage:stage=>runBoundedCommand({executable:process.execPath,args:['-e',sources[manifest.indexOf(stage)]],name:stage.name,timeoutMilliseconds:10000})});`
    )
    const result = launch(f.root, script)
    assert.equal(result.status, 1)
    assert.match(result.stderr, /Qualification failed: delivery-repeatability/u)
    assert.match(result.stderr, /Qualification failed: coverage/u)
    assert.ok(result.stderr.indexOf("delivery-repeatability") < result.stderr.indexOf("coverage"))
    const evidence = runs(f.root)[0]
    assert.deepEqual(
      evidence.resume.stages.map((stage) => [stage.stageId, stage.outcome]),
      [
        ["delivery-repeatability", "failed"],
        ["recorded-catalog", "passed"],
        ["coverage", "failed"]
      ]
    )
  } finally {
    f.cleanup()
  }
})

void test("admitted census failure reruns later successful checks instead of treating them as prefix islands", () => {
  const f = fixture()
  try {
    const counter = join(f.root, ".scratch", "census-counter")
    const release = join(f.root, ".scratch", "census-release")
    const script = join(f.root, ".scratch", "census.mjs")
    const sources = [
      `const fs=require('fs');fs.appendFileSync(${JSON.stringify(counter)},'first\\n');if(!fs.existsSync(${JSON.stringify(release)}))process.exit(23)`,
      `require('fs').appendFileSync(${JSON.stringify(counter)},'later\\n')`,
      `require('fs').appendFileSync(${JSON.stringify(counter)},'suffix\\n')`
    ]
    writeFileSync(
      script,
      `import {executeResumableQualityGate} from ${JSON.stringify(new URL(`file://${join(f.root, "scripts", "gate-quality-run.mjs")}`).href)};import {runBoundedCommand} from ${JSON.stringify(bounded)};
const sources=${JSON.stringify(sources)};const manifest=sources.map((source,ordinal)=>({id:['first','later','suffix'][ordinal],name:'census '+ordinal,boundary:ordinal<2?'preflight':'qualification',args:[source],timeout:10000,artifactRoots:[],execution:{executable:process.execPath,args:['-e',source],cwd:process.cwd(),name:'census '+ordinal,timeoutMilliseconds:10000,acceptedExitCodes:[0],relayParentSignals:false,terminationGraceMilliseconds:5000,processGroupAbsenceTimeoutMilliseconds:2000}}));
const logicalInvocation={mode:'check:all',commandArguments:[process.execPath,process.argv[1]],baseSha:${JSON.stringify(f.git("rev-parse", "HEAD^"))},stageManifest:manifest,toolExecutables:[]};logicalInvocation.formalClassification={version:1,status:'affected',baseSha:logicalInvocation.baseSha,headSha:undefined,changedPaths:['controlled-formal-input'],affectedPaths:['controlled-formal-input']};await executeResumableQualityGate({stageManifest:manifest,logicalInvocation,resumeRunId:process.argv[2]?.slice('--resume='.length),runStage:stage=>runBoundedCommand({executable:process.execPath,args:['-e',stage.args[0]],name:stage.name,timeoutMilliseconds:10000})});`
    )
    const failed = launch(f.root, script)
    assert.equal(failed.status, 1, failed.stderr)
    const prior = runs(f.root)[0]
    assert.equal(prior.resume.stages[1].outcome, "passed")
    writeFileSync(release, "release")
    const resumed = launch(f.root, script, prior.runId)
    assert.equal(resumed.status, 0, resumed.stderr)
    assert.deepEqual(readFileSync(counter, "utf8").trim().split("\n"), ["first", "later", "first", "later", "suffix"])
  } finally {
    f.cleanup()
  }
})

void test("admitted check:all reports lint, Lab, and complexity failures before qualification", () => {
  const f = fixture()
  try {
    const formalSentinel = join(f.root, ".scratch", "unexpected-formal-launch")
    writeFileSync(
      join(f.root, "scripts", "run-formal-workflow.mjs"),
      `import {writeFileSync} from 'node:fs';export const runFormalWorkflow=async()=>{writeFileSync(${JSON.stringify(formalSentinel)},'launched');throw new Error('formal verification unexpectedly launched')}`
    )
    const script = join(f.root, ".scratch", "collected-preflight.mjs")
    const sources = ["process.exit(23)", "process.exit(25)", "process.exit(24)", "process.exitCode=99"]
    writeFileSync(
      script,
      `import {executeResumableQualityGate} from ${JSON.stringify(new URL(`file://${join(f.root, "scripts", "gate-quality-run.mjs")}`).href)};import {runBoundedCommand} from ${JSON.stringify(bounded)};
const sources=${JSON.stringify(sources)};const manifest=sources.map((source,ordinal)=>({id:['format-lint','reducer-lab','complexity','coverage'][ordinal],name:['format and lint','Reducer Lab maintained evaluation','cyclomatic complexity','tests and coverage'][ordinal],boundary:ordinal<3?'preflight':'qualification',args:[ordinal===0?'lint:code':ordinal===1?'check:lab':ordinal===2?'check:complexity':'test:coverage'],timeout:10000,artifactRoots:[],execution:{executable:process.execPath,args:['-e',source],cwd:process.cwd(),name:['format and lint','Reducer Lab maintained evaluation','cyclomatic complexity','tests and coverage'][ordinal],timeoutMilliseconds:10000,acceptedExitCodes:[0],relayParentSignals:false,terminationGraceMilliseconds:5000,processGroupAbsenceTimeoutMilliseconds:2000}}));
const logicalInvocation={mode:'check:all',commandArguments:[process.execPath,process.argv[1]],baseSha:${JSON.stringify(f.git("rev-parse", "HEAD^"))},stageManifest:manifest,toolExecutables:[]};logicalInvocation.formalClassification={version:1,status:'affected',baseSha:logicalInvocation.baseSha,headSha:undefined,changedPaths:['controlled-formal-input'],affectedPaths:['controlled-formal-input']};await executeResumableQualityGate({stageManifest:manifest,logicalInvocation,runStage:stage=>runBoundedCommand({executable:process.execPath,args:['-e',sources[manifest.indexOf(stage)]],name:stage.name,timeoutMilliseconds:10000})});`
    )
    const failed = launch(f.root, script)
    assert.equal(failed.status, 1, failed.stderr)
    assert.match(failed.stderr, /Preflight failed: pnpm lint:code/u)
    assert.match(failed.stderr, /Preflight failed: pnpm check:lab/u)
    assert.match(failed.stderr, /Preflight failed: pnpm check:complexity/u)
    assert.match(failed.stderr, /Preflight failed: 3 failed stages/u)
    assert.match(failed.stderr, /qualification stages did not start/u)
    const evidence = runs(f.root)[0]
    assert.deepEqual(
      evidence.resume.stages.map((stage) => [stage.stageId, stage.outcome]),
      [
        ["format-lint", "failed"],
        ["reducer-lab", "failed"],
        ["complexity", "failed"],
        ["coverage", "UNPROVEN"]
      ]
    )
    assert.equal(evidence.stages.find((stage) => stage.command.name === "format and lint")?.exitCode, 23)
    assert.equal(
      evidence.stages.find((stage) => stage.command.name === "Reducer Lab maintained evaluation")?.exitCode,
      25
    )
    assert.equal(evidence.stages.find((stage) => stage.command.name === "cyclomatic complexity")?.exitCode, 24)
    assert.equal(
      evidence.stages.some((stage) => stage.command.name === "tests and coverage"),
      false
    )
    assert.equal(existsSync(formalSentinel), false)
    assert.equal(evidence.resume.formalProven, false)
    assert.equal(evidence.resume.composite.formal, undefined)
    assert.equal(evidence.resume.composite.formalOutputLineCount, 0)
    assert.equal(evidence.qualification, "UNPROVEN")
  } finally {
    f.cleanup()
  }
})

void test("resumed suffix preserves original counts without a successful output ceiling", () => {
  const f = fixture()
  try {
    const release = join(f.root, ".scratch", "budget-release")
    const script = join(f.root, ".scratch", "budget.mjs")
    const sources = [
      "process.stdout.write('prefix\\n'.repeat(300))",
      `if(!require('fs').existsSync(${JSON.stringify(release)}))process.exit(23);process.stdout.write('suffix\\n'.repeat(251))`
    ]
    writeFileSync(
      script,
      `import {executeResumableQualityGate} from ${JSON.stringify(new URL(`file://${join(f.root, "scripts", "gate-quality-run.mjs")}`).href)};import {runBoundedCommand} from ${JSON.stringify(bounded)};
const sources=${JSON.stringify(sources)};const manifest=sources.map((source,ordinal)=>({id:['prefix','suffix'][ordinal],name:'budget '+ordinal,boundary:'qualification',args:[source],timeout:10000,artifactRoots:[],execution:{executable:process.execPath,args:['-e',source],cwd:process.cwd(),name:'budget '+ordinal,timeoutMilliseconds:10000,acceptedExitCodes:[0],relayParentSignals:false,terminationGraceMilliseconds:5000,processGroupAbsenceTimeoutMilliseconds:2000}}));
const logicalInvocation={mode:'check:all',commandArguments:[process.execPath,process.argv[1]],baseSha:${JSON.stringify(f.git("rev-parse", "HEAD^"))},stageManifest:manifest,toolExecutables:[]};logicalInvocation.formalClassification={version:1,status:'affected',baseSha:logicalInvocation.baseSha,headSha:undefined,changedPaths:['controlled-formal-input'],affectedPaths:['controlled-formal-input']};await executeResumableQualityGate({stageManifest:manifest,logicalInvocation,resumeRunId:process.argv[2]?.slice('--resume='.length),runStage:stage=>runBoundedCommand({executable:process.execPath,args:['-e',stage.args[0]],name:stage.name,timeoutMilliseconds:10000})});`
    )
    assert.equal(launch(f.root, script).status, 1)
    const prior = runs(f.root)[0]
    assert.equal(prior.resume.stages[0].outputLineCount, 300)
    writeFileSync(release, "release")
    const resumed = launch(f.root, script, prior.runId)
    assert.equal(resumed.status, 0, resumed.stderr)
    const evidence = runs(f.root).find((run) => run.runId !== prior.runId)
    assert.equal(evidence.qualification, "passed")
    assert.equal(evidence.resume.composite.successfulOutputLines, 552)
  } finally {
    f.cleanup()
  }
})

void test("a real edit-and-restore during a designated stage forbids later launches and composite qualification", () => {
  const f = fixture()
  try {
    const next = join(f.root, ".scratch", "forbidden-next")
    const script = join(f.root, ".scratch", "mutation.mjs")
    const sources = [
      "const fs=require('fs');const original=fs.readFileSync('.gitignore');fs.appendFileSync('.gitignore','transient\\n');fs.writeFileSync('.gitignore',original)",
      `require('fs').writeFileSync(${JSON.stringify(next)},'forbidden')`
    ]
    writeFileSync(
      script,
      `import {executeResumableQualityGate} from ${JSON.stringify(new URL(`file://${join(f.root, "scripts", "gate-quality-run.mjs")}`).href)};import {runBoundedCommand} from ${JSON.stringify(bounded)};
const sources=${JSON.stringify(sources)};const manifest=sources.map((source,ordinal)=>({id:['mutation','next'][ordinal],name:'mutation '+ordinal,boundary:'qualification',args:[source],timeout:10000,artifactRoots:[],execution:{executable:process.execPath,args:['-e',source],cwd:process.cwd(),name:'mutation '+ordinal,timeoutMilliseconds:10000,acceptedExitCodes:[0],relayParentSignals:false,terminationGraceMilliseconds:5000,processGroupAbsenceTimeoutMilliseconds:2000}}));
const logicalInvocation={mode:'check:all',commandArguments:[process.execPath,process.argv[1]],baseSha:${JSON.stringify(f.git("rev-parse", "HEAD^"))},stageManifest:manifest,toolExecutables:[]};logicalInvocation.formalClassification={version:1,status:'affected',baseSha:logicalInvocation.baseSha,headSha:undefined,changedPaths:['controlled-formal-input'],affectedPaths:['controlled-formal-input']};await executeResumableQualityGate({stageManifest:manifest,logicalInvocation,runStage:stage=>runBoundedCommand({executable:process.execPath,args:['-e',stage.args[0]],name:stage.name,timeoutMilliseconds:10000})});`
    )
    const result = launch(f.root, script)
    assert.equal(result.status, 1)
    assert.equal(spawnSync("test", ["-e", next]).status, 1)
    const evidence = runs(f.root)[0]
    assert.equal(evidence.terminal.sourceUnchanged, true)
    assert.equal(evidence.qualification, "UNPROVEN")
    assert.equal(evidence.resume.composite, undefined)
  } finally {
    f.cleanup()
  }
})

void test("an enclosing negative test proves later cleanup while preserving the child's failed absence observation and reuse", () => {
  const f = fixture()
  try {
    const script = join(f.root, ".scratch", "cleanup-negative.mjs")
    const pidPath = join(f.root, ".scratch", "cleanup-group")
    const counter = join(f.root, ".scratch", "cleanup-counter")
    const release = join(f.root, ".scratch", "cleanup-release")
    const controller = `const fs=require('fs');const p=require('child_process').spawn(process.execPath,['-e','setInterval(()=>{},50)'],{stdio:'ignore'});fs.writeFileSync(${JSON.stringify(pidPath)},String(process.pid));p.unref()`
    const negative = `import fs from 'node:fs';import {setTimeout} from 'node:timers/promises';import {runBoundedCommand} from ${JSON.stringify(bounded)};fs.appendFileSync(${JSON.stringify(counter)},'negative\\n');let failed=false;try{await runBoundedCommand({executable:process.execPath,args:['-e',${JSON.stringify(controller)}],name:'expected historical absence failure',timeoutMilliseconds:10000,processGroupAbsenceTimeoutMilliseconds:100})}catch(error){if(error.quintCommandResult!=='failed'||!error.message.includes('not proven absent'))throw error;failed=true}if(!failed)throw Error('absence negative control did not fail');const group=Number(fs.readFileSync(${JSON.stringify(pidPath)},'utf8'));process.kill(-group,'SIGTERM');for(let i=0;;i++){try{process.kill(-group,0)}catch(error){if(error.code==='ESRCH')break;throw error}if(i>1000)throw Error('cleanup group still exists');await setTimeout(5)}`
    const late = `import fs from 'node:fs';fs.appendFileSync(${JSON.stringify(counter)},'late\\n');if(!fs.existsSync(${JSON.stringify(release)}))process.exit(23)`
    writeFileSync(
      script,
      `import {executeResumableQualityGate} from ${JSON.stringify(new URL(`file://${join(f.root, "scripts", "gate-quality-run.mjs")}`).href)};import {runBoundedCommand} from ${JSON.stringify(bounded)};
const sources=${JSON.stringify([negative, late])};const manifest=sources.map((source,ordinal)=>({id:['negative-cleanup','late'][ordinal],name:'cleanup '+ordinal,boundary:'qualification',args:[source],timeout:10000,artifactRoots:[],execution:{executable:process.execPath,args:['--input-type=module','-e',source],cwd:process.cwd(),name:'cleanup '+ordinal,timeoutMilliseconds:10000,acceptedExitCodes:[0],relayParentSignals:false,terminationGraceMilliseconds:5000,processGroupAbsenceTimeoutMilliseconds:2000}}));
const logicalInvocation={mode:'check:all',commandArguments:[process.execPath,process.argv[1]],baseSha:${JSON.stringify(f.git("rev-parse", "HEAD^"))},stageManifest:manifest,toolExecutables:[]};logicalInvocation.formalClassification={version:1,status:'affected',baseSha:logicalInvocation.baseSha,headSha:undefined,changedPaths:['controlled-formal-input'],affectedPaths:['controlled-formal-input']};await executeResumableQualityGate({stageManifest:manifest,logicalInvocation,resumeRunId:process.argv[2]?.slice('--resume='.length),runStage:stage=>runBoundedCommand({executable:process.execPath,args:['--input-type=module','-e',stage.args[0]],name:stage.name,timeoutMilliseconds:10000})});`
    )
    const failed = launch(f.root, script, undefined, true)
    assert.equal(failed.status, 1, failed.stderr)
    const prior = runs(f.root)[0]
    const historical = prior.stages.find((stage) => stage.command.name === "expected historical absence failure")
    assert.equal(historical.outcome, "failed")
    assert.equal(historical.exitCode, 0)
    assert.equal(historical.groupAbsent, false)
    assert.equal(historical.stopped, true)
    assert.equal(prior.resume.stages[0].subtreeProven, true)
    writeFileSync(release, "release")
    const resumed = launch(f.root, script, prior.runId, true)
    assert.equal(resumed.status, 0, resumed.stderr)
    const evidence = runs(f.root).find((run) => run.runId !== prior.runId)
    assert.equal(evidence.qualification, "passed")
    assert.deepEqual(readFileSync(counter, "utf8").trim().split("\n"), ["negative", "late", "late"])
  } finally {
    f.cleanup()
  }
})

void test("a fresh build protects its produced artifacts against consumer edit-and-restore before the next launch", () => {
  const f = fixture()
  try {
    const next = join(f.root, ".scratch", "artifact-forbidden-next")
    const script = join(f.root, ".scratch", "fresh-artifact.mjs")
    const sources = [
      "const fs=require('fs');fs.mkdirSync('dist',{recursive:true});fs.writeFileSync('dist/result','produced')",
      "const fs=require('fs');const original=fs.readFileSync('dist/result');fs.writeFileSync('dist/result','transient');fs.writeFileSync('dist/result',original)",
      `require('fs').writeFileSync(${JSON.stringify(next)},'forbidden')`
    ]
    writeFileSync(
      script,
      `import {executeResumableQualityGate} from ${JSON.stringify(new URL(`file://${join(f.root, "scripts", "gate-quality-run.mjs")}`).href)};import {runBoundedCommand} from ${JSON.stringify(bounded)};
const sources=${JSON.stringify(sources)};const manifest=sources.map((source,ordinal)=>({id:['build','consumer','next'][ordinal],name:'artifact '+ordinal,boundary:'qualification',args:[source],timeout:10000,artifactRoots:ordinal===0?['dist']:[],execution:{executable:process.execPath,args:['-e',source],cwd:process.cwd(),name:'artifact '+ordinal,timeoutMilliseconds:10000,acceptedExitCodes:[0],relayParentSignals:false,terminationGraceMilliseconds:5000,processGroupAbsenceTimeoutMilliseconds:2000}}));
const logicalInvocation={mode:'check:all',commandArguments:[process.execPath,process.argv[1]],baseSha:${JSON.stringify(f.git("rev-parse", "HEAD^"))},stageManifest:manifest,toolExecutables:[]};logicalInvocation.formalClassification={version:1,status:'affected',baseSha:logicalInvocation.baseSha,headSha:undefined,changedPaths:['controlled-formal-input'],affectedPaths:['controlled-formal-input']};await executeResumableQualityGate({stageManifest:manifest,logicalInvocation,runStage:stage=>runBoundedCommand({executable:process.execPath,args:['-e',stage.args[0]],name:stage.name,timeoutMilliseconds:10000})});`
    )
    const result = launch(f.root, script)
    assert.equal(result.status, 1)
    assert.equal(readFileSync(join(f.root, "dist", "result"), "utf8"), "produced")
    assert.equal(spawnSync("test", ["-e", next]).status, 1)
    const evidence = runs(f.root)[0]
    assert.equal(evidence.resume.stages[0].outcome, "passed")
    assert.equal(evidence.resume.composite, undefined)
    assert.equal(evidence.qualification, "UNPROVEN")
  } finally {
    f.cleanup()
  }
})

void test("fresh platform setup precedes observation, ready diagnostics do not mutate, and resume preserves changed mode", () => {
  const f = fixture()
  try {
    const helper = new URL("./effect-tsgo-platform-binary.mjs", import.meta.url).href
    const platformRoot = join(f.root, "node_modules", "platform")
    mkdirSync(join(platformRoot, "lib"), { recursive: true })
    const binary = join(platformRoot, "lib", "tsc")
    writeFileSync(binary, "platform binary")
    chmodSync(binary, 0o644)
    const script = join(f.root, ".scratch", "quality.mjs")
    const packageJson = join(platformRoot, "package.json")
    const source = `import {ensureEffectTsgoPlatformBinaryExecutable} from ${JSON.stringify(helper)};ensureEffectTsgoPlatformBinaryExecutable({platform:'linux',resolvePackageJson:()=>${JSON.stringify(packageJson)}})`
    const late = "process.exit(23)"
    writeFileSync(
      script,
      `import {executeResumableQualityGate} from ${JSON.stringify(new URL(`file://${join(f.root, "scripts", "gate-quality-run.mjs")}`).href)};import {ensureEffectTsgoPlatformBinaryExecutable} from ${JSON.stringify(helper)};import {runBoundedCommand} from ${JSON.stringify(bounded)};
const sources=${JSON.stringify([source, late])};
const manifest=sources.map((source,ordinal)=>({id:'stage-'+ordinal,name:'stage '+ordinal,boundary:'qualification',args:[source],timeout:10000,artifactRoots:[],execution:{executable:process.execPath,args:['--input-type=module','-e',source],cwd:process.cwd(),name:'stage '+ordinal,timeoutMilliseconds:10000,acceptedExitCodes:[0],relayParentSignals:false,terminationGraceMilliseconds:5000,processGroupAbsenceTimeoutMilliseconds:2000}}));
const logicalInvocation={mode:'check:all',commandArguments:[process.execPath,process.argv[1]],baseSha:${JSON.stringify(f.git("rev-parse", "HEAD^"))},stageManifest:manifest,toolExecutables:[]};logicalInvocation.formalClassification={version:1,status:'affected',baseSha:logicalInvocation.baseSha,headSha:undefined,changedPaths:['controlled-formal-input'],affectedPaths:['controlled-formal-input']};await executeResumableQualityGate({logicalInvocation,stageManifest:manifest,resumeRunId:process.argv[2]?.slice('--resume='.length),prepareFreshInputs:()=>ensureEffectTsgoPlatformBinaryExecutable({platform:'linux',resolvePackageJson:()=>${JSON.stringify(packageJson)}}),runStage:stage=>runBoundedCommand({executable:process.execPath,args:['--input-type=module','-e',stage.args[0]],name:stage.name,timeoutMilliseconds:10000})});`
    )
    const fresh = launch(f.root, script)
    assert.equal(fresh.status, 1, fresh.stderr)
    assert.equal(statSync(binary).mode & 0o7777, 0o755)
    const prior = runs(f.root)[0]
    assert.equal(prior.resume.stages[0].outcome, "passed")
    assert.equal(prior.resume.guard.unchanged, true)
    chmodSync(binary, 0o644)
    const resumed = launch(f.root, script, prior.runId)
    assert.equal(resumed.status, 1, resumed.stderr)
    assert.match(resumed.stderr, /Resume refused/u)
    assert.equal(statSync(binary).mode & 0o7777, 0o644)
  } finally {
    f.cleanup()
  }
})
