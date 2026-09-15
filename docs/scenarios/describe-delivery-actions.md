# Describe delivery actions without performing them

Issue: [#192](https://github.com/dearlordylord/dalph/issues/192)

These scenarios change only the process-local description passed from delivery
to the existing runtime. They add no GitHub, Git, executor, or journal request.
No person directly starts or observes planning; the running Dalph coordinator
recomputes it when an already-accepted current fact changes.

## One accepted ticket transition remains one inert proposal

### Starting situation

GitHub was already read through the tracker boundary. The journal contains the
accepted graph observation in which open task A is eligible and the accepted
facts needed to select A's next ticket transition. There is no claim, Git
worktree, running executor session, or newly allocated operation identity for
that transition. Git refs do not participate yet because the selected
transition is the earlier ticket step.

### Trigger and ordered behavior

Publication of that accepted journal projection changes the current delivery
signal. Dalph's process-local planner reads the current delivery consequence and
the current ticket-delivery requirement. It emits one proposal naming A, the
exact transition and route, and the fact that an operation identity will be
required only after admission. Reading the proposal again, or subscribing to
the unchanged signal again, returns the same description.

Planning makes no GitHub, Git, executor, journal, identity-allocation, or
admission boundary call. The existing runtime remains the only component that
may later admit and perform the proposal.

### Crash, retry, visible result, and forbidden result

There is no planning-side ambiguity to reconcile: planning made no external
request and recorded no durable occurrence. If Dalph exits before or after the
in-memory publication, restart reconstructs the accepted journal projection and
describes the same proposal again. Existing action protocols still own any
later crash between intent, boundary request, and observation.

A maintainer sees no new external effect merely because planning was observed.
Dalph must not allocate an identity, acquire a task or integration position,
start an executor, append a journal record, or create a second live action
owner while describing the proposal. These prohibitions retain D1 (exact
identity) and D15 (admission is the only entry to work).

### Acceptance-test mapping

- `derives one stable proposal from a persistent delivery consequence without performing it`
- `requires exactly the descriptive proposal inputs and no runtime boundary`
- `appends nothing while every descriptive signal is observed`

## Four owners produce one accepted order or one conflict

### Starting situation

The current in-process publication contains exact proposed-action requirements
from tracker graph observation, ticket delivery, settlement or integration, and
tracker reflection. Their accepted order evidence is already present. In the
non-conflicting case every proposal identity is distinct. In the conflict case,
tracker observation and at least one lower owner claim the same exact proposal
identity. No boundary request for any proposal has begun.

No GitHub task edit, Git result, executor report, or journal append occurs
outside Dalph during this composition; those systems supplied the facts earlier
through their existing protocols.

### Trigger and ordered behavior

Publication of the owner requirements starts planning. Dalph combines the four
named inputs, orders non-tracker proposals by their accepted protocol evidence,
places the applicable tracker read according to the existing graph-read rule,
and carries an isolated malformed transition beside independent valid
proposals. It does not derive priority from owner name or input-array position.

If multiple owners claim one proposal identity, Dalph emits the typed ownership
conflict instead of an actionable frontier. The outer adapter passes that exact
value to the one existing runtime, whose conflict handling calls no action
executor.

### Crash, retry, visible result, and forbidden result

Because combination is process-local and action-free, a crash loses only the
derived value. Restart recomputes it from accepted inputs; it does not replay a
boundary request. A maintainer may later see ordered work begin, or see the
typed conflict reported by the runtime, but cannot see work begin from the
conflicted identity.

Dalph must not silently deduplicate the conflicting identity, drop an
independent valid proposal because another transition is malformed, reorder by
owner, or execute through a shadow runtime. D1 requires the exact proposal
identity and D15 forbids work before the existing runtime admits it.

### Acceptance-test mapping

- `combines every proposal owner in accepted order`
- `fails closed when two owners claim one proposal identity`
- `isolates A's missing route evidence while independent B remains actionable`
- `fails closed when the assembled relation reports conflicting proposal ownership`
- `keeps the production delivery Effect flat and free of runtime-coloured coordination`

## An accepted fact changes the frontier without a command

### Starting situation

The journal-backed current publication has no proposal for task A. GitHub, Git,
and the executor are unchanged during this scenario, and no runtime action is
running. An existing authority-specific protocol then accepts a fact that makes
A's exact next ticket transition describable and publishes the updated current
input signal.

### Trigger and ordered behavior

The accepted input publication is the trigger. Planning samples the current
delivery consequence and all owner requirements from their latest accepted
values, then publishes a frontier containing A's proposal. No caller sends a
refresh or invalidation command to planning. Repeated equivalent notifications
do not create distinct frontier changes.

### Crash, retry, visible result, and forbidden result

If Dalph exits after the authority-specific fact was accepted but before the
new in-memory frontier was observed, restart reconstructs that accepted fact
and publishes the same frontier. If it exits before acceptance, the existing
authority-specific protocol owns reconciliation; planning cannot infer that the
fact was accepted. A person sees no planning-specific progress indicator; only
the existing runtime's later action or typed failure is externally visible.

Dalph must not require a general planning command, persist the derived
frontier, combine cached values from different current revisions, or treat a
lost response from an authority as an accepted fact. No cassette is added for
these three scenarios because planning produces no workflow occurrence or
boundary interaction to record; the existing action-protocol cassettes remain
the crash-prefix evidence for every later effect.

### Acceptance-test mapping

- `changes the proposal frontier when its accepted fact signal changes`
- `never combines runtime facts from one accepted revision with another graph revision`
