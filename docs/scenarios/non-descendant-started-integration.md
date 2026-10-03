# Dalph releases a rewritten target and waits without reacquiring it

## Governing behavior

This scenario implements [#347](https://github.com/dearlordylord/dalph/issues/347).
It preserves [exact task-position release](release-exact-task-positions.md),
[Git rewrite constraints](reconcile-git-facts.md), and the distinct integration
resource in [accepted-result admission](queue-accepted-integration.md).

## Starting facts and chronological boundaries

Alice observes an open task T with its exact claim and immutable planned Base B,
branch, and worktree. Its accepted executor result C, integration responsibility,
and IntegrationStarted are durable. Executor work has finished and its task-work
position has already been released. There is no Integrator session, candidate,
quarantine, or operator direction. Git alone owns the integration ref.

An outside Git writer moves the target to H, where B is not an ancestor of H.
After its existing authority checks, Dalph records the exact target-lineage read
intent, reads Git, and records the non-descendant observation. The started
responsibility initially holds its process-local target lease.

1. Dalph projects the accepted observation and proposes release of T's exact
   integration-target lease. The resource adapter releases and publishes it.
2. Dalph reprojects the unchanged Journal with the lease absent. The accepted
   rewrite remains a task-local constraint; Dalph proposes neither acquisition
   nor an Integrator call. Repeated resource publications do not clear it.
3. If the process dies, its local leases disappear. Recovery from the same
   prefix retains the constraint even when activation freshness requires new
   tracker or Git reads. It does not acquire the target to satisfy that refresh.
4. A responsibility for another target can still acquire and use its own permit.

Alice sees accepted work retained while integration waits for Git facts. No
claim release, executor restart, worktree cleanup, second task-work release,
session/candidate/successor, ref mutation, completion, dependant release, rewrite
attribution, or Run-wide failure is authorized. The Git result is unambiguous;
provider mutation retries and candidate/promotion cleanup do not apply.

## Acceptance mapping and recovery boundary

| Outcome | Passing test owner and name |
| --- | --- |
| Release once, then wait with no Integrator action | `integration-frontier-transitions.test.ts`: `releases the target before an initial Integrator run when fresh lineage is incompatible` now also projects the released lease |
| No same-process ownership loop | `integration-claim-graph.test.ts`: `does not re-acquire a started integration target while its durable lineage is non-descendant` executes the production release adapter and repeats live recovery projections against an unchanged Journal |
| Restart remains blocked | `integration-claim-graph.test.ts`: `reconstructs a non-descendant started integration as a blocked wait without reacquiring the target` starts with an empty target controller |
| Independent progress | Both runtime cases retain another Run's unrelated target lease and execute its permit during every projection |
| Model boundary | The process-local pre-session guard is outside the current executable model abstraction, as explained below |

The latest accepted lineage read for the exact attempt and target controls this
constraint. An activation refresh requirement cannot erase it. A newer compatible
observation clears this guard, while existing freshness, baseline, tracker,
claim, and session admission checks still govern subsequent progress. This change
does not introduce a new polling or operator recovery protocol. Existing fixed
session Retry/FullRerun and ambiguous promotion reconciliation keep their own
precedence; no recovery boundary required by this scenario is deferred.

## Model scope

[`acceptedResultIntegration.qnt`](../../specs/acceptedResultIntegration.qnt)
abstracts `startIntegration` as simultaneously holding the target and assigning
`integrationSession` and `expectedTargetHead`. Its incompatible-lineage action
operates on Queued, and target reacquisition requires a fixed expected head.
It therefore cannot represent this production prefix: IntegrationStarted is
durable but no session has yet been fixed, and resource publications alone
reproject that prefix. This change guards process-local acquisition without
changing the model's atomic session/admission abstraction or its executable
adapter. Controlled production projection/resource tests above own this gap;
no Quint or conformance input is changed.
