# Issue #307: Alice sees truthful live-qualification progress after runner loss

## Status and scope

This is an accepted qualification-only scenario. It adds a redacted progress
diagnostic to the protected live-qualification upload; it does not change
normal Dalph runtime behavior. In particular, it adds no user command,
workflow decision, provider request, workflow-Journal fact, cleanup authority,
retry, or second child. It is evidence about the qualification controller's
boundaries, not evidence that a qualification succeeded.

## Alice watches one protected qualification invocation

### Starting facts and trigger

Alice dispatches the protected GitHub Actions workflow for one exact candidate
SHA and its declared Base SHA. The preflight has accepted the candidate CI and
hosted provenance, and the runner has the built shipped entry, lockfile, and
the existing outside-Q artifact and retained-locator destinations. Git still
owns the candidate/Base and the disposable fixture's initial target head; no
qualification child has changed a ref or promoted a target. GitHub has not
yet supplied the disposable fixture resources. The executor has no shipped
child or app-server process. The fixture SQLite Journal has no selected Run
for this invocation, and no child output has been accepted.

The controller creates the exact disposable GitHub issue and local fixture.
The existing retained-locator report records those exact cleanup locators.
That fixture-creation result starts the progress chronology. The controller,
the built shipped child, its stdout and stderr readers, GitHub, Git, SQLite,
and the outer Actions runner are the relevant systems; Alice only observes the
uploaded result.

### Ordered boundaries and visible result

1. The build-measurement boundary reads the candidate, Base, built entry,
   lockfile, and fixture configuration. When measurement completes, the
   controller records `BuildMeasured`.
2. The controller asks the child-process boundary to start the one shipped
   child. On success it records `ChildSpawned` with only the validated positive
   process identity. It does not publish the executable, command line,
   environment, Codex home, private executor state, or another path.
3. The stdout reader accepts the first complete, canonical public record only
   after its UTF-8, framing, decoding, and canonical validation succeed. It
   records `FirstCanonicalRecord`; the diagnostic contains the marker, not the
   record bytes or stdout text.
4. When the canonical output first contains a `RunSelected`, the controller
   records that first safe Run identity as `RunSelected`. This prefix
   observation does not prove uniqueness; final transcript validation still
   rejects zero or multiple selections. No child existence, arbitrary output
   bytes, or first-record marker can stand in for this observation.
5. Three observations run concurrently. The process boundary records
   `ProcessCompleted` with its bounded exit result, or `ProcessFailed`, when
   the child exit is observed. The stdout reader independently records
   `StdoutCompleted` or `StdoutFailed` at its own EOF or failure. The stderr
   reader independently records `StderrCompleted` or `StderrFailed` at its own
   EOF or failure. A process exit can therefore appear while either output
   stream remains open; the diagnostic shows that exact partial progress.

After fixture creation, every completed observation replaces the previous
checkpoint with a complete redacted snapshot. The writer creates and syncs a
same-directory replacement and then atomically renames it over the prior
checkpoint. The snapshot retains the existing exact GitHub/local cleanup
locators and the ordered safe progress markers. Alice can therefore tell
whether build measurement completed, the one child spawned, the first
canonical record arrived, the first `RunSelected` occurrence arrived, and
each of process, stdout, and stderr completed. An unobserved boundary remains
unobserved; it is never silently presented as success.

### Runner loss, crash, and retry

The controller or hosted runner can be lost after any fixture or progress
checkpoint, including after `ProcessCompleted` while stdout or stderr is still
open, or while a replacement file is being written. If loss happens before
the rename, the prior complete checkpoint remains. The runner's always-upload
step publishes the latest complete checkpoint together with the existing
retained-locator report, so Alice sees the last proven boundary and the
remaining boundaries as absent or pending. A partial JSON file, a half-written
progress list, or a newly invented cleanup locator is never uploaded.

The diagnostic is passive and crosses no ambiguous external mutation boundary,
so no retry applies. The controller does not restart the child, repeat build
measurement, re-read output as a new child, or launch a second child after
loss. A human-requested workflow rerun is a new invocation with a new fixture
and child, not an automatic continuation; cleanup still follows the existing
exact retained locators and ownership rules.

## Visible and forbidden results

Alice sees a redacted artifact whose progress is sufficient to distinguish
completed, failed, and not-yet-observed boundaries, plus only the cleanup
locators already authorized by the existing retention report. A zero child
exit is only a process observation, not proof of a successful Run or a
successful qualification.

The artifact must not contain raw stdout or stderr, prompts, provider
responses, credentials, secrets, private executor/Codex state, executable or
command-line details, or any new private path beyond those existing cleanup
locators. Dalph must not infer a first canonical record, one Run, stream EOF,
qualification success, cleanup completion, or safe process ownership from a
different boundary. It must not overwrite a valid checkpoint with an
incomplete one, retry automatically, mutate GitHub/Git/SQLite to manufacture
progress, or create a second child.

## Scenario-to-test mapping

| Scenario outcome | Acceptance test |
| --- | --- |
| Alice sees child spawn and first canonical-output progress before either output stream reaches EOF; process exit remains independently observable while output is open, and the process identity is the only child identity published. | `records child and canonical-output progress before EOF and exit independently while output remains open` |
| Every replacement is a complete redacted checkpoint, an interrupted replacement retains the prior complete progress, and existing cleanup locators remain available without private payloads or a second child. | `atomically retains safe progress with cleanup locators for an unfinished recoverable Run` |
