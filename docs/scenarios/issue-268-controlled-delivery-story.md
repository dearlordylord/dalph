# Run the first thirteen delivery-story beats under controlled readiness

Owning issue: [#268](https://github.com/dearlordylord/dalph/issues/268)

Recovery control: [#314](https://github.com/dearlordylord/dalph/issues/314)

Status: behavioral recovery specification accepted by the maintainer on
2026-09-02 with this condition: do not freeze a guessed cassette sequence and
then change production to reproduce it. First freeze the required behavior,
observe the unchanged production workflow under explicit test controls, and
only then ask the maintainer to freeze the observed cassette order. This
documentation-only change does not change Dalph runtime behavior. Acceptance
freezes the thirteen behavioral outcomes, required causal edges, scope, and
stop rules. It does not freeze the provisional O001--O089 order or authorize
production changes to make that order pass.

The 2026-09-05 pre-DS-04 audit corrected two stale read inventories without
changing a behavioral outcome. Governing issue #266 requires an active refresh
to stop a subject's authority chain as soon as a current fact conclusively
requires suspension. B's changed F2 specification therefore skips B's claim
and Git reads in DS-04; C's closed lifecycle in G2 skips all C-focused reads in
DS-10. The former O001--O094 hypothesis incorrectly demanded those seven
provider calls and conflicted with both #266 and unchanged production.

The implementation base for the resumed C2b proof is exact commit
`b8a63ef8ea546963d403c3056e18e93b629df04c`. It descends from the original
accepted base `e79f64e3a97eb02a63aad050b442a178ecab6bf3`, includes the accepted
C1 active-refresh correction, and adds #315's reviewed bounded fresh-admission
correction. A later commit may carry this document, but it must not silently
change the production base being proved.

The latest stopped convergence candidate is the clean, pushed worktree
`/workspace/typescript/dalph-worktrees/issue-268-convergence-validation` at
exact commit `b1f52b30573e84207f737541e23fc2ff722de956`. It is high-viability
evidence of where the previous attempt stopped, but it remains forensic input,
not the recovery base or an implementation source.

## Decision and scope

This scenario proves one explicitly controlled execution of beats DS-01
through DS-13 in [the delivery story](../DELIVERY-STORY.md). It does not require
the cassette to accept every valid production interleaving. The controlled
providers delay already-independent responses at named readiness gates so the
same complete occurrence order is consumed on every run. They do not change
which work is eligible, add an ordering queue, serialize production, or make
production imitate a cassette.

Changing the authored expected sequence to the sequence produced by accepted
test-only controls is a **cassette adjustment**. Before a strict cassette is
written, one cassette-free characterization must run the fixed-base production
workflow with only those controls and record its complete occurrence order.
The maintainer reviews that observed order before it becomes the strict
cassette oracle. Changing production scheduling, authority, capacity, or
lifecycle semantics to satisfy either the provisional or observed sequence is
outside this recovery.

This creates two acceptance cuts:

1. **Behavior accepted:** this document now authorizes C0/C1 verification and
   test-only characterization controls. It does not authorize a production
   correction or strict cassette.
2. **Observed order accepted:** after cassette-free characterization, the
   recorded complete order replaces the provisional O inventory. Only then may
   C3 implement the strict cassette. A changed required causal edge returns to
   its owning scenario; a different order among independent operations changes
   only the cassette adjustment.

The following work is deliberately outside #268:

- issue [#309](https://github.com/dearlordylord/dalph/issues/309)'s general
  causal/DAG matcher is not a prerequisite;
- issue [#313](https://github.com/dearlordylord/dalph/issues/313) owns whether
  capacity can be read or changed when no Run activation is active;
- beats after DS-13 and G2 expansion are not part of the capstone denominator;
- live-provider bulk qualification is not used; controlled providers prove the
  composition without repeatedly mutating GitHub, Git, or an executor.

The accepted #269 full-capacity return and publication handoffs already present
at the fixed base may execute naturally when B1 waits at DS-12. This scenario
does not add the later candidate's post-G2 semantic-trace events or private
observation callbacks. If the natural production path hangs there, the
conditional isolation rule below applies.

If the accepted DS-01--DS-13 story cannot complete at the fixed base under
these controls, the recovery may spend at most one working day isolating the
first cassette-free production-workflow obstruction. That obstruction becomes
a separately accepted blocking issue unless its fix is both small and already
required by a governing scenario below.

## Governing behavior

- [Issue #264: Begin once, then observe the same executing work](issue-264-autonomous-executor-work.md#begin-once-then-observe-the-same-executing-work)
  and [Resume only the same safely suspended attempt](issue-264-autonomous-executor-work.md#resume-only-the-same-safely-suspended-attempt-selected-by-current-facts)
  own executor command identity and lifecycle acceptance. This scenario
  preserves those rules and composes several exact attempts.
- [Issue #265: a later process reattaches to the exact attempt](issue-265-passive-executor-observation-through-restart.md#a-later-dalph-process-reattaches-to-the-exact-codex-attempt)
  owns same-host restart observation without another work command. This
  scenario preserves it for A1, C1, and D1 together.
- [Issue #266: Alice changes B while A1, B1, and C1 execute](issue-266-active-work-authority-refresh.md#alice-changes-b-while-a1-b1-and-c1-execute-autonomously)
  owns the sole refresh authority, notification/timer coalescing, focused
  current-fact reads, and safe suspension. This scenario selects the lost
  notification/timer path for its main run.
- [Issue #267: maintained production chronology](issue-267-exact-causal-active-work-cassette.md#maintained-production-chronology)
  owns exact predecessor and lifecycle publication in its narrower cassette.
  This scenario preserves those causal constraints but does not import a
  general partial-order matcher.
- [Issue #269: read-only restart obligations do not block D](issue-269-independent-work-retained-priority.md#read-only-restart-obligations-do-not-block-independent-d)
  and [exact B1 selected for Continue precedes fresh work](issue-269-independent-work-retained-priority.md#exact-b1-selected-for-continue-precedes-d-and-replacement-b2)
  own position-free passive reads and retained-attempt priority. This scenario
  composes those rules through DS-13.
- [Issue #254's superseding amendment](https://github.com/dearlordylord/dalph/issues/254)
  removes the earlier report-triggered graph-read and repeated-continuation
  design. The edit notification or bounded timer owns refresh; an executor
  `Executing` report authorizes neither another graph read nor another work
  command. This scenario uses only that superseding behavior.
- [D12 Position discipline](../DELIVERY-INVARIANTS.md#admission-and-capacity)
  and the journal-first rules under
  [Ambiguity and evidence](../DELIVERY-INVARIANTS.md#ambiguity-and-evidence)
  remain global constraints. The fixture is evidence for occurrences, not a
  replacement for those invariants.
- [Issue #315: preserve bounded fresh admission through exact handoff](issue-315-preserve-bounded-fresh-admission.md)
  owns the distinction between a descriptive graph candidate and an authorized
  operation. While A/B/C are committed to or occupy all positions, D/E may
  remain visible outside the bound but cannot acquire a claim, specification
  read, plan, worktree, executor-work responsibility, or `Begin` authority.

## Who is acting and what is true first

Alice is the maintainer. The relevant systems are Dalph's sole coordinator,
the tracker, Git, the executor substrate, and Dalph's Journal. No person
triggers individual background reads.

Before DS-01:

- Exact Run `run:issue-268-controlled` (R) exists at policy revision
  `policy:issue-268:1` (P1) with configured task-work capacity three.
- The tracker can return complete graph G0 containing open, unblocked tasks A,
  B, C, D, and E in that selection order. None has a Dalph claim.
- The controlled Git target is `fixture:issue-268` at `refs/heads/main`. Its
  exact starting object ID is `1111111111111111111111111111111111111111` (H0).
  No planned Base SHA or task worktree is recorded yet. Each accepted A1/B1/C1
  or D1 plan later in the story must record H0 exactly once.
- The executor has no session for A through E. The Journal has no claim,
  planned-attempt, executor-command, retained-attempt, or position record for
  them.
- Controlled tracker, Git, executor, clock, identity, and process boundaries
  are installed. Every returned fact is named below. Readiness gates may delay
  a response but may not invent a fact or authorize an operation.
- Stable IDs name R, P1, attempts `attempt:A:1`, `attempt:B:1`,
  `attempt:C:1`, and `attempt:D:1`, and their planned worktree locators. The
  clock and generated operation IDs are fixed, so nondeterministic identity or
  time cannot change the cassette.

## Recovery-base production-correction ledger

This ledger prevents the cassette from rediscovering or silently replacing the
production corrections selected by #314. The original C1 corrections were
re-proved before #315. Commit `b8a63ef8e` is their clean descendant and is now
the fixed base for the resumed proof.

| Accepted correction | Recovery-base evidence | Executable verdict |
|---|---|---|
| `e84dd306f` full-capacity return | `ca5d849c6`, ancestor of `b8a63ef8e` | C1 owning cassette-free test passed; keep it in the focused final set. |
| `7aff7a3ed`, `78c5aaa4c`, `ff97a5eb2` passive-observer retention and identity | `f22f30e65`, `c29b8963c`, `a79c82544`, ancestors of `b8a63ef8e` | C1 owning tests passed; keep them in the focused final set. |
| `86137a865`, `709a830b7` current-first planning and coherent successors | `d5dc03b6f`, `b753d648a`, ancestors of `b8a63ef8e` | C1 owning tests passed; keep them in the focused final set. |
| `e6160335c` same-position owner retention | `f9e269c82`, ancestor of `b8a63ef8e` | C1 owning test passed; keep it in the focused final set. |
| `c1a3c981e` accepted-publication gating | `46236b1d6`, ancestor of `b8a63ef8e` | C1 owning test passed; keep it in the focused final set. |
| `2aae67f47` admission reconciliation | `390b08ad8`, ancestor of `b8a63ef8e` | C1 owning test passed; keep it in the focused final set. |
| C1 active-refresh subject retention | `e7b60e184`, ancestor of `b8a63ef8e` | Direct cassette-free test and final reviews passed. |
| #315 bounded fresh admission and continuous commitment | `b8a63ef8e` | #315 scenario/model/conformance mapping, `pnpm check:all`, final `pnpm check:quint`, and final reviews passed. C2b must now independently show the corrected DS-02 result. |

The active-refresh subject-retention patch was replayed as `e7b60e184` after a
direct cassette-free red/green verdict. None of its cassette ancestry was
imported. It is an ancestor of the new recovery base.

The delivery-story manifest's DS-05 row is a **composed-evidence** gap, but its
current reason incorrectly says production supports only Continue and Stop. At
the fixed base, the frontier derives Continue, Restart, and Stop, and the
attempt-choice protocol directly tests all three for the exact safely suspended
attempt and fingerprint pair. C1 must re-run those
cassette-free frontier and attempt-choice tests on the clean recovery candidate.
#268 then proves that the DS-04/DS-05 composition reaches that existing choice
projection; it must not invent a choice or quietly reduce DS-05 to two choices.

This ledger records both patch presence and the already-completed C1/#315
verdicts. C5 must re-run the representative focused tests on the final clean
candidate; prior aggregate totals do not replace that final evidence. The
representative test inventory is:

- `returns admission-stalled quiescence with the blocked proposals when exact
  attempts hold all ordinary capacity`;
- `keeps exact passive attachments across unrelated accepted facts and returns
  blocked D and E as admission-stalled`;
- `keeps three publication-through passive attachments across a post-completion
  route refresh`;
- `derives a passive-attachment marker live-action key from its proposal`;
- `emits every accepted stable publication after repeated current planning
  samples`;
- `emits one coherent same-position planning successor before a later accepted
  sentinel`;
- `keeps a same-position worktree completion pending until its lineage
  successor reaches the runtime`;
- `keeps an action owner until its accepted successor publication reaches the
  runtime`;
- `restart reconstructs three unfinished task positions without an admission
  snapshot`;
- for the replay candidate, `keeps an exact reconciled subject behind G2 after
  later Safe or Terminal` must first fail without the candidate and pass with
  only its bounded patch.

## The controlled thirteen-beat chronology

| Beat | Outside trigger and Dalph action in chronological order | Visible state after the beat |
|---|---|---|
| DS-01 | The coordinator reads G0 once. It records G0 and derives A, B, and C as the first eligible tasks under capacity three. | The maintained delivery result projects A, B, and C as selected; no executor work has begun. |
| DS-02 | For A, then B, then C, Dalph records intent before adding the exact tracker claim, observes that claim, reads the required post-claim graph and current task specification, records the accepted plan and exact Base SHA, creates the one planned worktree, records the exact executor-work responsibility with no capacity gap, records one `Begin` intent at command/report ordinal 1, sends one `Begin`, observes `Executing` at ordinal 1, and publishes the exact attempt as holding one position. Gate R1 releases each task's boundary responses in that authored order. D and E remain descriptive graph candidates outside the bound and cross none of those operation boundaries. | A1, B1, and C1 execute concurrently and hold all three positions. Each has one claim, worktree, executor-work responsibility, and `Begin`; D/E have none. |
| DS-03 | Alice edits B from fingerprint F1 to F2. The tracker accepts the edit and can now return complete graph G1. | Alice sees B changed in the tracker; executor work has not yet been changed. |
| DS-04 | The edit notification is deliberately lost. The configured bounded timer fires. The sole refresh owner reads G1 once, then reads the current specification for A, B, and C in graph order. A and C still match and continue through their current claim, worktree, and lineage reads. B is F2, which conclusively stops B's authority chain before claim or Git reads. Dalph sends no executor command for A or C. It records one exact B1 `Suspend` intent and sends one `Suspend`. The immediate executor response remains `Executing`; no position is released. | The maintained delivery result projects B1 as suspending; A1, B1, and C1 still hold three positions. |
| DS-05 | Gate R4 makes the executor's exact B1 lifecycle projection become `Safe`. Dalph records and publishes that observation, then releases only B1's position and retains B1's exact attempt/worktree. | A1 and C1 hold two positions. B1 is retained, and the Alice-facing delivery projection exposes `Continue`, `Restart`, and `Stop` for B1. This capstone does not claim to test a UI renderer. |
| DS-06 | The newly free position admits independent D. Dalph records and observes D's exact claim, reads the required post-claim graph and current specification, records D1's plan/Base SHA, creates D1's worktree, records one `Begin` intent, sends one `Begin`, observes `Executing`, and publishes D1 as holding the position. | A1, C1, and D1 execute and hold three positions; B1 remains retained; E remains unstarted. |
| DS-07 | Alice changes capacity from three to two while those three exact attempts are executing. Dalph records and applies policy revision P2. It does not evict or suspend any attempt merely to reach the lower limit. | Capacity is two; A1, C1, and D1 continue to hold three grandfathered positions. |
| DS-08 | After P2 is durable, the coordinator process dies. The controlled executor substrate and exact sessions remain alive and observable on the same host. | The UI may disconnect. No executor attempt is cancelled or replaced by the process loss. |
| DS-09 | Alice restarts Dalph on the same host. Dalph reads the Journal and reconstructs P2, A1/C1/D1 as held, and B1 as retained. Because process loss discarded the live graph projection, the fresh activation makes one current complete G1 observation and publishes it before relying on E's current tracker state. Dalph then reads the exact executor projections for A1, C1, and D1; all still report `Executing`. These passive reads acquire no additional task-work position and send no `Begin` or `Resume`. Eligible E remains a descriptive graph candidate with `EligibleOutsideBound` placement; Dalph constructs no E operation proposal or capability because three positions remain held against capacity two. That non-empty capacity-blocked candidate frontier makes the activation return exact `CoordinatorActivationReturned(RunMustRemainActive, RunnableTransition)` after the strict projections and without a second post-quiescence/finality graph read. | The maintained result again projects A1, C1, and D1 executing, B1 retained, and E unstarted, with capacity two. The sole owner settles the exact restart return before accepting the later close-C refresh. |
| DS-10 | Alice closes C in the tracker without reporting success. The tracker accepts G2 and sends one notification. The sole refresh owner reads G2 once. C's closed lifecycle is already conclusive, so C crosses no focused specification, claim, worktree, or lineage boundary. A and D still match and each complete those four current-fact reads. Dalph records one exact C1 `Suspend` intent, sends one `Suspend`, observes the immediate `Executing` response, and keeps C1's position held. Because C1 still reports `Executing`, the same process-local passive lifecycle owner remains attached and the same active refresh remains live waiting for R9; DS-10 does not manufacture another executor read, finalize that activation, or start another activation. | The maintained result projects C1 as suspending; A1, C1, and D1 still hold three positions. The active refresh remains live for DS-11's exact C1 lifecycle change. |
| DS-11 | Gate R9 makes C1's exact lifecycle projection become `Safe`. Dalph records and publishes it, releases only C1's position, and retains C1's exact attempt/worktree. | A1 and D1 hold two positions, exactly filling P2. B1 and C1 are retained. |
| DS-12 | Alice chooses `Continue` for exact B1. Dalph records that choice and reads the current graph, B specification, exact claim, planned worktree, and Git lineage. The facts authorize resuming B1, but no position is free, so Dalph records no `Resume` intent and sends no executor command yet. | The maintained result projects B1 waiting to continue; A1 and D1 still occupy both positions. |
| DS-13 | Gate R11 lets A1's executor projection report terminal `Accepted`. Dalph records and publishes that exact result and releases A1's position. The already-selected exact B1 is considered before unstarted E, binds that position, records one `Resume` intent, sends one `Resume`, observes `Executing`, and publishes B1 as held. | B1 and D1 hold the two positions. A1 is accepted; C1 remains retained; E remains an `EligibleOutsideBound` graph candidate with no materialized operation proposal or capability. No replacement B2 exists. Because E still makes the activation non-quiescent without crossing an operation boundary, this beat does not fabricate a post-quiescence stabilization read. |

The capstone stops at that visible state. It does not imply that the Run is
terminal or that later delivery-story beats have been proved.

## Readiness controls

The #268 work must implement twelve capstone readiness gates R0--R11 plus one
companion-proof gate R12. A gate controls only when an already-authorized
response becomes available.

| Gate | Controlled response |
|---|---|
| R0 | Journal appends, stable identity/clock values, and unmentioned successful tracker/Git calls are immediately ready in the required intent/effect/observation order. Any injected failure is a test failure; this capstone does not silently retry it. |
| R1 | DS-02 task pipelines return in A, then B, then C order while the three executor sessions remain concurrently alive afterward. |
| R2 | Alice's F2 edit is accepted only after A1/B1/C1 are all published `Executing`. |
| R3 | The bounded timer fires after the deliberately absent edit notification and before any other refresh hint. |
| R4 | B1 remains `Executing` through the `Suspend` response, then its passive lifecycle projection becomes `Safe`. |
| R5 | D's pipeline becomes ready only after B1's safe publication releases its position. |
| R6 | P2 is accepted only after D1 is published `Executing`; process death is held until P2 is durable. |
| R7 | Restart projections return for A1, C1, and D1 in that order; all three are already independently readable. |
| R8 | C's close and its notification arrive only after the exact DS-09 `RunnableTransition` return has settled. |
| R9 | C1 remains `Executing` through the `Suspend` response while the same active refresh stays live; then its already-attached passive lifecycle owner receives exact C1 `Safe`. |
| R10 | Alice's Continue choice is accepted after C1 releases its position and while A1/D1 still fill capacity two. |
| R11 | A1 remains `Executing` until B1 is authorized and waiting, then reports terminal `Accepted`; B1's `Resume` response reports `Executing`. |
| R12 | In the separate stabilization-distinction proof, the finality graph response is withheld until that fixture's active-work refresh and resulting action have quiesced; it returns the unchanged graph exactly once. R12 is not used to bypass DS-13's capacity-blocked E frontier. |

A second notification-and-timer coalescence run is not part of the 13-beat
capstone denominator. The existing #266 acceptance test continues to prove
that two hints yield at most one trailing activation. Adding that path to the
capstone would create another authored story, not strengthen this story's
repeatability.

The accepted #268 checklist also requires a separate focused proof that an
active-work refresh occurs before quiescence and a finality reconfirmation has a
distinct cause after quiescence. #194 owns that one-shot reconfirmation. It is
not appended to DS-13: E is still a capacity-blocked descriptive graph candidate there, and
#269 requires the ordinary runnable-transition return without a finality read.
The companion proof uses R12 and remains a required C5 test, but contributes no
O identifier and no DS beat to the capstone denominator.

## Ordering classification

Every ordering claim made by this scenario belongs to one of three classes.
There are exactly 31 claims below; no other table adjacency is a claimed
production dependency.

**Required happens-before** means production correctness requires the left
fact before the right effect.

1. G0 is accepted before A/B/C eligibility is derived.
2. Each exact claim intent precedes its tracker mutation and observation.
3. Each accepted plan and Base SHA precedes its exact worktree creation.
4. Each exact worktree and `Begin` intent precede its one `Begin` call.
5. Alice's F2 edit precedes the G1 refresh that observes F2.
6. G1 and B's focused current facts precede B1's `Suspend` intent.
7. B1's `Suspend` intent precedes the executor call.
8. B1's exact `Safe` publication precedes release of B1's position.
9. B1's position release precedes admission of D's position-requiring work.
10. D1's accepted plan/worktree precedes its one `Begin` call.
11. Restart reads the Journal before it passively observes A1/C1/D1.
12. The strict A1/C1/D1 restart projections precede the exact
    `RunMustRemainActive(RunnableTransition)` return, and that return settles
    before the later refresh activation begins.
13. C's tracker close precedes the G2 refresh that observes it.
14. G2's conclusive closed-C lifecycle fact precedes C1's `Suspend` intent and
    call; C has no focused current-fact read in this beat.
15. C1's exact `Safe` publication precedes release of C1's position.
16. Alice's exact Continue choice and B's fresh authority reads precede B1
    becoming an eligible Resume responsibility.
17. A1's exact terminal publication precedes release of A1's position.
18. A1's position release precedes B1's position binding, `Resume` intent, and
    one `Resume` call.
19. The active-work refresh and its resulting work occur before quiescence.
20. Quiescence precedes the one stabilization reconfirmation, whose distinct
    cause cannot replace an active-work refresh.

Claims 1--3 are owned by graph/admission selection, journal-first mutation, and
the one-exact-worktree invariant. Claims 4, 7, 10, 16, and 17 are owned by
#264's intent-first exact-command and lifecycle protocol. Claims 5, 6, 8, and
13--15 are owned by #266's complete graph, changed-work, and exact-safe-release
rules. Claim 11 is owned by #265's journal-first passive restart protocol.
Claims 9, 12, and 18 are owned by #269's capacity, exact activation-return, and
retained-attempt-priority rules. Claims 19--20 are owned by #268's accepted
active-refresh-versus-stabilization checklist and #194's post-quiescence
finality rule. The implementation must add the
parameterized negative test `rejects each required issue 268 edge reversal`,
covering each of these twenty numbered claims. A claim quantified over several
tasks or containing a multi-step chain expands to one reversal case per concrete
edge; existing predecessor tests may be cited only when they execute the same
reversal at the fixed base.

**Controlled readiness** means the fixture chooses one reproducible order
among facts that production is allowed to overlap.

21. A, B, and C's independent DS-02 boundary responses are released in graph
    order.
22. Alice's F2 edit is held at R2 until A1/B1/C1 are all executing.
23. The selected bounded timer is held at R3 until after the F2 edit; another
    timer tick outside this story would be legal.
24. The B1 and C1 `Safe` lifecycle changes occur at R4 and R9 rather than at
    another valid time after their respective Suspend calls.
25. Alice's P2 request is held at R6 until D1 is executing.
26. Process death is held at R6 until P2 is durable.
27. Restart's independent passive A1/C1/D1 projections return in graph order.
28. Alice's C close is held at R8 until the exact restart return has settled.
29. Alice's Continue choice is held at R10 until C1 has released while A1/D1
    still fill capacity two.
30. A1's terminal result becomes ready only after B1 is authorized and waiting.

**Serialized after arrival** means independently produced facts are applied by
the existing single publication/Journal owner in the order the controlled
fixture delivers them.

31. The A/B/C startup responses and A/C/D restart projections are published in
    their R1/R7 arrival order; the scenario does not claim a causal edge
    between those independent operations.

Claims 21 and 27 classify when independent provider responses become ready.
Claim 31 classifies the later, separate act of applying already-arrived results
through the publication owner. No response-readiness edge is counted again as
a publication edge.

After the observed-order acceptance cut, the strict cassette asserts that one
complete controlled order. The production workflow remains free to produce a
different valid order when the controlled readiness gates are absent.
Supporting every such order would be #309's different test contract, not a
condition for closing #268.

## Provisional occurrence hypothesis and stable denominator

O001--O089 is a provisional, source-derived characterization checklist. It is
not yet the strict cassette oracle or a progress denominator. The cassette-free
characterization must confirm, remove, add, and reorder these groups without
changing production. Its observed complete inventory becomes authoritative
only at the second acceptance cut.

Each `O` identifier is a **semantic occurrence hypothesis**, not a claim about
the number of raw Journal records. A slash joins the intent/call/observation
records of one boundary operation. `read/publication` currently occupies two
consecutive hypotheses. For a healthy task's four focused facts, the proposed
order is specification, claim, planned worktree, then Git lineage. A conclusive
fact stops the affected task's chain: B has only its specification read in
DS-04, and C has no focused read after G2 closes it in DS-10. The characterization
report maps every raw observed item to a hypothesis, identifies every missing
or extra item, and publishes the resulting exact order for review.

Within DS-02, O003--O008 belong to A, O009--O014 to B, and O015--O020
to C, using the six operations listed in that row. DS-06 uses the same six
operations for D. DS-04 assigns O028--O031 to A, O032 to B's conclusive
specification, and O033--O036 to C. DS-10 assigns O063--O066 to A and
O067--O070 to D; C's closed G2 fact stops its focused chain. DS-12 assigns
O075 to the Continue record, O076--O077 to the graph read/publication pair,
O078--O081 to B's four focused facts, and O082 to the waiting projection.

| Beat | IDs | Occurrence groups | Count |
|---|---|---|---:|
| DS-01 | O001--O002 | G0 graph read; accepted graph publication | 2 |
| DS-02 | O003--O020 | A, B, C each: claim intent/call/observation; post-claim graph and specification reads; accepted plan/Base SHA record; worktree intent/call/observation; Begin intent/call/Executing observation; held-position publication | 18 |
| DS-03 | O021--O022 | Alice's F2 tracker edit; tracker acceptance | 2 |
| DS-04 | O023--O037 | refresh ownership; lost notification fact; bounded timer; G1 read; G1 publication; A/C four focused current-fact reads; B conclusive specification read; B1 Suspend intent/call/Executing response | 15 |
| DS-05 | O038--O040 | B1 Safe projection; Safe Journal/publication; B1 position release/retention | 3 |
| DS-06 | O041--O046 | D claim intent/call/observation; post-claim graph and specification reads; accepted plan/Base SHA record; worktree intent/call/observation; Begin intent/call/Executing observation; held-position publication | 6 |
| DS-07 | O047--O048 | Alice's capacity request; durable P2 application | 2 |
| DS-08 | O049 | coordinator process loss | 1 |
| DS-09 | O050--O057 | Journal reconstruction; current G1 read; accepted G1 publication; A1/C1/D1 passive projection reads; reconstructed state publication; exact `RunnableTransition` activation return | 8 |
| DS-10 | O058--O071 | refresh ownership; Alice's C close; notification; G2 read; G2 publication; A/D four focused current-fact reads; C1 Suspend intent/call/Executing response | 14 |
| DS-11 | O072--O074 | C1 Safe projection; Safe Journal/publication; C1 position release/retention | 3 |
| DS-12 | O075--O082 | Alice's exact Continue record; current graph read/publication; four focused B fact reads; waiting projection | 8 |
| DS-13 | O083--O089 | A1 terminal projection; terminal Journal record; terminal publication; A1 position release; B1 position binding; Resume intent/call/Executing response; held-position publication | 7 |
| **Total** | **Thirteen beats** | **89** |

The stable recovery denominator accepted now is:

- 13 delivery-story beats, all required and none after DS-13;
- one complete cassette-free occurrence inventory, whose exact count and total
  order remain unknown until the observed-order acceptance cut;
- 12 proposed capstone readiness controls plus companion stabilization control
  R12, each retained only if characterization proves it selects an already
  legal order;
- 31 classified ordering claims: 20 required happens-before, ten controlled
  readiness, and one serialized-after-arrival;
- 13 scenario-state assertions, one after each beat;
- eight production-correction verdict rows: six historical fixed-base retained
  groups, the accepted active-refresh replay, and #315 bounded fresh admission;
- six recovery checkpoints, C0 through C5;
- 20 consecutive complete runs with the identical accepted observed order;
- one focused package gate, then `pnpm check:all`, then the final
  `pnpm check:quint` required by the accepted recovery control.
- one binary completion event on one exact clean committed SHA; no partial
  substitute closes #268.

Before the observed-order acceptance cut, the occurrence count and remaining
implementation count are unknown; O089 is not a numerator or denominator. No
completion percentage may be reported. After that cut, a hang, timeout, or
partial trace is zero complete capstone runs, not partial completion.

## Crash, retry, and ambiguity

DS-08 is the one deliberate crash: after P2 is durable and before restart.
Same-host restart must reuse the Journal, exact worktrees, and executor session
locators. It must not send `Begin` or `Resume` while passively observing A1,
C1, or D1.

The capstone does not inject another lost mutation response. Claim, worktree,
executor-command, and publication ambiguity remains governed by the owning
scenarios and invariants above. Their focused tests remain required. Injecting
every predecessor crash into this one story would multiply stories and obscure
whether the thirteen-beat composition itself completes.

If the process dies at an unplanned point during a trial, that trial is not one
of the 20 completed repeats. Investigation must identify the first unresolved
intent and use the owning protocol's reconcile-before-retry behavior; the test
must not simply restart the entire cassette and accept duplicated effects.

## Visible and forbidden results

At DS-13 the maintained delivery result projects capacity two, B1 and D1
executing, A1 accepted, and C1 retained to Alice-facing presentation. It carries
one A1/B1/C1/D1 identity, one planned Base SHA, one worktree, and at most one
Begin plus the explicitly authorized B1 Resume for each applicable attempt.
The capstone verifies that presentation input, not a particular UI renderer.

Dalph must not:

- change production scheduling merely to match cassette order;
- admit more than configured capacity, except preserve the three already-held
  attempts when Alice lowers capacity from three to two;
- release B1 or C1 before that exact attempt publishes `Safe`;
- let passive restart reads consume capacity or issue another work command;
- admit fresh work ahead of already-selected exact B1 at DS-13;
- turn B1 into replacement B2, reuse another attempt's position, duplicate a
  claim/worktree/Begin/Resume, or infer success from C's closure;
- accept a graph revision beyond G2 or claim that the Run is terminal;
- after the observed-order acceptance cut, accept an incomplete trace, an
  unconsumed expected occurrence, an unexpected occurrence, or a different
  order as a passing strict cassette.

As stated in the delivery story, this capstone depends on but does not
independently demonstrate I9 (an executor report matches the attempt that asked
for it) or I11 (a released claim is the exact claim Dalph holds). Their focused
evidence remains separate; a passing capstone must not be reported as new model
coverage for either invariant.

## Scenario-to-test mapping required before implementation handoff

The existing `packages/dalph/test/cassettes/delivery-story-capstone.execution.test.ts`
is not this acceptance test: at the fixed base it exercises a different
ten-task double-diamond story. A green result from that test contributes zero
of the 13 beats and zero of the 20 required repeats here.

Implementation must add the test
`emits the exact DS01 through DS13 delivery checkpoint table` to
`packages/dalph/test/cassettes/delivery-story-capstone.execution.test.ts`.
That test must execute a new #268 catalog entry without reusing the existing
cached ten-task run. Its table carries these thirteen named assertion rows:

| Beat | Concrete outcome asserted by the named row |
|---|---|
| DS-01 | G0 selects A/B/C from five open tasks at capacity three. |
| DS-02 | A1/B1/C1 each have the exact Run/attempt/Base SHA/claim/worktree identity, one ordinal-1 Begin/Executing pair, and three held positions total. |
| DS-03 | Alice's F2 edit is accepted as G1 and causes no executor command. |
| DS-04 | The notification is absent; the bounded timer owns one G1 refresh; only B1 receives one Suspend and keeps its position. |
| DS-05 | Exact B1 Safe publishes before its release; B1 retains F1/F2, claim, attempt, and worktree and exposes Continue/Restart/Stop. |
| DS-06 | D1 begins only after B1 releases, and A1/C1/D1 hold three positions. |
| DS-07 | P2 lowers capacity to two without evicting A1/C1/D1. |
| DS-08 | The coordinator dies after P2 while exact executor sessions remain externally observable. |
| DS-09 | Restart reconstructs A1/C1/D1 held plus B1 retained, makes one current complete G1 observation before relying on E's current placement, performs only passive executor reads with zero Begin/Resume and zero additional-position admission, and settles exact `RunMustRemainActive(RunnableTransition)` without a second finality graph read before the later refresh. |
| DS-10 | C's non-success closure becomes G2; only C1 receives one Suspend and keeps its position while the same active refresh remains live for DS-11. |
| DS-11 | Exact C1 Safe publishes before its release; A1/D1 hold two positions and B1/C1 are retained. |
| DS-12 | Alice's exact Continue authorizes B1, but B1 waits with zero Resume while A1/D1 fill capacity two. |
| DS-13 | A1 Accepted publishes before release; exact B1 takes that position ahead of unstarted E and receives one Resume/Executing pair; no B2 exists. |

The same suite must also contain these independent top-level tests so one
failure cannot interrupt and falsely fail unrelated assertions:

- `refreshes B from the bounded timer when its notification is lost`;
- `reattaches three exact attempts after restart without Begin or Resume`;
- `returns RunnableTransition after strict restart projections before the later
  refresh`;
- `resumes retained B1 after A1 accepts and does not create B2`;
- `rejects each required issue 268 edge reversal`;
- `keeps active-work refresh before quiescence and stabilization after it`;
- `records the complete cassette-free controlled issue 268 occurrence order`;
- after the second acceptance cut, `consumes exactly the accepted issue 268
  occurrence inventory`;
- `repeats the complete issue 268 cassette twenty times with one identical
  order`.

The characterization and later cassette plan must use that exact file and
catalog seam or amend this accepted behavioral scenario before code changes.
It must first run without strict cursor expectations and publish the observed
order. It must also list the existing focused predecessor tests from #264--#269
that remain green; aggregate package totals do not substitute for these
thirteen rows.

Only after the new evidence is green may implementation update the
`DELIVERY-STORY.md` manifest rows DS-01--DS-13 from `NotImplemented` to the
exact catalog/test evidence. That update must also correct DS-05's stale wording
so it describes the missing composed evidence, not falsely claim that fixed-base
production lacks Restart. A catalog key or prose assertion without the passing
named test remains `NotImplemented`.

## Recovery checkpoints and stop rules

| Checkpoint | Measurable result | Maximum | On breach |
|---|---|---:|---|
| C0 — clean start | Clean worktree at the fixed base; focused smoke tests green | 2 hours | Diagnose only the environment; do not expand scope. |
| C1 — replay verdicts | The first seven production-correction ledger rows and the DS-05 choice characterization have cassette-free accept/reject results; the eighth #315 row separately satisfies its accepted return gate | 1.5 working days total; 0.5 day per group | Move an unproved group to its owning issue. |
| C2 — two acceptance cuts | C2a: the maintainer accepts the 13 outcomes, causal classifications, scope, and stop rules. C2b: a cassette-free controlled run publishes its complete observed order and the maintainer accepts that order as the cassette oracle | 1 working day for characterization plus review | A second rejected order triggers scope review; no strict cassette code and no production change to fit the order. |
| C3 — narrow cassette | One capstone cassette with only the accepted characterization controls consumes the accepted observed inventory once; the separate distinction test uses its accepted companion control | 1.5 working days | Classify the first mismatch before editing; any production edit invokes the production-proof rule. |
| C4 — repeatability | Twenty consecutive uncached full runs consume the identical accepted observed order and pass all 13 rows | 0.5 working day | One readiness-control reconsideration is allowed; another divergence freezes the lane. |
| C5 — completion | Focused predecessor/#268 tests, `pnpm check:all`, final `pnpm check:quint`, and fixed-base reviews are green on one exact clean SHA | 1 working day | Return to the owning checkpoint; do not call it a final small fix. |

At C3, a production workflow that cannot reach DS-13 without the strict
cassette receives at most one working day to isolate the first obstruction.
Only a small correction already required by a governing scenario can stay in
the lane; otherwise a separate accepted blocking issue owns it.

At C4, any failure resets the consecutive-run count and reports its first
divergent O identifier. A mismatch is classified as cassette adjustment,
missing readiness control, or production defect before code changes.

The outer recovery freezes after seven working days if #268 is not closed.
The report must state the last passed checkpoint, the first unresolved
occurrence, elapsed time at that checkpoint, and the owner/issue for every
remaining blocker. It must not report “almost done” without those facts.
Before C5, reports must not say “close,” “last failure,” “last cycle,”
“implementation complete,” a completion percentage, or a short completion ETA.
They may report only the exact checkpoint, passed/failed scenario rows, the
first visible blocker, and “remaining count unknown” where that is true.
