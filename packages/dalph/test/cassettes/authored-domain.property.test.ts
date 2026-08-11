import { Schema } from "effect"
import * as fc from "fast-check"
import { expect, it } from "vitest"
import { AuthoredCassetteStoryItem } from "../../src/cassettes/index.js"

const tuple = <Values extends [unknown, ...Array<unknown>]>(...values: Values): Values => values

interface MutableFreshWorkflowProposal {
  readonly _tag: "FreshWorkflowRoute"
  correlation: { readonly _tag: "Task" } | { readonly _tag: "Attempt"; readonly attemptId: string }
  proposalId: string
  taskId: string
}

const authoredTrackerGraphReadResultArbitrary = fc.oneof(
  fc.constant({ _tag: "TrackerGraphReadFailed" as const, reason: "IncompleteSnapshot" as const }),
  fc
    .tuple(fc.string({ minLength: 1, maxLength: 24 }), fc.integer({ min: 0, max: 8 }))
    .map(([revision, taskCount]) => ({
      _tag: "TrackerGraphReadReturned" as const,
      graph: {
        revision,
        tasks: Array.from({ length: taskCount }, (_, index) => ({
          id: `task-${index}`,
          lifecycle: { _tag: "Open" as const },
          parentTaskId: null,
          prerequisiteIds: []
        }))
      }
    }))
)

const exactPauseWaitingArbitrary = fc
  .record({
    beganAt: fc.integer({ min: 1, max: 100 }),
    childSuffix: fc.string({ minLength: 1, maxLength: 12 }),
    parentSuffix: fc.string({ minLength: 1, maxLength: 12 })
  })
  .map(({ beganAt, childSuffix, parentSuffix }) => {
    const attemptId = `attempt:${childSuffix}:0`
    const taskId = `task:${childSuffix}`
    const responsibility = {
      _tag: "PlannedAttemptExecutorWork" as const,
      attemptId,
      beganAt,
      coverage: {
        _tag: "GroupingDescendantPauseCoverage" as const,
        groupingObservedAt: beganAt + 1,
        pausedTaskId: `parent-task:${parentSuffix}`
      },
      taskId
    }
    return {
      _tag: "PauseProgressObserved" as const,
      result: {
        _tag: "PauseWaiting" as const,
        atBoundary: Array<typeof responsibility>(),
        preventing: tuple({
          blockers: tuple(
            { _tag: "ExecutorSafeSuspensionRequired" as const, attemptId },
            {
              _tag: "LiveDeliveryAction" as const,
              owner: {
                _tag: "MaterializedDeliveryAction" as const,
                intent: "IntentRecorded" as const,
                operationId: `operation:suspend:${childSuffix}`,
                proposal: {
                  _tag: "IdentityFreeWorkflowRoute" as const,
                  correlation: { _tag: "PlannedAttempt" as const, attemptId },
                  proposalId: `proposal:suspend:${childSuffix}`,
                  taskId
                }
              }
            }
          ),
          responsibility
        })
      },
      subject: { _tag: "Task" as const, taskId: `parent-task:${parentSuffix}` }
    }
  })

const exactIntegrationPauseWaitingArbitrary = fc
  .record({ attemptSuffix: fc.string({ minLength: 1, maxLength: 12 }), queuedAt: fc.integer({ min: 1, max: 100 }) })
  .map(({ attemptSuffix, queuedAt }) => {
    const attemptId = `attempt:integration:${attemptSuffix}`
    const taskId = `task:integration:${attemptSuffix}`
    const proposal = {
      _tag: "IdentityFreeWorkflowRoute" as const,
      correlation: { _tag: "Integration" as const, attemptId, queuedAt },
      proposalId: `proposal:integration:${attemptSuffix}`,
      taskId
    }
    return {
      _tag: "PauseProgressObserved" as const,
      result: {
        _tag: "PauseWaiting" as const,
        atBoundary: [],
        preventing: tuple({
          blockers: tuple(
            { _tag: "ActiveIntegrationTarget" as const, queuedAt },
            { _tag: "ProposedDeliveryAction" as const, proposal }
          ),
          responsibility: {
            _tag: "QueuedIntegration" as const,
            attemptId,
            coverage: { _tag: "ExactTaskPauseCoverage" as const },
            queuedAt,
            taskId
          }
        })
      },
      subject: { _tag: "Task" as const, taskId }
    }
  })

const exactDeliveryActionPauseWaitingArbitrary = fc.string({ minLength: 1, maxLength: 12 }).map((suffix) => {
  const taskId = `task:delivery:${suffix}`
  const proposal: MutableFreshWorkflowProposal = {
    _tag: "FreshWorkflowRoute",
    correlation: { _tag: "Task" },
    proposalId: `proposal:delivery:${suffix}`,
    taskId
  }
  return {
    _tag: "PauseProgressObserved" as const,
    result: {
      _tag: "PauseWaiting" as const,
      atBoundary: [],
      preventing: tuple({
        blockers: tuple({ _tag: "ProposedDeliveryAction" as const, proposal }),
        responsibility: {
          _tag: "DeliveryAction" as const,
          coverage: { _tag: "ExactTaskPauseCoverage" as const },
          proposal: { ...proposal },
          taskId
        }
      })
    },
    subject: { _tag: "Task" as const, taskId }
  }
})

const exactSettledExecutorPauseWaitingArbitrary = exactPauseWaitingArbitrary.map((encoded) => {
  const [preventing] = encoded.result.preventing
  const [, liveAction] = preventing.blockers
  return {
    ...encoded,
    result: {
      ...encoded.result,
      preventing: tuple({
        ...preventing,
        blockers: tuple(preventing.blockers[0], {
          _tag: "AcceptedOutcomePublicationPending" as const,
          proposal: liveAction.owner.proposal
        })
      })
    }
  }
})

const exactWorkflowOperationPauseWaitingArbitrary = fc.string({ minLength: 1, maxLength: 12 }).map((suffix) => {
  const operationId = `operation:claim:${suffix}`
  const taskId = `task:claim:${suffix}`
  const proposal = {
    _tag: "AcceptedWorkflowRoute" as const,
    operationId,
    proposalId: `proposal:claim:${suffix}`,
    taskId
  }
  return {
    _tag: "PauseProgressObserved" as const,
    result: {
      _tag: "PauseWaiting" as const,
      atBoundary: [],
      preventing: tuple({
        blockers: tuple({ _tag: "AcceptedOutcomePublicationPending" as const, proposal }),
        responsibility: {
          _tag: "WorkflowOperation" as const,
          beganAt: 1,
          coverage: { _tag: "ExactTaskPauseCoverage" as const },
          operationId,
          responsibilityTag: "TaskClaimResponsibility" as const,
          taskId
        }
      })
    },
    subject: { _tag: "Task" as const, taskId }
  }
})

it("roundtrips arbitrary authored tracker graph outcomes through the story-item boundary", () => {
  fc.assert(
    fc.property(authoredTrackerGraphReadResultArbitrary, (encoded) => {
      expect(
        Schema.encodeUnknownSync(AuthoredCassetteStoryItem)(
          Schema.decodeUnknownSync(AuthoredCassetteStoryItem)(encoded)
        )
      ).toEqual(encoded)
    }),
    { numRuns: 100 }
  )
})

it("roundtrips valid exact Pause waiting observations", () => {
  fc.assert(
    fc.property(exactPauseWaitingArbitrary, (encoded) => {
      expect(
        Schema.encodeUnknownSync(AuthoredCassetteStoryItem)(
          Schema.decodeUnknownSync(AuthoredCassetteStoryItem)(encoded)
        )
      ).toEqual(encoded)
    }),
    { numRuns: 100 }
  )
})

it("roundtrips valid exact integration Pause waiting observations", () => {
  fc.assert(
    fc.property(exactIntegrationPauseWaitingArbitrary, (encoded) => {
      expect(
        Schema.encodeUnknownSync(AuthoredCassetteStoryItem)(
          Schema.decodeUnknownSync(AuthoredCassetteStoryItem)(encoded)
        )
      ).toEqual(encoded)
      const [preventing] = encoded.result.preventing
      const [, action] = preventing.blockers
      const held = {
        ...encoded,
        result: {
          ...encoded.result,
          preventing: tuple({
            ...preventing,
            blockers: tuple(
              { _tag: "HeldIntegrationTarget" as const, queuedAt: preventing.responsibility.queuedAt },
              action
            )
          })
        }
      }
      expect(Schema.decodeUnknownSync(AuthoredCassetteStoryItem)(held)).toBeDefined()
      expect(() =>
        Schema.decodeUnknownSync(AuthoredCassetteStoryItem)({
          ...held,
          result: {
            ...held.result,
            preventing: tuple({
              ...held.result.preventing[0],
              blockers: tuple(
                {
                  _tag: "HeldIntegrationTarget" as const,
                  queuedAt: held.result.preventing[0].responsibility.queuedAt + 1
                },
                action
              )
            })
          }
        })
      ).toThrow()
    }),
    { numRuns: 100 }
  )
})

it("validates every exact executor action route and boundary-only responsibility identity", () => {
  const taskId = "task:executor-routes"
  const attemptId = "attempt:executor-routes:0"
  const responsibility = {
    _tag: "PlannedAttemptExecutorWork" as const,
    attemptId,
    beganAt: 7,
    coverage: { _tag: "ExactTaskPauseCoverage" as const },
    taskId
  }
  const storyItem = (proposal: unknown) => ({
    _tag: "PauseProgressObserved" as const,
    result: {
      _tag: "PauseWaiting" as const,
      atBoundary: [
        {
          _tag: "AcceptedAwaitingIntegration" as const,
          attemptId: "attempt:accepted:0",
          coverage: { _tag: "ExactTaskPauseCoverage" as const },
          taskId: "task:accepted",
          terminalAt: 4
        }
      ],
      preventing: tuple({ blockers: tuple({ _tag: "ProposedDeliveryAction" as const, proposal }), responsibility })
    },
    subject: { _tag: "Task" as const, taskId }
  })
  const proposals = [
    { _tag: "FreshExecutorWorkflowRoute" as const, attemptId, proposalId: "proposal:fresh-executor", taskId },
    {
      _tag: "FreshWorkflowRoute" as const,
      correlation: { _tag: "Attempt" as const, attemptId },
      proposalId: "proposal:fresh",
      taskId
    },
    {
      _tag: "RecoveredNewActionRoute" as const,
      correlation: { _tag: "Attempt" as const, attemptId },
      proposalId: "proposal:recovered",
      taskId
    }
  ]
  for (const proposal of proposals) {
    expect(Schema.decodeUnknownSync(AuthoredCassetteStoryItem)(storyItem(proposal))).toBeDefined()
  }
  expect(() =>
    Schema.decodeUnknownSync(AuthoredCassetteStoryItem)(
      storyItem({
        _tag: "AcceptedWorkflowRoute",
        operationId: "operation:not-executor",
        proposalId: "proposal:accepted",
        taskId
      })
    )
  ).toThrow()
})

it("roundtrips a settled executor action awaiting accepted-outcome publication", () => {
  fc.assert(
    fc.property(exactSettledExecutorPauseWaitingArbitrary, (encoded) => {
      expect(Schema.decodeUnknownSync(AuthoredCassetteStoryItem)(encoded)).toBeDefined()
    }),
    { numRuns: 100 }
  )
})

it("roundtrips an exact workflow operation awaiting accepted-outcome publication", () => {
  fc.assert(
    fc.property(exactWorkflowOperationPauseWaitingArbitrary, (encoded) => {
      expect(Schema.decodeUnknownSync(AuthoredCassetteStoryItem)(encoded)).toBeDefined()
    }),
    { numRuns: 100 }
  )
})

it("rejects mutations that break an exact Pause responsibility correlation", () => {
  fc.assert(
    fc.property(
      exactPauseWaitingArbitrary,
      fc.constantFrom(
        "safe-attempt",
        "proposal-attempt",
        "proposal-task",
        "owner-operation",
        "coverage",
        "duplicate-blocker",
        "duplicate-responsibility" as const
      ),
      (encoded, mutation) => {
        const changed = structuredClone(encoded)
        const [preventing] = changed.result.preventing
        const [safeSuspension, liveAction] = preventing.blockers
        if (mutation === "safe-attempt") safeSuspension.attemptId = "attempt:other:0"
        if (mutation === "proposal-attempt") liveAction.owner.proposal.correlation.attemptId = "attempt:other:0"
        if (mutation === "proposal-task") liveAction.owner.proposal.taskId = "task:other"
        if (mutation === "owner-operation") liveAction.owner.operationId = ""
        if (mutation === "coverage") {
          preventing.responsibility.coverage.pausedTaskId = preventing.responsibility.taskId
        }
        if (mutation === "duplicate-blocker") preventing.blockers.push(safeSuspension)
        if (mutation === "duplicate-responsibility") changed.result.atBoundary.push(preventing.responsibility)
        expect(() => Schema.decodeUnknownSync(AuthoredCassetteStoryItem)(changed)).toThrow()
      }
    ),
    { numRuns: 100 }
  )
})

it("rejects one-field mutations of exact integration correlations", () => {
  fc.assert(
    fc.property(
      exactIntegrationPauseWaitingArbitrary,
      fc.constantFrom("target-position", "proposal-position", "proposal-attempt", "proposal-task" as const),
      (encoded, mutation) => {
        const changed = structuredClone(encoded)
        const [preventing] = changed.result.preventing
        const [target, proposed] = preventing.blockers
        if (mutation === "target-position") target.queuedAt += 1
        if (mutation === "proposal-position") proposed.proposal.correlation.queuedAt += 1
        if (mutation === "proposal-attempt") proposed.proposal.correlation.attemptId = "attempt:other"
        if (mutation === "proposal-task") proposed.proposal.taskId = "task:other"
        expect(() => Schema.decodeUnknownSync(AuthoredCassetteStoryItem)(changed)).toThrow()
      }
    ),
    { numRuns: 100 }
  )
})

it("rejects one-field mutations of exact delivery proposal identity", () => {
  fc.assert(
    fc.property(
      exactDeliveryActionPauseWaitingArbitrary,
      fc.constantFrom("proposal-id", "route", "task" as const),
      (encoded, mutation) => {
        const changed = structuredClone(encoded)
        const [preventing] = changed.result.preventing
        const [proposed] = preventing.blockers
        if (mutation === "proposal-id") proposed.proposal.proposalId = "proposal:other"
        if (mutation === "route") proposed.proposal.correlation = { _tag: "Attempt", attemptId: "attempt:other" }
        if (mutation === "task") proposed.proposal.taskId = "task:other"
        expect(() => Schema.decodeUnknownSync(AuthoredCassetteStoryItem)(changed)).toThrow()
      }
    ),
    { numRuns: 100 }
  )
})

it("rejects a settled executor blocker whose exact attempt identity changed", () => {
  fc.assert(
    fc.property(exactSettledExecutorPauseWaitingArbitrary, (encoded) => {
      const [preventing] = encoded.result.preventing
      const [safe, pending] = preventing.blockers
      const changed = {
        ...encoded,
        result: {
          ...encoded.result,
          preventing: tuple({
            ...preventing,
            blockers: tuple(safe, {
              ...pending,
              proposal: {
                ...pending.proposal,
                correlation: { ...pending.proposal.correlation, attemptId: "attempt:other" }
              }
            })
          })
        }
      }
      expect(() => Schema.decodeUnknownSync(AuthoredCassetteStoryItem)(changed)).toThrow()
    }),
    { numRuns: 100 }
  )
})

it("rejects a settled workflow blocker whose exact operation identity changed", () => {
  fc.assert(
    fc.property(exactWorkflowOperationPauseWaitingArbitrary, (encoded) => {
      const [preventing] = encoded.result.preventing
      const [pending] = preventing.blockers
      const changed = {
        ...encoded,
        result: {
          ...encoded.result,
          preventing: tuple({
            ...preventing,
            blockers: tuple({ ...pending, proposal: { ...pending.proposal, operationId: "operation:other" } })
          })
        }
      }
      expect(() => Schema.decodeUnknownSync(AuthoredCassetteStoryItem)(changed)).toThrow()
    }),
    { numRuns: 100 }
  )
})
