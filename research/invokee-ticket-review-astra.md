> Archived review record from 2026-09-13. Publication and current next steps are recorded in [the handoff](FRESH-SESSION-HANDOFF.md). Statements about unpublished tickets describe review time.

# Astra review of issue #365 and proposed tickets

Verdict: revise before publishing implementation-ready tickets. The accepted product scope and most behavioral distinctions are sound. One public-result contract is missing, and two lifecycle requirements are assigned too late for the earlier tickets to be independently qualified. None requires reopening Q17 or Q22–Q27.

This was a read-only repository/source review. I read the live issue body and comments (no comments), the local specification, handoff and principal research records, accepted interview answers, operational/review guidance, and relevant production host, runtime signal, control and termination source. I did not run probes or implementation gates and claim no new passing runtime evidence. Repository edits were preserved.

## Blocking findings

### P1 — Alice cannot obtain the accepted Run disposition through the listed public operations

**Evidence:** `docs/scenarios/invoker-invokee-first-milestone.md:194` requires a later client to see actual `Completed`; S10 requires actual `Blocked`. The operation table at line 409 exposes only `RunPaused | RunUnpaused | RunTerminated`. The observation contract at lines 463–464 correctly keeps separately read termination evidence outside the atomic runtime snapshot, but never specifies how a public caller reads it. `packages/orchestrator/src/coordination/run/run.ts:79` confirms Run control is just those three strings. The actual independent source is `JournaledRunTerminationSource.poll/await`, with `disposition` and `terminatedAt`, in `journaled-run-bootstrap.ts:147–158`; the production host already exposes it at `production-host.ts:73`.

**Consequence:** both adapters can truthfully return `RunTerminated` or `Closed` while neither proves which accepted disposition occurred. Ticket 10 can inspect SQLite privately and pass without satisfying the later client's visible outcome. This is a missing supported result, not simply JSON spelling. S10's typed activation failure also needs an explicit route to the client if that public visibility remains required; current host failure races its callback and can otherwise just remove the transport (`production-host.ts:593`).

**Smallest correction:** ticket 1 must define the passive public projection of existing termination evidence, either as separately labeled evidence in an existing read result or a narrowly named read operation. Specify pending versus accepted disposition and exact journal position; never derive it from Closed or delivery classifications. Assign its implementation and both-client tests to ticket 3, with actual Completed/Blocked consumption reasserted in ticket 10. Name the public failure path for the S10 negative case. Amend the operation whitelist consistently. No new journal event, durable receipt or completion protocol is needed.

### P1 — Ticket 4 adds accepted commands before their Exit cutoff/drain behavior is qualified

**Evidence:** ticket 4 establishes the shared command-admission mechanism, while admission/Exit races are assigned to ticket 9, which also waits for ticket 7. The specification's “Command admission and interruption” at lines 429–444 requires the complete operation to enter host ownership indivisibly with the existing lifecycle cutoff. S9 requires rejection after that cutoff. `docs/ARCHITECTURE.md:237–274` requires the existing five-second drain and distinguishes its result from later scope finalization. The recovery probe explicitly owns its command in an external test scope and does not qualify this host lifecycle integration.

**Consequence:** ticket 4 can be called complete after demonstrating client-loss survival while its newly accepted command can still straddle Exit admission or outlive the allowed drain. Tickets 5 and 6 then rely on an unqualified lifecycle boundary. This is required safety evidence for the first command, not merely final milestone integration.

**Smallest correction:** move the S9 command-admission/Exit cutoff and admitted-command success/failure/timeout tests into ticket 4. Ticket 4 must identify how accepted command ownership joins the existing lifecycle protocol and prove callback-bearing Unpause is covered. Each later mutation slice inherits that boundary and tests its own error mapping. Leave ticket 9 responsible for actual host death and independently started reconstruction; it can then depend only on ticket 4. Do not introduce a second drain budget or remote Exit operation.

### P2 — Ticket 7 promises truthful watch closure while its production shutdown ordering is deferred to ticket 9

**Evidence:** ticket 7 delivers Closed before normal EOF and claims S8 qualification, but ticket 9 owns “S8 shutdown ordering and failed final-frame delivery.” Specification lines 479–483 require observation delivery to remain alive through Closed within the existing lifecycle budget. The graph-stream research explicitly kept its disposable server outside the host callback so it could observe scope-finalization Closed; it warns that this does not establish host-owned transport flushing. Actual source closes the Run/foundation after the host callback returns (`production-host.ts:584–595`).

**Consequence:** a supported watch can pass controlled CurrentSignal tests yet lose its real final frame when the host closes its transport. Ticket 7's public closure claim cannot be independently accepted on the proposed mapping.

**Smallest correction:** ticket 7 owns actual production graceful-shutdown ordering, writable observer completion, blocked final-frame failure, and the same original drain deadline. Depend on ticket 4's qualified lifecycle seam if the implementation shares it. Remove these claims from ticket 9. If the combined ticket is too large, split ordinary public watches from resource/shutdown qualification with the first explicitly unable to claim full S8; the second remains a blocking dependency of milestone qualification.

## Acceptance ownership revisions required in the ticket text

These are specification/handoff completeness issues, not additional product decisions.

1. **S4 invokes refresh before ticket 6 exists.** Ticket 4 currently maps all S4 even though its supported operation set excludes refresh. Declare its wake/Unpause subset explicitly, and assign the public paused-refresh assertion to ticket 6. Do not add a backwards dependency from 4 to 6 or count a private owner hint as public refresh qualification.
2. **S11 must follow every new request decoder.** Ticket 3 can prove handshake, address, version, identity and snapshot failures. Ticket 5 owns invalid capacity/revision input; ticket 6 owns invalid hint shape/task IDs; ticket 7 owns watch limit/subscription failures. In each case assert rejection before workflow effects through both adapters. A blanket S11 check at ticket 3 cannot cover operations added later.
3. **Negative finality test seam needs one explicit sentence.** Preserve the recorded failing g10/g11 provenance as a controlled invalid-history/validator test while the corrected production chronology proves Blocked. Do not require the corrected production path to continue emitting the old predecessor-less g11. S10 is substantively correct, but “negative reproduction AND corrected production chronology” is easy to implement as contradictory end-to-end expectations. Retain the validator unchanged and assert actual zero/one terminal records respectively.
4. **Record the cassette owner.** `docs/OPERATIONAL-SCENARIOS.md`, “Three registers of the same behavior,” requires recorded chronology and traceability of forbidden outcomes to D invariants. The parent supplies invariant links, but the plan only names generic acceptance tests. Each implementation ticket should state the maintained cassette or existing cassette it extends for its workflow chronology; transport/process assertions can remain dedicated tests around that chronology. Ticket 10 audits those artifacts rather than creating all chronology evidence at the end.

## Is ticket 1 executable without another product interview?

Yes, after explicitly adding the termination/failure result gap above. Its handoff should be a concrete contract matrix, not another summary of desired semantics: host-start and client commands; address/version/selected-Run handshake; exact CLI/MCP request and result projections; per-operation invalid/inactive/terminal/closing outcomes; the observable admission cancellation boundary; watch current/latest/Closed/error framing; finite frame/subscription/write limits, measurement units and limit rejection behavior; and named test owner for each case. Fix whether shutdown admission rejects new reads/watch attachments as well as mutations, so “new attached commands” is not interpreted differently by adapters.

The accepted decisions already constrain these choices. Do not add automatic startup, authenticated identities, a process manager, idempotency receipts, synchronous refresh, an editing barrier, task selection, external-worker adoption, or recursive yielding. The contract ticket changes no runtime and can remain independent of the finality correction.

## Corrected dependency graph

Keep the proposed numbering, with the ownership changes above:

- 1: no prerequisites; concrete contracts, including accepted termination visibility.
- 2: no prerequisites; controlled negative history and corrected production Blocked chronology.
- 3: blocked by 1; separate startup, descriptor, snapshots, passive termination result, both-client replacement and one-task completion.
- 4: blocked by 3; wake, durable Run control, Unpause, cancellation/lost response/callback failure, and command admission/Exit qualification.
- 5: blocked by 4; capacity CAS and actual admission/non-preemption.
- 6: blocked by 4; refresh semantics and public paused-refresh assertion.
- 7: blocked by 3 and 4 when consuming the common lifecycle seam; watches, limits/upstream release and real graceful closure qualification.
- 8: blocked by 3; complete authored interleaving versus incomplete evidence and current/stale presentation. Timer-driven tests do not need the refresh command, so no artificial dependency on 6 is needed.
- 9: blocked by 4; actual host process death and separate reconstruction. No intrinsic watch dependency remains after moving graceful observer qualification to 7.
- 10: blocked by 2, 5, 6, 7, 8, 9; full successful story and acceptance census.

Ticket 2 is properly independent of the public attachments. Keeping the S6 delivery suffix in ticket 10 is an explicit and reasonable composition deferral because ticket 6 only claims discovery, provided its own hints and state-dependent behavior are already fully tested.

## Context-window sizing

There is no evidence-based token estimate that proves one ticket cannot fit a fresh context; avoid false precision. The highest-risk tickets are 3 (host/startup/transport/two adapters/projection), 4 (durable command ownership and lifecycle), 7 (two watch transports plus buffer and shutdown ownership), and 9 (actual killed process and persisted executor/Git reconstruction). The proposed summaries alone are not sufficient fresh-session handoffs: each needs a short authoritative reading list, exact source seams, owned tests, inherited fixture entry point and explicitly deferred assertions.

The strongest bounded improvement is moving graceful command/observer qualification to their owning slices and leaving ticket 9 solely about actual restart. Build the maintained production-host fixture incrementally in ticket 3, then extend it in each slice; do not make ticket 10 discover how to launch both public clients or reconstruct the fixture for the first time. Split ticket 7 into ordinary watch and resource/shutdown sub-slices only if contract design exposes separate substantial implementations; no broad architecture refactor or foundation-only ticket is justified by the inspected source.

## Acceptance census after revisions

| Parent row | Owning ticket and decisive evidence |
| --- | --- |
| S1 | 3: passive coherent snapshot/descriptor and no second owner; 7: current-first attachment race and watch projection. |
| S2 | 3: real MCP replacement and public CLI exit with one-task completion; 7: watch cancellation/broken stdout and exact subscription release. |
| S3 | 5: actual B Begin, exact plans/worktrees retained after contraction, C remains blocked. |
| S4 | 4: wake preserves Pause, SQLite cuts, one ordinal/actual callback, timer restart and partial callback failure; 6: public refresh preserves Pause. |
| S5 | 4: Unpause uncertainty/no blind replay, pre-admission cancellation, full-command lifetime; 5: capacity competing writers and all lost-response cuts. |
| S6 | 6: hints, complete reads, startup/timer and state matrix; 10: actual A/B/E-to-C Completed suffix seen through both public clients. |
| S7 | 8: actual D admission before later blocker, separate missing/contradictory read failure, unavailable/stale display. |
| S8 | 7: exact initial/latest/Closed, same-position updates, limit/deadline failures, upstream release, reconnect and actual host shutdown ordering. |
| S9 | 4: admission/Exit races and bounded admitted-command drain; 9: killed host, independently started same Run, no duplicate direction/attempt, exact responsibility reconstruction. |
| S10 negative | 2: recorded incomparable history rejected with typed error and zero terminal records; public failure projection owned by 1/3 and reasserted in 10 if required. |
| S10 correction | 2: corrected production evidence accepted through unchanged validator and actual Blocked record; 10: both-client visibility. |
| S11 | 3: connection/version/Run identity failures; 4–7: operation-specific malformed request/rejection before effects as those surfaces appear. |
| S12 | 3: actual snapshot lifecycle and separately labeled termination; 4: terminal Unpause rejection; 5: inactive/terminal capacity; 6: terminal refresh; 7: source closure distinct from termination. |

Upstream SubscriptionRef retention is already honestly scoped: one sliding stage is not a global memory bound. Keep ticket 7's exact release proof and finite limits; do not add an unsolicited global-memory redesign. Host closure, accepted termination, client death, host death, durable application, callback completion and lost response are otherwise well distinguished in the specification.

## Additional blocking operational-scenario gate for ticket 2

S10 steps 1–4 give a concrete failing chronology, but step 5 says only that later facts have “justified causal replacement evidence.” That specifies the desired property, not which production decision reads which prior evidence before constructing the later tracker-read intent. The source currently constructs predecessor-less `WorkflowEstablishment` in `delivery-action-adapter-common.ts:46–57`. Ticket 2 therefore has enough information to reproduce the defect, but not an accepted chronological explanation of its corrected behavior before implementation.

**Minimal revision:** give ticket 2 a mandatory documentation-first checkpoint: select and record the concrete production chronology that establishes the causal dependency before its graph-read intent, identify which earlier observations it can legitimately supersede and why, and name the corrected-production and incomparable-history tests before changing runtime code. A changed or merely later journal position is not the justification. This can remain inside ticket 2 and need not depend on the transport-contract ticket or reopen product choices. The operational-scenario gate remains active until that chronology exists.

For the public termination gap, the smallest default is to enrich the separately read Run-control terminal variant with accepted `disposition` and exact `terminatedAt` from the existing termination source, while preserving the independently read nature of that result. Ticket 1 fixes its result encoding and pending/race semantics; ticket 3 qualifies it on a real one-task Completed Run through both adapters; tickets 2/10 qualify the changing-graph Blocked result. This avoids adding a new operation and avoids splicing separate reads into the coherent runtime snapshot.
