# Restart after Codex accepts Begin without acknowledging it

This test-only composition preserves the accepted current-format restart rule
in issue #491. It changes no production executor or workflow decision: only the
controlled provider fixture can withhold its response.

## Governing behavior

An unsettled command must be reconciled before passive attachment under
[the same-host restart protocol](passive-executor-observation-through-restart.md#scheduling-and-failure-clarifications).
The [executor boundary](planned-attempt-executor-boundary.md) retains exact
responsibility. [Empty pre-turn recovery](pre-turn-begin-recovery.md) and
[absent empty-thread recovery](absent-empty-begin-recovery.md) remain separate:
their conclusive evidence can authorize delivery of the original Begin.
This composition adds no recovery or suspension authorization.

## Chronology and acceptance mapping

The Operator starts the public production CLI with a current-format SQLite
Journal, one eligible controlled GitHub task, real Git repository and worktree,
and the controlled Codex provider. Dalph records its Run, planned attempt at the
exact Base, executor responsibility and Begin intent. The provider saves the
exact thread and active turn, writes into the planned worktree, and withholds
the turn/start acknowledgement. The test kills the coordinator before any
executor report is recorded.

The Operator restarts with the same readable stores. The public host reopens
that Journal, reconciles native launch custody, and reads the privately
associated thread and turn before admitting further work. It accepts one
Executing report for the original Run and Attempt. The test then kills this
coordinator and rereads the Journal. The original planned attempt (including
Base, branch and worktree) and exact command record must be unchanged. No
second Begin, Resume, task plan, or provider turn may exist. The saved active
thread must be byte-for-byte unchanged. This proves coordinator loss with
surviving substrate storage; whole-substrate loss cannot supply this evidence.
Recovery performs no new tracker edit, suspension or terminal transition; the
initial launch acquires the ordinary task claim.
Those outcomes retain their existing protocols.

`current-format SQLite restart reconciles a lost Begin acknowledgement without
another turn` in
[production public recovery](../../packages/dalph/src/application/production-public-recovery.integration.test.ts)
proves this exact cut through the shipped CLI/host composition. Its provider is
controlled; this is not a fresh remote Codex qualification.

## Existing evidence audited

[Executor reconciliation tests](../../packages/dalph/src/application/codex-planned-attempt-executor.test.ts)
cover `reconciles a lost provider response and keeps lost public Begin
reconciliation executing`, `reconciles a lost Begin terminal after restart
before exposing it passively`, absent/foreign/empty pre-turn records,
unavailable provider observations, duplicate tokens and unreadable census.
These retain responsibility rather than treating an inconclusive absence as
suspension, and preserve proven same-Begin pre-turn redelivery.

[Native public process tests](../../packages/dalph/src/application/codex-app-server-public.test.ts)
cover `escalates a real resistant writer and recovers after its leader exits
before close` and `reconciles application lease owner identity before spawning`.
[Process policy tests](../../packages/dalph/src/application/codex-app-server-process-policy.property.test.ts)
cover absent controller, server and escaped token writers, unreadable census,
foreign process identity and exact descendant revalidation.
[Recovery census tests](../../packages/dalph/src/application/codex-recovery-census.test.ts)
retain unreadable custody after bounded reads and never wait away a live writer.
Together these exclude PID or timeout alone as stopped-writer proof; the new
composition does not rebuild those owners or broaden their platform guarantees.

[Filesystem store tests](../../packages/dalph/src/application/codex-attempt-store.test.ts)
prove `admits only one independent filesystem store lease`, exact stale-owner
reclamation, refusal to release a foreign owner, and retention of live,
unreadable or locked-without-readable-owner leases. These use native storage
locks rather than PID or timeout alone.

## Candidate evidence, 2026-10-09

Base: `0459086b385a98544311d7696cadc1625a8cc001`. The corrected public
composition was tested at source candidate
`adbcbbb62e5414df2dd2877f896c04b38437fdb3`; subsequent evidence-document edits
change no runtime, fixture or test bytes.

| Boundary | Command through `mise exec -- pnpm` | Observation |
| --- | --- | --- |
| Exact R1 public cut | `exec vitest run packages/dalph/src/application/production-public-recovery.integration.test.ts --maxWorkers=1 -t 'current-format SQLite restart'` | Passed; one test, 49.83 seconds in the test, 78.26 seconds including imports. |
| Native process and filesystem custody | `exec vitest run packages/dalph/src/application/codex-app-server-public.test.ts packages/dalph/src/application/codex-attempt-store.test.ts` | 61 passed at `adbcbbb62e5414df2dd2877f896c04b38437fdb3`; real resistant-writer recovery and independent filesystem lock exclusion, with exact owner/descendant validation. |
| Generic unresolved observations and original-command delivery | `exec vitest run packages/orchestrator/src/workflow/protocols/planned-attempt-executor-work/protocol.test.ts packages/orchestrator/src/workflow/protocols/planned-attempt-executor-work/protocol-controller.test.ts packages/orchestrator/src/workflow/protocols/planned-attempt-executor-work/command-delivery.test.ts` | 92 passed at `e407992ea5eba8ea61b252804fb934da4e838c28`; these source/test boundaries are unchanged in the corrected candidate. |
| Executor reconciliation, process policy, recovery census and isolated native adapter | `exec vitest run packages/dalph/src/application/codex-planned-attempt-executor.test.ts packages/dalph/src/application/codex-app-server-process-policy.property.test.ts packages/dalph/src/application/codex-recovery-census.test.ts packages/dalph/test-support/isolated-codex-process-native.test.ts` | 322 passed during the initial audit at `da1cb448de890e79aca43a712e846e43b836e7d7`; all four owner boundaries remain unchanged. |

The initial complete public file run at `da1cb448` passed 11 tests and failed
R1 plus the existing eight-second startup fixture limit during attempt
planning. Its failed result remains a failure. The existing startup test
passed on focused replay at `e407992e`. R1's first fixture waited on an
app-server stderr event outside the public observation queue. After switching
to durable provider state, a phase capture reached restart selection and
showed that the test itself retained the SQLite store lease across CLI launch.
Scoping each inspection to close before launch removed that competing storage
owner; the corrected R1 passed. Temporary phase captures were removed.

No full `check:all`, hosted submission, model proof, or fresh remote Codex
qualification was requested or credited. Runtime and formal inputs are
unchanged; focused production composition, native custody and protocol checks
own this test-only gap. The earlier passing unaffected checks are retained,
not represented as a fresh all-green broad run.
