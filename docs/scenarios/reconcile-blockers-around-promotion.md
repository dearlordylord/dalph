# Reconcile blockers before and after Git promotion

Issue: [Reconcile blockers before and after Git promotion](https://github.com/dearlordylord/dalph/issues/138)

Status: accepted rewrite on 2026-08-14; implemented after issues #223 and #68
established the corrected outer Integrator and quarantine boundaries.

No person directly triggers these scenarios. The tracker owns prerequisite
facts, Git owns candidate and promotion facts, and the outer Integrator owns
its private merge, repository-check, review, and retry workflow. Dalph owns the
integration responsibility and the order of tracker, Integrator, and Git
boundaries.

## A blocker appears before promotion

Task A has an integration-ready result and one Integrator session S fixed to
target head H. S may still be unfinished or may have reported candidate M that
Dalph Git-qualified. A fresh complete tracker observation reports unfinished
prerequisite B. Independent task C does not depend on A or B.

Dalph records the tracker observation, preserves S, its isolated resource, any
reported M, the result, claim, queue position, and evidence, then releases the
process-local target position. It starts no Integrator run, Git qualification,
promotion, tracker completion, or cleanup for A while B remains unfinished. B
and C remain eligible under their own facts. Later same-target integration
cannot pass A.

After process loss, ordinary reconstruction retains A at the same queue
position without restoring process-local target ownership. Dalph does not
infer that the blocker cleared or discard Integrator work.

The operator sees A waiting while B and C can progress. Dalph must not create a
second session, mutate or infer M, hold the target position throughout the
wait, or promote from stale tracker facts.

### Scenario-to-test mapping

- `packages/dalph/test/cassettes/scenario.test.ts::preserves the Integrator session and releases target ownership when a blocker appears before promotion`
- `packages/dalph/test/cassettes/scenario.test.ts::keeps an unfinished Integrator session dormant when a blocker appears after process loss`
- `packages/dalph/test/cassettes/scenario.test.ts::restarts after a durable blocker read with the candidate and queue history intact`

## The blocker clears before promotion

A later complete tracker observation proves B complete or proves the
prerequisite edge absent. Dalph clears only this dependency constraint and
freshly reads the target head and required ancestry before another integration
action.

If S's fixed H is still current, ordinary Integrator or promotion behavior may
continue from the preserved facts. If H is stale, Dalph does not reuse M,
rewrite its parents, or automatically manufacture a successor; the accepted
session disposition and fresh-head behavior are owned by #68 and #223.

An incomplete tracker observation or unreadable Git result proves no
transition. Dalph preserves A, releases any process-local target position, and
waits for later authority facts.

### Scenario-to-test mapping

- `packages/dalph/test/cassettes/scenario.test.ts::delegates changed H after a cleared blocker without reusing M or creating S2`
- `packages/dalph/test/cassettes/scenario.test.ts::promotes the preserved candidate after a blocker clears at unchanged H`
- `packages/dalph/test/cassettes/scenario.test.ts::durably waits after an unreadable blocker restart read and resumes only on later complete facts`
- `packages/orchestrator/src/workflow/protocols/target-promotion/outer-protocol.test.ts::fails visibly when the first reconciliation read is unavailable`

## A blocker appears after promotion

Git has conclusively promoted exact M, but the tracker task is not complete. A
fresh complete tracker observation reports unfinished B. Dalph preserves the
promotion proof, releases local target ownership, and waits before tracker
completion. It does not roll Git back, reintegrate, or ask the Integrator for
another candidate. B and unrelated C remain eligible.

After process loss, Dalph reconstructs the known promotion and blocker facts.
It does not repeat the Git mutation or restore a process-local target position.

### Scenario-to-test mapping

- `packages/dalph/test/cassettes/scenario.test.ts::preserves promotion proof and releases target ownership before tracker completion on a new blocker`
- `packages/dalph/test/cassettes/scenario.test.ts::reconstructs a post-promotion blocker without repeating Git promotion`

## The blocker clears after promotion

A complete tracker observation proves B complete or the edge absent. Dalph freshly asks
Git whether M remains an ancestor of the target. Only matching current tracker
facts plus proven ancestry allow the existing tracker-completion protocol to
continue. Unreadable or incompatible Git facts preserve A and authorize no
reintegration or tracker completion.

If the tracker accepted A's completion while another client concurrently
reopened B, Dalph records the tracker result without rolling Git or A back. A
later complete observation may expose the inconsistency; Dalph may derive a
warning but does not manufacture a repair.

### Scenario-to-test mapping

- `packages/dalph/test/cassettes/scenario.test.ts::proves promoted ancestry after the blocker clears and completes without reintegration`
- `packages/orchestrator/src/workflow/protocols/integration-finality/completion-task-protocol.test.ts::waits when Git cannot read current candidate ancestry`
- `packages/orchestrator/src/workflow/protocols/integration-finality/completion-task-protocol.test.ts::rejects current authorization when Git no longer contains the promoted candidate`
- `packages/dalph/test/cassettes/scenario.test.ts::preserves accepted tracker completion when a prerequisite concurrently reopens`

## Forbidden-result invariant mapping

- D10, D16, and D31 preserve the result, Integrator resource, candidate, and
  promotion proof across waits and process loss.
- D18 and D19 keep the blocker local to A and clear no independent constraint.
- D23 and D24 prevent incomplete tracker or Git facts from proving progress.
- D26 through D28 prevent candidate rewriting, unqualified promotion, rollback,
  and force updates.
- D29 prevents persistence of queue projections, waits, and target ownership.
- D42 and D43 retain same-target order while releasing process-local ownership.
