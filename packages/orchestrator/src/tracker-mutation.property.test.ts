import * as fc from "fast-check"
import { expect, it } from "vitest"
import { ActiveTaskClaim, ClaimOwner, ClaimToken, isExactTaskClaim, OperationId, TaskId } from "./index.js"

const identity = fc.uuid()

it("invalidates claim authority when any exact capability component changes", () => {
  fc.assert(
    fc.property(
      fc.tuple(
        identity,
        identity,
        identity,
        identity,
        identity.map((value) => `other-${value}`),
        identity.map((value) => `other-${value}`),
        identity.map((value) => `other-${value}`),
        identity.map((value) => `other-${value}`)
      ),
      ([operation, owner, task, token, otherOperation, otherOwner, otherTask, otherToken]) => {
        const claim = ActiveTaskClaim.make({
          operationId: OperationId.make(operation),
          owner: ClaimOwner.make(owner),
          taskId: TaskId.make(task),
          token: ClaimToken.make(token)
        })

        expect(isExactTaskClaim(claim, claim)).toBe(true)
        expect(isExactTaskClaim(
          claim,
          ActiveTaskClaim.make({
            ...claim,
            operationId: OperationId.make(otherOperation)
          })
        )).toBe(false)
        expect(isExactTaskClaim(
          claim,
          ActiveTaskClaim.make({
            ...claim,
            owner: ClaimOwner.make(otherOwner)
          })
        )).toBe(false)
        expect(isExactTaskClaim(
          claim,
          ActiveTaskClaim.make({
            ...claim,
            taskId: TaskId.make(otherTask)
          })
        )).toBe(false)
        expect(isExactTaskClaim(
          claim,
          ActiveTaskClaim.make({
            ...claim,
            token: ClaimToken.make(otherToken)
          })
        )).toBe(false)
      }
    ),
    { numRuns: 100 }
  )
})
