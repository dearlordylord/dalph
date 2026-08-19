import type { AttemptId, RunId, TaskBranchRef, WorktreeLocator } from "@dalph/contracts"
import type {
  ClaimToken,
  IntegratorCandidateResourceLocator,
  IntegratorSessionId,
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
    integratorCandidateResourceLocators: invertIdentityRenamings<IntegratorCandidateResourceLocator>(
      renaming.integratorCandidateResourceLocators
    ),
    integratorSessionIds: invertIdentityRenamings<IntegratorSessionId>(renaming.integratorSessionIds),
    operationIds: invertIdentityRenamings<OperationId>(renaming.operationIds),
    runIds: invertIdentityRenamings<RunId>(renaming.runIds),
    taskBranchRefs: invertIdentityRenamings<TaskBranchRef>(renaming.taskBranchRefs),
    worktreeLocators: invertIdentityRenamings<WorktreeLocator>(renaming.worktreeLocators)
  })
