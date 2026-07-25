# Formal-model portfolio and recovery coverage

Status: research result for
[Define model-based and crash/pause-prefix test coverage](https://github.com/dearlordylord/dalph/issues/123)
under the
[bounded resumable and pausable graph-frontier map](https://github.com/dearlordylord/dalph/issues/114).
This document decides the portfolio, executable-model seams, coverage
obligations, and graduation gates. It does not promote the prototype, change
the canonical specifications, implement an adapter, or change GitHub.

## Decision

Dalph needs **two canonical Quint models**:

1. **Task-work-session establishment recovery** asks whether one exact
   session-establishment operation can create or rediscover its provider
   session after an uncertain request without changing its operation identity
   or accepting incomplete provider evidence.
2. **Graph-frontier recovery composition** asks whether the orchestrator can
   traverse one bounded task graph across all accepted ambiguity-crossing
   boundaries while crash, pause, resume, capacity, and independent external
   constraints compose without duplicate effects or branch-global blockage.

Keep and strengthen
[`specs/taskWorkSessionRecovery.qnt`](../specs/taskWorkSessionRecovery.qnt).
Promote the checked frontier prototype from
`prototypes/frontier-recovery/frontierRecovery.qnt` at `6d7e28a97` to the
future canonical path `specs/frontierRecovery.qnt` during specification
synthesis. Do not split the frontier model into separate pause, scheduling, and
reconciliation models now. Those concerns use the same tracker/Git/provider
authority projection, per-task transition grain, workflow-algebra adapter,
prefix-reopening seam, checking profiles, and control-plane maintainer. A split
would duplicate their interaction rules and would not make a currently
intractable profile tractable: the checked prototype already exhausts four
focused profiles.

Do not merge the session model into the frontier model. The session model owns
provider correlation, authoritative absence, unreadability, conflicting
reports, and the three-lookup bound in detail. The frontier model deliberately
abstracts each boundary to intent, request, fresh observation, and outcome or
disposition. Merging that provider-specific state into all eight frontier
boundaries would make the broad composition model less tractable while hiding
the question the focused model answers.

This is the smallest justified portfolio. A third model is permitted only when
its authority boundary, abstraction, repeatable exhaustive profile, executable
adapter, lifecycle, or implementation consumer materially differs. File size
and scenario count do not justify another model. These criteria come from the
checked
[`MODEL-PORTFOLIO-HANDOFF.md`](https://github.com/dearlordylord/dalph/blob/6d7e28a97/prototypes/frontier-recovery/MODEL-PORTFOLIO-HANDOFF.md).

## Sources and current evidence

The decision uses these primary sources:

- canonical language and accepted behavior in
  [`docs/CONTEXT.md`](../docs/CONTEXT.md),
  [`docs/ARCHITECTURE.md`](../docs/ARCHITECTURE.md), and
  [ADRs 0003–0009](../docs/adr/);
- the accepted pause, frontier, authority, and reconciliation decisions in
  issues
  [#115](https://github.com/dearlordylord/dalph/issues/115),
  [#117](https://github.com/dearlordylord/dalph/issues/117),
  [#118](https://github.com/dearlordylord/dalph/issues/118), and
  [#120](https://github.com/dearlordylord/dalph/issues/120);
- the checked prototype, deterministic tests, verification evidence,
  deliberately weakened counterexamples, problem log, and portfolio handoff
  at commits
  [`bd5763ed9`](https://github.com/dearlordylord/dalph/commit/bd5763ed9)
  and
  [`6d7e28a97`](https://github.com/dearlordylord/dalph/commit/6d7e28a97);
- the focused model, its deterministic scenarios, the existing
  Quint-connect driver, the in-memory recovery tests, and the production
  SQLite crash matrix in
  [`specs/taskWorkSessionRecovery.qnt`](../specs/taskWorkSessionRecovery.qnt),
  [`specs/taskWorkSessionRecovery_test.qnt`](../specs/taskWorkSessionRecovery_test.qnt),
  [`task-work-session-recovery.mbt.test.ts`](../packages/orchestrator/src/task-work-session-recovery.mbt.test.ts),
  [`task-work-session-recovery-harness.ts`](../packages/orchestrator/test/task-work-session-recovery-harness.ts),
  and
  [`task-work-session-crash-matrix.test.ts`](../packages/orchestrator/src/task-work-session-crash-matrix.test.ts);
- the shared operation algebra and recovery/storage boundaries in
  [`workflow-operation.ts`](../packages/orchestrator/src/workflow-operation.ts),
  [`workflow.ts`](../packages/orchestrator/src/workflow.ts),
  [`workflow-recovery.ts`](../packages/orchestrator/src/workflow-recovery.ts),
  [`journal-store.ts`](../packages/orchestrator/src/journal-store.ts), and
  [`sqlite-journal-store.ts`](../packages/orchestrator/src/sqlite-journal-store.ts);
- Quint's first-party
  [CLI](https://quint.sh/docs/quint),
  [simulator](https://quint.sh/docs/simulator), and
  [model-checker](https://quint.sh/docs/model-checkers) documentation. Quint
  has commands, not a first-class checking-profile object: `test` executes
  named `run` definitions, `run` randomly simulates, and `verify` invokes a
  model checker. The official
  [Quint Connect](https://quint.sh/posts/quint_connect) implementation is
  currently Rust-specific. Dalph's pinned Effect V4
  `@firfi/quint-connect` adapter is therefore the executable primary evidence
  for the TypeScript API used here, not an assumed official TypeScript
  contract.

Current evidence is narrower than the required result:

- The session model is canonical and code-connected, but its MBT uses 25
  sampled traces with one fixed seed and an ad hoc in-memory journal. The
  SQLite crash matrix is a separate manually maintained scenario lane.
- The frontier prototype checks the accepted design but is neither canonical
  nor code-connected.
- The frontier prototype covers eight broad boundaries, crash, pause, capacity,
  and several external changes. It does not yet encode all of #120's accepted
  combinations, every safe pause boundary, or a production-reopening adapter.
- The implementation has no accepted graph-knowledge, pause, or frontier
  reducer matching the later canonical design. Model-to-code conformance for
  those actions is therefore a blocking implementation deliverable, not
  something this research can claim already passes.

## Portfolio inventory

### M1 — Task-work-session establishment recovery

**Concrete question.** After Dalph records one exact task-work-session
establishment intent, can the task runner create or rediscover the matching
provider session after request ambiguity while every repeat keeps the original
`OperationId`, planned attempt, and payload?

**Owned boundaries.** The Dalph workflow journal owns the intent and observed
workflow outcome. The task-work provider correlation registry and provider own
session existence and correlation evidence. The model reads the provider
through `TaskRunner`; it does not treat the journal as current provider
authority.

**Canonical path and disposition.**
`specs/taskWorkSessionRecovery.qnt` remains canonical. Its test module remains
`specs/taskWorkSessionRecovery_test.qnt`. Promote the existing model by
strengthening its adapter/reopening lanes; do not replace or retire it.

**Abstraction.** It includes selection before intent, one immutable payload,
request application or non-application, matching/absent/unreadable/conflicting
evidence, recovery authorization, bounded lookup, crash/restart, and terminal
non-convergence. It excludes task-graph scheduling, worktree bytes, provider
work-unit replacement, review, integration, SQLite/WAL mechanics, journal
migration, and task completion.

**Finite bounds.** One task, one planned attempt, one establishment operation,
lookup bound three, a stable payload, unbounded conceptual crashes represented
by crash/restart transitions, and simulation depth 40. Any change to the
production lookup bound must change the model constant and conformance profile
together.

**Safety invariants.**

- a request requires durable intent;
- every request uses the stable operation identity and payload;
- causal predecessors remain stable;
- only fresh authoritative absence authorizes a repeat;
- unreadable or conflicting evidence never authorizes creation;
- establishment requires a matching provider report; and
- the lookup bound and terminal result remain stable.

**Witnesses.** Intent, first request, absence-authorized repeat, matching
report, established outcome, unreadable exhaustion, absence exhaustion,
correlation conflict, and crash/restart must all be witnessed.

**Expected counterexamples.** Deliberately weaken the model so that a request
may occur without intent, a repeat may use a new identity or payload,
unreadable evidence may authorize a repeat, or establishment may occur without
a matching report. Each weakened profile must produce the named shortest
counterexample. M1 currently lacks this explicit negative suite; it is a
promotion obligation.

**Checking profiles.**

- deterministic scenarios for each decision edge;
- seeded sampled traces for construction and implementation MBT;
- TLC exhaustive profiles split into successful matching, bounded absence,
  bounded unreadability, conflict, and crash/restart windows; and
- deliberately weakened profiles proving each safety property rejects its
  corresponding bug.

**Implementation consumers.** The session-establishment workflow protocol,
recovery decision, journaled interpreter, managed-history reducer,
task-work-provider adapter contract, startup recovery, in-memory tests, and
SQLite production reopening.

**Maintainer.** The `packages/orchestrator` task-work-session recovery
maintainer. Ownership follows the production protocol rather than a person or
prototype branch.

### M2 — Graph-frontier recovery composition

**Concrete question.** Given current task/Git/provider facts and Dalph's
durable workflow history, can the orchestrator select and settle every legal
per-responsibility transition across a bounded graph without exceeding task
capacity, crossing an external boundary without intent, duplicating an effect,
using stale facts as current authority, or allowing one local constraint to
stop an independent branch?

**Owned boundaries.** The tracker owns task lifecycle, authored work
specification, dependencies, grouping, target membership, and claims. Git owns
Base ancestry, worktrees, attempt results, candidates, and target-ref
promotion. The executor and task-work provider own sessions, invocations, and
provider availability. The Dalph workflow journal owns only operation/control
intents, normalized observations, outcomes, and responsibility/disposition
history. Capacity and the runnable frontier remain process-local derivations.

**Canonical path and disposition.** Promote the prototype to
`specs/frontierRecovery.qnt`; move its deterministic scenarios to
`specs/frontierRecovery_test.qnt`; retain negative profiles as
`specs/frontierRecovery_counterexamples.qnt`; and move repeatable profile
execution into the root `check:quint` gate. The prototype copy is retired after
promotion so there is one canonical model, not two drifting copies.

**Abstraction.** M2 keeps distinct bounded authority, durable knowledge,
workflow responsibility, control commands, and process-local coordinator
state. Each ambiguity-crossing operation uses a common four-part abstraction:
durable intent, possibly applied request, fresh authority observation, and
durable outcome or exact nonterminal disposition. Provider-specific request
protocols, Git bytes, SQL rows, authored task text, executor internals, review
transcripts, and UI state are abstracted behind their boundary results.

**Finite bounds.** The accepted checked baseline is tasks `A`–`D`, dependency
`A -> B`, grouping parent `A -> D`, independent task `C`, capacity two, two
request attempts, two unreadable reads, one crash, one pause/resume cycle per
subject, and bounded authority revisions. Keep this profile. Add smaller
capacity-one scheduling and targeted two-constraint initializers instead of
increasing the monolithic state graph.

**Safety invariants.**

- task-work reservations never exceed configured capacity;
- every external effect has a prior intent with the same operation identity;
- one operation identity cannot apply the same authority effect twice;
- every request uses the identity recorded by its intent;
- a request cannot use an observation made stale by authority, activation, or
  control revision;
- every task has an immediately legal coordinator action or an exact wait,
  pause, isolation, relinquishment, settlement, or external wake reason;
- a local constraint on `A` does not stop independently eligible `C`; and
- tracker completion, attempt outcome, responsibility settlement, and run
  termination remain distinct.

Add explicit invariants during promotion for: derived state is never journal
authority; a run/task resume command does not itself restart work; grouping
pause follows only parent-to-descendant grouping edges; a foreign or unreadable
claim cannot authorize reacquisition; pre-promotion blockers prevent
promotion; post-promotion blockers never roll Git back; an atomic promotion
uses the expected old target; and a replaced session cannot accept a stale
predecessor result.

**Witnesses.** Retain witnesses for all eight boundaries, authorized retry,
crash/restart, task and run pause/resume, interrupted and resumed invocation,
capacity wait and release, local isolation and repair, external completion,
pre- and post-promotion blocker behavior, target advance/rewrite, lost
worktree, unavailable/replaced session, atomic promotion race, task-specification
change hold and each accepted operator disposition, target removal/return,
close/reopen, and independent-branch progress during every local constraint.

**Expected counterexamples.** Retain missing-intent, duplicate-effect, and
stale-observation counterexamples. Add weakened transitions for persisted
frontier authority, resume-without-reread, grouping pause crossing a dependency
edge, silent claim reacquisition, stale expected-target promotion, stale
predecessor session result, and local-to-global isolation. The checking script
must require the expected invariant failure so an accidentally safe weakened
profile also fails CI.

**Checking profiles.**

- deterministic scenarios for readable accepted behavior;
- sampled construction profiles with recorded seeds and witnesses;
- TLC exhaustive profiles for all boundaries, all-boundary crash, run pause,
  active-invocation task/grouping pause, capacity one, graph-knowledge
  conflicts, task/Git/provider reconciliation, and selected two-constraint
  combinations; and
- Quint-connect sampled conformance against implementation seams.

No result may call a random simulation exhaustive. Each report names the
initializer, step relation, finite bounds, backend, generated/distinct states
or sample count, maximum graph depth, and seed where applicable.

**Implementation consumers.** The composed graph-knowledge, workflow-history,
responsibility, and pause reducers; pure runnable-frontier derivation;
deterministic admission/capacity controller; control-command handling;
continuation reads; recovery activation; tracker, Git, task-runner, integration,
completion-claim, and disposition protocols; in-memory scenario tests; SQLite
startup reopening; and workflow-trace projection.

**Maintainer.** The `packages/orchestrator` control-plane/domain maintainer.
The same maintainer owns the shared abstraction contract below.

## Shared ambiguity-boundary abstraction contract

M1 and M2 intentionally overlap at session establishment. The overlap is
governed by **`AmbiguityBoundaryV1`**, a specification-level contract, rather
than copied field names.

For one boundary subject it contains:

```text
subject
operation identity
immutable request fingerprint
causal predecessors
intent committed?
request attempts and returned acknowledgements/failures
fresh check requests and normalized observations
authority effect identities
outcome or exact nonterminal disposition
authority revision/freshness evidence
```

Its rules are:

1. Dalph records intent before asking the named external boundary to change
   state.
2. A request attempt and every fresh result check retain the intent's identity
   and immutable request fingerprint.
3. After coordinator activation changes, pre-crash authority knowledge cannot
   authorize another state-changing request.
4. Only the boundary-specific fresh observation can prove applied,
   not-applied, conflict, unreadability, or a terminal result.
5. An observation proving not-applied may authorize the same request only
   under the boundary's named bounded policy.
6. The terminal outcome or nonterminal disposition records its exact subject;
   it does not settle a later boundary or the whole task.

M1 refines the `SessionBoundary` instance. M2 composes the abstract instance
with seven other boundaries. The adapters must expose a projection from M1
state and implementation state to `AmbiguityBoundaryV1`; the same generated
session trace must produce equal projections in both models. A changed
projection version requires an explicit migration of both models and adapters.

## Executable adapter contract

### One adapter shape

Each model exports a closed action schema. A TypeScript `defineDriver` maps
every generated action to one public deterministic control that invokes the
production workflow algebra or its pure reducer. The driver must not implement
a second scheduler, decide an expected next action, edit private module state,
or infer an external effect from a trace string.

After each action, `stateCheck` compares:

- the model's `AmbiguityBoundaryV1`/frontier projection;
- reconstructed graph knowledge, workflow responsibility, and pause state;
- the non-persisted runnable-frontier/admission projection;
- the named boundary authority projection from the controlled adapter; and
- the ordered semantic workflow trace.

Generated identifiers use a deterministic bijection from bounded Quint values
to branded Dalph values. The mapping is centralized and round-tripped through
Effect Schema. Unknown action tags, missing mappings, duplicate branded values,
or projection loss fail the test before executing a boundary.

### M1 action mapping

| Quint action | Production-facing action |
| --- | --- |
| `selectIdentity` | Construct one `EstablishTaskWorkSession` workflow operation with fixed plan/worktree predecessors. |
| `commitIntent` | Invoke `WorkflowInterpreter.establishTaskWorkSession` and stop it after the journal acknowledges the exact intent. |
| `requestCreatesSession` / `requestCreatesNothing` | Release the controlled `TaskRunner.requestTaskWorkStart`; the controlled provider applies or does not apply the exact request. |
| `lookupMatching` / `lookupAbsent` / `lookupUnreadable` / `lookupConflict` | Supply the corresponding normalized `TaskRunner.lookupTaskWorkSession` result or typed failure. |
| `recordLookup` | Let the journaled observer append the lookup request plus report/failure and let the production recovery decision consume it. |
| `recordOutcome` | Let the journaled interpreter append `TaskWorkSessionEstablished`. |
| `crash` | Interrupt the complete coordinator scope; do not mutate the journal or provider projection. |
| `restart` | Create a fresh application/recovery scope over the selected store and invoke startup recovery for the exact run. |

The existing driver is useful prior art, but restart currently reuses local
test projections and an ad hoc journal. Promotion requires the fresh-scope
behavior above.

### M2 action mapping

| Quint action family | Shared workflow-algebra or authority control |
| --- | --- |
| `commitFirstIntent` | Run pure frontier/admission selection, then append the exact first `AcquireTaskClaim` intent; observing a task alone cannot call this control. |
| `commitResponsibleIntent` | Run the same selector for an existing exact responsibility, then append the selected operation intent. |
| `requestApplies` / `requestChangesNothing` | Release the controlled tracker, Git, or task-runner boundary selected by the current `WorkflowOperation`; record a boundary audit under its operation identity. |
| `observeTask` | Return a normalized tracker/Git/task-runner result with declared coverage and freshness and append the accepted observation event. |
| `authorizeRetry` / `recordBoundaryOutcome` | Invoke the production boundary-specific recovery decision and the shared journaled interpreter; the driver cannot set authorization itself. |
| `crash` / `restart` | Close every process-local fiber/layer, then reconstruct and observe through `recoverExactRunAfterCoordinatorDeath` before running the ordinary selector. |
| run/task pause and resume | Submit one branded control command through the public control boundary; reducer-derived phases and safe-boundary actions are observed, not assigned by the driver. |
| provider completion/interruption | Advance the controlled task-work provider, then require a fresh task-execution observation before capacity is released. |
| tracker/Git/session external changes | Change only the controlled authority owned by that boundary, run the named continuation read, and compare the resulting constraint/disposition. |
| repair/clear isolation | Change the owning authority, perform a new accepted read, and let the ordinary selector decide whether the exact isolation can clear. |
| external completion | Change tracker lifecycle, reread it, and let production responsibility settlement avoid duplicate Git/tracker effects. |

Until the accepted reducers and control boundary exist, the missing M2 action
mapping is an explicit implementation blocker. Tests must not reach into future
reducer internals merely to make the model appear connected.

## Recovery-prefix and production-reopening matrix

### Prefix generation rule

The model adapter generates legal operation chains. A prefix enumerator then
truncates each chain after **every durable journal event**, including every
intent and durable control command. It does not truncate only at the four
abstract model states. `WorkflowJournalEvent` and its descriptor/validation
algebra are the source of durable-event membership; a hand-maintained list may
label cells but cannot silently omit a new event kind.

For each of the eight boundary operations, generate every legal applicable
prefix:

| Prefix class | Durable endpoint | Required restart assertion |
| --- | --- | --- |
| P0 | Previous boundary outcome; next choice exists only in process memory | Recompute the uncommitted choice from fresh facts; do not preserve its lost identity. |
| P1 | Exact operation intent | Reconstruct the exact responsibility and identity; fresh-check before a repeat when the boundary may already have been crossed. |
| P2 | Exact request-attempt/start-request event, where the protocol records one | Observe the named boundary before repeating; never infer non-application from missing acknowledgement. |
| P3 | Request acknowledgement or typed request failure | Treat it as managed history, not current authority; perform the required fresh result check. |
| P4 | Fresh-check/read intent | Repeat or complete only that read under its bounded policy; do not send a state-changing request. |
| P5 | Fresh normalized observation, lookup failure, report, or authority constraint | Apply the production decision from that evidence; do not reread merely to obtain a preferred answer. |
| P6 | Boundary outcome or exact nonterminal disposition | Select only causally later work; replay is idempotent and preserves subject-specific finality. |

Not every protocol has every P2–P5 event. A cell is `N/A` only when the
canonical event algebra proves the phase does not exist. The coverage manifest
records the reason.

Run every prefix through two independent seams:

1. **In-memory recovery.** Close the running coordinator scope, retain only the
   `memoryJournalStoreLayer` records and controlled external authorities,
   create a fresh coordinator/application scope, and call startup recovery.
   Test-only model projections are discarded and reconstructed.
2. **SQLite production reopening.** Close the scoped SQLite layer and every
   coordinator fiber, open a new `sqliteJournalStoreLayer` over the same file
   with migrations and exclusive writer acquisition, then run the same
   production recovery and authority reads. No test may pass a pre-reduced
   state across the reopen.

Both seams compare the same semantic trace and final authority projection.
SQLite adds assertions for physical reopen, decode/upcast, canonical position
order, idempotent append, and fail-closed corruption/lock behavior. The
in-memory lane is not evidence for those SQLite facts.

### Boundary ownership matrix

`M2` owns the composition row for every boundary. `M1` additionally owns the
deep `SessionBoundary` row.

| Boundary | Intent/effect/observation being reopened | Owning model | Required implementation consumers |
| --- | --- | --- | --- |
| Claim | Create the exact tracker claim; reread exact owner/token and current eligibility. | M2 | Claim protocol, tracker adapter, graph-knowledge reducer, admission controller. |
| Worktree | Create or rediscover exact branch/path/Base; reread Git registration, `HEAD`, and ancestry. | M2 | Git reconciliation, plan evidence, startup recovery. |
| Session | Create or rediscover exact provider session; reread complete correlation evidence. | M1 + M2 through `AmbiguityBoundaryV1` | Task runner, provider adapter, journaled interpreter, recovery decision. |
| Invocation | Start/resume/interrupt exact worker; reread the exact session/process result. | M2 | Execution protocol, scoped capacity, pause safe boundary. |
| Promotion | Atomically advance exact target ref from expected old head; reread target and candidate ancestry. | M2 | Serialized integration protocol, Git adapter. |
| Completion claim | Replace exact active claim with completion claim bound to revision and promotion. | M2 | Tracker completion protocol and claim adapter. |
| Tracker completion | Ask tracker to complete; reread successful lifecycle and dependency facts. | M2 | Tracker adapter, graph knowledge, dependant frontier. |
| Completion-claim deletion | Delete only exact completion claim after confirmed success; reread claim record. | M2 | Tracker adapter and responsibility settlement. |

## Accepted-use-case and invariant coverage matrix

`E` means a named exhaustive finite profile is required, `S` a sampled
Quint-connect conformance profile, `P` every applicable P0–P6 prefix through
both stores, and `R` at least one selected readable scenario plus user
evaluation. A checkmark in “current evidence” means the checked artifact
already provides meaningful evidence; it does not waive the missing lanes.

| Accepted use case or property | Owner | Required lanes | Current evidence and promotion gap |
| --- | --- | --- | --- |
| Separate external authority, durable knowledge, workflow history, responsibility, pause, frontier, and capacity | M2 | E, S, P | Prototype separates the records; implementation reducer/adapter is missing. |
| Usage-shaped graph coverage, complete absence, mixed-time reads, and local incomparable conflicts | M2 | E, S, P, R | Canonical docs/ADRs accept it; prototype models coarse per-task readability and must gain partial-region/conflict profiles. |
| Deterministic fresh admission and capacity-one/two behavior | M2 | E, S, P, R | Prototype checks deterministic first admission and capacity two; add capacity-one responsibility-first cases. |
| No effect without intent; no duplicate effect; stable retry identity; no stale authority use | M1 + M2 | E, S, P | Both safe models cover core rules; M1 needs explicit negative profiles and both need full prefix adapters. |
| All eight ambiguity-crossing boundaries and subject-specific finality | M2 | E, S, P | Prototype exhausts focused abstract boundary profiles; executable mappings are missing for seven boundaries. |
| Crash before intent and after every legal durable event | M1 + M2 | E, S, P | Session SQLite matrix covers selected session events; complete descriptor-driven matrix is missing. |
| Whole-run pause, passive paused restart, and run resume with fresh reads | M2 | E, S, P, R | Prototype has run pause/resume scenario; safe-boundary and reopening combinations are missing. |
| One-task pause, long-running interruption, capacity release, and same-session resume | M2 | E, S, P, R | Prototype covers one running invocation; production adapter and all accepted invocation kinds are missing. |
| Grouping-descendant coverage without copying pause state or reversing dependency edges | M2 | E, S, P, R | Prototype covers `A -> D`; add graph-change-during-pause and dependency-edge counterexample profiles. |
| Pause during bounded tracker/Git/provider request | M2 | E, S, P, R | Accepted architecture exists; prototype must initialize each in-flight boundary and show settle/reconcile before pause. |
| Pause during evidence sealing, review/handback, integration, tracker completion, and cleanup | M2 | S, P, R | Broad model may keep these as boundary classes; adapter scenarios must exercise each accepted safe boundary. |
| Resume while pausing | M2 | E, S, P, R | Add a profile where resume changes requested direction but cannot cancel the in-flight interruption/result check. |
| Task-specification edit combined with pause or session replacement | M2 | E, S, P, R | Accepted #120 behavior is not in prototype; add hold/stop/override/restart actions and selected combinations. |
| Task closes and reopens with WIP preserved | M2 | E, S, P, R | Prototype has coarse closed isolation only; add reversible lifecycle hold and same-attempt resume. |
| Tracker reports external success | M2 | E, S, P, R | Prototype scenario settles without duplicate completion; add claim cleanup and resource responsibility prefixes. |
| Claim missing/replaced/foreign/unreadable; no silent reacquisition | M2 | E, S, P, R | Prototype covers loss and bounded unreadability coarsely; add explicit reacquisition-command and unreadable-running constraints. |
| Target membership removal and return | M2 | E, S, P, R | Prototype has membership isolation type but no deterministic/checked profile. |
| Blocker appears before promotion | M2 | E, S, P, R | Prototype blocks fresh `C`; extend to a responsible integration candidate releasing the serialized resource. |
| Blocker appears after promotion | M2 | E, S, P, R | Missing; prove no Git rollback/reintegration and delayed tracker completion. |
| Compatible target advance and incompatible rewrite | M2 | E, S, P, R | Prototype has both; add expected-old-head production promotion race. |
| Lost/mismatched worktree | M2 | E, S, P, R | Prototype records attempt-worktree-lost; add exact Git observation and operator restart/stop cases. |
| Native session unavailable, temporary unreadability, explicit successor session, and stale predecessor result | M1 deep correlation + M2 lifecycle | E, S, P, R | M1 distinguishes missing/unreadable/conflict but excludes replacement; M2 must compose explicit successor lifecycle. |
| Atomic promotion race | M2 | E, S, P, R | Missing from prototype; controlled Git must advance the target between verification and compare-and-set. |
| Local constraint does not stop unrelated `C` | M2 | E, S, P, R | Checked for pause and several isolations; require it for every new constraint and selected pair. |
| Run completion requires fresh tracker success plus settled work/resources | M2 | E, S, P, R | Prototype checks per-task settlement only; add complete-run witness and empty-frontier non-completion counterexample. |

An accepted use case cannot be marked covered merely because a prose scenario
exists. Its matrix row is complete only when every required lane has an
artifact identifier and passing evidence. Intentional omissions, such as
provider-internal review transcripts, must name the owning abstraction
boundary rather than leave a blank cell.

## Trace selection and readable scenarios

### Selection without exhaustive noise or happy-path picking

Keep exhaustive verification and implementation replay separate. TLC explores
the complete named finite profiles. Quint-connect replays a deterministic
sample selected by this procedure:

1. Export candidate simulation and counterexample traces in
   [ITF](https://apalache-mc.org/docs/adr/015adr-trace.html) with action tags
   and full model states. Record model commit, profile, bounds, seed, backend,
   and tool versions. Quint witness reporting counts reachability but does not
   return the reaching trace, so obtain a concrete witness trace by checking
   the negated witness as an invariant, as described in Quint's
   [property-checking guidance](https://quint.sh/docs/checking-properties).
2. Project each trace to a semantic signature:
   `(model, boundary, prefix class, crash/control point, authority-change
   dimensions, constraint count, final disposition, invariant/witness bins)`.
3. Retain every shortest counterexample, every unique terminal/nonterminal
   disposition, and every sole witness for a required matrix bin.
4. Apply deterministic greedy set cover to the remaining required bins.
   Break ties by shorter durable trace, then canonical action sequence, then
   trace SHA-256. Add a bounded seeded reservoir from each profile to detect
   selection bias.
5. Reject a selection if any required matrix bin is empty or if more than half
   of the sample consists of uninterrupted success while uncovered fault bins
   remain. Record excluded duplicates and their covered-by trace hash.

The selection manifest is reviewed like source. Changing a seed does not
silently replace failing traces: previously selected regression traces remain
until a reviewer records why their semantic bin is redundant or no longer
legal.

Pin the Quint and adapter versions in the lockfile and record the output of
that version's `quint <command> --help` in the generation manifest. Published
CLI documentation and current source can differ, and Quint exposes no general
predicate for filtering arbitrary emitted traces. Dalph therefore performs
semantic-signature filtering after export rather than depending on an
unversioned CLI feature. Exact named Quint tests use an anchored match such as
`--match '^scenarioNameTest$'`.

### Conversion and filtering

Selected traces are converted to paired machine/readable assets under:

```text
specs/model-scenarios/<model>/<scenario-id>.json
specs/model-scenarios/<model>/<scenario-id>.md
specs/model-scenarios/selection-manifest.json
```

The JSON retains source trace hash, action/state projection, durable prefixes,
authority facts, expected boundary operations, and final disposition. The
Markdown states:

- the concrete actor, action, and boundary before canonical shorthand;
- initial facts and what each external application owns;
- the user's command or external change;
- what Dalph visibly does and preserves;
- the next action, wait condition, or disposition;
- facts Dalph explicitly does not know; and
- the common-sense question presented to evaluators.

Mechanical simulator stutter, map ordering, and provider-private fields may be
filtered from prose. Durable intents, fresh reads, user commands, capacity
effects, preserved resources, uncertainty, and dispositions may not be
filtered. The converter validates that the prose asset references every
durable prefix and user-visible consequence in its JSON companion.

A human maintainer vets each new or changed scenario for legal model
provenance, canonical terms, faithful actor/boundary wording, plausible user
context, and absence of leaked expected judgment. Generated prose is never
self-approving.

## Simulated intelligent-user evaluation

The purpose is to detect formally safe behavior that surprises an ordinary
Dalph user. It is not another model checker and cannot redefine the expected
result.

For each selected main-path scenario and every corner-case scenario with a
pause, preserved WIP, external change, isolation, wait, or disposition:

1. Give at least three fresh simulated evaluators only the user-facing
   scenario, observable Dalph behavior, and a short neutral description of
   Dalph's role. Do not give them the invariant names or canonical expected
   verdict.
2. Ask each evaluator whether the behavior is expected, surprising but
   acceptable, or unacceptable; what they expected instead; which visible
   fact caused the judgment; what data/work they believe is preserved; and
   their confidence.
3. Use an ordinary operator perspective, a cautious operator concerned about
   lost/duplicated work, and a maintainer diagnosing recovery. These are
   evaluation lenses, not invented authorization roles.
4. Require human review for any unacceptable verdict, evaluator disagreement,
   low-confidence majority, or assertion that work/claims/resources were
   silently lost, duplicated, resumed, or released.

Store an append-only evaluation record at
`specs/model-scenarios/evaluations/<scenario-id>/<evaluation-id>.json` with:

- scenario and source-trace hashes;
- evaluator provider/model/version, prompt-template hash, sampling parameters,
  run time, and independent-run identifier;
- exact input and output;
- normalized verdict, confidence, expected alternative, preservation belief,
  surprise category, and cited visible facts; and
- human reviewer disposition, rationale, and links to any specification/model
  change.

Do not average verdicts into a passing score. A single credible
data-loss/duplicate-effect surprise blocks that scenario until reviewed.
Non-deterministic evaluators cannot be an implementation gate by themselves;
the durable reviewed disposition is the gate evidence.

### Failure feedback

A failed common-sense evaluation creates a recorded finding against exactly
one of:

- scenario conversion omitted or distorted a fact;
- implementation/model adapter diverged;
- model abstraction hid a user-visible phenomenon;
- canonical specification permits surprising behavior and needs a policy
  decision;
- presentation is misleading while behavior is correct; or
- evaluator assumption is outside Dalph's declared role.

The reviewer records evidence before changing an expected result. If behavior
changes, the owning canonical specification changes first or in the same
dependency path, followed by the model, abstraction adapter, selected traces,
readable scenario, in-memory prefixes, SQLite prefixes, and evaluation. If the
finding is rejected, the record states the concrete boundary fact or accepted
decision that makes the alternative invalid. Editing the scenario's expected
verdict alone is forbidden.

## Conformance and change obligations

Each CI result publishes a manifest mapping:

```text
accepted requirement -> model property/action -> checking profile
-> selected trace/scenario -> adapter action -> implementation test
-> in-memory prefix -> SQLite prefix -> reviewed user evaluation (when required)
```

The following changes are atomic obligations:

- A canonical behavior change updates its model, executable adapter projection,
  affected selected traces/readable scenarios, and both recovery seams.
- A new workflow operation or durable journal event updates the closed adapter
  action/event maps and the descriptor-driven prefix manifest; compile-time or
  test-time exhaustiveness must fail while it is unmapped.
- A changed authority result, revision rule, retry bound, capacity rule, or
  disposition updates its model bound/property and negative profile.
- A model refactor that claims no behavior change must replay the retained
  regression traces and prove the old/new semantic projections equal.
- A storage migration or journal upcaster change reruns every affected SQLite
  prefix from the oldest supported event version; model conformance alone
  cannot qualify physical reopening.

Implementation tests may add stronger adapter-specific facts. They may not
weaken or replace the shared semantic comparison. Target repositories'
application-specific typechecks, model checks, or MBT remain outside Dalph's
implementation gate.

## Conditional complete-history arbitrary generator

**Decision: defer the broader arbitrary generator for complete legal attempt
histories. Do not build it before the two adapters and required prefix matrix.**

Today it would duplicate the model adapter as a second generator of expected
workflow legality while the larger known gap is that M2 has no executable
adapter. Quint already generates legal transition interleavings, and the prefix
enumerator covers every durable truncation of selected chains. Existing
property tests cover lower-level journal/store and recovery-stage laws.

Reconsider one complete-history arbitrary only after the required matrix passes
and a recorded gap audit finds at least one of:

- a legal journal-history shape involving event versions, evidence/review
  rounds, technical retry schedules, or multiple simultaneous responsibilities
  that neither canonical model can reach without destroying its abstraction;
- a reducer/history-validation branch not reachable through any model action
  or selected prefix;
- a mutation-testing survivor caused by ordering or cross-subject causal
  structure rather than missing examples; or
- an implementation consumer whose legal inputs are complete histories rather
  than workflow actions and whose laws cannot be tested through the adapter.

If admitted, the arbitrary generates schema-valid, causally legal event
histories from the canonical event descriptor and validates them with the
production total history reducer. It does not embed a parallel expected
scheduler. Shrunk failures become retained readable/model scenarios when their
phenomenon belongs in a model; otherwise the audit records why the history-only
case remains a property test.

## Graduation gates

### Specification synthesis gate

Issue #124 may not close synthesis until:

- both model names, questions, paths, bounds, properties, profiles,
  maintainers, and `AmbiguityBoundaryV1` are canonical;
- M2's accepted #120 actions and combinations are added or each remaining
  abstraction is explicitly mapped to an executable scenario obligation;
- both closed action schemas and state projections are specified at the public
  workflow-algebra boundary;
- the descriptor-driven prefix classes, trace selection manifest, readable
  scenario format, evaluation record, and failure-feedback rule are accepted;
  and
- every accepted use-case matrix row has an owner and no unexplained gap.

### Implementation-ticket gate

Issue #126 and later implementation slices may graduate only when each ticket:

- links its acceptance scenarios to one owning model action/property;
- names the exact adapter action and public production seam it implements;
- declares its in-memory and SQLite P0–P6 cells and blocking predecessors;
- preserves selected readable scenarios and applicable reviewed user
  evaluations;
- updates model/adapter/scenarios/reopening together when behavior changes; and
- keeps formal exhaustive evidence, sampled implementation conformance, and
  production-adapter qualification as distinct claims.

### Handoff gate

Before an implementation handoff, run the focused Quint profiles, both
Quint-connect suites, every affected in-memory and SQLite prefix, scenario
conversion validation, affected reviewed evaluations, and `pnpm check:all`.
Then repeat domain/spec, architecture/connascence, and strict code-review
passes. A ticket is not complete while a reasonable finding is merely hidden
by changing a selected trace, seed, or expected user verdict.

## Remaining bounded uncertainties

- Issue #120's detailed resolution is accepted in its issue comment, while its
  referenced `research/reconciliation-external-boundary-capabilities.md` is not
  present on the audited `master` commit. Specification synthesis must place
  that accepted behavior in canonical repository artifacts before M2 promotion.
- The exact future TypeScript names for the composed reducers and public
  control-command boundary do not exist. This document specifies their
  behavioral adapter seam without inventing implementation modules.
- The checked frontier prototype used Quint 0.32.0 with TLC. Its recorded
  limitation that TLC ignores Quint's trace-depth flag means promotion must
  continue reporting observed complete graph depth, not a claimed CLI depth
  bound.
- Simulated-user evaluator providers and versions are operational choices.
  The durable input/output/review schema and the rule that evaluations cannot
  silently rewrite expected behavior are specification obligations.
