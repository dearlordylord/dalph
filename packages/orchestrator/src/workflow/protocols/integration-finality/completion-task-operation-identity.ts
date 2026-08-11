import { OperationId } from "../../identity.js"
import type { CompletionTaskFocusedReadPurpose, CompletionTaskRequest, CompletionTaskRequestOrdinal } from "./events.js"

type CompletionTaskAuthorizationPurpose = Extract<CompletionTaskFocusedReadPurpose, { readonly _tag: "Authorization" }>

/** Identifies one exact focused tracker read within a completion request chronology. */
export const completionTaskFocusedReadOperationIdFor = (
  request: CompletionTaskRequest,
  purpose: CompletionTaskFocusedReadPurpose
): OperationId =>
  purpose._tag === "Authorization"
    ? OperationId.make(
        `${request.operationId}:authorization:${purpose.attemptOrdinal}:${purpose.authorizationOrdinal}:tracker`
      )
    : OperationId.make(
        `${request.operationId}:confirmation:${purpose.attemptOrdinal}:${purpose.confirmationOrdinal}:tracker`
      )

/** Identifies Git's ancestry read in one exact current completion authorization cycle. */
export const completionTaskCandidateAncestryReadOperationIdFor = (
  request: CompletionTaskRequest,
  purpose: CompletionTaskAuthorizationPurpose
): OperationId =>
  OperationId.make(`${request.operationId}:authorization:${purpose.attemptOrdinal}:${purpose.authorizationOrdinal}:git`)

/** Identifies the tracker lookup for one exact numbered completion request call. */
export const completionTaskRequestLookupOperationIdFor = (
  request: CompletionTaskRequest,
  attemptOrdinal: CompletionTaskRequestOrdinal
): OperationId => OperationId.make(`${request.operationId}:lookup:${attemptOrdinal}`)
