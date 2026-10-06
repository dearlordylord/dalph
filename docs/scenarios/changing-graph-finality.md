# Alice's changing graph settles as Blocked

Issue [#367](https://github.com/dearlordylord/dalph/issues/367) owns the core
S10 correction in [#365](https://github.com/dearlordylord/dalph/issues/365).
Public client attachment and replacement remain owned by #375.

## Governing behavior

This preserves [G2 stabilization](stabilize-each-run.md#g2-proves-complete-and-settled-termination),
[exact retained capacity](conflicting-capacity-observation.md),
[incomparable knowledge](../adr/0006-retain-incomparable-task-graph-facts.md), and
[D23–D24](../DELIVERY-INVARIANTS.md#ambiguity-and-evidence) and
[D35](../DELIVERY-INVARIANTS.md#progress). No validator exception or journal
position freshness rule is introduced.

## Corrected production chronology, recorded before runtime edits

1. Alice starts the production host for root A at capacity one. GitHub reports
   A open without blockers. SQLite records one Run beginning, the claim, one
   immutable attempt with its exact Base, branch and worktree, and executing
   responsibility. Real Git, coordinator, executor and Integrator adapters run;
   only GitHub and Codex provider responses are controlled.
2. GitHub adds B and D grouped under A. B explicitly requires C, which is
   terminal without success and has no parent. The timer offers an active-work
   refresh. The workflow records its read intent before contacting GitHub and
   publishes the accepted complete graph. D ranks ahead of A, but A's exact
   retained responsibility occupies the only position. No second executor,
   claim, attempt or child work-specification read begins.
3. GitHub changes D to terminal without success. A subsequent refresh publishes
   that complete graph. The test releases A's provider result. Production
   accepts it, integrates it, publishes/promotes its Git candidate, confirms
   tracker completion, and settles the exact resource obligations.
4. Quiescence permits the existing one G2 read for that activation. Its intent
   names earlier graph reads and its observation still describes A as open if
   tracker completion has not yet been observed. A subsequent ordinary
   activation reconstructs that accepted history. The delivery relation reads
   its **immutable accepted Journal prefix**, including prior complete graph
   observations and unchanged reconfirmations for this exact target. Because
   that activation's current graph is not established and no recovered action
   supplies it, the relation proposes `EstablishCurrentGraph`.
5. That decision explicitly chooses to replace the graph knowledge in the
   prefix it just consumed: the proposal carries those successful observations'
   exact operation IDs. The action adapter copies them into the new
   `WorkflowEstablishment` intent **before** the tracker call. Neither the
   adapter nor the validator invents dependencies at termination. Failed,
   focused, other-target, pending, and observations accepted after the captured
   prefix are not included. The later complete read can supersede only these
   named graph observations and their causal ancestors; concurrent later
   conflicting evidence remains incomparable. On the initial empty graph
   history the list is empty.
6. GitHub now reports A successful, B still open and blocked by unsuccessful C,
   and D unsuccessful. Stabilization reconfirms that graph through its existing
   G2 protocol. Production proves no retained task position, integration owner,
   unsettled responsibility or durable cleanup obligation, then appends one
   actual `WorkflowRunTerminated(Blocked)` with its exact evidence position.
   A's success never classifies B, C or D as successful.

There is no host crash, lost mutation response, or mutation retry in S10.
The existing intent/outcome protocol remains responsible for recovery: a
completed graph read is reconstructed, and an ambiguous request is reconciled
before retry. Process loss cannot release A or replace its immutable plan.
The causal correction is proposal evidence construction, not a new recovery
or retry policy.

## Controlled invalid history

Construct nine accepted graph reads g1–g9, followed by post-quiescence g10 with
exact predecessors g1–g9. They describe A open, B blocked by unsuccessful C,
and D unsuccessful. Append changed `WorkflowEstablishment` g11 without any
predecessor, describing only A as newly successful. Request Blocked termination
from its exact observation. Both Journal implementations must return typed
`WorkflowRunTerminationEvidenceInvalid` for incomparable graph observations,
preserve the history, and append zero terminal records. This test intentionally
does not pass through the corrected producer.

## Scenario-to-test mapping

| Scenario | Maintained acceptance seam |
| --- | --- |
| S10 negative, exact g10/g11 provenance and zero terminal records | `packages/orchestrator/src/workflow-journal/store.test.ts`: `rejects S10 g10 and predecessor-free changed g11 without terminating` (memory and SQLite) |
| S10 correction, retained exact attempt, changed graph, settlement and accepted Blocked | `packages/dalph/src/application/production-changing-graph-finality.test.ts`: `settles Alice's changing graph as Blocked while retaining A at capacity one` |
| Record and replay the corrected production chronology | The same production-host test constructs a `RecordedCassette` from the accepted SQLite journal and checks every occurrence's state, history, selection and exact position round trip. This is a maintained recording seam, independent of the disposable research probe. |
| Captured graph replacement scope, including unrelated and later evidence | `packages/orchestrator/src/coordination/delivery/reactive-delivery-relations.test.ts`: `captures only accepted same-target graph observations before proposing replacement` |
| Public MCP/CLI observation and replacement | #375; no public transport qualification claimed here |

## Quint disposition

[`runActivation.qnt`](../../specs/runActivation.qnt) owns
`terminationRequiresLaterSettledObservation`,
`terminationRequiresExactFreshGraphEvidence`,
`terminationRequiresNoRetainedResponsibilityOrPosition`,
`completedRequiresAllCurrentTasksSuccessful` and
`blockedRequiresFreshConclusiveTrackerFacts`. Its exact graph evidence abstracts
the concrete operation predecessor DAG; it has no g10/g11 relation to change.
This correction constructs that evidence in the existing production decision,
without changing the modeled states, actions or laws. No model edit is needed.
The production test and invalid-history control qualify the concrete boundary;
a green abstract model alone does not. Run the issue-required formal gate
separately and report its actual evidence.

## Qualified implementation evidence

Source candidate `00cc144616fc6bdeae325c21b3d39c123e585efb` uses Base
`e73348030ad88d27f09ce838d3b33045e1f5e9de`. On local Linux with Node 24.20.0
and pnpm 10.29.3, the mapped production-host, relation, Journal and cassette
files pass together: 273 tests. The production test observes actual Blocked
termination, exact Git cleanup and SQLite provenance; the independent invalid
history still rejects termination. The repaired refresh, recovery and provider
fixture files pass all 75 tests. The workspace-resolution file passes all five.

- `pnpm test` passes the full coverage suite: 4,700 passed, 63 skipped across
  426 files (422 passed, four skipped), in 584.38 seconds. Changed production
  lines have 100% coverage (35/35). Gate
  `631fe690-e712-40d2-a683-136f83a70cfe` records exit zero, unchanged source
  and stopped custody. Optional live-provider and public-process qualifications
  remain outside this ordinary suite; no hosted CI result is claimed.
- `pnpm check:quint` runs a fresh complete profile, including negative controls,
  and passes. Gate `30d0a91d-b750-461f-896f-1795651dac4c` records exit zero,
  unchanged source and stopped custody. Its successful formal attempt is
  `e03382a3-2fce-4bc2-abc1-a896a80b4b9a`. This abstract evidence complements
  the concrete S10 tests; it does not replace them.
- `check:fast`, artifact verification and documentation checks pass. The
  Standards and Spec reviews report zero scoped findings for the implementation
  and zero new findings for the qualification repair.

The initial failed full and formal runs were diagnosis evidence only. Their
fixture and local reference-checkout causes were repaired before these fresh
passing runs. Issue #367's core acceptance and required gates are complete.
Public MCP/CLI attachment and replacement qualification remains owned by #375.

## Qualification repair scope

The refresh fixture measures each activation before its explicit application
Exit. Graceful Exit then legitimately suspends remaining executor work through
the real journaled drain; those teardown effects must not be mistaken for
refresh effects. A simulated crash closes its process scope without requesting
Exit, preserving the crash prefix for recovery. The fixture retains the
pre-Exit calls and history and separately assert successful ordinary Exit.
The existing recovery fixture supplies the tool-effect subscription required
by the executor, and the provider fixture asserts the controller's existing
five-key environment. These are controlled-test corrections: no production
operation, decision, or adapter behavior changes. The workspace-resolution
fixture and formal observer use their original commands after preserving
ignored reference checkouts under `.scratch/reference-checkouts-367`.

The newly discovered unfinished blocker D in the constraint fixture has its
own work specification and a foreign tracker claim. It remains unfinished;
Dalph must not begin it. Returning C's work specification for a D read was
invalid fixture evidence and prevented the real Exit drain from reconstructing
history. The fixture now returns D's exact facts without changing production.

### #375 public invalid-history composition

The public production host also executes the retained S10 correction chronology.
For its negative variant only, the controlled journal input before the final
termination call acquires its publication lock appends g1–g9 and post-quiescence g10 from the complete
pre-delivery graph, then changed g11 with no predecessors. All appends use the same accepted process journal, preserving its publication
and immutable acknowledged prefix. The optional `JournalTerminationQualification`
constructor capability decorates only termination input before the original
terminator acquires its lock; it leaves append,
read, reconstruction and storage unchanged and delegates to the original
terminator. Ordinary production supplies no implementation. The real SQLite
lifecycle validator receives g11's exact evidence and must return typed
`WorkflowRunTerminationEvidenceInvalid`. The host retains that actual failure;
actual CLI/MCP children read identical `FinalityFailed` evidence. Its terminal
source remains pending and reopening SQLite proves zero terminal records.
`production-changing-graph-finality.test.ts`, `public clients retain typed
incomparable S10 failure without terminal records`, owns this negative public
composition. This controlled invalid-history input bypasses the corrected
producer, as the original negative scenario requires; it introduces no runtime
behavior or separate finality decision.

### Public retention of a conclusive finality rejection

Dalph receives `WorkflowRunTerminationEvidenceInvalid` from the real journal
lifecycle boundary after an established Run proposes termination from
incomparable tracker observations. The journal has positively rejected the
terminal append and keeps its acknowledged nonterminal prefix. The production
owner stops ordinary timer admission and retains the exact typed failure for
attached clients; it cannot turn that failure into Pending, retry termination
automatically, append a terminal occurrence, or infer a disposition from task
success. Actual CLI and MCP control reads expose `FinalityFailed` with the
original Run identity and the existing public causal-invalid diagnostic while snapshot lifecycle remains independent.

No process crash or ambiguous mutation response occurs at this rejection: the
validator proves absence of the terminal append. Recovery and later actions
require explicit reconciliation of the offending evidence. The public negative
composition and the canonical production failure-classifier test own these
acceptance assertions; the independent memory/SQLite S10 test remains required.
