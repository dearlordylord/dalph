import { GitCommitSha, IntegrationTarget, RunId } from "@dalph/contracts"
import { Schema } from "effect"
import { TargetLineageObservation } from "../../../authorities/git/target-lineage.js"
import { JournalPosition } from "../../../workflow-journal/identity.js"
import type { JournalAppendError, JournalReadError } from "../../../workflow-journal/store.js"
import { StartedIntegrationResponsibility } from "../integration-admission/protocol.js"
import { IntegratorCandidateText, IntegratorCorrelation } from "./events.js"

/** The opaque provider call failed before Dalph received a conclusive outer result. */
export class IntegratorCallFailure extends Schema.TaggedError<IntegratorCallFailure>()("IntegratorCallFailure", {
  correlation: IntegratorCorrelation,
  detail: Schema.String
}) {}

/**
 * The provider boundary conclusively reports that this exact Integrator call
 * has no provider-owned activity left. Unlike IntegratorCallFailure, this is
 * a terminal provider observation and may be recorded before quarantine.
 */
export class IntegratorProviderActivityAbsent extends Schema.TaggedError<IntegratorProviderActivityAbsent>()(
  "IntegratorProviderActivityAbsent",
  { correlation: IntegratorCorrelation, detail: Schema.NonEmptyString }
) {}

/** Git could not provide object kind and ordered direct-parent facts for M. */
export class IntegratorGitReadFailure extends Schema.TaggedError<IntegratorGitReadFailure>()(
  "IntegratorGitReadFailure",
  { candidateText: IntegratorCandidateText, detail: Schema.String, target: IntegrationTarget }
) {}

/** Git reported a target lineage rewrite, so no integration session may be created for this attempt. */
export class IntegratorTargetLineageIncompatible extends Schema.TaggedError<IntegratorTargetLineageIncompatible>()(
  "IntegratorTargetLineageIncompatible",
  { observation: TargetLineageObservation, responsibility: StartedIntegrationResponsibility }
) {}

/** A later activation observed a different H for an already fixed responsibility and must stop. */
export class IntegratorTargetHeadChanged extends Schema.TaggedError<IntegratorTargetHeadChanged>()(
  "IntegratorTargetHeadChanged",
  {
    observedTargetHead: GitCommitSha,
    recordedTargetHead: GitCommitSha,
    responsibility: StartedIntegrationResponsibility
  }
) {}

/** A replay supplied a different durable lineage-observation identity for the fixed session. */
export class IntegratorTargetLineageObservationChanged extends Schema.TaggedError<IntegratorTargetLineageObservationChanged>()(
  "IntegratorTargetLineageObservationChanged",
  { observedAt: JournalPosition, recordedAt: JournalPosition, responsibility: StartedIntegrationResponsibility }
) {}

/** A durable record at a boundary key contradicted the exact request being resumed. */
export class IntegratorJournalContradiction extends Schema.TaggedError<IntegratorJournalContradiction>()(
  "IntegratorJournalContradiction",
  { detail: Schema.String, runId: RunId }
) {}

export type IntegratorProtocolError =
  | IntegratorCallFailure
  | IntegratorProviderActivityAbsent
  | IntegratorGitReadFailure
  | IntegratorJournalContradiction
  | JournalAppendError
  | JournalReadError
  | IntegratorTargetHeadChanged
  | IntegratorTargetLineageObservationChanged
  | IntegratorTargetLineageIncompatible
