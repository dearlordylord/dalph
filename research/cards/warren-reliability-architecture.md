# Warren reliability architecture

## 1. Scope, pin, and evidence boundary

- Repository: `jayminwest/warren`
- Audited commit: [`b13c7597c529360ad150bccc629bf28f603bc692`](https://github.com/jayminwest/warren/tree/b13c7597c529360ad150bccc629bf28f603bc692)
- Evaluation assumption: one active Warren coordinator. HTTP requests, several runs, and several provider-side processes or pods may overlap, but this card does not require active-active coordinator safety.
- Evidence boundary: reachable source, tests, migrations, manifests, and documentation at the pinned commit. No kill experiment or week-long drift experiment was run.

Warren's local provider delegates sandbox creation, execution, event streaming, finalization, and destruction to the sibling Burrow product ([local provider, lines 101-274](https://github.com/jayminwest/warren/blob/b13c7597c529360ad150bccc629bf28f603bc692/src/runtime/local/provider.ts#L101-L274)). The sibling Burrow source required for an independent sandbox audit was not present beside this checkout. This card therefore credits Warren's calls and provider declarations, but not undocumented Burrow internals. The Kubernetes provider, admission controller, pod construction, init script, and in-pod harness are in scope because they are implemented in Warren.

Some source comments are migration history rather than reachable architecture. In particular, the generic workspace materializer and Git worktree module say they were extracted from Burrow but are intentionally not imported by the domain yet ([materialize.ts, lines 18-31](https://github.com/jayminwest/warren/blob/b13c7597c529360ad150bccc629bf28f603bc692/src/workspace/materialize.ts#L18-L31), [worktree.ts, lines 14-21](https://github.com/jayminwest/warren/blob/b13c7597c529360ad150bccc629bf28f603bc692/src/workspace/git/worktree.ts#L14-L21)). They are not evidence of production behavior. Likewise, the specification calls Overstory a sibling for multi-agent orchestration while Warren remains one agent per run ([SPEC, lines 2952-2961](https://github.com/jayminwest/warren/blob/b13c7597c529360ad150bccc629bf28f603bc692/SPEC.md#L2952-L2961)); this audit does not import Overstory behavior into Warren.

## 2. Plain-language architecture

Warren is a Bun/TypeScript control plane with a CLI and HTTP/UI surface, Drizzle-backed SQLite or PostgreSQL persistence, and one runtime-provider seam selected at boot ([package.json, lines 1-86](https://github.com/jayminwest/warren/blob/b13c7597c529360ad150bccc629bf28f603bc692/package.json#L1-L86), [registry.ts, lines 137-212](https://github.com/jayminwest/warren/blob/b13c7597c529360ad150bccc629bf28f603bc692/src/runtime/registry.ts#L137-L212)).

A manual, scheduled, continuation, or plan-child request first refreshes the registered project clone. Warren then inserts a run row containing a frozen rendered agent definition and user prompt, derives a run branch from the new run ID, asks the selected provider to create a sandbox and launch the agent, and finally attaches the provider's sandbox and run identifiers in two database writes ([dispatch.ts, lines 149-188](https://github.com/jayminwest/warren/blob/b13c7597c529360ad150bccc629bf28f603bc692/src/runs/spawn/dispatch.ts#L149-L188), [dispatch.ts, lines 215-254](https://github.com/jayminwest/warren/blob/b13c7597c529360ad150bccc629bf28f603bc692/src/runs/spawn/dispatch.ts#L215-L254)).

The control-plane run has `queued`, `running`, and terminal states. A stream bridge copies ordered provider events into Warren's event table and detects terminal envelopes. Reap then asks the provider to finalize the workspace, push the run branch, optionally open a pull request, and destroy or preserve the workspace according to the result ([bridge.ts, lines 57-128](https://github.com/jayminwest/warren/blob/b13c7597c529360ad150bccc629bf28f603bc692/src/runs/stream/bridge.ts#L57-L128), [pipeline.ts, lines 443-495](https://github.com/jayminwest/warren/blob/b13c7597c529360ad150bccc629bf28f603bc692/src/runs/reap/pipeline.ts#L443-L495), [run.ts, lines 242-257](https://github.com/jayminwest/warren/blob/b13c7597c529360ad150bccc629bf28f603bc692/src/runs/reap/run.ts#L242-L257)).

The provider contract is deliberately narrower than either backend. It passes provider-neutral workspace, agent, isolation, environment, stream, status, finalize, and teardown intents while keeping pod names, Burrow details, sockets, and host paths out of domain logic ([contract.ts, lines 16-98](https://github.com/jayminwest/warren/blob/b13c7597c529360ad150bccc629bf28f603bc692/src/runtime/contract.ts#L16-L98), [contract.ts, lines 194-219](https://github.com/jayminwest/warren/blob/b13c7597c529360ad150bccc629bf28f603bc692/src/runtime/contract.ts#L194-L219)).

Plan-runs are a second, durable state machine. A plan stores ordered child seeds. Within one plan-run, Warren dispatches one child, waits for its successful run to open a pull request, then waits for that pull request to be externally merged before dispatching the next child ([coordinator.ts, lines 167-236](https://github.com/jayminwest/warren/blob/b13c7597c529360ad150bccc629bf28f603bc692/src/plan-runs/coordinator.ts#L167-L236), [in-flight.ts, lines 302-423](https://github.com/jayminwest/warren/blob/b13c7597c529360ad150bccc629bf28f603bc692/src/plan-runs/in-flight.ts#L302-L423)).

## 3. State-owner table

| State or fact | Authoritative owner at this pin | Durable representation | Recovery consequence |
|---|---|---|---|
| Project identity, origin, default branch, local clone, latest observed HEAD | Warren database plus Git | `projects` row and host clone | Warren can refresh a registered clone, but `lastHeadSha` is a latest project observation, not a per-run planned Base SHA ([schema, lines 75-94](https://github.com/jayminwest/warren/blob/b13c7597c529360ad150bccc629bf28f603bc692/src/db/schema/sqlite.ts#L75-L94)). |
| Run identity and lifecycle | Warren database | One `runs` row | A replacement process can find queued/running rows and terminal history ([schema, lines 96-217](https://github.com/jayminwest/warren/blob/b13c7597c529360ad150bccc629bf28f603bc692/src/db/schema/sqlite.ts#L96-L217)). |
| Agent invocation input | Warren database | Frozen `rendered_agent_json`, prompt, mode, trigger, target branch | The initial prompt and agent definition survive; the actual provider conversation does not live here. |
| Provider execution identity | Provider plus Warren database locator | `burrow_id` and `burrow_run_id` | Recovery can query and stream an execution only after both locators were attached. |
| Agent event/log transcript | Provider is live source; Warren is durable cache | `events` rows keyed by run and provider sequence | Restart resumes after the maximum persisted sequence ([events repo, lines 42-56](https://github.com/jayminwest/warren/blob/b13c7597c529360ad150bccc629bf28f603bc692/src/db/repos/events.ts#L42-L56), [events repo, lines 110-124](https://github.com/jayminwest/warren/blob/b13c7597c529360ad150bccc629bf28f603bc692/src/db/repos/events.ts#L110-L124)). |
| Ordered plan and child lifecycle | Warren database | `plan_runs` and `plan_run_children` | A restart can poll the next child and merged-PR state, subject to dispatch crash gaps ([schema, lines 270-361](https://github.com/jayminwest/warren/blob/b13c7597c529360ad150bccc629bf28f603bc692/src/db/schema/sqlite.ts#L270-L361)). |
| Steering messages for Kubernetes | Warren database | `run_inbox` unread/delivered rows | A pod can poll durable messages after a coordinator restart; local mid-run steering instead uses the provider's live facility ([schema, lines 373-405](https://github.com/jayminwest/warren/blob/b13c7597c529360ad150bccc629bf28f603bc692/src/db/schema/sqlite.ts#L373-L405)). |
| Branch, commits, index, and working files | Git and the provider workspace | Run branch and sandbox filesystem | Warren does not persist an inventory of all Git layers in the run row. |
| Pull-request and merge fact | GitHub | Warren stores `pr_url`; plan coordinator polls merge state | Normal run success can end at an open PR. A plan advances only after GitHub reports merge. |
| Live local process or Kubernetes pod | Burrow or Kubernetes | Provider-native runtime state; Warren stores only opaque IDs | Warren can query/adopt by stored IDs, not discover an unrecorded execution. |

The database schema and migrations preserve useful snapshots and an append-like transcript, but there is no durable boundary-effect intent or attempt-occurrence journal tying the database, provider, Git, and GitHub calls into one recoverable sequence.

## 4. Scheduling and capacity

Warren has several distinct scheduling scopes:

- A manual or trigger request can launch a run independently.
- The plan-run tick lists active plans and advances them one by one; its in-memory single-flight wrapper drops an overlapping tick ([tick.ts, lines 90-109](https://github.com/jayminwest/warren/blob/b13c7597c529360ad150bccc629bf28f603bc692/src/plan-runs/tick.ts#L90-L109), [tick.ts, lines 203-260](https://github.com/jayminwest/warren/blob/b13c7597c529360ad150bccc629bf28f603bc692/src/plan-runs/tick.ts#L203-L260)).
- Each plan allows only one child in `dispatched`, `running`, or `pr_open`, so its children are serial. Different plans and unrelated runs can remain live concurrently because advancing a plan waits only for the dispatch call, not the agent's completion ([coordinator.ts, lines 194-236](https://github.com/jayminwest/warren/blob/b13c7597c529360ad150bccc629bf28f603bc692/src/plan-runs/coordinator.ts#L194-L236)).

Kubernetes admission counts nonterminal run pods globally and per project. It returns `admit`, `pending`, `global_queue`, or `project_queue`, applying the project cap first ([admission.ts, lines 133-205](https://github.com/jayminwest/warren/blob/b13c7597c529360ad150bccc629bf28f603bc692/src/runtime/k8s/admission.ts#L133-L205)). The implementation itself calls these **soft caps**: it reads a watcher snapshot or lists pods, decides, and only afterward creates the new pod ([admission.ts, lines 1-26](https://github.com/jayminwest/warren/blob/b13c7597c529360ad150bccc629bf28f603bc692/src/runtime/k8s/admission.ts#L1-L26), [admit.ts, lines 38-80](https://github.com/jayminwest/warren/blob/b13c7597c529360ad150bccc629bf28f603bc692/src/runtime/k8s/admit.ts#L38-L80)). Concurrent HTTP dispatches can therefore observe the same count and overshoot. This matters even under the agreed one-coordinator assumption because the server can service overlapping requests.

LocalProvider ignores `projectId` and `maxProjectConcurrency`; Warren has no equivalent database or in-process admission gate on that backend ([contract.ts, lines 50-61](https://github.com/jayminwest/warren/blob/b13c7597c529360ad150bccc629bf28f603bc692/src/runtime/contract.ts#L50-L61)). Capacity is consequently backend-dependent, not one production-shaped scheduling invariant.

## 5. Restoration layers

### Control-plane task and run

The run row, frozen prompt/agent definition, lifecycle state, timestamps, parent/clone relation, provider IDs, events, failure reason, PR URL, and cost survive a process restart ([schema, lines 96-239](https://github.com/jayminwest/warren/blob/b13c7597c529360ad150bccc629bf28f603bc692/src/db/schema/sqlite.ts#L96-L239)). A continuation is a new run with `parentRunId` and a clone kind rather than mutation of the original run, which preserves distinct control-plane identities.

This is not exact effect restoration. Warren creates the run before calling the provider, then stores the returned sandbox and provider-run identifiers in two separate writes ([dispatch.ts, lines 161-177](https://github.com/jayminwest/warren/blob/b13c7597c529360ad150bccc629bf28f603bc692/src/runs/spawn/dispatch.ts#L161-L177), [dispatch.ts, lines 242-254](https://github.com/jayminwest/warren/blob/b13c7597c529360ad150bccc629bf28f603bc692/src/runs/spawn/dispatch.ts#L242-L254)). A hard crash after provider creation but before either attachment leaves a live execution with no durable locator. A crash after the first attachment leaves a sandbox ID but no provider-run ID. Boot recovery explicitly skips both shapes rather than reconciling them ([bridges.ts, lines 299-332](https://github.com/jayminwest/warren/blob/b13c7597c529360ad150bccc629bf28f603bc692/src/server/bridges.ts#L299-L332)).

Plan-run restoration has a similar ambiguity. Child dispatch calls `spawnRun` before updating the child with its run ID and dispatched state. A hard crash between those actions leaves the child pending even though a run exists, so the next tick can dispatch the child again ([coordinator.ts, lines 307-373](https://github.com/jayminwest/warren/blob/b13c7597c529360ad150bccc629bf28f603bc692/src/plan-runs/coordinator.ts#L307-L373)).

### Agent session, context, and log

Warren persists the initial rendered agent, prompt, metadata-derived dispatch input, parent run identity, and normalized provider events. On bridge startup it reads the maximum stored sequence and asks the provider to resume the stream after that cursor ([contract.ts, lines 100-128](https://github.com/jayminwest/warren/blob/b13c7597c529360ad150bccc629bf28f603bc692/src/runtime/contract.ts#L100-L128), [bridge.ts, lines 57-128](https://github.com/jayminwest/warren/blob/b13c7597c529360ad150bccc629bf28f603bc692/src/runs/stream/bridge.ts#L57-L128)).

No Claude Session or Codex Session identifier, context snapshot, model/tool state, provider token/rate-limit state, or resumable conversation handle distinct from the coarse provider run ID is stored in the run schema. Bridge recovery means “continue observing the same still-live provider execution,” not “relaunch the coding agent with the exact old conversational context.” A continuation run receives a fresh run identity and prompt composition; it should not be described as resuming the old agent session.

The event table has an index on run/sequence but no uniqueness constraint, and append is a plain insert ([schema, lines 219-239](https://github.com/jayminwest/warren/blob/b13c7597c529360ad150bccc629bf28f603bc692/src/db/schema/sqlite.ts#L219-L239), [events repo, lines 42-56](https://github.com/jayminwest/warren/blob/b13c7597c529360ad150bccc629bf28f603bc692/src/db/repos/events.ts#L42-L56)). The one-process bridge registry and resume cursor reduce normal duplication, but the database does not make `(run, provider sequence)` unique.

### Complete Git state

For LocalProvider, Warren refreshes the host clone to the requested ref and passes that clone as the workspace source. The local backend intentionally ignores `RunSpec.baseBranch` ([dispatch.ts, lines 208-220](https://github.com/jayminwest/warren/blob/b13c7597c529360ad150bccc629bf28f603bc692/src/runs/spawn/dispatch.ts#L208-L220), [local provider, lines 277-335](https://github.com/jayminwest/warren/blob/b13c7597c529360ad150bccc629bf28f603bc692/src/runtime/local/provider.ts#L277-L335)). Git and the surviving sandbox can therefore preserve:

- commits on the run branch;
- staged index entries;
- unstaged tracked edits;
- untracked and ignored files;
- conflicts, merge/rebase metadata, and stashes, if the sandbox filesystem itself survives.

Warren does not inventory or separately checkpoint any of those layers. The run row stores neither the run branch nor the resolved Base SHA, workspace path, index/tree fingerprint, untracked manifest, ignored-artifact policy, conflict state, stash list, submodule state, nor sparse-checkout state ([schema, lines 96-217](https://github.com/jayminwest/warren/blob/b13c7597c529360ad150bccc629bf28f603bc692/src/db/schema/sqlite.ts#L96-L217)). The deterministic branch can be recomputed from run ID only while branch-prefix configuration and target-branch semantics remain unchanged.

On successful or failed completion, provider finalization attempts artifact merging, optional bookkeeping commits, and a branch push. It reports whether the tree was dirty and which paths were dirty, classifies a successful zero-commit push as either legitimate no-change or dropped work, and preserves the workspace if branch push failed ([pipeline.ts, lines 167-256](https://github.com/jayminwest/warren/blob/b13c7597c529360ad150bccc629bf28f603bc692/src/runs/reap/pipeline.ts#L167-L256), [run.ts, lines 242-257](https://github.com/jayminwest/warren/blob/b13c7597c529360ad150bccc629bf28f603bc692/src/runs/reap/run.ts#L242-L257)). This is valuable loss avoidance, but recovery still depends on the provider retaining the workspace and the stored handle remaining valid.

Kubernetes creates a fresh `emptyDir`, clones `baseBranch`, and switches to the run branch ([workspace-init.ts, lines 1-58](https://github.com/jayminwest/warren/blob/b13c7597c529360ad150bccc629bf28f603bc692/src/runtime/k8s/workspace-init.ts#L1-L58), [workspace-init.ts, lines 260-330](https://github.com/jayminwest/warren/blob/b13c7597c529360ad150bccc629bf28f603bc692/src/runtime/k8s/workspace-init.ts#L260-L330)). Pod deletion loses every unpushed Git layer. The K8s provider declares neither workspace archives nor provider workspace GC because pod lifecycle owns the `emptyDir` ([k8s provider, lines 153-176](https://github.com/jayminwest/warren/blob/b13c7597c529360ad150bccc629bf28f603bc692/src/runtime/k8s/provider.ts#L153-L176)).

There is also a backend divergence in starting facts. Dispatch first refreshes the host clone to the requested continuation/ref, yet places `project.defaultBranch` in `RunSpec.baseBranch`. Local uses the refreshed host clone; Kubernetes clones the default branch from the origin ([dispatch.ts, lines 215-240](https://github.com/jayminwest/warren/blob/b13c7597c529360ad150bccc629bf28f603bc692/src/runs/spawn/dispatch.ts#L215-L240)). An explicit ref can therefore produce different starting commits between providers.

### Live process, container, and pod state

With both provider IDs stored, boot asks the active provider whether the execution still exists. A missing execution is finalized as lost; a transport error starts the reconnecting bridge; an existing execution gets a stream bridge ([bridges.ts, lines 334-385](https://github.com/jayminwest/warren/blob/b13c7597c529360ad150bccc629bf28f603bc692/src/server/bridges.ts#L334-L385)). That is genuine adoption of observation responsibility for a live provider run.

Kubernetes labels and queries pods by exact run ID, synthesizes event sequence numbers from logs, and returns `lost` when the pod is missing ([k8s provider, lines 323-405](https://github.com/jayminwest/warren/blob/b13c7597c529360ad150bccc629bf28f603bc692/src/runtime/k8s/provider.ts#L323-L405)). During create, however, a deterministic pod-name conflict returns an error and explicitly refuses to adopt the existing pod ([k8s provider, lines 206-284](https://github.com/jayminwest/warren/blob/b13c7597c529360ad150bccc629bf28f603bc692/src/runtime/k8s/provider.ts#L206-L284)). Warren has no persisted PID, process group, container ID, pod UID, host boot ID, or discovery query capable of safely adopting an execution whose IDs were never attached.

## 6. Immediate restart

After an ordinary coordinator restart:

1. Warren opens its durable database, resolves exactly one provider from `WARREN_RUNTIME`, and constructs the provider-dependent services ([registry.ts, lines 137-212](https://github.com/jayminwest/warren/blob/b13c7597c529360ad150bccc629bf28f603bc692/src/runtime/registry.ts#L137-L212)).
2. Bridge boot lists all `queued` and `running` rows ([bridges.ts, lines 305-318](https://github.com/jayminwest/warren/blob/b13c7597c529360ad150bccc629bf28f603bc692/src/server/bridges.ts#L305-L318)).
3. Rows without both provider locators are reported and skipped.
4. For complete handles, Warren calls `status`. Missing work is terminalized as lost; transport ambiguity is handed to the reconnect loop; existing work is streamed from the last durable event sequence ([bridges.ts, lines 334-385](https://github.com/jayminwest/warren/blob/b13c7597c529360ad150bccc629bf28f603bc692/src/server/bridges.ts#L334-L385)).
5. Periodic plan-run ticks reload durable parent/child state. In-flight child runs and PRs are observed; pending children can be dispatched.
6. The watchdog scans running rows. A provider run that is terminal or gone but whose row remained running is reaped after a grace interval; a silent live run is cancelled and reaped after the 45-minute default heartbeat budget ([watchdog.ts, lines 79-112](https://github.com/jayminwest/warren/blob/b13c7597c529360ad150bccc629bf28f603bc692/src/runs/watchdog.ts#L79-L112), [watchdog.ts, lines 217-263](https://github.com/jayminwest/warren/blob/b13c7597c529360ad150bccc629bf28f603bc692/src/runs/watchdog.ts#L217-L263)).

This restart path is materially stronger than stage rerun: it normally reattaches to the exact provider run. It remains incomplete at the dispatch-before-handle, first-handle-before-second-handle, plan-child-dispatch-before-child-update, and reap-substep boundaries.

## 7. Restart after a week and external drift

After a week, the same durable rows and events are available if SQLite/PostgreSQL and the project clone volume survived. Recovery quality then depends on facts Warren does not own:

- Local Burrow may or may not retain the referenced run and workspace. Warren can ask by ID but cannot reconstruct a deleted workspace.
- A Kubernetes pod may have completed, been evicted, or been garbage-collected. Missing becomes `run_lost`; its `emptyDir` and all unpushed layers are gone.
- Provider configuration may have changed. Boot resolves the currently configured backend, while run rows do not persist provider kind. A run created under LocalProvider and restarted under K8s presents opaque Burrow IDs to the wrong provider contract.
- The origin's default branch and accepted head may have advanced or been force-pushed. Warren stores the project clone's latest observed SHA, not the run's planned Base SHA, so it cannot prove the exact starting commit from its run record.
- The run branch or PR may have been deleted, force-pushed, closed, or merged. Reap can attempt push/open; plan-run observes current PR merge state, but there is no durable accepted-head/integration-attempt record.
- Agent image, runtime, credentials, model, tools, network policy, and seed sources can drift. The rendered agent and initial prompt are frozen, but the actual execution environment and conversation state are not.

The bridge and plan-run polling paths reconcile external current state rather than blindly assuming the old database snapshot. That is useful. They do not, however, distinguish “the same exact attempt is safely resumable” from “some locator still resolves under changed surrounding facts.”

## 8. Git starting-point and integration behavior

Before dispatch, Warren refreshes the registered clone by fetching/pruning, force-checking out the requested ref, and hard-resetting to `origin/<ref>` or the local ref; it records the resulting project HEAD ([refresh.ts, lines 126-214](https://github.com/jayminwest/warren/blob/b13c7597c529360ad150bccc629bf28f603bc692/src/projects/refresh.ts#L126-L214)). This gives LocalProvider a recent concrete source tree but mutates one shared host clone and does not persist that SHA on the run.

Each ordinary run gets a deterministic branch derived from its run ID, unless a CI-fixer target branch overrides it ([dispatch.ts, lines 179-189](https://github.com/jayminwest/warren/blob/b13c7597c529360ad150bccc629bf28f603bc692/src/runs/spawn/dispatch.ts#L179-L189)). Finalization pushes the branch. If auto-open is enabled, the run succeeded, the push succeeded, commits are ahead, and the branch is not the default, Warren opens a pull request and stores its URL ([pipeline.ts, lines 299-330](https://github.com/jayminwest/warren/blob/b13c7597c529360ad150bccc629bf28f603bc692/src/runs/reap/pipeline.ts#L299-L330)).

For an ordinary run, a pushed branch or open PR is the integration handoff; Warren does not merge it as part of run success. For a plan-run, GitHub merge is a gate: only after the current child's PR is observed merged does the coordinator advance to the next child ([in-flight.ts, lines 302-423](https://github.com/jayminwest/warren/blob/b13c7597c529360ad150bccc629bf28f603bc692/src/plan-runs/in-flight.ts#L302-L423)). Thus serial plan behavior is “run, push, PR, human/external merge, next run,” not serialized integration performed by one Warren-owned merger.

No exact planned Base SHA, target-head observation, merge attempt identity, tested result SHA, accepted head, or reconcile-before-retry record is present. The Local/K8s starting-ref mismatch also means the provider seam is not yet a single exact Git-start contract.

## 9. Code organization by layers and end-to-end slices

The source is organized around domain slices—runs, projects, plan-runs, triggers, previews—and horizontal boundaries—core wire types, database repositories, runtime providers, server routes, and UI. The repository's layer guard encodes import constraints and the package scripts run it alongside typecheck, lint, tests, and schema checks ([package.json, lines 6-48](https://github.com/jayminwest/warren/blob/b13c7597c529360ad150bccc629bf28f603bc692/package.json#L6-L48), [layer-rules.json, lines 1-85](https://github.com/jayminwest/warren/blob/b13c7597c529360ad150bccc629bf28f603bc692/scripts/layer-rules.json#L1-L85)).

The run slice is readable end to end:

1. spawn validates and freezes input;
2. a provider creates the execution;
3. bridge persists normalized events;
4. terminal detection invokes reap;
5. provider finalization pushes Git work;
6. domain follow-ups open PRs and advance plans;
7. provider teardown disposes or preserves the workspace.

The provider contract and capability record prevent much backend leakage and make unsupported features explicit ([contract.ts, lines 194-219](https://github.com/jayminwest/warren/blob/b13c7597c529360ad150bccc629bf28f603bc692/src/runtime/contract.ts#L194-L219)). The cost is several parallel lifecycle mechanisms—bridge terminal detection, boot reconciliation, reconnect handling, watchdog timeout, terminal watchdog reconciliation, pod watcher, reap, and pod/workspace GC. Comments frequently document historical ticket IDs and old Burrow vocabulary, so maintainers must separate current invariants from migration narrative.

## 10. Production, test, fake, and dry-run dependency seams

Production selects LocalProvider or K8sProvider once at boot and injects the chosen implementation through a structural `RuntimeProvider` interface ([registry.ts, lines 137-212](https://github.com/jayminwest/warren/blob/b13c7597c529360ad150bccc629bf28f603bc692/src/runtime/registry.ts#L137-L212)). Repository, filesystem, Git command, clock, sleep, GitHub PR check/open, Kubernetes API, provider, and event-emission functions are commonly passed as dependencies. The watchdog, plan coordinator, spawn path, and reap pipeline can therefore be tested without real boundaries.

Tests use in-memory or recording repository fakes, provider stubs, fake Kubernetes clients/watchers, fake clocks, and stub agent processes. The acceptance harness runs Warren with Burrow and a deterministic stub agent, exercising a production-shaped HTTP/provider path rather than only calling reducers ([burrow-with-stub.ts, lines 1-120](https://github.com/jayminwest/warren/blob/b13c7597c529360ad150bccc629bf28f603bc692/scripts/acceptance/lib/burrow-with-stub.ts#L1-L120)).

No shared “interpret this complete workflow as dry-run, fake, or production” algebra was found. Deployment and registration scripts have their own unrelated `--dry-run` flags, and Kubernetes manifests support external `kubectl` validation, but run execution itself has no provider-neutral dry-run implementation. Preview mode is a product feature, not a no-effects execution interpreter.

## 11. Verification inventory

The manifest exposes broad Bun unit/integration tests, acceptance tests, coverage, lint, format, layer checking, TypeScript checking, migration/schema drift checking for SQLite and PostgreSQL, and deployment/config validation ([package.json, lines 6-55](https://github.com/jayminwest/warren/blob/b13c7597c529360ad150bccc629bf28f603bc692/package.json#L6-L55)).

Strong targeted examples include:

- pure Kubernetes admission tally/gate tests and provider tests;
- boot bridge restart and ghost-run reconciliation tests;
- stream cursor/reconnect/terminal-detection tests;
- watchdog timeout and terminal-state reconciliation tests;
- plan-run serial dispatch, merge wait, timeout, skip, and failure tests;
- finalization, dirty/no-change, push-failure preservation, PR-open, and cleanup tests;
- SQLite/PostgreSQL migration and schema-drift tests;
- acceptance scenarios using the stub agent and actual server/provider boundary.

The plan and run lifecycles are represented as typed string-state sets plus transition functions, but no property-based generator, formal specification, model checker, linearizability test, or systematic kill-after-every-boundary suite was found. The checked-in `SPEC.md` is descriptive, not an executable state model. Example tests cover many known failure shapes but do not establish cross-boundary exactly-once or complete-restoration properties.

## 12. Chronological failure table

| Failure moment | Durable observation after restart | Reachable behavior | Reliability gap |
|---|---|---|---|
| Before run-row insert | No run | Request may be retried as a new run | No ambiguity yet. |
| After row insert, before provider create | Queued row, no provider IDs | Boot skips it | No durable dispatch intent/result distinction or automatic safe retry. |
| During LocalProvider partial create | Provider catches dispatch failure and best-effort destroys the sandbox ([local provider, lines 113-148](https://github.com/jayminwest/warren/blob/b13c7597c529360ad150bccc629bf28f603bc692/src/runtime/local/provider.ts#L113-L148)) | Ordinary thrown failure rolls back the Warren row | Hard process death bypasses catch/rollback. |
| After provider create, before first ID write | Live execution; queued row with no IDs | Boot skips row | Execution is undiscoverable from Warren. |
| Between sandbox-ID and run-ID writes | Partial handle | Boot skips row | Workspace may survive, but stream/adoption cannot start. |
| After both IDs, before first event | Complete handle | Boot probes and starts bridge | Good exact provider-run reattachment if provider retains it. |
| After event arrives, before event insert | Provider is ahead of DB | Bridge resumes from DB max and requests later events | Depends on provider replay/log cursor fidelity. |
| After event insert, before state transition | Transcript may show activity or terminal while row is stale | Replayed terminal detection or watchdog reconciliation reaps it | Event insert and lifecycle transition are not atomic. |
| During a silent tool call | Running row with old heartbeat | Watchdog cancels and reaps after budget | It may preserve committed work, but cannot save arbitrary in-memory tool/process state. |
| During provider finalize/push | Reap substeps and events partly persisted | Push failure preserves workspace; repeated reap is guarded only after terminal transition | No durable per-effect intent/observation ledger for every finalize step. |
| After push, before `pr_url` write | Remote branch exists; DB may not record PR | Later reap/retry can revisit PR opening | Idempotence depends on GitHub lookup/open implementation, not one integration occurrence record. |
| After successful finalize, before workspace destroy | Run may be terminal; workspace remains | Periodic provider workspace GC can reclaim local stranded workspaces when capability allows ([contract.ts, lines 211-219](https://github.com/jayminwest/warren/blob/b13c7597c529360ad150bccc629bf28f603bc692/src/runtime/contract.ts#L211-L219)) | Cleanup is backend-specific and not disposition-typed per attempt. |
| After plan child spawn, before child update | New run exists; child still pending | Next plan tick can spawn duplicate child work | No intent/reservation or reverse reconciliation by plan/seed. |
| While waiting for PR merge | Child and PR URL are durable | Tick rechecks GitHub; merged advances, open waits, closed/timeout fails | Correctly observes external state, but does not own integration. |
| Pod deleted before push | Run handle remains, pod/workspace gone | Boot/watchdog marks run lost | All unpushed staged, unstaged, untracked, ignored, conflict, and stash state is lost. |

## 13. Maintenance risks

- **Dispatch ambiguity:** the provider call is bracketed by three independent database writes without durable intent, observation, or reconciliation keys.
- **Plan-child duplication:** child dispatch is external work before the child row records the run.
- **Backend-semantic drift:** Local ignores `baseBranch`; Kubernetes consumes it, and dispatch supplies the default rather than the resolved requested ref.
- **Provider-kind drift:** the run stores opaque IDs but not the provider implementation that minted them.
- **Soft capacity:** K8s observation and pod creation are separate, while Local has no Warren admission cap.
- **Transcript uniqueness:** event sequence is indexed but not unique in the database.
- **Recovery distributed across mechanisms:** bridge boot, reconnect, watchdog, pod observation, reap, and GC can interact around the same stale run.
- **Best-effort reap:** deliberately continuing after substep failures helps preserve progress, but a compact success/failed row cannot fully explain which external effects settled.
- **Configuration-derived identity:** branch derivation and environment details are not frozen together with an exact worktree/Base record.
- **Inherited comments and dormant modules:** Burrow-extracted but unreachable files and historical Overstory/Canopy terminology can be mistaken for live behavior.
- **Ephemeral Kubernetes workspaces:** an `emptyDir` gives clean pod isolation but makes pod loss equivalent to loss of every unpushed Git layer.

## 14. Ideas Dalph should consider

- Adopt a small provider-neutral runtime contract with explicit capabilities, status, resumable event cursor, finalize, cancel, and terminate operations.
- Resolve the production provider once at boot and inject that same instance into dispatch, watchdog, recovery, finalization, and cleanup.
- Freeze the rendered agent definition and initial prompt on the attempt rather than rereading mutable agent configuration during recovery.
- Persist normalized lossless provider events and resume from a monotonic cursor.
- On restart, check the provider before declaring a stored active run dead; distinguish a missing execution from a temporarily unreachable backend.
- Keep watchdog timeout and terminal-but-stale reconciliation separate: “agent is silent too long” and “executor is already dead but the database missed it” are different phenomena.
- Preserve a workspace when push fails, and explicitly classify a zero-commit result as clean no-change versus dirty dropped work.
- Model provider capability differences rather than allowing domain code to assume every backend supports preview ports, fine network policy, long-lived input, archives, or GC.
- Make ordered plans wait on the authoritative external merge fact before starting the next dependent child.
- Use deterministic provider resource names derived from an already-durable attempt ID.
- Keep schema-drift checks for every supported database backend and production-shaped acceptance tests with a deterministic agent.

Dalph should strengthen these mechanisms with an exact planned Base SHA and worktree, a durable provider kind and execution locator, intent before every ambiguity-crossing effect, observation afterward, reconciliation before retry, unique event occurrence keys, and typed cleanup/integration dispositions.

## 15. Confirmed unknowns and negative-claim search record

Searches covered package manifests, schema and migrations, runtime providers, run spawn/stream/reap/watchdog paths, plan-run coordinator/tick/repositories, project refresh, workspace/Git modules, tests, acceptance harnesses, deployment manifests, and documentation for session, context, resume, worktree, base SHA, process/container identity, admission, dry-run/fake, property testing, formal models, Quint/TLA, and Overstory.

Not found at this pin:

- a per-run planned Base SHA or exact complete Git-start snapshot;
- durable inventories for staged, unstaged, untracked, ignored, conflicted, or stashed state;
- a Claude Session or Codex Session ID/context snapshot distinct from the provider run;
- persisted provider kind, PID/process group, container ID, pod UID, host/boot identity, or discovery/adoption token;
- a dispatch intent/result journal for provider creation;
- a reservation or reconciliation link preventing plan-child duplicate dispatch after a crash;
- a database uniqueness constraint on provider event sequence per run;
- one backend-independent capacity ledger;
- a run-execution dry-run interpreter sharing the production workflow;
- property-based, formal, model-checking, or systematic crash-boundary verification;
- Warren-owned merge serialization and accepted-head recording for ordinary runs.

Still unknown without Burrow source or execution experiments:

- how LocalProvider's sandbox actually enforces filesystem, process, network, and resource isolation;
- whether Burrow durably replays every event after host/process failure and how long it retains run/session data;
- which full Git layers survive each LocalProvider termination, archive, and GC path;
- whether LocalProvider can leave child processes outside the sandbox lifetime;
- practical recovery after SQLite/PostgreSQL, host-volume, Kubernetes API, node, and network failures;
- whether remote branch/PR creation is idempotent across each hard-kill boundary;
- whether operators deploy a stable provider choice and external cleanup/integration conventions not represented in source.

## 16. Technical and user-visible consequences

Warren can recover more than a task label. When its database and both provider identifiers survive, a replacement coordinator can find the same run, check whether the same sandbox or pod still exists, resume its event stream from a durable cursor, observe terminal state, push work, and continue a serial plan after an externally merged pull request. Users can see an enduring run transcript and often keep work that would otherwise be lost on a push failure.

That recovery is conditional, not complete session restoration. Warren does not persist the coding agent's provider-specific conversation identity and context separately from the coarse live run. It does not record the exact Base SHA or all worktree layers. It cannot adopt an execution created just before its IDs were stored. A Kubernetes pod loss destroys unpushed work. A plan coordinator crash in the child-dispatch gap can launch the same child twice.

For Dalph, the useful decomposition is:

1. tracker task and dependency facts;
2. planned attempt with exact Base SHA, exact worktree, provider kind, and capacity claim;
3. each Agent Session—Codex Session or Claude Session—with its context and event/log stream;
4. complete Git state, including committed and every uncommitted layer;
5. live executor observation and adoption/termination decision;
6. push, pull-request, integration attempt, and accepted result.

Warren demonstrates that provider-handle reattachment, lossless event caching, capability-aware runtime seams, and push-failure preservation are practical and maintainable. Its crash gaps demonstrate why Dalph still needs occurrence identity and intent/observation records around dispatch, child scheduling, Git finalization, cleanup, and integration rather than treating a durable run row as the whole session.
