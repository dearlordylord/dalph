import { expect, it } from "vitest"
import fc from "fast-check"
import { Option } from "effect"
import { TaskId } from "@dalph/contracts"
import { validSnapshot } from "../../test/task-dag.js"
import { FixtureTarget } from "../authorities/task-tracker/fixture/target.js"
import { JournalPosition } from "./identity.js"
import {
  appendBlockerClearEvidence,
  blockerClearEpisodeAt,
  emptyBlockerClearEvidence,
  observeBlockerClearProjection
} from "./blocker-clear-evidence.js"

const taskId = TaskId.make("blocker-subject")
const blockerId = TaskId.make("blocker-prerequisite")
const target = FixtureTarget.make("blocker-target")
const graph = (blocked: boolean) =>
  Option.some(
    validSnapshot({
      revision: String(blocked),
      tasks: [
        { id: taskId, lifecycle: { _tag: "Open" }, parentTaskId: null, prerequisiteIds: [blockerId] },
        {
          id: blockerId,
          lifecycle: { _tag: blocked ? "Open" : "CompletedSuccessfully" },
          parentTaskId: null,
          prerequisiteIds: []
        }
      ]
    })
  )
const blocked = graph(true)
const clear = graph(false)
const omitted = Option.some(
  validSnapshot({
    revision: "omitted",
    tasks: [{ id: blockerId, lifecycle: { _tag: "Open" }, parentTaskId: null, prerequisiteIds: [] }]
  })
)
const snapshots = [blocked, clear, omitted, Option.none()] as const

it("preserves blocked/clear chronology across older-snapshot reconfirmation and unknown task observations", () => {
  let index = emptyBlockerClearEvidence()
  for (const [offset, snapshot] of [blocked, clear, blocked, blocked, clear, omitted, Option.none()].entries())
    index = appendBlockerClearEvidence(index, target, JournalPosition.make(offset + 1), snapshot)
  expect(blockerClearEpisodeAt(index, { target, taskId, afterPosition: 0, throughPosition: 2 })).toEqual({
    blockerObservedAt: 1,
    blockerClearedAt: 2
  })
  expect(blockerClearEpisodeAt(index, { target, taskId, afterPosition: 0, throughPosition: 4 })).toBeUndefined()
  expect(blockerClearEpisodeAt(index, { target, taskId, afterPosition: 0, throughPosition: 7 })).toEqual({
    blockerObservedAt: 4,
    blockerClearedAt: 5
  })
  expect(blockerClearEpisodeAt(index, { target, taskId, afterPosition: 4, throughPosition: 7 })).toBeUndefined()
  expect(
    blockerClearEpisodeAt(index, {
      target: FixtureTarget.make("foreign"),
      taskId,
      afterPosition: 0,
      throughPosition: 7
    })
  ).toBeUndefined()
})

it("matches the raw blocked-then-clear existential oracle at generated cutoffs", () => {
  fc.assert(
    fc.property(
      fc.array(fc.integer({ min: 0, max: 3 }), { maxLength: 40 }),
      fc.nat(40),
      fc.nat(40),
      (values, cutoff, baseline) => {
        let index = emptyBlockerClearEvidence()
        for (const [offset, value] of values.entries())
          index = appendBlockerClearEvidence(
            index,
            target,
            JournalPosition.make(offset + 1),
            snapshots[value] ?? Option.none()
          )
        const positions = values
          .map((value, offset) => ({ value, position: offset + 1 }))
          .filter(({ position }) => position <= cutoff && position > baseline)
        const blockedAt = positions.findLast(({ value }) => value === 0)?.position
        const clearedAt =
          blockedAt === undefined
            ? undefined
            : positions.findLast(({ value, position }) => value === 1 && position > blockedAt)?.position
        expect(
          blockerClearEpisodeAt(index, { target, taskId, afterPosition: baseline, throughPosition: cutoff })
        ).toEqual(
          blockedAt === undefined || clearedAt === undefined
            ? undefined
            : { blockerObservedAt: blockedAt, blockerClearedAt: clearedAt }
        )
      }
    )
  )
})

it("shares consecutive reconfirmations while charging historical snapshot switches to their task fanout", () => {
  const counts = [64, 256].map((size) => {
    let index = emptyBlockerClearEvidence()
    index = appendBlockerClearEvidence(index, target, JournalPosition.make(1), blocked)
    index = appendBlockerClearEvidence(index, target, JournalPosition.make(2), clear)
    let visits = 0
    const stop = observeBlockerClearProjection(() => {
      visits += 1
    })
    try {
      index = appendBlockerClearEvidence(index, target, JournalPosition.make(3), blocked)
      const switchVisits = visits
      for (let offset = 0; offset < size; offset += 1)
        index = appendBlockerClearEvidence(index, target, JournalPosition.make(offset + 4), blocked)
      expect(visits).toBe(switchVisits)
      expect(
        blockerClearEpisodeAt(index, { target, taskId, afterPosition: 0, throughPosition: size + 3 })
      ).toBeUndefined()
      return switchVisits
    } finally {
      stop()
    }
  })
  expect(counts).toEqual([4, 4])
})
