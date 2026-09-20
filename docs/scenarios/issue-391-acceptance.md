# Production admission, app-server routing, and retained-wait acceptance

Issue: [Fix production admission, app-server routing, unchanged-wait reactivation](https://github.com/dearlordylord/dalph/issues/391)

Status: accepted issue scenarios mapped to executable acceptance evidence.

This handoff adds no scenario beyond the four chronological scenarios accepted
in issue #391. The issue remains the scenario authority; this file names the
tests that prevent each repaired boundary from regressing.

## Scenario-to-test mapping

| Accepted scenario | Executable acceptance evidence |
| --- | --- |
| The production operator supplies an invalid GitHub claim owner; configuration admission rejects it before constructing a Run or calling a mutation boundary. | `production-configuration.test.ts`: `rejects claimOwner with %s during configuration admission`; `claim-representation.test.ts`: `rejects the same owner representations the GitHub adapter must reject`. The configuration decoder is the production host's pre-construction boundary. |
| The production host starts a Codex task; it proves the all-yes unattended policy before allocating work, applies it to every thread and turn, and treats any approval request as a typed sticky protocol failure. | `codex-app-server-protocol.test.ts`: `pins and proves all-yes unattended policy for every task thread and turn`, `fails policy admission before creating a task thread when effective policy is unsupported`, and `turns an unexpected approval request into a sticky provider-protocol failure`; `production-host.test.ts`: `Codex policy admission follows safe history discovery and fails before Run allocation or provider work`; the opt-in real app-server qualification asserts `{ approvalPolicy: "never", sandbox: { type: "dangerFullAccess" } }` on the real created thread. |
| Codex sends an ID-bearing server request whose ID collides with an outbound Dalph request; routing keeps the outbound request pending, while malformed envelopes fail through the typed protocol boundary. Existing ID-less completion notifications remain wake hints. | `codex-app-server-protocol.test.ts`: `does not let an ID-bearing server request settle a colliding outbound request`, `fails malformed JSON-RPC envelopes through the typed protocol boundary`, and `keeps existing ID-less completion notifications as wake hints only`. |
| A retained wait republishes unchanged accepted facts; the owner retracts only the publication-owned trailing activation and does not reactivate itself. A later provider, tracker, operator, or timer wake starts at most one bounded activation. | `run-reactivation-owner.test.ts`: `an unchanged retained wait retracts only its publication-owned trailing activation` and the four-case `$0 starts at most one bounded activation after a retained wait`; `production-reactivation.test.ts`: `a reopened SQLite Run keeps positions 232 and 233 stable until an outside wake` and `a rejected fresh foreign claim remains visible without re-reading the graph`. |

## Crash, retry, and forbidden results

The four accepted scenarios do not authorize a new retry, journal event, or
cleanup action. Configuration and policy failures stop before Run allocation;
protocol failures stay typed and sticky; malformed or colliding messages cannot
complete an unrelated request; and an unchanged retained wait cannot create a
self-sustaining activation loop. Existing process-loss recovery, mutation
reconciliation, rate-limit handling, and cleanup scenarios remain unchanged.
