# What Effect Workflow was actually evaluated for

**Research date:** 2026-08-20
**Scope:** reconstruct the decision behind issues
[#232](https://github.com/dearlordylord/dalph/issues/232),
[#233](https://github.com/dearlordylord/dalph/issues/233), and
[#234](https://github.com/dearlordylord/dalph/issues/234) from their accepted
issue text, first-party follow-ups, repository evidence, and pinned Effect
source. This note changes no Dalph runtime behavior.

## The correction in one sentence

> **Effect Workflow was evaluated as the first candidate to replace Dalph's
> home-grown durable-computation machinery—Journal-driven continuation, replay,
> and restart coordination across a Run—not as a worktree-reconciliation
> feature.**

Worktree reconciliation was the final, deletion-constrained tracer experiment:
after earlier experiments showed that Workflow could replay durable work but
could not replace the Journal's accepted Run chronology, #234 tested whether
the next accepted placement below the delivery-action seam could at least delete a concrete slice of
custom restart procedure. It could not. That local result is the reason for
the candidate-level stop, not the original question. [The governing #232
problem statement and solution](https://github.com/dearlordylord/dalph/issues/232);
[`research/effect-workflow-usability-prestudy.md:19-44`](../../research/effect-workflow-usability-prestudy.md);
[#233's post-experiment correction](https://github.com/dearlordylord/dalph/issues/233#issuecomment-5351765755);
[#234's deletion test](https://github.com/dearlordylord/dalph/issues/234).

The report originally reversed that hierarchy. Its first recommendation was
“Do not adopt Effect Workflow for worktree reconciliation,” which made the
tracer look like the architectural subject. The corrected report now begins
with the durable-computation replacement question, then shows why the worktree
case became its decisive deletion test
([`workflow-vs-current-report.html`](workflow-vs-current-report.html)).

## Chronological reconstruction

### 1. The original problem was Dalph's custom durable computation

Dalph currently persists an ordered Journal of workflow occurrences. On Run
entry it validates and reduces that history, reconstructs outstanding
responsibilities and process-local state, then obtains current facts from the
systems that own them. It records intent before ambiguity-crossing effects and,
after process loss, rereads the owning boundary before retrying. This is a
durable-computation system assembled from the Journal plus Dalph-specific
reconstruction and coordination code, not merely a worktree recovery routine.
[`docs/ARCHITECTURE.md:134-180`](../../docs/ARCHITECTURE.md);
[`docs/CONTEXT.md:347-399`](../../docs/CONTEXT.md).

Issue #143 first authorized a narrow `effect/unstable/workflow` spike to test
whether an industry runtime could remove material lifecycle code while Dalph
retained one Journal authority, one semantic trace, and fresh tracker/Git/
executor reads. It explicitly called this evaluation rather than adoption.
[#143 handoff](https://github.com/dearlordylord/dalph/issues/143#issuecomment-5338082759);
[#143 archived runtime evidence](https://github.com/dearlordylord/dalph/issues/143#issuecomment-5342627197).

The project owner then deliberately reopened the “Journal must remain”
constraint. The governing Wayfinder #232 asked whether an industry durable
runtime could own continuation, replay, waits, and remembered results so Dalph
could retain only domain evidence independently required for correctness and
explanation. Both complete Journal replacement and Workflow plus a smaller
semantic occurrence log were allowed outcomes.
[#143 correction](https://github.com/dearlordylord/dalph/issues/143#issuecomment-5345374326);
[#232 problem statement](https://github.com/dearlordylord/dalph/issues/232);
[`research/effect-workflow-usability-prestudy.md:19-38`](../../research/effect-workflow-usability-prestudy.md).

### 2. Why Effect Workflow was the first candidate

The evaluation was solution-neutral; Effect Workflow was first because Dalph
already used Effect V4 and therefore it had the least initial integration
distance. The harness was intentionally reusable for another candidate if the
owner approved a pivot. Restate, DBOS, and Temporal were the named later
comparisons, not conclusions already rejected by the Workflow experiments.
[#232 solution and proposed work graph](https://github.com/dearlordylord/dalph/issues/232);
[`research/effect-workflow-usability-prestudy.md:40-44`](../../research/effect-workflow-usability-prestudy.md);
[`research/effect-workflow-usability-prestudy.md:300-340`](../../research/effect-workflow-usability-prestudy.md).

The hypothesized leverage was specific:

- derive one stable Workflow execution identity from one exact Dalph Run;
- persist requests and named Activity results in SQL;
- replay the handler after process loss;
- reuse completed nondeterministic results rather than call the boundary again;
- potentially replace Dalph's custom Run establishment, reconstruction,
  continuation records, and manual wake/retry plumbing.

The pinned Effect surface supported typed payload/result/error schemas,
payload-derived execution identity, named Activities, durable execution, and
stored Activity replies. It did **not** automatically supply current external
authority or reconcile an outside effect whose result was lost before Activity
storage. [`research/effect-workflow-usability-prestudy.md:46-81`](../../research/effect-workflow-usability-prestudy.md);
[`research/effect-workflow-usability-prestudy.md:258-298`](../../research/effect-workflow-usability-prestudy.md);
[pinned Effect `Workflow.ts`](https://github.com/Effect-TS/effect/blob/effect%404.0.0-beta.106/packages/effect/src/unstable/workflow/Workflow.ts#L45-L186);
[pinned Effect `Activity.ts`](https://github.com/Effect-TS/effect/blob/effect%404.0.0-beta.106/packages/effect/src/unstable/workflow/Activity.ts#L123-L200).

The evaluation criterion was therefore not “can Workflow successfully run a
worktree Activity?” It was: can Workflow preserve Dalph's failure behavior and
fresh-authority rules **while deleting enough lifecycle machinery to justify
its own store, identities, schemas, versioning, and operational surface?**
[`research/effect-workflow-usability-prestudy.md:79-81`](../../research/effect-workflow-usability-prestudy.md);
[`research/effect-workflow-usability-prestudy.md:351-378`](../../research/effect-workflow-usability-prestudy.md);
[`research/effect-workflow-usability-prestudy.md:462-505`](../../research/effect-workflow-usability-prestudy.md).

### 3. What #232 established before any worktree tracer

The #232 prototype compared the current Journal-backed implementation with a
SQL-backed Workflow-only implementation under the same exact identities,
controlled outside facts, real child-process faults, call ledger, and canonical
trace contract. [`prototypes/durable-computation/README.md:1-23`](../durable-computation/README.md).

The Workflow-only arm passed the five accepted scenarios without a Dalph
Journal or reduced semantic log: lost mutation reply, recorded mutation reply,
changed facts during downtime, process-wide Exit cutoff, and incompatible code
recovery. It kept one exact Run and produced a canonical trace equivalent to
the Journal baseline for the tested claim chronology. This was positive
evidence: Effect Workflow remained viable, but the prototype did not prove that
all Journal variants or production lifecycle code were deletable.
[`prototypes/durable-computation/evidence.md:15-42`](../durable-computation/evidence.md).

The experiment also located the division of responsibility. Effect owned
stable execution identity, SQL request/result persistence, handler replay, and
completed Activity-result reuse. Dalph still owned exact identity mapping,
read-before-create reconciliation after ambiguity, disabling unsafe Activity
retry, deliberately fresh tracker reads, process-wide Exit, code-version
routing, and live Git/worktree/executor ownership and cleanup.
[`prototypes/durable-computation/evidence.md:135-170`](../durable-computation/evidence.md).

That matters to the report's tone: Workflow did not “fail to do recovery.” It
successfully supplied a durable-execution kernel for the tested chronology. The
open question was whether that kernel could replace enough of Dalph's complete
architecture rather than sit beside it.
[`prototypes/durable-computation/evidence.md:231-237`](../durable-computation/evidence.md).

### 4. What #233 learned, and what its correction changed

Issue #233 moved the candidate through the real production-shaped loop:
unchanged `delivery` description → ordinary planning → process-local runtime →
`DeliveryActionExecutor` → exact `OperationId`-named Activity → decoded result
publication → recomputed delivery consequence. It proved stored-result replay,
fresh post-restart reads, separation of two action identities, and equivalent
domain consequences while keeping Workflow/storage vocabulary out of
description and planning.
[#233 accepted scenarios and criteria](https://github.com/dearlordylord/dalph/issues/233);
[`prototypes/durable-computation/code-shape-evaluation.md:184-233`](../durable-computation/code-shape-evaluation.md).

The first #233 reading was encouraging: preserve the domain-coloured
`delivery` composition and add a provider-neutral accepted-observation input so
both the Journal and Workflow adapter could republish results. It also exposed
an exact identity requirement: two Activities with the same name in one
Workflow execution collide, so each durable domain action needs a stable name
derived from its exact `OperationId`.
[`prototypes/durable-computation/evidence.md:239-274`](../durable-computation/evidence.md);
[`prototypes/durable-computation/evidence.md:396-414`](../durable-computation/evidence.md).

A subsequent production-type examination corrected the first conclusion.
`JournaledTrackerGraphObservation` is not an accidental storage brand: private
construction proves that a complete/reconfirmed graph observation entered one
valid, gap-free Run chronology, and `JournalPosition` orders it against the
other accepted facts. A raw Workflow Activity result has no position in that
chronology and cannot publish directly into `delivery` or mint equivalent
authority. The provider-neutral replacement type was therefore rejected, and
the Journal remained the sole accepted Run chronology.
[#233 post-experiment correction](https://github.com/dearlordylord/dalph/issues/233#issuecomment-5351765755).

This correction narrowed the viable Workflow architecture. Instead of replacing
Journal-owned durable computation, Workflow could only sit below the existing
delivery-action seam, durably execute/replay a result, and then return that
result to the still-required Journal publication and fresh-read machinery. The
next question was no longer whether replay worked—it did—but whether this
narrower placement deleted any meaningful custom recovery procedure.
[#233 post-experiment correction](https://github.com/dearlordylord/dalph/issues/233#issuecomment-5351765755);
[#234 corrected architectural premise](https://github.com/dearlordylord/dalph/issues/234).

### 5. Why worktree reconciliation was chosen

Worktree reconciliation was a tracer bullet for **deletion leverage** in the
remaining placement, not the strategic object of adoption. It was useful
because current production has a small, explicit, inspectable restart procedure:

1. recovered action routing dispatches `ReconcileTaskWorktree` to
   `recoverTaskWorktreeOperation`;
2. that function rereads the Journal to find the exact retained
   `TaskWorktreeReconciliationIntended` event; and
3. it manually reinvokes the existing worktree reconciliation interpreter under
   the delivery-action execution lease.

[`packages/orchestrator/src/coordination/delivery/recovered-delivery-action-adapter.ts:38-45`](../../packages/orchestrator/src/coordination/delivery/recovered-delivery-action-adapter.ts);
[`packages/orchestrator/src/coordination/frontier/recovery.ts:30-47`](../../packages/orchestrator/src/coordination/frontier/recovery.ts).

It also contains exactly the hard durable-execution seam under study: Git may
apply creation before Dalph stores the result, so restart must reread Git before
another create; if the Activity result was stored, Workflow should replay it;
and if Git changes during downtime, the next current decision still needs a
fresh Git observation. The fixture could exercise both durable-store orderings
with a controlled `GitWorktree` adapter and real `SIGKILL`, without touching a
real repository, physical worktree, GitHub, or executor.
[#234 operational scenarios](https://github.com/dearlordylord/dalph/issues/234).

Most importantly, #234 named the candidate deletion targets in advance:
`recoverTaskWorktreeOperation`, retained-intent lookup/manual reinvocation, and
route-specific interruptible-result recovery. The Git read/create/reread
protocol, Journal intent/outcome facts, exact resource qualification, fresh
authority rules, process-local admission, and Application Exit were explicit
non-targets. Target promotion could be considered only after a worktree **go**.
That makes the worktree case a deliberately narrow gate with a falsifiable code-
deletion criterion.
[#234 deletion test and decision rule](https://github.com/dearlordylord/dalph/issues/234).

### 6. What #234 actually proved

The experiment proved all three local recovery cuts under controlled facts:

- When Git creation applied but the Activity result was not stored, the
  restarted Activity reread Git, observed the exact ready worktree, and did not
  create twice. The existing Git reconciliation protocol—not Workflow replay—
  supplied safety in this cut.
- When the Activity result was stored before Journal outcome publication,
  Workflow replayed the result without another controlled Git call. Dalph still
  had to append and reduce the Journal before the proposal disappeared.
- When current Git facts changed during downtime, Workflow replayed historical
  readiness, but a fresh Git read made the current decision wait/fail closed and
  no executor boundary was contacted.

[`prototypes/workflow-worktree-reconciliation/README.md:23-35`](README.md);
[`prototypes/workflow-worktree-reconciliation/README.md:76-87`](README.md);
[`prototypes/workflow-worktree-reconciliation/README.md:89-99`](README.md).

The deletion result was negative. The existing dispatcher, retained-intent
lookup/manual reinvocation, route-specific interruption responsibility, Journal
intent/outcome publication, and fresh Git decision remained. The candidate
added a Workflow store, payload/result identity and schemas, error transport,
fault hooks, ledgers, inventory, and tests. Under #234's preaccepted rule, this
was a no-go because the remaining Workflow placement added more concepts and
test surface than it removed.
[`prototypes/workflow-worktree-reconciliation/README.md:101-134`](README.md);
[#234 completion evidence](https://github.com/dearlordylord/dalph/issues/234#issuecomment-5356920837).

The implication for the **original** evaluation is:

> Workflow's durable replay capability is real, but in Dalph's corrected
> architecture it cannot replace the accepted Journal chronology; once placed
> below that chronology, the tested recovery slice showed no net lifecycle-
> deletion leverage. The evidence therefore does not justify adopting Effect
> Workflow as Dalph's durable-computation runtime, and #234's stopping rule says
> not to continue to the next Workflow tracer.

Issue #232 remains the parent owner-decision record; the prototype did not
itself integrate code, adopt a runtime, start a successor candidate, or close
the parent. [#232 accepted handoff](https://github.com/dearlordylord/dalph/issues/232#issuecomment-5345462328);
[#232 status after #234](https://github.com/dearlordylord/dalph/issues/232#issuecomment-5356920332).

## What #234 does not decide

The report should put these limits beside the recommendation, not bury them in
an appendix:

| Claim | Supported? | Correct reading |
| --- | --- | --- |
| “Workflow has no value.” | **No.** | #232 and #234 directly demonstrated durable execution and stored Activity-result replay. [`prototypes/durable-computation/evidence.md:15-25`](../durable-computation/evidence.md); [`README.md:28-35`](README.md). |
| “Workflow cannot fit below Dalph's domain-coloured architecture.” | **No.** | #233 completed the production-shaped loop without leaking Workflow vocabulary into `delivery` or planning. The later correction rejected its authority translation, not its executable fit. [#233](https://github.com/dearlordylord/dalph/issues/233); [#233 correction](https://github.com/dearlordylord/dalph/issues/233#issuecomment-5351765755). |
| “Workflow replaces external idempotency and reconciliation.” | **No.** | The unstored-result cut still needed read/create/reread, and current decisions still needed fresh authority reads. [`README.md:28-35`](README.md). |
| “Effect Workflow is broken or unsafe.” | **No.** | The pinned engine behaved correctly in the supported scenarios. The no-go came from insufficient deletion leverage after retained responsibilities, not an engine correctness failure. [`prototypes/durable-computation/evidence.md:17-25`](../durable-computation/evidence.md); [`README.md:120-134`](README.md). |
| “No durable-workflow runtime can help Dalph.” | **No.** | #232 is solution-neutral and names later candidates; none was prototyped by #234. [#232](https://github.com/dearlordylord/dalph/issues/232); [`research/effect-workflow-usability-prestudy.md:300-340`](../../research/effect-workflow-usability-prestudy.md). |
| “Never use Effect Workflow anywhere in Dalph.” | **No.** | The accepted result stops this candidate evaluation and rejects this prototype as Dalph's durable-computation replacement. A materially different future problem would need its own accepted evidence; #234 did not evaluate every possible subsystem or use. [#234](https://github.com/dearlordylord/dalph/issues/234). |
| “Adopt Workflow for everything except worktrees.” | **No.** | Worktrees were the deletion gate for the next accepted retained-Journal placement after the chronology correction. Failing that gate stopped successor Workflow experiments; it was not a carve-out preserving broader adoption. [#233 correction](https://github.com/dearlordylord/dalph/issues/233#issuecomment-5351765755); [#234](https://github.com/dearlordylord/dalph/issues/234). |
| “The current architecture has been finally selected by the prototype alone.” | **Not yet.** | #234 supplies a no-go recommendation under its rule; #232 remains open for the project owner's step-4 decision. [#232 accepted handoff](https://github.com/dearlordylord/dalph/issues/232#issuecomment-5345462328); [#232 status](https://github.com/dearlordylord/dalph/issues/232#issuecomment-5356920332). |

The precise distinction is:

- **Supported local conclusion:** “Do not adopt Workflow for this
  worktree-reconciliation placement; it does not delete the recovery procedure
  it was meant to supersede.”
- **Supported candidate implication:** “Current evidence does not justify
  Effect Workflow as Dalph's durable-computation replacement; stop this
  candidate's evaluation under #234's accepted rule.”
- **Unsupported universal conclusion:** “Workflow has no value,” “Workflow is
  unsafe,” or “Effect Workflow must never be used for any future Dalph problem.”

## Correct conclusion hierarchy

The report should make the nesting explicit:

| Level | Question or finding | Governing evidence |
| --- | --- | --- |
| **Strategic question** | Can an industry durable-computation runtime replace all or most of Dalph's Journal-backed continuation, replay, and reconstruction machinery while preserving semantic history, fresh authority, and Exit? | [#232](https://github.com/dearlordylord/dalph/issues/232); [`prestudy:351-360`](../../research/effect-workflow-usability-prestudy.md) |
| **Candidate hypothesis** | Effect Workflow may supply stable execution identity, SQL replay, and remembered Activity results with the least integration distance. | [`prestudy:40-55`](../../research/effect-workflow-usability-prestudy.md) |
| **Evaluation criterion** | Correctness is mandatory; favorable means material lifecycle deletion or a measured operational gain that justifies the added store and concepts. | [`prestudy:462-505`](../../research/effect-workflow-usability-prestudy.md) |
| **Broad tracer result (#232)** | Workflow-only reproduced the narrow Run/claim chronology without a Journal and remained viable; many production responsibilities remained untested. | [`durable evidence:15-42`](../durable-computation/evidence.md) |
| **Architectural-fit result (#233)** | Workflow replay fit below the real executor seam, but accepted result publication exposed Journal chronology semantics that a raw Activity result could not replace. | [#233](https://github.com/dearlordylord/dalph/issues/233); [correction](https://github.com/dearlordylord/dalph/issues/233#issuecomment-5351765755) |
| **Deletion tracer (#234)** | With Journal chronology retained, use controlled worktree reconciliation to test whether Workflow makes explicit restart code deletable. | [#234](https://github.com/dearlordylord/dalph/issues/234) |
| **Local result** | Replay worked; the existing recovery duties remained and Workflow added more machinery. No-go for the tested placement. | [`README.md:101-134`](README.md) |
| **Candidate implication** | Do not proceed to target promotion or another Workflow tracer; present the evidence to the #232 owner decision. | [#234](https://github.com/dearlordylord/dalph/issues/234); [#232 status](https://github.com/dearlordylord/dalph/issues/232#issuecomment-5356920332) |

## Recommended first screen

### Best first sentence

> **We evaluated Effect Workflow as a possible replacement for Dalph's
> home-grown durable-computation layer—the Journal-backed continuation, replay,
> and restart coordination for an entire Run.**

### Recommended follow-up

> It proved that SQL-backed Workflow can survive process loss and replay stored
> Activity results. But Dalph's accepted Run chronology still requires the
> Journal, and the remaining below-Journal placement failed its concrete
> deletion test: it retained the recovery responsibilities and added another
> store, identities, schemas, and test surface. The evidence therefore does not
> justify adopting Workflow as Dalph's durable-computation runtime; #234's
> worktree experiment was the final deletion gate, not the original objective.

### Better title and headline

- Document title: **Can Effect Workflow replace Dalph's durable-computation
  machinery?**
- Headline: **Replay worked. Replacement leverage did not.**
- Verdict label: **No-go for Effect Workflow as Dalph's durable-computation
  replacement**
- Scope note beside the verdict: **Candidate-level recommendation under
  #232/#234; not a claim that Workflow has no value or can never serve a
  different future problem.**

## Alternative report outline

The report should support a one-minute reader without making the narrow tracer
the frame for everything that follows:

1. **The decision being made**
   State the strategic durable-computation replacement question, the current
   Journal/reconstruction baseline, and the candidate-level verdict.
2. **What was evaluated, in 60 seconds**
   A five-step timeline: #143 authorization → #232 Workflow-only proof → #233
   real-loop fit → #233 chronology correction → #234 deletion gate.
3. **What Workflow genuinely contributed**
   Stable execution identity, SQL-backed handler replay, stored Activity-result
   reuse, and versioned failure evidence. Do not present the candidate as a
   failed demo.
4. **What Dalph still had to own**
   Accepted Journal chronology, domain evidence, intent/effect/observation,
   read-before-retry reconciliation, fresh external reads, process-local
   ownership/admission, and Application Exit.
5. **Why the worktree experiment was decisive**
   Name the existing deletion targets and show why worktrees exercise both
   ambiguous-result and stored-result crash cuts without a live provider.
6. **The three #234 traces**
   Preserve the current chronological visualizations and negative controls, now
   clearly labeled as the deletion tracer rather than the full comparison.
7. **Deletion and operational balance sheet**
   Removed / retained / added / duplicated responsibilities, plus storage,
   versioning, diagnostics, and test-surface costs.
8. **Decision and scope**
   State the candidate-level no-go, the #232 owner-decision boundary, what the
   evidence rules out, and what it does not claim.
9. **Deep evidence appendix**
   Exact identities, SQL inventory, tests, source links, gates, limits, and
   reviewer record.

The existing worktree scenario cards, authority table, deletion ledger,
negative controls, and evidence matrix remain useful. They need a higher-level
opening and timeline—not removal—so a reader understands what question those
details answered.
