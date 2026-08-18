import "./prototype.css"

// THROWAWAY PROTOTYPE
// Question: Which visual relationship between live rectangles and production
// source makes synchronized state easiest to read?

type TaskKey = "A" | "B" | "C" | "D" | "E" | "F" | "G" | "H" | "I" | "X"
type StageKey = "read" | "graph" | "frontier" | "tickets" | "responsibilities" | "settlements" | "reflection"
type TaskState = "blocked" | "waiting" | "desired" | "running" | "integrating" | "settled"
type AppState = "up" | "down" | "restarting"
type FrameKind = "publication" | "runtime" | "crash" | "external" | "recovery" | "control"
type Tone = TaskState | "fresh" | "stale" | "fact" | "rule" | "output"
type SelectionMode = "none" | "stage" | "task"

interface Cell { readonly title: string; readonly value: string; readonly task?: TaskKey; readonly tone?: Tone }
interface Stage { readonly key: StageKey; readonly code: string }
interface GraphState {
  readonly kind: "Complete"
  readonly revision: string
  readonly observedAt: string
  readonly age: string
  readonly taskCount: 9 | 10
}
interface UserControlState {
  readonly run: "active" | "paused"
  readonly tasks: ReadonlyArray<TaskKey>
  readonly resumePending: ReadonlyArray<TaskKey>
}
interface Frame {
  readonly time: string
  readonly event: string
  readonly boundary: string
  readonly kind: FrameKind
  readonly app: AppState
  readonly control: UserControlState
  readonly graph: GraphState
  readonly tasks: Record<TaskKey, TaskState>
  readonly frontier: ReadonlyArray<TaskKey>
  readonly bounded: ReadonlyArray<TaskKey>
  readonly held: ReadonlyArray<TaskKey>
  readonly integrations: ReadonlyArray<TaskKey>
  readonly settled: ReadonlyArray<TaskKey>
  readonly changed: ReadonlyArray<StageKey>
  readonly durable: string
  readonly expected: string
  readonly forbidden: string
}
interface Scenario {
  readonly name: string
  readonly question: string
  readonly placement: string
  readonly value: string
  readonly frames: ReadonlyArray<Frame>
}

const allTasks: ReadonlyArray<TaskKey> = ["A", "B", "C", "D", "E", "F", "H", "I", "X", "G"]
const originalTasks = allTasks.filter((task) => task !== "X")
const capacity = 2
const taskLabel: Record<TaskState, string> = {
  blocked: "prerequisites incomplete",
  waiting: "frontier · waiting capacity",
  desired: "desired · not held",
  running: "task-work position held",
  integrating: "integration live",
  settled: "settled"
}

const stages: ReadonlyArray<Stage> = [
  { key: "read", code: "const trackerGraph = yield* TrackerGraphRelation" },
  { key: "graph", code: "const graph = trackerGraph.signal" },
  { key: "frontier", code: "const frontier = mapCurrentSignal(graph, frontierOf)" },
  { key: "tickets", code: "const tickets = yield* boundedParallelTickets(frontier)" },
  { key: "responsibilities", code: "const responsibilities = yield* executorResponsibilities(tickets)" },
  { key: "settlements", code: "const settlements = yield* deliverySettlements(responsibilities)" },
  { key: "reflection", code: "return yield* reflectDeliverySettlements(settlements)" }
]

const taskStates = (overrides: Partial<Record<TaskKey, TaskState>>): Record<TaskKey, TaskState> => ({
  A: "blocked", B: "blocked", C: "blocked", D: "blocked", E: "blocked",
  F: "blocked", G: "blocked", H: "blocked", I: "blocked", X: "blocked",
  ...overrides
})

const frame = (input: Omit<Frame, "app" | "control"> & { readonly app?: AppState; readonly control?: UserControlState }): Frame => ({
  app: "up",
  control: { run: "active", tasks: [], resumePending: [] },
  ...input
})

const beforeMiddleWave = taskStates({ A: "settled", B: "desired", C: "desired" })
const middleHeld = taskStates({ A: "settled", B: "running", C: "running" })

interface CompletionState {
  revision: string
  observedAt: string
  readonly taskCount: 9 | 10
  frontier: ReadonlyArray<TaskKey>
  held: ReadonlyArray<TaskKey>
  integrations: ReadonlyArray<TaskKey>
  settled: ReadonlyArray<TaskKey>
  pausedTasks: ReadonlyArray<TaskKey>
  resumePending: ReadonlyArray<TaskKey>
}
type CompletionAction =
  | { readonly kind: "admit"; readonly task: TaskKey; readonly time: string }
  | { readonly kind: "terminal"; readonly task: TaskKey; readonly time: string }
  | { readonly kind: "settle"; readonly task: TaskKey; readonly time: string }
  | { readonly kind: "pause-task"; readonly task: TaskKey; readonly time: string }
  | { readonly kind: "unpause-task"; readonly task: TaskKey; readonly time: string }
  | { readonly kind: "publish"; readonly revision: string; readonly frontier: ReadonlyArray<TaskKey>; readonly time: string; readonly refresh?: boolean }

const completionTasks = (state: CompletionState): Record<TaskKey, TaskState> => {
  const result = taskStates({})
  for (const task of state.settled) result[task] = "settled"
  for (const task of state.integrations) result[task] = "integrating"
  for (const task of state.held) result[task] = "running"
  const unavailable = [...state.pausedTasks, ...state.resumePending]
  const bounded = [...state.held, ...state.frontier.filter((task) => !unavailable.includes(task))].slice(0, capacity)
  for (const task of state.frontier) result[task] = bounded.includes(task) ? "desired" : "waiting"
  return result
}

const completionFrames = (initial: CompletionState, actions: ReadonlyArray<CompletionAction>): ReadonlyArray<Frame> => {
  const state: CompletionState = { ...initial }
  return actions.map((action): Frame => {
    if (action.kind === "admit") {
      state.frontier = state.frontier.filter((task) => task !== action.task)
      state.held = [...state.held, action.task]
    } else if (action.kind === "terminal") {
      state.held = state.held.filter((task) => task !== action.task)
      state.integrations = [...state.integrations, action.task]
    } else if (action.kind === "settle") {
      state.integrations = state.integrations.filter((task) => task !== action.task)
      state.settled = [...state.settled, action.task]
    } else if (action.kind === "pause-task") {
      state.pausedTasks = [...state.pausedTasks, action.task]
      state.resumePending = state.resumePending.filter((task) => task !== action.task)
    } else if (action.kind === "unpause-task") {
      state.pausedTasks = state.pausedTasks.filter((task) => task !== action.task)
      state.resumePending = [...state.resumePending, action.task]
    } else {
      state.revision = action.revision
      state.observedAt = action.time
      state.frontier = action.frontier
      state.resumePending = []
    }
    const unavailable = [...state.pausedTasks, ...state.resumePending]
    const bounded = [...state.held, ...state.frontier.filter((task) => !unavailable.includes(task))].slice(0, capacity)
    const publication = action.kind === "publish"
    const control = action.kind === "pause-task" || action.kind === "unpause-task"
    const event = publication
      ? action.refresh
        ? `Fresh ${action.revision} read confirms ${action.frontier.join(" and ") || "full completion"}`
        : `${action.revision} publishes ${action.frontier.join(" and ") || "full completion"}`
      : action.kind === "admit"
        ? `${action.task} is admitted`
        : action.kind === "terminal"
          ? `${action.task} leaves task work`
          : action.kind === "settle"
            ? `${action.task} integration settles`
            : action.kind === "pause-task"
              ? `Alice pauses ${action.task}`
              : `Alice unpauses ${action.task}`
    const boundary = publication
      ? action.refresh
        ? `JOURNAL · fresh complete graph ${action.revision} accepted after Task Unpause`
        : `JOURNAL · complete graph ${action.revision} accepted`
      : action.kind === "admit"
        ? `RUNTIME · ${action.task} responsibility begins`
        : action.kind === "terminal"
          ? `EXECUTOR · ${action.task} terminal accepted`
          : action.kind === "settle"
            ? `INTEGRATION · ${action.task} finality accepted`
            : action.kind === "pause-task"
              ? `USER CONTROL · ${action.task} pause accepted`
              : `USER CONTROL · ${action.task} unpause accepted; fresh read required`
    const changed: ReadonlyArray<StageKey> = publication
      ? ["read", "graph", "frontier", "tickets", "reflection"]
      : action.kind === "admit"
        ? ["frontier", "responsibilities", "reflection"]
        : action.kind === "terminal"
          ? ["tickets", "responsibilities", "settlements", "reflection"]
          : action.kind === "settle"
            ? ["settlements", "reflection"]
            : []
    return frame({
      time: action.time,
      event,
      boundary,
      kind: publication ? "publication" : control ? "control" : "runtime",
      control: { run: "active", tasks: state.pausedTasks, resumePending: state.resumePending },
      graph: { kind: "Complete", revision: state.revision, observedAt: state.observedAt, age: publication ? "fresh" : "stale", taskCount: state.taskCount },
      tasks: completionTasks(state),
      frontier: state.frontier,
      bounded,
      held: state.held,
      integrations: state.integrations,
      settled: state.settled,
      changed,
      durable: publication ? `Complete ${state.revision} graph` : control ? `${action.task} ${action.kind === "pause-task" ? "pause" : "unpause"} decision` : `${action.task} ${action.kind === "admit" ? "responsibility" : action.kind === "terminal" ? "integration intent" : "integration observation"}`,
      expected: publication ? `${action.frontier.join(" and ") || "No task"} eligible` : control ? action.kind === "pause-task" ? `${action.task} stays in the frontier without a desired ticket` : `${action.task} waits for a fresh task-scoped read` : event,
      forbidden: publication ? "Partial graph or premature dependent" : control ? `${action.task} admitted from pre-unpause facts` : `Duplicate ${action.task} ${action.kind}`
    })
  })
}

const completionAfterRestart = (): ReadonlyArray<Frame> => completionFrames(
  { revision: "R43", observedAt: "10:42:44", taskCount: 10, frontier: ["X"], held: ["B", "C"], integrations: [], settled: ["A"], pausedTasks: [], resumePending: [] },
  [
    { kind: "terminal", task: "B", time: "10:42:45" },
    { kind: "pause-task", task: "X", time: "10:42:46" },
    { kind: "unpause-task", task: "X", time: "10:42:48" },
    { kind: "publish", revision: "R43", frontier: ["X"], time: "10:42:50", refresh: true },
    { kind: "admit", task: "X", time: "10:42:51" },
    { kind: "settle", task: "B", time: "10:42:49" }, { kind: "terminal", task: "C", time: "10:42:54" },
    { kind: "settle", task: "C", time: "10:42:58" }, { kind: "publish", revision: "R44", frontier: ["D"], time: "10:43:03" },
    { kind: "admit", task: "D", time: "10:43:05" }, { kind: "terminal", task: "D", time: "10:43:19" },
    { kind: "settle", task: "D", time: "10:43:23" }, { kind: "publish", revision: "R45", frontier: ["E", "F"], time: "10:43:28" },
    { kind: "admit", task: "E", time: "10:43:30" }, { kind: "terminal", task: "X", time: "10:43:35" },
    { kind: "admit", task: "F", time: "10:43:36" }, { kind: "settle", task: "X", time: "10:43:39" },
    { kind: "terminal", task: "E", time: "10:43:50" }, { kind: "settle", task: "E", time: "10:43:54" },
    { kind: "terminal", task: "F", time: "10:43:59" }, { kind: "settle", task: "F", time: "10:44:03" },
    { kind: "publish", revision: "R46", frontier: ["H", "I"], time: "10:44:08" }, { kind: "admit", task: "H", time: "10:44:10" },
    { kind: "admit", task: "I", time: "10:44:11" }, { kind: "terminal", task: "H", time: "10:44:25" },
    { kind: "settle", task: "H", time: "10:44:29" }, { kind: "terminal", task: "I", time: "10:44:34" },
    { kind: "settle", task: "I", time: "10:44:38" }, { kind: "publish", revision: "R47", frontier: ["G"], time: "10:44:43" },
    { kind: "admit", task: "G", time: "10:44:45" }, { kind: "terminal", task: "G", time: "10:45:00" },
    { kind: "settle", task: "G", time: "10:45:04" }, { kind: "publish", revision: "R48", frontier: [], time: "10:45:09" }
  ]
)

const story: Scenario = {
  name: "Held positions survive graph drift",
  question: "Can restart preserve B and C while a complete graph change adds X without displacing either responsibility?",
  placement: "After B and C hold both positions, before Alice adds X",
  value: "The crash exposes exact responsibility recovery and complete-graph staleness in one chronology.",
  frames: [
    frame({ time: "10:42:00", event: "R41 publishes A", boundary: "JOURNAL · complete graph R41 accepted", kind: "publication", graph: { kind: "Complete", revision: "R41", observedAt: "10:42:00", age: "fresh", taskCount: 9 }, tasks: taskStates({ A: "desired" }), frontier: ["A"], bounded: ["A"], held: [], integrations: [], settled: [], changed: ["read", "graph", "frontier", "tickets", "responsibilities", "reflection"], durable: "Complete R41 graph", expected: "A becomes desired", forbidden: "Partial graph nodes" }),
    frame({ time: "10:42:03", event: "A is admitted", boundary: "RUNTIME · A responsibility begins", kind: "runtime", graph: { kind: "Complete", revision: "R41", observedAt: "10:42:00", age: "stale · 3s", taskCount: 9 }, tasks: taskStates({ A: "running" }), frontier: [], bounded: ["A"], held: ["A"], integrations: [], settled: [], changed: ["frontier", "responsibilities", "reflection"], durable: "A run and attempt identity", expected: "One position held", forbidden: "Second admission for A" }),
    frame({ time: "10:42:19", event: "A settles", boundary: "INTEGRATION · A finality accepted", kind: "runtime", graph: { kind: "Complete", revision: "R41", observedAt: "10:42:00", age: "stale · 19s", taskCount: 9 }, tasks: taskStates({ A: "settled" }), frontier: [], bounded: [], held: [], integrations: [], settled: ["A"], changed: ["tickets", "responsibilities", "settlements", "reflection"], durable: "A settlement", expected: "B and C remain blocked on stale R41", forbidden: "Local completion fabricates tracker success" }),
    frame({ time: "10:42:23", event: "R42 releases B and C", boundary: "JOURNAL · complete graph R42 accepted", kind: "publication", graph: { kind: "Complete", revision: "R42", observedAt: "10:42:23", age: "fresh", taskCount: 9 }, tasks: beforeMiddleWave, frontier: ["B", "C"], bounded: ["B", "C"], held: [], integrations: [], settled: ["A"], changed: ["read", "graph", "frontier", "tickets", "responsibilities", "reflection"], durable: "Complete R42 graph", expected: "B and C appear together", forbidden: "Only one diamond branch appears" }),
    frame({ time: "10:42:25", event: "B is admitted", boundary: "RUNTIME · B responsibility begins", kind: "runtime", graph: { kind: "Complete", revision: "R42", observedAt: "10:42:23", age: "stale · 2s", taskCount: 9 }, tasks: taskStates({ A: "settled", B: "running", C: "desired" }), frontier: ["C"], bounded: ["B", "C"], held: ["B"], integrations: [], settled: ["A"], changed: ["frontier", "responsibilities", "reflection"], durable: "B run and attempt identity", expected: "C stays desired", forbidden: "C shown as already held" }),
    frame({ time: "10:42:26", event: "C is admitted", boundary: "RUNTIME · C responsibility begins", kind: "runtime", graph: { kind: "Complete", revision: "R42", observedAt: "10:42:23", age: "stale · 3s", taskCount: 9 }, tasks: middleHeld, frontier: [], bounded: ["B", "C"], held: ["B", "C"], integrations: [], settled: ["A"], changed: ["frontier", "responsibilities", "reflection"], durable: "Exact B and C run/attempt identities", expected: "Both positions held", forbidden: "Frontier still lists admitted tasks" }),
    frame({ time: "10:42:27", event: "Application crashes", boundary: "PROCESS · coordinator exits unexpectedly", kind: "crash", app: "down", graph: { kind: "Complete", revision: "R42", observedAt: "10:42:23", age: "frozen · 4s", taskCount: 9 }, tasks: middleHeld, frontier: [], bounded: ["B", "C"], held: ["B", "C"], integrations: [], settled: ["A"], changed: [], durable: "Journaled B and C responsibilities", expected: "Last complete view freezes", forbidden: "Positions become open" }),
    frame({ time: "10:42:30", event: "Alice adds X in the tracker", boundary: "TRACKER · external graph mutation while app is down", kind: "external", app: "down", graph: { kind: "Complete", revision: "R42", observedAt: "10:42:23", age: "frozen · tracker newer", taskCount: 9 }, tasks: middleHeld, frontier: [], bounded: ["B", "C"], held: ["B", "C"], integrations: [], settled: ["A"], changed: [], durable: "UI still has complete R42 only", expected: "No X node appears yet", forbidden: "Ghost X from an unobserved graph" }),
    frame({ time: "10:42:34", event: "B and C are reconstructed", boundary: "RESTART · exact responsibilities recovered before fresh work", kind: "recovery", app: "restarting", graph: { kind: "Complete", revision: "R42", observedAt: "10:42:23", age: "stale · 11s", taskCount: 9 }, tasks: middleHeld, frontier: [], bounded: ["B", "C"], held: ["B", "C"], integrations: [], settled: ["A"], changed: ["responsibilities", "reflection"], durable: "Same B and C run/attempt identities", expected: "Two positions remain held", forbidden: "B, C, or X admitted before graph observation" }),
    frame({ time: "10:42:38", event: "R43 adds X", boundary: "JOURNAL · complete ten-task graph accepted", kind: "publication", graph: { kind: "Complete", revision: "R43", observedAt: "10:42:38", age: "fresh", taskCount: 10 }, tasks: taskStates({ A: "settled", B: "running", C: "running", X: "waiting" }), frontier: ["X"], bounded: ["B", "C"], held: ["B", "C"], integrations: [], settled: ["A"], changed: ["read", "graph", "frontier", "reflection"], durable: "Complete R43 graph containing X", expected: "X waits beyond full capacity", forbidden: "B or C is displaced" }),
    frame({ time: "10:42:40", event: "Alice pauses the Run", boundary: "USER CONTROL · Run Pause accepted", kind: "control", control: { run: "paused", tasks: [], resumePending: [] }, graph: { kind: "Complete", revision: "R43", observedAt: "10:42:38", age: "stale · 2s", taskCount: 10 }, tasks: taskStates({ A: "settled", B: "running", C: "running", X: "waiting" }), frontier: ["X"], bounded: ["B", "C"], held: ["B", "C"], integrations: [], settled: ["A"], changed: [], durable: "Run Pause decision and B/C responsibilities", expected: "B and C remain held; X does not start", forbidden: "New forward progress while the Run is paused" }),
    frame({ time: "10:42:42", event: "Alice unpauses the Run", boundary: "USER CONTROL · Run Unpause accepted; fresh reads required", kind: "control", graph: { kind: "Complete", revision: "R43", observedAt: "10:42:38", age: "stale · 4s", taskCount: 10 }, tasks: taskStates({ A: "settled", B: "running", C: "running", X: "waiting" }), frontier: ["X"], bounded: ["B", "C"], held: ["B", "C"], integrations: [], settled: ["A"], changed: [], durable: "Run Unpause decision and B/C responsibilities", expected: "No new work starts from pre-pause facts", forbidden: "X admitted before a fresh graph read" }),
    frame({ time: "10:42:44", event: "Fresh R43 read permits work to resume", boundary: "JOURNAL · complete graph R43 accepted after Unpause", kind: "publication", graph: { kind: "Complete", revision: "R43", observedAt: "10:42:44", age: "fresh", taskCount: 10 }, tasks: taskStates({ A: "settled", B: "running", C: "running", X: "waiting" }), frontier: ["X"], bounded: ["B", "C"], held: ["B", "C"], integrations: [], settled: ["A"], changed: ["read"], durable: "Fresh complete R43 graph", expected: "Forward progress may resume; capacity remains full", forbidden: "Graph content changes without a tracker fact" }),
    ...completionAfterRestart()
  ]
}

const originalDescription = "State-colored top rules identify each live-data rectangle while source and data remain in one shared row."

let frameIndex = 0
let selectedStage: StageKey = "frontier"
let selectedTask: TaskKey = "B"
let selectionMode: SelectionMode = "none"
let playing = false
let reducedMotion = matchMedia("(prefers-reduced-motion: reduce)").matches
let timer: number | undefined
const root = document.querySelector<HTMLElement>("#prototype-root")!

const current = (): Frame => story.frames[frameIndex] ?? story.frames[0]!
const previous = (): Frame => story.frames[Math.max(0, frameIndex - 1)]!
const visibleTasks = (item: Frame): ReadonlyArray<TaskKey> => item.graph.taskCount === 10 ? allTasks : originalTasks

const header = (): string => `<header class="topbar"><div><span class="kicker">THROWAWAY · CRASH PLACEMENT LAB</span><h1>${story.name}</h1><p>${story.question}</p></div><div class="top-controls"><button data-end class="end">View full integration</button><button data-play class="play">${playing ? "■ Stop" : "▶ Play scenario"}</button><label class="motion"><input data-motion type="checkbox" ${reducedMotion ? "checked" : ""}><span></span>Reduce motion</label></div></header>`

const placement = (): string => `<section class="placement"><div><small>RETAINED CRASH PLACEMENT</small><b>${story.placement}</b><p>${story.value}</p></div><ul><li>visible app-state change</li><li>durable recovery fact</li><li>safe/forbidden contrast</li><li>predictable user outcome</li></ul><span>4 / 4</span></section>`

const timeline = (): string => `<section class="timeline" style="--moments:${story.frames.length}">${story.frames.map((item, index) => `<button data-frame="${index}" class="frame-step kind-${item.kind} ${index === frameIndex ? "active" : ""}"><i>${index + 1}</i><b>${item.event}</b><small>${item.time}</small></button>`).join("")}</section>`

const tokens = (items: ReadonlyArray<TaskKey>, source: Frame): string => items.map((task) => `<i class="transition-task state-${source.tasks[task]}"><b>${task}</b></i>`).join("") || '<i class="transition-empty">empty</i>'
const controlStatus = (item: Frame): readonly [string, string] => {
  if (item.app === "down") return ["application down", "last complete publication frozen"]
  if (item.app === "restarting") return ["restarting", "recovery before fresh work"]
  if (item.control.run === "paused") return ["Run paused", "existing positions remain; no new forward progress"]
  if (item.control.tasks.length > 0) return [`${item.control.tasks.join(" + ")} paused`, "paused tasks remain visible but cannot receive tickets"]
  if (item.control.resumePending.length > 0) return [`${item.control.resumePending.join(" + ")} unpaused`, "fresh task-scoped facts required before admission"]
  return ["active", "processing complete graph publications"]
}
const transition = (item: Frame): string => {
  const [status, explanation] = controlStatus(item)
  return `<section class="transition-strip app-${item.app} ${item.control.run === "paused" || item.control.tasks.length > 0 || item.control.resumePending.length > 0 ? "control-active" : ""}"><div class="transition-state"><small>BEFORE</small><span><em>frontier</em>${tokens(previous().frontier, previous())}</span><span><em>held</em>${tokens(previous().held, previous())}</span></div><div class="boundary-event"><small>${item.kind === "crash" ? "CRASH EVENT" : item.kind === "control" ? "USER CONTROL EVENT" : "BOUNDARY EVENT"}</small><b>${item.boundary}</b><i>→</i></div><div class="transition-state"><small>AFTER</small><span><em>frontier</em>${tokens(item.frontier, item)}</span><span><em>held</em>${tokens(item.held, item)}</span></div><div class="application-state"><small>APPLICATION / USER CONTROL</small><b>${status}</b><span>${explanation}</span></div></section>`
}

const frontierCells = (item: Frame): ReadonlyArray<Cell> => {
  const before = previous()
  return item.frontier.map((task, index): Cell => {
    const oldIndex = before.frontier.indexOf(task)
    const motion = frameIndex === 0 || oldIndex < 0 ? "ENTERED" : oldIndex === index ? "STAYED" : `RANK ${oldIndex + 1}→${index + 1}`
    const beyond = !item.bounded.includes(task)
    const state = item.control.tasks.includes(task)
      ? "paused by user"
      : item.control.resumePending.includes(task)
        ? "unpaused · fresh read required"
        : beyond
          ? "waits beyond capacity"
          : "inside desired prefix"
    return { title: `#${index + 1} · ${motion}`, value: `${task} · ${state}`, task, tone: beyond ? "waiting" : "desired" }
  })
}

const cellsFor = (stage: StageKey, item: Frame): ReadonlyArray<Cell> => {
  const outsideBound = item.frontier.filter((task) => !item.bounded.includes(task))
  const byStage: Record<StageKey, ReadonlyArray<Cell>> = {
    read: [{ title: "COMPLETE SNAPSHOT", value: `${item.graph.revision} · ${item.graph.age}`, tone: item.graph.age === "fresh" ? "fresh" : "stale" }],
    graph: visibleTasks(item).map((task) => ({ title: `TASK ${task}`, value: taskLabel[item.tasks[task]], task, tone: item.tasks[task] })),
    frontier: frontierCells(item),
    tickets: [
      ...item.bounded.map((task, index) => ({ title: `DESIRED #${index + 1}`, value: `${task} · ${item.held.includes(task) ? "retained" : "not held"}`, task, tone: item.held.includes(task) ? "running" as const : "desired" as const })),
      ...(outsideBound.length === 0 ? [] : [{ title: `${outsideBound.length} OUTSIDE BOUND`, value: `${outsideBound.join(" · ")} remain in frontier`, tone: "waiting" as const }])
    ],
    responsibilities: item.held.map((task, index) => ({ title: `HELD POSITION #${index + 1}`, value: `${task} · exact attempt`, task, tone: "running" })),
    settlements: [
      { title: "SETTLED TOTAL", value: `${item.settled.length}/${item.graph.taskCount} tasks`, tone: "output" },
      ...item.integrations.map((task) => ({ title: "INTEGRATION LIVE", value: `${task} · intent durable`, task, tone: "integrating" as const })),
      ...item.settled.map((task, index) => ({ title: `SETTLED ${index + 1}/${item.graph.taskCount}`, value: `${task} · final`, task, tone: "settled" as const }))
    ],
    reflection: [
      { title: "FRONTIER", value: `${item.frontier.length} task(s)`, tone: "output" },
      { title: "HELD", value: `${item.held.length}/${capacity} positions`, tone: "running" },
      { title: "INTEGRATING", value: `${item.integrations.length} task(s)`, tone: "integrating" },
      { title: "SETTLED", value: `${item.settled.length}/${item.graph.taskCount} tasks`, tone: "settled" },
      ...(item.control.run === "paused" ? [{ title: "RUN PAUSE", value: "new forward progress stopped", tone: "rule" as const }] : []),
      ...item.control.tasks.map((task) => ({ title: `TASK ${task} PAUSE`, value: "ticket suppressed", task, tone: "rule" as const })),
      ...item.control.resumePending.map((task) => ({ title: `TASK ${task} UNPAUSED`, value: "fresh read pending", task, tone: "rule" as const }))
    ]
  }
  return byStage[stage]
}

const tasksForStage = (stage: StageKey, item: Frame): ReadonlyArray<TaskKey> => {
  switch (stage) {
    case "read":
    case "graph":
    case "reflection": return visibleTasks(item)
    case "frontier": return item.frontier
    case "tickets": return [...new Set([...item.bounded, ...item.frontier])]
    case "responsibilities": return item.held
    case "settlements": return [...new Set([...item.integrations, ...item.settled])]
  }
}
const activeTasks = (item: Frame): ReadonlyArray<TaskKey> => selectionMode === "none" ? [] : selectionMode === "task" ? [selectedTask] : tasksForStage(selectedStage, item)
const stageSelectionClass = (stage: StageKey, item: Frame): string => {
  if (selectionMode === "none") return ""
  if (selectionMode === "stage") return selectedStage === stage ? "selected selection-related" : "selection-muted"
  return tasksForStage(stage, item).includes(selectedTask) ? "selection-related" : "selection-muted"
}
const rectangles = (stage: StageKey, cells: ReadonlyArray<Cell>, item: Frame): string => {
  if (cells.length === 0) return '<span class="no-delta">empty</span>'
  const active = activeTasks(item)
  return `<span class="rectangles">${cells.map((cell) => {
    const related = selectionMode === "stage" ? stage === selectedStage : selectionMode === "task" && cell.task === selectedTask
    const selection = related ? "selection-related" : active.length > 0 ? "selection-muted" : ""
    return `<span class="data-rectangle tone-${cell.tone ?? "fact"} ${selection}" ${cell.task === undefined ? "" : `data-cell-task="${cell.task}"`}><small>${cell.title}</small><b>${cell.value}</b></span>`
  }).join("")}</span>`
}

const codeMarkup = (code: string): string => {
  const terms = /(const|return|yield\*|TrackerGraphRelation|mapCurrentSignal|frontierOf|boundedParallelTickets|executorResponsibilities|deliverySettlements|reflectDeliverySettlements)/g
  return code.split(terms).map((term) => {
    if (term === "const" || term === "return" || term === "yield*") return `<span class="syntax-keyword">${term}</span>`
    if (terms.test(term)) return `<span class="syntax-call">${term}</span>`
    terms.lastIndex = 0
    return term
  }).join("")
}

const codePanel = (item: Frame): string => `<section class="code-panel instrument"><div class="panel-head"><div><span class="panel-kind">PRODUCTION SHAPE · FRONTIER MEMBERSHIP</span><h2>delivery.ts</h2></div><span>moment ${frameIndex + 1} / ${story.frames.length}</span></div><div class="code-window"><div class="code-columns"><span></span><b>PRODUCTION SOURCE</b><b>LIVE DATA</b></div><div class="code-line brace"><span></span><code>export const delivery = Effect.gen(function* () {</code></div>${stages.map((stage) => `<button data-stage="${stage.key}" class="code-line stage-${stage.key} ${item.changed.includes(stage.key) ? "changed" : "stable"} ${stageSelectionClass(stage.key, item)}"><span class="gutter"><i></i></span><code>${codeMarkup(stage.code)}</code>${rectangles(stage.key, cellsFor(stage.key, item), item)}</button>`).join("")}<div class="code-line brace"><span></span><code>})</code></div></div><div class="code-key"><span><i class="changed-mark"></i>changed at this landmark</span><span><i class="selected-mark"></i>selection links source · data · graph</span><span>${originalDescription}</span></div></section>`

const nodePositions: Record<TaskKey, readonly [number, number]> = {
  A: [5, 43], B: [21, 17], C: [21, 69], D: [39, 43], E: [55, 17], F: [55, 69], H: [71, 17], I: [71, 69], X: [39, 84], G: [88, 43]
}
const edges: ReadonlyArray<readonly [TaskKey, TaskKey]> = [["A", "B"], ["A", "C"], ["B", "D"], ["C", "D"], ["D", "E"], ["D", "F"], ["E", "H"], ["F", "I"], ["H", "G"], ["I", "G"], ["A", "X"], ["X", "G"]]
const svgEdge = ([from, to]: readonly [TaskKey, TaskKey], item: Frame): string => {
  if (!visibleTasks(item).includes(from) || !visibleTasks(item).includes(to)) return ""
  const [x1, y1] = nodePositions[from]
  const [x2, y2] = nodePositions[to]
  const active = activeTasks(item)
  const selection = active.length === 0 ? "" : active.includes(from) || active.includes(to) ? "selection-related" : "selection-muted"
  return `<line class="${selection}" x1="${x1 + 5}" y1="${y1 + 4}" x2="${x2}" y2="${y2 + 4}" />`
}
const node = (task: TaskKey, item: Frame): string => {
  const [left, top] = nodePositions[task]
  const active = activeTasks(item)
  const selection = active.length === 0 ? "" : active.includes(task) ? "selection-related" : "selection-muted"
  const control = item.control.tasks.includes(task) ? "task-paused" : item.control.resumePending.includes(task) ? "resume-pending" : ""
  const state = item.control.tasks.includes(task) ? "paused by user" : item.control.resumePending.includes(task) ? "fresh read required" : taskLabel[item.tasks[task]]
  return `<button data-task="${task}" style="--left:${left}%;--top:${top}%" class="task-node state-${item.tasks[task]} ${selectionMode === "task" && selectedTask === task ? "selected" : ""} ${selection} ${control}"><i>${task}</i><span><b>Task ${task}</b><small>${state}</small></span></button>`
}
const chip = (task: TaskKey, item: Frame): string => {
  const active = activeTasks(item)
  const selection = active.length === 0 ? "" : active.includes(task) ? "selection-related" : "selection-muted"
  const state = item.control.tasks.includes(task) ? "paused by user" : item.control.resumePending.includes(task) ? "fresh read required" : taskLabel[item.tasks[task]]
  return `<button data-task="${task}" class="flow-chip state-${item.tasks[task]} ${selection}"><b>${task}</b><span>${state}</span></button>`
}

const graphPanel = (item: Frame): string => `<section class="graph-panel instrument"><div class="panel-head"><div><span class="panel-kind">COMPLETE GRAPH + DELIVERY OVERLAY</span><h2>${item.graph.revision} · ${item.graph.taskCount} tasks · ${item.settled.length}/${item.graph.taskCount} integrated</h2></div><span class="freshness ${item.graph.age === "fresh" ? "fresh" : "stale"}">${item.settled.length === item.graph.taskCount ? "FULL INTEGRATION" : `${item.graph.age} · observed ${item.graph.observedAt}`}</span></div><div class="graph-canvas ${item.app === "down" ? "frozen" : ""}"><svg viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true"><defs><marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 z" /></marker></defs>${edges.map((edge) => svgEdge(edge, item)).join("")}</svg>${visibleTasks(item).map((task) => node(task, item)).join("")}${item.app === "down" ? '<div class="crash-shutter"><b>APPLICATION DOWN</b><span>Complete graph remains visible but frozen</span></div>' : ""}</div><div class="flow-model"><div class="flow-group frontier-group"><small>ORDERED FRONTIER · CURRENT MEMBERSHIP</small><div>${item.frontier.length === 0 ? '<span class="empty">empty</span>' : item.frontier.map((task) => chip(task, item)).join("")}</div><p>${item.frontier.filter((task) => !item.bounded.includes(task)).length} task(s) wait beyond the desired prefix.</p></div><span class="capacity-arrow">→<small>capacity ${capacity}</small></span><div class="flow-group capacity-group"><small>DESIRED TICKETS / ACTUAL HELD POSITIONS</small><div>${item.bounded.length === 0 ? '<span class="empty">no desired tickets</span>' : item.bounded.map((task) => chip(task, item)).join("")}</div><p>Held: ${item.held.length === 0 ? "none" : item.held.join(" + ")}</p></div></div></section>`

const evidence = (item: Frame): string => `<section class="evidence instrument"><div><small>DURABLE AT THIS LANDMARK</small><b>${item.durable}</b></div><div><small>EXPECTED VISIBLE RESULT</small><b>${item.expected}</b></div><div><small>FORBIDDEN RESULT</small><b>${item.forbidden}</b></div></section>`
const render = (): void => {
  const item = current()
  root.className = `prototype view-original app-${item.app} ${reducedMotion ? "reduce-motion" : ""}`
  root.innerHTML = `${header()}${placement()}${timeline()}${transition(item)}<main><div class="layout">${codePanel(item)}${graphPanel(item)}</div>${evidence(item)}</main>`
  bind()
}

const bind = (): void => {
  document.querySelectorAll<HTMLElement>("[data-frame]").forEach((element) => element.addEventListener("click", () => { frameIndex = Number(element.dataset.frame); render() }))
  document.querySelectorAll<HTMLElement>("[data-stage]").forEach((element) => element.addEventListener("click", () => {
    const stage = element.dataset.stage as StageKey
    selectionMode = selectionMode === "stage" && selectedStage === stage ? "none" : "stage"
    selectedStage = stage
    render()
  }))
  document.querySelectorAll<HTMLElement>("[data-task]").forEach((element) => element.addEventListener("click", () => { selectedTask = element.dataset.task as TaskKey; selectionMode = "task"; render() }))
  document.querySelectorAll<HTMLElement>("[data-cell-task]").forEach((element) => element.addEventListener("click", (event) => { event.stopPropagation(); selectedStage = element.closest<HTMLElement>("[data-stage]")?.dataset.stage as StageKey ?? selectedStage; selectedTask = element.dataset.cellTask as TaskKey; selectionMode = "task"; render() }))
  document.querySelector<HTMLElement>("[data-end]")?.addEventListener("click", () => { frameIndex = story.frames.length - 1; render() })
  document.querySelector<HTMLElement>("[data-play]")?.addEventListener("click", () => { playing = !playing; if (timer !== undefined) clearInterval(timer); if (playing) timer = window.setInterval(() => { frameIndex = (frameIndex + 1) % story.frames.length; render() }, reducedMotion ? 2600 : 1900); render() })
  document.querySelector<HTMLInputElement>("[data-motion]")?.addEventListener("change", (event) => { reducedMotion = (event.currentTarget as HTMLInputElement).checked; render() })
}

addEventListener("keydown", (event) => {
  if ((event.target as HTMLElement | null)?.matches("input,textarea,[contenteditable]")) return
  if (event.key === "[") { frameIndex = Math.max(0, frameIndex - 1); render() }
  if (event.key === "]") { frameIndex = Math.min(story.frames.length - 1, frameIndex + 1); render() }
})
addEventListener("popstate", () => { frameIndex = 0; render() })
render()
