#!/usr/bin/env node
/* eslint-disable import/no-nodejs-modules -- Executable fixture controls the external Git process boundary. */
import nodeProcess from "node:process"
import { spawnSync } from "node:child_process"
import { existsSync, renameSync, writeFileSync } from "node:fs"
import { setInterval as scheduleInterval } from "node:timers"

const firstUserArgumentIndex = 2
const invalidInputExitStatus = 2
const arguments_ = nodeProcess.argv.slice(firstUserArgumentIndex)
const holdsCleanupObservation =
  nodeProcess.env["DALPH_QUALIFICATION_MODE"] === "exit-during-attachment" &&
  arguments_.includes("worktree") &&
  arguments_.includes("list") &&
  arguments_.includes("--porcelain")

if (holdsCleanupObservation) {
  const observationFile = nodeProcess.env["DALPH_QUALIFICATION_CLEANUP_OBSERVATION"]
  const releaseFile = nodeProcess.env["DALPH_QUALIFICATION_CLEANUP_RELEASE"]
  if (observationFile === undefined || releaseFile === undefined) {
    nodeProcess.stderr.write("missing cleanup observation control\n")
    nodeProcess.exit(invalidInputExitStatus)
  }
  const temporaryObservationFile = `${observationFile}.${nodeProcess.pid}`
  writeFileSync(
    temporaryObservationFile,
    JSON.stringify({
      _tag: "CleanupGitObservationStarted",
      cleanupWorktree: nodeProcess.env["DALPH_QUALIFICATION_CLEANUP_WORKTREE"],
      commonDirectory: nodeProcess.env["DALPH_QUALIFICATION_COMMON_DIRECTORY"]
    })
  )
  renameSync(temporaryObservationFile, observationFile)
  const pollMilliseconds = 10
  scheduleInterval(() => {
    if (existsSync(releaseFile)) nodeProcess.exit(1)
  }, pollMilliseconds)
} else {
  const result = spawnSync("/usr/bin/git", arguments_, { stdio: "inherit" })
  nodeProcess.exit(result.status ?? 1)
}
