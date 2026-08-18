# Promote and settle the candidate reported by the outer Integrator

Issue: [Migrate promotion and finality to Integrator evidence](https://github.com/dearlordylord/dalph/issues/223)

Status: accepted on 2026-08-14 and blocked by issue #222. This scenario
replaces the obsolete target-verification premise in issues #60, #61, #76,
and #141. Their exact compare-and-set, reconciliation, tracker-completion,
claim-cleanup, and dependant-release behavior remains in force.

## The reported and Git-qualified candidate reaches promotion

### Starting situation

No person directly triggers this work. Run R's exact planned attempt T for task
A, at task revision fingerprint F, produced accepted result C. The Journal
contains A's durable integration responsibility and queue/start positions.
Dalph gave outer Integrator session S and its isolated candidate resource W the
fixed target ref at head H and accepted result C. The Integrator explicitly
reported candidate M, and Git subsequently proved that M is a commit whose
complete ordered direct parents are exactly `[H, C]`. A fresh complete tracker
observation reports exact active claim K and no unfinished prerequisite for A.
There is no promotion, completion-claim, task-completion, or cleanup intent.

The relevant systems are Dalph, the injected Integrator, Git, the task tracker,
the evidence store, and Dalph's Journal. The Integrator owns its private review,
test, correction, and provider history. Git alone owns object, parent, ancestry,
and ref facts. The tracker owns task lifecycle, dependencies, and claims. The
evidence store owns immutable content-addressed bytes. The Journal owns only
the ordered workflow history.

### Chronology

1. Ordinary delivery selects A's integration responsibility when its per-target
   queue position is first and the exact target's process-local position is
   available. S's recorded Integrator result identifies M for promotion.
2. Dalph derives one promotion request P from the accepted-result evidence,
   S's exact Integrator result, Git's qualification of M against fixed H and C,
   and the target. If that Integrator result contains evidence references,
   Dalph rereads and schema-validates those immutable envelopes; it does not
   invent an evidence requirement that the Integrator contract did not return.
3. Dalph records P's intent and numbered attempt intent before crossing the Git
   mutation boundary.
4. Dalph freshly reads the target and M's ancestry. Only exact current H permits
   the first atomic `H -> M` compare-and-set.
5. Git applies the exact compare-and-set. Dalph records the observed promotion
   proof binding P, S, H, C, M, ordered parents `[H, C]`, and every actual
   evidence reference from step 2.
6. Dalph freshly reads A's exact current claim and revision fingerprint. Only
   exact K and F authorize a replacement attempt. It records one deterministic
   completion-claim replacement intent and a numbered attempt intent before
   asking the tracker to replace K with completion claim KC. Exact KC on a
   reconciliation read proves prior application; foreign, mismatched, or
   unreadable claim facts wait. The replacement protocol makes at most three
   mutation attempts.
7. Before constructing the task-completion request, Dalph asks the evidence
   store to reopen the accepted-result reference and every evidence reference
   actually returned by the Integrator. It decodes their exact schemas and
   checks their C, M, S, and predecessor bindings. A Journal row or promotion
   proof does not substitute for these bytes.
8. Dalph rereads A's focused tracker facts, including exact KC and F, and M's
   current target ancestry. It records deterministic completion request Q and
   its numbered attempt intent, then asks the tracker to complete exact A. Q
   makes at most three mutation attempts, each separated from an ambiguous
   predecessor by the reconciliation described below.
9. A later focused tracker observation, not the mutation acknowledgement,
   reports A `CompletedSuccessfully`. Dalph may then reconcile deletion of the
   exact completion claim and settle A's integration responsibility.
10. A distinct later complete tracker-graph observation reports A successful
   before any dependant is released.

The maintainer sees the same successful delivery outcome: exact M is promoted,
A is confirmed successful, and dependants become eligible only after the later
complete graph read. Dalph must not promote from process success, candidate
resource HEAD, equivalent content, an unreported commit, a legacy
target-verification event or manifest, or evidence bytes without the matching
Integrator result and Git proof. It must not expose Integrator-private stages,
force the ref, infer tracker success from an acknowledgement, or release a
dependant from the focused task read.

### Crash and repeated activation

If Dalph disappears after an intent but before a boundary result is durable,
restart reconstructs the same request identity and reconciles the relevant
authority before another mutation. Once promotion, exact completion-claim
replacement, focused task success, claim deletion, or settlement is recorded,
repeated activation reuses that fact and does not allocate a replacement
candidate, session, claim, or request.

### Scenario-to-test mapping

- `packages/orchestrator/src/workflow/protocols/target-promotion/outer-protocol.test.ts::promotes exact M once and records its Integrator correlation and ancestry`
- `packages/orchestrator/src/workflow/protocols/integrator/protocol.test.ts::successful preparation returns only the Git-qualified canonical M`
- `packages/dalph/test/cassettes/scenario.test.ts::records one outer Integrator result and exact Git parents for M`
- `packages/dalph/test/cassettes/scenario.test.ts::promotes Git-qualified M by exact compare-and-set and records exact ancestry`
- `packages/orchestrator/src/workflow/protocols/integration-finality/protocol.test.ts::requires exact promotion success before replacing the active claim`
- `packages/dalph/test/cassettes/scenario.test.ts::replaces the exact active claim with a promotion-bound completion claim`
- `packages/orchestrator/src/workflow/protocols/integration-finality/completion-task-protocol.test.ts::completes exact A only after current authorization and durable request intents`
- `packages/orchestrator/src/workflow/protocols/integration-finality/completion-task-protocol.test.ts::rereads accepted-result and Integrator-returned evidence before task completion`
- `packages/orchestrator/src/workflow/protocols/integration-finality/completion-task-protocol.test.ts::malformed, missing, and foreign accepted-result evidence stop before tracker completion mutation`
- `packages/orchestrator/src/workflow/protocols/integration-finality/protocol.test.ts::deletes only the exact completion claim after actual fresh success and settles once`
- `packages/dalph/test/cassettes/scenario.test.ts::Dalph confirms A before a later graph read releases B`
- `packages/orchestrator/src/coordination/delivery/delivery.test.ts::keeps B out of actual proposals after settlement until focused A success precedes the releasing graph`
- `packages/dalph/test/cassettes/recorded-outer-integrator.test.ts::records and round-trips every outer Integrator occurrence with causal correlation and renaming`
- Negative controls: `packages/orchestrator/src/workflow/protocols/target-promotion/outer-protocol.test.ts::process success cannot authorize promotion without an Integrator result`, `packages/orchestrator/src/workflow/protocols/target-promotion/outer-protocol.test.ts::candidate resource HEAD cannot authorize promotion without an Integrator report`, `packages/orchestrator/src/workflow/protocols/target-promotion/outer-protocol.test.ts::equivalent content cannot authorize promotion without exact M ancestry`, and `packages/orchestrator/src/workflow/protocols/target-promotion/outer-protocol.test.ts::legacy target-verification evidence cannot authorize promotion`.
- Deferred: #68 owns a conclusive non-success's stale-session and successor-session direction; #138 owns full tracker-blocker reconciliation; #225 owns removal of the remaining legacy implementation. This scenario asserts only the successful Integrator/Git/promotion/finality path and its forbidden alternatives.

## An ambiguous or stale promotion preserves the exact work

### Starting situation

P is durable for the same R, T, S, W, H, C, and M. Either Git's
compare-and-set response was lost, or another actor advanced the target to H2.
The Integrator result, Git qualification, accepted-result evidence, any
Integrator-returned evidence, candidate-resource edits, and integration
history remain immutable and readable. A process-local target position may
have vanished in a crash.

### Chronology

1. Before another update, Dalph asks Git for the exact target head and whether
   M is that head or its ancestor.
2. Exact M ancestry records the same promotion proof without another update.
   A readable different head that does not contain M records a stale result,
   preserves S, W, H, C, M, its evidence, and its integration history, and
   sends no update.
3. Only a fresh exact-H read may authorize the next numbered attempt of the
   same P. At most three compare-and-set attempts cross the boundary; a fourth
   is forbidden across both live execution and restart.
4. Unreadable or contradictory Git facts authorize no update. Dalph releases
   only the process-local target position while retaining the durable logical
   responsibility. Work for another target remains eligible.
5. The stale-session direction and successor rules proceed only through issue
   #68. Issue #223 neither force-updates H2 nor creates a successor Integrator
   session. Issue #138 consumes the preserved proof when its tracker-blocker
   chronology applies.

The maintainer sees a discovered promotion, a stale-head wait, an unreadable
Git wait, or typed non-convergence. Dalph must not rerun the Integrator, rebuild
M, substitute H2, persist a physical target permit, discard evidence, or treat
a Journal record as Git authority.

### Crash and repeated activation

Restart reconstructs consumed attempt ordinals and the same P from the Journal.
It performs the required Git read before any possible retry. A response lost
after Git applied M is reconciled as exact ancestry; a crash after attempt three
cannot reopen an update attempt.

### Scenario-to-test mapping

- `packages/dalph/test/cassettes/scenario.test.ts::discovers M in current target ancestry after losing the promotion response`
- `packages/dalph/test/cassettes/scenario.test.ts::reconciles a lost promotion response and never sends a fourth request`
- `packages/dalph/test/cassettes/scenario.test.ts::records stale H2 and never overwrites it`
- `packages/dalph/test/cassettes/scenario.test.ts::waits without another request when Git cannot be read`
- `packages/dalph/test/cassettes/scenario.test.ts::keeps another target usable while M promotion waits and releases only M when it settles`
- `packages/orchestrator/src/workflow/protocols/target-promotion/outer-protocol.test.ts::reads before retrying an ambiguous exact-head promotion and never sends a fourth attempt`
- `packages/orchestrator/src/workflow/protocols/target-promotion/outer-protocol.test.ts::records non-convergence after three ambiguous attempts and sends no fourth request`
- `packages/orchestrator/src/workflow/protocols/integrator/protocol.test.ts::a Git read failure leaves its intent and restart rereads Git without rerunning Integrator`
- `packages/orchestrator/src/workflow/protocols/integrator/protocol.test.ts::a later ordinary activation with a different H fails closed without a new session or call`
- `packages/orchestrator/src/coordination/reconstruction/target-promotion-history.test.ts::accepts promotion intent only after the exact Integrator Git qualification`
- `packages/orchestrator/src/coordination/reconstruction/target-promotion-history.test.ts::requires numbered attempts and terminal proof to follow the same outer request`
- Negative controls: `packages/orchestrator/src/authorities/git/real-git-qualification.test.ts::reads real compatible, equivalent-content, rewritten, and unrelated target lineage without mutation` and `packages/orchestrator/src/workflow/protocols/target-promotion/outer-protocol.test.ts::rejects changed ordered parents before a candidate can become a promotion correlation`.
- Deferred: #68 owns stale-session and successor rules after the stale fixed-head disposition; #138 consumes the preserved proof when its blocker chronology applies; #225 owns final removal of legacy target-verification/candidate-agent paths. No retry, fourth request, H2 overwrite, or Integrator rerun is accepted here.

## A tracker blocker pauses the exact promotion or finality seam

### Starting situation

Run R retains A's exact integration responsibility, S, W, H, C, M, Git
qualification, and evidence. A fresh complete tracker observation now reports
an unfinished prerequisite for A. This can happen before P crosses Git, or
after Git has durably proved M promoted but before A is completed. A later
same-target integration responsibility and unrelated work on another target
are both present.

### Chronology

1. Dalph records the tracker observation and sends no new Git or tracker
   mutation for A. Before promotion it preserves the unpromoted M; after
   promotion it preserves the exact promotion proof and never invokes the
   Integrator again.
2. Dalph releases A's process-local target position. A remains the durable
   logical blocker for later work on the same target, while the unrelated
   target may continue.
3. After a later complete tracker observation reports the blocker cleared,
   Dalph freshly reads Git. Before promotion, exact H and the same qualified M
   permit the existing P chronology; changed H delegates disposition to #68
   without reusing M. After promotion, exact M ancestry permits finality to
   resume without another Integrator or compare-and-set call.
4. Issue #138 owns the full blocker reconciliation state and implementation;
   #223 defines the corrected Integrator/promotion evidence that survives and
   the finality seam it resumes.

The maintainer sees A waiting while unrelated work continues. Dalph must not
discard S, W, M, evidence, or promotion proof; persist or restore the physical
target position; admit later same-target work past A; roll Git back; rerun the
Integrator after promotion; or treat blocker disappearance as fresh Git proof.

### Crash and repeated activation

Restart reconstructs the wait without target ownership. It obtains a new
complete tracker observation and the required fresh Git observation before any
resumed boundary call. Repeated unchanged blocker observations perform no
mutation.

### Scenario-to-test mapping

- `packages/dalph/test/cassettes/scenario.test.ts::preserves the Git-qualified candidate and releases integration when a blocker appears before promotion`
- `packages/dalph/test/cassettes/scenario.test.ts::delegates changed H after a cleared blocker without reusing M or creating S2`
- `packages/dalph/test/cassettes/scenario.test.ts::restarts after a durable blocker read with the candidate and queue history intact`
- `packages/dalph/test/cassettes/scenario.test.ts::durably waits after an unreadable blocker restart read and resumes only on later complete facts`
- `packages/dalph/test/cassettes/scenario.test.ts::preserves promotion proof and waits before tracker completion on a new blocker`
- `packages/dalph/test/cassettes/scenario.test.ts::preserves promoted M across a post-promotion blocker and resumes its same finality proof after clear`
- `packages/orchestrator/src/workflow/protocols/integration-admission/protocol.test.ts::preserves same-target order while a blocker wait leaves another target usable`
- `packages/orchestrator/src/coordination/delivery/run-delivery-runtime.test.ts::keeps A as an unreadable Git wait while independent B executes its proposal`
- Negative controls: `packages/orchestrator/src/workflow/protocols/integration-admission/protocol.test.ts::releases stale and non-convergent promotions from the exact held responsibility` and `packages/orchestrator/src/coordination/delivery/recovered-settlement-relation.test.ts::legacy candidate construction cannot authorize an outer Integrator release`.
- Deferred: #138 owns the complete blocker state machine and its successor handling; #68 owns changed-H stale/successor disposition. #223 preserves the exact session, qualified M, evidence, and promotion proof and never rolls Git back, reruns the Integrator, or admits same-target work past A.

## A lost task-completion response is reconciled before Q repeats

### Starting situation

Run R's exact attempt T and task revision F are bound to promoted M and current
completion claim KC. Dalph recorded Q and one numbered tracker-completion
attempt before making the call, but the response was lost. The tracker may
have applied Q, a person may have changed A afterward, or the call may never
have arrived.

### Chronology

1. Dalph freshly reads exact A and the exact request result where the tracker
   supports that lookup. A focused observation of `CompletedSuccessfully`
   records success and sends no second completion request.
2. Open lifecycle alone does not prove that the request was absent. Only a
   positive `NotApplied` result for the exact request, followed by fresh
   tracker and Git authorization facts, permits the next numbered attempt.
3. An unreadable, contradictory, foreign-claim, reopened, or terminal-without-
   success result preserves current tracker authority and waits without a
   mutation.
4. Q is attempted at most three times. A fourth call is forbidden across live
   execution and restart.

The affected person is a maintainer or task owner observing A; no special
person action triggers retry. They see confirmed success or an exact local
conflict/wait. Dalph must not overwrite a person's change, infer non-application
from absence, allocate a new completion request, overwrite KC, or release
dependants before the later complete graph read.

### Crash and repeated activation

Restart resumes the exact unresolved read or Q. Its durable identity and
attempt ordinals prevent duplicate completion calls. Already recorded focused
success remains successful even while exact claim cleanup is recoverably
pending.

### Scenario-to-test mapping

- `packages/orchestrator/src/workflow/protocols/integration-finality/completion-task-protocol.test.ts::checks A after losing the completion response and records fresh success without a second request`
- `packages/orchestrator/src/workflow/protocols/integration-finality/completion-task-protocol.test.ts::reuses exact Q after positive non-application evidence and stops after three calls`
- `packages/orchestrator/src/workflow/protocols/integration-finality/completion-task-protocol.test.ts::does not retry ambiguous completion merely because A currently appears open`
- `packages/orchestrator/src/workflow/protocols/integration-finality/completion-task-protocol.test.ts::normalizes an unavailable exact-request lookup into an unreadable ambiguity wait`
- `packages/orchestrator/src/workflow/protocols/integration-finality/completion-task-protocol.test.ts::restart honors the unresolved call intent before sending the next completion request`
- `packages/orchestrator/src/workflow/protocols/integration-finality/completion-task-history.test.ts::accepts the exact completion authorization and lost-response reconciliation chronology`
- `packages/orchestrator/src/workflow/protocols/integration-finality/completion-task-history.test.ts::rejects retry calls without an exact prior NotApplied result recorded before fresh authorization`
- `packages/dalph/test/cassettes/scenario.test.ts::Dalph checks A after losing the tracker completion response`
- `packages/dalph/test/cassettes/scenario.test.ts::Restart keeps B blocked between A's success confirmation and the later graph`
- `packages/dalph/test/cassettes/scenario.test.ts::Dalph confirms A before a later graph read releases B`
- Negative controls: `packages/orchestrator/src/workflow/protocols/integration-finality/completion-task-protocol.test.ts::reports a task-local terminal-without-success confirmation as a conflict`, `packages/orchestrator/src/workflow/protocols/integration-finality/completion-task-protocol.test.ts::does not retry from NotApplied evidence about another completion request`, and `packages/orchestrator/src/workflow/protocols/integration-finality/completion-task-history.test.ts::rejects an exact-request lookup when its open confirmation predates the lost response`.
- Deferred: #68 owns stale-session and successor Integrator direction after a conclusive non-success; #223 only reconciles Q, preserves A's exact authority, and forbids a fourth completion call or dependant release before the later complete graph.

## A lost completion-claim response reconciles only that exact claim operation

### Starting situation

The tracker call that either replaced K with exact KC or deleted exact KC may
have succeeded, but its response was lost. Its deterministic operation identity
and numbered attempt intent are durable. Task completion Q has a different
identity and, for deletion, a focused observation already proves A
`CompletedSuccessfully`.

### Chronology

1. Dalph rereads A's exact current claim before any repeated claim mutation.
   Exact KC proves a lost replacement was applied; absence of KC proves a lost
   deletion was applied. The matching result is recorded with no second call.
2. Exact K after a lost replacement, or exact KC after a lost deletion, permits
   the next numbered attempt only when every immutable operation precondition
   still matches. Each operation has its own three-attempt bound.
3. A foreign, mismatched, contradictory, or unreadable claim waits without a
   mutation. Claim deletion neither proves task success nor releases a
   dependant, and its ambiguity never routes through Q's request-result lookup.

The task owner or maintainer sees the exact completion claim, its recoverable
cleanup wait, or its confirmed absence. Dalph must not allocate another claim,
delete a foreign claim, repeat Q, reopen successful A, or conflate the two
attempt counters.

### Crash and repeated activation

Restart reconstructs the exact unresolved claim operation and consumed
ordinals. A durable focused success survives a pending cleanup response, and a
durable deletion never causes task completion to run again.

### Scenario-to-test mapping

- `packages/orchestrator/src/workflow/protocols/integration-finality/protocol.test.ts::writes replacement intent first and reconciles an unknown response by a fresh claim read`
- `packages/orchestrator/src/workflow/protocols/integration-finality/protocol.test.ts::returns an already recorded exact replacement without touching the tracker`
- `packages/orchestrator/src/workflow/protocols/integration-finality/protocol.test.ts::bounds unresolved replacement responses at three requests`
- `packages/orchestrator/src/workflow/protocols/integration-finality/protocol.test.ts::later activation discovers replacement success after three ambiguous requests without request four`
- `packages/orchestrator/src/workflow/protocols/integration-finality/protocol.test.ts::deletes only the exact completion claim after actual fresh success and settles once`
- `packages/orchestrator/src/workflow/protocols/integration-finality/protocol.test.ts::preserves an interrupted completion-claim deletion behind its exact attempt intent`
- `packages/orchestrator/src/workflow/protocols/integration-finality/protocol.test.ts::recomposes and reopens an interrupted completion cleanup through authored and recorded cassettes`
- `packages/orchestrator/src/workflow/protocols/integration-finality/protocol.test.ts::does not reopen success when deletion response is unknown but already applied`
- `packages/dalph/test/cassettes/scenario.test.ts::reconciles a lost completion-claim replacement without allocating another claim`
- `packages/dalph/test/cassettes/scenario.test.ts::does not mutate a foreign claim while settling a promoted task`
- `packages/dalph/test/cassettes/scenario.test.ts::deletes only the exact completion claim after focused task success`
- Negative controls: `packages/orchestrator/src/workflow/protocols/integration-finality/protocol.test.ts::fails closed on a foreign claim without attempting replacement`, `packages/orchestrator/src/workflow/protocols/integration-finality/protocol.test.ts::does not delete a different completion claim`, and `packages/orchestrator/src/workflow/protocols/integration-finality/protocol.test.ts::rejects a forged success proof before deletion intent`.
- No behavior is deferred from this exact claim-operation reconciliation; the existing #61 cleanup contract remains the acceptance boundary.

## Finality reopens only evidence actually named by the corrected contract

### Starting situation

No person triggers the storage operation. The evidence store has atomically
published the accepted-result envelope. If the corrected Integrator contract
returned an evidence reference, the evidence store has also published those
bytes under their content digest and S's result records only the reference.
Exact promotion of M is durable and finality is ready to construct Q.

### Chronology

1. Dalph asks the evidence store for each exact reference required by the
   accepted-result and corrected Integrator contracts.
2. The evidence store returns the complete immutable bytes or a typed missing,
   corrupt, or unreadable result. Dalph decodes each contract-owned schema and
   validates C, M, S, and any declared predecessor binding.
3. Matching evidence may be carried into Q. Missing, malformed, or mismatched
   evidence stops before tracker mutation. If the Integrator result contains no
   evidence reference, Dalph requires none and does not manufacture one from a
   legacy target-verification manifest.

The maintainer sees finality proceed or an exact evidence-read wait. Dalph must
not infer evidence from a Journal reference alone, accept partial bytes, change
published bytes, make the Integrator the byte-store authority, or use legacy
verification evidence as a substitute.

### Crash and repeated activation

A crash before atomic evidence-store publication leaves no readable partial
object; a crash afterward reopens the same complete bytes. Finality rereads and
revalidates after restart rather than treating a prior process read as durable
authority. Concurrent publication and filesystem recovery remain the generic
issue #76 storage contract; this issue changes only the evidence consumer.

### Scenario-to-test mapping

- `packages/orchestrator/src/workflow/protocols/target-verification/evidence-store.test.ts::stores immutable bytes idempotently and publishes concurrent same-content writes once`
- `packages/orchestrator/src/workflow/protocols/target-verification/evidence-store.test.ts::does not expose partial bytes after an interrupted filesystem publication`
- `packages/orchestrator/src/workflow/protocols/target-verification/evidence-store.test.ts::reopens an interrupted publication and republishes the same complete object`
- `packages/orchestrator/src/workflow/protocols/target-verification/evidence-store.test.ts::reopens a published object with the same reference and bytes`
- `packages/orchestrator/src/workflow/protocols/target-verification/evidence-chain.test.ts::validates the exact predecessor for every reopened sealed manifest`
- `packages/orchestrator/src/workflow/protocols/target-verification/evidence-chain.test.ts::rejects a missing, foreign, or root predecessor before downstream work`
- `packages/orchestrator/src/workflow/protocols/integration-finality/completion-task-protocol.test.ts::rereads accepted-result and Integrator-returned evidence before task completion`
- `packages/orchestrator/src/workflow/protocols/integration-finality/completion-task-protocol.test.ts::malformed, missing, and foreign accepted-result evidence stop before tracker completion mutation`
- `packages/orchestrator/src/workflow/protocols/target-promotion/outer-protocol.test.ts::legacy target-verification evidence cannot authorize promotion`
- `packages/orchestrator/src/workflow/protocols/integration-admission/protocol.test.ts::does not let legacy passed verification authorize outer promotion`
- `packages/orchestrator/src/workflow/protocols/integration-admission/accepted-result-evidence.property.test.ts::rejects every generated corrupted acceptance envelope before integration admission`
- Negative controls: `packages/orchestrator/src/workflow/protocols/integration-admission/accepted-result-evidence.test.ts::waits when acceptance evidence is unavailable without consuming integration` and `packages/orchestrator/src/workflow/protocols/integration-admission/accepted-result-evidence.test.ts::exposes malformed or mismatched acceptance bytes as a task-local conflict`.
- Deferred: #76 owns generic atomic evidence-store publication and filesystem recovery; #225 owns deletion of the remaining legacy target-verification/candidate-agent implementation. #223 only consumes exact accepted-result and Integrator-returned references and never manufactures evidence from a Journal row or legacy manifest.
