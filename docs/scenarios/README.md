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

Most files here correspond to accepted issues that are open or closed as
completed. The integration-boundary correction accepted on 2026-08-14
superseded all or part of several historical scenarios; those files are listed
separately and are not current implementation authority.

**Describes shipped behavior** — the owning issue is closed as completed.

| File | Issue |
|---|---|
| `issue-131-conflicting-capacity-observation.md` | 131 |
| `issue-134-pause-whole-run.md` | 134 |
| `issue-135-pause-task-grouping-descendants.md` | 135 |
| `issue-53-refresh-complete-task-pipelines.md` | 53 |
| `issue-136-reconcile-changed-task-facts.md` | 136 |
| `issue-139-reconcile-git-facts.md` | 139 |
| `issue-164-journal-first-tracker-observations.md` | 164 |
| `issue-165-domain-readable-cassettes.md` | 165 |
| `issue-170-maintained-cassette-catalog.md` | 170 |
| `issue-103-github-dry-run-cli.md` | 103 |
| `issue-203-application-exit-model-mapping.md` | 203 |
| `issue-204-application-exit-runtime-mapping.md` | 204 |
| `issue-222-introduce-outer-integrator.md` | 222 |
| `issue-223-migrate-promotion-and-finality.md` | 223 |
| `issue-68-recover-or-quarantine-integration-session.md` | 68 |
| `issue-138-reconcile-blockers-around-promotion.md` | 138 |
| `issue-224-outer-integrator-application-exit.md` | 224 |
| `issue-225-remove-legacy-split-integration.md` | 225 |
| `issue-142-qualify-recovery-prefix-harness.md` | 142 |

**Describes implemented behavior with an intentionally open owning issue** —
the implementation evidence and post-implementation choices audit are recorded
on the issue while later dependent work proceeds.

| File | Issue |
|---|---|
| `issue-72-qualify-github-completion.md` | 72 |
| `issue-73-qualify-real-git-lineage-candidate-ref.md` | 73 |
| `issue-74-qualify-real-worktree-lease.md` | 74 |
| `issue-156-reject-stale-task-control.md` | 156 |
| `issue-192-describe-delivery-actions.md` | 192 |
| `issue-193-run-reactive-delivery-actions.md` | 193 |
| `issue-194-stabilize-each-run.md` | 194 |
| `issue-206-interruptible-tracker-git-exit.md` | 206 |
| `issue-205-running-executor-application-exit.md` | 205 |
| `issue-208-cleanup-dispositions-during-application-exit.md` | 208 |
| `issue-209-force-application-termination.md` | 209 |
| `issue-210-linux-supervisor-exit.md` | 210 |

**Accepted, not yet implemented** — the owning issue is open. These state
required behavior and must not be read as a description of what Dalph does
today.

| File | Issue |
|---|---|
| `issue-54-resize-task-admission.md` | 54 |
| `issue-55-localize-task-conflicts.md` | 55 |
| `issue-56-queue-accepted-integration.md` | 56 |
| `issue-63-observe-pause-progress.md` | 63 |
| `issue-65-cancel-or-continue-attempt.md` | 65 |
| `issue-66-clean-restart-changed-attempt.md` | 66 |
| `issue-137-reconcile-task-claims.md` | 137 |
| `issue-71-qualify-real-github-graph-membership-claims.md` | 71 |

**Superseded or awaiting integration-boundary reconciliation** — these files
remain as historical or current-runtime evidence, but their banners state
which behavior is no longer accepted. They must not authorize implementation
until replacement operational scenarios exist.

| File | Issue | Status |
|---|---:|---|
| `issue-57-build-two-parent-integration-candidate.md` | 57 | Implemented and closed completed; boundary superseded by #222 |
| `issue-59-run-target-verification.md` | 59 | Implemented and closed completed; workflow fully superseded |
| `issue-60-promote-or-reconcile.md` | 60 | Promotion retained; #59 evidence premise obsolete |
| `issue-61-complete-task-and-release-dependants.md` | 61 | Tracker behavior retained; evidence premise requires reconciliation |
| `issue-76-production-evidence-store.md` | 76 | Storage retained; #59 chain element obsolete |
| `issue-78-qualify-repository-verification-locking.md` | 78 | Implemented and closed completed; workflow fully superseded |
| `issue-141-integration-finality.md` | 141 | Settlement retained; evidence premise requires reconciliation |
| `issue-167-controlled-provider-capstone.md` | 167 | Maintained chronology corrected by #225; original issue remains historical |
| `issue-207-integration-evidence-exit.md` | 207 | Exit rules retained; boundary families require reconciliation |

**Accepted planning-only Wayfinder** — the owning issue resolves behavior,
architecture, model ownership, and implementation-ticket edges without itself
implementing runtime behavior.

| File | Issue |
|---|---|
| `issue-104-control-plane-latency-and-responsiveness.md` | 104 |
| `issue-169-graceful-application-exit.md` | 169 |
| `issue-219-codex-app-server-executor.md` | 219 |

`issue-104-control-plane-latency-and-responsiveness.md` is the accepted
planning chronology for timing budgets. It classifies existing local timing
contracts and remote-boundary policies; it does not promise hard real-time
behavior or an end-to-end latency SLA.

`issue-219-codex-app-server-executor.md` selects the first concrete executor
behind the unchanged generic boundary. It accepts persistent Codex app-server
threads, their private process/session lifecycle, and the focused ticket map;
it does not claim that implementation has shipped.

**Milestone-scoped** — accepted against a milestone rather than one issue.
`authored-cassette-abstraction-levels.md` refines the vocabulary accepted in
issue 173, `planned-attempt-executor-boundary.md` is accepted for the
production-shaped fake-executor milestone, `workflow-occurrence-projection.md`
for the runtime occurrence-classification milestone, and
`run-establishment-and-activation.md` is accepted in the maintainer
conversation that unified initialization and restoration under one idempotent
Run entry.

`reducer-lab-maintained-cassette-catalog.md` is accepted by the maintainer's
explicit lab synchronization request. It maps every maintained cassette to
production-runner execution evidence and covers the authored runner's
successful-recovery scheduling boundary.
