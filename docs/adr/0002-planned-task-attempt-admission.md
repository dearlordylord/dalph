# Authorize planned task attempts from explicit durable evidence

Status: Proposed

This decision record is prepared as the durable artifact for the upcoming
planned-task-attempt predecessor interview. No interview question has been
asked yet. It will record each resolved design branch as the interview
proceeds. Issue #112 will implement the accepted decision and its
recovery-progress property.

## Concrete behavior being decided

Dalph checks the task tracker, tries to create the exact task claim, checks the
tracker again after the tracker confirms that claim, and then records one
immutable planned task attempt in the Dalph workflow journal. The decision must
identify which durable earlier outcome authorizes that append, where Dalph
proves that the task identity and task revision fingerprint still match, and
which durable outcome may authorize a later attempt.

## Current implementation evidence

The workflow currently gives the planned-task-attempt recording operation one
direct predecessor: the tracker-read operation performed after the exact task
claim was acquired. That tracker-read operation directly follows the claim
operation. The current durable tracker outcome may not contain enough evidence
to prove both the same `TaskId` and the same task revision fingerprint during
recovery.

## Interview decisions

No policy question has been answered yet.

## Questions in dependency order

1. Which exact prior outcome authorizes recording a planned task attempt?
2. Where does durable history prove equality of `TaskId` and task revision
   fingerprint?
3. Is one direct admission predecessor sufficient when the exact acquired claim
   is required transitively?
4. Which prior outcome authorizes recording a new planned task attempt instead
   of continuing or terminating the existing attempt?

## Acceptance consequences

When accepted, this record will contain the causal graph, invariants, rejected
alternatives and reasons, journal/recovery consequences, and the generated
history property required by issue #112. It must not invent an attempt ordinal
unless a separately justified domain decision introduces one.
