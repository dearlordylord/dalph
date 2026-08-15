# Codex app-server integration lifecycle

## Conclusion

Codex app-server exposes enough facts to implement a conservative lifecycle,
but it does not supply an idempotent lifecycle command API. In particular, a
local isolated probe against Codex CLI `0.147.0` observed that
`turn/interrupt` against an idle thread returns JSON-RPC error `-32600`, with
the message `no active turn to interrupt`. A caller therefore cannot treat a
second interrupt as a harmless successful repeat after losing the first
response.

For Dalph, the defensible protocol is: read the exact thread and owned turn,
send an ambiguity-crossing command at most once, then read again to decide what
happened. Whether that protocol is represented by an explicit persisted state
machine or by smaller persisted facts interpreted through read/act/reread is
**undecided**. Neither representation is a design target established by this
research.

## Evidence and its limits

| Classification | Finding |
| --- | --- |
| **Observed Codex fact** | App-server is a JSON-RPC/JSONL integration surface with separate `thread/start`, `turn/start`, `thread/read`, `thread/resume`, and `turn/interrupt` operations. The official guide demonstrates initialization followed by separate thread and turn requests ([OpenAI app-server guide](https://developers.openai.com/codex/app-server)). |
| **Observed structured-result fact** | `turn/start` accepts an `outputSchema` that applies to that turn, completed agent messages are available as `agentMessage` items, and `turn/completed` supplies the terminal turn status ([OpenAI app-server guide](https://developers.openai.com/codex/app-server)). A Codex integration adapter can therefore require a structured candidate-prepared result and validate it without treating free-form prose as authority. |
| **Observed alternative reporting fact** | App-server also supports client-executed dynamic tool calls, but `dynamicTools` is explicitly experimental. A dynamic candidate-submission tool is therefore possible, but it is not required when the stable per-turn `outputSchema` is sufficient ([OpenAI app-server guide](https://developers.openai.com/codex/app-server)). |
| **Observed schema fact** | The protocol schema generated from the installed `codex` CLI `0.147.0` requires the exact thread and turn identifiers for `turn/interrupt`; a successful response has no lifecycle payload. The schema is reproducible from that installed CLI's app-server schema-generation command, but it is version evidence, not a compatibility promise for later Codex releases. |
| **Observed runtime fact** | In the isolated local `0.147.0` probe, calling `turn/interrupt` when the thread had no active turn produced JSON-RPC `-32600`, `no active turn to interrupt`. This is one-build empirical evidence. It proves that “already idle” is not normalized to success by this version. |
| **Observed Codex retry fact** | Codex `0.147.0` defaults to four failed-request retries and five dropped-stream reconnection attempts. Its request client retries transport and 5xx failures with exponential delay and jitter, while the active-turn loop retries errors classified as retryable before it returns a terminal turn failure ([provider defaults](https://github.com/openai/codex/blob/3ed6f04f6bf8b7c46299d1cb1ff99c74ce21a51d/codex-rs/model-provider-info/src/lib.rs#L25-L32), [request retry](https://github.com/openai/codex/blob/3ed6f04f6bf8b7c46299d1cb1ff99c74ce21a51d/codex-rs/codex-client/src/retry.rs), [active-turn stream retry](https://github.com/openai/codex/blob/3ed6f04f6bf8b7c46299d1cb1ff99c74ce21a51d/codex-rs/core/src/responses_retry.rs)). These are versioned implementation facts, not a permanent app-server guarantee. |
| **Observed first-party integration fact** | OpenAI Symphony starts app-server, initializes it, starts a thread, sends turns, consumes terminal notifications, and closes the port when stopping a session ([app_server.ex](https://github.com/openai/symphony/blob/8001b52e3062495a16e520e4ceaf8f9de868c4d0/elixir/lib/symphony_elixir/codex/app_server.ex), [agent_runner.ex](https://github.com/openai/symphony/blob/8001b52e3062495a16e520e4ceaf8f9de868c4d0/elixir/lib/symphony_elixir/codex/agent_runner.ex)). This establishes viability, not Dalph retry or cleanup policy. |
| **Dalph inference** | A missing response from `turn/start` or `turn/interrupt` is ambiguous. Dalph must inspect the retained thread/turn before deciding whether work is running, terminal, interrupted, or unreadable. Reissuing the mutation first can duplicate work or turn an already-achieved interrupt into an error. |
| **Open design choice** | Dalph may prohibit all automatic mutation retries, or distinguish mutation retransmission from bounded retries of read-only observation and app-server reconnection. The evidence supports prohibiting blind mutation retransmission; it does not decide the broader retry policy. |

## What the current Dalph executor does

The current implementation already follows a concrete read/act/reread
chronology in
[`codex-planned-attempt-executor.ts`](../packages/dalph/src/application/codex-planned-attempt-executor.ts):

1. Before `turn/start`, it persists a `TurnIntentRecorded` record containing a
   fresh Dalph-owned turn token.
2. It sends `turn/start` once. If that call fails after possibly crossing the
   boundary, it resumes and reads the known thread, matches the owned token,
   and does not send a second task turn.
3. Before suspension it resumes and reads the thread. If the owned turn is
   running, it sends exactly one `turn/interrupt`.
4. It reads again after the interrupt. An interrupt error is accepted only
   when that reread independently shows an idle or terminal outcome; otherwise
   suspension remains failed or unresolved.
5. It reports safe suspension only after the thread is idle and the separate
   owned-activity census is absent. Codex's interrupt response alone is not
   sufficient.

The focused tests in
[`codex-planned-attempt-executor.test.ts`](../packages/dalph/src/application/codex-planned-attempt-executor.test.ts)
cover the important ambiguity cuts: a lost turn response is reconciled without
a second turn; a lost continuation response does not duplicate the
continuation; an interrupt that settles before returning an error is
reconciled without a duplicate interrupt; a terminal turn observed after an
interrupt failure wins; and unresolved or contradictory observations fail
closed.

There is one materially different pre-turn case. The implementation can
replace an empty thread when it is conclusively absent, and a failed write of
the thread association can lead to another `thread/start`. No task
`turn/start` has crossed at that point. Calling this a “retry” obscures the
important boundary: it is replacement of an empty allocation, not replay of a
task mutation. Whether Dalph should retain even this behavior is also a policy
choice, especially because ambient session-start hooks or MCP initialization
may have side effects.

## Structured integration result

The selected Codex implementation does not need to infer a prepared candidate
from worktree `HEAD`, scrape an arbitrary prose answer, or introduce an
"integration branch." It can start the exact integration turn with an
`outputSchema` requiring a result such as `candidate_prepared` plus one full
Git commit SHA. The authoritative completed `agentMessage` supplies that
structured value; the adapter binds it to the already-known Dalph integration
session instead of trusting the model to repeat session identities. Dalph must
still ask Git whether the named object is a commit with the exact ordered
parents required by the session.

The current planned-attempt Codex executor already asks for a JSON final
message and validates its commit against Git, but its app-server port does not
yet pass `outputSchema`. That implementation is evidence that the overall
shape is viable, not a reason to preserve prompt-only JSON parsing in the new
integration adapter.

## Decision still required

“No retries from Dalph” needs an exact scope. The smallest safe rule supported
by the evidence is:

- never automatically retransmit `turn/start` or `turn/interrupt` after an
  ambiguous outcome;
- rely on the selected Codex implementation's bounded in-turn request and
  stream retries rather than starting a replacement turn for those failures;
- retain the exact thread id, owned-turn token, and any observed turn id;
- reread or resume to classify the outcome, failing closed when the facts are
  unavailable or contradictory; and
- decide separately whether read-only observations, app-server process
  reconnection, and conclusively pre-turn empty-thread replacement may be
  attempted again.

That rule can be implemented with the existing explicit record variants, or
with a leaner read/act/reread protocol over the minimum durable crossing facts.
This report does not select between them and does not assert that a state
machine is a product or architecture target.

## Scenario and test impact

This is a research-only document and changes no Dalph runtime behavior. The
existing focused tests named above are evidence about the current chronology,
not acceptance of a new retry policy. Any implementation ticket that chooses
the policy must add chronological scenarios for lost `turn/start` responses,
lost `turn/interrupt` responses, idle interruption, app-server loss during
reread, and empty pre-turn replacement, then map each scenario to a focused
test before code changes begin.
