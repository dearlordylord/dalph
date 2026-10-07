# Planner-reviewed task decomposition: boundary research

Dalph reads tasks and relations from the tracker and delivers exact planned
attempts through Git and executor boundaries. A future planner could review an
executor's suggested split before publishing tracker tasks. This record maps
that possible extension; it does not authorize it.

Status: **proposed design awaiting maintainer acceptance**, for
[parent #421](https://github.com/dearlordylord/dalph/issues/421). Inspected on
2026-10-07 at Git SHA `ab7f6b6e2a5090959ea52bf379e8c2f9fc7d336b`, also this
attempt's planned Base. Source links below refer to that checkout unless a
separate pinned external SHA is stated. Symbols and headings are exact locators;
Git preserves their inspected versions. No runtime/model files, canonical
glossary, or ADRs change: prose in this research file cannot add workflow
operations, executor outcomes, tracker mutations, or admission rules.

## Current boundaries and evidence

Each row describes existing contracts, not new decomposition guarantees. Tests
are locators for the next specification task to inspect, not checks run here.

| Boundary | Existing behavior and concrete source/contract locator |
| --- | --- |
| Task identity | [`TaskId` and `TaskRevision`](../packages/contracts/src/task-identity.ts) are separate branded strings. [`githubTaskIdFor`, `decodeGithubTaskId`](../packages/orchestrator/src/authorities/task-tracker/github/task-identity.ts) canonically encode the repository node ID and issue node ID as `t1.` plus reversible base64url JSON. An issue number is display metadata, not identity: `TrackerIssueNumber` in [`task.ts`](../packages/orchestrator/src/authorities/task-tracker/task.ts). |
| Lifecycle, grouping, prerequisites | `TrackerTask` in [`task.ts`](../packages/orchestrator/src/authorities/task-tracker/task.ts) carries `lifecycle`, one nullable `parentTaskId`, and `prerequisiteIds`. `isDependencySatisfied` requires `CompletedSuccessfully`. The [rooted graph contract](../docs/architecture/tracker-graph-and-claims.md#run-root-task-and-run-task-graph) includes grouping descendants of the root and transitive prerequisites; a task reached only as a prerequisite does not contribute grouping descendants. Grouping does not supply a prerequisite. |
| Native GitHub relation reads | [`graphBatchRequestBody`](../packages/orchestrator/src/authorities/task-tracker/github/graph-batch-query.ts) requests paginated `subIssues` and `blockedBy`; [`githubTrackerGraphReaderLayer`](../packages/orchestrator/src/authorities/task-tracker/github/graph-reader.ts) traverses those connections. [Consistency and bounds](../docs/architecture/tracker-graph-and-claims.md#github-consistency-and-bounds) explicitly limit observations and disclaim a transaction-wide snapshot or edge revision. A normalized `TrackerRevision` identifies content, not a graph-wide provider order. |
| Exact authored instructions | [`TaskWorkSpecification`, `makeTaskWorkSpecification`](../packages/contracts/src/task-work-specification.ts) bind a fingerprint to normalized title and body only. Lifecycle, grouping, blockers and claims are excluded. [`task-revision-fingerprint.test.ts`](../packages/orchestrator/src/authorities/task-tracker/task-revision-fingerprint.test.ts) owns focused fingerprint evidence. Changing edges alone cannot be treated as an instruction revision. |
| Claims | [`TrackerMutationService`, `ActiveTaskClaim`, `isExactTaskClaim`](../packages/orchestrator/src/authorities/task-tracker/claim-mutation.ts) separate acquisition, exact owner/token observation and release. The [GitHub claim contract](../docs/architecture/tracker-graph-and-claims.md#github-claim-record) uses a uniquely named repository label record, records intent before mutation, reconciles uncertain creation by exact lookup, and releases by exact node ID. It is not an issue's assigned label, a task selection or a permission to edit a graph. |
| Claim versus eligibility | The same [claim contract](../docs/architecture/tracker-graph-and-claims.md#github-claim-record) requires fresh task/graph facts after acquisition. [Claim reconciliation](../docs/scenarios/reconcile-task-claims.md) governs foreign, absent and unreadable records. A parent claim does not establish ownership of prospective children or a multi-task transaction. |
| Immutable attempt | [`PlannedTaskAttempt`, `plannedTaskAttemptEquivalence`](../packages/contracts/src/planned-attempt.ts) bind Run, task, instruction fingerprint, attempt identity, Base SHA, branch, worktree and executor locator. [Durable planning](../docs/ARCHITECTURE.md#durable-task-attempt-planning) records that decision before effects. [Changed-task reconciliation](../docs/scenarios/reconcile-changed-task-facts.md#alice-changes-as-instructions-while-its-planned-attempt-is-running) preserves the old plan and WIP; it never silently adopts new instructions. |
| Active-work refresh | [Active-work authority refresh](../docs/scenarios/active-work-authority-refresh.md#governing-behavior) routes tracker notifications/timer opportunities through the existing Run owner and read stack. A focused title/body read can detect a constraint, not authorize continuation or rewrite the planned fingerprint. Unreadability during active refresh proves neither loss nor permission and does not suspend healthy executing work. [`active-work-authority-refresh.acceptance.test.ts`](../packages/orchestrator/src/coordination/run/active-work-authority-refresh.acceptance.test.ts) owns composed evidence. |
| Already executing parent | [Intermediate tracker edits](../docs/scenarios/intermediate-tracker-edits.md#a-complete-intermediate-edit-admits-d) explicitly permits admission from a complete intermediate authored state. A later unfinished blocker does not suspend an executing attempt, replace it, release its position or clean its resources. It still prevents safely suspended work from resuming. Editing title/body instead invokes the [explicit changed-instruction choices](../docs/scenarios/reconcile-changed-task-facts.md#alice-changes-as-instructions-while-its-planned-attempt-is-running). |
| Delivery proposals | [`DeliveryProposalId`, `DeliveryProposalOwner`](../packages/orchestrator/src/coordination/delivery/delivery-action-proposal.ts) identify exact proposed workflow actions. [Protected compositions](../docs/ARCHITECTURE.md#protected-compositions) separate pure delivery description, downstream `deliveryActionPlanning`, and effects. These are scheduling/action proposals, not authored task-split proposals or planner decisions. [Reactive action execution](../docs/scenarios/run-reactive-delivery-actions.md) owns exclusion of duplicate live requests; it is not durable deduplication of newly created issues. |
| Executor and result | [`PlannedAttemptExecutorReport`, `PlannedAttemptExecutorResult`, `AcceptedResult`](../packages/contracts/src/executor.ts) describe executing, safely suspended, rejected-result and terminal observations; terminal results are `Accepted`, `Completed`, or `Failed`. There is no decomposition terminal variant in that algebra. [Executor boundary](../docs/ARCHITECTURE.md#planned-attempt-executor-boundary) keeps the internal algorithm coarse and requires stopped activity for safe suspension/terminal results. [Accepted results](../docs/CONTEXT.md#attempts-and-accepted-results) bind a commit and evidence, not planner approval, integration or tracker completion. |
| Observation versus acknowledgement | [Mutation-result evidence](../docs/architecture/tracker-graph-and-claims.md#mutation-results-as-graph-evidence) permits graph updates only from normalized results with the named coverage/completeness/consistency/freshness contract. Bare mutation acknowledgement cannot prove completed lifecycle, release dependants or establish Run completion. |

The inspected mutation seam [`TrackerMutationService`](../packages/orchestrator/src/authorities/task-tracker/claim-mutation.ts)
is for claims; the workflow operation registry
[`operation.ts`](../packages/orchestrator/src/workflow/registry/operation.ts)
provides existing reads, executor, integration and settlement operations. Neither
is an existing planner-approved batch task-creation/edge-publication contract.
This is a bounded finding about these interfaces, not a claim that GitHub lacks
issue-authoring APIs or that external actors cannot author tasks. The accepted
[intermediate-edit scenario](../docs/scenarios/intermediate-tracker-edits.md)
explicitly includes an external agent authoring tracker tasks.

## What the pinned Choir reference contributes

#421 pins Choir's
[orchestrator planning workflow](https://github.com/Weber-GeoML/Choir/blob/762d1ce47ee23871075fea22a2b510c1fd054fed/docs/agents/orchestrator-planning.md)
at SHA `762d1ce47ee23871075fea22a2b510c1fd054fed`. The file was read through
GitHub's contents API at that exact ref. The following are paraphrases of that
file, not Dalph policy or independently verified claims about Choir execution.

- `The roadmap` and `roadmap/<group>.md — the mathematics` put readable claims
  and reasoning before graph updates; an accepted reduction changes the prose
  describing what the new nodes establish.
- `Decomposition guidance` advocates shallow initial decomposition with depth
  added as reductions return, and local ratification based on the target
  statement and intended argument. Interface changes require wider review.
- The same section centralizes definitions whose exact shape other signatures
  depend on, while allowing helpers local to one proof inside a worker task.
  Shared-definition rewrites require a Base change and treatment of tasks
  already in flight. These are useful ownership questions for Dalph.
- `roadmap/graph.json — the graph` separates group membership and dependency
  facts, and states that a node is not necessarily a task. Choir also separates
  statement readiness from proof readiness. Its task `deps` does not mean
  Dalph's unfinished-prerequisite relation.

The transfer is review of a proposed split and explicit shared-interface
ownership. Do not import Choir's `roadmap/graph.json` as a second authoritative
Dalph graph, proof placeholders, readiness criteria, automatic splitting
thresholds, lease expiry, or centralized permission modes. The inspected file
is planning guidance, not a crash-safe tracker publication protocol. Its
statement-immutability caveats do not establish protection for Dalph interfaces.

## Two viable approaches for specification

Both approaches require accepted chronological scenarios before runtime work,
as [operational scenario policy](../docs/OPERATIONAL-SCENARIOS.md) requires.
Neither is accepted here. The review artifact would name the parent TaskId,
observed instruction fingerprint, proposed children and grouping, explicit
prerequisite edges, shared-interface ownership, and what remains for the parent.
How that artifact is identified and stored remains a decision.

### A. External planner reviews and authors tracker changes

The executor emits a proposed split as a review artifact, without treating it as
an Accepted commit or completing the parent. A maintainer or separately owned
planner reviews scope, interfaces, dependencies and current parent facts, then
uses tracker-native authoring. Dalph subsequently reads the resulting graph
through ordinary observations and delivers eligible tasks.

This keeps the coarse executor/result algebra and generic delivery planning
unchanged if the artifact remains outside them. It is feasible for a first
workflow because external authoring is already a scenario actor. It supplies no
new automatic publication, safe parent yield, deduplication or all-or-nothing
creation guarantee. The author must choose a safe sequence that cannot expose
an executable child before required edges, or explicitly accept intermediate
admission. The existing scenario rules preclude pretending grouping is a hold.
A separately accepted protocol is needed if the workflow promises stronger
visibility or restart guarantees. A human review record alone does not stop an
already autonomous parent.

### B. Dalph owns reviewed publication as a new workflow boundary

The executor emits a proposal; a separately identified planner records a review
against current facts. Only an authorized publication operation creates tracker
children and relations. Durable intent would precede each uncertain outside
effect, and readback would establish exact results before remaining steps or
retry. The tracker continues to own task identity, grouping and prerequisites;
the journal would own proposal/review/publication workflow history only.

This can support automated retry and auditability, but requires new contracts
for proposal identity, planner authority, child correlation and lookup,
partial-publication repair, revision checks, parent disposition and admission
visibility. It cannot be implemented by reusing `DeliveryProposalId` as a
split identity or by inventing a new meaning for Accepted. A new capability
might sit beside the coarse executor boundary or extend it explicitly; neither
placement is selected. Protected delivery compositions cannot be changed by
this research proposal. GitHub's observed consistency limitations prevent a
claim of an atomic graph transaction without additional evidence or a newly
accepted admission/publication design.

For either approach, a shared interface could be authored in a dedicated
prerequisite task before dependent work, or delivered by an explicitly assigned
parent/planner owner before children become eligible. These are alternatives,
not a mandate that the planner writes application code. Define the exact shared
surface and its owner; disjoint file names alone do not prove independent scope.
Dalph's immutable attempts forbid copying Choir's instruction to re-pin an
already executing task in place.

## Constraints and decisions left open

| Case | Existing boundary that constrains it | Decision/scenario the next specification must settle |
| --- | --- | --- |
| Duplicate proposal or review redelivery | Delivery action identity excludes duplicate live workflow calls, but is not task-split identity; see the proposal row above. | Are identical contents under the same parent/revision one proposal? How are conflicting splits or later revisions distinguished? Specify durable lookup before duplicate child creation and who may supersede a review. |
| Partial tracker mutation | Complete intermediate tracker states can admit work; missing evidence cannot prove empty blockers. No atomic multi-task authoring contract was found in the inspected interfaces. | Choose publication order/holding mechanism and exact visibility promise. Cover a child created without grouping, grouping before blockers, some edges applied and a failed remainder. Resume repair or compensate? Compensation cannot discard claimed/executing work. |
| Shared-interface ownership | Choir's centralized definition rule is inspiration; Dalph protected compositions and exact Base/attempt rules already constrain changes. | Assign one owner and order dependants explicitly, or describe a coordination rule. Who reviews interface changes, and what happens to children already planned against its old shape? |
| Already executing parent | New blockers alone leave autonomous work executing; instruction edits trigger safe suspension and explicit choices, preserving WIP/claims. | Does a split wait for parent suspension, remain advisory until parent completion, or use a newly accepted handoff? Who chooses Continue/Restart/Stop? Define remaining parent work and when parent success is established. |
| Crash or lost acknowledgement | Claims record intent and reread exact tracker records; executor process loss does not prove stopped writers; mutation acknowledgement is not graph evidence. | Cover death before review, after review before intent, after child creation before its response, between edge requests, and after full publication before observation. Name exact child lookup/correlation, ambiguous-outcome handling and custody proof. Current claim reconciliation is precedent, not proof for issue creation. |
| Stale revision | TaskRevision fingerprints title/body only; graph facts have distinct coverage/freshness and no transaction-wide revision. | Specify revalidation of instructions, lifecycle, claims, membership and edges before publication. What if they change after review or between requests? Reject/review again, finish a bounded already-authorized portion, or reconcile? Do not imply compare-and-swap from a fingerprint. |
| Parent/child completion | Grouping is distinct from blocking; only tracker-observed success satisfies a prerequisite, and Accepted is executor-scoped. | Keep parent as a delivery task, a coordination container, or a task with a remaining coherence step? Specify native blockers and final acceptance without auto-completing it merely because a split was reviewed. |
| Planner and authority | Current claims do not authorize graph editing or grant a planner role. | Identify the planner, review transport and acceptance actor; define proposal/review rejection and cancellation. Maintainer acceptance of the eventual specification is separate from reviewing one split. |

## Bounded handoff

The next specification task can use the evidence table as a boundary inventory,
choose between A/B or state a hybrid, and write scenario-by-scenario proposed
outcomes and future test seams. Minimum scenarios are duplicate/redelivered
proposal, rejected split, complete publication, partial publication, lost
creation acknowledgement plus restart, stale instructions/edges, shared
interface change, and an already executing parent. Each must state starting
facts, trigger, ordered boundary calls, visible/forbidden results and applicable
crashes/retries. None of the choices above is accepted policy.

Research limits: this reviewed current source/contracts and the pinned planning
file; it did not mutate a live tracker, test a GitHub authoring transaction,
execute runtime tests, or inspect unpinned Choir behavior. Existing behavior
citations establish source/contract boundaries; they are not new qualification
evidence. Documentation validation is local links and formatting only, following
[check selection](../docs/development/checks.md#choosing-checks). Remote link
availability, semantic coverage and eventual design acceptance require review.
