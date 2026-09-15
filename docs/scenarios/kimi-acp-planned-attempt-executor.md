# Select Kimi ACP for one planned attempt

Status: implemented bounded slice for issue [#379](https://github.com/dearlordylord/dalph/issues/379). The profile registry and controlled Kimi adapter cover the deterministic selection and lifecycle seam; production default/preflight, durable recovery, and live-wire qualification remain follow-up acceptance work.

## Alice selects a Kimi profile before work begins

### Actor, systems, and starting facts

Alice starts a Dalph production Run. The task tracker owns the task identity,
task lifecycle, and claim. Git owns the exact planned Base SHA, branch, and
worktree. The execution substrate will own the Kimi child process and ACP
session. The Dalph Journal has no Kimi credential or raw ACP message. A
controlled decoded profile set may contain a Codex default and the explicit
`kimi/for-coding` profile, whose non-secret provider reference is
`kimi-for-coding`; the credential itself remains in the host environment.

### Trigger and boundary calls

In the controlled registry, Alice selects `kimi/for-coding`, or leaves
selection empty and relies on the configured host default. The registry
resolves explicit selection before the selection's host default, then the
configured host default, and maps the profile to the stable executor locator
`executor:kimi/for-coding`. Production currently accepts that exact Kimi
locator before the host's GitHub boundary; wiring arbitrary decoded profile
sets and a default into production remains open.

If no profile is selected, the registry returns `MissingSelection`. If the
selected id is absent, it returns `UnknownProfile`; duplicate ids return
`DuplicateProfile`. Kimi profiles without a provider configuration reference
are rejected while decoding. No child process, tracker claim, Git mutation,
or executor session is started for any of these failures.

### Visible and forbidden result

Alice sees one selected executor profile or one redacted typed configuration
failure. She must not see a provider credential, and Dalph must not silently
fall back to Codex, reinterpret a Kimi locator as a different profile, or
claim a task before selection validation.

## Dalph starts one Kimi ACP session for the exact attempt

### Actor, systems, and starting facts

No person triggers this automatic step. Dalph has one planned attempt with an
immutable `(RunId, AttemptId)`, authored task-work specification fingerprint,
and exact worktree. The selected executor locator is
`executor:kimi/for-coding`; no Kimi session exists for this correlation.

### Trigger and boundary calls

The generic executor receives `Begin` with that attempt and specification.
Before sending the task prompt, the adapter calls `initialize` in the exact
worktree, starts the selected executable as exactly `kimi acp`, and performs
ACP JSON-RPC `initialize`. It requires advertised load, resume, and close
session capabilities. It then calls `session/new` with the same worktree,
provider-scoped model metadata, and no credential values, followed by
`session/prompt` containing the authored specification body. ACP progress is
read from stdout as JSON-RPC only; stderr is drained into bounded private
diagnostics and never parsed as protocol.

The adapter records its private session state before the prompt boundary and
returns only `ExecutorWorkExecuting` with the generic correlation. A malformed
response, unsupported capability, authentication failure, or provider error
becomes a typed command failure. Executable/credential preflight before claim
is not yet wired in the production host. An unattended
permission request selects the first ACP option; deny and interactive
policies cancel the request and mark permission denied. No credential or raw
ACP envelope enters the Journal.

### Crash, retry, and suspension

If process startup or initialization fails before `session/new`, no task
prompt is sent and the same Begin can be retried after reconciliation. A
requested suspension sends `session/cancel`, observes the session, and only
returns `ExecutorWorkSafelySuspended` after an idle observation; resume uses
the same in-process ACP session id, then sends the same authored specification
body. Durable restart reconciliation and lost `session/new` acknowledgement
handling remain open.

### Visible and forbidden result

The maintainer sees generic executing, safely suspended, terminal, or typed
unavailable/unreadable projections. The Kimi session id, process id,
provider configuration, credentials, raw stdout, and stderr remain private.
Dalph must not start `kimi` without the `acp` subcommand, mix stderr into
stdout protocol, use a global model name without its provider, retry an
ambiguous prompt as a new session, or report success from an idle session
without accepted evidence.

## Scenario-to-test mapping

| Chronological scenario | Acceptance test or fixture |
| --- | --- |
| Alice explicitly selects Kimi over a Codex host default and receives a stable locator. | `executor-profile.test.ts`: `resolves an explicit Kimi profile before a host Codex default` |
| Missing, unknown, and duplicate profile selection fails before any external boundary. | `executor-profile.test.ts`: `returns typed failures for missing and unknown profile selections`; `fails closed when profile identifiers collide` |
| One exact attempt initializes, creates one ACP session, and sends its authored body through the generic contract. | `kimi-planned-attempt-executor.test.ts`: `initializes in the exact worktree, creates one session, and sends the authored body`; the shared `plannedAttemptExecutorContract` registered as `Kimi ACP controlled` |
| A suspension cancels and a resume reuses the same ACP session and body. | `kimi-planned-attempt-executor.test.ts`: `cancels and resumes the same ACP session through the generic command boundary` |
| ACP wire ordering, stderr isolation, permission policy, and malformed/provider failures are exercised without a live Kimi account. | The controlled service seam exists in `controlledKimiAcpClientLayer`; a recorded stdio/child-process fixture is still required before this row can be accepted. |

The controlled tests are the maintained catalog entry for this boundary; they
do not claim that a live Kimi account or model is available in CI.
