import { it } from "@effect/vitest"
import { Cause, Deferred, Effect, Exit, Fiber, Option, Schema } from "effect"
import { describe, expect } from "vitest"
import { AttemptId, TaskId } from "@dalph/contracts"
import { OperationId, TrackerTarget } from "@dalph/orchestrator"
import { AuthoredCassetteStoryItem } from "../../src/cassettes/authored-domain.js"
import {
  authoredConcurrentGraphReadCause,
  makeStoryCursor,
  type StoryCursor
} from "../../src/cassettes/authored-cursor.js"

const aAttemptId = AttemptId.make("attempt:A:0")
const bAttemptId = AttemptId.make("attempt:B:1")
const cAttemptId = AttemptId.make("attempt:C:1")
const dAttemptId = AttemptId.make("attempt:D:1")
const eAttemptId = AttemptId.make("attempt:E:1")

const dPlanOperation = { _tag: "RecordTaskAttemptPlan", attemptId: dAttemptId, taskId: TaskId.make("D") } as const
const ePlanOperation = { _tag: "RecordTaskAttemptPlan", attemptId: eAttemptId, taskId: TaskId.make("E") } as const
const bWorktreeOperation = { _tag: "ReconcileTaskWorktree", attemptId: bAttemptId, taskId: TaskId.make("B") } as const
const cWorktreeOperation = { _tag: "ReconcileTaskWorktree", attemptId: cAttemptId, taskId: TaskId.make("C") } as const
const dWorktreeOperation = { _tag: "ReconcileTaskWorktree", attemptId: dAttemptId, taskId: TaskId.make("D") } as const
const eWorktreeOperation = { _tag: "ReconcileTaskWorktree", attemptId: eAttemptId, taskId: TaskId.make("E") } as const

const concurrentNode = (
  role: string,
  predecessorRoles: ReadonlyArray<string>,
  interaction: Readonly<Record<string, unknown>>
) => ({ interaction, predecessorRoles, role })

const concurrentGroup = Schema.decodeUnknownSync(AuthoredCassetteStoryItem)({
  _tag: "ConcurrentInteractionGroup",
  members: [
    concurrentNode("P_D", [], { _tag: "DalphSelects", operation: dPlanOperation }),
    concurrentNode("P_E", [], { _tag: "DalphSelects", operation: ePlanOperation }),
    concurrentNode("W_B", [], { _tag: "DalphSelects", operation: bWorktreeOperation }),
    concurrentNode("W_C", [], { _tag: "DalphSelects", operation: cWorktreeOperation }),
    concurrentNode("X_A", [], {
      _tag: "PlannedAttemptExecutorWorkReported",
      report: { _tag: "ExecutorWorkExecuting", attemptId: aAttemptId },
      request: "Begin"
    }),
    concurrentNode("W_D", ["P_D"], { _tag: "DalphSelects", operation: dWorktreeOperation }),
    concurrentNode("W_E", ["P_E"], { _tag: "DalphSelects", operation: eWorktreeOperation }),
    concurrentNode("X_B", ["W_B"], {
      _tag: "PlannedAttemptExecutorWorkReported",
      report: { _tag: "ExecutorWorkExecuting", attemptId: bAttemptId },
      request: "Begin"
    }),
    concurrentNode("X_C", ["W_C"], {
      _tag: "PlannedAttemptExecutorWorkReported",
      report: { _tag: "ExecutorWorkExecuting", attemptId: cAttemptId },
      request: "Begin"
    })
  ]
})
const activationReturn = AuthoredCassetteStoryItem.cases.CoordinatorActivationReturned.make({
  decision: { _tag: "RunMustRemainActive", reason: "UnsettledResponsibility" }
})
const story = [concurrentGroup, activationReturn]

it("rejects two activation returns even when their decisions differ", () => {
  expect(() =>
    Schema.decodeUnknownSync(AuthoredCassetteStoryItem)({
      _tag: "ConcurrentInteractionGroup",
      members: [
        concurrentNode("return-active", [], {
          _tag: "CoordinatorActivationReturned",
          decision: { _tag: "RunMustRemainActive", reason: "UnsettledResponsibility" }
        }),
        concurrentNode("return-terminal", [], {
          _tag: "CoordinatorActivationReturned",
          decision: { _tag: "RunMayTerminate" }
        })
      ]
    })
  ).toThrow(/at most one coordinator activation return/)
})

it.effect("rejects an unsupported concurrent graph cause without advancing the group", () =>
  Effect.gen(function* () {
    const group = yield* Schema.decodeUnknownEffect(AuthoredCassetteStoryItem)({
      _tag: "ConcurrentInteractionGroup",
      members: [
        concurrentNode("restart-graph", [], {
          _tag: "TrackerGraphReadReturned",
          cause: "AttemptRestartAuthorityCheck",
          graph: { revision: "revision-1", tasks: [] }
        })
      ]
    })
    const cursor = yield* makeStoryCursor([group])
    const failure = yield* cursor
      .consumeTrackerGraphFor(yield* Schema.decodeUnknownEffect(TrackerTarget)("cassette-target"), {
        graphReadCause: authoredConcurrentGraphReadCause("UnsupportedGraphCause"),
        operationId: OperationId.make("unsupported-graph-cause"),
        predecessorOperationIds: []
      })
      .pipe(Effect.flip)

    expect(failure._tag).toBe("AuthoredCassetteInteractionMismatch")
    expect(yield* cursor.storyPosition).toBe(0)
  })
)

const taskA = TaskId.make("A")
const taskB = TaskId.make("B")
const taskC = TaskId.make("C")
const taskD = TaskId.make("D")
const activeCAttemptId = AttemptId.make("attempt:C:2")
const activeDAttemptId = AttemptId.make("attempt:D:3")

const readASpecification = { _tag: "ReadTaskWorkSpecification", taskId: taskA } as const
const readBSpecification = { _tag: "ReadTaskWorkSpecification", taskId: taskB } as const
const readCSpecification = { _tag: "ReadTaskWorkSpecification", taskId: taskC } as const
const readDSpecification = { _tag: "ReadTaskWorkSpecification", taskId: taskD } as const
const readAClaim = { _tag: "ReadTaskClaim", taskId: taskA } as const
const readCClaim = { _tag: "ReadTaskClaim", taskId: taskC } as const
const readDClaim = { _tag: "ReadTaskClaim", taskId: taskD } as const
const readAWorktree = { _tag: "ReadTaskWorktree", attemptId: aAttemptId, taskId: taskA } as const
const readCWorktree = { _tag: "ReadTaskWorktree", attemptId: activeCAttemptId, taskId: taskC } as const
const readDWorktree = { _tag: "ReadTaskWorktree", attemptId: activeDAttemptId, taskId: taskD } as const
const readALineage = { _tag: "ReadTargetLineage", attemptId: aAttemptId, taskId: taskA } as const
const readCLineage = { _tag: "ReadTargetLineage", attemptId: activeCAttemptId, taskId: taskC } as const
const readDLineage = { _tag: "ReadTargetLineage", attemptId: activeDAttemptId, taskId: taskD } as const

const aSpecification = {
  _tag: "TaskWorkSpecificationReadReturned",
  body: "Implement A from F1.",
  taskId: taskA,
  title: "A F1"
} as const
const bSpecification = {
  _tag: "TaskWorkSpecificationReadReturned",
  body: "Implement B from F2.",
  taskId: taskB,
  title: "B F2"
} as const
const cSpecification = {
  _tag: "TaskWorkSpecificationReadReturned",
  body: "Implement C from F1.",
  taskId: taskC,
  title: "C F1"
} as const
const dSpecification = {
  _tag: "TaskWorkSpecificationReadReturned",
  body: "Implement D from F1.",
  taskId: taskD,
  title: "D F1"
} as const
const aClaimReturned = { _tag: "TaskClaimCurrentReadReturned", taskId: taskA } as const
const cClaimReturned = { _tag: "TaskClaimCurrentReadReturned", taskId: taskC } as const
const dClaimReturned = { _tag: "TaskClaimCurrentReadReturned", taskId: taskD } as const

const initialAuthorityGroup = Schema.decodeUnknownSync(AuthoredCassetteStoryItem.cases.ConcurrentInteractionGroup)({
  _tag: "ConcurrentInteractionGroup",
  members: [
    concurrentNode("S_A", [], { _tag: "DalphSelects", operation: readASpecification }),
    concurrentNode("T_A", ["S_A"], aSpecification),
    concurrentNode("Q_A", ["T_A"], { _tag: "DalphSelects", operation: readAClaim }),
    concurrentNode("R_A", ["Q_A"], aClaimReturned),
    concurrentNode("W_A", ["R_A"], { _tag: "DalphSelects", operation: readAWorktree }),
    concurrentNode("L_A", ["W_A"], { _tag: "DalphSelects", operation: readALineage }),
    concurrentNode("S_B", [], { _tag: "DalphSelects", operation: readBSpecification }),
    concurrentNode("T_B", ["S_B"], bSpecification),
    concurrentNode("S_C", [], { _tag: "DalphSelects", operation: readCSpecification }),
    concurrentNode("T_C", ["S_C"], cSpecification),
    concurrentNode("Q_C", ["T_C"], { _tag: "DalphSelects", operation: readCClaim }),
    concurrentNode("R_C", ["Q_C"], cClaimReturned),
    concurrentNode("W_C", ["R_C"], { _tag: "DalphSelects", operation: readCWorktree }),
    concurrentNode("L_C", ["W_C"], { _tag: "DalphSelects", operation: readCLineage })
  ]
})

const laterAuthorityGroup = Schema.decodeUnknownSync(AuthoredCassetteStoryItem.cases.ConcurrentInteractionGroup)({
  _tag: "ConcurrentInteractionGroup",
  members: [
    concurrentNode("S_A", [], { _tag: "DalphSelects", operation: readASpecification }),
    concurrentNode("T_A", ["S_A"], aSpecification),
    concurrentNode("Q_A", ["T_A"], { _tag: "DalphSelects", operation: readAClaim }),
    concurrentNode("R_A", ["Q_A"], aClaimReturned),
    concurrentNode("W_A", ["R_A"], { _tag: "DalphSelects", operation: readAWorktree }),
    concurrentNode("L_A", ["W_A"], { _tag: "DalphSelects", operation: readALineage }),
    concurrentNode("S_D", [], { _tag: "DalphSelects", operation: readDSpecification }),
    concurrentNode("T_D", ["S_D"], dSpecification),
    concurrentNode("Q_D", ["T_D"], { _tag: "DalphSelects", operation: readDClaim }),
    concurrentNode("R_D", ["Q_D"], dClaimReturned),
    concurrentNode("W_D", ["R_D"], { _tag: "DalphSelects", operation: readDWorktree }),
    concurrentNode("L_D", ["W_D"], { _tag: "DalphSelects", operation: readDLineage })
  ]
})

const bSuspend = AuthoredCassetteStoryItem.cases.PlannedAttemptExecutorWorkReported.make({
  report: { _tag: "ExecutorWorkExecuting", attemptId: bAttemptId },
  request: "Suspend"
})
const cSuspend = AuthoredCassetteStoryItem.cases.PlannedAttemptExecutorWorkReported.make({
  report: { _tag: "ExecutorWorkExecuting", attemptId: activeCAttemptId },
  request: "Suspend"
})
const initialAuthorityStory = [initialAuthorityGroup, bSuspend]
const laterAuthorityStory = [laterAuthorityGroup, cSuspend]

const causalGroupRoles = ["P_D", "P_E", "W_B", "W_C", "X_A", "W_D", "W_E", "X_B", "X_C"] as const
type CausalGroupRole = (typeof causalGroupRoles)[number]

const predecessorRoles: Readonly<Record<CausalGroupRole, ReadonlyArray<CausalGroupRole>>> = {
  P_D: [],
  P_E: [],
  W_B: [],
  W_C: [],
  X_A: [],
  W_D: ["P_D"],
  W_E: ["P_E"],
  X_B: ["W_B"],
  X_C: ["W_C"]
}

const consumeMember = (cursor: StoryCursor, role: CausalGroupRole) => {
  switch (role) {
    case "P_D":
      return cursor.consumeDalphSelectionFor(dPlanOperation).pipe(Effect.asVoid)
    case "P_E":
      return cursor.consumeDalphSelectionFor(ePlanOperation).pipe(Effect.asVoid)
    case "W_B":
      return cursor.consumeDalphSelectionFor(bWorktreeOperation).pipe(Effect.asVoid)
    case "W_C":
      return cursor.consumeDalphSelectionFor(cWorktreeOperation).pipe(Effect.asVoid)
    case "W_D":
      return cursor.consumeDalphSelectionFor(dWorktreeOperation).pipe(Effect.asVoid)
    case "W_E":
      return cursor.consumeDalphSelectionFor(eWorktreeOperation).pipe(Effect.asVoid)
    case "X_A":
      return cursor.consumeExecutorReportFor("Begin", aAttemptId).pipe(Effect.asVoid)
    case "X_B":
      return cursor.consumeExecutorReportFor("Begin", bAttemptId).pipe(Effect.asVoid)
    case "X_C":
      return cursor.consumeExecutorReportFor("Begin", cAttemptId).pipe(Effect.asVoid)
  }
}

function* legalCausalOrders(
  consumed: ReadonlyArray<CausalGroupRole> = [],
  outstanding: ReadonlyArray<CausalGroupRole> = causalGroupRoles
): Generator<ReadonlyArray<CausalGroupRole>> {
  if (outstanding.length === 0) {
    yield consumed
    return
  }
  for (const [index, role] of outstanding.entries()) {
    if (!predecessorRoles[role].every((predecessor) => consumed.includes(predecessor))) continue
    yield* legalCausalOrders([...consumed, role], [...outstanding.slice(0, index), ...outstanding.slice(index + 1)])
  }
}

const allLegalCausalOrders = [...legalCausalOrders()]
const causalRootRoles = ["P_D", "P_E", "W_B", "W_C", "X_A"] as const
const causalOrderFingerprint = (order: ReadonlyArray<CausalGroupRole>): string => JSON.stringify(order)
const causalRootShards = causalRootRoles.map((root) => ({
  orders: allLegalCausalOrders.filter((order) => order[0] === root),
  root
}))

const failCausalOrder = (
  root: (typeof causalRootRoles)[number],
  orderIndex: number,
  order: ReadonlyArray<CausalGroupRole>,
  phase: string,
  detail: string
): never => {
  return expect.fail(`causal ${root} shard order ${orderIndex} [${order.join(", ")}] failed ${phase}: ${detail}`)
}

const isExactActivationReturn = (item: AuthoredCassetteStoryItem): boolean =>
  item._tag === "CoordinatorActivationReturned" &&
  item.decision._tag === "RunMustRemainActive" &&
  item.decision.reason === "UnsettledResponsibility"

const initialALane = ["S_A", "T_A", "Q_A", "R_A", "W_A", "L_A"] as const
const initialBLane = ["S_B", "T_B"] as const
const initialCLane = ["S_C", "T_C", "Q_C", "R_C", "W_C", "L_C"] as const
const initialAuthorityRoles = [...initialALane, ...initialBLane, ...initialCLane] as const
type InitialAuthorityRole = (typeof initialAuthorityRoles)[number]

const laterALane = ["S_A", "T_A", "Q_A", "R_A", "W_A", "L_A"] as const
const laterDLane = ["S_D", "T_D", "Q_D", "R_D", "W_D", "L_D"] as const
const laterAuthorityRoles = [...laterALane, ...laterDLane] as const
type LaterAuthorityRole = (typeof laterAuthorityRoles)[number]

const initialAuthorityEdges: ReadonlyArray<readonly [InitialAuthorityRole, InitialAuthorityRole]> = [
  ["S_A", "T_A"],
  ["T_A", "Q_A"],
  ["Q_A", "R_A"],
  ["R_A", "W_A"],
  ["W_A", "L_A"],
  ["S_B", "T_B"],
  ["S_C", "T_C"],
  ["T_C", "Q_C"],
  ["Q_C", "R_C"],
  ["R_C", "W_C"],
  ["W_C", "L_C"]
]
const laterAuthorityEdges: ReadonlyArray<readonly [LaterAuthorityRole, LaterAuthorityRole]> = [
  ["S_A", "T_A"],
  ["T_A", "Q_A"],
  ["Q_A", "R_A"],
  ["R_A", "W_A"],
  ["W_A", "L_A"],
  ["S_D", "T_D"],
  ["T_D", "Q_D"],
  ["Q_D", "R_D"],
  ["R_D", "W_D"],
  ["W_D", "L_D"]
]

const consumeInitialAuthorityMember = (cursor: StoryCursor, role: InitialAuthorityRole) => {
  switch (role) {
    case "S_A":
      return cursor.consumeDalphSelectionFor(readASpecification).pipe(Effect.asVoid)
    case "T_A":
      return cursor.consumeTaskWorkSpecificationFor(taskA).pipe(Effect.asVoid)
    case "Q_A":
      return cursor.consumeDalphSelectionFor(readAClaim).pipe(Effect.asVoid)
    case "R_A":
      return cursor.consumeTaskClaimReadFor(taskA).pipe(Effect.asVoid)
    case "W_A":
      return cursor.consumeDalphSelectionFor(readAWorktree).pipe(Effect.asVoid)
    case "L_A":
      return cursor.consumeDalphSelectionFor(readALineage).pipe(Effect.asVoid)
    case "S_B":
      return cursor.consumeDalphSelectionFor(readBSpecification).pipe(Effect.asVoid)
    case "T_B":
      return cursor.consumeTaskWorkSpecificationFor(taskB).pipe(Effect.asVoid)
    case "S_C":
      return cursor.consumeDalphSelectionFor(readCSpecification).pipe(Effect.asVoid)
    case "T_C":
      return cursor.consumeTaskWorkSpecificationFor(taskC).pipe(Effect.asVoid)
    case "Q_C":
      return cursor.consumeDalphSelectionFor(readCClaim).pipe(Effect.asVoid)
    case "R_C":
      return cursor.consumeTaskClaimReadFor(taskC).pipe(Effect.asVoid)
    case "W_C":
      return cursor.consumeDalphSelectionFor(readCWorktree).pipe(Effect.asVoid)
    case "L_C":
      return cursor.consumeDalphSelectionFor(readCLineage).pipe(Effect.asVoid)
  }
}

const consumeLaterAuthorityMember = (cursor: StoryCursor, role: LaterAuthorityRole) => {
  switch (role) {
    case "S_A":
      return cursor.consumeDalphSelectionFor(readASpecification).pipe(Effect.asVoid)
    case "T_A":
      return cursor.consumeTaskWorkSpecificationFor(taskA).pipe(Effect.asVoid)
    case "Q_A":
      return cursor.consumeDalphSelectionFor(readAClaim).pipe(Effect.asVoid)
    case "R_A":
      return cursor.consumeTaskClaimReadFor(taskA).pipe(Effect.asVoid)
    case "W_A":
      return cursor.consumeDalphSelectionFor(readAWorktree).pipe(Effect.asVoid)
    case "L_A":
      return cursor.consumeDalphSelectionFor(readALineage).pipe(Effect.asVoid)
    case "S_D":
      return cursor.consumeDalphSelectionFor(readDSpecification).pipe(Effect.asVoid)
    case "T_D":
      return cursor.consumeTaskWorkSpecificationFor(taskD).pipe(Effect.asVoid)
    case "Q_D":
      return cursor.consumeDalphSelectionFor(readDClaim).pipe(Effect.asVoid)
    case "R_D":
      return cursor.consumeTaskClaimReadFor(taskD).pipe(Effect.asVoid)
    case "W_D":
      return cursor.consumeDalphSelectionFor(readDWorktree).pipe(Effect.asVoid)
    case "L_D":
      return cursor.consumeDalphSelectionFor(readDLineage).pipe(Effect.asVoid)
  }
}

function* initialFixedLaneOrders(
  aIndex = 0,
  bIndex = 0,
  cIndex = 0,
  prefix: ReadonlyArray<InitialAuthorityRole> = []
): Generator<ReadonlyArray<InitialAuthorityRole>> {
  if (aIndex === initialALane.length && bIndex === initialBLane.length && cIndex === initialCLane.length) {
    yield prefix
    return
  }
  const nextA = initialALane[aIndex]
  if (nextA !== undefined) yield* initialFixedLaneOrders(aIndex + 1, bIndex, cIndex, [...prefix, nextA])
  const nextB = initialBLane[bIndex]
  if (nextB !== undefined) yield* initialFixedLaneOrders(aIndex, bIndex + 1, cIndex, [...prefix, nextB])
  const nextC = initialCLane[cIndex]
  if (nextC !== undefined) yield* initialFixedLaneOrders(aIndex, bIndex, cIndex + 1, [...prefix, nextC])
}

function* laterFixedLaneOrders(
  aIndex = 0,
  dIndex = 0,
  prefix: ReadonlyArray<LaterAuthorityRole> = []
): Generator<ReadonlyArray<LaterAuthorityRole>> {
  if (aIndex === laterALane.length && dIndex === laterDLane.length) {
    yield prefix
    return
  }
  const nextA = laterALane[aIndex]
  if (nextA !== undefined) yield* laterFixedLaneOrders(aIndex + 1, dIndex, [...prefix, nextA])
  const nextD = laterDLane[dIndex]
  if (nextD !== undefined) yield* laterFixedLaneOrders(aIndex, dIndex + 1, [...prefix, nextD])
}

const allInitialFixedLaneOrders = [...initialFixedLaneOrders()]
const allLaterFixedLaneOrders = [...laterFixedLaneOrders()]
type ConcurrentGroup = Extract<AuthoredCassetteStoryItem, { readonly _tag: "ConcurrentInteractionGroup" }>
const fixedLaneFingerprint = (order: ReadonlyArray<string>): string => order.join("|")
const directEdgeFingerprints = (group: ConcurrentGroup): ReadonlySet<string> =>
  new Set(
    group.members.flatMap(({ predecessorRoles, role }) =>
      predecessorRoles.map((predecessorRole) => `${predecessorRole}->${role}`)
    )
  )
const expectedEdgeFingerprints = <Role extends string>(
  edges: ReadonlyArray<readonly [Role, Role]>
): ReadonlySet<string> => new Set(edges.map(([predecessor, successor]) => `${predecessor}->${successor}`))
const lanePositions = (order: ReadonlyArray<string>, lane: ReadonlyArray<string>): string =>
  lane.map((role) => order.indexOf(role)).join(",")
const initialLanePositionFingerprint = (order: ReadonlyArray<InitialAuthorityRole>): string =>
  [lanePositions(order, initialALane), lanePositions(order, initialBLane), lanePositions(order, initialCLane)].join("|")
const laterLanePositionFingerprint = (order: ReadonlyArray<LaterAuthorityRole>): string =>
  [lanePositions(order, laterALane), lanePositions(order, laterDLane)].join("|")
const initialBLanePositionFingerprint = (order: ReadonlyArray<InitialAuthorityRole>): string =>
  lanePositions(order, initialBLane)

const initialAuthorityLanes: ReadonlyArray<ReadonlyArray<InitialAuthorityRole>> = [
  initialALane,
  initialBLane,
  initialCLane
]
const laterAuthorityLanes: ReadonlyArray<ReadonlyArray<LaterAuthorityRole>> = [laterALane, laterDLane]
const rolesBefore = <Role extends string>(
  lanes: ReadonlyArray<ReadonlyArray<Role>>,
  role: Role
): ReadonlyArray<Role> => {
  const lane = lanes.find((candidate) => candidate.includes(role))
  if (lane === undefined) return expect.fail(`authority role ${role} belongs to no fixed lane`)
  return lane.slice(0, lane.indexOf(role))
}

const initialOrdersByBLanePositions = allInitialFixedLaneOrders.reduce((buckets, order) => {
  const fingerprint = initialBLanePositionFingerprint(order)
  const current = buckets.get(fingerprint)
  if (current === undefined) buckets.set(fingerprint, [order])
  else current.push(order)
  return buckets
}, new Map<string, Array<ReadonlyArray<InitialAuthorityRole>>>())
const initialBLanePositionBuckets = [...initialOrdersByBLanePositions.entries()]
const initialBLaneBucketsPerScheduleChunk = 3
const initialScheduleChunks = Array.from(
  { length: Math.ceil(initialBLanePositionBuckets.length / initialBLaneBucketsPerScheduleChunk) },
  (_, index) =>
    initialBLanePositionBuckets
      .slice(
        index * initialBLaneBucketsPerScheduleChunk,
        index * initialBLaneBucketsPerScheduleChunk + initialBLaneBucketsPerScheduleChunk
      )
      .flatMap(([, orders]) => orders)
)

type ExecutingReport = Extract<AuthoredCassetteStoryItem, { readonly _tag: "PlannedAttemptExecutorWorkReported" }>

const executeAuthoritySchedules = <Role extends string>(
  label: string,
  orders: ReadonlyArray<ReadonlyArray<Role>>,
  group: ConcurrentGroup,
  successor: ExecutingReport,
  consumeMemberForRole: (cursor: StoryCursor, role: Role) => Effect.Effect<void, unknown>
) =>
  Effect.gen(function* () {
    const shardStory = orders.flatMap(() => [group, successor])
    let occurrenceCount = 0
    let latestOccurrence: { readonly item: AuthoredCassetteStoryItem; readonly storyPosition: number } | undefined
    const cursor = yield* makeStoryCursor(shardStory, {
      onOccurrence: (occurrence) =>
        Effect.sync(() => {
          occurrenceCount += 1
          latestOccurrence = occurrence
        })
    })

    for (const [orderIndex, order] of orders.entries()) {
      const groupPosition = orderIndex * 2
      for (const [memberIndex, role] of order.entries()) {
        if (memberIndex === order.length - 1) {
          if ((yield* cursor.storyPosition) !== groupPosition || occurrenceCount !== groupPosition) {
            return yield* Effect.die(`${label} order ${orderIndex} advanced or published before its final member`)
          }
        }
        yield* consumeMemberForRole(cursor, role)
      }
      if ((yield* cursor.storyPosition) !== groupPosition + 1 || occurrenceCount !== groupPosition + 1) {
        return yield* Effect.die(`${label} order ${orderIndex} did not publish and advance exactly once`)
      }
      if (latestOccurrence?.item !== group || latestOccurrence.storyPosition !== groupPosition + 1) {
        return yield* Effect.die(`${label} order ${orderIndex} published the wrong group occurrence`)
      }

      const returned = yield* cursor.consumeExecutorReportFor("Suspend", successor.report.attemptId)
      if (
        returned.request !== "Suspend" ||
        returned.report._tag !== "ExecutorWorkExecuting" ||
        returned.report.attemptId !== successor.report.attemptId
      ) {
        return yield* Effect.die(`${label} order ${orderIndex} crossed into the wrong strict successor`)
      }
      if ((yield* cursor.storyPosition) !== groupPosition + 2 || occurrenceCount !== groupPosition + 2) {
        return yield* Effect.die(`${label} order ${orderIndex} did not settle its strict successor exactly once`)
      }
    }

    expect(yield* cursor.storyPosition).toBe(shardStory.length)
    expect(occurrenceCount).toBe(shardStory.length)
  })

const consumeSimultaneousWave = <Role extends string>(
  cursor: StoryCursor,
  roles: ReadonlyArray<Role>,
  consumeMemberForRole: (cursor: StoryCursor, role: Role) => Effect.Effect<void, unknown>
) =>
  Effect.gen(function* () {
    const release = yield* Deferred.make<void>()
    const calls = yield* Effect.forEach(roles, (role) =>
      Effect.gen(function* () {
        const ready = yield* Deferred.make<void>()
        const fiber = yield* Deferred.succeed(ready, undefined).pipe(
          Effect.andThen(Deferred.await(release)),
          Effect.andThen(consumeMemberForRole(cursor, role)),
          Effect.forkScoped
        )
        return { fiber, ready }
      })
    )
    yield* Effect.forEach(calls, ({ ready }) => Deferred.await(ready), { concurrency: "unbounded", discard: true })
    yield* Deferred.succeed(release, undefined)
    yield* Effect.forEach(calls, ({ fiber }) => Fiber.join(fiber), { concurrency: "unbounded", discard: true })
  })

it("partitions all 84084 active-refresh orders by three canonical lane positions", () => {
  const fingerprints = allInitialFixedLaneOrders.map(fixedLaneFingerprint)
  const positionFingerprints = allInitialFixedLaneOrders.map(initialLanePositionFingerprint)

  expect(allInitialFixedLaneOrders).toHaveLength(84_084)
  expect(new Set(fingerprints).size).toBe(84_084)
  expect(new Set(positionFingerprints).size).toBe(84_084)
  expect(initialBLanePositionBuckets).toHaveLength(91)
  expect(initialBLanePositionBuckets.every(([, orders]) => orders.length === 924)).toBe(true)
  expect(initialScheduleChunks).toHaveLength(31)
  expect(initialScheduleChunks.every((orders) => orders.length > 0 && orders.length <= 2_772)).toBe(true)
  const chunkFingerprints = initialScheduleChunks.flatMap((orders) => orders.map(fixedLaneFingerprint))
  expect(chunkFingerprints).toHaveLength(84_084)
  expect(new Set(chunkFingerprints)).toEqual(new Set(fingerprints))
  expect(initialAuthorityGroup.members).toHaveLength(14)
  expect(initialAuthorityEdges).toHaveLength(11)
  expect(directEdgeFingerprints(initialAuthorityGroup)).toEqual(expectedEdgeFingerprints(initialAuthorityEdges))
})

describe("consumes every active-refresh specification-to-lineage order before B Suspend", () => {
  for (const [chunkIndex, orders] of initialScheduleChunks.entries()) {
    it.effect(`executes bounded B-position chunk ${chunkIndex + 1} of ${initialScheduleChunks.length}`, () =>
      executeAuthoritySchedules(
        `initial authority chunk ${chunkIndex + 1}`,
        orders,
        initialAuthorityGroup,
        bSuspend,
        consumeInitialAuthorityMember
      )
    )
  }
})

it("partitions all 924 post-hint A D authority orders by two canonical lane positions", () => {
  const fingerprints = allLaterFixedLaneOrders.map(fixedLaneFingerprint)
  const positionFingerprints = allLaterFixedLaneOrders.map(laterLanePositionFingerprint)

  expect(allLaterFixedLaneOrders).toHaveLength(924)
  expect(new Set(fingerprints).size).toBe(924)
  expect(new Set(positionFingerprints).size).toBe(924)
  expect(laterAuthorityGroup.members).toHaveLength(12)
  expect(laterAuthorityEdges).toHaveLength(10)
  expect(directEdgeFingerprints(laterAuthorityGroup)).toEqual(expectedEdgeFingerprints(laterAuthorityEdges))
})

it.effect("partitions and consumes all 924 post-hint A D authority orders before C Suspend", () =>
  executeAuthoritySchedules(
    "later A D authority",
    allLaterFixedLaneOrders,
    laterAuthorityGroup,
    cSuspend,
    consumeLaterAuthorityMember
  )
)

it("partitions all 22680 causal orders exactly once by their first enabled root", () => {
  const allFingerprints = allLegalCausalOrders.map(causalOrderFingerprint)
  const canonicalFullSet = new Set(allFingerprints)
  const canonicalShards = causalRootShards.map(({ orders, root }) => ({
    fingerprints: orders.map(causalOrderFingerprint),
    root
  }))
  const canonicalShardSets = canonicalShards.map(({ fingerprints }) => new Set(fingerprints))
  const canonicalShardUnion = new Set(canonicalShards.flatMap(({ fingerprints }) => fingerprints))

  expect(allLegalCausalOrders).toHaveLength(22_680)
  expect(canonicalFullSet.size).toBe(22_680)
  expect(causalRootShards.reduce((total, { orders }) => total + orders.length, 0)).toBe(22_680)
  expect(
    canonicalShards.every(({ fingerprints }, index) => fingerprints.length === canonicalShardSets[index]?.size)
  ).toBe(true)
  expect(canonicalShardUnion).toEqual(canonicalFullSet)
  expect(
    allFingerprints.every((fingerprint) => canonicalShardSets.filter((shard) => shard.has(fingerprint)).length === 1)
  ).toBe(true)
  expect(causalRootShards.every(({ orders, root }) => orders.every((order) => order[0] === root))).toBe(true)
  expect(allLegalCausalOrders).toContainEqual(["P_D", "W_D", "P_E", "W_E", "W_B", "X_B", "W_C", "X_C", "X_A"])
  expect(allLegalCausalOrders).toContainEqual(["W_B", "X_B", "P_D", "W_D", "W_C", "X_C", "X_A", "P_E", "W_E"])
})

describe("consumes the nine-node delivery cut in all 22680 causal orders before advancing once", () => {
  for (const { orders, root } of causalRootShards) {
    it.effect(`executes every causal order whose first enabled root is ${root}`, () =>
      Effect.gen(function* () {
        const shardStory = orders.flatMap(() => [concurrentGroup, activationReturn])
        let occurrenceCount = 0
        let latestOccurrence: { readonly item: AuthoredCassetteStoryItem; readonly storyPosition: number } | undefined
        const cursor = yield* makeStoryCursor(shardStory, {
          onOccurrence: (occurrence) =>
            Effect.sync(() => {
              occurrenceCount += 1
              latestOccurrence = occurrence
            })
        })

        for (const [orderIndex, order] of orders.entries()) {
          const groupPosition = orderIndex * 2
          for (const [memberIndex, role] of order.entries()) {
            if (memberIndex === causalGroupRoles.length - 1) {
              if ((yield* cursor.storyPosition) !== groupPosition) {
                failCausalOrder(root, orderIndex, order, "after the first eight members", "the group position advanced")
              }
              if (occurrenceCount !== groupPosition) {
                failCausalOrder(
                  root,
                  orderIndex,
                  order,
                  "after the first eight members",
                  "the group emitted an occurrence"
                )
              }
            }
            yield* consumeMember(cursor, role)
          }
          if ((yield* cursor.storyPosition) !== groupPosition + 1) {
            failCausalOrder(root, orderIndex, order, "after the ninth member", "the group did not advance exactly once")
          }
          if (occurrenceCount !== groupPosition + 1) {
            failCausalOrder(
              root,
              orderIndex,
              order,
              "after the ninth member",
              "the group did not emit exactly one occurrence"
            )
          }
          if (latestOccurrence?.item !== concurrentGroup || latestOccurrence.storyPosition !== groupPosition + 1) {
            failCausalOrder(
              root,
              orderIndex,
              order,
              "after the ninth member",
              "the emitted group item or position was not exact"
            )
          }

          const returned = yield* cursor.consumeCoordinatorActivationReturned
          if (!isExactActivationReturn(returned)) {
            failCausalOrder(
              root,
              orderIndex,
              order,
              "after the strict activation return",
              "the returned item was not exact"
            )
          }
          if ((yield* cursor.storyPosition) !== groupPosition + 2) {
            failCausalOrder(
              root,
              orderIndex,
              order,
              "after the strict activation return",
              "the story position did not advance"
            )
          }
          if (occurrenceCount !== groupPosition + 2) {
            failCausalOrder(
              root,
              orderIndex,
              order,
              "after the strict activation return",
              "the occurrence count was not exact"
            )
          }
        }
        expect(yield* cursor.storyPosition).toBe(shardStory.length)
        expect(occurrenceCount).toBe(shardStory.length)
      })
    )
  }
})

it.effect("retries each exact successor once after its predecessor follows an early typed failure", () =>
  Effect.gen(function* () {
    const edges: ReadonlyArray<readonly [CausalGroupRole, CausalGroupRole]> = [
      ["P_D", "W_D"],
      ["P_E", "W_E"],
      ["W_B", "X_B"],
      ["W_C", "X_C"]
    ]
    for (const [predecessor, successor] of edges) {
      const occurrences: Array<unknown> = []
      const cursor = yield* makeStoryCursor(story, {
        onOccurrence: (occurrence) => Effect.sync(() => occurrences.push(occurrence))
      })

      const early = yield* consumeMember(cursor, successor).pipe(Effect.flip)
      expect(early._tag).toBe("AuthoredCassetteInteractionMismatch")
      expect(yield* cursor.storyPosition).toBe(0)
      expect(occurrences).toEqual([])

      yield* consumeMember(cursor, predecessor)
      yield* consumeMember(cursor, successor)
      expect(yield* cursor.storyPosition).toBe(0)
      expect(occurrences).toEqual([])

      const duplicate = yield* consumeMember(cursor, successor).pipe(Effect.flip)
      expect(duplicate._tag).toBe("AuthoredCassetteInteractionMismatch")
      expect(yield* cursor.storyPosition).toBe(0)
      expect(occurrences).toEqual([])
    }
  })
)

it.effect("returns each exact controlled executor report from its authored group node", () =>
  Effect.gen(function* () {
    const cursor = yield* makeStoryCursor(story)

    expect(yield* cursor.consumeExecutorReportFor("Begin", aAttemptId)).toEqual({
      _tag: "PlannedAttemptExecutorWorkReported",
      report: { _tag: "ExecutorWorkExecuting", attemptId: aAttemptId },
      request: "Begin"
    })
    yield* consumeMember(cursor, "W_B")
    expect(yield* cursor.consumeExecutorReportFor("Begin", bAttemptId)).toEqual({
      _tag: "PlannedAttemptExecutorWorkReported",
      report: { _tag: "ExecutorWorkExecuting", attemptId: bAttemptId },
      request: "Begin"
    })
    yield* consumeMember(cursor, "W_C")
    expect(yield* cursor.consumeExecutorReportFor("Begin", cAttemptId)).toEqual({
      _tag: "PlannedAttemptExecutorWorkReported",
      report: { _tag: "ExecutorWorkExecuting", attemptId: cAttemptId },
      request: "Begin"
    })
    expect(yield* cursor.storyPosition).toBe(0)
  })
)

it.effect("claims exact specification and current-claim results once without crossing task lanes", () =>
  Effect.gen(function* () {
    const cursor = yield* makeStoryCursor(initialAuthorityStory)

    yield* cursor.consumeDalphSelectionFor(readASpecification)
    expect(yield* cursor.consumeTaskWorkSpecificationFor(taskA)).toEqual(aSpecification)
    yield* cursor.consumeDalphSelectionFor(readAClaim)
    expect(yield* cursor.consumeTaskClaimReadFor(taskA)).toEqual(Option.some(aClaimReturned))

    yield* cursor.consumeDalphSelectionFor(readCSpecification)
    expect(yield* cursor.consumeTaskWorkSpecificationFor(taskC)).toEqual(cSpecification)
    yield* cursor.consumeDalphSelectionFor(readCClaim)
    expect(yield* cursor.consumeTaskClaimReadFor(taskC)).toEqual(Option.some(cClaimReturned))

    expect(yield* cursor.storyPosition).toBe(0)
  })
)

it.effect("rejects and retries every predecessor edge in both active-refresh groups", () =>
  Effect.gen(function* () {
    for (const [predecessor, successor] of initialAuthorityEdges) {
      const occurrences: Array<unknown> = []
      const cursor = yield* makeStoryCursor(initialAuthorityStory, {
        onOccurrence: (occurrence) => Effect.sync(() => occurrences.push(occurrence))
      })
      for (const ancestor of rolesBefore(initialAuthorityLanes, predecessor)) {
        yield* consumeInitialAuthorityMember(cursor, ancestor)
      }

      const early = yield* consumeInitialAuthorityMember(cursor, successor).pipe(Effect.flip)
      expect(early._tag).toBe("AuthoredCassetteInteractionMismatch")
      expect(yield* cursor.storyPosition).toBe(0)
      expect(occurrences).toEqual([])

      yield* consumeInitialAuthorityMember(cursor, predecessor)
      yield* consumeInitialAuthorityMember(cursor, successor)
      const duplicate = yield* consumeInitialAuthorityMember(cursor, successor).pipe(Effect.flip)
      expect(duplicate._tag).toBe("AuthoredCassetteInteractionMismatch")
      expect(yield* cursor.storyPosition).toBe(0)
      expect(occurrences).toEqual([])
    }

    for (const [predecessor, successor] of laterAuthorityEdges) {
      const occurrences: Array<unknown> = []
      const cursor = yield* makeStoryCursor(laterAuthorityStory, {
        onOccurrence: (occurrence) => Effect.sync(() => occurrences.push(occurrence))
      })
      for (const ancestor of rolesBefore(laterAuthorityLanes, predecessor)) {
        yield* consumeLaterAuthorityMember(cursor, ancestor)
      }

      const early = yield* consumeLaterAuthorityMember(cursor, successor).pipe(Effect.flip)
      expect(early._tag).toBe("AuthoredCassetteInteractionMismatch")
      expect(yield* cursor.storyPosition).toBe(0)
      expect(occurrences).toEqual([])

      yield* consumeLaterAuthorityMember(cursor, predecessor)
      yield* consumeLaterAuthorityMember(cursor, successor)
      const duplicate = yield* consumeLaterAuthorityMember(cursor, successor).pipe(Effect.flip)
      expect(duplicate._tag).toBe("AuthoredCassetteInteractionMismatch")
      expect(yield* cursor.storyPosition).toBe(0)
      expect(occurrences).toEqual([])
    }
  })
)

it.effect("rejects foreign and duplicate exact result identities without mutation", () =>
  Effect.gen(function* () {
    const foreignTask = TaskId.make("foreign-task")

    const specification = yield* makeStoryCursor(initialAuthorityStory)
    yield* specification.consumeDalphSelectionFor(readASpecification)
    expect((yield* specification.consumeTaskWorkSpecificationFor(foreignTask).pipe(Effect.flip))._tag).toBe(
      "AuthoredCassetteInteractionMismatch"
    )
    expect(yield* specification.storyPosition).toBe(0)
    expect(yield* specification.consumeTaskWorkSpecificationFor(taskA)).toEqual(aSpecification)
    expect((yield* specification.consumeTaskWorkSpecificationFor(taskA).pipe(Effect.flip))._tag).toBe(
      "AuthoredCassetteInteractionMismatch"
    )
    expect(yield* specification.storyPosition).toBe(0)

    const claim = yield* makeStoryCursor(laterAuthorityStory)
    for (const role of ["S_D", "T_D", "Q_D"] as const) yield* consumeLaterAuthorityMember(claim, role)
    expect((yield* claim.consumeTaskClaimReadFor(foreignTask).pipe(Effect.flip))._tag).toBe(
      "AuthoredCassetteInteractionMismatch"
    )
    expect(yield* claim.storyPosition).toBe(0)
    expect(yield* claim.consumeTaskClaimReadFor(taskD)).toEqual(Option.some(dClaimReturned))
    expect((yield* claim.consumeTaskClaimReadFor(taskD).pipe(Effect.flip))._tag).toBe(
      "AuthoredCassetteInteractionMismatch"
    )
    expect(yield* claim.storyPosition).toBe(0)
  })
)

it.effect("rejects foreign duplicate and downstream claims for both active cuts", () =>
  Effect.gen(function* () {
    const initial = yield* makeStoryCursor(initialAuthorityStory)
    const prematureB = yield* initial.consumeExecutorReportFor("Suspend", bAttemptId).pipe(Effect.flip)
    expect(prematureB._tag).toBe("AuthoredCassetteInteractionMismatch")
    expect(yield* initial.storyPosition).toBe(0)
    for (const role of initialAuthorityRoles) yield* consumeInitialAuthorityMember(initial, role)

    expect(
      (yield* initial.consumeExecutorReportFor("Suspend", AttemptId.make("attempt:foreign:0")).pipe(Effect.flip))._tag
    ).toBe("AuthoredCassetteInteractionMismatch")
    expect(yield* initial.storyPosition).toBe(1)
    expect(yield* initial.consumeExecutorReportFor("Suspend", bAttemptId)).toEqual(bSuspend)
    expect((yield* initial.consumeExecutorReportFor("Suspend", bAttemptId).pipe(Effect.flip))._tag).toBe(
      "AuthoredCassetteInteractionMismatch"
    )
    expect(yield* initial.storyPosition).toBe(2)

    const later = yield* makeStoryCursor(laterAuthorityStory)
    const prematureC = yield* later.consumeExecutorReportFor("Suspend", activeCAttemptId).pipe(Effect.flip)
    expect(prematureC._tag).toBe("AuthoredCassetteInteractionMismatch")
    expect(yield* later.storyPosition).toBe(0)
    for (const role of laterAuthorityRoles) yield* consumeLaterAuthorityMember(later, role)
    expect(yield* later.consumeExecutorReportFor("Suspend", activeCAttemptId)).toEqual(cSuspend)
    expect((yield* later.consumeExecutorReportFor("Suspend", activeCAttemptId).pipe(Effect.flip))._tag).toBe(
      "AuthoredCassetteInteractionMismatch"
    )
    expect(yield* later.storyPosition).toBe(2)
  })
)

it.effect("serializes simultaneously enabled authority lanes and publishes each bounded join once", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const initialOccurrences: Array<{ readonly item: AuthoredCassetteStoryItem; readonly storyPosition: number }> = []
      const initial = yield* makeStoryCursor(initialAuthorityStory, {
        onOccurrence: (occurrence) => Effect.sync(() => initialOccurrences.push(occurrence))
      })
      const initialWaves: ReadonlyArray<ReadonlyArray<InitialAuthorityRole>> = [
        ["S_A", "S_B", "S_C"],
        ["T_A", "T_B", "T_C"],
        ["Q_A", "Q_C"],
        ["R_A", "R_C"],
        ["W_A", "W_C"],
        ["L_A", "L_C"]
      ]
      for (const wave of initialWaves) {
        yield* consumeSimultaneousWave(initial, wave, consumeInitialAuthorityMember)
      }
      expect(yield* initial.storyPosition).toBe(1)
      expect(initialOccurrences).toEqual([{ item: initialAuthorityGroup, storyPosition: 1 }])
      yield* initial.consumeExecutorReportFor("Suspend", bAttemptId)

      const laterOccurrences: Array<{ readonly item: AuthoredCassetteStoryItem; readonly storyPosition: number }> = []
      const later = yield* makeStoryCursor(laterAuthorityStory, {
        onOccurrence: (occurrence) => Effect.sync(() => laterOccurrences.push(occurrence))
      })
      const laterWaves: ReadonlyArray<ReadonlyArray<LaterAuthorityRole>> = [
        ["S_A", "S_D"],
        ["T_A", "T_D"],
        ["Q_A", "Q_D"],
        ["R_A", "R_D"],
        ["W_A", "W_D"],
        ["L_A", "L_D"]
      ]
      for (const wave of laterWaves) yield* consumeSimultaneousWave(later, wave, consumeLaterAuthorityMember)
      expect(yield* later.storyPosition).toBe(1)
      expect(laterOccurrences).toEqual([{ item: laterAuthorityGroup, storyPosition: 1 }])
      yield* later.consumeExecutorReportFor("Suspend", activeCAttemptId)

      expect(initialOccurrences.filter(({ item }) => item._tag === "ConcurrentInteractionGroup")).toHaveLength(1)
      expect(laterOccurrences.filter(({ item }) => item._tag === "ConcurrentInteractionGroup")).toHaveLength(1)
    })
  )
)

it.effect("keeps incomplete active cuts current without timeout", () =>
  Effect.gen(function* () {
    const initialOccurrences: Array<unknown> = []
    const initial = yield* makeStoryCursor(initialAuthorityStory, {
      onOccurrence: (occurrence) => Effect.sync(() => initialOccurrences.push(occurrence))
    })
    for (const role of initialAuthorityRoles.slice(0, -1)) yield* consumeInitialAuthorityMember(initial, role)
    expect(yield* initial.storyPosition).toBe(0)
    expect((yield* initial.currentStoryItem)?._tag).toBe("ConcurrentInteractionGroup")
    expect(initialOccurrences).toEqual([])

    const laterOccurrences: Array<unknown> = []
    const later = yield* makeStoryCursor(laterAuthorityStory, {
      onOccurrence: (occurrence) => Effect.sync(() => laterOccurrences.push(occurrence))
    })
    for (const role of laterAuthorityRoles.slice(0, -1)) yield* consumeLaterAuthorityMember(later, role)
    expect(yield* later.storyPosition).toBe(0)
    expect((yield* later.currentStoryItem)?._tag).toBe("ConcurrentInteractionGroup")
    expect(laterOccurrences).toEqual([])
  })
)

it.effect("recreates every authority role after cursor scope replacement", () =>
  Effect.gen(function* () {
    yield* Effect.scoped(
      Effect.gen(function* () {
        const first = yield* makeStoryCursor(initialAuthorityStory)
        for (const role of ["S_A", "T_A", "Q_A", "S_B", "T_B"] as const) {
          yield* consumeInitialAuthorityMember(first, role)
        }
        expect(yield* first.storyPosition).toBe(0)
      })
    )
    yield* Effect.scoped(
      Effect.gen(function* () {
        const replacement = yield* makeStoryCursor(initialAuthorityStory)
        for (const role of initialAuthorityRoles) yield* consumeInitialAuthorityMember(replacement, role)
        expect(yield* replacement.storyPosition).toBe(1)
      })
    )

    yield* Effect.scoped(
      Effect.gen(function* () {
        const first = yield* makeStoryCursor(laterAuthorityStory)
        for (const role of ["S_D", "T_D", "Q_D", "R_D"] as const) {
          yield* consumeLaterAuthorityMember(first, role)
        }
        expect(yield* first.storyPosition).toBe(0)
      })
    )
    yield* Effect.scoped(
      Effect.gen(function* () {
        const replacement = yield* makeStoryCursor(laterAuthorityStory)
        for (const role of laterAuthorityRoles) yield* consumeLaterAuthorityMember(replacement, role)
        expect(yield* replacement.storyPosition).toBe(1)
      })
    )
  })
)

it.effect("serializes simultaneous roots and successors and emits once after the causal join", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const occurrences: Array<{ readonly item: AuthoredCassetteStoryItem; readonly storyPosition: number }> = []
      const cursor = yield* makeStoryCursor(story, {
        onOccurrence: (occurrence) => Effect.sync(() => occurrences.push(occurrence))
      })
      const rootRelease = yield* Deferred.make<void>()
      const roots = yield* Effect.forEach(["P_D", "P_E", "W_B", "W_C", "X_A"] as const, (role) =>
        Effect.gen(function* () {
          const ready = yield* Deferred.make<void>()
          const fiber = yield* Deferred.succeed(ready, undefined).pipe(
            Effect.andThen(Deferred.await(rootRelease)),
            Effect.andThen(consumeMember(cursor, role)),
            Effect.forkScoped
          )
          return { fiber, ready }
        })
      )

      yield* Effect.forEach(roots, ({ ready }) => Deferred.await(ready), { concurrency: "unbounded", discard: true })
      expect(yield* cursor.storyPosition).toBe(0)
      expect(occurrences).toEqual([])
      yield* Deferred.succeed(rootRelease, undefined)
      yield* Effect.forEach(roots, ({ fiber }) => Fiber.join(fiber), { concurrency: "unbounded", discard: true })
      expect(yield* cursor.storyPosition).toBe(0)
      expect(occurrences).toEqual([])

      const successorRelease = yield* Deferred.make<void>()
      const successors = yield* Effect.forEach(["W_D", "W_E", "X_B", "X_C"] as const, (role) =>
        Effect.gen(function* () {
          const ready = yield* Deferred.make<void>()
          const fiber = yield* Deferred.succeed(ready, undefined).pipe(
            Effect.andThen(Deferred.await(successorRelease)),
            Effect.andThen(consumeMember(cursor, role)),
            Effect.forkScoped
          )
          return { fiber, ready }
        })
      )

      yield* Effect.forEach(successors, ({ ready }) => Deferred.await(ready), {
        concurrency: "unbounded",
        discard: true
      })
      yield* Deferred.succeed(successorRelease, undefined)
      yield* Effect.forEach(successors, ({ fiber }) => Fiber.join(fiber), { concurrency: "unbounded", discard: true })

      expect(yield* cursor.storyPosition).toBe(1)
      expect(occurrences).toEqual([{ item: concurrentGroup, storyPosition: 1 }])
      yield* cursor.consumeCoordinatorActivationReturned
      expect(yield* cursor.storyPosition).toBe(2)
    })
  )
)

it.effect("publishes the completed group before admitting the strict successor even when interrupted", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const callbackEntered = yield* Deferred.make<void>()
      const callbackRelease = yield* Deferred.make<void>()
      const strictStarted = yield* Deferred.make<void>()
      const occurrences: Array<{ readonly item: AuthoredCassetteStoryItem; readonly storyPosition: number }> = []
      const cursor = yield* makeStoryCursor(story, {
        onOccurrence: (occurrence) =>
          Effect.gen(function* () {
            if (occurrence.item._tag === "ConcurrentInteractionGroup") {
              yield* Deferred.succeed(callbackEntered, undefined)
              yield* Deferred.await(callbackRelease)
            }
            yield* Effect.sync(() => occurrences.push(occurrence))
          })
      })
      for (const role of ["P_D", "W_D", "P_E", "W_E", "W_B", "X_B", "W_C", "X_A"] as const) {
        yield* consumeMember(cursor, role)
      }

      const ninth = yield* consumeMember(cursor, "X_C").pipe(Effect.forkScoped)
      yield* Deferred.await(callbackEntered)
      const strict = yield* Deferred.succeed(strictStarted, undefined).pipe(
        Effect.andThen(cursor.consumeCoordinatorActivationReturned),
        Effect.forkScoped({ startImmediately: true })
      )
      yield* Deferred.await(strictStarted)

      expect(strict.pollUnsafe()).toBeUndefined()
      const interrupting = yield* Fiber.interrupt(ninth).pipe(Effect.forkScoped({ startImmediately: true }))
      expect(interrupting.pollUnsafe()).toBeUndefined()
      expect(occurrences).toEqual([])

      yield* Deferred.succeed(callbackRelease, undefined)
      const returned = yield* Fiber.join(strict)
      yield* Fiber.join(interrupting)
      const ninthExit = yield* Fiber.await(ninth)

      expect(returned).toEqual(activationReturn)
      expect(Exit.isFailure(ninthExit) && Cause.hasInterruptsOnly(ninthExit.cause)).toBe(true)
      expect(occurrences).toEqual([
        { item: concurrentGroup, storyPosition: 1 },
        { item: activationReturn, storyPosition: 2 }
      ])
      expect(yield* cursor.storyPosition).toBe(2)
    })
  )
)

it.effect("rejects foreign duplicate and downstream claims without advancing an incomplete group", () =>
  Effect.gen(function* () {
    const foreignOperation = {
      _tag: "ReconcileTaskWorktree",
      attemptId: AttemptId.make("attempt:X:1"),
      taskId: TaskId.make("X")
    } as const

    const foreignOccurrences: Array<unknown> = []
    const foreign = yield* makeStoryCursor(story, {
      onOccurrence: (occurrence) => Effect.sync(() => foreignOccurrences.push(occurrence))
    })
    expect((yield* foreign.consumeDalphSelectionFor(foreignOperation).pipe(Effect.flip))._tag).toBe(
      "AuthoredCassetteInteractionMismatch"
    )
    expect(yield* foreign.storyPosition).toBe(0)
    expect(foreignOccurrences).toEqual([])

    const duplicateOccurrences: Array<unknown> = []
    const duplicate = yield* makeStoryCursor(story, {
      onOccurrence: (occurrence) => Effect.sync(() => duplicateOccurrences.push(occurrence))
    })
    yield* consumeMember(duplicate, "W_B")
    expect((yield* consumeMember(duplicate, "W_B").pipe(Effect.flip))._tag).toBe("AuthoredCassetteInteractionMismatch")
    expect(yield* duplicate.storyPosition).toBe(0)
    expect(duplicateOccurrences).toEqual([])

    const downstreamOccurrences: Array<unknown> = []
    const downstream = yield* makeStoryCursor(story, {
      onOccurrence: (occurrence) => Effect.sync(() => downstreamOccurrences.push(occurrence))
    })
    expect((yield* downstream.consumeCoordinatorActivationReturned.pipe(Effect.flip))._tag).toBe(
      "AuthoredCassetteInteractionMismatch"
    )
    expect(yield* downstream.storyPosition).toBe(0)
    expect(downstreamOccurrences).toEqual([])
  })
)

it.effect("keeps an incomplete causal group current without inventing timeout semantics", () =>
  Effect.gen(function* () {
    const occurrences: Array<unknown> = []
    const cursor = yield* makeStoryCursor(story, {
      onOccurrence: (occurrence) => Effect.sync(() => occurrences.push(occurrence))
    })
    for (const role of ["P_D", "W_D", "P_E", "W_E", "W_B", "X_B", "W_C", "X_A"] as const) {
      yield* consumeMember(cursor, role)
    }

    expect(yield* cursor.storyPosition).toBe(0)
    expect((yield* cursor.currentStoryItem)?._tag).toBe("ConcurrentInteractionGroup")
    expect(occurrences).toEqual([])
  })
)

it.effect("recreates all causal group roles after its cursor scope is replaced", () =>
  Effect.gen(function* () {
    yield* Effect.scoped(
      Effect.gen(function* () {
        const first = yield* makeStoryCursor(story)
        yield* consumeMember(first, "P_D")
        yield* consumeMember(first, "W_D")
        yield* consumeMember(first, "X_A")
        expect(yield* first.storyPosition).toBe(0)
      })
    )

    yield* Effect.scoped(
      Effect.gen(function* () {
        const replacement = yield* makeStoryCursor(story)
        for (const role of ["P_D", "W_D", "P_E", "W_E", "W_B", "X_B", "W_C", "X_C", "X_A"] as const) {
          yield* consumeMember(replacement, role)
        }
        expect(yield* replacement.storyPosition).toBe(1)
      })
    )
  })
)
