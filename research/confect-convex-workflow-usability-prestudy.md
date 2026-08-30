# Confect and Convex Workflow usability prestudy

**Research date:** 2026-08-25

**Dalph baseline:** `095465d0267fa3f328b525727e1d03f60f3dbae4`

**Confect baseline:** default-branch commit
[`e3f9547460828de041f5b9f4874bde205ccbce27`](https://github.com/rjdellecese/confect/tree/e3f9547460828de041f5b9f4874bde205ccbce27),
with published stable `@confect/server@9.4.1` at
[`1cc8e7722e8cb2f46288449c50239c710af01838`](https://github.com/rjdellecese/confect/releases/tag/%40confect%2Fserver%409.4.1)

**Convex Workflow baseline:** `@convex-dev/workflow@0.4.6`, followed through
default-branch commit
[`20b7268d47782615e24451e0a6ffb511e2feb9b9`](https://github.com/get-convex/workflow/tree/20b7268d47782615e24451e0a6ffb511e2feb9b9)

**Convex documentation baseline:**
[`db432176b01bb1f834e279b2686245b6dc3cb90a`](https://github.com/get-convex/convex-backend/tree/db432176b01bb1f834e279b2686245b6dc3cb90a/npm-packages/docs)

## Status and decision boundary

This is research, not an adoption decision or an implementation. It changes no
Dalph command, workflow decision, external request, durable fact, retry,
recovery, concurrency, cleanup, or visible runtime result. Operational
scenarios are therefore not required for this document. A future executable
spike would require accepted chronological scenarios and a scenario-to-test
mapping before implementation.

No prototype was created. Pinned source conclusively answers the material
deletion-leverage questions: Confect is an Effect-to-Convex application
framework, while durable replay belongs to a separate plain-Convex Workflow
component; the component does not provide Dalph's external identity mapping,
reconcile-before-retry protocols, exact resource admission, or typed cleanup.
A successful happy-path prototype could demonstrate APIs but could not reverse
those source-level boundaries.

## What “Confect Convex” means

The phrase is ambiguous unless the two products are separated.

- **Observed source fact:** Confect describes itself as a framework that
  integrates Effect with Convex: Effect schemas define database and function
  boundaries, Effect handlers receive Convex capabilities as services, and
  clients encode and decode through the same specs
  ([Confect introduction](https://github.com/rjdellecese/confect/blob/e3f9547460828de041f5b9f4874bde205ccbce27/apps/docs/getting-started/introduction.mdx#L7-L17)).
- **Observed source fact:** Confect does not implement durable workflow replay.
  Its documentation says that Convex components such as Workflow require
  standard Convex functions, which Confect can register and route beside
  Effect-based functions
  ([plain functions](https://github.com/rjdellecese/confect/blob/e3f9547460828de041f5b9f4874bde205ccbce27/apps/docs/server/plain-convex-functions.mdx#L7-L26),
  [components](https://github.com/rjdellecese/confect/blob/e3f9547460828de041f5b9f4874bde205ccbce27/apps/docs/server/components.mdx#L48-L52)).
- **Observed source fact:** Durable computation comes from the separate
  `@convex-dev/workflow` component. It re-executes a plain async handler and
  deterministically replays stored steps until it reaches new work
  ([Workflow README](https://github.com/get-convex/workflow/blob/20b7268d47782615e24451e0a6ffb511e2feb9b9/README.md#L93-L104)).

Accordingly, this study evaluates three layers separately: Confect's developer
interface, Convex Workflow's durable-computation semantics, and the Convex
platform facts on which both rely. “Confect has durable workflows” would be an
incorrect compression of those layers.

## Executive finding

Convex Workflow is a real durable-execution engine with several stronger
surface capabilities than the Effect Workflow beta previously studied:
database-backed step history, deterministic replay, generation fencing,
durable sleeps and events, reactive status, nested workflows, configurable
action retries, and Workpool parallelism. Confect adds an attractive schema,
service, code-generation, and test experience for ordinary Convex functions.

That combination is not a viable replacement for Dalph's durable-computation
layer at the pinned revisions.

First, the durable workflow body is plain Convex async code, not a Confect
Effect handler. Confect only passes component-required functions through its
spec/impl tree. Second, stable Confect 9.4.1 is on Effect 3 while Dalph pins
Effect `4.0.0-beta.106`. The published Confect 10 prerelease has moved to
Effect `4.0.0-rc.111`, which also does not accept Dalph's beta pin. This is a
current compatibility fact, not a claim that Confect will remain on Effect 3.
The stable package's peer range is visible in pinned source
([`packages/server/package.json`](https://github.com/rjdellecese/confect/blob/e3f9547460828de041f5b9f4874bde205ccbce27/packages/server/package.json#L68-L74));
the release lanes were checked against the
[`@confect/server` registry record](https://registry.npmjs.org/@confect%2fserver).

More importantly, Convex Workflow records execution steps, not Dalph's semantic
occurrences. It cannot decide whether GitHub created a claim, Git promoted a
commit, or an executor started after a reply was lost. Convex's own action
documentation uses the same ambiguous external-effect example and assigns
reconciliation and retry to application code
([Convex actions](https://github.com/get-convex/convex-backend/blob/db432176b01bb1f834e279b2686245b6dc3cb90a/npm-packages/docs/docs/functions/actions.mdx#L230-L237)).
Dalph would retain its exact identity mapping, intent/observation Journal,
fresh authority reads, resource admission, and cleanup protocols. It would
also add a Convex deployment, component tables, Workpool, scheduler, generated
modules, and a remote execution boundary. The candidate therefore does not
delete enough machinery to justify a spike.

## Evidence discipline

This study uses four evidence levels:

1. **Observed source fact** — directly established by source, first-party
   documentation, package metadata, or a test at the pinned revisions.
2. **Source-code inference** — a Dalph consequence derived from observed facts;
   it is explicitly labelled and is not reported as tested behavior.
3. **Project issue report** — a reported reproduction or maintainer design note;
   it identifies a test target but is not an observed Dalph outcome.
4. **Unknown** — a question that source reading did not settle and that would
   require a controlled experiment or provider evidence.

There are no experiment results. No live Convex deployment was called and no
provider mutation was retried.

## Current risk signals to reproduce, not assume

All four reports remained open on the research date.

- [Workflow #276](https://github.com/get-convex/workflow/issues/276) reports
  that deterministic-environment patching mutates shared `globalThis` under
  `convex-test`, allowing a workflow handler that outlives the winning side of
  `Promise.race` to corrupt unrelated tests. A project member points to an
  AsyncLocalStorage change in `convex-test`; this must be tested with the exact
  pinned dependency set, not generalized from the report.
- [Workflow #35](https://github.com/get-convex/workflow/issues/35) is the
  project's open design issue for evolving live workflow code. Adding,
  removing, or reordering steps currently risks determinism failure; the README
  names the same restriction
  ([limitations](https://github.com/get-convex/workflow/blob/20b7268d47782615e24451e0a6ffb511e2feb9b9/README.md#L834-L858)).
- [Workflow #178](https://github.com/get-convex/workflow/issues/178) reports
  that a handler cannot inspect current journal size or length to implement a
  Continue-as-New-style rollover before arbitrary loops hit the journal limit.
  The pinned README documents an 8 MiB journal ceiling but no rollover API
  ([limitations](https://github.com/get-convex/workflow/blob/20b7268d47782615e24451e0a6ffb511e2feb9b9/README.md#L838-L848)).
- [Workflow #74](https://github.com/get-convex/workflow/issues/74) reports that
  reactive workflow completion can trail the last domain mutation by seconds.
  A project member explains that the next workflow poll is separately enqueued
  and recommends application-owned status when atomic visible completion is
  required. Dalph must test this before treating component status as a Run
  finality signal.

These are upgrade/replay, test-isolation, bounded-history, and visible-finality
experiments. None proves that Dalph would fail on the pinned stack.

## What the current stack actually provides

### Confect's scope and usability

**Observed source fact.** A Confect API separates shareable specs from server
implementations. Function specs carry names and argument, return, and optional
error schemas; group finalization rejects a missing implementation at compile
time
([spec/impl model](https://github.com/rjdellecese/confect/blob/e3f9547460828de041f5b9f4874bde205ccbce27/apps/docs/concepts/spec-impl-model.mdx#L7-L13),
[`GroupImpl.finalize`](https://github.com/rjdellecese/confect/blob/e3f9547460828de041f5b9f4874bde205ccbce27/apps/docs/concepts/spec-impl-model.mdx#L32-L64)).
Generated services expose database access, function calls, storage,
authentication, scheduling, search, and raw Convex contexts to Effect handlers
([services](https://github.com/rjdellecese/confect/blob/e3f9547460828de041f5b9f4874bde205ccbce27/apps/docs/concepts/services.mdx#L9-L24)).

**Observed source fact.** Plain Convex functions are represented by special
spec constructors and their already-registered Convex function value is used as
the implementation. The docs' component example is written with Convex
`mutation`, `query`, and `internalAction`, not with a durable Effect algebra
([plain-function definition](https://github.com/rjdellecese/confect/blob/e3f9547460828de041f5b9f4874bde205ccbce27/apps/docs/server/plain-convex-functions.mdx#L46-L125),
[implementation](https://github.com/rjdellecese/confect/blob/e3f9547460828de041f5b9f4874bde205ccbce27/apps/docs/server/plain-convex-functions.mdx#L156-L199)).

**Observed source fact.** Confect query, mutation, and action adapters decode
arguments, build an Effect Layer from the current Convex function context, run
the handler as a Promise, and encode its result. Confect's scheduler service
similarly encodes a typed ref and delegates `runAfter` or `runAt` to Convex
([query and mutation registration](https://github.com/rjdellecese/confect/blob/e3f9547460828de041f5b9f4874bde205ccbce27/packages/server/src/RegisteredConvexFunction.ts#L143-L217),
[action registration](https://github.com/rjdellecese/confect/blob/e3f9547460828de041f5b9f4874bde205ccbce27/packages/server/src/RegisteredFunction.ts#L162-L202),
[`Scheduler.ts`](https://github.com/rjdellecese/confect/blob/e3f9547460828de041f5b9f4874bde205ccbce27/packages/server/src/Scheduler.ts#L9-L50)).
Confect owns codecs and service adaptation here, not a checkpoint, queue, or
replay history.

**Observed source fact.** `@effect/workflow` appears in Confect server's
development dependencies, but a repository-wide source search found no import
or use of it. The only non-changelog Workflow references are the two docs that
direct users to the separate Convex component. Dependency presence is not
workflow integration
([development dependency](https://github.com/rjdellecese/confect/blob/e3f9547460828de041f5b9f4874bde205ccbce27/packages/server/package.json#L9-L24)).

**Source-code inference.** Confect would be useful if Dalph were being rebuilt
as an Effect application hosted on Convex. It does not offer a drop-in adapter
for Dalph's current Effect V4 process, and its most relevant durable path exits
the Effect program into plain Convex functions. Adopting it would create a new
application/runtime boundary rather than reduce the current one.

### Workflow identity and reconstruction

**Observed source fact.** `WorkflowId` is a branded string at TypeScript level
([`types.ts`](https://github.com/get-convex/workflow/blob/20b7268d47782615e24451e0a6ffb511e2feb9b9/src/types.ts#L16-L25)).
Starting a workflow inserts a new `workflows` document and returns its generated
database ID; the create input has no caller-provided idempotency key
([`createHandler`](https://github.com/get-convex/workflow/blob/20b7268d47782615e24451e0a6ffb511e2feb9b9/src/component/workflow.ts#L42-L101)).
The row stores its function handle, arguments, optional completion callback,
result, and a generation number
([schema](https://github.com/get-convex/workflow/blob/20b7268d47782615e24451e0a6ffb511e2feb9b9/src/component/schema.ts#L7-L32)).

**Observed source fact.** Each poll loads the workflow and journal, rejects a
stale generation, stops while a step is in progress, then re-runs the handler
against prior entries
([`workflowMutation`](https://github.com/get-convex/workflow/blob/20b7268d47782615e24451e0a6ffb511e2feb9b9/src/client/workflowMutation.ts#L187-L240)).
Replay consumes entries in order and validates the step name, kind, and normally
its arguments before supplying the recorded result
([`StepExecutor`](https://github.com/get-convex/workflow/blob/20b7268d47782615e24451e0a6ffb511e2feb9b9/src/client/step.ts#L81-L107),
[replay check](https://github.com/get-convex/workflow/blob/20b7268d47782615e24451e0a6ffb511e2feb9b9/src/client/step.ts#L125-L155)).

**Source-code inference.** Dalph needs a separately persisted one-way mapping
from exact `RunId` and `AttemptId` to `WorkflowId`, with its own idempotent start
protocol. A generated Workflow ID cannot replace either identity. An ambiguous
caller-to-Convex start response is safe only if Dalph's request identity and the
created ID are correlated through an accepted transactional boundary; the
component itself exposes no such key.

**Source-code inference.** Workflow reconstruction restores control flow and
step results, not process-local files, Git worktrees, fibers, child processes,
or executor sessions. Those remain owned by Git, the execution substrate, and
the executor, exactly as in Dalph's current architecture.

### Durable occurrences and history

**Observed source fact.** The component persists one workflow table and a steps
table ordered by `(workflowId, stepNumber)`. A step stores operational fields
such as name, kind, arguments, in-progress flag, result, timestamps, function or
work handle, and nested workflow or event ID
([schema](https://github.com/get-convex/workflow/blob/20b7268d47782615e24451e0a6ffb511e2feb9b9/src/component/schema.ts#L34-L83)).
Status and step history are queryable and reactive
([README](https://github.com/get-convex/workflow/blob/20b7268d47782615e24451e0a6ffb511e2feb9b9/README.md#L491-L514),
[`listSteps`](https://github.com/get-convex/workflow/blob/20b7268d47782615e24451e0a6ffb511e2feb9b9/src/component/workflow.ts#L224-L240)).

**Observed source fact.** Restarting from a step deletes that step and all later
steps, increments the generation, clears the result, and re-executes
([`restartHandler`](https://github.com/get-convex/workflow/blob/20b7268d47782615e24451e0a6ffb511e2feb9b9/src/component/workflow.ts#L256-L345)).

**Source-code inference.** This is a useful execution journal but not an
immutable Dalph workflow-occurrence log. It lacks typed actors, distinct
initiated actions versus non-action reports, exact operation identities,
causal links, external authority observations, and append-only restart history.
Dalph would still need its Journal for accepted semantic evidence. Copying
component step state into that Journal would add projection and correlation
laws rather than remove them.

### Ambiguous effects and retry

**Observed source fact.** Queries and mutations run transactionally and cannot
call third-party APIs
([mutation transactions](https://github.com/get-convex/convex-backend/blob/db432176b01bb1f834e279b2686245b6dc3cb90a/npm-packages/docs/docs/functions/mutation-functions.mdx#L152-L165)).
Scheduling from a mutation is atomic with its database transaction; scheduling
from an action is not, and already-scheduled work survives a later action
failure
([scheduled functions](https://github.com/get-convex/convex-backend/blob/db432176b01bb1f834e279b2686245b6dc3cb90a/npm-packages/docs/docs/scheduling/scheduled-functions.mdx#L46-L61)).

**Observed source fact.** Workflow action retries are disabled by default but
can use bounded exponential backoff, while query and mutation failures receive
Convex's transactional retry treatment
([Workflow retry API](https://github.com/get-convex/workflow/blob/20b7268d47782615e24451e0a6ffb511e2feb9b9/README.md#L316-L377)).
Convex's platform docs say scheduled actions are at-most-once unless the
developer explicitly checks the desired outside outcome before scheduling them
again
([scheduled error handling](https://github.com/get-convex/convex-backend/blob/db432176b01bb1f834e279b2686245b6dc3cb90a/npm-packages/docs/docs/scheduling/scheduled-functions.mdx#L154-L165)).

**Source-code inference.** A Workflow action that calls GitHub, Git, or an
executor still crosses the ambiguity window in which the outside system
applies the request but the action fails before recording its reply. Turning on
Workpool retries may repeat that effect. Dalph must still record intent before
the call, check the owning system after ambiguity, and only then continue or
repeat. The engine can durably schedule that protocol; it does not implement
the protocol.

### Concurrency and admission

**Observed source fact.** A Workflow uses Workpool. The manager/component has a
configurable `maxParallelism`; any number of workflows may remain in flight,
while the limit bounds simultaneously executing steps. The README also warns
that one component instance must use one value
([parallelism](https://github.com/get-convex/workflow/blob/20b7268d47782615e24451e0a6ffb511e2feb9b9/README.md#L380-L414)).
Pinned source defaults the component to 25 and action retries to five attempts
when retry is enabled
([`pool.ts`](https://github.com/get-convex/workflow/blob/20b7268d47782615e24451e0a6ffb511e2feb9b9/src/component/pool.ts#L27-L57)).

**Source-code inference.** This is useful load admission, but it is not Dalph's
task-work capacity. It does not bind one exact task attempt to one worktree and
planned Base SHA, distinguish target integration from executor capacity, or
hold a position until terminal result or safe suspension. Dalph's resource
owners and admission rules would remain above Workpool.

### Cancellation and typed cleanup

**Observed source fact.** Cancel increments the workflow generation and asks
Workpool or child workflows to cancel, but an action already executing finishes
([README](https://github.com/get-convex/workflow/blob/20b7268d47782615e24451e0a6ffb511e2feb9b9/README.md#L516-L527),
[`completeHandler`](https://github.com/get-convex/workflow/blob/20b7268d47782615e24451e0a6ffb511e2feb9b9/src/component/workflow.ts#L376-L426)).

**Source-code inference.** Generation fencing prevents a late result from
advancing the canceled workflow; it does not prove the running outside effect
stopped or reached Dalph's accepted safe-suspension boundary.

**Observed source fact.** Cleanup is a generic operation on `WorkflowId`. It
normally refuses an unfinished workflow, has a `force` escape hatch, deletes
the workflow row before deleting step/event records in batches, and schedules
forced cleanup of nested workflows
([`cleanup`](https://github.com/get-convex/workflow/blob/20b7268d47782615e24451e0a6ffb511e2feb9b9/src/component/workflow.ts#L453-L483),
[batched deletion](https://github.com/get-convex/workflow/blob/20b7268d47782615e24451e0a6ffb511e2feb9b9/src/component/workflow.ts#L498-L575)).
Completed workflow records are otherwise retained indefinitely
([README](https://github.com/get-convex/workflow/blob/20b7268d47782615e24451e0a6ffb511e2feb9b9/README.md#L577-L599)).

**Source-code inference.** Component cleanup cannot authorize or prove removal
of an exact Git worktree, branch, claim, executor resource, or Integrator
candidate. It is neither disposition-typed nor fail-closed for those resources.
The `force` path and history deletion are especially unsuitable as substitutes
for Dalph cleanup. Dalph would retain every resource-specific cleanup protocol
and separately choose retention for the component's operational records.

### Dry-run, test, and production interpretation

**Observed source fact.** Confect's `TestConfect` is an Effect service wrapping
`convex-test`; it can call functions, provide identities, run setup code, and
drain scheduled functions
([test implementation](https://github.com/rjdellecese/confect/blob/e3f9547460828de041f5b9f4874bde205ccbce27/packages/test/src/TestConfect.ts#L22-L71),
[scheduled helpers](https://github.com/rjdellecese/confect/blob/e3f9547460828de041f5b9f4874bde205ccbce27/packages/test/src/TestConfect.ts#L183-L194)).
Workflow separately exports a `convex-test` component registration helper
([`src/test.ts`](https://github.com/get-convex/workflow/blob/20b7268d47782615e24451e0a6ffb511e2feb9b9/src/test.ts#L1-L18)).

**Observed source fact.** Production Workflow code is ordinary async
TypeScript over `WorkflowCtx`, whose step methods return Promises
([`workflowContext.ts`](https://github.com/get-convex/workflow/blob/20b7268d47782615e24451e0a6ffb511e2feb9b9/src/client/workflowContext.ts#L75-L129)).
No dry-run interpreter or Effect workflow algebra is exposed.

**Source-code inference.** The same Workflow handler can run under
`convex-test` and production Convex, which is valuable. It does not satisfy
Dalph's stronger invariant that dry-run, controlled tests, and production
interpret one Effect workflow algebra. Dalph would either branch before the
remote boundary or build a new interpreter/adapter and then prove conformance.

### Operational footprint

**Observed source fact.** Confect requires code generation and runs alongside
Convex development; its example starts Vite, `convex dev`, and `confect dev`
([example scripts](https://github.com/rjdellecese/confect/blob/e3f9547460828de041f5b9f4874bde205ccbce27/apps/example/package.json#L27-L33)).
Workflow installs a Convex component containing its own tables and an embedded
Workpool
([installation](https://github.com/get-convex/workflow/blob/20b7268d47782615e24451e0a6ffb511e2feb9b9/README.md#L106-L135),
[schema](https://github.com/get-convex/workflow/blob/20b7268d47782615e24451e0a6ffb511e2feb9b9/src/component/schema.ts#L112-L140)).

**Observed source fact.** Node actions have a ten-minute execution limit, while
platform deployment classes separately cap concurrent actions and scheduled
jobs
([limits](https://github.com/get-convex/convex-backend/blob/db432176b01bb1f834e279b2686245b6dc3cb90a/npm-packages/docs/docs/production/state/limits.mdx#L122-L150)).

**Source-code inference.** Dalph's Git worktrees and executor sessions cannot be
made durable merely by running the coordinator on Convex. A production design
would need a reachable service that owns repository storage and long-lived
executor resources, plus authenticated request correlation between Convex and
that service. This is additional distributed-system surface, not deletion
leverage.

## Fit against Dalph's delivery invariants

| Dalph requirement | Observed candidate support | What Dalph must retain | Disposition |
| --- | --- | --- | --- |
| Exact Run/Attempt identity | Generated branded `WorkflowId`; generation fences stale completions | Exact mapping and idempotent start correlation | Gap |
| One worktree and Base SHA per attempt | Arbitrary typed workflow arguments | Git-owned locator validation and ownership | Not provided |
| Durable reconstruction | Database-backed ordered step replay | Semantic occurrence reduction and fresh owning-system reads | Partial |
| Intent, observation, reconcile-before-retry | Durable step start/result; configurable action retry | Every external ambiguity protocol | Partial but non-deleting |
| Bounded task execution | Workpool step parallelism | Task/target/resource-specific admission and position lifetime | Different phenomenon |
| Typed, exact, recoverable cleanup | Generic workflow-history cleanup and cancellation | All resource-specific disposition protocols | Not provided |
| One dry-run/test/production algebra | Same Promise handler under test and production Convex | Dalph Effect algebra or a new conformance adapter | Gap |
| Minimal operational authority | Convex deployment plus component DB, scheduler, Workpool | Tracker, Git, executor, substrate, Integrator, Journal | Adds an authority boundary |

## Usability assessment

### Supported

- Confect's schema-first specs, generated refs/services, typed errors, complete
  group implementation check, and `convex-test` wrapper form a cohesive
  full-stack developer experience.
- Convex Workflow offers concise ordinary-code orchestration, durable sleeps
  and events, nested workflows, reactive status, deterministic replay checks,
  bounded step execution, and generation fencing.
- Mutation transactions are a strong place to atomically record a local Convex
  intent and schedule later work.

### Not supported for Dalph replacement

- An Effect-native durable workflow body compatible with Dalph's current V4
  pin.
- Caller-selected/deterministic workflow identity or a built-in mapping from
  exact Dalph Run/Attempt identity.
- Reconciliation of ambiguous GitHub, Git, executor, or Integrator effects.
- An immutable typed occurrence history satisfying Dalph's Journal semantics.
- Dalph's resource-specific capacity and cleanup protocols.
- Local Git worktree and long-lived executor ownership.
- One Dalph workflow algebra interpreted for dry-run, tests, and production.

### Preliminary recommendation

Do not open a Confect/Convex Workflow prototype for replacing Dalph's Journal
or delivery runtime. The pinned source already predicts retention of the hard
correctness machinery plus a new remote platform boundary.

Keep Convex Workflow on the candidate list for a narrower, separately accepted
problem where the authoritative state already lives in Convex—for example a
dashboard notification or approval flow whose effects are Convex mutations.
That is a different adoption question from owning Dalph Runs, Git worktrees,
and executor attempts.

## Scenario-to-test map if the question is reopened

These are proposed evaluation chronologies, not accepted Dalph behavior and not
tests run by this study.

| Concrete chronology | Required controlled test | Decision evidence |
| --- | --- | --- |
| Dalph asks Convex to start exact Run R / Attempt A; the row is created but the reply is lost; restart tries again | `ambiguous_start_reuses_one_workflow_for_exact_attempt` | Prove one durable mapping and no duplicate workflow |
| An action asks GitHub to create a claim; GitHub applies it; the action loses the reply; Workpool activates retry | `action_retry_rereads_tracker_before_mutation` | Prove fresh authority read and no duplicate mutation |
| The coordinator disappears after a step starts and before its result is recorded | `restart_reconstructs_without_inventing_external_result` | Distinguish recorded step state from current external fact |
| More runnable attempts exist than task-work capacity | `component_parallelism_does_not_replace_attempt_positions` | Prove exact Dalph positions remain bounded through terminal/safe suspension |
| A canceled Run still owns a worktree and claim | `workflow_cleanup_cannot_authorize_resource_cleanup` | Prove disposition-specific reads/intents/results precede exact cleanup |
| The same chronology runs in dry-run, controlled test, and production assembly | `all_modes_interpret_one_dalph_workflow_algebra` | Detect environment branches or unproved adapters |

Any future spike must use a local or controlled deployment, inject the named
lost-response cut points, and avoid retries against live providers.

## Unknowns and consciously unrun work

- **Unknown:** managed Convex recovery latency and every internal Workpool crash
  point. Public contracts and component source were sufficient for the present
  disposition; the managed backend was not fault-injected.
- **Unknown:** whether a future Confect release will support Dalph's exact Effect
  version. The current stable and prerelease peer ranges do not.
- **Unknown:** an accepted architecture might deliberately move a narrow Dalph
  subsystem into Convex. No such scenario or authority transfer was assumed.
- **Unrun:** no Confect or Workflow test suite. This study made no source change
  and does not claim runtime verification.
- **Unrun:** no disposable worktree or prototype. Static evidence answered the
  decision question, so creating one would add evidence volume without testing
  a remaining material uncertainty.

## Sources inspected and verification performed

- Cloned Confect and recorded exact HEAD, commit date, package versions, peer
  dependencies, docs, source, examples, changelogs, and test adapter.
- Cloned `get-convex/workflow`, recorded exact HEAD/tag relationship, and read
  its README, public types, handler replay, environment patching, component
  schema, journal, lifecycle, Workpool callbacks, cleanup, and tests.
- Sparse-cloned `get-convex/convex-backend` at the named revision and read the
  first-party action, mutation, scheduling, OCC, runtime, and platform-limit
  documentation.
- Queried npm registry metadata on 2026-08-25: stable Confect server `9.4.1`,
  next `10.0.0-next.18`, Workflow `0.4.6`, and Convex `1.45.0`.
- Searched Confect source excluding lockfiles and changelogs for
  `@effect/workflow`, `unstable/workflow`, and `Workflow`; no implementation
  import was found.
- Inspected Dalph's `docs/OPERATIONAL-SCENARIOS.md`, `docs/CONTEXT.md`,
  `docs/ARCHITECTURE.md`, current Effect pin, and the earlier
  `effect-workflow-usability-prestudy.md` before evaluating fit.
