# Restart after the tracker applies an exact claim without acknowledging it

The maintainer restarts the public host after an acquisition response is lost.
This task adds qualification evidence only: no production workflow decision,
journal format, or recovery policy changes.

## Governing behavior

[Claim reconciliation](reconcile-task-claims.md) owns exact matching and foreign
or unreadable authority. [Process and durability invariants](../DELIVERY-INVARIANTS.md#process-and-durability)
require intent before uncertain effects and reconciliation before retry. This
composition preserves those rules and the existing recovery-prefix inventory;
it adds only physical process-loss and SQLite evidence.

## Starting facts and chronology

The fixture owns a temporary Git repository, SQLite Journal, coordinator lock,
and file-backed controlled GitHub claim. One open task has no prerequisites;
there is no plan, worktree, executor session, or prior claim. The maintainer
starts the public production command.

1. Dalph establishes Run R and persists acquisition operation K, including owner,
   task and token, before asking the tracker to create its exact claim label.
2. The controlled tracker writes that label to its file and withholds the reply.
   The fixture kills the host before any acquisition outcome is durable.
3. A fresh process opens the current-format SQLite Journal under the ordinary
   exclusive coordinator ownership and selects the same R. It asks the tracker
   for the same label. The fixture withholds this read and kills that process.
4. A third process opens the same Journal, selects R again and repeats the
   tracker read. Exact matching evidence records the original K as acquired.
   The public historical snapshot exposes that exact retained claim.
5. The fixture stops the third process while task specification reading is
   pending. No plan existed before these cuts, so plan retention is inapplicable;
   no attempt or executor may be allocated from an unread specification.

The maintainer sees one recovered Run and one claim responsibility. Both
restarts must send zero acquisition mutations, preserve all four claim identity
fields, and record only one Run beginning and one acquisition intent/outcome.
No live provider is contacted. Dependency release is not inferred from claim
ownership; current tracker facts remain the authority. Foreign, contradictory,
and unreadable evidence cannot authorize continuation or overwrite a claim.

## Retained evidence and missing composition

Before this extension, the following retained tests already proved:

- `rereads tracker authority after an ambiguously applied acquisition` and
  `returns an already-owned exact claim without another mutation` in
  [the acquisition protocol tests](../../packages/orchestrator/src/workflow/protocols/task-claim-acquisition/protocol.test.ts)
  prove readback and exact identity without duplicate mutation. The foreign and
  unreadable final-reconciliation variants prove typed blocked results.
- [Journaled acquisition tests](../../packages/orchestrator/src/workflow-journal/journaled-claim-acquisition.test.ts)
  prove terminal foreign rejection and preservation of unfinished acquisition
  intent after throttling.
- The `tracker-claim-acquisition` family in
  [the recovery-prefix manifest](../../packages/dalph/test/conformance/recovery-prefix-manifest.ts)
  maps intent, outcome and claim-read endpoints to those tests and the maintained
  `changedAttemptReacquisitionForeignConflict` cassette. The
  [claim scenario](reconcile-task-claims.md) maps public explanations and retained
  plans; [completion graph refresh](../../packages/dalph/test/conformance/recovery-prefix-evidence.ts)
  retains fresh dependency authority rather than treating claims as success.
- The existing public SQLite restart test already proved the applied-claim cut,
  same Run selection, exact label read and absence of a second mutation.

`unfinished SQLite public restart repeats a cut claim read in the same Run
without another acquisition` in
[public recovery integration tests](../../packages/dalph/src/application/production-public-recovery.integration.test.ts)
now composes the second physical process cut with another fresh tracker read,
exact durable outcome, one intent and no duplicate plan. It reuses the shipped
CLI/host, real SQLite, OS coordinator ownership and the existing controlled
GitHub boundary; it adds no tracker recovery engine or subprocess matrix.
