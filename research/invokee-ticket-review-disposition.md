> Archived review record from 2026-09-13. Publication and current next steps are recorded in [the handoff](FRESH-SESSION-HANDOFF.md). Statements about unpublished tickets describe review time.

# Review disposition for the proposed #365 ticket breakdown

Status: both independent reviews complete; no tracker mutations or repository implementation. Original draft: research/invokee-ticket-breakdown-draft.md. Independent reports: research/invokee-ticket-review-astra.md and research/invokee-ticket-review-kimi.md. Kimi ran successfully through the CLI with model kimi-code/k3-256k. Astra confirmed this disposition resolves its blockers.

## Corrections accepted from Astra

- Ticket 1 must define how both clients read accepted Run disposition and exact journal position, separately from the coherent runtime publication. Prefer enriching the terminal alternative of the separately read Run-control result. Define pending/racing termination facts and the public path for S10's typed activation failure; neither Closed nor connection loss proves a disposition. Ticket 3 implements and qualifies these projections; ticket 10 consumes actual Completed and Blocked results through public clients.
- Ticket 2 begins with a documentation checkpoint before runtime edits: record the exact corrected chronology, which prior observations the next read legitimately supersedes, how the causal relationship is established before the read intent, and the decisive tests. Preserve the unchanged validator. The controlled incomparable-history test retains the recorded g10/g11 evidence and zero termination records; the corrected production case records actual Blocked. Public-client composition is reasserted by ticket 10, not a prerequisite for the core fix.
- Ticket 4 owns admission versus Exit races and admitted-command success/failure/timeout inside the existing lifecycle budget as soon as public commands exist. Client-loss protection must cover the actual callback, and cannot promise completion beyond host shutdown.
- Ticket 7 owns actual production shutdown ordering, Closed before normal EOF for writable observers, transport failure for an unsent final frame, and exact upstream subscription release. Controlled signal tests supplement this real host test. It consumes ticket 4's qualified lifecycle seam.
- Ticket 9 is narrowed to actual host death and independent reconstruction. It no longer waits for watches.
- Ticket 4 owns S4 wake/Unpause assertions; ticket 6 owns the paused public refresh assertion. Every new operation owns its S11 decoding/Run mismatch/rejection tests through both adapters. Each workflow slice names the maintained cassette it adds or extends, with separate process/transport tests where appropriate. Ticket 10 audits existing evidence and adds the composed suffix rather than retroactively qualifying earlier surfaces.

## Revised blocking edges

| Ticket | Blocked by |
| --- | --- |
| 1 — Concrete contracts | None |
| 2 — Changing-graph finality correction | None; concrete corrected scenario required before runtime edits |
| 3 — Host attachment and passive reads | 1 |
| 4 — Wake/Unpause and complete command lifetime | 3 |
| 5 — Revisioned capacity | 4 |
| 6 — Advisory refresh | 4 |
| 7 — Watches, resources, and graceful closure | 4 |
| 8 — Intermediate edits versus incomplete evidence | 3 |
| 9 — Actual host death and reconstruction | 4 |
| 10 — Complete public-client qualification | 2, 5, 6, 7, 8, 9 |

Ticket 7 inherits ticket 3 transitively through 4. Ticket 8 uses timer discovery and needs no artificial dependency on 6. Ticket 2 remains independent of adapter contracts.

## Scope and verification

Keep the accepted root scope, separate startup, no automatic Unpause replay, active-runtime capacity limitation, managed executors, advisory hints and latest-state watches. No external-worker, recursive-yield, publication-barrier, new authentication or remote Exit scope. Retain all S1–S12 outcomes and the original forbidden results. Model-governed changes require the applicable guide, model adequacy/negative-control evidence and user-required repository checks; runtime tests have not been run for this review-only task.

## Kimi findings and resolution

- Accept B1: ticket 2 owns maintained core finality tests on the production host with real Git/SQLite and controlled provider edges, using the research fixture shape rather than renaming a disposable probe. Ticket 10 owns public-client composition of those outcomes. The corrected graph does not need ticket 2 to wait for public attachment.
- Accept B2: explicitly split S4 wake/Unpause qualification in ticket 4 from public paused-refresh qualification in ticket 6. Any earlier owner-hint test is lower-seam evidence only.
- Accept B3: ticket 2 must declare whether the selected correction changes the Quint model or only concrete causal-evidence construction, with a reason grounded in the model's stated abstraction limits. Follow the Quint guide and preserve negative/reachability controls where applicable. Model success alone does not prove the concrete fix.
- Accept S2/S3: each operation slice names an MCP/CLI parity assertion over equivalent controlled starting states and inputs, requiring identical normalized outcomes/failures. Do not compare two sequential mutations as though they shared a starting revision. Name the exact partial assertions and remaining owner for every split scenario; ticket 10 audits the complete census.
- Treat S1 as a sizing risk, not proof that ticket 3 cannot fit. Both reviewers identify it as a large slice; neither supplies an implementation estimate establishing failure. Keep ten tickets provisionally. Ticket 1's concrete design must bound ticket 3 around one reusable production fixture and shared operation projection. If that design exposes two substantial implementations, return a concrete 3a/3b split before implementation instead of silently expanding ticket 3. A second-adapter split must still preserve the first adapter's own lifecycle and failure acceptance.
- Accept O1's dependency explanation: ticket 6 uses the same host command-admission, cutoff, identity, and truthful-outcome boundary supplied by ticket 4. The edge does not claim that the existing owner hint itself requires new durable machinery.
- Do not split ticket 8 merely because admission can be tested internally; its complete behavior includes the client seeing unavailable/stale facts. Timer discovery makes it independently testable after ticket 3.

## Reviewer disagreement

Kimi concludes that the specification needs no changes and that its S10 corrected result satisfies the scenario gate. Astra identifies the missing public accepted-disposition result, missing typed finality-failure delivery path, and abstract corrected-causality chronology. Retain Astra's concrete findings: source readRunReactivationControl returns only RunTerminated, the distinct termination source carries disposition/position, and current fresh graph-read construction has no predecessors. Kimi's blanket approval does not resolve those specific gaps. The corrections above refine the specification in subsequent ticket-owned documents without modifying parent issue #365.

## Outcome

The ten-ticket structure remains viable with corrected ownership and edges. Accepted product decisions need no new interview. Publication has not occurred; these are reviewable draft corrections, not shipped behavior or passing acceptance evidence.
