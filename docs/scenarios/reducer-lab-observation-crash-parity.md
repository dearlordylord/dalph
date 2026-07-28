# Reducer Lab: observation hierarchy and coordinator-crash parity

These scenarios change only the throwaway Reducer Lab. They do not change
Dalph's production journal, task-tracker boundaries, or recovery rules.

## The developer inspects tracker graphs during an ordinary run

### Starting situation

A developer opens the Reducer Lab in one browser tab. The Lab's fake Primary
task tracker contains tasks A–D. Dalph may or may not already have completed a
successful read of that target. The Lab has not simulated a coordinator crash.

No GitHub, Git, executor, or real journal boundary applies. The browser uses
the controlled task-tracker and journal adapters already provided by the Lab.

### Trigger and ordered behavior

The developer opens the graph workbench or asks Dalph to observe the selected
fake tracker target.

The Lab presents the latest successful normalized observation and current fake
tracker authority as the two primary graph projections. It presents durable
journal-reconstructed membership only as a compact, collapsed recovery
diagnostic. The collapsed summary states the number of retained target-closure
entries. Expanding it reveals the durable membership rows that the Lab already
presented before this hierarchy change.

### Visible and forbidden results

The two topology-bearing graph projections remain visually primary. The
developer does not see a large “Journal-reconstructed observation coverage”
heading or a standalone “Retained membership” metric.

The compact diagnostic must not imply that durable membership is current
tracker authority, a complete task graph, or sufficient to resume work.

Crash and retry do not otherwise apply to this layout scenario. Expanding or
collapsing the native disclosure control changes no Lab input, journal fact, or
reconstructed state.

### Acceptance-test mapping

- `The graph workbench must keep both topology-bearing projections primary`,
  `Recovery membership must render as a collapsed compact disclosure`, and
  `The graph workbench must not spotlight durable membership as a graph truth`
  in `prototypes/reducer-lab/src/lab-engine.smoke.ts` check the rendered
  hierarchy.

## The coordinator crashes after a successful tracker observation

### Starting situation

A developer has asked Dalph to observe the fake Primary tracker target. The
controlled read succeeded with tasks A–D. The Lab's managed journal contains
the observation intent and successful outcome, and the running coordinator
still holds the full normalized task graph in volatile process memory.

There is no Git, executor, task-work session, or outside retry in this scenario.
The fake task tracker remains available and unchanged.

### Trigger and ordered behavior

The developer selects **Crash Lab coordinator process**.

The immutable Lab replay applies that crash at its exact history position. It
keeps the durable observation intent and outcome in the managed journal, so
production reconstruction still retains the target-closure membership A–D. It
discards every target's volatile latest normalized observation and projection,
clears pre-claim fresh-read readiness, and records a visible Lab status saying
that a coordinator crash discarded volatile observations.

The developer selects **Restart Lab coordinator process**. Restart reconstructs
durable membership from the journal but does not recreate task content,
lifecycle, dependency, or grouping topology from fake tracker authority or
from the old boundary result. The latest-observation graph remains empty until
the developer explicitly asks Dalph to observe the selected fake tracker again.

After that fresh read succeeds, the latest-observation graph again contains
A–D. Exactly one new observation intent and outcome pair is appended.

### Visible and forbidden results

Immediately after crash and after restart, the developer sees current fake
tracker authority as before, an unavailable latest-observation graph, and
compact recovery diagnostics retaining A–D membership. The status tells the
developer to observe again.

The Lab must not reconstruct volatile topology from the prior journal outcome,
copy current fake authority into the latest observation, or silently perform a
new tracker read during restart. Undoing the crash reconstructs the earlier
history prefix and therefore restores the earlier volatile observation without
mutating that prefix.

Browser-tab loss is outside this scenario: the throwaway Lab has no persistent
storage, so closing the tab still loses the entire exploration.

### Acceptance-test mapping

- `Coordinator crash must discard the volatile latest normalized observation`,
  `Coordinator crash must retain journal-reconstructed target-closure
  membership`, `Restart must not reconstruct volatile topology from durable
  membership or fake authority`, and `An explicit post-restart read must
  restore topology with one new intent/outcome pair` check observation, crash,
  restart, and explicit reread in chronological order.
- `A coordinator crash must not claim that a never-observed target lost an
  observation` and `Coordinator crash must discard volatile observations for
  every controlled target` distinguish never-observed targets from discarded
  process-local observations.
- `Restart must require a new observation and preclaim reread before committing
  the claim` proves that crash also clears pre-claim fresh-read readiness.
- `Immutable replay must restore topology only for the history prefix before
  the crash` checks that the earlier prefix restores its prior topology while
  the post-crash prefix remains topology-free.
