import { it } from "@effect/vitest"
import { Effect, Schema } from "effect"
import { expect } from "vitest"
import { TaskId } from "@dalph/contracts"
import { ActiveTaskClaim, TaskClaimRelease } from "../../authorities/task-tracker/claim-mutation.js"
import { ClaimOwner, ClaimToken } from "../../authorities/task-tracker/claim.js"
import { OperationId } from "../identity.js"
import { TaskClaimReleaseAuthority, WorkflowOperation } from "./operation.js"

const claim = ActiveTaskClaim.make({
  operationId: OperationId.make("operation-test-acquisition"),
  owner: ClaimOwner.make("dalph"),
  taskId: TaskId.make("operation-test-task"),
  token: ClaimToken.make("operation-test-token")
})
const release = TaskClaimRelease.make({ claim, operationId: OperationId.make("operation-test-release") })
const authority = TaskClaimReleaseAuthority.cases.WorkflowClaimReleaseAuthority.make({})

it.effect("requires a claim release to follow its acquisition without naming itself", () =>
  Effect.gen(function* () {
    const decode = Schema.decodeUnknownEffect(WorkflowOperation)
    expect(
      (yield* decode({
        _tag: "ReleaseTaskClaim",
        authority,
        predecessorOperationIds: [release.operationId, claim.operationId],
        release
      }).pipe(Effect.flip))._tag
    ).toBe("SchemaError")
    expect(
      (yield* decode({ _tag: "ReleaseTaskClaim", authority, predecessorOperationIds: [], release }).pipe(Effect.flip))
        ._tag
    ).toBe("SchemaError")
    expect(
      yield* decode({ _tag: "ReleaseTaskClaim", authority, predecessorOperationIds: [claim.operationId], release })
    ).toEqual({ _tag: "ReleaseTaskClaim", authority, predecessorOperationIds: [claim.operationId], release })
  })
)
