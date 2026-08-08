# Issue #139: reconcile Git lineage, worktrees, and promotion races

These scenarios expand accepted graph-frontier scenarios 12–14 for the
provider-neutral fake-Git milestone. Git owns refs, commits, ancestry, and
registered worktrees. Dalph records only the reads it initiates, the facts Git
returns, and the task-local constraint or next reconciliation choice derived
from those facts.

Issue #57 later constructs an exact two-parent candidate, #59 later verifies
that candidate, and #60 later sends the compare-and-set promotion request.
Issue #73 qualifies lineage, candidate shape, and ambiguous ref mutation
against real Git repositories. Issue #74 qualifies exact real-worktree
registration, ownership, contradiction, and preservation behavior.
Issue #139 establishes the observations and decisions those protocols must
consume; it does not create an unverified candidate or an early promotion
capability.

## Scenario 12A: the integration target advances from the planned Base

No person directly triggers this behavior. Dalph has one unfinished planned
attempt for task A. Its immutable plan names Base `a1`, branch `task-A`, and
worktree `/worktrees/A`. Git still registers that exact worktree and reports
its current HEAD. Another accepted result has advanced the integration target
from `a1` to `b1`, and Git proves `a1` is an ancestor of `b1`. Independent task
C requires none of A's Git facts or integration resource.

Before Dalph continues A across another executor or integration boundary, it
first records an exact planned-worktree read intent and asks Git for that
registration. After Git returns a ready worktree, Dalph records a distinct
target-lineage read intent and asks Git for the target head and its ancestry
relationship to A's immutable Base. Git returns the compatible target
advancement. Dalph records both distinct observations. A has no Git-lineage or
worktree constraint, and ordinary selection may continue A. C remains
independently selectable.

If the coordinator dies after the read intent but before the observation,
restart repeats the read with the same operation identity. If it dies after
the observation, reconstruction reuses the recorded result until another
accepted boundary requires a current read. No Git mutation is involved, so a
lost read response cannot create a duplicate external effect.

The maintainer sees A remain eligible after compatible target advancement.
Dalph must not require Base equality, rewrite A's branch, reset its worktree,
or block C.

If the target-lineage command fails, Git is the relevant boundary and no
person is directly affected yet. Dalph retains the already-recorded ready
worktree and the target-lineage intent, exposes the typed Git read failure,
and does not continue A. The failed activation returns to its caller and waits;
it does not signal itself into a hot retry loop. A later activation retry uses
the same operation identity and asks Git again; only a successfully recorded
lineage observation can clear the pending read. Dalph must not combine the
failed lineage call with the worktree result, discard the ready-worktree
evidence, infer compatibility, or mutate either ref. A crash adds no special
behavior: the durable intent is sufficient to reconcile the read.

Acceptance seams:

- maintained authored/recorded cassette
  `compatibleTargetAdvanceContinues`
- `continues after Git proves the target advanced from the planned Base`
- `reopens an unfinished Git-facts read with the same operation identity`
- `installs the running-then-terminal coarse fake in the production-shaped composition`
  (typed target-lineage failure, wait, same-identity retry, then completion)
- Quint property `compatibleTargetAdvanceDoesNotConstrainAttempt`

## Scenario 12B: the integration target is rewritten outside the planned lineage

No person directly triggers Dalph. The starting attempt and worktree are the
same as scenario 12A, but another Git user or automation changes the target ref
to `r1`, and Git proves that the planned Base `a1` is not an ancestor of `r1`.
C remains independent.

Dalph records the Git-facts read intent, asks Git, and records the incompatible
lineage observation. It derives a Git-lineage constraint only for A. If A's
executor work is still running, Dalph asks that exact planned attempt to reach
safe suspension before releasing its task-work position. It preserves A's
claim, worktree, accepted result, and evidence. It does not invoke an executor,
construct a candidate, promote a ref, reset a branch, or force-update the
target while the constraint remains. C continues.

Restart reconstructs the same task-local constraint from the journal. A later
read may establish a different current Git fact, but journal position alone
cannot reinterpret the earlier external result.

The maintainer sees A isolated with the expected Base and observed target head,
while C continues. Dalph must not turn the rewrite into a whole-run failure or
infer who changed Git.

Acceptance seams:

- maintained authored/recorded cassette
  `incompatibleTargetRewriteSafelySuspends`
- `safely suspends only the attempt whose target left its planned lineage`
- `preserves claim worktree and evidence after an incompatible target rewrite`
- Quint properties `incompatibleRewriteConstrainsOnlyAffectedAttempt` and
  `gitConstraintPreservesIndependentEligibility`

## Scenario 14A: Git no longer registers the planned worktree

No person directly triggers Dalph. Durable history proves that A's exact
planned worktree was ready and that Dalph still owns separate claim, worktree,
executor-work, and evidence responsibilities. Outside Dalph, the registered
worktree disappears. The planned branch may still exist. C is independent.

Before continuing A, Dalph records a Git-facts read intent and asks Git for the
exact planned path and branch. Git reports that the planned worktree is absent.
Dalph records `AttemptWorktreeLost` with A's attempt identity, planned path,
branch, Base, and the read that supplied the fact. It derives a worktree
constraint for A, safely suspends running executor work, and preserves every
remaining responsibility and available evidence. It does not call
`git worktree add`, repair, move, reset, prune, clean, delete, or release A's
claim. C continues.

If the coordinator dies before recording the result, restart rereads Git. If
it dies afterward, reconstruction retains the loss fact. Repeating the read
does not turn disappearance into permission to recreate the resource.

The maintainer sees the exact lost attempt and resource locators. Dalph must not
silently downgrade the attempt to fresh work or infer that the worktree's WIP
was disposable.

Acceptance seams:

- `records the exact planned worktree as lost and preserves its responsibilities`
- `does not recreate a worktree that disappeared after it was ready`
- Quint property `lostWorktreeNeverAuthorizesRepair`

## Scenario 14B: the planned path or branch belongs to another Git registration

The starting history is the same as scenario 14A. Git instead reports that the
planned path now names another branch, the planned branch is registered at
another path, or the two facts compete.

Dalph records the exact typed Git observation and derives a worktree constraint
for A. It preserves both observed resources and follows the same safe-suspension
and local-progress behavior as worktree loss. This is not
`AttemptWorktreeLost`: Git has supplied contradictory or foreign registration
evidence that must remain distinguishable for operator repair.

The read-only request has no ambiguity-crossing mutation and therefore no
external retry side effect. A later read may provide new facts; Dalph never
chooses a repair from the contradiction.

Acceptance seams:

- `keeps foreign and competing worktree registrations distinct from loss`
- existing Git worktree contract scenarios for untracked, foreign, conflicting,
  competing, detached, and Base-mismatch observations

## Scenario 13: the target changes after candidate verification

No person directly triggers the race. A later #57/#59 protocol has produced and
verified candidate `m1` whose first parent and compare-and-set expectation are
target head `b1`. Before #60 asks Git to promote it, another integration
advances the target to `b2`.

The provider-neutral reconciliation input records the expected head `b1`, the
candidate `m1`, and Git's current head `b2`. The pure #139 decision is
`ReconcileCandidateFromCurrentTarget`; it is never `Promote` or
`ForceUpdate`. #60 must later record its promotion intent, ask Git using an
exact compare-and-set, record the stale-head result, reread Git after an
ambiguous result, and consume this same decision before any retry.

At this milestone there is no production promotion request, candidate builder,
or verifier, so there is no applicable crash between a Git mutation and its
outcome. The Quint state and executable adapter model that future cut point
without pretending the external effect already exists.

The maintainer sees the expected and current target heads and a candidate
reconciliation choice. Dalph must not overwrite `b2`, treat equivalent content
as exact ancestry, or reuse `m1` without rebuilding/reverification.

Acceptance seams:

- `selects candidate reconciliation when the target differs from the expected head`
- `never authorizes overwrite from a stale or ambiguous target observation`
- Quint properties `staleTargetNeverOverwrites` and
  `promotionRequiresExactExpectedHead`

## Result-commit qualification seam retained for #57

The current coarse executor may report an accepted commit, but #57 owns the
first integration boundary that asks Git to resolve that commit and prove it
descends from the attempt's immutable Base. Issue #139 therefore supplies the
closed provider-neutral observations and decisions consumed there:
`ResultCommitMissing` rejects with `preserveWorktree: true`; a present commit
whose Base is not its ancestor rejects with the same preservation proof; only
a proven descendant is eligible.

Invoking this decision from the current integration queue would pretend that
#57's candidate-construction protocol already exists and would create a second
owner for that boundary. The decision is covered by focused tests, the
executable Quint adapter, deterministic model runs, and a negative mutation
profile that deliberately discards the worktree and evidence and proves the
preservation invariant detects it. #57 must add the composed authored/recorded
cassette when it introduces the actor-visible Git qualification call.

## Scenario-to-test map

| Scenario | Concrete result | Acceptance seam |
| --- | --- | --- |
| 12A compatible advancement and lineage-read retry | A remains unconstrained after two distinct reads; a failed lineage call retains the ready worktree and same operation identity; C remains eligible | maintained authored/recorded production-loop cassette, journaled target-lineage retry test, plus Quint-connected adapter |
| 12B incompatible rewrite | only A safely suspends and receives a Git-lineage constraint | maintained authored/recorded production-loop cassette plus Quint-connected adapter |
| 14A worktree lost | exact loss is durable; no repair or claim release | journal/recovery scenario plus authored cassette |
| 14B foreign or competing registration | typed contradiction remains distinct and resources are preserved | Git authority contract and recovery scenario |
| result commit missing or non-descendant | rejection carries a worktree-preservation proof | focused decision test, Quint-connected adapter, and negative mutation profile; #57 owns the first truthful composed call |
| 13 stale promotion head | decision is reconcile, never overwrite | pure production decision, negative mutation profile, and Quint-connected adapter; #60 owns the later Git mutation and therefore no current cassette can truthfully show that boundary |
