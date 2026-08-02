# AIF Handoff reliability architecture

## 1. Scope, pin, and evidence boundary

- Repository: `lee-to/aif-handoff`
- Audited commit: [`50602104b1e0c958225b8796f3d9ac56e8c87d15`](https://github.com/lee-to/aif-handoff/tree/50602104b1e0c958225b8796f3d9ac56e8c87d15)
- Evaluation assumption: one active coordinator process. API, web, MCP, and runtime-provider processes may also exist, but this card does not credit multi-coordinator safety beyond the row-level compare-and-set operations visible in source.
- Evidence boundary: source, tests, manifests, migrations, and checked-in documentation at the pinned commit. No process-kill experiment or week-long drift experiment was run.

The documentation describes a “self-healing pipeline,” a state machine, heartbeat recovery, and quarantine ([README, lines 214-246](https://github.com/lee-to/aif-handoff/blob/50602104b1e0c958225b8796f3d9ac56e8c87d15/README.md#L214-L246)). This card credits those claims only where a reachable source path implements them. In particular, the documented statement that stale implementation resumes from `plan_ready` ([architecture, lines 140-146](https://github.com/lee-to/aif-handoff/blob/50602104b1e0c958225b8796f3d9ac56e8c87d15/docs/architecture.md#L140-L146)) disagrees with the watchdog function at this pin, which returns the same status it receives ([taskWatchdog.ts, lines 25-27](https://github.com/lee-to/aif-handoff/blob/50602104b1e0c958225b8796f3d9ac56e8c87d15/packages/agent/src/taskWatchdog.ts#L25-L27)).

## 2. Architecture in plain language

AIF Handoff is a TypeScript monorepo split into web, API, data, shared, runtime, agent, and MCP packages. The package manifest runs separate development services and exposes Vitest, coverage, lint, and mutation-test commands ([package.json, lines 1-52](https://github.com/lee-to/aif-handoff/blob/50602104b1e0c958225b8796f3d9ac56e8c87d15/package.json#L1-L52)).

The durable control-plane center is one SQLite database. A task is primarily one mutable row containing its current stage, plan and output fields, retry/watchdog fields, one runtime session identifier, lock fields, and Git branch/worktree/commit fields ([schema.ts, lines 55-132](https://github.com/lee-to/aif-handoff/blob/50602104b1e0c958225b8796f3d9ac56e8c87d15/packages/shared/src/schema.ts#L55-L132)). The coordinator polls that table, conditionally claims eligible rows, invokes a stage-specific runtime workflow, and writes the next current status ([coordinator.ts, lines 84-135](https://github.com/lee-to/aif-handoff/blob/50602104b1e0c958225b8796f3d9ac56e8c87d15/packages/agent/src/coordinator.ts#L84-L135), [coordinator.ts, lines 989-1003](https://github.com/lee-to/aif-handoff/blob/50602104b1e0c958225b8796f3d9ac56e8c87d15/packages/agent/src/coordinator.ts#L989-L1003)).

This is a polling workflow over mutable snapshots, not a durable event-sourced execution engine. The shared `applyHumanTaskEvent` reducer validates human-triggered moves, but autonomous coordinator transitions are direct row updates ([stateMachine.ts, lines 26-112](https://github.com/lee-to/aif-handoff/blob/50602104b1e0c958225b8796f3d9ac56e8c87d15/packages/shared/src/stateMachine.ts#L26-L112), [coordinator.ts, lines 551-575](https://github.com/lee-to/aif-handoff/blob/50602104b1e0c958225b8796f3d9ac56e8c87d15/packages/agent/src/coordinator.ts#L551-L575)). There is no durable attempt/run entity from which the coordinator could reconstruct the exact invocation that was active before a crash.

## 3. State owners

| State or fact | Authoritative owner at this pin | Durable representation | Recovery consequence |
|---|---|---|---|
| Task identity, current lifecycle stage, pause and scheduling fields | SQLite `tasks` row | `id`, `status`, `paused`, `scheduled_at`, timestamps | Restart can rediscover the current row, not its complete transition history. |
| Current plan and stage outputs | SQLite row plus files in the target checkout | `plan`, `implementation_log`, `review_comments`, `agent_activity_log`; configured plan files | The database and worktree can drift independently because they are not committed atomically. |
| Retry/watchdog state | SQLite `tasks` row | `blocked_*`, `retry_after`, `retry_count`, heartbeat | Restart can release a due retry or detect stale work. |
| Coordinator claim | SQLite `tasks` row | `locked_by`, `locked_until` | An expired or stale claim can be cleared; there is no persisted lease-holder process identity beyond a random coordinator UUID. |
| Agent invocation/attempt | No durable owner found | In-memory promise, abort controller, and loop counter | Exact attempt restoration is impossible. |
| Runtime conversation | Runtime provider/session store | One `tasks.session_id` handle; provider-owned session material | Resume is possible only when the workflow and adapter support it and the provider session still exists. |
| Task branch/worktree binding | Git plus SQLite locator fields | Git refs/worktree metadata; `branch_name`, `worktree_path` | A later stage can restore and validate the named branch/path, but cannot reconstruct deleted Git objects. |
| Auto-queue commit checkpoint | Git plus SQLite task fields | base SHA, status, resulting commit SHA, error/completion time | Commit completion has a limited reconcile path; it is not an integration record. |
| Token usage audit | SQLite `usage_events` | Append-only usage rows | This is the clearest event-like durable history in the design ([schema.ts, lines 221-251](https://github.com/lee-to/aif-handoff/blob/50602104b1e0c958225b8796f3d9ac56e8c87d15/packages/shared/src/schema.ts#L221-L251)). |
| Codex transcript/index | `~/.codex/sessions/*.jsonl` owns transcript; SQLite owns a rebuildable index | Session JSONL plus `codex_sessions` and cursor tables | The code explicitly calls SQLite a read model, not the transcript source of truth ([schema.ts, lines 290-337](https://github.com/lee-to/aif-handoff/blob/50602104b1e0c958225b8796f3d9ac56e8c87d15/packages/shared/src/schema.ts#L290-L337)). |
| Live child process | Operating system and runtime adapter | PID/process handle only in memory | A replacement coordinator cannot discover, adopt, or fence the old process. |

The database is opened with WAL mode and foreign keys, then a current schema plus versioned migrations are applied ([db.ts, lines 1-41](https://github.com/lee-to/aif-handoff/blob/50602104b1e0c958225b8796f3d9ac56e8c87d15/packages/shared/src/db.ts#L1-L41), [db.ts, lines 762-837](https://github.com/lee-to/aif-handoff/blob/50602104b1e0c958225b8796f3d9ac56e8c87d15/packages/shared/src/db.ts#L762-L837)). This is useful local durability, but it does not turn multi-step database, provider, filesystem, and Git effects into one transaction.

## 4. Scheduling, task graph, and capacity

The product-level task scheduler is position-ordered, project-scoped polling. Auto-queue advances the lowest-position backlog row and counts all nonterminal pipeline statuses, including `blocked_external`, against project capacity ([data/index.ts, lines 1910-1935](https://github.com/lee-to/aif-handoff/blob/50602104b1e0c958225b8796f3d9ac56e8c87d15/packages/data/src/index.ts#L1910-L1935), [data/index.ts, lines 2123-2147](https://github.com/lee-to/aif-handoff/blob/50602104b1e0c958225b8796f3d9ac56e8c87d15/packages/data/src/index.ts#L2123-L2147)). The backlog-to-planning write is conditional on the row still being unpaused backlog work ([data/index.ts, lines 1838-1887](https://github.com/lee-to/aif-handoff/blob/50602104b1e0c958225b8796f3d9ac56e8c87d15/packages/data/src/index.ts#L1838-L1887)).

Capacity has two different implementations:

- Global and per-stage/project running counts are an in-memory semaphore. They disappear at process exit ([coordinator.ts, lines 137-224](https://github.com/lee-to/aif-handoff/blob/50602104b1e0c958225b8796f3d9ac56e8c87d15/packages/agent/src/coordinator.ts#L137-L224)).
- Task ownership is a durable row claim conditioned on expected project, status, pause state, optional auto mode, and lock expiry ([data/index.ts, lines 1760-1786](https://github.com/lee-to/aif-handoff/blob/50602104b1e0c958225b8796f3d9ac56e8c87d15/packages/data/src/index.ts#L1760-L1786)). Nonparallel projects also check for an active lock before starting another task ([coordinator.ts, lines 1099-1106](https://github.com/lee-to/aif-handoff/blob/50602104b1e0c958225b8796f3d9ac56e8c87d15/packages/agent/src/coordinator.ts#L1099-L1106)).

Under the one-coordinator assumption, the semaphore is a reasonable local admission controller. It is not a durable capacity ledger: after a crash the new process sees zero in-memory activity while old provider or child work may still exist.

No cross-task dependency table or typed task-edge model exists in the schema. “Dependencies” are parsed from numbered checklist items inside one task's Markdown plan and converted to execution layers; a cycle falls back to deterministic single-task draining rather than becoming an invalid plan ([planLayers.ts, lines 54-129](https://github.com/lee-to/aif-handoff/blob/50602104b1e0c958225b8796f3d9ac56e8c87d15/packages/agent/src/planLayers.ts#L54-L129), [planLayers.ts, lines 161-209](https://github.com/lee-to/aif-handoff/blob/50602104b1e0c958225b8796f3d9ac56e8c87d15/packages/agent/src/planLayers.ts#L161-L209)). That is an agent-prompt execution hint, not a durable control-plane task graph.

## 5. Restoration layers

### Control task and run

The task row survives restart and contains enough information to repoll a stage. It does not contain an attempt ID, attempt ordinal, invocation input snapshot, side-effect intent, terminal attempt result, or parent/child attempt relationship. `retryCount` is shared by several recovery mechanisms and is not a run identity.

Starting and completing a stage are separate writes around an external call ([coordinator.ts, lines 551-564](https://github.com/lee-to/aif-handoff/blob/50602104b1e0c958225b8796f3d9ac56e8c87d15/packages/agent/src/coordinator.ts#L551-L564), [coordinator.ts, lines 674-694](https://github.com/lee-to/aif-handoff/blob/50602104b1e0c958225b8796f3d9ac56e8c87d15/packages/agent/src/coordinator.ts#L674-L694)). A crash between them leaves only “this task is in this stage,” not “attempt X definitely did or did not perform effect Y.”

### Agent session, context, and log

Before a runtime call, the agent reads the task's one `session_id` only when the workflow permits resume. It then chooses `adapter.resume` or `adapter.run`, and saves a returned session ID after success ([subagentQuery.ts, lines 833-846](https://github.com/lee-to/aif-handoff/blob/50602104b1e0c958225b8796f3d9ac56e8c87d15/packages/agent/src/subagentQuery.ts#L833-L846), [subagentQuery.ts, lines 1055-1093](https://github.com/lee-to/aif-handoff/blob/50602104b1e0c958225b8796f3d9ac56e8c87d15/packages/agent/src/subagentQuery.ts#L1055-L1093), [subagentQuery.ts, lines 1145-1179](https://github.com/lee-to/aif-handoff/blob/50602104b1e0c958225b8796f3d9ac56e8c87d15/packages/agent/src/subagentQuery.ts#L1145-L1179)).

Every `updateTaskStatus` clears `session_id` before applying extra fields ([data/index.ts, lines 2186-2207](https://github.com/lee-to/aif-handoff/blob/50602104b1e0c958225b8796f3d9ac56e8c87d15/packages/data/src/index.ts#L2186-L2207)). Therefore the handle is stage-current and lossy, not a durable log of all planner, implementer, reviewer, retry, and sidecar sessions. Activity is appended by reading the whole current string and writing a longer string, so it is neither an independently keyed event stream nor a safe concurrent append primitive ([data/index.ts, lines 2168-2178](https://github.com/lee-to/aif-handoff/blob/50602104b1e0c958225b8796f3d9ac56e8c87d15/packages/data/src/index.ts#L2168-L2178)).

For Codex, durable transcript content remains in the user's Codex session files. For other adapters, retention and later resume depend on that provider. A week-later `session_id` is only a locator; it is not embedded context, a prompt snapshot, or proof that the referenced account/model/tool configuration is unchanged.

### Full Git layers

The planner can create a deterministic feature branch and optionally a sibling task worktree. It stores only branch name and absolute worktree path on the task ([planner.ts, lines 191-239](https://github.com/lee-to/aif-handoff/blob/50602104b1e0c958225b8796f3d9ac56e8c87d15/packages/agent/src/subagents/planner.ts#L191-L239)). Worktree creation refreshes a configured base, then either attaches an existing branch or creates one from the base ref ([gitIsolation.ts, lines 539-629](https://github.com/lee-to/aif-handoff/blob/50602104b1e0c958225b8796f3d9ac56e8c87d15/packages/shared/src/gitIsolation.ts#L539-L629)).

The durable Git surface is incomplete for exact restoration:

- Base SHA is recorded only by the optional auto-queue commit gate, not as the planned base for every task attempt.
- No index checksum, unstaged/untracked manifest, submodule state, sparse-checkout state, worktree Git-dir locator, merge/rebase state, or target-ref observation is stored on an attempt.
- Downstream stages restore the persisted branch and fail closed if configuration, repository presence, branch, or cleanliness no longer matches ([gitIsolation.ts, lines 786-864](https://github.com/lee-to/aif-handoff/blob/50602104b1e0c958225b8796f3d9ac56e8c87d15/packages/shared/src/gitIsolation.ts#L786-L864)). That protects against silently using the wrong branch, but it is validation, not reconstruction.
- Worktrees are intentionally retained after completion according to the architecture document ([architecture, lines 299-322](https://github.com/lee-to/aif-handoff/blob/50602104b1e0c958225b8796f3d9ac56e8c87d15/docs/architecture.md#L299-L322)). Retention aids manual inspection but leaves cleanup and eventual drift outside a typed disposition protocol.

### Live process

Per-task abort controllers live only in a process-local map ([stageAbort.ts, lines 1-37](https://github.com/lee-to/aif-handoff/blob/50602104b1e0c958225b8796f3d9ac56e8c87d15/packages/agent/src/stageAbort.ts#L1-L37)). CLI adapters connect abort signals to child termination; for example Codex sends `SIGTERM` to its child ([codex/cli.ts, lines 811-839](https://github.com/lee-to/aif-handoff/blob/50602104b1e0c958225b8796f3d9ac56e8c87d15/packages/runtime/src/adapters/codex/cli.ts#L811-L839), [codex/cli.ts, lines 904-913](https://github.com/lee-to/aif-handoff/blob/50602104b1e0c958225b8796f3d9ac56e8c87d15/packages/runtime/src/adapters/codex/cli.ts#L904-L913)). Process timeouts can send `SIGKILL` ([timeouts.ts, lines 278-347](https://github.com/lee-to/aif-handoff/blob/50602104b1e0c958225b8796f3d9ac56e8c87d15/packages/runtime/src/timeouts.ts#L278-L347)).

Graceful coordinator shutdown aborts known stages and best-effort releases their locks before immediately exiting ([agent/index.ts, lines 134-167](https://github.com/lee-to/aif-handoff/blob/50602104b1e0c958225b8796f3d9ac56e8c87d15/packages/agent/src/index.ts#L134-L167)). Hard death bypasses that map and handler. No PID, process-group ID, host/boot identity, provider request ID, or adopt/terminate record is persisted, so live-process restoration is absent.

## 6. Immediate restart behavior

Chronologically, a replacement coordinator:

1. Opens SQLite and starts its poll scheduler ([agent/index.ts, lines 38-50](https://github.com/lee-to/aif-handoff/blob/50602104b1e0c958225b8796f3d9ac56e8c87d15/packages/agent/src/index.ts#L38-L50)).
2. On a poll, first clears claims whose TTL expired or whose in-progress task has an old heartbeat/update timestamp ([data/index.ts, lines 2010-2037](https://github.com/lee-to/aif-handoff/blob/50602104b1e0c958225b8796f3d9ac56e8c87d15/packages/data/src/index.ts#L2010-L2037)).
3. Releases `blocked_external` rows whose retry time is due, restoring their stored `blockedFromStatus` and resetting `retryCount` to zero ([taskWatchdog.ts, lines 39-73](https://github.com/lee-to/aif-handoff/blob/50602104b1e0c958225b8796f3d9ac56e8c87d15/packages/agent/src/taskWatchdog.ts#L39-L73)).
4. Scans unlocked/expired in-progress rows. Only after the stale timeout does it move one to `blocked_external` and schedule a 5–15 minute retry ([taskWatchdog.ts, lines 76-96](https://github.com/lee-to/aif-handoff/blob/50602104b1e0c958225b8796f3d9ac56e8c87d15/packages/agent/src/taskWatchdog.ts#L76-L96), [taskWatchdog.ts, lines 126-159](https://github.com/lee-to/aif-handoff/blob/50602104b1e0c958225b8796f3d9ac56e8c87d15/packages/agent/src/taskWatchdog.ts#L126-L159)).
5. Eventually repolls the restored same stage and starts another runtime call.

This is delayed stage rerun, not immediate adoption. A restart before lock/heartbeat staleness waits. A restart after staleness can duplicate effects if the old process or provider request is still executing. The design has neither a durable effect intent nor an observation/reconciliation step before rerun, except for the narrower commit gate.

The first-activity watchdog is separate and in-process. It creates a fresh abort controller for each local retry and can restart a runtime attempt when no activity arrives ([subagentQuery.ts, lines 969-1015](https://github.com/lee-to/aif-handoff/blob/50602104b1e0c958225b8796f3d9ac56e8c87d15/packages/agent/src/subagentQuery.ts#L969-L1015), [subagentQuery.ts, lines 1097-1116](https://github.com/lee-to/aif-handoff/blob/50602104b1e0c958225b8796f3d9ac56e8c87d15/packages/agent/src/subagentQuery.ts#L1097-L1116)). It does not survive coordinator death. Also, the documentation says it is SDK-only and disabled for CLI, while the source gives CLI a doubled timeout and disables only API transport ([architecture, line 140](https://github.com/lee-to/aif-handoff/blob/50602104b1e0c958225b8796f3d9ac56e8c87d15/docs/architecture.md#L140), [subagentQuery.ts, lines 949-966](https://github.com/lee-to/aif-handoff/blob/50602104b1e0c958225b8796f3d9ac56e8c87d15/packages/agent/src/subagentQuery.ts#L949-L966)).

## 7. Week-later restoration and external drift

After a week, time-based locks and retry windows will be expired, so the row is dispatchable unless it has reached a manual block. That does not make its saved execution environment valid.

The next stage re-reads current project and runtime configuration, then may reuse the task's active runtime selection for same-status retries. The persisted session, absolute worktree path, branch name, and optional auto-queue base SHA can now refer to:

- a deleted/moved checkout or pruned worktree;
- a branch that was deleted, force-updated, merged, or rebased;
- a provider session removed by retention or owned by different credentials;
- a model/profile whose behavior or availability changed;
- a plan file or uncommitted tree changed by a human;
- an upstream base and integration target that moved substantially.

Branch restoration detects several of those Git failures and deliberately blocks for manual action. It does not compare current worktree content with a previously captured full Git snapshot. Session resume similarly delegates validity to the runtime adapter.

The watchdog's terminal “quarantine” is a row in `blocked_external` with `retryAfter: null`; the log message calls it quarantined, but there is no distinct quarantine table, status, resource inventory, or cleanup disposition ([taskWatchdog.ts, lines 98-123](https://github.com/lee-to/aif-handoff/blob/50602104b1e0c958225b8796f3d9ac56e8c87d15/packages/agent/src/taskWatchdog.ts#L98-L123)). A week-later operator therefore receives a reason string and surviving ambient artifacts, not a packaged recovery bundle.

## 8. Git starting state and integration boundary

For shared-branch mode, feature-branch creation insists on a clean working tree before switching, refreshes the configured base with `pull --ff-only`, and either fails or warns on refresh failure depending on `strict_base_update` ([gitIsolation.ts, lines 632-768](https://github.com/lee-to/aif-handoff/blob/50602104b1e0c958225b8796f3d9ac56e8c87d15/packages/shared/src/gitIsolation.ts#L632-L768)). For worktree mode it creates the sibling worktree from the configured local or remote base. This is a useful starting-state gate, but the actual starting commit is not generally attached to a durable task attempt.

The optional auto-queue commit gate is the strongest ambiguity-aware slice:

- It records a base SHA when auto-queue advances a task.
- Before terminal status, it restores the task branch, observes current HEAD and dirtiness, and records `pending`/`running`/`committed`/`no_changes`/`failed`.
- If the tree is already clean and HEAD differs from base, it reconciles that as committed; after invoking the commit workflow it requires a clean tree and exactly one new commit ([autoQueueCommit.ts, lines 75-168](https://github.com/lee-to/aif-handoff/blob/50602104b1e0c958225b8796f3d9ac56e8c87d15/packages/agent/src/autoQueueCommit.ts#L75-L168), [autoQueueCommit.ts, lines 170-224](https://github.com/lee-to/aif-handoff/blob/50602104b1e0c958225b8796f3d9ac56e8c87d15/packages/agent/src/autoQueueCommit.ts#L170-L224)).

This gate is feature-flagged and local. It explicitly uses a commit workflow with push disabled ([autoQueueCommit.ts, lines 170-193](https://github.com/lee-to/aif-handoff/blob/50602104b1e0c958225b8796f3d9ac56e8c87d15/packages/agent/src/autoQueueCommit.ts#L170-L193)). No reachable accepted-head protocol, remote push receipt, pull-request identity, merge queue, integration lease, target-ref compare-and-set, or post-merge observation was found. `done` therefore means the workflow finished (and optionally produced a verified local commit), not that the change was integrated into an authoritative target.

## 9. Code organization, layers, and vertical slices

The package split provides recognizable technical layers:

- `shared`: schema, migrations, types, Git helpers, human-event reducer;
- `data`: query and update functions over shared Drizzle tables;
- `runtime`: provider registry, capability contracts, session APIs, CLI/SDK/API adapters, timeout utilities;
- `agent`: polling coordinator and stage workflows;
- `api` and `mcp`: external command/query boundaries;
- `web`: operator UI.

The dependency direction is mostly explicit in package manifests: `agent` depends on data, runtime, and shared ([agent/package.json, lines 1-29](https://github.com/lee-to/aif-handoff/blob/50602104b1e0c958225b8796f3d9ac56e8c87d15/packages/agent/package.json#L1-L29)); `runtime` depends only on shared within the monorepo ([runtime/package.json, lines 1-31](https://github.com/lee-to/aif-handoff/blob/50602104b1e0c958225b8796f3d9ac56e8c87d15/packages/runtime/package.json#L1-L31)); and `data` depends on shared ([data/package.json, lines 1-24](https://github.com/lee-to/aif-handoff/blob/50602104b1e0c958225b8796f3d9ac56e8c87d15/packages/data/package.json#L1-L24)).

Reliability behavior is nevertheless spread horizontally. One lifecycle decision can touch coordinator status writes, data queries, runtime error classification, watchdog policy, session policy, Git helpers, and stage-specific code. The task row acts as a broad integration object. There is no explicit attempt aggregate or recovery slice that owns “claim → declare intent → launch → observe → settle/reconcile.”

## 10. Production, test, fake, and dry-run seams

Runtime adapters have a useful production seam. `RuntimeAdapter` supports capability-declared `run`, optional `resume`, and session operations, while the registry resolves a configured implementation. This allows tests to substitute adapters and lets several providers share orchestration policy ([runtime/types.ts, lines 457-513](https://github.com/lee-to/aif-handoff/blob/50602104b1e0c958225b8796f3d9ac56e8c87d15/packages/runtime/src/types.ts#L457-L513), [runtime/registry.ts, lines 79-105](https://github.com/lee-to/aif-handoff/blob/50602104b1e0c958225b8796f3d9ac56e8c87d15/packages/runtime/src/registry.ts#L79-L105)).

Database tests can create an in-memory SQLite database through the same schema setup path ([db.ts, lines 1044-1068](https://github.com/lee-to/aif-handoff/blob/50602104b1e0c958225b8796f3d9ac56e8c87d15/packages/shared/src/db.ts#L1044-L1068)). Agent tests heavily use Vitest module mocks; Git tests create real temporary repositories. These are good unit/integration seams but not a production-shaped fake control plane.

No workflow-wide dry-run interpreter was found. The only checked-in `dry-run` references are mutation-test dry runs and a backlog-position normalization utility, not execution of the coordinator algebra without effects ([package.json, lines 31-38](https://github.com/lee-to/aif-handoff/blob/50602104b1e0c958225b8796f3d9ac56e8c87d15/package.json#L31-L38), [normalizeBacklogPositions.ts, lines 201-236](https://github.com/lee-to/aif-handoff/blob/50602104b1e0c958225b8796f3d9ac56e8c87d15/packages/data/src/normalizeBacklogPositions.ts#L201-L236)). There is no durable fake provider that simulates ambiguous completion, stale observations, restart adoption, or Git integration outcomes through the same production workflow.

## 11. Verification approach

The repository has a broad Vitest suite across all packages, coverage commands, Playwright UI performance checks, and opt-in Stryker mutation testing. Stryker targets selected agent/data/runtime/shared/API/web code with package-specific suites and score thresholds ([stryker.conf.mjs, lines 1-29](https://github.com/lee-to/aif-handoff/blob/50602104b1e0c958225b8796f3d9ac56e8c87d15/stryker.conf.mjs#L1-L29), [stryker.conf.mjs, lines 132-162](https://github.com/lee-to/aif-handoff/blob/50602104b1e0c958225b8796f3d9ac56e8c87d15/stryker.conf.mjs#L132-L162)).

Relevant example-based tests cover:

- state-machine human transitions;
- coordinator candidate claims and semaphore behavior;
- watchdog retries and max-retry block;
- review convergence and manual handoff;
- Git branch/worktree creation and restoration;
- runtime adapter abort, timeout, and session resume;
- migration compatibility and in-memory schema setup.

No property-based testing dependency, state-machine model test harness, formal specification, model checker, linearizability test, or crash/restart fault-injection suite was found in manifests or source/test names. Mutation testing improves assertion strength but does not establish recovery invariants across process, SQLite, provider, filesystem, and Git boundaries. The most important missing executable scenarios are kill-after-each-boundary tests and week-later drift/reconciliation tests.

## 12. Chronological failure analysis

1. **Before claim:** a task is merely eligible. Conditional backlog advance and coordinator claim prevent a stale candidate snapshot from being started after its row changes.
2. **After claim, before stage-status write:** the durable lock exists, but there is no attempt row. A crash causes a wait until expiry/stale release and then another selection.
3. **After stage-status write, before provider launch:** the row says in progress. Watchdog eventually treats it exactly like a mid-provider crash because no launch intent/result distinction exists.
4. **After provider launch, before session ID capture:** a hard crash loses the in-memory process handle and may lose the only runtime session locator. The provider or child may continue.
5. **During agent edits:** filesystem and Git changes can exist without a matching database checkpoint. Rerunning the same stage can see and modify those remnants.
6. **After provider success, before output/status write:** the external work may be complete while the task still looks in progress. Generic stage recovery reruns rather than reconciling provider result.
7. **During first-activity retry:** the old local attempt is aborted and a new one starts, but the retry ordinal and provider request identity are not durable.
8. **During review/rework:** blocking findings, iteration count, and manual-review flag are durable on the task. The loop is bounded; at max iterations it writes `done` plus `manualReviewRequired=true`, not a separate review-awaiting status ([autoReviewHandler.ts, lines 175-218](https://github.com/lee-to/aif-handoff/blob/50602104b1e0c958225b8796f3d9ac56e8c87d15/packages/agent/src/autoReviewHandler.ts#L175-L218), [coordinator.ts, lines 587-625](https://github.com/lee-to/aif-handoff/blob/50602104b1e0c958225b8796f3d9ac56e8c87d15/packages/agent/src/coordinator.ts#L587-L625)).
9. **During local commit:** `running` plus base SHA gives the commit gate enough information to inspect HEAD/tree on retry. This is the one prominent reconcile-before-repeat path.
10. **After local commit, before terminal status:** a retry short-circuits when `committed` and `commitSha` are already stored. If Git committed but the database write was lost, clean-tree reconciliation can infer completion, although it accepts any clean HEAD different from base in that branch.
11. **After terminal status:** no push/merge integration follows. Retained worktrees and branches remain operator-managed.
12. **Coordinator hard death:** graceful abort/release does not run. The new coordinator cannot identify live descendants; it waits for durable timeouts, then reruns a stage.

## 13. Risks and limitations

- **Snapshot mistaken for history:** current task fields cannot answer which attempt caused an edit, comment, token event, or provider side effect.
- **Document/source drift:** stale implementation recovery and CLI first-activity behavior are already described differently from reachable code.
- **False quarantine confidence:** “quarantined” means only a manual `blocked_external` row; no artifacts are inventoried or protected.
- **Duplicate side effects after hard death:** locks fence coordinators, not a still-running provider request or orphaned child.
- **Retry counter semantics:** due-block release resets `retryCount` to zero, so repeated stale episodes can each receive a fresh maximum rather than forming a lifetime bound.
- **Unsafe generic revert loop:** an unclassified error writes the same in-progress status again ([stageErrorHandler.ts, lines 328-341](https://github.com/lee-to/aif-handoff/blob/50602104b1e0c958225b8796f3d9ac56e8c87d15/packages/agent/src/stageErrorHandler.ts#L328-L341), [coordinator.ts, lines 748-756](https://github.com/lee-to/aif-handoff/blob/50602104b1e0c958225b8796f3d9ac56e8c87d15/packages/agent/src/coordinator.ts#L748-L756)). The next poll can retry without a durable ordinal or total bound.
- **Ambient Git recovery:** surviving directories/refs are useful, but exact committed, staged, unstaged, untracked, and metadata layers are not recorded as one starting fact set.
- **Weak integration meaning:** local clean commit is not accepted integration.
- **Capacity after restart:** semaphore counters reset even if old work survives.
- **Activity-log append race:** read/concatenate/write can lose concurrent entries.
- **Migration confidence:** compatibility migrations are extensive, but duplicate-column/already-exists errors are ignored by message matching and historical version reuse is noted in source ([db.ts, lines 762-837](https://github.com/lee-to/aif-handoff/blob/50602104b1e0c958225b8796f3d9ac56e8c87d15/packages/shared/src/db.ts#L762-L837)).

## 14. Ideas Dalph should steal

- Use a conditional claim that rechecks the candidate's expected task status, project, pause state, and mode at the write boundary.
- Release stale claims before changing stale task state so recovery does not strand an irrelevant lock.
- Make a persisted branch binding fail closed when the branch, repository, or configuration drifts; do not silently continue on current HEAD.
- Count externally blocked work against project capacity so retries do not oversubscribe the pipeline.
- Bound automated review/rework and persist the exact blocking-findings snapshot that feeds the next implementation pass.
- Treat malformed review output after prior blockers as a manual handoff, not as success.
- Preserve a local commit intent/status/base/result record and inspect Git before retrying an ambiguous commit.
- Keep runtime/provider choice behind a capability-declared adapter interface, with explicit resume support rather than assuming every session can resume.
- Prefer provider-supplied reset time over blind random backoff, while retaining a conservative fallback.

These are useful local mechanisms. Dalph should place them inside its stricter model: tracker-owned task lifecycle, a distinct planned attempt with exact base SHA and worktree, durable intent before ambiguity-crossing effects, observation afterward, and reconciliation before retry.

## 15. Unknowns and negative search

Negative searches covered schema declarations, migrations, agent/data/runtime/API source, package manifests, and test filenames/contents for attempt/run tables, dependency edges, dry-run/fake execution, process IDs, recovery/adoption, quarantine resources, push/merge/integration, property testing, and formal models.

Not found at this pin:

- a durable task-attempt/run table or attempt event log;
- a product-level task dependency graph;
- persisted PID/process-group/host identity or process adoption;
- a full Git starting snapshot per attempt;
- worktree cleanup/disposition state;
- remote push, pull request, merge, accepted-head, or integration ownership;
- production-shaped fake provider and shared dry-run interpreter;
- property-based, formal, or model-checking verification;
- hard-kill boundary tests or restart-in-a-new-process scenarios.

Still unknown without experiments or deployment evidence:

- whether every provider/SDK abort reliably terminates all descendants;
- what happens to orphaned CLI children in each container/init configuration;
- whether a provider may complete a request after local abort;
- practical SQLite/filesystem durability under host or volume failure;
- how often old session IDs remain resumable after credentials, versions, or retention change;
- whether operators have an external branch/worktree cleanup convention;
- whether an external CI or human process performs integration not represented in this repository.

## 16. Consequences for Dalph

AIF Handoff demonstrates a pragmatic single-host coordinator that can recover a task's current stage, retry provider failures, bound review loops, restore a named Git branch/worktree, and reconcile one local-commit ambiguity. It does **not** demonstrate reconstruction of an exact agent run.

For Dalph, “session” must be decomposed explicitly:

- the tracker task and its authoritative lifecycle;
- the planned task attempt, with exact base SHA and exact worktree;
- each agent invocation and its provider session/context/log;
- the live executor process observation;
- the Git layers produced by the attempt;
- the integration attempt and accepted result.

The AIF Handoff design shows why one mutable task row is insufficient: after a crash it can say “implementing,” but not which invocation was running, what it had durably intended, which Git layers belong to it, whether the external effect completed, or whether a surviving process must be terminated before retry. Dalph should retain the good conditional claims, fail-closed Git validation, bounded review policy, and commit reconciliation pattern while making attempt identity, observations, cleanup disposition, and integration facts first-class and authority-correct.
