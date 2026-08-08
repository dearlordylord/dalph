import type { AttemptId, RunId, TaskBranchRef, WorktreeLocator } from "@dalph/contracts"
import type {
  ClaimToken,
  IntegrationCandidateId,
  IntegrationCandidateResourceLocator,
  IntegrationSessionId,
  OperationId
} from "@dalph/orchestrator"
import {
  CassetteIdentityRenaming,
  type CassetteIdentityRenaming as CassetteIdentityRenamingType
} from "./recorded-domain.js"

const invertIdentityRenamings = <Identity extends string>(
  renamings: ReadonlyArray<{ readonly from: Identity; readonly to: Identity }>
) => renamings.map(({ from, to }) => ({ from: to, to: from }))

export const invertCassetteIdentityRenaming = (renaming: CassetteIdentityRenamingType): CassetteIdentityRenamingType =>
  CassetteIdentityRenaming.make({
    attemptIds: invertIdentityRenamings<AttemptId>(renaming.attemptIds),
    claimTokens: invertIdentityRenamings<ClaimToken>(renaming.claimTokens),
    integrationCandidateIds: invertIdentityRenamings<IntegrationCandidateId>(renaming.integrationCandidateIds),
    integrationCandidateResourceLocators: invertIdentityRenamings<IntegrationCandidateResourceLocator>(
      renaming.integrationCandidateResourceLocators
    ),
    integrationSessionIds: invertIdentityRenamings<IntegrationSessionId>(renaming.integrationSessionIds),
    operationIds: invertIdentityRenamings<OperationId>(renaming.operationIds),
    runIds: invertIdentityRenamings<RunId>(renaming.runIds),
    taskBranchRefs: invertIdentityRenamings<TaskBranchRef>(renaming.taskBranchRefs),
    worktreeLocators: invertIdentityRenamings<WorktreeLocator>(renaming.worktreeLocators)
  })
