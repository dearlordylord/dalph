import { it } from "@effect/vitest"
import { Effect, Schema } from "effect"
import fc from "fast-check"
import { describe, expect } from "vitest"
import { AuthoredCassetteStoryItem } from "../../src/cassettes/authored-domain.js"
import { makeStoryCursor, type StoryCursor } from "../../src/cassettes/authored-cursor.js"

const initialLanes = [
  ["S_A", "T_A", "Q_A", "R_A", "W_A", "L_A"],
  ["S_B", "T_B"],
  ["S_C", "T_C", "Q_C", "R_C", "W_C", "L_C"]
] as const
const laterLanes = [
  ["S_A", "T_A", "Q_A", "R_A", "W_A", "L_A"],
  ["S_D", "T_D", "Q_D", "R_D", "W_D", "L_D"]
] as const

type EncodedNode = {
  readonly interaction: Readonly<Record<string, unknown>>
  readonly predecessorRoles: ReadonlyArray<string>
  readonly role: string
}
type EncodedGroup = { readonly _tag: "ConcurrentInteractionGroup"; readonly members: ReadonlyArray<EncodedNode> }
type AuthorityFixture = {
  readonly edges: ReadonlyArray<readonly [string, string]>
  readonly encoded: EncodedGroup
  readonly lanes: ReadonlyArray<ReadonlyArray<string>>
  readonly name: string
  readonly terminalRole: string
}

const attemptIdFor = (taskId: string): string => {
  switch (taskId) {
    case "A":
      return "attempt:A:0"
    case "C":
      return "attempt:C:2"
    case "D":
      return "attempt:D:3"
    default:
      return ""
  }
}

const interactionFor = (role: string): Readonly<Record<string, unknown>> => {
  const separator = role.indexOf("_")
  const phase = role.slice(0, separator)
  const taskId = role.slice(separator + 1)
  switch (phase) {
    case "S":
      return { _tag: "DalphSelects", operation: { _tag: "ReadTaskWorkSpecification", taskId } }
    case "T":
      return {
        _tag: "TaskWorkSpecificationReadReturned",
        body: `Implement ${taskId}.`,
        taskId,
        title: `Task ${taskId}`
      }
    case "Q":
      return { _tag: "DalphSelects", operation: { _tag: "ReadTaskClaim", taskId } }
    case "R":
      return { _tag: "TaskClaimCurrentReadReturned", taskId }
    case "W":
      return { _tag: "DalphSelects", operation: { _tag: "ReadTaskWorktree", attemptId: attemptIdFor(taskId), taskId } }
    case "L":
      return { _tag: "DalphSelects", operation: { _tag: "ReadTargetLineage", attemptId: attemptIdFor(taskId), taskId } }
    default:
      return { _tag: "UnsupportedAuthorityPhase", role }
  }
}

const encodedAuthorityGroup = (lanes: ReadonlyArray<ReadonlyArray<string>>): EncodedGroup => ({
  _tag: "ConcurrentInteractionGroup",
  members: lanes.flatMap((lane) =>
    lane.map((role, index) => ({
      interaction: interactionFor(role),
      predecessorRoles: index === 0 ? [] : [lane[index - 1] ?? "missing-predecessor"],
      role
    }))
  )
})
const chainEdges = (lanes: ReadonlyArray<ReadonlyArray<string>>): ReadonlyArray<readonly [string, string]> =>
  lanes.flatMap((lane) => lane.slice(1).map((role, index) => [lane[index] ?? "missing-predecessor", role] as const))

const fixtures: ReadonlyArray<AuthorityFixture> = [
  {
    edges: chainEdges(initialLanes),
    encoded: encodedAuthorityGroup(initialLanes),
    lanes: initialLanes,
    name: "initial A B C authority cut",
    terminalRole: "L_C"
  },
  {
    edges: chainEdges(laterLanes),
    encoded: encodedAuthorityGroup(laterLanes),
    lanes: laterLanes,
    name: "later A D authority cut",
    terminalRole: "L_D"
  }
]

const edgeFingerprint = ([predecessor, successor]: readonly [string, string]): string => `${predecessor}->${successor}`
const actualEdges = (group: EncodedGroup): ReadonlySet<string> =>
  new Set(
    group.members.flatMap(({ predecessorRoles, role }) =>
      predecessorRoles.map((predecessor) => edgeFingerprint([predecessor, role]))
    )
  )
const hasEveryRequiredEdge = (fixture: AuthorityFixture, group: EncodedGroup): boolean => {
  const actual = actualEdges(group)
  return fixture.edges.every((edge) => actual.has(edgeFingerprint(edge)))
}
const dropEdge = (group: EncodedGroup, edge: readonly [string, string]): EncodedGroup => ({
  ...group,
  members: group.members.map((node) =>
    node.role === edge[1]
      ? { ...node, predecessorRoles: node.predecessorRoles.filter((role) => role !== edge[0]) }
      : node
  )
})
const rolesBefore = (fixture: AuthorityFixture, role: string): ReadonlyArray<string> => {
  const lane = fixture.lanes.find((candidate) => candidate.includes(role))
  if (lane === undefined) return expect.fail(`${fixture.name} role ${role} belongs to no fixed lane`)
  return lane.slice(0, lane.indexOf(role))
}

const consumeRole = (
  cursor: StoryCursor,
  group: typeof AuthoredCassetteStoryItem.cases.ConcurrentInteractionGroup.Type,
  role: string
) => {
  const member = group.members.find((candidate) => candidate.role === role)?.interaction
  if (member === undefined) return Effect.die(`authority fixture has no role ${role}`)
  switch (member._tag) {
    case "DalphSelects":
      return cursor.consumeDalphSelectionFor(member.operation).pipe(Effect.asVoid)
    case "TaskWorkSpecificationReadReturned":
      return cursor.consumeTaskWorkSpecificationFor(member.taskId).pipe(Effect.asVoid)
    case "TaskClaimCurrentReadReturned":
      return cursor.consumeTaskClaimReadFor(member.taskId).pipe(Effect.asVoid)
    case "PlannedAttemptExecutorWorkReported":
      return Effect.die(`active authority fixture role ${role} unexpectedly contains an executor report`)
  }
}

describe("dropped-edge negative controls", () => {
  for (const fixture of fixtures) {
    it.effect(`detects every missing direct edge and the newly early successor in the ${fixture.name}`, () =>
      Effect.gen(function* () {
        expect(hasEveryRequiredEdge(fixture, fixture.encoded)).toBe(true)
        for (const edge of fixture.edges) {
          const mutated = dropEdge(fixture.encoded, edge)
          expect(hasEveryRequiredEdge(fixture, mutated)).toBe(false)

          const decoded = yield* Schema.decodeUnknownEffect(AuthoredCassetteStoryItem)(mutated).pipe(Effect.orDie)
          if (decoded._tag !== "ConcurrentInteractionGroup") {
            return yield* Effect.die(`${fixture.name} edge mutation decoded to the wrong story item`)
          }
          const cursor = yield* makeStoryCursor([decoded])
          for (const ancestor of rolesBefore(fixture, edge[0])) yield* consumeRole(cursor, decoded, ancestor)

          // Dropping this direct edge makes the successor succeed before its
          // required predecessor. That is the observable counterexample the
          // clean fixture's early-successor property rejects.
          yield* consumeRole(cursor, decoded, edge[1])
          expect(yield* cursor.storyPosition).toBe(0)
        }
      })
    )
  }
})

describe("generated malformed active authority fixtures", () => {
  for (const fixture of fixtures) {
    const terminal = fixture.encoded.members.find(({ role }) => role === fixture.terminalRole)
    const duplicateTargets = fixture.encoded.members
      .map(({ role }) => role)
      .filter((role) => role !== fixture.terminalRole && !terminal?.predecessorRoles.includes(role))

    it(`rejects generated duplicate roles in the ${fixture.name}`, () => {
      fc.assert(
        fc.property(fc.constantFrom(...duplicateTargets), (duplicateRole) => {
          const mutated: EncodedGroup = {
            ...fixture.encoded,
            members: fixture.encoded.members.map((node) =>
              node.role === fixture.terminalRole ? { ...node, role: duplicateRole } : node
            )
          }
          expect(() => Schema.decodeUnknownSync(AuthoredCassetteStoryItem)(mutated)).toThrow(
            /each concurrent interaction role must be unique/u
          )
        }),
        { numRuns: 100 }
      )
    })

    it(`rejects generated invalid predecessors in the ${fixture.name}`, () => {
      fc.assert(
        fc.property(fc.integer({ min: 0, max: fixture.encoded.members.length - 1 }), (memberIndex) => {
          const mutated: EncodedGroup = {
            ...fixture.encoded,
            members: fixture.encoded.members.map((node, index) =>
              index === memberIndex ? { ...node, predecessorRoles: [`missing-role-${memberIndex}`] } : node
            )
          }
          expect(() => Schema.decodeUnknownSync(AuthoredCassetteStoryItem)(mutated)).toThrow(
            /is not a member of the group/u
          )
        }),
        { numRuns: 100 }
      )
    })
  }
})
