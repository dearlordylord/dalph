# Codex runs an admitted long check in its exact attempt worktree

Issue: [#437](https://github.com/dearlordylord/dalph/issues/437).

The maintainer accepted the existing native route on 2026-10-05, specifically
for the Codex adapter and the pinned Codex 0.160.0. Older Codex versions are not
supported by this qualification. Claude and other execution providers need
their own observed contracts; this decision gives them no allowance.

This work qualifies and documents existing runtime behavior. Only the disposable
qualification host gains a configurable policy; the production executor's
matcher, default limits, durable records, containment and workflow remain
unchanged. No managed runner or JavaScript command parser is introduced.

## N1: The native check completes after the ordinary deadline

Alice admits one Codex attempt with an exact planned worktree and a command
allowance before Begin. Dalph retains that policy before `turn/start`. Codex
starts a native command and reports `commandExecution` with the complete shell
command and exact cwd. The allowance matches that reported command, including
the shell executable and flags, rather than just the model's `cmd` input.

The check remains active beyond the ordinary item limit. Returning a session
handle and polling the same session neither completes it nor renews its
deadline. Codex reports completion for the original item before its admitted
deadline, then returns an accepted result. Dalph records that exact completion
and exposes the ordinary accepted report. Alice sees completed verification,
not an allowance inferred from a handle or text output.

The same chronology applies when the current built-in code-mode `exec` tool
calls `tools.exec_command` and polls `tools.write_stdin`: qualification must
observe the native child item, not assume that every JavaScript wrapper exposes
it. Git/tracker publication is inapplicable here: this fixture qualifies the
executor's item boundary with a disposable Git commit and a local fake model.

Acceptance: `codex-real-host-qualification.test.ts`, `native long check completes
with its exact shell allowance through direct and code-mode tools`; the test
checks retained item start/deadline/completion, accepted evidence and exact
provider absence during cleanup.

## N2: An unmatched or opaque command retains the ordinary limit

Alice's admitted policy is unchanged. Codex instead reports a lookalike command,
the raw input without its observed shell prefix, a different cwd, or an opaque
item with no native command/cwd. Dalph cannot match the exact allowance. It
retains the ordinary deadline and follows the existing stop-intent and exact
containment path if that item expires. It must not parse arbitrary JavaScript,
match a substring, grant a fresh timer on a poll, or stop another attempt.

Acceptance: `codex-tool-effect-policy.test.ts`, `does not give a wrapper,
lookalike, or unknown tool the long allowance`, plus the new exact observed
shell/raw-input negative control; `codex-planned-attempt-executor.test.ts`,
`cuts a self-matching Codex item at its exact default deadline and retains dirty
evidence`. Native sibling and resistant-writer proof remains owned by the
[per-attempt containment scenarios](isolated-codex-containment.md).

## N3: Restart retains the admitted deadline and exact responsibility

Dalph dies after observing the native item start and retaining its deadline.
Alice reopens the same attempt with a different configuration. Dalph reconciles
the original thread, item and containment; it retains the original policy and
deadline. It neither launches the command again nor extends the active item.
An ambiguous spawn or stop remains unresolved until the execution substrate
proves the exact writers stopped. Expiry cannot fabricate successful
verification, safe suspension, claim release or Run completion.

Acceptance: `codex-planned-attempt-executor.test.ts`, `keeps the admitted command
allowance after executor restart with a different configuration`, `reopens a
durable item stop intent and finishes exact containment close without another
Begin`, and `retains responsibility when a tool writer survives containment
close`. The existing [tool-effect scenarios](contain-non-converging-codex-tool-effects.md)
own notification-loss, contradictory-incarnation and Exit recovery. Their
chronologies and blocking edges are preserved, not replaced by the native
route.

## Qualification boundary

Native qualification uses the pinned real Codex executable, an isolated home,
a disposable Git worktree, and a local Responses fixture. It makes no paid
model or tracker request. Controlled clocks cover policy/restart permutations;
the native test supplies only the unique command metadata, item lifetime and
real executor-composition proof. A test command's successful exit does not
waive the target repository's actual checks or gate custody.
