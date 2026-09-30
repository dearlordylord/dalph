import { RunId, type RemotePublicationTarget } from "@dalph/contracts"
import { Effect, Schema } from "effect"
import type { RunReactivationOwnerService } from "../../../coordination/run/run-reactivation-owner.js"
import { RunReactivationHint } from "../../../coordination/run/run-reactivation-owner.js"
import type { IntegratorRunQualifiedCandidate } from "../integrator/events.js"
import {
  resumeRemotePublicationAndDispatch,
  type RemotePublicationPhaseBoundary,
  type RemotePublicationResumeDispatchBoundary
} from "./protocol-engine.js"
import type { RemotePublicationResumeRequest } from "./events.js"

/** A retained result was activated without the ordinary Run owner installed. */
export class RemotePublicationResumeRuntimeUnavailable extends Schema.TaggedError<RemotePublicationResumeRuntimeUnavailable>()(
  "RemotePublication.ResumeRuntimeUnavailable",
  { detail: Schema.String, runId: RunId }
) {}

/**
 * The ordinary Run selector owns continuation after a retained publication
 * result. It rereads the exact retained facts before selecting the next action.
 */
export interface RemotePublicationResumeRuntimeOwners {
  readonly ordinaryRun: RunReactivationOwnerService
}

/**
 * Wakes the ordinary Run selector. It rereads retained publication facts,
 * tracker premises, and current allowance before selecting further work.
 */
export const remotePublicationResumeDispatchBoundaryFor = (
  owners: RemotePublicationResumeRuntimeOwners
): RemotePublicationResumeDispatchBoundary => ({
  dispatch: (dispatch) => {
    if (
      dispatch._tag === "ContinueDirectPublication" ||
      dispatch._tag === "ContinueFinality" ||
      dispatch._tag === "ContinueRunFrontier"
    ) {
      return owners.ordinaryRun.hint(RunReactivationHint.AcceptedFactPublication())
    }
    return Effect.void
  }
})

/** Production-facing exact Run resume operation with the current runtime owners installed. */
export const resumeRemotePublicationInRuntime = (
  candidate: IntegratorRunQualifiedCandidate,
  target: RemotePublicationTarget,
  request: RemotePublicationResumeRequest,
  phaseBoundary: RemotePublicationPhaseBoundary,
  owners: RemotePublicationResumeRuntimeOwners
) =>
  resumeRemotePublicationAndDispatch(
    candidate,
    target,
    request,
    phaseBoundary,
    remotePublicationResumeDispatchBoundaryFor(owners)
  )
