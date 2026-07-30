# Issue 54: resize task admission without stopping current work

## The Operator lowers capacity while two task attempts are running

The Operator is watching one Dalph Run over three independent open tracker
tasks A, B, and C. The Run began with task-execution capacity two at policy
revision one. Dalph recorded that initial policy with the Run beginning before
it read the tracker. A and B each have one exact claim, planned attempt,
worktree, unfinished executor-work responsibility, and process-local task-work
position. C has none of those facts. Git has the planned A and B worktrees; no
Git ref or worktree changes as part of the capacity request.

The controlled fake executor reports A and B Running. The Operator then asks
Dalph's local control boundary to change task-execution capacity from two to
one, naming Run revision one as the policy being replaced. Dalph decodes the
positive capacity, checks the latest journaled policy revision, and appends the
past-tense Operator-initiated policy change at revision two. Only after that
append may a later scheduling cycle use capacity one. Receiving or decoding the
request alone changes nothing.

Dalph does not ask either executor attempt to stop. When A reports Terminal,
its task-work position becomes available, but B still occupies one position.
Because usage equals the new limit, Dalph does not claim or plan C. Only after B
reports Terminal and usage falls below one may Dalph admit C through its
ordinary claim, focused task specification, attempt plan, worktree, and
executor boundaries.

The Operator sees A and B continue, then C wait and later start. Dalph must not
cancel or suspend A or B, delete either position during contraction, persist a
position or queue, let C start while one position remains occupied, or let an
executor-internal identity add or release a position.

Acceptance tests:

- `lowers capacity while A holds a position and admits B only after A releases
  it` runs the authored production-shaped chronology through the live policy
  boundary.
- `records an Operator capacity change through the production composition
  before scheduling continues` proves the real SQLite/startup composition
  appends revision two before the blocked tracker read returns.
- `lowers capacity without preempting two holders and admits C only after both
  positions are released` proves the two-holder contraction at the public
  admission-controller seam.
- `generated capacity changes retain every held task position and admit no new
  task at or above the ceiling` checks arbitrary capacities and occupied
  task-keyed positions at the admission-controller seam.

## A capacity increase affects the next scheduling decision

The Operator is watching a Run whose recorded task-execution capacity is one.
Task A occupies the only task-work position and task B is otherwise eligible.
The Operator applies capacity two through the same local control boundary.
There is no tracker, Git, or executor request in the policy-change boundary
itself.

After Dalph records revision two, the next scheduling cycle keeps A's exact
position and may admit B into the newly available second position. No crash or
retry occurs in this scenario. The Operator sees B start without A restarting
or changing identity. Dalph must not replace the task-keyed position map,
create an outer executor invocation identity, or persist the derived admission
frontier.

Acceptance test:

- `increasing capacity keeps the holder and admits another task on the next
  decision` proves the controller change and activation signal at the public
  admission seams.

## A crash reconstructs the applied capacity and occupied attempts

The same Run began at capacity two. A and B reached unfinished
planned-attempt executor-work responsibilities, and the Operator's decrease to
capacity one was appended at revision two. Dalph and the milestone fake
executor then crash together before the next scheduling cycle. The
process-local position map, activation ownership, queue, and wakeups disappear.
The journal keeps the Run beginning, the applied capacity change, and the two
unfinished planned-attempt responsibilities.

On restart, the Operator does not supply another initial capacity. Dalph reads
the exact Run history, reconstructs revision two with capacity one, and derives
two occupied task positions from A's and B's unfinished responsibilities. It
does not ask the stopped fake for surviving-session reports. A and B retain
priority over fresh C. As recovered executor work becomes Terminal or
SafelySuspended, Dalph releases its exact task positions; C remains withheld
until usage is below one.

If Dalph crashes before the applied-change append, restart reconstructs
capacity two. If it crashes after the append, restart reconstructs capacity
one even when no in-memory controller observed it. Repeating restart rereads
the same journal facts and creates no extra policy event or persisted
position.

The Operator sees the recovered Run honor capacity one. Dalph must not
substitute the process default, require an initial-policy argument during
recovery, discard A or B because the new ceiling is smaller, or treat a
coordinator process identity as an attempt identity.

Acceptance tests:

- `restart reconstructs the latest applied capacity and both unfinished task
  positions` exercises journal reduction and recovered controller creation.
- `restarts after a live capacity decrease and admits B only after recovered A
  releases its position` drives an authored process death through fresh and
  recovered coordinator activations, verifies A against current tracker and
  Git facts, makes B independently eligible before A finishes, and proves B
  waits for A's reconstructed position.
- `gives a resumed responsibility the next released position before fresh
  work` proves the ordinary frontier/admission seam retains recovered
  responsibility priority when occupied usage reaches the ceiling.

## A lost response cannot apply a stale policy change twice

The Run's latest policy is revision one at capacity two. The Operator asks for
capacity one while naming revision one. If Dalph crashes or storage fails
before the applied event commits, the journal still reports revision one and
the Operator may retry the same request. If the event commits but the caller
loses the response, the journal reports revision two at capacity one.

On a retry that still names revision one, Dalph checks the journal before
appending and returns a typed stale-policy-revision result containing the
current revision and capacity. It does not append a second applied action.
The caller may reread that result and decide whether to submit a new change
against revision two. Tracker, Git, and executor boundaries do not apply
because this request changes only Dalph's durable Run policy.

The Operator sees either one applied change or a precise stale-revision result.
Dalph must not infer that a lost client response means the append failed,
silently overwrite a later Operator change, or record command receipt as an
applied policy change.

Acceptance test:

- `rejects a stale capacity revision without appending another applied change`
  proves append-before-use, lost-response retry, and one durable revision.
