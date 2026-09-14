> Archived review record from 2026-09-13. Publication and current next steps are recorded in [the handoff](FRESH-SESSION-HANDOFF.md). Statements about unpublished tickets describe review time.

# Kimi review — kimi-code/k3-256k

## Verdict

**Approve with corrections.** The plan is unusually faithful to the specification: every S1–S12 row has a named owner, the dependency graph contains no false edges I could find, the exclusions are not smuggled back in, and the specific traps the review request names (finality defect and negative control, command admission vs Exit ownership, lost response vs callback failure, MCP/CLI parity, upstream retention, host closure vs termination) are all represented in both plan and spec. Three findings should be resolved before the tickets are published; none requires reopening accepted product decisions. The specification itself needs no changes — every finding below is a ticket-text correction.

## Blocking findings (resolve before publishing)

**B1 — S10's corrected outcome is double-owned, and ticket 2's attachment independence is unqualified.**
Ticket 2 claims "S10 negative reproduction AND corrected production chronology; assert actual terminal record" while "Independent of attachment work"; ticket 10 claims "both S10 outcomes" and "Retain independent one-task and changing-graph Blocked cases" (research/invokee-ticket-breakdown-draft.md lines 14–17, 54–57). But the spec's S10 chronology includes an attached client observing separate grouping/prerequisite edges (step 2) and a replacement client reading the four-task graph (step 3), and the spec warns "Do not promote the research probes into maintained acceptance evidence by renaming them" (`invoker-invokee-first-milestone.md`, Qualification boundary). Scenario consequence: two tickets can each believe they own the S10 correction test, or ticket 2 can "qualify" the correction by renaming the disposable changing-graph probe — exactly the failure mode the spec prohibits; and ticket 2 as written cannot exercise the scenario's client-replacement steps without ticket 3's public boundary. Smallest correction: ticket 2 states its seam explicitly — maintained tests on the production-host composition with controlled GitHub/Codex reusing the changing-graph fixture *shape* (which the spec's Testing Decisions expressly authorizes), asserting the validator-unchanged `Blocked` record and retaining the negative control — and ticket 10 owns re-asserting both S10 outcomes through the public MCP/CLI clients plus the census. One sentence in each ticket.

**B2 — Ticket 4 cannot fully execute S4's required test because Refresh lands in ticket 6, which is blocked by ticket 4.**
S4 step 1 is "Her agent sends start work, then refresh. Both hint calls return without overriding Pause," and the spec's S4 required test asserts "no wake/refresh override" (scenario-to-test mapping, S4 row). Ticket 4's deliverables cover start work and Unpause only; the public Refresh operation is ticket 6, "Blocked by: 4." Scenario consequence: ticket 4 as mapped either ships with the S4 test partially implemented through the public boundary (handoff rule requires scenario→passing-test mapping per ticket) or silently drops the refresh assertion. Smallest correction: ticket 4 scopes the refresh half of that assertion to the existing `RunReactivationHint.TrackerNotification` owner seam (the pause-discard behavior is already owner-local per `invokee-operation-contract-research.md` "Wake"), and ticket 6's acceptance mapping adds "re-qualify S4's no-override assertion through the public Refresh operation." Alternatively move Refresh into ticket 4 — but that would worsen its size (see S1 below), so prefer the split assertion.

**B3 — Ticket 2 is silent on the Quint disposition for a termination-governed behavior change.**
The correction makes later complete graph facts carry "justified causal replacement evidence" so ordinary finality can classify the graph. Termination is model-governed: the spec's governing-behavior table binds it to `runActivation.qnt` laws (`terminationRequiresExactFreshGraphEvidence`, `blockedRequiresFreshConclusiveTrackerFacts`, `terminationRequiresLaterSettledObservation`), and the spec states "A future behavior change governed by a model must follow the Quint guide and retain reachability/negative controls." The spec also records that "These abstractions do not qualify the reproduced concrete graph-predecessor gap" — i.e., the defect is concrete (the `WorkflowEstablishment` read built without predecessors at `delivery-action-adapter-common.ts:46-57`, per `invokee-changing-graph-results.md` source findings), which suggests the model may not need to change — but ticket 2 must say so, not leave it implicit. Scenario consequence: a ticket implementer either touches the model without the required guide controls or leaves an unexplained divergence between model law and concrete correction. Smallest correction: add one line to ticket 2 — "Quint disposition: state whether the correction is concrete-only (cite the spec's abstraction-gap note) or model-changing (follow docs/QUINT-GUIDE.md with negative controls retained)."

## Should-fix findings

**S1 — Ticket 3 is the size outlier; it likely does not fit one fresh context window.**
It delivers: separate host startup exposure, the versioned selected-Run descriptor, the public snapshot projection (tasks, separate grouping/blocker edges, frontier, status, opaque executor associations — a new supported DTO), *both* MCP and CLI adapters, plus acceptance for S1 snapshot cases, S2 client replacement with real one-task completion, the S11 four-way failure matrix (`HostUnavailable`, `ProtocolVersionUnsupported`, `InvalidRequest`, `RunMismatch`), and S12 snapshot lifecycle. Every other ticket is either narrower or cohesive around one mechanism (ticket 4 is heavy but single-mechanism: command admission). Consequence: the "narrow vertical slice sized for one fresh context window" constraint the plan sets for itself is most at risk exactly at the foundation ticket, where a stall blocks the most dependents. Smallest correction: pre-authorize a split — 3a: host exposure + descriptor + snapshot read + one adapter + S1/S11; 3b: second-adapter parity + S2 replacement/completion + S12 lifecycle — with 4 and 7 then blocked by 3a+3b (or by 3a for CLI-first and 3b for MCP parity). Recording the fallback costs one paragraph now and avoids an ad-hoc re-plan mid-stream.

**S2 — MCP/CLI parity has no named acceptance assertion anywhere.**
User story 3 ("a CLI reaching the same operations as MCP, so that either interface gives the same results") and the plan's own preamble promise per-slice parity through one host, but no ticket's acceptance mapping includes a parity check (same operation decoding to the same request/result algebra and outcome through both adapters). Consequence: parity is asserted ticket-by-ticket in prose but never proven; drift between adapters would pass every listed acceptance mapping. Smallest correction: ticket 3 (or 10's census) adds one explicit assertion — each supported operation exercised through both interfaces against the same host yields the same normalized result/failure variant.

**S3 — Split scenario ownership needs explicit partial-assertion bookkeeping.**
S1 (tickets 3+7), S2 (3+7), S5 (4+5), S8 (7+9), and S12 (3+4+5+7) each map to one required test in the spec but are split across tickets. The plan does name the parts ("S12 snapshot lifecycle" vs "S12 inactive/terminal read and set" etc.), which is good; what is missing is each ticket stating which decisive assertions it owns and where the remainder lives, so ticket 10's census can mechanically confirm every row. Smallest correction: per split row, one line "owns assertions X, Y; remainder in ticket N."

## Optional suggestions (non-blocking)

- **O1 — Ticket 6's dependency on 4 is defensible but under-justified.** A refresh hint is process-local (`hint` returns void; `TrackerNotification` needs no admission machinery), so 3 would arguably suffice. The stronger reading — which I recommend recording — is that S12's "known termination can be rejected before submission" and truthful unknown outcomes make refresh share ticket 4's admission/normalization boundary. Keep the edge; add the reason.
- **O2 — Ticket 8 mixes an internal evidence rule with client presentation.** Admitting D from a complete intermediate state (Q17) and rejecting missing-page evidence are workflow-internal and need no client; only the `GraphNotEstablished`/stale-display distinction needs ticket 3. Not worth splitting, but the ticket could note the internal half is verifiable at the lower seam first.
- **O3 — Ticket 2's "Blocked by: None" is correct** (the defect and its correction are journal/workflow-internal; the negative reproduction already exists on the research fixture shape), and parallelizing it with ticket 1 is the plan's best scheduling property. Worth saying explicitly in the plan so no one serializes it needlessly.

## Ticket 1 contract sufficiency (explicitly requested)

**Yes, sufficient — with a one-paragraph strengthening.** The genuinely open choices are technical, not product: the operation research enumerates five remaining contract decisions with source-preserving defaults (`invokee-operation-contract-research.md` "Operator choices and implementable defaults"), and the spec has already settled four of them (combined snapshot; `WakeSubmitted`; `RefreshSubmitted`; `RunClosed` retaining terminal position; `RunInactive` for inactive capacity). What remains is exactly what ticket 1 lists: concrete addressing spelling, CLI command and MCP tool/resource naming, request/result encodings, and selecting finite frame/subscription/write limits (the one place where values must be *chosen*, and the spec correctly makes their rejection tests an implementation gate). No accepted interview decision (Q17, Q22–Q27) needs reopening, and the spec's Qualification boundary already frames this as "a named technical contract gap, not a deferred documentation chore." Smallest correction: ticket 1 should cite the operation-research defaults table and the spec's Qualification boundary as its checklist and state explicitly that Q17/Q22–Q27 are settled inputs, so the contract author doesn't treat them as open.

## Requested checklist sweep

- **Finality defect and negative control:** preserved in spec (S10 steps 4–5; "Preserve the causal validator and the rejection test") and plan (ticket 2 keeps the negative reproduction early and unblocked; ticket 10 re-asserts both). Defect: ownership overlap only (B1).
- **Full-command admission vs Exit ownership:** spec's "indivisible with starting its complete operation under the existing application lifecycle cutoff" is carried by ticket 4 (admission mechanism) and ticket 9 (Exit refuses post-cutoff commands, "admission/Exit races"). Consistent; no client-triggered Exit is added (spec exclusion honored).
- **Lost response vs callback failure:** correctly distinguished everywhere — lost response → unknown outcome, no replay (tickets 4/5); callback failure after durable application → distinct partial-completion failure with known accepted position, never `UnpauseApplied` (ticket 4's "failure variant" matches spec's "Extend S4 with this fault").
- **S1–S12 rows:** all owned; census below.
- **MCP/CLI parity:** promised per slice; missing a parity assertion (S2).
- **Upstream retention:** ticket 7's "disconnect releases subscription including upstream retention" matches the spec's unbounded-`SubscriptionRef` warning and the slow-watch record's "one sliding stage does not bound total memory."
- **Host closure vs termination:** four distinct facts (graceful Exit, process death, observation `Closed`, durable termination) kept distinct in spec S8/S9/S12 and tickets 4/7/9; `RunClosed` retains terminal position; no fabricated EOF success.
- **Exclusions:** verified none leak in — no arbitrary selection (ticket 6 "without selecting work"; advisory IDs not fetch scope), no remote Pause (S5's intervening Pause uses the existing boundary), no client-triggered Exit, no auto-start (ticket 3 "separate host startup"; S11), active-only capacity with explicit `RunInactive` (ticket 5), no replay cursors (ticket 7 reconnect-reads-current), no publication barrier (ticket 8 explicitly), no broad refactor (consistent with the research's reuse findings).

## Dependency graph

No corrections required; two annotations recommended:

```
1 (contract) ──► 3 (attach/snapshot) ──► 4 (admission/Unpause) ──► 5 (capacity)
                                      └─► 4 ──► 6 (refresh)   [record rationale, O1]
                 3 ──► 7 (watch/slow-client) ──┐
                 3 ──► 8 (S7 evidence/display) │
                 4 + 7 ──► 9 (host death/Exit) │
2 (S10 correction) — independent, start immediately (O3)
2 + 5 + 6 + 8 + 9 ──► 10 (milestone qualification + census)
```

3→4, 4→5, 3→7, 3→8, {4,7}→9, and 10's five blockers are all genuine content dependencies (command admission before durable commands; watch behavior before Exit's "finish writable observers"; correction before the S6 Completed suffix). 7→10 is transitive through 9; fine.

## Scenario acceptance census

| Scenario | Spec required test | Ticket(s) | Assessment |
| --- | --- | --- | --- |
| S1 | Two clients observe one Run without starting work | 3 + 7 | Covered; split (snapshot / attachment race) — apply S3 bookkeeping |
| S2 | MCP and CLI exit while host completes delivery | 3 + 7 | Covered; split (replacement+completion / watch cancellation, broken stdout) |
| S3 | Raise/lower capacity without replacing attempts | 5 | Covered |
| S4 | Start preserves Pause; disconnected Unpause reaches owner once; callback-failure variant | 4 | Covered except refresh half of no-override — **B2** |
| S5 | Races and lost responses preserve control decisions | 4 + 5 | Covered (pre-admission cancel + lost Unpause / competing writers + lost set response) |
| S6 | Hints/timer discovery; full A/B/E→C `Completed` suffix | 6 + 10 | Covered; late suffix justified — spec: "requires the S10 causal-evidence correction" |
| S7 | Complete intermediate edit admits; incomplete evidence rejects | 8 | Covered; dedicated interleaving is non-optional per spec |
| S8 | Slow watchers coalesce/disconnect; truthful closure | 7 + 9 | Covered (deadlines/limits/reconnect / shutdown ordering, failed final frame) |
| S9 | Host loss reconstructs without retry; Exit races | 9 | Covered |
| S10 neg | Incomparable evidence rejects termination | 2 | Covered early — correctly not deferred |
| S10 corr | Justified causal evidence → actual `Blocked` | 2 (+10 re-assert) | **B1** — double-owned; Quint silence — **B3** |
| S11 | Unavailable host / wrong Run: no workflow effects | 3 | Covered |
| S12 | Inactive capacity explicit; terminal never reopens | 3 + 4 + 5 + 7 | Covered; four-way split — census in 10 must confirm the whole row |

13 test rows (spec splits S10 into two), 13 owned, 0 unowned, 1 unjustified-late (none — the only late acceptance, S6's suffix, is spec-mandated), 2 requiring ownership clarification (S10 corr, S4-refresh).

## Bottom line

Publish after applying B1–B3 (three short ticket-text edits), and preferably S1–S3. The specification stands as-is: its declared-not-passing tests, named contract gap, and preserved negative control are exactly what the operational-scenario gate and handoff rules require, and the plan's structure — contract first, correction parallelized, census last — matches the evidence.
