#!/usr/bin/env node

import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { homedir, tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { spawnSync } from "node:child_process"

const root = resolve(import.meta.dirname)
const requestedTool = process.argv[2]
const allowedTools = new Set(["lean", "agda", "dafny"])
const eventNames = [
  "claimIntentRecorded", "claimReleaseIntentRecorded", "attemptPlanned",
  "workAdmitted", "suspensionRequested", "resumeRequested",
  "worktreeIntentRecorded", "integrationSessionOpened", "promotionIntentRecorded",
  "candidateConstructionNonConvergent", "deliverySettled", "workflowRunBegun",
  "workflowRunTerminated", "capacityRevised", "directionApplied",
  "trackerFactsObserved", "claimRecordRead", "claimedTaskEligibilityObserved",
  "claimedTaskIneligible", "worktreeReconciliationObserved", "executorReported",
  "promotionOutcomeObserved", "targetHeadObserved"
]

if (requestedTool !== undefined && !allowedTools.has(requestedTool)) {
  process.stderr.write("usage: node prover-mutants.mjs [lean|agda|dafny]\n")
  process.exit(2)
}

const replaceExactlyOnce = (source, search, replacement, label) => {
  const first = source.indexOf(search)
  const last = source.lastIndexOf(search)
  if (first < 0 || first !== last) {
    throw new Error(`${label}: expected one mutation site, found ${first < 0 ? 0 : "more than one"}`)
  }
  return source.slice(0, first) + replacement + source.slice(first + search.length)
}

const configurations = {
  lean: {
    source: join(root, "lean", "Journal.lean"),
    filename: "Journal.lean",
    command: process.env.LEAN ?? join(homedir(), ".elan", "bin", "lean"),
    args: (file) => [file],
    cwd: join(root, "lean"),
    classification: /def Event\.kind[\s\S]*?inductive Phase/,
    mutants: [
      {
        name: "P1 missing event classification",
        search: "  | .directionApplied .. | .trackerFactsObserved .. | .targetHeadObserved _ => none\n",
        replacement: "  | .trackerFactsObserved .. | .targetHeadObserved _ => none\n"
      },
      {
        name: "P2 swaps prefix and suffix",
        search: "    fold tasks (p ++ q) = foldFrom (fold tasks p) q :=\n  List.foldl_append",
        replacement: "    fold tasks (q ++ p) = foldFrom (fold tasks p) q :=\n  List.foldl_append"
      },
      {
        name: "P3 unrelated events fail a region",
        search: "  else r\n\n/-- \"xs restricted to region A\"",
        replacement: "  else { r with failed := some \"unrelated event\" }\n\n/-- \"xs restricted to region A\""
      }
    ]
  },
  agda: {
    source: join(root, "agda", "Journal.agda"),
    filename: "Journal.agda",
    command: process.env.AGDA ?? join(homedir(), ".cache", "dalph-bakeoff", "agda", "agda"),
    args: (file) => ["--safe", file],
    cwd: join(root, "agda"),
    classification: /task-of-action[\s\S]*?task-of :/,
    mutants: [
      {
        name: "P1 missing event classification",
        search: "task-of-action (directionApplied _ _) = nothing\n",
        replacement: ""
      },
      {
        name: "P2 replays the prefix twice",
        search: "homomorphism m p q = foldl-append (step m) initial-state p q",
        replacement: "homomorphism m p q = foldl-append (step m) initial-state p p"
      },
      {
        name: "P3 shared events reset regions",
        search: "... | nothing = rs\n... | just owner = local-only-task m rs e owner",
        replacement: "... | nothing = regions initial-region initial-region\n... | just owner = local-only-task m rs e owner"
      }
    ]
  },
  dafny: {
    source: join(root, "dafny", "Journal.dfy"),
    filename: "Journal.dfy",
    command: process.env.DAFNY ?? join(homedir(), ".cache", "dalph-bakeoff", "dafny-arm64", "dafny"),
    args: (file) => ["verify", "--verification-time-limit", "30", file],
    cwd: join(root, "dafny"),
    classification: /function TaskOfAction[\s\S]*?function TaskOf\(/,
    mutants: [
      {
        name: "P1 missing event classification",
        search: "  case DirectionApplied(_, _) => None\n",
        replacement: ""
      },
      {
        name: "P2 swaps prefix and suffix",
        search: "lemma Homomorphism(model: Semantics, p: seq<Event>, q: seq<Event>)\n  ensures Fold(model, p + q) == FoldFrom(model, Fold(model, p), q)",
        replacement: "lemma Homomorphism(model: Semantics, p: seq<Event>, q: seq<Event>)\n  ensures Fold(model, q + p) == FoldFrom(model, Fold(model, p), q)"
      },
      {
        name: "P3 shared events reset regions",
        search: "  case None => regions\n  case Some(owner) =>",
        replacement: "  case None => InitialRegions()\n  case Some(owner) =>"
      }
    ]
  }
}

const selected = requestedTool === undefined ? Object.keys(configurations) : [requestedTool]
let failed = false

process.stdout.write("| Tool | Mutant | Expected | Result |\n|---|---|---|---|\n")

for (const tool of selected) {
  const configuration = configurations[tool]
  const source = readFileSync(configuration.source, "utf8")
  const classification = source.match(configuration.classification)?.[0]
  if (classification === undefined) {
    throw new Error(`${tool}: could not isolate the event classifiers`)
  }
  const missingEvents = eventNames.filter((name) => {
    const variants = [name, name[0].toUpperCase() + name.slice(1)]
    return !variants.some((variant) => classification.includes(variant))
  })
  if (missingEvents.length > 0) {
    throw new Error(`${tool}: event classifier missing ${missingEvents.join(", ")}`)
  }
  process.stdout.write(`| ${tool} | 23-event classifier parity | complete | complete |\n`)
  for (const mutant of configuration.mutants) {
    const directory = mkdtempSync(join(tmpdir(), `dalph-${tool}-mutant-`))
    const file = join(directory, configuration.filename)
    try {
      writeFileSync(
        file,
        replaceExactlyOnce(source, mutant.search, mutant.replacement, `${tool}/${mutant.name}`)
      )
      const result = spawnSync(configuration.command, configuration.args(file), {
        cwd: configuration.cwd,
        encoding: "utf8",
        timeout: 120_000
      })
      const rejected = result.status !== 0 && result.error === undefined
      if (!rejected) failed = true
      const detail = result.error === undefined
        ? `exit ${result.status ?? "signal"}`
        : result.error.code ?? result.error.message
      process.stdout.write(
        `| ${tool} | ${mutant.name} | rejected | ${rejected ? "rejected" : `**unexpected ${detail}**`} |\n`
      )
    } finally {
      rmSync(directory, { recursive: true, force: true })
    }
  }
}

process.exit(failed ? 1 : 0)
