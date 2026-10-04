# Prepare the exact Codex task worktree before implementation checks

Accepted operational contract for [#420](https://github.com/dearlordylord/dalph/issues/420).
The existing `scripts/prepare-attempt-worktree.mjs` helper and agent
instruction are a tooling mitigation, not proof that production performs this
step.

## Governing behavior

The decision to prepare a task worktree preserves [one exact planned attempt](planned-attempt-executor-boundary.md#dalph-starts-and-completes-executor-work-for-one-planned-attempt), [recovery of an unsettled Begin](pre-turn-begin-recovery.md#chronology), and [D18 task locality](../DELIVERY-INVARIANTS.md#locality). The [planned-attempt model](../../specs/plannedAttemptExecutor.qnt) still requires `canRecordBeginIntent` after responsibility begins and `firstAcceptedReportIsExecuting`; preparation produces no executor report. This scenario adds a prerequisite to the first Codex task turn; it does not change app-server ownership, start, stop, or the Integrator's use of that server.

## Alice starts one Codex task with an unprepared worktree

Alice starts a production Run using a Codex executor profile. Git has created
the planned task attempt A1 at its exact Base and exact worktree W. The
worktree has no `node_modules`; the host shell selects Node 25, while W's
manifest and `mise.toml` select Node 24.20.0. Another independent task may
already be using its separate Codex app-server.

1. Before asking Codex to start A1's implementation turn, Dalph identifies W
   from the planned attempt and records an A1-scoped preparation intent. It
   starts one bounded preparation command with W as its exact current working
   directory. The command selects the repository Node, performs a frozen pnpm
   install, and checks the resulting worktree-local dependency store. The
   command's process and descendants belong to A1's preparation custody, not
   to the app-server lifecycle.
2. The command reports its selected Node, worktree, exit, and failure stage.
   Dalph validates that the successful report names W and records its observed
   completion. Only then may it submit A1's implementation turn to Codex.
   Codex's later source checks still use the repository launcher when their
   shell could reset `PATH`.
3. If selection or install fails, times out, or reports the wrong worktree,
   Dalph reports a typed A1 preparation failure. No A1 implementation turn
   starts. It leaves W available for diagnosis. Another task and the
   Integrator may continue using their separate app-servers.
4. If Dalph loses the preparation response or crashes after starting the
   command, it reads the exact A1 preparation intent and terminal receipt.
   The helper writes that receipt only after its bounded child groups have
   stopped. Dalph never infers absence from a missing receipt. It adopts a
   valid completed receipt after checking W and its dependency store; it
   retains a recorded failure for A1. A missing or unreadable receipt leaves
   A1 fenced: no second install or A1 implementation turn starts. A later
   planned attempt has a different identity and may prepare independently.
5. If Dalph crashes after recording the generic Begin intent but before this
   preparation begins, Codex reports no thread or turn. The preparation
   wrapper reads its own absent or completed record and issues a fresh,
   process-local, single-use Begin-not-crossed proof. Redelivery consumes that
   proof, prepares W if still absent, and invokes the existing Codex Begin as
   an initial delivery. An unresolved preparation record instead projects
   Unreadable and cannot authorize redelivery.

Alice sees either A1 enter implementation with the correct Node and installed
dependencies, or a preparation failure attributed to A1 and its stage. Dalph
must not turn a preparation failure into a source-code failure, run two
ambiguous installs in W, use another worktree's artifacts, stop or restart another attempt’s app-server to settle A1, or block independent tasks because A1 is
unprepared.

## Acceptance-test mapping

| Scenario outcome | Focused acceptance test |
| --- | --- |
| Fresh W selects W's Node and frozen dependencies before the first task turn | `prepares fresh dependencies with repository Node before entering the executor`; `writes an exact terminal receipt after the frozen install has completed` |
| Failing Node selection blocks A1 before its task turn | `does not cross the executor Begin boundary when preparation fails`; `retains a typed preparation failure without running the command again` |
| A1's failure does not stop B | `keeps one failed attempt local while a second worktree prepares`; the wrapper has no app-server control method |
| Lost response does not duplicate an unproved install | `keeps an intent fenced when the command returns without a terminal receipt` |
| A completed receipt is adopted after restart | `adopts an exact completed receipt after losing the first response` |
| A crash after generic Begin intent but before preparation can finish the original Begin | `redelivers the original Begin after a crash before preparation started`; `does not authorize Begin redelivery while preparation lacks a receipt` |
| Successful preparation is not repeated on Begin redelivery | `runs once in the exact worktree and reuses its durable success` |
| An unproved install descendant cannot produce a terminal receipt | `does not write a terminal receipt while an install descendant remains unproven` |

No tracker mutation, integration, or cleanup is added by this step. A failure
keeps the existing worktree; ordinary task disposition handles it later.
