# Kimi executor/provider integration research

Date: 2026-09-14

This is a design/research note, not an implementation handoff. The immediate
question is how Dalph could make Kimi available beside Codex and how an operator
would choose it without changing the provider-independent workflow protocol.

## Findings from primary sources

### Kimi has two relevant execution surfaces

Kimi Code CLI documents `kimi --prompt <prompt>` as a one-shot, non-interactive
mode and `kimi acp` as a JSON-RPC server over stdin/stdout. The ACP server emits
no banner, writes logs to stderr, and waits for `initialize`.

- [Kimi command reference](https://www.kimi.com/code/docs/en/kimi-code-cli/reference/kimi-command)
- [`kimi acp` reference](https://www.kimi.com/code/docs/en/kimi-code-cli/reference/kimi-acp)

The ACP surface has the lifecycle Dalph needs: `session/new`, `session/load`,
`session/resume`, `session/prompt`, `session/update` notifications, and
`session/cancel`. It also exposes model selection and permission requests.

- [`kimi acp` capability/method matrix](https://www.kimi.com/code/docs/en/kimi-code-cli/reference/kimi-acp)

The official ACP protocol is JSON-RPC over stdio for local agents, and the
official TypeScript SDK provides a typed client and stream helpers.

- [ACP introduction](https://agentclientprotocol.com/get-started/introduction)
- [ACP protocol overview](https://github.com/agentclientprotocol/agent-client-protocol/blob/main/docs/protocol/v1/overview.mdx)
- [Official ACP TypeScript SDK](https://www.npmjs.com/package/@agentclientprotocol/sdk)

**Inference:** Kimi should be integrated through ACP, not by scraping the
interactive terminal UI or by treating `--prompt` as a durable session. ACP is
the only documented Kimi surface that naturally supports a long-lived,
resumable session and structured progress.

### `-y` is not the same as fully unattended execution

Kimi's current command reference describes `--yolo`/`-y` as “Ask When Needed”:
routine edits and commands are automatic, but risky actions, questions, and
plans may still ask. The same reference documents `--auto` as “Never Ask”. The
older Kimi CLI source also documents `--afk` for away-from-keyboard execution.

- [Current permission-mode reference](https://www.kimi.com/code/docs/en/kimi-code-cli/reference/kimi-command)
- [Kimi CLI source options](https://github.com/MoonshotAI/kimi-cli/blob/main/src/kimi_cli/cli/__init__.py)
- [Kimi CLI changelog explaining yolo vs afk](https://github.com/MoonshotAI/kimi-cli/blob/main/CHANGELOG.md)

The ACP reference says that permissions are exchanged through
`session/request_permission`. A client driving Kimi therefore has to provide a
deliberate permission policy; merely adding `-y` to `kimi acp` is not enough to
prove that a headless Dalph run cannot wait for a person.

**Recommendation:** for a production executor, use an explicit unattended
permission policy at the ACP client boundary. If a Kimi release supports an
`auto`/`afk` config or launch mode, use it as defense in depth, but still handle
permission requests in Dalph and fail with a typed, visible result if the
policy cannot answer one.

### Kimi model selection is provider-scoped

Kimi configuration defines named providers and named models. A model refers to
one provider; the CLI accepts a model alias with `--model`. The provider types
include Kimi, OpenAI-compatible chat completions, OpenAI Responses, Anthropic,
Gemini, and Vertex AI. Credentials and base URLs are provider configuration,
and environment overrides include `KIMI_MODEL_NAME`, `KIMI_API_KEY`, and
`KIMI_BASE_URL`.

- [Kimi providers and models](https://github.com/MoonshotAI/kimi-cli/blob/main/docs/en/configuration/providers.md)
- [Kimi configuration files](https://www.kimi.com/code/docs/en/kimi-code-cli/configuration/config-files)
- [Kimi configuration overrides](https://www.kimi.com/code/docs/en/kimi-code-cli/configuration/overrides)

**Inference:** Dalph must not interpret a bare string such as `gpt-reserve` as a
globally valid model. Selection must resolve a named executor profile to a
provider plus model, validate that profile before task claim/Begin, and retain
the resolved executor identity for resume.

## Proposed Dalph shape

### Preserve the existing workflow boundary

The generic `PlannedAttemptExecutor` contract already exposes only `observe`,
`begin`, `resume`, and `requestSuspension`, with normalized executing,
safely-suspended, and terminal reports. It intentionally does not expose
provider sessions, processes, or model APIs.

- [`PlannedAttemptExecutor` contract](../../packages/contracts/src/executor.ts)
- [planned-attempt executor boundary](../scenarios/planned-attempt-executor-boundary.md)
- [`PlannedTaskAttempt.executor`](../../packages/contracts/src/planned-attempt.ts)

Kimi should implement that same contract. Its ACP session IDs, process IDs,
JSON-RPC requests, and provider errors remain inside the application adapter.
They must not become journal facts or new workflow states.

### Add an application-level executor registry

Introduce a small application boundary, conceptually:

```text
ExecutorProfileId -> ExecutorProfile -> PlannedAttemptExecutor implementation
                         |                    |
                         |                    +-- Codex app-server adapter
                         +----------------------- Kimi ACP adapter
```

The registry is selected at the composition root. The orchestrator still
receives exactly one `PlannedAttemptExecutor` service for a run, so existing
workflow code and formal models remain provider-neutral.

The existing `TaskExecutorLocator` is the durable per-attempt locator. The
selected profile must produce a stable locator such as
`executor:codex-app-server` or `executor:kimi-acp`; restart and resume must
resolve the same locator to the same adapter. Never silently switch a started
attempt from Codex to Kimi because a provider became unavailable.

### Select explicitly, with no implicit fallback

Use this order at the production host boundary:

1. an explicit run/profile selection;
2. a configured host default;
3. a typed startup failure if neither exists.

The first version should select one executor profile for the run. It should not
add “try Codex, then Kimi” fallback after a Begin or an ambiguous command: that
would violate the exact-attempt and reconcile-before-retry invariants. A future
fallback policy could be considered only before any attempt is claimed or begun,
and would need its own accepted scenarios.

An executor profile should contain at least:

```text
profile id          (stable, e.g. codex/default or kimi/default)
adapter             (codex-app-server | kimi-acp)
executable          (codex | kimi)
model alias         (provider-scoped, optional for Codex)
permission policy   (interactive | unattended)
provider config ref (name/base URL; never the secret itself)
```

Secrets stay in the host environment/configuration layer. They are not put in
the workflow journal, task issue, executor locator, or evidence manifest.

## Implementation sequence

1. **Accept scenarios and profile schema.** Document startup selection,
   preflight failure, first Begin, passive observation, suspension, resume after
   restart, and provider error behavior. Add a scenario-to-test table before
   runtime edits.
2. **Extract only provider-neutral process/stream seams.** Reuse the existing
   Codex lifecycle invariants, but do not rename the current Codex journal
   records into a prematurely generic protocol. Add a narrow ACP transport and
   session store seam first.
3. **Implement Kimi ACP adapter.** Spawn `kimi acp`; keep stdout exclusively
   JSON-RPC, route stderr to diagnostics, perform initialize/auth/session/new,
   prompt, update collection, cancellation, and session resume. Map all
   provider failures to typed executor command/projection outcomes.
4. **Implement deterministic permission handling.** Auto-answer only the
   explicitly configured safe/unattended policy. An unsupported or unanswered
   permission request must become visible failure, never a hanging turn.
5. **Add registry/composition selection.** Resolve profile before claim and
   construct the matching layer. Record the stable `TaskExecutorLocator` in the
   planned attempt; keep the provider-specific model out of the journal.
6. **Conformance and focused qualification.** Run the existing generic
   executor conformance suite against the Kimi adapter, then a recorded ACP
   wire fixture. Only after that run one bounded manual Kimi qualification with
   real credentials. Do not make a live Kimi call part of ordinary unit or
   aggregate gates.

## Scenario-to-test mapping

| Real event | Acceptance test |
| --- | --- |
| Operator selects `kimi/default` before a run starts | profile decoding/registry test; no tracker claim on invalid profile |
| Dalph launches Kimi in an isolated worktree | ACP launch fixture asserts executable, cwd, environment isolation, and clean stdout |
| Kimi accepts `initialize`, `session/new`, and `session/prompt` | recorded ACP protocol test |
| Kimi sends progress and tool-permission requests | ACP notification/permission policy test; no unbounded wait |
| Kimi returns a completed turn with a commit | generic `PlannedAttemptExecutor` conformance test and accepted-result evidence test |
| Dalph restarts while the turn is executing | passive observation/reconnect test proves no second Begin |
| A safely suspended Kimi session resumes | session/load or session/resume fixture proves same `(RunId, AttemptId)` |
| Kimi is unavailable, unauthenticated, or reports a provider error | typed visible terminal/projection failure; no silent retry loop |
| Operator changes the configured default after Begin | restart test proves the started attempt still resolves its recorded executor locator |

## Open questions before implementation

- Which installed Kimi Code CLI version is the deployment contract? The
  permission flag semantics have changed over time (`-y` versus `--afk`/`--auto`).
- Does the target Kimi release expose a persistent non-interactive permission
  mode for `kimi acp`, or must Dalph answer every ACP permission request?
- Should Kimi's persisted session directory be isolated per Dalph attempt, or
  should Dalph rely only on the live ACP process and its own attempt store?
- Does the current ACP SDK version fit the repository's Effect/Node stream
  boundaries, or should Dalph implement a small JSON-RPC transport around the
  SDK to preserve cancellation and process ownership semantics?

## Decision summary

Use **Kimi ACP as a new executor adapter**, selected by an explicit,
provider-scoped executor profile at the application composition boundary. Keep
`PlannedAttemptExecutor` and the journal provider-neutral, retain the selected
executor locator across restart, and reject unavailable profiles before claim.
Treat `-y` as a Kimi permission-mode detail, not as Dalph's definition of
unattended execution.
