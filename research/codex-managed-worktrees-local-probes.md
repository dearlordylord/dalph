# Codex 0.154.0 managed worktrees: local observations

Date: 2026-09-13. Documentation-only research; no Dalph executable source,
configuration, accepted scenario, or model changed. Tests below are isolated
feature probes, not Dalph implementation acceptance or provider qualification.

## What happened

The user asked whether Codex's new worktree feature could support the proposed
agent-operated Dalph design, and whether enabling it in the current Codex session
was necessary. A separate CLI process exercised the feature in a temporary Git
repository using an isolated Codex configuration. The model provider URL pointed
to the closed loopback endpoint `http://127.0.0.1:1/v1`. No real model response,
coding-agent output, or successful delivery was involved.

The fixture contained two commits on master, an uncommitted edit to a tracked
file, and one untracked file. There were initially no linked worktrees or saved
Codex sessions in the fixture. These tests did not touch the Dalph repository's
Git refs, worktrees, or user Codex settings.

## Observations

| Probe | Observed result | What it establishes |
| --- | --- | --- |
| `codex --version` | `codex-cli 0.154.0` | Installed CLI version |
| `codex features list` | `worktrees experimental false` | Feature is present and disabled for ordinary CLI invocation |
| CLI, exec, and fork help | All expose boolean `--worktree` | Public CLI creation entry points; help exposes no worktree path/branch/Base arguments |
| `app-server generate-json-schema --experimental` | No occurrence of `worktree` in any generated JSON | Installed published schema has no worktree-specific fields or methods |
| Same generation with `--enable worktrees` | Still no worktree field/method | Feature enabling does not add an exported worktree API in this binary's schema |
| Explicitly disabled `exec --worktree` | Exit 1: feature must be enabled; no extra Git worktree | Negative control proves the flag gates creation |
| Enabled `exec --worktree`, isolated configuration | Created `home-enabled/worktrees/c1ae/repo`, detached at current source HEAD | Real local worktree creation, generated path, detached checkout, source-HEAD starting point |
| Inspect new worktree contents | Tracked file contains committed `head`, not uncommitted `dirty`; untracked file absent; Git status clean | This CLI invocation did not copy source edits or untracked files |
| Inspect source checkout afterward | Original tracked edit and untracked file remain | Source changes preserved in this fixture |
| First offline run, stopped after 20 seconds of connection failures | Worktree and session history remain; no matching surviving process found by exact isolated `CODEX_HOME` scan | Resources survive this CLI termination; not proof of live worker survival or every crash prefix |
| Repeat fresh invocation with same repository/home and unbounded reconnect disabled | New thread and second detached worktree `worktrees/22a6/repo`; exit 1 from offline connection failure; both worktrees remain | Fresh creation is not a recover/reuse operation; ordinary turn failure does not immediately delete these worktrees |
| New app-server process, `thread/read` original ID | Same thread ID and original managed cwd; status `notLoaded` | Saved identity and cwd readable across process replacement |
| Same new server, `thread/resume` with original ID only | Same thread ID and cwd; status `idle` | Exact stored session can reload against the same existing managed worktree without starting a model turn |

The initial app-server schema includes `cwd` in `ThreadStartParams`,
`ThreadForkParams`, and `ThreadResumeParams`. Their existence is distinct from a
worktree creation API. Absence from the generated schema does not prove that no
private/internal implementation exists.

## Reproduction outline

Use an isolated temporary repository and an isolated Codex home. Never point this
probe at a delivery worktree or an existing conversation. Place this configuration
in that isolated home's `config.toml`:

```toml
model = "offline-probe"
model_provider = "offline_probe"

[model_providers.offline_probe]
name = "Offline research probe"
base_url = "http://127.0.0.1:1/v1"
wire_api = "responses"
requires_openai_auth = false
request_max_retries = 0
stream_max_retries = 0

[analytics]
enabled = false
```

Pass the isolated home through the child process environment's `CODEX_HOME`; do
not alter the user's persistent config. Run the disabled negative control first,
then the enabled case:

```text
codex --disable worktrees exec --worktree -C <fixture-repo> --json <probe-prompt>
codex --enable worktrees --disable unbounded_connection_retries exec --worktree -C <fixture-repo> --json <probe-prompt>
git -C <fixture-repo> worktree list --porcelain
```

The first enabled probe did not disable unbounded connection retry, so its parent
Python process killed that CLI after 20 seconds. The repeated enabled probe
disabled it and failed promptly as intended. Both are observations, not successful
agent runs. The temporary-home warning about PATH helper aliases did not prevent
worktree creation or subsequent session reload.

For the saved-session probe, start `codex app-server --stdio` with the same
isolated home. Initialize the client with experimental API capability, send the
initialized notification, and issue:

```json
{"id":2,"method":"thread/read","params":{"threadId":"<recorded-id>","includeTurns":false}}
{"id":3,"method":"thread/resume","params":{"threadId":"<recorded-id>"}}
```

Read each response before the next request. Do not send `turn/start`. Close stdin
and wait for that app-server process to exit. Inspect Git and the returned cwd
independently of the saved transcript.

## Evidence retained in this workspace session

Temporary fixture root:
`/tmp/dalph-codex-worktree-research-ik2j940i`.

- `schema/` and `schema-enabled/`: generated installed-binary schemas.
- `probe-results.json`: first disabled/enabled invocation results and Git observations.
- `repeat-results.json`: repeated fresh invocation and both retained worktrees.
- `app-server-results.json`: initialization, exact thread read, and resume responses.
- `home-enabled/sessions/`: offline probe histories with recorded cwd.

Temporary artifacts are not committed repository evidence and may disappear when
the environment is recycled. This note records the observed outcomes and the
reproduction boundary; it does not depend on these paths remaining available.

## Scope of the conclusion

No user enablement was needed for the probes. A per-invocation flag exercised the
feature in another process. That does not retrofit a `worktree` option into the
current conversation's supplied `spawn_agent` tool, whose schema has no such
parameter.

Not tested: the interactive `/worktree` browser, interactive fork, provider/model
execution, active child survival across daemon failure, missing-worktree restore,
retention or garbage collection, deletion while processes write, ambiguous
creation before the thread is recorded, or task integration and issue completion.
Desktop documentation about cleanup or snapshots cannot establish these CLI
behaviors.

The combined interpretation against Dalph is in
[the Astra assessment](codex-managed-worktrees-assessment.md). This evidence
supports persisted session/worktree association; it does not establish that
Codex-managed worktree creation satisfies Dalph's exact preplanned Git resource
and reconcile-before-retry contracts.
