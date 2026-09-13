# Fresh-session handoff: invoker/invokee specification

This file is the entry point for continuing without the original conversation.
Material decisions, evidence, limitations and runnable probes are committed in
this research worktree. A specification and implementation tickets have not
been created. The user will request those steps explicitly.

## Open the correct workspace

- Worktree: `/workspace/typescript/dalph-worktrees/invoker-invokee-interview`
- Branch: `research/invoker-invokee-interview`
- Latest accepted decision: commit `8d46b8553`, Q27 (start work preserves Pause).
- Latest full research round: commit `5976e1601`.
- Production source examined by that round: `f99a2343f5b5d90c08e84b536ffab4a8d562b1fb`.
  That commit and the subsequent research commits do not change production code.

Do not start specification work in the sibling master workspace by accident.
The original workspace had unrelated user edits; they were not transferred.
Keep this work isolated unless the user explicitly requests integration.
Use pnpm. Check this worktree's status and applicable AGENTS.md first.

## Reading order and precedence

1. [Research conclusion](invokee-research-conclusion.md): integrated findings,
   limits, recommendations and verification record.
2. [Accepted first milestone](invokee-first-milestone.md): concrete user story,
   accepted initial scope, exclusions and acceptance seams.
3. [Interview](invoker-invokee-interview.md): decision provenance; later answers
   override earlier questions/proposals. Q17, Q22–Q27 are particularly relevant.
4. [Scope/readiness audit](invokee-spec-readiness-audit.md): older proposals that
   must not become requirements and remaining technical contract work.
5. [Operation research](invokee-operation-contract-research.md): actual existing
   read/watch, capacity, wake, Unpause and refresh boundaries and their limits.
6. Follow the evidence links below and read the repository's
   [operational scenario gate](../docs/OPERATIONAL-SCENARIOS.md),
   [context](../docs/CONTEXT.md), [architecture](../docs/ARCHITECTURE.md),
   [development guide](../docs/DEVELOPMENT.md) and
   [review requirements](../docs/CODE_REVIEW.md) before specifying behavior.

The [research index](README.md) lists the broader investigations. Older research
is exploratory: do not turn every proposed mechanism into scope. In particular,
no mandatory publication barrier, Dalph-authored tracker edit protocol,
parent/child chat, handback, recursive credentials, or manual-takeover standard
was accepted for the initial milestone.

## Decisions to preserve

- Support Dalph both autonomously and as an agent-invoked tool, simultaneously.
- First milestone: separately started host, one Run per repository, existing
  single-root graph. MCP and CLI reach shared application operations.
- Dalph chooses eligible work. Arbitrary task selection is outside the plan,
  not a later backlog commitment. Refresh IDs do not select work.
- Graph granularity is tasks, explicit blocker dependencies and optional opaque
  executor associations. Grouping does not imply blockers or parent execution.
- Clients can inspect current state and subscribe; their exit does not stop the
  host, release task capacity, close tasks, or authorize cleanup.
- Agents author task/dependency facts directly in the tracker. Refresh carries
  only a whole-graph hint or advisory IDs; Dalph reads the authority. Startup
  and scheduled reads already exist; no startup refresh call is required.
- Q17 accepts acting on a complete intermediate tracker state before later
  edits add blockers. Incomplete provider evidence is a different matter and
  cannot prove blockers absent.
- Q27: a general start-work request preserves Pause. Only explicit
  Resume/Unpause changes it. Agents can invoke these operations under existing
  instructions, with no per-command human approval or parent handback.
- Native human access is desirable where the execution host supports it;
  custom conversation/takeover protocols are not initial prerequisites.
- External worker registration/adoption remains a separate research track.
  Missing reports or expired leases do not prove stopped writers.
- Recursive implementer yielding for prerequisites is accepted later core work
  in the current planned set. Partial work, stop evidence and successor-attempt
  disposition need their own later chronology.

## Evidence that must shape the specification

- [Command interruption](invokee-command-interruption-results.md) and
  [callback recovery](invokee-command-recovery-results.md): live Journal masks
  interruption through storage and accepted publication, but an outer callback
  can still be skipped. An ongoing owner can remain paused despite durable
  Unpause. Independently owning the complete command preserves the callback;
  fresh owner reconstruction recovers from journal history. Capacity retry
  conflicts without another change; blind Unpause retry adds a direction and
  can override an intervening Pause.
- [Actual MCP-to-host composition](invokee-mcp-host-results.md): real stdio MCP
  child replacement, capacity CAS against the original production bootstrap,
  and actual delivery completion with one coordinator and zero Exit requests.
  The transport is disposable and providers controlled; this is not a shipped
  MCP or CLI feature.
- [Live graph stream](invokee-graph-stream-results.md) and
  [slow-watcher candidate](invokee-slow-watch-results.md): current-first,
  changes, reconnect and retained Closed were exercised. Coalescing can retain
  latest/final state, but one sliding stage does not bound total memory. Journal
  position is not a sequence number for every runtime publication.
- [Changing graph](invokee-changing-graph-results.md): new tasks/blockers become
  visible through real timer refresh, and retained execution respects capacity
  even when desired task ranking changes. `GraphNotEstablished` during refresh
  is not task deletion; any retained UI graph must be explicitly stale.
- **Reproduced terminal-evidence gap:** after A delivers, the later graph read
  `g11` is `WorkflowEstablishment` with no predecessors, while earlier graph
  evidence records A open. The journal rejects termination as causally
  incomparable. The test intentionally asserts this failure and zero terminal
  records. A passing reproduction is not successful Run settlement. Preserve
  the causal validator; do not assume the gap was fixed or waive it by changing
  the expected outcome to success without a qualified correction.
- [External workers](invokee-external-worker-participation.md): admission before
  launch can enforce the execution bound; registration afterward cannot
  retroactively do so. Qualifying a real external substrate's identity,
  adoption and activity evidence is later work, not a fake-provider proof.

Detailed notes contain scenario-to-test mappings and one-command reproduction
instructions. Four new tracks were independently checked: recovery 2/2,
MCP-host 1/1, slow-watch 2/2, changing-graph 1/1 (negative reproduction).
Earlier results and their limitations remain linked from the research index.

## Suggested prompt for a new session

```text
$to-spec

Work in /workspace/typescript/dalph-worktrees/invoker-invokee-interview
on research/invoker-invokee-interview. Read research/FRESH-SESSION-HANDOFF.md
and its reading order first.

Create a specification for the accepted first invoker/invokee milestone,
using the committed interview decisions and research evidence. Preserve Q27:
start work keeps Pause; explicit Resume/Unpause changes it. Distinguish
validated mechanisms from missing production boundaries and the reproduced
graph-finality gap. Keep later external-worker and recursive-yield protocols
out of the initial milestone while preserving their compatibility requirements.

Follow the repository's operational-scenario gate and scenario-to-test mapping.
Create the specification only: no implementation, ticket creation, live
provider mutations, or integration into master. Ask only for a genuinely
unresolved product decision; don't reopen settled interview answers.
```

The new session must have the `to-spec` skill available to execute that skill.
It was not available in the research session's skill catalog and has not been
installed or invoked here. The committed handoff works regardless of whether
that skill is present; do not pretend to have followed an unavailable skill.

## What survives closing the conversation

Committed: decisions, accepted scope, evidence summaries, source citations,
known gaps, review corrections, scenario mappings and runnable disposable probes.
The conversation and running agents are not needed to resume this work.

Not archival guarantees: ignored `.scratch` logs, temporary databases/worktrees,
or locally installed dependencies. Disposable runtime resources were cleaned
up; raw diagnostic logs are supplementary, not the sole record of findings.
Some probes use a built Dalph fixture binary and the sibling installed MCP SDK;
their READMEs record those prerequisites. These commits are local to this
workspace; no remote backup or push is claimed. Closing the chat does not
remove the committed files, but loss of the workspace would require a separate
repository backup.
