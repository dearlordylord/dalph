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

- [Terminate one globally settled Run](issue-102-terminate-settled-run.md)
- [Define control-plane latency and responsiveness budgets](issue-104-control-plane-latency-and-responsiveness.md)
- [Keep one position for one admitted planned task attempt](issue-131-conflicting-capacity-observation.md)
- [Pause or unpause a whole Run](issue-134-pause-whole-run.md)
- [Pause one task and its grouping descendants](issue-135-pause-task-grouping-descendants.md)
- [Reconcile changed task instructions, lifecycle, and membership](issue-136-reconcile-changed-task-facts.md)
- [Reconcile missing, foreign, and unreadable task claims](issue-137-reconcile-task-claims.md)
- [Reconcile blockers before and after Git promotion](issue-138-reconcile-blockers-around-promotion.md)
- [Reconcile Git lineage, worktrees, and promotion races](issue-139-reconcile-git-facts.md)
- [Reject stale task Pause and Unpause requests](issue-156-reject-stale-task-control.md)
- [Journal-first tracker observations](issue-164-journal-first-tracker-observations.md)
- [Describe delivery actions without performing them](issue-192-describe-delivery-actions.md)
- [Run delivery actions from accepted reactive facts](issue-193-run-reactive-delivery-actions.md)
- [Stabilize each Run above delivery](issue-194-stabilize-each-run.md)
- [Reactivate incomplete Runs from non-authoritative hints](issue-218-reactivate-incomplete-runs.md)
- [Admit independent work while preserving an exact retained attempt](issue-269-independent-work-retained-priority.md)
- [Preserve bounded admission until executor-work handoff](issue-315-preserve-bounded-fresh-admission.md)
- [Refresh and traverse complete task pipelines](issue-53-refresh-complete-task-pipelines.md)
- [Resize task admission without stopping current work](issue-54-resize-task-admission.md)
- [Localize one task's conflict while an independent task continues](issue-55-localize-task-conflicts.md)
- [Observe a requested Pause reach its safe boundaries](issue-63-observe-pause-progress.md)
- [Cancel or continue an exact pre-integration attempt](issue-65-cancel-or-continue-attempt.md)
- [Replace an exact changed attempt from clean resources](issue-66-clean-restart-changed-attempt.md)
- [Establish a Run idempotently, then activate it once](run-establishment-and-activation.md)

## Executor work and recovery

- [Replace one purged Codex work unit in the retained planned attempt](issue-111-replace-purged-codex-work-unit.md)
- [First concrete executor: persistent Codex app-server threads](issue-219-codex-app-server-executor.md)
- [Autonomous planned-attempt executor work](issue-264-autonomous-executor-work.md)
- [Observe one autonomous executor attempt through a same-host restart](issue-265-passive-executor-observation-through-restart.md)
- [Refresh tracker facts during autonomous work and suspend proven changes](issue-266-active-work-authority-refresh.md)
- [Restart finishes the original Begin on an exact empty thread](issue-341-pre-turn-begin-recovery.md)
- [Restart finishes the original Begin after its empty Codex thread disappears](issue-342-absent-empty-begin-recovery.md)
- [Planned-attempt executor boundary scenarios](planned-attempt-executor-boundary.md)

## Integration, promotion, finality, and cleanup

- [Ask one Integrator session to prepare the exact candidate](issue-222-introduce-outer-integrator.md)
- [Promote and settle the candidate reported by the outer Integrator](issue-223-migrate-promotion-and-finality.md)
- [Remove the legacy split integration pipeline](issue-225-remove-legacy-split-integration.md)
- [Production Codex Integrator recovery and cleanup](issue-258-production-codex-integrator.md)
- [Queue accepted results and cross the integration cutoff](issue-56-queue-accepted-integration.md)
- [Recover or quarantine one integration session](issue-68-recover-or-quarantine-integration-session.md)
- [Exact durable-resource cleanup dispositions](issue-69-disposition-cleanup.md)
- [Retire terminal workflow-journal history without changing its meaning](issue-70-terminal-history-retirement.md)

## Application Exit

- [Gracefully exit the Dalph application](issue-169-graceful-application-exit.md)
- [Application Exit model, decision-kernel, and test mapping](issue-203-application-exit-model-mapping.md)
- [Application Exit runtime mapping](issue-204-application-exit-runtime-mapping.md)
- [Suspend running executor work during application Exit](issue-205-running-executor-application-exit.md)
- [Interrupt tracker and Git waits during application Exit](issue-206-interruptible-tracker-git-exit.md)
- [Preserve exact cleanup dispositions during application Exit](issue-208-cleanup-dispositions-during-application-exit.md)
- [Compose application Exit drain failure and timeout](issue-209-force-application-termination.md)
- [Accept Linux supervisor Exit signals at the application host](issue-210-linux-supervisor-exit.md)
- [Reclassify graceful Exit around the outer Integrator](issue-224-outer-integrator-application-exit.md)

## Cassettes, presentation, and composed delivery

- [Authored-cassette abstraction levels](authored-cassette-abstraction-levels.md)
- [Qualify the recovery-prefix harness against both journal stores](issue-142-qualify-recovery-prefix-harness.md)
- [Domain-readable authored and recorded cassettes](issue-165-domain-readable-cassettes.md)
- [Complete controlled-provider delivery through maintained cassettes](issue-167-controlled-provider-capstone.md)
- [Run and record the maintained cassette catalog](issue-170-maintained-cassette-catalog.md)
- [Prove exact causal active-work refresh in the maintained cassette](issue-267-exact-causal-active-work-cassette.md)
- [Run the first thirteen delivery-story beats under controlled readiness](issue-268-controlled-delivery-story.md)
- [Alice reopens C and resumes its retained attempt](issue-274-reopen-retained-c.md)
- [Alice adds F and G while B, C, and D hold capacity](issue-275-discover-f-g-at-capacity.md)
- [B, C, and D release positions while their integration waits](issue-276-release-exact-task-positions.md)
- [Alice sees six distinct ordinary deliveries](issue-277-distinct-ordinary-finality.md)
- [Alice sees one normally completed seven-task Run](issue-278-normal-termination.md)
- [Alice sees an admitted action beside the latest accepted facts](issue-300-current-status-admission-witness.md)
- [Alice replays one complete seven-task Run](issue-337-delivery-capstone.md)
- [Alice closes C and the active refresh returns after G2](issue-348-post-g2-quiescence.md)
- [Alice's reopened C receives the next ordinary activation](issue-349-accepted-publication-observer.md)
- [Control, disposition, and cleanup at an exact cursor](issue-83-control-disposition.md)
- [Truthful actor and capability presentation](issue-84-truthful-actor-capability-presentation.md)
- [Navigate a large observed Run without losing identity](issue-85-large-run-navigation.md)
- [Run one task through a hermetic no-crash Dalph lifecycle](issue-86-hermetic-no-crash-lifecycle.md)
- [Two ready tasks overlap while one target integrates in journal order](issue-87-hermetic-concurrency-and-serialized-integration.md)
- [Restart after Git promotes the target without returning](issue-88-crash-after-target-promotion.md)
- [Release a dependant from fresh tracker success and audit exact owned resources](issue-89-tracker-release-and-resource-census.md)
- [Converge the bounded MVP and presentation parent acceptance](issue-90-final-parent-acceptance.md)
- [Reducer Lab: run every maintained cassette through production](reducer-lab-maintained-cassette-catalog.md)
- [Workflow-occurrence projection scenarios](workflow-occurrence-projection.md)

## Production boundaries and qualification

- [Expose GitHub tracker targets through the dry-run CLI](issue-103-github-dry-run-cli.md)
- [Reject unsafe production-host path relationships](issue-292-production-host-configuration.md)
- [Alice's ordinary task gets a filesystem-sized worktree component](issue-339-bounded-attempt-resource-components.md)
- [Alice starts only the authorized fixture and can locate failed setup resources](issue-339-fixture-authorization-and-setup-failure.md)
- [Alice kills P1 while its last stdout record is incomplete](issue-339-killed-child-stdout-framing.md)
- [Alice still sees the admitted cleanup while nested release adds recovery work](issue-339-live-cleanup-frontier-listing-position.md)
- [Alice receives a failed command without corrupting structured stdout](issue-339-public-runner-failure-channels.md)
- [Alice's integration reads the exact configured Git target](issue-339-target-repository-git-boundary.md)
- [Alice restarts after GitHub rejects completion with a throttle](issue-339-throttled-completion-restart.md)
- [Alice receives an exact, safe qualification artifact](issue-340-qualified-artifact-publication.md)
- [Qualify real GitHub graph, membership, and claim behavior](issue-71-qualify-real-github-graph-membership-claims.md)
- [Qualify GitHub evidence and completion behavior](issue-72-qualify-github-completion.md)
- [Qualify real Git lineage, candidate shape, and ref mutation](issue-73-qualify-real-git-lineage-candidate-ref.md)
- [Qualify real Git worktree ownership and preservation](issue-74-qualify-real-worktree-lease.md)
- [Qualify the Codex app-server executor on real hosts](issue-75-codex-app-server-qualification.md)
- [Qualify production cleanup adapters](issue-77-production-cleanup-qualification.md)
- [Capability registration gate](issue-79-capability-registration.md)

## Repository formal tooling

- [Local formal qualification after the execution timeout](formal-reuse-local-qualification-budget.md)
- [Fresh formal verification keeps generated server output outside candidate inputs](formal-reuse-owned-server-output.md)
- [Hosted formal verification finishes without changing its evidence](formal-hosted-throughput.md)
- [Local full qualification runs formal verification only for a relevant candidate](local-formal-relevance.md)

## Retained contracts with corrected integration premises

These files still contain specific tracker-completion, storage, and settlement
clauses used by their consumers. Their older integration-evidence premises do
not authorize implementation: read them together with
[promotion and finality after the Integrator report](issue-223-migrate-promotion-and-finality.md),
which replaces those premises while preserving the named obligations. The
banners in the retained files describe their individual limits.

- [Settle one promoted task without completing the Run](issue-141-integration-finality.md)
- [Complete one promoted task before a later graph read releases dependants](issue-61-complete-task-and-release-dependants.md)
- [Qualify production evidence storage and sealed evidence history](issue-76-production-evidence-store.md)
