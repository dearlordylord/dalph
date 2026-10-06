import { OperationId } from "../../identity.js"

/** Stable identity for the single qualification read owned by an exact claim/specification pair. */
export const taskAttemptBaseReadOperationIdFor = (
  claimOperationId: OperationId,
  specificationOperationId: OperationId
): OperationId => OperationId.make(`task-attempt-base:${JSON.stringify([claimOperationId, specificationOperationId])}`)
