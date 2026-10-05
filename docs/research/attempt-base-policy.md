# Fixed versus current integration-head Base: experiment #439

Dalph currently plans an ordinary task attempt from the configured Base. This note establishes that contract before a disposable Git experiment compares it with fixing the current integration head for each new ordinary attempt. It changes no production policy, runtime, journal schema, or acknowledged attempt.

Source revision: `41e85aaf3df180da7b1cd68256166324437529ca`, inspected 2026-10-05. The accepted [experiment #439](https://github.com/dearlordylord/dalph/issues/439) authorizes comparison first; it explicitly withholds approval for a production Base-policy change. The issue's reference to manual prerequisite merges in a historical report motivates the question but is not evidence of incorrect behavior on this revision.

The research boundary is primary local source, scenarios and existing test definitions. Reading a test identifies its verification owner; it does not claim that test passed in this experiment. The source findings are independent of the experimental observations below.

## Existing contract

| Boundary | What the current implementation or accepted contract establishes | Primary owner |
| --- | --- | --- |
| Ordinary allocation | `productionPlannedTaskAttemptLayer` implements `ProductionPlannedTaskAttemptPlanner.plan`. `Fresh` requests supply only the specification; the returned `baseSha` is `configuration.plannedAttemptBaseSha`. The function does not read Git. Run, task and task-local ordinal determine distinct attempt/branch/worktree locators. | [Production configuration](../../packages/dalph/src/application/production-configuration.ts), `productionPlannedTaskAttemptLayer`, `deriveProductionPlannedAttemptLocations`; [request algebra](../../packages/orchestrator/src/workflow/protocols/task-attempt-planning/plan.ts), `PlannedTaskAttemptPlanRequest` |
| Explicit successor allocation | `ExactReplacement` carries its own exact Base and ordinal. The same production planner consumes those values instead of the configured Base. Its local ordinal counter advances past the explicit slot; this counter alone is not crash-recovery evidence. | [Production configuration tests](../../packages/dalph/src/application/production-configuration.test.ts), `keeps fresh ordinals task-local and consumes exact replacement Base and ordinal` |
| Authority before ordinary planning | Claim acquisition is followed by a fresh combined claimed-task eligibility observation. The recording operation directly depends on that matching positive outcome. A claim alone or generic graph outcome does not authorize a plan. | [ADR 0002](../adr/0002-planned-task-attempt-admission.md), “Causal graph” and “Coordinator-death recovery rules” |
| Durable fixation | One immutable attempt binds Run/task/revision/attempt identity, Base, branch, worktree and executor. Journal acknowledgement precedes Git worktree creation/discovery. An identical append is idempotent; another operation identity is not permission to replace a plan. | [Attempt delivery](../architecture/attempt-delivery-and-integration.md#immutable-planned-attempt); [recording types](../../packages/orchestrator/src/workflow/protocols/task-attempt-planning/record.ts), `TaskAttemptPlanRecordAcknowledged`, `TaskAttemptPlanAcknowledged`; [D2–D3](../DELIVERY-INVARIANTS.md#identity) |
| Recovery | An interrupted read is reconciled under its exact operation. A positive eligibility observation without a recorded plan requires fresh eligibility before planning after coordinator death. A recorded plan is reused exactly; contrary fresh facts produce a typed contradiction rather than silent replanning. | [ADR 0002](../adr/0002-planned-task-attempt-admission.md#coordinator-death-recovery-rules); [journal plan lookup](../../packages/orchestrator/src/workflow/protocols/task-attempt-planning/journal-evidence.ts), `recordedTaskAttemptPlanFor` |
| Prerequisite release | A fresh complete tracker graph proves prerequisite satisfaction and releases dependants. Executor acceptance, publication, claim deletion and a focused completion response do not replace that observation. Publication and exact local promotion precede the separate tracker-completion protocol. | [D9](../DELIVERY-INVARIANTS.md#graph-and-selection); [attempt delivery and integration](../architecture/attempt-delivery-and-integration.md), tracker-completion paragraph following “Exact-head promotion” |
| Git qualification | Exact ready worktree evidence binds registered path/branch/current HEAD and proves immutable Base ancestry. Target-lineage evidence independently reads the configured target and checks that Base against its exact head. Compatible advancement is permitted without Base equality or rewriting the attempt. Missing, unreadable and non-ancestral facts remain distinct. | [Git reconciliation scenarios](../scenarios/reconcile-git-facts.md), scenarios 12A–12B; [real Git qualification](../scenarios/qualify-real-git-lineage-candidate-ref.md), `reads real compatible, equivalent-content, rewritten, and unrelated target lineage without mutation`; [target-lineage tests](../../packages/orchestrator/src/authorities/git/target-lineage.test.ts) |
| Repository/target identity | The configured working repository and common Git directory are different locators. A distinct bare integration target must be read as that target; a healthy working repository cannot substitute for an unreadable target. | [Configured Git boundary](../scenarios/target-repository-git-boundary.md), “A separate bare or unreadable integration target” |
| Publication and custody | Candidate shape and expected-head promotion remain independent checks. Local target ownership and a pinned remote destination do not exclude outside remote writers. A new head is not permission to force-update or repeat an uncertain mutation. | [Real Git qualification](../scenarios/qualify-real-git-lineage-candidate-ref.md); [D28a–D28c](../DELIVERY-INVARIANTS.md#integration-and-promotion); [direct-publication chronology](../scenarios/direct-remote-publication.md) |

The distinction matters for the experiment: H0 can remain a valid ancestor of the current target while a new worktree at H0 lacks a prerequisite's newly delivered API. That is a hypothesis about task-visible code to measure, not a contradiction of the existing ancestry contract. Conversely, a worktree at current H can contain prerequisite-looking code without fresh tracker authorization to execute the dependant.

## Preserve explicit recovery and replacement

The current-head experimental arm applies only when allocating a genuinely new ordinary attempt. It must not turn head movement, host restart, suspension, a missing worktree, an old rejection or an existing plan into a new allocation trigger. The immutable-plan contract remains identical in both arms. [D2–D3](../DELIVERY-INVARIANTS.md#identity) and [exact Git reconciliation](../scenarios/reconcile-git-facts.md) own these restrictions.

[#428's accepted recovery chronology](../scenarios/rejected-provider-result-recovery.md#s5--alice-restarts-from-fresh-authority-while-keeping-the-predecessor) is a separate authority. Explicit Restart verifies fresh specification/lifecycle/prerequisites/claim, exact predecessor resources and stopped-writer custody, then uses observed H2 for the distinct successor. It preserves the predecessor's plan, worktree and candidate. Unknown historical Failed has its own Restart-only constraints; it is not ordinary Fresh planning. The scenario's source/test mapping explicitly distinguishes controlled protocol evidence, public production composition with provider substitutes and native custody evidence.

The current implementation in [result-recovery/replacement.ts](../../packages/orchestrator/src/workflow/protocols/result-recovery/replacement.ts) obtains `FreshRestartFactsVerified`, checks the exact fresh specification, predecessor plan and claim, reconciles historical writer custody where required, and calls `PlannedTaskAttemptPlanRequest.ExactReplacement` with `facts.baseSha`. `recordResultRecoveryReplacementWithPermit` records `ResultRecoveryAttemptReplaced` with the witness and successor plan. Duplicate/lost-response handling must reuse that record, not consume a new slot. An experiment may mimic this sequence to inspect Git consequences, but it cannot claim to exercise those production permits, journal validators or native writer proof merely by storing a JSON plan.

## Risks a current-head selector must not hide

- **Tracker truth and commit ancestry answer different questions.** H may contain another Run's or an external writer's code. It does not prove this task's current specification, prerequisites, lifecycle or exact claim. Keep complete tracker evidence and Git qualification separate; do not derive tracker completion from a commit. [D9](../DELIVERY-INVARIANTS.md#graph-and-selection), [ADR 0002](../adr/0002-planned-task-attempt-admission.md).
- **Qualification cannot be tautological.** Checking that newly selected H is an ancestor of itself does not detect an incompatible rewrite relative to the previously accepted integration lineage. Arm B needs an explicit reference for compatibility (the harness may use H0); production must decide that reference and its authority. Existing target-lineage checks compare an immutable attempt Base to the target. [Git reconciliation](../scenarios/reconcile-git-facts.md).
- **A read is not an atomic tracker/Git snapshot.** The head, specification, dependency set or claim can change between eligibility, selection, recording and worktree preparation. Fix one SHA after the defined bounded observation; do not read until stable. Reuse an acknowledged plan and apply existing fresh-boundary checks to subsequent changes. [ADR 0002](../adr/0002-planned-task-attempt-admission.md), [attempt delivery](../architecture/attempt-delivery-and-integration.md#immutable-planned-attempt).
- **Newer code changes task context.** H may include compatible unrelated changes and reduce a dependant's manual catch-up, but also enlarge its initial context and alter conflict behavior. Compare exact initial trees, worker changes and final candidate parents; do not infer reduced integration work solely from a newer Base. [Real Git candidate qualification](../scenarios/qualify-real-git-lineage-candidate-ref.md).
- **An SHA must be usable at the exact resource boundary.** A head resolved in a separate bare target may not yet exist in the repository that creates the attempt worktree. The experiment should expose this distinction; production selection would need an explicit object-availability/transfer owner rather than silently falling back to a different target. [Configured Git boundary](../scenarios/target-repository-git-boundary.md).
- **Cooperative custody has limits.** Local coordinator/ref serialization does not exclude external target writers. Preserve expected-head comparison, exact candidate evidence and uncertain-mutation reconciliation in both arms. [D28a–D28c](../DELIVERY-INVARIANTS.md#integration-and-promotion).

## Recommendation after the comparison

Specify qualified current-head fixation for **new ordinary attempts** as the
next candidate policy. In this workload it removes prerequisite repair merges
and avoids one textual conflict caused by a stale starting tree. A selectable
policy would add two configuration and recovery contracts without a demonstrated
need here. Retain fixed configured Base in production until that subsequent
specification is accepted and its actual admission/recovery composition is
qualified. Existing plans and explicit #428 replacement remain unchanged.

This recommendation is conditional: current head incorporates unrelated code,
provides no tracker eligibility authority, and needs a defined lineage/object
availability witness. The experiment does not prove production crash safety,
semantic correctness of arbitrary changes, or exclusion of outside Git writers.

## Specification decisions required before any production change

These are subsequent design decisions, not missing authorization to run the accepted experiment:

1. **Exact selection authority:** which configured integration target/ref supplies H, and which accepted ancestor or prior observation rules out rewritten lineage? What qualifies a head beyond ref resolution? How is object availability in the execution repository proved?
2. **Ordering and durability:** at which admission boundary does one bounded head read occur relative to claim/eligibility/specification observations and `TaskAttemptPlanned` acknowledgement? Which operation/witness records that choice and its causal predecessors? What happens when H changes before acknowledgement without changing task authority?
3. **Crash and uncertain acknowledgement:** how does recovery distinguish an unrecorded selection from an accepted plan whose response was lost? It must reread accepted history before allocating, preserve the complete recorded plan, and reconcile effects before retry. The process-local fresh-ordinal counter must not become durable deduplication authority.
4. **Changed or unavailable authority:** define typed outcomes for changed specification, prerequisites or claim, missing/unreadable ref/object, incompatible rewrite and an already acknowledged plan that can no longer cross its next boundary. Name the later retry trigger; no polling-until-stable or automatic replacement.
5. **Multiple Runs and outside updates:** state the supported cooperative ownership scope and how per-Run tracker evidence remains bound to the task while a shared head incorporates unrelated work. Do not promise a global snapshot or external-writer exclusion.
6. **Compatibility and explicit replacement:** decide whether any setting is versioned/pinned for new Runs or new plans; old acknowledged plans remain immutable. Preserve #428's distinct explicit request, fresh-authority and stopped-writer requirements and its `ExactReplacement` path.
7. **Production acceptance:** approve chronological scenarios and map them to the production planner, journal, worktree reconciliation, prerequisite-release, integration and recovery tests. Include negative controls and actual composition proof; a harness plan file and simulated Begin count cannot substitute for those seams. [Operational scenario gate](../OPERATIONAL-SCENARIOS.md) remains blocking.

## Observed comparison

Executed on 2026-10-05 at 13:33 UTC against the source revision above. The
[harness](https://github.com/dearlordylord/dalph/blob/587193e84/prototypes/attempt-base-experiment/run.py)
is retained on the throwaway `experiment/439-attempt-base` branch, outside
production. The [raw observations](https://github.com/dearlordylord/dalph/blob/227316f54/prototypes/attempt-base-experiment/observations.json)
retain exact SHAs, selected heads, immutable Base, initial HEAD, candidate
ancestry, final trees/parents, repair counts and refusal facts for every row.
These are reproducible controlled Git observations, not a production Accepted
result or remote/tracker completion receipt.

```bash
python3 prototypes/attempt-base-experiment/run.py \
  --output /tmp/dalph-439-observations.json \
  --source-revision 41e85aaf3df180da7b1cd68256166324437529ca \
  --deadline-utc 2026-10-05T13:38:00Z
```

The recorded expectation was 1–3 minutes with an absolute 13:38 UTC stop. The
complete run took 6.12 seconds: 20 paired variants, 42 observation rows. No paid
model, real tracker mutation or target-project gate ran. Each Git command has a
ten-second subprocess bound; the disposable repository is removed only after
those synchronous commands exit.

In the table, H0 is configured Base; H1/H2/H3 are the successive observed
integration commits **within that case**, not universal SHAs. Candidate lineage
is observed through Git ancestry. Workload acceptance means only that required
files exist and the deterministic candidate can be merged. The ordinary
production Integrator is not invoked.

| Case: starting facts and action | Fixed H0 arm | Qualified-current arm | Observed outcome, recovery and forbidden-effect boundary |
| --- | --- | --- | --- |
| 1. A integrates the API file, then B requires it | B Base/initial HEAD H0; API absent; one explicit worker fast-forward repair | B Base/initial HEAD H1; API present; no repair | Both candidates descend from immutable Base, both integrations apply, final trees identical. The worker repair changes HEAD, never the recorded Base. |
| 2. Independent task admitted before A, another after A advances head | Both Bases H0 | Early Base H0, later Base H1 | Both integrations apply in each arm; no atomic shared snapshot is assumed. |
| 2b. A changes a shared file before the later independent task appends to it | Later task starts at H0; textual merge conflict; integration head stays unchanged | Later task starts at H1; integration applies | Current starting tree avoids this specific conflict. This proves neither semantic compatibility nor correctness of arbitrary concurrent edits. |
| 3. Diamond A → B/C → D | D Base/initial HEAD H0; B/C files absent. Three worker repair merges across B/C/D | B/C start at H1; D starts at integrated H3 with both files. Zero repairs | Both final D integrations apply and final trees are identical. Parallel B/C need not start with each other's work; integration supplies the join. |
| 4. Unrelated compatible change advances target before B admission | B Base H0 excludes unrelated ancestor and file | B Base H1 includes unrelated ancestor and file | Both integrate without repair. Current head widens task-visible context; it does not remove unrelated code from the review context. |
| 5a–c. Target is missing, divergent from H0, or unreadable | Experimental qualification refuses; zero added plans/worktrees | Same refusal and zero effects | Missing/divergent checks use real Git failures/ancestry; unreadable boundary uses a missing Git directory. These common harness guards are a policy hypothesis, not the production planner's current chronological boundary. |
| 5d–f. Controlled specification, prerequisites or claim changes | Refuses before adding a plan/worktree | Same | These are controlled tracker guard inputs. No real provider request or production admission failure is claimed. |
| 6a. Head advances H1 → H2 before selection | Base H0 | Base H2 | One selection observation; no read-until-stable loop. |
| 6b. Head advances after selected plan intent, before acknowledgement | Base H0 retained | Selected H1 retained despite current H2 | Acknowledgement freezes the existing choice. This is one experimental ordering choice that the production spec must decide, not an already approved runtime rule. |
| 6c. Head advances after acknowledgement, before preparation | Prepared HEAD H0 | Prepared HEAD H1 despite current H2 | Prepared HEAD equals immutable Base; no automatic rebase or replacement. |
| 7a. Selection is lost before any retained intent | Fresh selection still H0 | Fresh selection may choose later H2 | No earlier acknowledged plan exists. Only the prototype's controlled restart is observed; actual host crash/Journal recovery is unrun. |
| 7b–c. Reopen after retained intent or acknowledgement; duplicate activation | Same H0 plan | Same selected H1 plan | Prototype ledger reload preserves exact identity/Base; repeated preparation creates one worktree. Native Begin and production Journal acknowledgement are not exercised. |
| 8. Integration advances while original attempt is executing, suspended or recovered | Original/later Base H0 | Original Base H1, later Base H2 | Retained plan and original worktree HEAD remain unchanged. State names are controlled labels; no live executor restart is claimed. |
| 9. Old plan exists; explicit successor receives H1 | Old Base H0 unchanged; successor H1 | Same | Both honor supplied replacement Base. Authorization, stopped-writer witness and #428's atomic journal transition remain owned by production tests, not this helper. |
| 10. Another Run puts prerequisite code into shared Git head | Git code/other Run observation alone does not authorize planning | Same | Both refuse until this Run gets its required explicit controlled observation, then may use the same foreign-produced compatible commit. Producer identity need not equal this Run; fresh tracker/claim authority matters. Fixed selected Base H0; current selected Base H1. |

The selected-head read count is equal in paired admission cases because both
arms share the experimental qualification guard. No extra-read performance claim
is inferred for production, whose current planner performs no Git read. The
useful measured differences are the worker repair merges and the observed
textual conflict, not the number of harness assertions.

## Remaining unmeasured boundaries

The Python ledger is intentionally not Dalph's Journal, and its reload is not
an actual host/process crash. Production stopped-writer custody, native executor
Begin/restart, uncertain acknowledgement, tracker provider failures, separate
bare-target object transfer and uncooperative concurrent Git writers remain
unqualified by this experiment. The cases describe which policy would need
proof at those boundaries; they do not manufacture a passing outcome.

The experimental ancestor anchor is H0. Current production lineage qualification
and #428 must determine the accepted anchor and witness for a new policy; checking
H ancestry against itself would prove nothing. The report preserves the existing
blocking edges and recommends a subsequent specification, not immediate code.
