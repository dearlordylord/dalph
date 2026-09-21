# Scenarios

Use this catalog to find the chronology for a concrete action or boundary.
Each linked file carries its own scope, governing behavior, forbidden results,
and acceptance-test mapping. This is behavior navigation, not a copy of GitHub
issue status or a claim that every described outcome is implemented. Consult
the owning scenario and its tests for the exact contract and evidence.

[Operational scenarios](../OPERATIONAL-SCENARIOS.md) defines the required fields
and delivery gate. Prose describes the chronology, cassettes record its
occurrences, and [delivery invariants](../DELIVERY-INVARIANTS.md) state what
must never happen. The [delivery story](../DELIVERY-STORY.md) composes these
across issues. Superseded proposals and completed execution plans belong in
Git history.

## Run entry, task facts, admission, and controls

- [Terminate one globally settled Run](terminate-settled-run.md)
- [Define control-plane latency and responsiveness budgets](control-plane-latency-and-responsiveness.md)
- [Keep one position for one admitted planned task attempt](conflicting-capacity-observation.md)
- [Pause or unpause a whole Run](pause-whole-run.md)
- [Pause one task and its grouping descendants](pause-task-grouping-descendants.md)
- [Reconcile changed task instructions, lifecycle, and membership](reconcile-changed-task-facts.md)
- [Reconcile missing, foreign, and unreadable task claims](reconcile-task-claims.md)
- [Reconcile blockers before and after Git promotion](reconcile-blockers-around-promotion.md)
- [Reconcile Git lineage, worktrees, and promotion races](reconcile-git-facts.md)
- [Reject stale task Pause and Unpause requests](reject-stale-task-control.md)
- [Journal-first tracker observations](journal-first-tracker-observations.md)
- [Describe delivery actions without performing them](describe-delivery-actions.md)
- [Run delivery actions from accepted reactive facts](run-reactive-delivery-actions.md)
- [Stabilize each Run above delivery](stabilize-each-run.md)
- [Reactivate incomplete Runs from non-authoritative hints](reactivate-incomplete-runs.md)
- [Admit independent work while preserving an exact retained attempt](independent-work-retained-priority.md)
- [Preserve bounded admission until executor-work handoff](preserve-bounded-fresh-admission.md)
- [Refresh and traverse complete task pipelines](refresh-complete-task-pipelines.md)
- [Resize task admission without stopping current work](resize-task-admission.md)
- [Localize one task's conflict while an independent task continues](localize-task-conflicts.md)
- [Observe a requested Pause reach its safe boundaries](observe-pause-progress.md)
- [Cancel or continue an exact pre-integration attempt](cancel-or-continue-attempt.md)
- [Cancel one production Run with an unusable executor](cancel-unusable-production-run.md)
- [Replace an exact changed attempt from clean resources](clean-restart-changed-attempt.md)
- [Establish a Run idempotently, then activate it once](run-establishment-and-activation.md)

## Executor work and recovery

- [Ask Codex to review a candidate before accepting it](codex-bounded-review-instruction.md)
- [Replace one purged Codex work unit in the retained planned attempt](replace-purged-codex-work-unit.md)
- [First concrete executor: persistent Codex app-server threads](codex-app-server-executor.md)
- [Select Kimi ACP for one planned attempt](kimi-acp-planned-attempt-executor.md)
- [Autonomous planned-attempt executor work](autonomous-executor-work.md)
- [Observe one autonomous executor attempt through a same-host restart](passive-executor-observation-through-restart.md)
- [Refresh tracker facts during autonomous work and suspend proven changes](active-work-authority-refresh.md)
- [Restart finishes the original Begin on an exact empty thread](pre-turn-begin-recovery.md)
- [Restart finishes the original Begin after its empty Codex thread disappears](absent-empty-begin-recovery.md)
- [Planned-attempt executor boundary scenarios](planned-attempt-executor-boundary.md)

## Integration, promotion, finality, and cleanup

- [Publish the integrated commit before completing the task — specification for acceptance](direct-remote-publication.md)
- [Ask one Integrator session to prepare the exact candidate](introduce-outer-integrator.md)
- [Promote and settle the candidate reported by the outer Integrator](migrate-promotion-and-finality.md)
- [Remove the legacy split integration pipeline](remove-legacy-split-integration.md)
- [Production Codex Integrator recovery and cleanup](production-codex-integrator.md)
- [Queue accepted results and cross the integration cutoff](queue-accepted-integration.md)
- [Recover or quarantine one integration session](recover-or-quarantine-integration-session.md)
- [Exact durable-resource cleanup dispositions](disposition-cleanup.md)
- [Retire terminal workflow-journal history without changing its meaning](terminal-history-retirement.md)

## Application Exit

- [Gracefully exit the Dalph application](graceful-application-exit.md)
- [Application Exit model, decision-kernel, and test mapping](application-exit-model-mapping.md)
- [Application Exit runtime mapping](application-exit-runtime-mapping.md)
- [Suspend running executor work during application Exit](running-executor-application-exit.md)
- [Interrupt tracker and Git waits during application Exit](interruptible-tracker-git-exit.md)
- [Preserve exact cleanup dispositions during application Exit](cleanup-dispositions-during-application-exit.md)
- [Compose application Exit drain failure and timeout](force-application-termination.md)
- [Accept Linux supervisor Exit signals at the application host](linux-supervisor-exit.md)
- [Reclassify graceful Exit around the outer Integrator](outer-integrator-application-exit.md)
- [Bound production passive publication and preserve graceful Exit](untangle.md)

## Cassettes, presentation, and composed delivery

- [Preserve the selected cassette and playback moment in the URL](reducer-lab-url-selection.md)
- [Authored-cassette abstraction levels](authored-cassette-abstraction-levels.md)
- [Qualify the recovery-prefix harness against both journal stores](qualify-recovery-prefix-harness.md)
- [Domain-readable authored and recorded cassettes](domain-readable-cassettes.md)
- [Complete controlled-provider delivery through maintained cassettes](controlled-provider-capstone.md)
- [Run and record the maintained cassette catalog](maintained-cassette-catalog.md)
- [Prove exact causal active-work refresh in the maintained cassette](exact-causal-active-work-cassette.md)
- [Run the first thirteen delivery-story beats under controlled readiness](controlled-delivery-story.md)
- [Alice reopens C and resumes its retained attempt](reopen-retained-c.md)
- [Alice adds F and G while B, C, and D hold capacity](discover-f-g-at-capacity.md)
- [B, C, and D release positions while their integration waits](release-exact-task-positions.md)
- [Alice sees six distinct ordinary deliveries](distinct-ordinary-finality.md)
- [Alice sees one normally completed seven-task Run](normal-termination.md)
- [Alice sees an admitted action beside the latest accepted facts](current-status-admission-witness.md)
- [Alice replays one complete seven-task Run](delivery-capstone.md)
- [Alice closes C and the active refresh returns after G2](post-g2-quiescence.md)
- [Alice's reopened C receives the next ordinary activation](accepted-publication-observer.md)
- [Control, disposition, and cleanup at an exact cursor](control-disposition.md)
- [Truthful actor and capability presentation](truthful-actor-capability-presentation.md)
- [Navigate a large observed Run without losing identity](large-run-navigation.md)
- [Run one task through a hermetic no-crash Dalph lifecycle](hermetic-no-crash-lifecycle.md)
- [Two ready tasks overlap while one target integrates in journal order](hermetic-concurrency-and-serialized-integration.md)
- [Restart after Git promotes the target without returning](crash-after-target-promotion.md)
- [Release a dependant from fresh tracker success and audit exact owned resources](tracker-release-and-resource-census.md)
- [Converge the bounded MVP and presentation parent acceptance](final-parent-acceptance.md)
- [Reducer Lab: run every maintained cassette through production](reducer-lab-maintained-cassette-catalog.md)
- [Workflow-occurrence projection scenarios](workflow-occurrence-projection.md)

## Production boundaries and qualification

- [Expose GitHub tracker targets through the dry-run CLI](github-dry-run-cli.md)
- [Reject unsafe production-host path relationships](production-host-configuration.md)
- [Alice's ordinary task gets a filesystem-sized worktree component](bounded-attempt-resource-components.md)
- [Alice starts only the authorized fixture and can locate failed setup resources](fixture-authorization-and-setup-failure.md)
- [Alice kills P1 while its last stdout record is incomplete](killed-child-stdout-framing.md)
- [Alice still sees the admitted cleanup while nested release adds recovery work](live-cleanup-frontier-listing-position.md)
- [Alice receives a failed command without corrupting structured stdout](public-runner-failure-channels.md)
- [Alice's integration reads the exact configured Git target](target-repository-git-boundary.md)
- [Alice restarts after GitHub rejects completion with a throttle](throttled-completion-restart.md)
- [Alice receives an exact, safe qualification artifact](qualified-artifact-publication.md)
- [Qualify real GitHub graph, membership, and claim behavior](qualify-real-github-graph-membership-claims.md)
- [Qualify GitHub evidence and completion behavior](qualify-github-completion.md)
- [Qualify real Git lineage, candidate shape, and ref mutation](qualify-real-git-lineage-candidate-ref.md)
- [Qualify real Git worktree ownership and preservation](qualify-real-worktree-lease.md)
- [Qualify the Codex app-server executor on real hosts](codex-app-server-qualification.md)
- [Bound a Codex RPC wait without deciding the task outcome](bounded-codex-rpc.md)
- [Qualify production cleanup adapters](production-cleanup-qualification.md)
- [Capability registration gate](capability-registration.md)

## Repository formal tooling

- [Prewarm the ordinary Vitest transform cache during bootstrap](vitest-cache-prewarm.md)
- [Local formal qualification after the execution timeout](formal-reuse-local-qualification-budget.md)
- [Fresh formal verification keeps generated server output outside candidate inputs](formal-reuse-owned-server-output.md)
- [Hosted formal verification finishes without changing its evidence](formal-hosted-throughput.md)
- [Local full qualification runs formal verification only for a relevant candidate](local-formal-relevance.md)

## Retained contracts with corrected integration premises

These files still contain specific tracker-completion, storage, and settlement
clauses used by their consumers. Their older integration-evidence premises do
not authorize implementation: read them together with
[promotion and finality after the Integrator report](migrate-promotion-and-finality.md),
which replaces those premises while preserving the named obligations. The
banners in the retained files describe their individual limits.

- [Settle one promoted task without completing the Run](integration-finality.md)
- [Complete one promoted task before a later graph read releases dependants](complete-task-and-release-dependants.md)
- [Qualify production evidence storage and sealed evidence history](production-evidence-store.md)
