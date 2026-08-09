# Scenarios

Each file here tells one chronology in prose: who acts, what is true before,
what happens outside Dalph, what Dalph does in order, where it can crash, what
a person sees, and what must not happen. `../OPERATIONAL-SCENARIOS.md` defines
the required fields and the delivery gate they satisfy.

These are the readable register. The same behavior is carried executably by
cassettes, and the *What must Dalph not do?* clauses are carried as `D`
invariants in `../DELIVERY-INVARIANTS.md`, because a recording can prove an
occurrence happened and never that one cannot.

A chronology spanning many issues belongs in `../DELIVERY-STORY.md` rather than
here. Files here are scoped to one accepted issue and carry its
acceptance-test mapping.

## Currency

Every file here corresponds to an accepted issue that is either open or closed
as completed. No issue is abandoned, closed as not planned, or superseded, and
no issue declares any file here outdated.

**Describes shipped behavior** — the owning issue is closed as completed.

| File | Issue |
|---|---|
| `issue-131-conflicting-capacity-observation.md` | 131 |
| `issue-134-pause-whole-run.md` | 134 |
| `issue-135-pause-task-grouping-descendants.md` | 135 |
| `issue-164-journal-first-tracker-observations.md` | 164 |
| `issue-165-domain-readable-cassettes.md` | 165 |
| `issue-170-maintained-cassette-catalog.md` | 170 |

**Describes implemented behavior with an intentionally open owning issue** —
the implementation evidence and post-implementation choices audit are recorded
on the issue while later dependent work proceeds.

| File | Issue |
|---|---|
| `issue-57-build-two-parent-integration-candidate.md` | 57 |
| `issue-59-run-target-verification.md` | 59 |
| `issue-60-promote-or-reconcile.md` | 60 |
| `issue-141-integration-finality.md` | 141 |
| `issue-156-reject-stale-task-control.md` | 156 |
| `issue-192-describe-delivery-actions.md` | 192 |
| `issue-193-run-reactive-delivery-actions.md` | 193 |
| `issue-194-stabilize-each-run.md` | 194 |

**Accepted, not yet implemented** — the owning issue is open. These state
required behavior and must not be read as a description of what Dalph does
today.

| File | Issue |
|---|---|
| `issue-53-refresh-complete-task-pipelines.md` | 53 |
| `issue-54-resize-task-admission.md` | 54 |
| `issue-55-localize-task-conflicts.md` | 55 |
| `issue-56-queue-accepted-integration.md` | 56 |
| `issue-65-cancel-or-continue-attempt.md` | 65 |
| `issue-136-reconcile-changed-task-facts.md` | 136 |
| `issue-137-reconcile-task-claims.md` | 137 |
| `issue-138-reconcile-blockers-around-promotion.md` | 138 |
| `issue-139-reconcile-git-facts.md` | 139 |

**Milestone-scoped** — accepted against a milestone rather than one issue.
`authored-cassette-abstraction-levels.md` refines the vocabulary accepted in
issue 173, `planned-attempt-executor-boundary.md` is accepted for the
production-shaped fake-executor milestone, `workflow-occurrence-projection.md`
for the runtime occurrence-classification milestone, and
`run-establishment-and-activation.md` is accepted in the maintainer
conversation that unified initialization and restoration under one idempotent
Run entry.
