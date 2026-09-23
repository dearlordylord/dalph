import { RunId, type GitCommitSha, type RemotePublicationTarget } from "@dalph/contracts"
import { Context, Effect, Schema } from "effect"
import type { RunReactivationOwnerService } from "../../../coordination/run/run-reactivation-owner.js"
import { RunReactivationHint } from "../../../coordination/run/run-reactivation-owner.js"
import type { IntegratorRunQualifiedCandidate } from "../integrator/events.js"
import {
  resumeRemotePublicationAndDispatch,
  type RemotePublicationPhaseBoundary,
  type RemotePublicationResumeDispatchBoundary
} from "./protocol-engine.js"
import type { RemotePublicationResumeRequest } from "./events.js"

/** Exact input accepted by the existing #385 same-commit successor owner. */
export type ExistingSameCommitRecoveryInput = {
  readonly candidate: IntegratorRunQualifiedCandidate
  readonly target: RemotePublicationTarget
  readonly mergeBase: GitCommitSha
  readonly remoteHead: GitCommitSha
}

/** Narrow production port implemented by the existing #385 successor owner. */
export interface ExistingSameCommitRecoveryOwnerService {
  readonly recover: (input: ExistingSameCommitRecoveryInput) => Effect.Effect<void>
}

export class ExistingSameCommitRecoveryOwner extends Context.Service<
  ExistingSameCommitRecoveryOwner,
  ExistingSameCommitRecoveryOwnerService
>()("@dalph/ExistingSameCommitRecoveryOwner") {}

/** Resume found a compatible competing head before the #385 owner was installed. */
export class RemotePublicationResumeRuntimeUnavailable extends Schema.TaggedError<RemotePublicationResumeRuntimeUnavailable>()(
  "RemotePublication.ResumeRuntimeUnavailable",
  { detail: Schema.String, runId: RunId }
) {}

/**
 * The application’s existing recovery owners. This module only routes a
 * settled direct-publication result; it does not implement either owner.
 */
export interface RemotePublicationResumeRuntimeOwners<E = never, R = never> {
  readonly ordinaryRun: RunReactivationOwnerService
  readonly sameCommitRecovery: (input: ExistingSameCommitRecoveryInput) => Effect.Effect<void, E, R>
}

/**
 * Converts the protocol handoff into the ordinary Run selector or the exact
 * existing #385 owner. A fresh Run activation rereads tracker premises before
 * selecting promotion/finality; no transition is constructed here.
 */
export const remotePublicationResumeDispatchBoundaryFor = <E, R>(
  owners: RemotePublicationResumeRuntimeOwners<E, R>
): RemotePublicationResumeDispatchBoundary<E, R> => ({
  dispatch: (dispatch) => {
    if (dispatch._tag === "ExistingSameCommitRecovery") {
      return owners.sameCommitRecovery({
        candidate: dispatch.candidate,
        mergeBase: dispatch.mergeBase,
        remoteHead: dispatch.remoteHead,
        target: dispatch.target
      })
    }
    if (dispatch._tag === "ContinueDirectPublication" || dispatch._tag === "ContinueFinality") {
      return owners.ordinaryRun.hint(RunReactivationHint.AcceptedFactPublication())
    }
    return Effect.void
  }
})

/** Production-facing exact Run resume operation with the current runtime owners installed. */
export const resumeRemotePublicationInRuntime = <E, R>(
  candidate: IntegratorRunQualifiedCandidate,
  target: RemotePublicationTarget,
  request: RemotePublicationResumeRequest,
  phaseBoundary: RemotePublicationPhaseBoundary,
  owners: RemotePublicationResumeRuntimeOwners<E, R>
) =>
  resumeRemotePublicationAndDispatch(
    candidate,
    target,
    request,
    phaseBoundary,
    remotePublicationResumeDispatchBoundaryFor(owners)
  )
