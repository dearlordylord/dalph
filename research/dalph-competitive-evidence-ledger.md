# Dalph competitive evidence ledger

**Audit date:** 2026-07-31
**Audited revision:** `c8efc4c6370860e2e610d2ceb96e8fafd00e619b`
**Status:** source and repository-test audit; no competitor or Dalph crash
experiment result is claimed here.

## Purpose

This ledger prevents an intended Dalph capability from being compared as if it
were already a production result. It records four different statements for
each mechanism:

- **Architecture**: accepted Dalph architecture or scenario says the mechanism
  belongs in the product.
- **Implemented now**: the audited source contains a reachable implementation.
- **Proven now**: repository evidence exercises the implemented scope. This is
  never a claim that all deployments, providers, or crash points are proven.
- **Evidence boundary**: the strongest evidence available: source inspection,
  example/property/model-based tests, Quint model checking, or a real
  process/boundary fault experiment.

`Partial` is deliberately local to one row. Dalph is not globally “partial”:
some mechanisms are implemented and exercised, while others remain later
architecture.

## Current ledger

| Mechanism | Architecture | Implemented now | Proven now | Evidence boundary and honest claim |
|---|---|---|---|---|
| External tracker graph controls eligibility | Yes | Yes, for the current graph-read, reconstruction, refresh, and frontier path | Yes within deterministic and GitHub-adapter tests | The architecture keeps task identity, lifecycle, dependencies, grouping, and claims in the tracker ([authority and reconstruction](../docs/ARCHITECTURE.md#durability-and-reconstruction)). Observation and property tests exercise canonical graph reconstruction and replay ([observation tests](../packages/orchestrator/src/workflow/task-tracker-facts/observation.test.ts), [graph properties](../packages/orchestrator/src/authorities/task-tracker/graph.property.test.ts)). This does not prove every tracker provider or network failure. |
| Immutable workflow history and a pure reconstruction core | Yes | Yes | Yes at unit/property-test level | Distinct pure reducers rebuild graph knowledge, workflow responsibility, control policy, pause state, and retained history, then validate cross-component relationships ([reducer](../packages/orchestrator/src/coordination/reconstruction/reduce.ts), [architecture](../docs/ARCHITECTURE.md#durability-and-reconstruction)). History-prefix, invariant, and generated recovery tests exercise this model ([history scenarios](../packages/orchestrator/src/coordination/reconstruction/history-scenarios.test.ts), [reduction property](../packages/orchestrator/src/coordination/reconstruction/reduce.property.test.ts), [frontier properties](../packages/orchestrator/src/coordination/frontier/recovery.property.test.ts)). No process-kill experiment is claimed. |
| Narrow journal rather than copied external current state | Yes | Yes for current event families | Partly | Source inspection shows workflow occurrences are journaled while tracker, Git, and executor facts retain separate owners ([architecture](../docs/ARCHITECTURE.md#durability-and-reconstruction)). Tests prove decoding, semantic validation, and SQLite lifecycle behavior ([journal store tests](../packages/orchestrator/src/workflow-journal/store.test.ts)). The journal does not yet cover every future executor, integration, hosting, and cleanup boundary. |
| One workflow algebra interpreted through production, deterministic fake, and dry-run services | Yes | Yes for the current workflow surface | Yes within repository composition tests | Effect services and Layers substitute tracker, Git, journal, executor, clock, and denied dry-run capabilities while the workflow selects the same operation types ([production composition](../packages/dalph/src/application/production.ts), [dry-run composition](../packages/dalph/src/application/dry-run.ts), [interpreter layers](../packages/orchestrator/src/workflow/interpretation/layers.ts)). Scenario and dry-run tests exercise those compositions ([generic workflow](../packages/dalph/test/scenarios/generic-workflow.test.ts), [dry-run tests](../packages/dalph/src/application/dry-run.test.ts)). This is maintainability/testability evidence, not restart durability by itself. |
| Intent before an ambiguity-crossing effect, observation afterward, reconcile before retry | Yes | Partial: implemented for named tracker reads and claims and named Git observations/reconciliation paths | Yes for those named paths; no universal proof | The journaled interpreter records tracker/Git intent, reuses an existing exact observation, otherwise calls the boundary and records its result ([journaled interpreter](../packages/orchestrator/src/workflow-journal/journaled-interpreter.ts)). Claim and Git tests exercise individual protocols ([claim acquisition](../packages/orchestrator/src/workflow-journal/journaled-claim-acquisition.test.ts), [worktree observation](../packages/orchestrator/src/workflow-journal/journaled-worktree-observation.test.ts), [Git decisions](../packages/orchestrator/src/workflow/protocols/git-reconciliation/decision.test.ts)). Production executor start, complete integration promotion, hosting effects, and all cleanup effects do not yet share a proven end-to-end implementation. |
| One exact planned attempt with task revision, Base SHA, branch, and worktree locator | Yes | Yes in the current planner and Git worktree boundary | Yes at contract/property/adapter-test level | Planned-attempt schemas and planning properties bind the identities and immutable starting point ([planned-attempt properties](../packages/contracts/src/planned-attempt.property.test.ts), [planning properties](../packages/orchestrator/src/workflow/protocols/task-attempt-planning/plan.property.test.ts)); the production-shaped composition installs the real worktree adapter ([production composition](../packages/dalph/src/application/production.ts)). This proves construction and local Git behavior, not restoration of a destroyed directory or every Git worktree layer after a host failure. |
| Bounded parallel task work | Yes | Yes for the coordinator and current coarse executor boundary | Yes with example, property, MBT, and Quint evidence in the milestone scope | Admission retains exact occupied positions and refuses new work at the ceiling ([activation properties](../packages/orchestrator/src/coordination/activation/coordinator.property.test.ts), [capacity tests](../packages/orchestrator/src/coordination/admission/capacity.test.ts)). The planned-attempt model and MBT cover running/suspension/terminal position behavior ([Quint model](../specs/plannedAttemptExecutor.qnt), [model-based test](../packages/dalph/test/conformance/planned-attempt-executor.mbt.test.ts)). This does not prove accounting for an independently surviving production executor. |
| Safe suspension of one exact attempt | Yes | Yes only at the generic boundary and controlled test implementations | Yes for that outer contract | The conformance implementations report `SafelySuspended` only for the same `(RunId, AttemptId)`, and generic orchestration retains capacity until that report ([controlled test support](../packages/orchestrator/test/controlled-planned-attempt-executor.ts), [accepted scenario](../docs/scenarios/planned-attempt-executor-boundary.md)). No production provider/process has yet proved that its agent context, logs, worktree state, and activity are safely resumable. |
| Restart reconstructs the Dalph attempt and continues through the ordinary activation path | Yes | Yes for the shared-process fake milestone | Yes for reconstructed history plus a recreated fake | The accepted scenario models Dalph and the fake dying together, reconstructs the same attempt, creates a new fake instance, and continues through normal activation ([restart scenario](../docs/scenarios/planned-attempt-executor-boundary.md#dalph-and-the-controlled-fake-executor-restart-together), [protocol test](../packages/orchestrator/src/workflow/protocols/planned-attempt-executor-work/protocol.test.ts)). This is a simulated shared-lifetime restart, not a real OS process-kill result. |
| Restore the complete user coding session: agent context/log plus committed, staged, unstaged, untracked, ignored, conflicted, and stashed worktree state | Yes, with production mechanics left to post-milestone design | Partial only for observing/reconciling the exact worktree; agent/session restoration is not implemented | No end-to-end proof | Git owns the worktree and the executor will own session/process observations, but current production-shaped wiring uses a same-process fake ([production composition](../packages/dalph/src/application/production.ts), [architecture limitation](../docs/ARCHITECTURE.md#durability-and-reconstruction)). Existing worktree tests do not prove provider context/log restoration or recreation of every Git layer after directory loss. |
| Adopt or safely classify independently surviving production executor work | Yes as post-milestone architecture | No | No | The architecture and accepted executor scenario explicitly say independent coordinator/executor lifetimes are post-milestone ([architecture limitation](../docs/ARCHITECTURE.md#durability-and-reconstruction), [scenario limitation](../docs/scenarios/planned-attempt-executor-boundary.md#dalph-and-the-controlled-fake-executor-restart-together)). The controlled test implementation stores reports in a process-local `Ref` and loses them with its Layer scope ([controlled test support](../packages/orchestrator/test/controlled-planned-attempt-executor.ts)). |
| Separate, per-target serialized integration admission | Yes | Yes for durable queueing, FIFO selection, start cutoff, and process-local target resource ownership | Yes at unit/model level for this admission slice | Immutable journal events derive integration responsibilities and select at most one start per free target ([admission protocol](../packages/orchestrator/src/workflow/protocols/integration-admission/protocol.ts)); the ordinary recovery runner executes those admission transitions ([integration runtime](../packages/orchestrator/src/coordination/run/integration-transition-runtime.ts)). Tests exercise admission and the resource controller ([protocol tests](../packages/orchestrator/src/workflow/protocols/integration-admission/protocol.test.ts), [resource tests](../packages/orchestrator/src/coordination/admission/integration-target-resource.test.ts)). |
| Advance an accepted Git target safely, reconcile a lost response, verify the combined result, and finish cleanup | Yes | No complete reachable production lifecycle | No | The detailed accepted-head design exists ([integration protocol research](./concurrent-accepted-head-integration-protocol.md)), and Git decision functions reject stale or ambiguous observations ([Git decision tests](../packages/orchestrator/src/workflow/protocols/git-reconciliation/decision.test.ts)). Current reachable integration transitions stop after queue/start/resource bookkeeping; they do not perform the complete promotion, review, verification, ambiguous-result reconciliation, and cleanup lifecycle ([integration runtime](../packages/orchestrator/src/coordination/run/integration-transition-runtime.ts)). |
| Cleanup is exact, recoverable, and refuses to delete uncertain work | Yes | Partial domain/frontier preservation behavior; no complete production cleanup protocol | Partial | Current reconstruction and Git decisions retain or isolate uncertain responsibility instead of authorizing overwrite or deletion. That is useful safety evidence, but it is not yet a complete disposition implementation across tracker claims, worktrees, executor resources, branches, logs, and integration artifacts. |
| Effect Workflow supplies durable replay | Research candidate only; not adopted Dalph architecture | No | No | The source audit found that SQL-backed Effect Workflow restarts a handler and reuses named stored results; it does not restore a fiber, provider session, process, or Git index and would introduce another durable protocol ([Effect/Workflow/OTP comparison](./effect-otp-durable-workflow-comparison.md)). Dalph currently relies on ordinary Effect plus its narrow journal. |

## Restoration claim by layer

The user experiences one coding session, but the implementation must report its
parts separately because they can survive independently.

| Layer | Current Dalph position | What can honestly be said now |
|---|---|---|
| Dalph run and planned attempt | Implemented and repository-tested | Exact run/attempt responsibility and its journaled workflow facts can be reconstructed in the current milestone. |
| Agent context and Agent Log | Not implemented for a production executor | The architecture assigns these facts to the executor; no same-session continuation claim is currently justified. |
| Exact worktree and all Git/file layers | Partially implemented | Dalph plans and observes an exact worktree and makes conservative reconciliation decisions. It has not proved recreation or preservation of every committed/uncommitted layer across all loss modes. |
| Live process/container/provider invocation | Not implemented for independent survival | The current fake shares Dalph's process and cannot be adopted after Dalph alone dies. |

Therefore “Dalph restores the session” is presently too broad. The accurate
statement is:

> Dalph architecture treats restoration as one user session composed of four
> separately observed layers. At the audited revision, Dalph reconstructs its
> own run/attempt and exercises exact-worktree reconciliation, while production
> agent-context and independently surviving-executor restoration remain
> unimplemented.

## What the current evidence can and cannot support

The current repository can support these comparison statements:

- Dalph has a real immutable-history and pure-reducer core, not merely a future
  preference.
- It already uses Effect service interpretation to exercise the same workflow
  decisions against different boundaries.
- Exact attempt identity, planned Base SHA, bounded task admission, selected
  tracker/Git ambiguity protocols, and integration admission have source and
  repository-test evidence.
- The architecture is intentionally broader than the milestone implementation.

It cannot yet support these statements:

- Dalph has restored a real Codex or Claude session after the coordinator died.
- Dalph has preserved or recreated every worktree layer after loss of the
  original directory.
- Dalph has adopted a surviving production executor without duplicating work.
- Dalph has completed and crash-tested the whole accepted-head integration
  lifecycle.
- Dalph has empirically outperformed a competitor under crash injection.

Competitor restart behavior in the accompanying comparison remains inferred
from pinned source, tests, and first-party documentation. It must be described
as **source-inferred**, not experimentally observed.
