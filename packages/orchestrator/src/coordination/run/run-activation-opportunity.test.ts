import { AttemptId, RunId } from "@dalph/contracts"
import { Chunk } from "effect"
import { expect, it } from "vitest"
import {
  activeWorkAuthorityRefreshForOwner,
  activeWorkAuthorityRefreshSubjectsContain,
  activeWorkAuthorityRefreshSubjectsFor
} from "./run-activation-opportunity.js"

const runId = RunId.make("activation-opportunity-immutability-run")
const firstAttemptId = AttemptId.make("activation-opportunity-immutability-first")
const secondAttemptId = AttemptId.make("activation-opportunity-immutability-second")
const lateAttemptId = AttemptId.make("activation-opportunity-immutability-late")

const first = { attemptId: firstAttemptId, runId }
const second = { attemptId: secondAttemptId, runId }
const late = { attemptId: lateAttemptId, runId }

it("copies the caller collection and retains both exact captured subjects", () => {
  const callerSubjects = [first, second]
  const capturedSubjects = activeWorkAuthorityRefreshSubjectsFor(callerSubjects)

  callerSubjects.push(late)

  expect([...capturedSubjects]).toHaveLength(2)
  expect([...capturedSubjects]).toEqual(expect.arrayContaining([first, second]))
  expect(activeWorkAuthorityRefreshSubjectsContain(capturedSubjects, first)).toBe(true)
  expect(activeWorkAuthorityRefreshSubjectsContain(capturedSubjects, second)).toBe(true)
  expect(activeWorkAuthorityRefreshSubjectsContain(capturedSubjects, late)).toBe(false)
})

it("keeps the opportunity subjects persistent when a caller attempts to add authority", () => {
  const opportunity = activeWorkAuthorityRefreshForOwner(
    "Timer",
    activeWorkAuthorityRefreshSubjectsFor([first, second])
  )

  const attemptedMutation = Chunk.append(opportunity.subjects, late)

  expect(activeWorkAuthorityRefreshSubjectsContain(opportunity.subjects, late)).toBe(false)
  expect([...attemptedMutation].some(({ attemptId }) => attemptId === lateAttemptId)).toBe(true)
  expect("add" in opportunity.subjects).toBe(false)
})
