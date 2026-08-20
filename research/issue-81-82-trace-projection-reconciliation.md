# Issues #81 and #82 trace-projection reconciliation

Status: research input for refreshing [issue #81](https://github.com/dearlordylord/dalph/issues/81)
and [issue #82](https://github.com/dearlordylord/dalph/issues/82). It changes no
Dalph runtime behavior. Evidence was checked on 2026-08-20 at master
`8415e1b81e08759d8f925af329c1a0b397b97efe`.

Lifecycle: this is temporary research evidence, not accepted architecture.
Issue #82 owns deleting this file after its implementation has incorporated
the reconciled conclusions into the accepted issue, production schema, and
scenario-to-test evidence.

## Conclusion

Both tickets can become implementation frontiers after the tracker records
#80 complete. Their other declared blockers are closed. The current issue
bodies should not be implemented as written:

- #81 should present exact committed observation gaps, retained
  responsibilities, waits, and preservation dispositions at one historical
  cursor. It should not expose the runnable recovery frontier or use
  “archival state” as a generic Dalph phenomenon.
- #82 should present the durable integration responsibility, outer Integrator
  session and result, Git qualification, promotion, tracker completion, claim
  cleanup, and settlement. It must delete the old requirement for distinct
  “integration review” and “implementation review” families: both are
  implementation-private under the current executor and Integrator
  boundaries.

The two tickets remain conceptually independent children of #80, but they
touch the same closed occurrence union, trace schema, reader, console surface,
and Reducer Lab consumer. Parallel implementation therefore needs explicit
file ownership or an agreed integration order and schema-version handoff; the
GitHub dependency graph alone does not prevent merge conflict.

## Current authority to retain

The production reader merged in `8415e1b81` already supplies the shared
foundation:

- `packages/orchestrator/src/presentation/trace-reader.ts` reads only the
  committed `JournalReadSource`, validates one contiguous Run prefix, and
  returns schema-versioned history at exact `(RunId, JournalPosition)`
  identities.
- It keeps task-graph edges, workflow `OperationId` predecessors,
  outside-authority acknowledgements, and process-local integration
  serialization as distinct relationships.
- `TracePresentation` places a passive current-status signal beside a fixed
  historical cursor without making that signal history or authority.
- `prototypes/reducer-lab/src/trace-cursor-selection.ts` stores only exact
  production cursors and auxiliary cassette/current correlations; it does not
  fold another history.

These facts implement the accepted #80 scenarios and are directly exercised
by `packages/orchestrator/src/presentation/trace-reader.test.ts`, including
“moves Alice through journal positions…”, “keeps process-local integration
serialization separate…”, the in-memory/SQLite output-loss replay, and the
fixed-history/current-status tests. The child tickets should extend this
surface, not build another reader, identity, event family, reducer, or Lab
timeline. See `docs/CONTEXT.md` under **Production trace read**, **Trace
position identity**, **Graph at cursor**, **Causal predecessor lookup**, and
**Read-only trace source**; see also `docs/ARCHITECTURE.md` under **Workflow
Commands, Actions, Occurrences, and Events**.

Presentation must remain narrower than delivery reconstruction. The existing
`RunRecoveryProjection` in
`packages/orchestrator/src/coordination/run/recovery-activation.ts` includes a
`RunnableFrontier` containing executable transitions and samples current
process-local integration resources and configuration. Giving it to a trace
consumer would violate #80's read-capability boundary. A historical child
projection may reuse pure prefix reducers, but it must return descriptions and
exact source identities only—never `RunnableFrontierTransition`, controllers,
admission resources, or mutation services.

### Boundary with #217 current status

[Issue #217](https://github.com/dearlordylord/dalph/issues/217) owns the exact
current reason a Run or task is progressing, waiting, blocked, settled, or
relinquished. It derives that answer from one coherent current delivery
evaluation and process-local live-owner observations, attaches current-first,
and discards those observations on process loss. #81 and #82 instead own what
the committed Journal prefix proves at the selected historical cursor.

Therefore a child trace facet may say “at J, promotion attempt 2 had no later
Git observation in this prefix” or “at J, session S had no recorded outer
result.” It must not claim “the Run is currently waiting for Git,” show current
capacity holders or live owners, or derive a current wake-up reason from old
history. Presentation may compose #217 beside the historical facets through
the existing `TracePresentation` boundary, but #217 status must remain
separately labeled, may be unavailable or reconnect, and cannot move the
historical cursor. This separation also prevents #81's historical gap and
#82's historical integration state from absorbing #217 while #217 remains
blocked by open #3.

## Stale and superseded issue text

All three implementation references currently shared by #81 and #82 are
stale:

| Issue reference | Current fact |
| --- | --- |
| `docs/BOUNDED-RESUMABLE-GRAPH-FRONTIER.md` | Removed; #80 already identifies it as historical. |
| `research/resumable-frontier-architecture-decision.md` at `154d8e85…` | Removed by `4e2167602` (“remove superseded plans and research”). Research is not accepted behavior authority in any case (`research/README.md`). |
| `docs/adr/0010-govern-recovery-with-two-quint-models.md` | Removed with the old two-model recovery design. The current file is `docs/adr/0010-govern-subject-scoped-quint-models.md`. |

Replace those links with `docs/OPERATIONAL-SCENARIOS.md`, `docs/CONTEXT.md`,
`docs/ARCHITECTURE.md`,
`docs/architecture/journal-and-reconstruction.md`,
`docs/architecture/attempt-delivery-and-integration.md`, and the concrete
scenario sources cited below. The P0–P6 warning is still true but no longer
needs the old instruction to update every SQLite lane. Current #142 authority
is a representative seven-cut memory/SQLite completion chronology plus a
closed recovery-prefix manifest; it explicitly rejects inventing runtime
P0–P6 vocabulary or claiming one tracer covers every boundary
(`docs/scenarios/issue-142-qualify-recovery-prefix-harness.md`).

## #81: recovery presentation

### Canonical phenomena

Use concrete current terms rather than one generic “recovery state”:

- **Workflow-journal history reduction** validates the committed prefix and
  reconstructs exact responsibilities and durable graph knowledge.
- **Reconstructed run state** is process-local descriptive state derived from
  that prefix, not persisted authority.
- An **observation gap** should mean a named durable intent/action at or before
  the cursor for which the prefix has no matching conclusive observation. It
  must retain the exact `OperationId`, subject identities, and intent
  `TraceItemIdentity`; absence of an observation is not proof that the outside
  request failed.
- A historical **protocol disposition** names the concrete observation absent
  from that prefix and the accepted reconciliation rule. A view can explain
  “the accepted protocol requires a Git read before another request” without
  claiming the Run is currently waiting, authorizing that read, or absorbing
  #217's current-status ownership.
- **Non-convergence**, **integration quarantine**, **retained responsibility**,
  and an exact **cleanup responsibility** are distinct preservation
  dispositions. There is no current generic “archival state” or Archive
  operation. “Preserved evidence/resources awaiting the named protocol or
  Operator direction” is the truthful replacement.
- Process death creates no crash occurrence. A
  `PlannedAttemptContinuationAuthorized` record is deliberately an internal
  reconstruction witness and not a projected recovery occurrence
  (`docs/architecture/journal-and-reconstruction.md`; ADR 0012).

The closed `WorkflowOccurrence` currently projects tracker/Git read actions
and observations, executor responsibility/reports, attempt choices,
replacement, controls, integration responsibility, and integration start. It
does not project every journal event. For example, #80's test deliberately
uses a task-claim acquisition intent as an unprojected causal predecessor.
Before #81 implementation, the accepted issue must decide which concrete
intent/result families need to become occurrences to make its scenarios
visible. Each added variant needs an explicit action/non-action classification
and actor when applicable; presentation may not infer those from an event tag.

### Proposed chronological scenarios

#### Alice inspects an outside request whose result is not yet recorded

Run R's prefix contains an acknowledged exact intent/action O for task A and
no conclusive matching observation by cursor J. Alice opens J. Dalph reads and
validates only the committed prefix, shows O at its exact position, and shows
one explicit gap naming the owning boundary and the observation needed by the
accepted reconciliation protocol. Alice advances to J2 after the tracker,
Git, or executor observation was durably recorded; J2 shows the exact result
and relationship while J remains unchanged.

No boundary call, crash event, or retry is produced by viewing either cursor.
The view must not call the owning system, claim that the original request
failed, choose a retry, expose a runnable transition, or turn a missing
observation into authority.

#### Alice inspects the same retained attempt before and after process loss

At cursor J, R contains one immutable planned attempt and its executor-work
responsibility but no safe or terminal report. Dalph's process later dies.
After restart Alice reopens J and receives the same attempt, responsibility,
and exact trace identities. At a later cursor she may see the current tracker
reads, exact worktree read, continuation authorization's consequences, and
later executor report that ordinary activation recorded, but the view neither
invents a crash occurrence nor labels continuation authorization as a
production occurrence. Separately supplied current status may say unavailable
or describe current waiting without moving J.

The view must not allocate another attempt, restore an old process-local
position map, contact the executor, or treat missing current executor state as
safe suspension. The accepted chronology is
`docs/architecture/journal-and-reconstruction.md` and the concrete maintained
reopening evidence includes “reconstructs the same Run and attempt after typed
cassette death before executor contact” in
`packages/dalph/test/cassettes/scenario.test.ts`.

#### Alice sees preserved work instead of a generic archive

At cursor J, one exact protocol has reached a durable preservation result—for
example promotion non-convergence after three ambiguous attempts, an
Integrator quarantine, or successful task work with completion-claim cleanup
still unresolved. Alice sees the specific disposition, exact retained
candidate/session/claim/evidence identities that its journal facts prove, and
the concrete fact or Operator direction required for later progress. A later
cursor may show reconciliation or settlement; J remains fixed.

The view must not call preserved material “discarded” or “archived,” imply a
fourth promotion attempt, select Retry or Full rerun, delete a resource, infer
settlement, or stop unrelated work. Current source scenarios are
`docs/scenarios/issue-68-recover-or-quarantine-integration-session.md`,
`docs/scenarios/issue-141-integration-finality.md`, and
`docs/scenarios/issue-223-migrate-promotion-and-finality.md`.

### Scenario-to-test seams

| Scenario | Required new presentation evidence | Existing protocol evidence to retain |
| --- | --- | --- |
| Intent without observation | `shows Alice the exact committed intent and missing owning-authority observation without authorizing reconciliation`; negative capability test proves zero Journal/provider mutation services | Trace prefix/causal tests; ambiguity-specific protocol tests such as target promotion “reads before retrying… and never sends a fourth attempt” |
| Same attempt after process loss | memory and SQLite test: `reopens the same recovery explanation and trace identities without a crash occurrence or replacement attempt`; fixed passive-status test | `reconstructs the same Run and attempt after typed cassette death before executor contact`; continuation-witness rejection tests |
| Preserved exact work | `distinguishes quarantine non-convergence and cleanup wait without a generic archive state`; cursor test proves later settlement cannot rewrite the earlier disposition | quarantine reconstruction, promotion non-convergence, and completion-cleanup reopening tests named in the scenario files |

Each test must assert exact source `TraceItemIdentity`/`OperationId` links and
the absence of mutation capability. Aggregate reducer output or a generic
“Waiting” label is insufficient.

## #82: integration presentation

### Canonical phenomena

The accepted outer-Integrator migration (#222, #223, and removal commit
`c9eac6b71`) supersedes the issue's old stage list:

1. The executor reports one exact Accepted result C for its planned attempt.
   Executor-internal implementation/review stages are opaque.
2. Dalph records one **integration responsibility**; its journal position
   supplies same-target FIFO order. A “queue” is a derived view over these
   positions, not a persisted queue row.
3. Dalph records **integration start**, fixes one outer **Integrator session**
   to expected target H, C, and an isolated candidate resource, then records
   one exact Integrator run and its result.
4. The Integrator privately owns merge construction, repository checks,
   review, provider turns, and technical retries. Generic Dalph sees only
   PreparedCandidate M or conclusive NotPrepared.
5. Dalph's separate Git observation qualifies only explicitly reported M with
   ordered direct parents exactly `[H, C]`.
6. The exact promotion protocol records intent, numbered attempts, and Git
   success, stale, or non-convergence evidence. Promotion is not tracker
   completion.
7. Focused tracker completion, completion-claim replacement/deletion, and
   `IntegrationFinalitySettled` remain distinct later facts. A later complete
   graph observation releases dependants; whole-Run termination belongs to
   #102.

The current pure projectors already keep these phenomena separate:
`deriveIntegrationAdmission`, `deriveCurrentIntegratorState`,
`deriveIntegrationQuarantineState`, `deriveTargetPromotionState`, and
`deriveIntegrationFinalityStateFor`. They are useful read-side sources over a
validated prefix, but their values must be adapted into a schema-versioned
trace facet with exact source identities. They must not be exposed as mutation
authorization or collapse the owning authority distinctions.

The #82 criterion “Integration review and implementation review are distinct
actor/state families” should be replaced with:

> The planned-attempt executor Accepted result and the outer Integrator result
> remain distinct exact correlations. Executor-private and Integrator-private
> review or repository-check stages are not generic Dalph occurrences or
> presentation states.

### Proposed chronological scenarios

#### Alice follows one result from integration responsibility to qualified candidate

Run R contains executor Accepted result C, integration responsibility Q at
position Jq, integration start Js, fixed session S against H, an Integrator run
and PreparedCandidate M, and Git's later observation proving direct parents
`[H, C]`. Another same-target responsibility Q2 was recorded later; a different
target may proceed independently. Alice opens successive cursors.

Dalph shows Q's derived same-target order with Jq as its basis, the exact
non-cancellable start, S/H/C/resource correlation, the outer result, and the
separate Git qualification. Alice follows causal/source links without
substituting the immediately preceding row. Before the Git observation, M is
only reported; afterward it is Git-qualified. Q2 never appears to pass Q.

The view must not expose or invent implementation review, integration review,
repository-check, provider-turn, or resource-HEAD stages; infer M from process
success; persist a queue ordinal; claim promotion; or acquire the integration
target resource.

#### Alice follows qualified M through promotion ambiguity and settlement

At J, Git-qualified M has a durable promotion request and one numbered attempt
whose direct response is ambiguous. Alice sees exact H, M, attempt ordinal,
and that the accepted protocol requires a Git read before another request. At
later cursors she sees either promotion success/ancestry, stale H2, or
non-convergence after the third attempt. If promotion succeeds, later cursors
separately show focused tracker facts, exact completion request and lookup,
completion-claim replacement/deletion, task settlement, and the later complete
graph that can release dependants.

The view must not send the Git read or compare-and-set, display an intent as
promotion proof, force-update H2, infer tracker completion from Git, settle on
an acknowledgement alone, release dependants from a focused read, or record
Run termination.

#### Alice reopens an unfinished outer Integrator session

At J, S is fixed and its exact run has started, but no conclusive outer result
exists. Dalph disappears. Alice reopens J after restart and sees the same
session, candidate resource, H, C, run ordinal, and explicit missing outer
result. Ordinary delivery may later give S back to the Integrator; only a
later committed cursor shows its result. There is no crash occurrence or
successor session merely because the process disappeared.

The view must not call the Integrator, retransmit provider-private work,
quarantine S, create S2, or block unrelated work. This is the accepted first
scenario in `docs/scenarios/issue-68-recover-or-quarantine-integration-session.md`.

### Scenario-to-test seams

| Scenario | Required new presentation evidence | Existing protocol evidence to retain |
| --- | --- | --- |
| Responsibility through candidate | `shows Alice Q/S/H/C/M and exact [H,C] Git qualification without private Integrator stages`; derived-order test ties FIFO to responsibility positions | Integrator tests “successful preparation returns only the Git-qualified canonical M”, “resource HEAD never supplies…”, and candidate-parent negative tests; cassette `projects exact integration order from typed delivery obligations` |
| Promotion through settlement | cursor matrix for pending-read, success, stale, non-convergent, focused completion, claim cleanup, settlement, and later dependant-release facts; exact relationships must remain distinct | target-promotion outer-protocol tests, completion-task protocol ambiguity tests, finality cleanup/reopening tests, and blocker-before/after-promotion cassettes |
| Restart unfinished S | memory and SQLite test: `reopens the same unfinished Integrator session explanation without a successor or fabricated crash occurrence` | Integrator test “process loss before the outer result reuses the same unfinished session” and issue-68 maintained cassette |

Add source/capability tests proving console and Reducer Lab consume the same
new schema facet and receive no Integrator, Git mutation, tracker completion,
claim-cleanup, disposition, or admission capability. Browser checks qualify
rendering and navigation; they do not replace the production reader or dual
store reopening tests.

## Recommended issue dependency and ownership update

- Close #80 against merge `8415e1b81`, then remove it from both blocker lists
  or mark it completed. As checked on 2026-08-20, #81's #132/#134/#136/#167
  and #82's #61/#167 are already closed.
- Keep both tickets under #33 and keep their read-only non-goal.
- Give #81 ownership of the generic historical observation-gap/recovery
  explanation contract and non-integration examples.
- Give #82 ownership of integration-specific occurrence classification,
  responsibility/session/candidate/promotion/finality facets, and the
  correction that private review/check stages never enter generic history.
- If both implementation branches change `TraceAtCursor` or
  `WorkflowOccurrence`, record which schema version lands first and require
  the second branch to rebase and update exhaustive consumers. Do not let each
  branch create its own relationship or explanation union.

## Primary sources

- [Issue #80](https://github.com/dearlordylord/dalph/issues/80), [#81](https://github.com/dearlordylord/dalph/issues/81), [#82](https://github.com/dearlordylord/dalph/issues/82), [#222](https://github.com/dearlordylord/dalph/issues/222), and [#223](https://github.com/dearlordylord/dalph/issues/223).
- [Issue #217](https://github.com/dearlordylord/dalph/issues/217), which owns
  passive current Run/task explanations rather than historical cursor facts.
- `docs/OPERATIONAL-SCENARIOS.md`, `docs/CONTEXT.md`, `docs/ARCHITECTURE.md`,
  `docs/architecture/journal-and-reconstruction.md`, and
  `docs/architecture/attempt-delivery-and-integration.md`.
- `docs/scenarios/workflow-occurrence-projection.md`,
  `docs/scenarios/issue-68-recover-or-quarantine-integration-session.md`,
  `docs/scenarios/issue-138-reconcile-blockers-around-promotion.md`,
  `docs/scenarios/issue-141-integration-finality.md`,
  `docs/scenarios/issue-142-qualify-recovery-prefix-harness.md`, and
  `docs/scenarios/issue-223-migrate-promotion-and-finality.md`.
- `packages/orchestrator/src/presentation/trace-reader.ts`,
  `packages/orchestrator/src/workflow/registry/occurrence-projection.ts`, and
  the integration admission, Integrator, quarantine, target-promotion, and
  integration-finality event/state modules under
  `packages/orchestrator/src/workflow/protocols/`.
