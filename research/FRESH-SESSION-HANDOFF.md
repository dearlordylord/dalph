# Fresh-session handoff: invoker/invokee implementation tickets

## Current state — 2026-09-13

The [first-milestone specification](../docs/scenarios/invoker-invokee-first-milestone.md)
is published as [#365](https://github.com/dearlordylord/dalph/issues/365).
Ten reviewed tickets are published with `ready-for-agent`, chronological
acceptance criteria, scenario-to-test mappings and verified native blocking
links. The parent issue was not modified. No runtime implementation or master
integration was performed in this conversation.

| Ticket | Blocked by |
| --- | --- |
| [#366 — Concrete MCP/CLI contracts](https://github.com/dearlordylord/dalph/issues/366) | None |
| [#367 — Changing-graph finality correction](https://github.com/dearlordylord/dalph/issues/367) | None; corrected chronology required before runtime edits |
| [#368 — Host attachment and passive reads](https://github.com/dearlordylord/dalph/issues/368) | #366 |
| [#369 — Wake/Unpause and complete command lifetime](https://github.com/dearlordylord/dalph/issues/369) | #368 |
| [#370 — Revisioned capacity](https://github.com/dearlordylord/dalph/issues/370) | #369 |
| [#371 — Advisory refresh](https://github.com/dearlordylord/dalph/issues/371) | #369 |
| [#372 — Watches and truthful closure](https://github.com/dearlordylord/dalph/issues/372) | #369 |
| [#373 — Intermediate edits versus incomplete evidence](https://github.com/dearlordylord/dalph/issues/373) | #368 |
| [#374 — Actual host death and reconstruction](https://github.com/dearlordylord/dalph/issues/374) | #369 |
| [#375 — Complete public-client qualification](https://github.com/dearlordylord/dalph/issues/375) | #367, #370, #371, #372, #373, #374 |

This is the publication-time graph, not a replacement for tracker authority.
Read current issue bodies, comments, status and blocking links before acting.
#366 and #367 were the two unblocked starting tickets at publication.

## Review corrections to preserve

The user requested independent evaluation by Kimi CLI (`kimi-code/k3-256k`)
and an Astra subagent. Their records and adjudicated corrections are saved:

- [Original ten-ticket draft](invokee-ticket-breakdown-draft.md)
- [Kimi review](invokee-ticket-review-kimi.md)
- [Astra review](invokee-ticket-review-astra.md)
- [Review disposition and revised dependencies](invokee-ticket-review-disposition.md)

The published ticket bodies incorporate the corrections. In particular:

- #366 defines how a client obtains accepted Run disposition and exact journal
  position separately from coherent snapshots, and the typed finality-failure
  path; #368 implements those public results.
- #367 must establish a concrete corrected causal chronology before coding,
  preserve the unchanged validator and incomparable-history negative control,
  and declare the correction's Quint implications. Core finality evidence
  belongs there; #375 owns public-client composition of the outcomes.
- #369 qualifies command admission versus Exit immediately; #372 qualifies
  actual host shutdown and Closed delivery. #374 is only abrupt host death
  and reconstruction, with no dependency on watches.
- Every operation owns explicit MCP/CLI parity and its input/failure tests.
  Split scenarios name each assertion's owner. Each workflow slice owns its
  maintained cassette and relevant process/transport tests.
- #368 remains the largest sizing risk. #366 must bound its design or propose
  an explicit adapter split before implementation; do not silently expand it.

The local specification remains the published parent text; these refinements
are carried by the child tickets and this review record. Accepted product
decisions need no new interview. Research probes are not maintained acceptance.

## Resume without the conversation

Read this handoff, #365, the review disposition, then the current #366 or #367
issue and its actual blockers. Choose one ticket explicitly before starting
implementation and follow its operational-scenario gate. Use the research
reading order below for evidence. Do not regenerate the specification or
duplicate the ten published tickets.

The research branch `research/invoker-invokee-interview` is pushed to origin.
This archival update preserves the previously uncommitted specification and
the review records; no temporary review file is needed to resume. It changes
documentation only, so runtime and model gates are not rerun. Verification is
documentation consistency, local links, whitespace and normal commit hooks.

## Original research handoff

The remaining sections retain the research context and historical suggested
specification prompt. Current publication and next steps above supersede their
old task status; the original experimental limitations still apply.

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

## Historical specification prompt — already completed

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
their READMEs record those prerequisites. The research branch and this archival
handoff are pushed to origin; the temporary resources themselves are not.
