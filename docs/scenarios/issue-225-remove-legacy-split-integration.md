# Remove the legacy split integration pipeline

Issue: [#225](https://github.com/dearlordylord/dalph/issues/225)

Status: implemented. Issues #222, #223, #68, #138, and #224 moved every
accepted live path to the outer Integrator. Issue #225 removed the superseded
candidate-agent and Dalph-owned target-verification workflows without creating
a compatibility mode.

## One accepted result reaches completion through only the outer Integrator

### Starting situation

No person directly triggers the integration sequence. The running Dalph
coordinator has one accepted executor result for task A at commit C, the exact
accepted-result evidence reference, an active tracker claim, target T at Git
head H, and one queued integration responsibility. Git owns T and commit
ancestry. The configured Integrator owns its private repository checks, review,
merge construction, and provider recovery.

### Chronology

1. Dalph reads T through the ordinary journal-first target-lineage protocol and
   proves the planned base is compatible with H.
2. Dalph fixes one Integrator session S for A, H, C, the accepted evidence,
   worktree, target, and candidate resource, then records exact run `(S, 1)`
   before calling the Integrator.
3. The Integrator reports one explicit candidate M for `(S, 1)`. Dalph records
   that result without exposing any Integrator-private check as Dalph work.
4. Dalph records a Git-read intent for M, asks Git for M, and records that M is
   a commit with ordered direct parents `[H, C]`.
5. Dalph uses the existing exact-head promotion protocol to replace H with M.
   It then performs tracker finality and separately recoverable cleanup.
6. Alice sees task A complete and its dependants become eligible according to
   the freshly observed tracker graph.

There is no Dalph candidate-agent correction loop, target-verification plan,
verification wrapper, wrapper lock, target-verification manifest, or
verification Journal event. Generic accepted-result evidence storage remains;
it proves the executor result and is not a replacement verification workflow.

If Dalph crashes after any intent or outside result, restart uses the exact
Integrator, Git qualification, promotion, tracker, or cleanup protocol that
owns that boundary. It does not resurrect a removed phase.

### Visible and forbidden results

Alice sees one completed task and preserved exact evidence. Dalph must not
infer M from a resource head or process success, promote an unreported or
Git-unqualified candidate, schedule a legacy action, or require a
target-verification result before promotion.

### Scenario-to-test mapping

- `gives one exact session to the Integrator and qualifies its reported candidate`
- `records completion finality after Git-qualified promotion history`
- Quint `outerIntegratorReportsOneExplicitCandidateTest`
- Negative control `unreportedCandidateCannotAuthorizePromotionTest`

## A conclusive Integrator non-success remains one explicit disposition

### Starting situation

The same accepted result, target H, responsibility, and fixed session S exist,
but run `(S, 1)` returns conclusive `NotPrepared`, or reports M and Git proves
that M is not the required commit with ordered parents `[H, C]`. No later task
for the same target may pass the unresolved responsibility.

### Chronology

1. Dalph records the exact run result and, when M was reported, its exact Git
   observation.
2. Dalph records one integration quarantine before releasing process-local
   target ownership. It does not automatically rerun the Integrator.
3. Alice applies one exact `Retry` or `FullRerun` direction for that quarantine.
4. `Retry` can start only run `(S, 2)` at unchanged H after the required fresh
   Git observation. `FullRerun` can create only one successor session at a
   freshly observed compatible head while preserving the predecessor resource
   for separately authorized cleanup.
5. Independent tasks and targets continue while A waits or recovers.

No candidate-agent correction count, candidate-construction continuation,
verification plan, wrapper result, or sealed verification evidence can
authorize either direction. Alice sees the quarantined Integrator outcome and
one explicit recovery choice rather than an apparent internal stage failure.

### Crash and retry

Process loss after quarantine, direction, fresh Git intent/observation,
successor-session creation, or run start reconstructs the same chronology from
the outer-Integrator records. Redelivery reuses the first valid direction and
never allocates another run or successor.

### Scenario-to-test mapping

- `does not infer a candidate from resource head or process success`
- `rejects a reported candidate unless Git proves ordered parents H then C`
- `conclusive NotPrepared is retained for quarantine and is not automatically retried`
- `full rerun preserves queue position and starts one successor session at the fresh head`
- `recovers a recorded full rerun without creating a second successor`
- Quint `outerIntegratorNotPreparedIsConclusiveTest`
- Quint `fullRerunPreservesPredecessorAndRestartsOneSuccessorTest`

## Process loss resumes the same outer Integrator and promotion boundaries

### Starting situation

Run R contains one exact queued responsibility and fixed Integrator session S.
Dalph may lose the provider response after starting `(S, 1)`, lose the Git
qualification response after recording its intent, or lose the promotion
response after Git changed H to M. No application Exit state is stored in R.

### Chronology

1. On ordinary startup Dalph reconstructs R and the exact unfinished boundary.
2. An unfinished Integrator occurrence reuses S and `(S, 1)`; it does not
   allocate `(S, 2)` or a successor session.
3. A recorded Integrator result with unfinished Git qualification rereads M
   without rerunning the Integrator.
4. An ambiguous promotion reads Git before another numbered compare-and-set.
   If M is current or in current ancestry, Dalph records that observation and
   continues finality without promoting again.
5. The same candidate resource, accepted result, queue position, claim, and
   responsibility survive every cut.

Alice sees recovered progress or an explicit wait. Dalph must not translate
old candidate-agent or target-verification records into current authority,
create legacy workflow events, or run a removed provider during recovery.

### Scenario-to-test mapping

- `automatically restores the same unfinished integration session after process loss`
- `a Git read failure leaves its intent and restart rereads Git without rerunning Integrator`
- `reconciles a lost promotion response and never sends a fourth request`
- `discovers M in current target ancestry after losing the promotion response`
- Quint `unfinishedIntegratorRestoresSameSessionTest`
- Quint `reportedCandidateRestoresWithoutIntegratorRerunTest`
- Quint `ambiguousPromotionRequiresFreshGitBeforeRetryTest`

## The maintained ten-task graph uses no legacy integration phase

### Starting situation

Alice runs the maintained staggered ten-task delivery story with task-work
capacity two, one target queue, dependency diamonds, a coordinator restart,
and task X appearing in a later complete tracker graph. Every accepted executor
result must pass through integration and finality before its dependants advance.

### Chronology

1. Dalph admits at most two exact task attempts and reconstructs held positions
   before admitting restart-added work.
2. For each accepted result, Dalph uses the same outer Integrator, Git
   qualification, exact-head promotion, and finality chronology described
   above.
3. The same-target queue remains serialized while independent executor work
   overlaps up to capacity.
4. All ten tasks settle in dependency order and the Run terminates only after
   the final complete tracker observation.

The maintained cassette, recorded projection, and Reducer Lab must describe
these domain events without presenting candidate-agent correction or target
verification as current Dalph stages. The capstone need not retain obsolete
events merely to test the removed cassette infrastructure.

### Scenario-to-test mapping

- `consumes a staggered graph while reconstructed positions delay restart-added X`
- `preserves the double-diamond middle positions across coordinator restart`
- generated `runs maintained authored cassette <catalog-key> through the composed production coordinator`
- `keeps maintained authored and recorded catalogs and public exports free of legacy integration tags`

## Removal boundary

The following are removed together because they describe one superseded domain
phenomenon: candidate-agent request/correction/continuation, candidate-session
construction events and resources that exist only for that protocol,
target-verification planning/execution/results, repository verification wrapper
locking, sealed target-verification manifests, their recovery/indexing, and
their public/cassette/model projections.

The following remain: accepted-result evidence references and generic evidence
storage, target-lineage reads, outer Integrator sessions/runs/results, Git
qualification of the Integrator-reported candidate, integration quarantine and
directions, exact-head promotion, tracker finality, queue ordering, cleanup,
application Exit, and the legacy-history rejection needed to fail closed when
an old journal is encountered. Old history is not silently renamed into new
authority.
