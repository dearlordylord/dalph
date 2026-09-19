# Reducer Lab: preserve the selected cassette and playback moment in the URL

This scenario changes only the local Reducer Lab presentation. It does not
change a Dalph command, workflow decision, tracker or Git request, executor
call, durable journal fact, retry, cleanup action, or production-visible
result. The URL stores which maintained cassette the maintainer is inspecting
and which observed playback moment is selected; it never stores or implies
workflow progress.

## A maintainer shares and restores one Lab inspection position

### Starting situation

A maintainer opens the Reducer Lab with its production-owned maintained
cassette catalog. The URL may contain an exact `cassette` catalog key and a
one-based `step` identifying an observed playback moment. Cassette results are
process-local browser state, so a fresh page must deterministically execute the
selected maintained cassette before its graph and timeline can be restored.

### Trigger and ordered behavior

On mount, the Lab reads the current URL. A valid `cassette` selects and
automatically starts that exact maintained cassette through its existing
controlled production runner. A valid positive-integer `step` remains a
pending inspection request while execution publishes observed moments. When
the moment exists, the Lab inspects it instead of following the newest moment.

When the maintainer selects another cassette in the Lab, the Lab replaces the
URL's `cassette`, restores that cassette's retained local step when one exists,
and continues to require an explicit **Run selected cassette** action. When the maintainer chooses an exact historical moment or
moves through playback, the Lab replaces `step` with the visible one-based
moment number. Choosing **Live** removes `step`. These replacements preserve
the pathname, hash, and query keys the Lab does not own.

When browser navigation supplies another valid cassette URL, the Lab applies
the same decode path. It selects the named cassette, reuses an already-running
or settled local result, or automatically starts it when its local state is
`NotRun`, then restores the requested moment.

An absent cassette selects the catalog's ordinary first choice. An unknown or
duplicated cassette, a missing cassette paired with a step, and a non-positive,
fractional, duplicated, or non-numeric step are invalid URL input. The Lab
falls back to the ordinary cassette/live selection and replaces only its owned
keys with the canonical state. A positive step beyond the known settled
timeline similarly falls back to Live; while the cassette is still running,
the Lab waits because that moment may yet arrive.

### Visible and forbidden results

The maintainer can copy the URL, refresh, and recover the selected cassette's
new deterministic execution at the requested observed moment. The URL must not
claim that old process-local evidence survived, start a cassette for a missing
or invalid cassette key, change an outside production system, expose secrets,
discard unrelated URL state, or treat an invalid catalog key or step as trusted
input.

### Crash and retry

Browser-process loss still discards all displayed execution evidence. Reloading
starts one fresh deterministic execution of the valid URL-selected cassette;
it does not manufacture or claim to reuse the lost result. The pending step is
applied to that fresh execution. No external mutation is ambiguous, so there is
no production retry or recovery behavior.

### Acceptance-test mapping

- `decodes and canonicalizes Reducer Lab URL selection without changing unowned URL state`
  covers valid, missing, duplicated, malformed, and out-of-domain query values
  plus pathname/hash/unowned-query preservation.
- `refresh executes the URL-selected cassette and restores its playback step`
  mounts against a controlled URL/history adapter, proves one automatic runner
  call restores the requested moment, and proves playback and Live changes
  replace only the owned URL keys.
- `browser navigation executes a valid cassette that has not run locally`
  injects a navigation event and proves the selected surface, automatic
  execution, and pending step follow the URL exactly once.
