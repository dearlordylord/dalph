> Archived review record from 2026-09-13. Publication and current next steps are recorded in [the handoff](FRESH-SESSION-HANDOFF.md). Statements about unpublished tickets describe review time.

# Proposed ticket breakdown for issue #365

This is a proposed breakdown, not published tickets or implementation. The user accepted the broad shape and requested independent Kimi k3-256 and Astra evaluation before proceeding.

Authoritative source: https://github.com/dearlordylord/dalph/issues/365 (read full body and comments). A fetched copy is docs/scenarios/invoker-invokee-first-milestone.md. The local specification is docs/scenarios/invoker-invokee-first-milestone.md in /workspace/typescript/dalph-worktrees/invoker-invokee-interview. Read research/FRESH-SESSION-HANDOFF.md and the records in its reading order, particularly command interruption/recovery, changing graph, graph stream, MCP host, and slow-watch evidence. Later interview answers override old exploratory proposals. Production probes do not constitute maintained acceptance tests.

All implementation tickets preserve the parent scenarios, forbidden results, authority boundaries, and declared dependencies. Both CLI and MCP should expose each slice's supported operation through the same existing host. Tickets must be independently verifiable, narrow vertical slices sized for one fresh context window. The contract prerequisite is documentation-only. No broad refactor was found necessary.

1. Specify the remaining connection and observation contracts
Blocked by: None.
Delivers: Concrete local addressing, CLI commands, MCP tools/resources, request/result encodings, and finite frame, subscription, and write limits. Records chronological scenarios before affected implementation begins. Necessary documentation prerequisite; no runtime changes.
Acceptance mapping: Contract cases for S1–S12, including admission, cancellation, typed failures, and closure.

2. Settle changing graphs with justified causal evidence
Blocked by: None.
Delivers: After A delivers in the research four-task graph, Dalph records actual Blocked termination using justified replacement evidence. Preserve the validator and rejection of genuinely incomparable observations. Independent of attachment work.
Acceptance mapping: S10 negative reproduction AND corrected production chronology; assert actual terminal record.

3. Attach MCP and CLI clients to one host and read current delivery
Blocked by: 1.
Delivers: Separate host startup, selected-Run descriptor, and passive coherent snapshots through both interfaces. Tasks, separate grouping/blocker edges, frontier, status, and opaque executor associations. Client exit leaves delivery running.
Acceptance mapping: S1 snapshot cases; S2 client replacement and one-task completion; S11 connection/identity failures; S12 snapshot lifecycle.

4. Request work and explicitly Unpause through commands owned by the host
Blocked by: 3.
Delivers: Start work preserves Pause. Explicit Unpause survives client loss through SQLite acceptance and actual owner callback. Both interfaces expose durable Run control, truthful unknown outcomes, and callback failure after durable application. Establish shared command-admission mechanism.
Acceptance mapping: S4 SQLite cuts, callback count, timer restart, and failure variant; S5 pre-admission cancellation and lost Unpause without replay over another Pause; S12 terminal rejection.

5. Change capacity safely from competing clients
Blocked by: 4.
Delivers: MCP/CLI read and update revisioned capacity through shared command boundary. Increasing capacity admits eligible B; decreasing preserves running attempts. Conflicts return complete current policy; inactive capacity explicit.
Acceptance mapping: S3 actual admission and retained attempts; S5 competing writers and lost-response cuts; S12 inactive/terminal read and set.

6. Request tracker refresh without selecting work
Blocked by: 4.
Delivers: Both interfaces submit whole-graph or advisory-ID hints. Later observations come from complete tracker reads. Startup/timer discovery continue without notifications; acknowledgement never claims read completion.
Acceptance mapping: S6 discovery prefix and paused, idle, active, coalesced, terminal cases. Complete delivery suffix belongs to ticket 10.

7. Watch current delivery with truthful slow-client and closure behavior
Blocked by: 3.
Delivers: MCP subscriptions and CLI watches preserve attached current, coalesce later complete states, deliver Closed before normal EOF. Stalled/oversized observations fail explicitly; disconnect releases subscription including upstream retention.
Acceptance mapping: S1 attachment race; S2 watch cancellation/broken stdout; S8 current/latest/Closed, same-position updates, deadlines, limits, reconnect; S12 source lifecycle.

8. Distinguish intermediate tracker edits from incomplete evidence
Blocked by: 3.
Delivers: Dalph may admit D after complete read before blocker authored. Missing/contradictory evidence cannot justify admission. Clients distinguish unavailable graphs from deletion and explicitly stale display.
Acceptance mapping: S7 controlled authoring interleaving, missing-page/blocker failures, unavailable-graph presentation. No publication barrier or automatic yielding.

9. Recover after host death and qualify graceful shutdown
Blocked by: 4, 7.
Delivers: Actual host killed after durable Unpause before callback permits separately started reconstruction of same Run and exact responsibilities without replay. Graceful Exit refuses later commands and finishes writable observers within existing lifecycle budget.
Acceptance mapping: S9 actual process cut, reconstruction, admission/Exit races; S8 shutdown ordering and failed final-frame delivery.

10. Qualify the complete milestone through both public clients
Blocked by: 2, 5, 6, 8, 9.
Delivers: Complete A/B/E-to-C story reaches accepted Completed after client replacement and exact resource settlement. Retain independent one-task and changing-graph Blocked cases. Publish scenario-by-scenario evidence and required repository checks.
Acceptance mapping: Full S6 suffix, both S10 outcomes, complete S1–S12 census.

Review request: Read-only evaluation of this plan AND specification against actual research and source. Identify concrete missing/contradictory behavior, operational scenario gate gaps, ticket sizes that cannot reasonably fit a fresh context, false/missing dependencies, acceptance deferred too late, and unjustified scope. Distinguish blocking findings from optional suggestions. For each finding cite source/section, concrete scenario consequence, and smallest correction. Evaluate whether the technical-contract ticket gives enough instructions to complete the specification without reopening accepted product decisions. Check known finality defect and negative control, full-command admission/Exit ownership, lost response vs callback failure, all S1–S12 rows, MCP/CLI parity, upstream retention, host closure vs termination, and exclusions. Do not implement, edit repo files, publish tickets, change parent, or run provider mutations. Return verdict, prioritized findings, corrected graph if needed, and acceptance census. You may write your review only to the review output path supplied by the caller.
