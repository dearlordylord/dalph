# Issue 44 follow-up handoff

This document replaces the earlier annotation transcript. It is the canonical,
crash-safe handoff for the review of issue #44, commit `7c7db0224`, and the
follow-up implementation. It records decisions and remaining work rather than
repeating concerns that later commits already solved.

## Resume here

- Repository: `/workspace/typescript/dalph`
- Isolated worktree: `/workspace/typescript/dalph-issue44-followup`
- Branch: `issue-44-followup`
- Branch base: `81fbbc90e` (`master` when the worktree was created)
- Follow-up commits: `326576a21 fix(orchestrator): harden task attempt planning
  boundaries` and `69dbff552 fix(orchestrator): apply issue 44 review feedback`
- `issue-44-followup` was fast-forward merged into local `master`. It has not
  been pushed.
- Original annotation call process ID supplied by the reviewer: `1210985`. The
  process has exited; its feedback was recovered before exit.
- Issue #112 follow-up comment:
  <https://github.com/dearlordylord/dalph/issues/112#issuecomment-5053604185>

The full gate and independent Standards and Spec review passes are clean. The
reviewer's requested high-confidence merge is complete locally.

## Scope and sources reviewed

The review covered issue #44, commit `7c7db0224`, issue #43 and its assumptions,
later closed issues and commits that superseded or aggravated those choices,
and the current orchestrator implementation. Solved findings were intentionally
removed from the delivered review. Commit `65846bdf8`, for example, already
fixed the event binding by attaching it to `ExecuteTaskWork`; it is not an open
finding.

The original issue #44 review resulted in `326576a21`. That commit made planned
attempt equivalence Schema-derived, moved task-revision derivation to the
planner, strengthened property tests, and hardened the planned-worktree
boundary. The follow-up below corrects assumptions exposed by the reviewer's
final feedback.

## Decisions now encoded

### One workflow algebra in every environment

The workflow always performs these operations in this order:

1. record the exact planned task attempt;
2. reconcile its planned worktree.

The workflow no longer branches on a simulated planning result. Injected,
coherent Effect Layers decide how both operations are interpreted. No exported
Layer combines simulated planned-task-attempt recording with authoritative Git
mutation. Production privately assembles its delegate and exports only the
journaled, coherent production interpreter.

This is now an explicit, deliberately strict review rule in
`docs/CODE_REVIEW.md`: environment differences belong in interpreters and
Layers, not branches in the workflow algebra.

### Canonical planning vocabulary

- **Planned task attempt** is the complete term. Avoid the ambiguous shorthand
  “plan” and “attempt plan.”
- **Task revision fingerprint** is a fingerprint of execution-relevant tracker
  input. It is not a task version, version counter, attempt ordinal, or workflow
  history identifier.
- **Planned-task-attempt recording predecessor** names the journal operation
  whose observed outcome authorizes recording a planned task attempt.

These definitions are in `docs/CONTEXT.md` and their architectural consequences
are in `docs/ARCHITECTURE.md`. They were intentionally not added to `AGENTS.md`.

### Task revision fingerprint encoding

`TaskRevision` now uses the versioned, reversible encoding
`tr1.<base64url-json>`. The prefix is hard-coded and the normalized fields are
recoverable for diagnostics. Consumers still treat the value as opaque and
compare it only for equality.

Property tests prove the prefix and exact diagnostic decoding, in addition to
the existing order-independence and sensitivity laws. Journal events advance
from version 3 to version 4. The decoder upcasts nested legacy raw-JSON task
revision values before Schema validation, preserving existing durable history.
A regression test covers planned-task-attempt recording, worktree
reconciliation, task-work-session establishment, and task execution events.

### No test-only runtime identity

The `liveFakeWorkflowInterpreterLayer`, tracker-mutation interpreter alias, and
test-only task-runner alias were removed. Tests use the deterministic test
Layer; the task-runner factory simulates both planned-task-attempt recording and
worktree reconciliation. Runtime behavior is selected through ordinary service
composition, not a production branch or a test-named runtime mode.

## Verification evidence

The workflow regression was first observed red under the old behavior:
simulated planned-task-attempt recording caused zero reconciliation calls where
one was required. It is green after the workflow-algebra change.

The task-revision property was first observed red because the old value lacked
the `tr1.` prefix. It is green after the versioned encoding change.

After implementation, six focused files passed with 42 tests:

- `task-attempt-planning.property.test.ts`
- `workflow.test.ts`
- `workflow-interpreters.test.ts`
- `interpreter-equivalence.test.ts`
- `task-claim-workflow.test.ts`
- `production-application.test.ts`

The final clean `pnpm check:all` passed after all compatibility, terminology,
and review fixes: build, typecheck, lint, circular and duplicate checks, Quint
verification, 57 test files with 378 tests, coverage thresholds, and secret
scanning. `git diff --check` also passed.

## Planned-task-attempt predecessor interview

This is intentionally not decided by the fast follow-up. Resume it with the
`grill-me` skill and ask one question at a time. The implementation must not
invent an attempt ordinal while this policy remains unresolved.

Current concrete flow:

1. the workflow reads the tracker before trying to create the claim;
2. after the tracker confirms the exact claim was acquired, the workflow records
   a new tracker-read operation whose predecessor is that claim operation;
3. it reads the tracker again and checks that the task is executable;
4. the planned task attempt currently names that post-claim tracker-read
   operation as its predecessor.

Recommended opening position for the interview:

1. A durable planned task attempt has exactly one direct predecessor: the fresh
   post-claim tracker observation.
2. That observation must itself directly follow the exact acquired claim, so
   the claim is required transitively rather than duplicated as a predecessor.
3. The durable history must prove that the observation concerned the same
   `TaskId` and task revision fingerprint. The current tracker-outcome event may
   not carry enough evidence.
4. Prefer a distinct journaled execution-admission event if admission is a
   separate domain phenomenon; otherwise enrich the tracker outcome. Decide
   this explicitly under the repository rule that distinct phenomena receive
   distinct types or events.
5. Dry and deterministic-test interpreters preserve the same operation algebra
   and predecessor shape, although they do not claim to provide durable
   production evidence.

Questions to resolve, in order:

1. Which exact prior outcome authorizes planned-task-attempt recording: the
   post-claim tracker observation, a distinct execution-admission event, or
   something else?
2. Where is equality of `TaskId` and task revision fingerprint proved?
3. Is one direct admission predecessor sufficient, with the claim required
   transitively?
4. Which prior outcome authorizes appending a new `TaskAttemptPlanned` event
   instead of continuing or terminating the existing attempt?

Question 4 belongs with issue #112. Do not answer it by assuming an ordinal.

## Issue #112 recovery follow-up

The issue comment linked above preserves these requirements:

- recover the exact planned task attempt, including its task revision (fingerprint)
  fingerprint;
- do not assume an attempt ordinal before the predecessor interview settles how
  a new attempt is authorized;
- every legal, nonterminal durable-history prefix must either progress through
  the workflow or produce a typed terminal/recovery outcome;
- prove that property with generated histories; use a Quint model as well if
  the state-machine boundary warrants it;
- keep production, dry, and deterministic-test execution on the same workflow
  algebra with coherent interpreters.

The next design pass should use `domain-modeling` for the admission phenomenon,
then `property-based-testing`; use `quint-modeling` if the recovery transition
system remains nontrivial.

## Deferred decisions and work

### Successful Git command versus post-command observation

No fast change was made. The current interpreter runs `git worktree add`, then
reads Git again to prove the branch, path, `HEAD`, planned Base SHA, and ancestry
before returning `PlannedWorktreeReady`.

The feedback questions whether exit status zero is already sufficient evidence.
The repository delivery invariant currently says to record intent before an
ambiguity-crossing effect, observe afterward, and reconcile before retry after
an ambiguous outcome. Removing the read-back would weaken that explicit rule.
Keep it until a focused design decision establishes which facts exit status
proves and which recovery facts still require observation.

### GitHub GraphQL schema development dictionary

Not yet done. Decide a generated reference path and update policy, likely
`docs/reference/github-public-schema.graphql`, sourced from GitHub's official
public schema. Add a module comment in `github-graphql-client.ts` pointing to
that local dictionary and its source/update procedure. Do not hand-maintain or
silently stale a large schema snapshot.

### Durable-history progress property

The requested universal property is not part of this fast patch. It belongs to
issue #112 after the predecessor/admission policy is settled: every legal
durable history either advances or reaches a typed stopping outcome. Generated
prefix testing must cover all legal event shapes, not only example histories.

## Delivery status

- The code, documentation, and replacement handoff were committed on
  `issue-44-followup`.
- The branch was fast-forward merged into local `master` after the full gate
  and both review axes were clean.
- The former untracked master artifact was removed before the merge; this file
  is the canonical replacement, not an appended transcript.
- No push was performed.

## Relevant references

- Issue #44: <https://github.com/dearlordylord/dalph/issues/44>
- Issue #43: <https://github.com/dearlordylord/dalph/issues/43>
- Issue #112: <https://github.com/dearlordylord/dalph/issues/112>
- Original reviewed commit: `7c7db0224`
- Later event-binding correction: `65846bdf8`
- First follow-up commit: `326576a21`
- Current implementation areas:
  `workflow-run.ts`, `workflow-interpreters.ts`, `production-application.ts`,
  `task-dag.ts`, `managed-history.ts`, and `planned-task-attempt.ts`
