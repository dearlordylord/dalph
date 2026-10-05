/* eslint-disable import/no-nodejs-modules -- The disposable qualification host reads its process environment. */
import nodeProcess from "node:process"
import { Effect, Schema } from "effect"
import { AttemptId, GitCommitSha, RunId, TaskBranchRef, TaskId } from "@dalph/contracts"
import { CodexToolEffectPolicy } from "../src/application/codex-tool-effect-policy.js"
import { CodexQualificationAction } from "./codex-qualification-host-contract.js"

const QualificationConfiguration = Schema.Struct({
  action: CodexQualificationAction,
  worktree: Schema.NonEmptyString,
  stateDirectory: Schema.NonEmptyString,
  evidenceDirectory: Schema.NonEmptyString,
  codexHome: Schema.NonEmptyString,
  codexExecutable: Schema.NonEmptyString,
  baseSha: GitCommitSha,
  branch: TaskBranchRef,
  taskId: TaskId,
  runId: RunId,
  attemptId: AttemptId,
  holdAfterAction: Schema.Boolean,
  waitForOwnedChild: Schema.Boolean,
  waitForTerminalProjection: Schema.Boolean,
  toolEffectPolicy: Schema.optionalKey(Schema.fromJsonString(CodexToolEffectPolicy)),
  controlledProviderCredential: Schema.optionalKey(Schema.String)
})
export type QualificationConfiguration = typeof QualificationConfiguration.Type

export class QualificationConfigurationFailure extends Schema.TaggedError<QualificationConfigurationFailure>()(
  "QualificationConfigurationFailure",
  { detail: Schema.String }
) {}

const envValue = (name: string): string | undefined => nodeProcess.env[name]

export const rawConfiguration = {
  action: nodeProcess.argv[2],
  worktree: envValue("DALPH_CODEX_QUALIFICATION_WORKTREE"),
  stateDirectory: envValue("DALPH_CODEX_QUALIFICATION_STATE"),
  evidenceDirectory: envValue("DALPH_CODEX_QUALIFICATION_EVIDENCE"),
  codexHome: envValue("CODEX_HOME"),
  codexExecutable: envValue("CODEX_BIN") ?? "codex",
  baseSha: envValue("DALPH_CODEX_QUALIFICATION_BASE_SHA"),
  branch: envValue("DALPH_CODEX_QUALIFICATION_BRANCH") ?? "refs/heads/dalph/real-codex-qualification",
  taskId: envValue("DALPH_CODEX_QUALIFICATION_TASK_ID") ?? "real-codex-qualification-task",
  runId: envValue("DALPH_CODEX_QUALIFICATION_RUN_ID") ?? "real-codex-qualification-run",
  attemptId: envValue("DALPH_CODEX_QUALIFICATION_ATTEMPT_ID") ?? "real-codex-qualification-attempt",
  holdAfterAction: envValue("DALPH_CODEX_QUALIFICATION_HOLD") === "1",
  waitForOwnedChild: envValue("DALPH_CODEX_QUALIFICATION_WAIT_FOR_OWNED_CHILD") === "1",
  waitForTerminalProjection: envValue("DALPH_CODEX_QUALIFICATION_WAIT_FOR_TERMINAL_PROJECTION") === "1",
  ...(envValue("DALPH_CODEX_QUALIFICATION_TOOL_EFFECT_POLICY") === undefined
    ? {}
    : { toolEffectPolicy: envValue("DALPH_CODEX_QUALIFICATION_TOOL_EFFECT_POLICY") }),
  ...(envValue("DALPH_LIVE_CONTROLLED_PROVIDER_CREDENTIAL") === undefined
    ? {}
    : { controlledProviderCredential: envValue("DALPH_LIVE_CONTROLLED_PROVIDER_CREDENTIAL") })
}

export const decodeConfiguration = (): Effect.Effect<QualificationConfiguration, QualificationConfigurationFailure> =>
  Schema.decodeUnknownEffect(QualificationConfiguration)(rawConfiguration).pipe(
    Effect.mapError(
      (error) =>
        new QualificationConfigurationFailure({ detail: `invalid qualification host configuration: ${String(error)}` })
    )
  )
