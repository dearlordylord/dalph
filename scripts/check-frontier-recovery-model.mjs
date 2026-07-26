import { spawnSync } from "node:child_process"

const pnpmEntryPoint = process.env.npm_execpath

if (pnpmEntryPoint === undefined) {
  throw new Error("Run this model gate through pnpm")
}

const model = "specs/frontierRecovery.qnt"
const tests = "specs/frontierRecovery_test.qnt"
const counterexamples =
  "specs/frontierRecovery_counterexamples.qnt"
const invariants = [
  "boundedCapacity",
  "everyEffectHasIntent",
  "noDuplicateAuthorityEffect",
  "everyRequestUsesItsIntentIdentity",
  "noStaleAuthorityUse",
  "everyTaskIsActionableOrExplained",
  "branchLocalConstraintDoesNotStopC",
  "finalityIsSubjectSpecific"
]

const run = (name, args) => {
  process.stdout.write(`\n== ${name} ==\n`)
  const result = spawnSync(process.execPath, [pnpmEntryPoint, ...args], {
    stdio: "inherit"
  })
  if (result.error !== undefined) throw result.error
  if (result.status !== 0) {
    throw new Error(`${name} failed with exit ${result.status}`)
  }
}

const expectInvariantFailure = (
  name,
  step,
  invariant,
  main = "frontierRecoveryCounterexamples"
) => {
  process.stdout.write(`\n== ${name} (expected invariant failure) ==\n`)
  const result = spawnSync(
    process.execPath,
    [
      pnpmEntryPoint,
      "quint",
      "verify",
      counterexamples,
      "--main",
      main,
      "--backend",
      "tlc",
      "--step",
      step,
      "--invariant",
      invariant,
      "--verbosity",
      "1"
    ],
    { encoding: "utf8", maxBuffer: 16 * 1024 * 1024 }
  )
  if (result.error !== undefined) throw result.error
  const output = `${result.stdout}${result.stderr}`
  if (result.status === 0 || !output.includes("[violation] Found an issue")) {
    process.stdout.write(output)
    throw new Error(`${name} did not produce the expected counterexample`)
  }
  process.stdout.write(`confirmed: ${invariant} rejects ${step}\n`)
}

for (const input of [model, tests, counterexamples]) {
  run(`typecheck ${input}`, ["quint", "typecheck", input])
}

run("deterministic acceptance scenarios", [
  "quint",
  "test",
  tests,
  "--main",
  "frontierRecoveryTest"
])
run("deterministic capacity-one acceptance scenario", [
  "quint",
  "test",
  tests,
  "--main",
  "frontierRecoveryCapacityOneTest"
])

const sampledProfiles = [
  {
    init: "init",
    name: "forward workflow witnesses",
    step: "progressStep",
    steps: "80",
    witnesses: [
      "firstIntentReached",
      "requestReached",
      "worktreeBoundaryReached",
      "invocationRunningReached",
      "invocationAcceptedReached",
      "promotionReached",
      "trackerCompletionReached",
      "taskSettlementReached"
    ]
  },
  {
    init: "initAnyBoundaryProfile",
    name: "crash and retry witnesses",
    step: "crashProfileStep",
    steps: "10",
    witnesses: ["crashRestartReached", "retryReached"]
  },
  {
    init: "initRunningInvocationProfile",
    name: "pause and independent progress witnesses",
    step: "pauseProfileStep",
    steps: "10",
    witnesses: ["pauseReached", "unaffectedBranchProgressReached"]
  },
  {
    init: "initReconciliationProfile",
    name: "isolation and branch progress witnesses",
    step: "reconciliationProfileStep",
    steps: "10",
    witnesses: ["isolationReached", "branchProgressDuringIsolationReached"]
  }
]

for (const profile of sampledProfiles) {
  run(profile.name, [
    "quint",
    "run",
    model,
    "--main",
    "frontierRecoveryCapacityTwo",
    "--init",
    profile.init,
    "--step",
    profile.step,
    "--invariants",
    ...invariants,
    "--witnesses",
    ...profile.witnesses,
    "--max-steps",
    profile.steps,
    "--max-samples",
    "10000",
    "--verbosity",
    "1"
  ])
}

const exhaustiveProfiles = [
  [
    "capacity one with two independently eligible tasks",
    "frontierRecoveryCapacityOne",
    "init",
    "reconstructionStep"
  ],
  [
    "capacity one prioritizes existing responsibility over a smaller fresh task",
    "frontierRecoveryCapacityOne",
    "initCapacityOneResponsibilityFirstProfile",
    "reconstructionStep"
  ],
  [
    "all boundaries",
    "frontierRecoveryCapacityTwo",
    "initAnyBoundaryProfile",
    "boundaryProfileStep"
  ],
  [
    "crash and restart at all boundaries",
    "frontierRecoveryCapacityTwo",
    "initAnyBoundaryProfile",
    "crashProfileStep"
  ],
  [
    "pause and resume",
    "frontierRecoveryCapacityTwo",
    "initRunningInvocationProfile",
    "pauseProfileStep"
  ],
  [
    "external reconciliation",
    "frontierRecoveryCapacityTwo",
    "initReconciliationProfile",
    "reconciliationProfileStep"
  ]
]
const invariantExpression = invariants.join(" and ")

for (const [name, main, init, step] of exhaustiveProfiles) {
  run(`exhaustive ${name}`, [
    "quint",
    "verify",
    model,
    "--main",
    main,
    "--backend",
    "tlc",
    "--init",
    init,
    "--step",
    step,
    "--invariant",
    invariantExpression,
    "--verbosity",
    "1"
  ])
}

expectInvariantFailure(
  "missing intent counterexample",
  "missingIntentStep",
  "everyEffectHasIntent"
)
expectInvariantFailure(
  "duplicate effect counterexample",
  "duplicateEffectStep",
  "noDuplicateAuthorityEffect"
)
expectInvariantFailure(
  "stale knowledge counterexample",
  "staleKnowledgeStep",
  "noStaleAuthorityUse"
)
expectInvariantFailure(
  "configured capacity counterexample",
  "weakenedCapacityStep",
  "boundedCapacity",
  "frontierRecoveryCapacityCounterexample"
)

process.stdout.write("\nCanonical frontier recovery model checks passed.\n")
