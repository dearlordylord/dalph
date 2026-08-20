import { maintainedAuthoredCassetteCatalog } from "../../../packages/dalph/src/cassettes/catalog.ts"
import { AuthoredCassetteStoryItem } from "../../../packages/dalph/src/cassettes/authored-domain.ts"
import { renderAuthoredStoryItemLandmark } from "../../../packages/dalph/src/cassettes/authored-presentation.ts"
import {
  AuthoredObservationCaptureOrder,
  type AuthoredObservationMoment
} from "../../../packages/dalph/src/cassettes/authored-runner.ts"
import "./trace-cursor-selection.test.ts"
import "./delivery-playback.test.ts"
import { maintainedIntegrationFinalityProtocolCassetteCatalog } from "../../../packages/dalph/src/cassettes/integration-finality-protocol-cassette-domain.ts"
import { maintainedTargetPromotionProtocolCassetteCatalog } from "../../../packages/dalph/src/cassettes/target-promotion-protocol-cassette-domain.ts"
import { maintainedApplicationExitProtocolCassetteCatalog } from "../../../packages/dalph/src/cassettes/application-exit-protocol-cassette-domain.ts"
import { maintainedCodexPlannedAttemptExecutorCassetteCatalog } from "../../../packages/dalph/src/cassettes/codex-planned-attempt-executor-cassette-domain.ts"
import { deliveryProposalOrderTaskId } from "@dalph/orchestrator"
import { parseHTML } from "linkedom"
import {
  cassetteSettledEvent,
  everyCassetteSettledEvent,
  mountCassetteLab,
  singleCassetteSettledEvent
} from "./cassette-lab-browser.ts"
import {
  browserDigest,
  type CassetteLabResult,
  type CassetteRunObserver,
  maintainedCassetteKeys,
  maintainedCassetteRows,
  runAuthoredCassetteInput,
  runEveryMaintainedCassette,
  runMaintainedCassette
} from "./cassette-lab.ts"
import {
  executionSummaryItems,
  protocolDiagnosticItems,
  resultEvidenceText,
  resultStatusText,
  runAllSummaryText
} from "./cassette-lab-view.ts"
import { deliverySourceExplanationAt } from "./delivery-source-explanation.ts"
import { dominantTaskTone } from "./cassette-lab-workbench.ts"
import {
  TraceCursorSelected,
  auxiliaryTraceCorrelation,
  makeTraceCursorSelectionModel,
  projectTraceCursorSelection,
  updateTraceCursorSelection
} from "./trace-cursor-selection.ts"

type CompletedCassette = Extract<CassetteLabResult, { readonly _tag: "Completed" }>

const authoredStoryPosition = (value: number): AuthoredObservationMoment["storyPosition"] =>
  value as AuthoredObservationMoment["storyPosition"]

const deliveryMomentIndex = (result: CompletedCassette, deliveryFrameIndex: number): number => {
  const frame = result.deliveryFrames?.[deliveryFrameIndex]
  if (frame === undefined || result.observationMoments === null) return -1
  return result.observationMoments.findIndex((moment) =>
    moment._tag === "DeliveryPublicationMoment" && moment.deliveryFrame === frame
  )
}

const assert = (condition: boolean, message: string): void => {
  if (!condition) throw new Error(message)
}

const scenario = async (name: string, body: () => void | Promise<void>): Promise<void> => {
  await body()
  console.log(`✓ ${name}`)
}

const expectedCatalogSize = Object.keys(maintainedAuthoredCassetteCatalog).length
  + Object.keys(maintainedTargetPromotionProtocolCassetteCatalog).length
  + Object.keys(maintainedIntegrationFinalityProtocolCassetteCatalog).length
  + Object.keys(maintainedApplicationExitProtocolCassetteCatalog).length
  + Object.keys(maintainedCodexPlannedAttemptExecutorCassetteCatalog).length

let everyResult = await runEveryMaintainedCassette()
let mismatchedResult: Awaited<ReturnType<typeof runAuthoredCassetteInput>> | undefined

await scenario("does not mark delivery source outputs changed for runtime-only or story-only moments", () => {
  const result = everyResult.find(({ catalogKey }) =>
    catalogKey === "authored:acceptedResultRestartsIntoIntegration"
  )
  if (result?._tag !== "Completed" || result.observationMoments === null) {
    throw new Error("authored observation moments are unavailable")
  }
  const index = result.observationMoments.findIndex((moment, candidateIndex) =>
    candidateIndex > 0
    && moment._tag !== "DeliveryPublicationMoment"
    && moment.deliveryFrame !== null
  )
  const explanation = deliverySourceExplanationAt(result.observationMoments, index)
  assert(
    explanation._tag === "DeliverySourceAvailable"
    && !explanation.publicationObservedAtMoment
    && explanation.rows.every(({ changed }) => !changed)
    && explanation.status === "No Delivery publication changed the source explanation at this moment.",
    "A story-only or runtime-only moment must carry Delivery values without changed-source highlighting"
  )
})

await scenario("marks only source outputs changed by adjacent Delivery publications", () => {
  const result = everyResult.find(({ catalogKey }) => catalogKey === "authored:productionShapedFiveTaskDiamond")
  if (result?._tag !== "Completed" || result.observationMoments === null) {
    throw new Error("authored observation moments are unavailable")
  }
  const firstPublicationIndex = result.observationMoments.findIndex(({ _tag }) => _tag === "DeliveryPublicationMoment")
  const firstExplanation = deliverySourceExplanationAt(result.observationMoments, firstPublicationIndex)
  assert(
    firstExplanation._tag === "DeliverySourceAvailable"
    && firstExplanation.rows.every(({ changed }) => !changed)
    && firstExplanation.status.includes("no preceding Delivery publication"),
    "The first Delivery publication has no adjacent predecessor and must not claim changed rows"
  )
  assert(
    result.observationMoments.some((moment, index) => {
      if (moment._tag !== "DeliveryPublicationMoment") return false
      if (!result.observationMoments?.slice(0, index).some(({ _tag }) => _tag === "DeliveryPublicationMoment")) {
        return false
      }
      const explanation = deliverySourceExplanationAt(result.observationMoments ?? [], index)
      return explanation._tag === "DeliverySourceAvailable" && explanation.rows.some(({ changed }) => changed)
    }),
    "Adjacent Delivery publications must compare their typed stage outputs"
  )
})

await scenario("keeps selected waiting and excluded ticket cells visibly distinct", () => {
  const match = everyResult.flatMap((result) => {
    if (result._tag !== "Completed" || result.observationMoments === null) return []
    const index = result.observationMoments.findIndex((moment) =>
      moment.deliveryFrame?.tickets.some(({ placement }) => placement.kind === "Selected") === true
      && moment.deliveryFrame.tickets.some(({ placement }) => placement.kind === "EligibleOutsideBound")
      && moment.deliveryFrame.tickets.some(({ placement }) => placement.kind === "GraphExcluded")
    )
    return index < 0 ? [] : [{ index, moments: result.observationMoments }]
  })[0]
  if (match === undefined) throw new Error("A bounded frontier with selected, waiting, and excluded tickets is missing")
  const explanation = deliverySourceExplanationAt(match.moments, match.index)
  if (explanation._tag !== "DeliverySourceAvailable") throw new Error("The source explanation is unavailable")
  const tickets = explanation.rows.find(({ id }) => id === "tickets")?.cells ?? []
  const frontier = explanation.rows.find(({ id }) => id === "frontier")?.cells ?? []
  assert(tickets.some(({ detail, tone }) => detail === "Selected" && tone === "desired"), "Selected tickets must use desired cells")
  assert(tickets.some(({ detail, tone }) => detail === "EligibleOutsideBound" && tone === "waiting"), "Outside-bound tickets must remain visibly waiting")
  assert(tickets.some(({ detail, tone }) => detail === "GraphExcluded" && tone === "blocked"), "Graph-excluded tickets must remain visibly excluded")
  assert(frontier.some(({ detail, tone }) => detail === "EligibleOutsideBound" && tone === "waiting"), "An eligible frontier task beyond capacity must not be called desired")
})

await scenario("distinguishes live responsibilities from retained settled evidence", () => {
  const result = everyResult.find(({ catalogKey }) => catalogKey === "authored:productionShapedFiveTaskDiamond")
  if (result?._tag !== "Completed" || result.observationMoments === null) {
    throw new Error("The five-task diamond observations are unavailable")
  }
  const settledIndex = result.observationMoments.findLastIndex((moment) =>
    moment.deliveryFrame?.deliveries.length === 5
    && moment.deliveryFrame.deliveries.every(({ obligations }) => obligations.length === 0)
    && moment.deliveryFrame.settlements.length === 5
  )
  const liveIndex = result.observationMoments.findIndex((moment) =>
    moment.deliveryFrame?.deliveries.some(({ obligations }) => obligations.length > 0) === true
  )
  const settled = deliverySourceExplanationAt(result.observationMoments, settledIndex)
  const live = deliverySourceExplanationAt(result.observationMoments, liveIndex)
  if (settled._tag !== "DeliverySourceAvailable" || live._tag !== "DeliverySourceAvailable") {
    throw new Error("The five-task responsibility explanations are unavailable")
  }
  const settledCells = settled.rows.find(({ id }) => id === "deliveries")?.cells ?? []
  const liveCells = live.rows.find(({ id }) => id === "deliveries")?.cells ?? []
  assert(settledCells.length === 5, "The final frame must retain all five exact Delivery evidence rows")
  assert(settledCells.every(({ detail, label, tone }) => label === "SETTLED EVIDENCE" && detail.includes("no live obligations") && tone === "settled"), "Finality evidence must not look like five live responsibilities")
  assert(liveCells.some(({ detail, label, tone }) => label === "RESPONSIBILITY" && detail.includes("live obligation") && tone === "responsibility"), "A nonempty obligation must retain responsibility treatment")
})

await scenario("keeps an integration owner live while a newer graph publication changes source stages", () => {
  const match = everyResult.flatMap((result) => {
    if (result._tag !== "Completed" || result.observationMoments === null) return []
    return result.observationMoments.flatMap((moment, index) => {
      if (moment._tag !== "DeliveryPublicationMoment") return []
      const hasLiveIntegration = moment.liveOwners.some((owner) =>
        !owner._tag.startsWith("Settled")
        && owner.proposal.admission.integrationTarget._tag === "IntegrationTargetResourceRequired"
      )
      const explanation = deliverySourceExplanationAt(result.observationMoments ?? [], index)
      return hasLiveIntegration
        && explanation._tag === "DeliverySourceAvailable"
        && explanation.rows.some(({ changed }) => changed)
        ? [{ moment, result }]
        : []
    })
  })[0]
  assert(
    match !== undefined,
    "A maintained chronology must retain a coherent Delivery change while its observed integration owner remains live"
  )
})

await scenario("hashes verification evidence without requiring browser crypto.subtle", () => {
  const digest = browserDigest("SHA-256", new TextEncoder().encode("abc"))
  const hex = Array.from(digest, (byte) => byte.toString(16).padStart(2, "0")).join("")
  assert(
    hex === "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    "The browser-safe digest must retain the exact SHA-256 evidence identity"
  )
})

await scenario("runs every maintained cassette through production to its declared end", () => {
  assert(maintainedCassetteKeys.length === expectedCatalogSize, "The Lab must enumerate every exact catalog")
  assert(everyResult.length === expectedCatalogSize, "Every catalog entry must retain one terminal result")
  const failures = everyResult.filter((result) => result._tag === "Failed")
  assert(
    failures.length === 0,
    `Every cassette must reach its declared end through production: ${failures
      .map((failure) => `${failure.catalogKey}: ${failure.detail}`)
      .join("\n")}`
  )
  for (const result of everyResult) {
    assert(result._tag === "Completed", `${result.catalogKey} must complete`)
    if (result._tag !== "Completed") continue
    assert(result.consumedItemCount === result.totalItemCount, `${result.catalogKey} must consume its whole story`)
    if (result.category === "ApplicationExit" || result.category === "CodexExecutor") {
      assert(result.journalRecordCount === 0, `${result.catalogKey} must not fabricate Run-journal evidence`)
    } else {
      assert(result.journalRecordCount > 0, `${result.catalogKey} must return production journal evidence`)
    }
    if (result.category === "Authored") {
      assert(result.activationOrdinals.length > 0, `${result.catalogKey} must invoke the production coordinator`)
      assert(
        result.deliveryFrames !== null && result.deliveryFrames.length > 0,
        `${result.catalogKey} must retain production delivery publications`
      )
      assert(
        result.observationMoments !== null
        && result.observationMoments.length > (result.deliveryFrames?.length ?? 0),
        `${result.catalogKey} must retain story, Delivery, and runtime observations in one chronology`
      )
    } else {
      assert(result.deliveryFrames === null, `${result.catalogKey} must not fabricate graph-level delivery frames`)
      assert(result.observationMoments === null, `${result.catalogKey} must not fabricate a Delivery runtime chronology`)
    }
  }
})

await scenario("drives Reducer Lab durable history, graph, and causal navigation from production TraceReader", () => {
  const result = everyResult.find(({ catalogKey }) => catalogKey === "authored:dependentTasksCompleteInOneRun")
  assert(result?._tag === "Completed", "The authored trace fixture must complete")
  if (result?._tag !== "Completed") return
  assert(result.traceHistories !== null && result.traceHistories.length > 0, "The Lab must retain production trace views")
  if (result.traceHistories === null) return
  const traceHistories = result.traceHistories
  assert(traceHistories.length === result.journalRecordCount, "The Lab must materialize one production view for every committed journal position")
  assert(
    traceHistories.every((history, index) =>
      history.version === 1
      && history.cursor.runId === result.runId
      && history.cursor.position === index + 1
      && history.items.every(({ identity }) => identity.runId === result.runId)
    ),
    "Trace views must retain the schema version and exact (RunId, JournalPosition) identity for every commit"
  )
  assert(result.traceHistories.some(({ graph }) => graph !== null), "The Lab must consume a production graph-at-history view")
  assert(
    result.traceHistories.some(({ relationships }) => relationships.workflowCausalEdges.length > 0),
    "The Lab must consume production-proven workflow-causal predecessors"
  )
})

await scenario("does not derive Lab workflow occurrences or causality from capture order, story position, or frame index", () => {
  const result = everyResult.find(({ catalogKey }) => catalogKey === "authored:dependentTasksCompleteInOneRun")
  assert(result?._tag === "Completed" && result.traceHistories !== null, "The production trace fixture is unavailable")
  if (result?._tag !== "Completed" || result.traceHistories === null) return
  const first = result.traceHistories[0]
  const later = result.traceHistories.at(-1)
  if (first === undefined || later === undefined) throw new Error("The production cursor fixture is empty")
  const model = makeTraceCursorSelectionModel(result.traceHistories.map(({ cursor }) => cursor), [
    auxiliaryTraceCorrelation(
      "AuthoredStoryOccurrence",
      AuthoredObservationCaptureOrder.make(9_999),
      authoredStoryPosition(9_999),
      null
    ),
    auxiliaryTraceCorrelation(
      "DeliveryRuntimeOwner",
      AuthoredObservationCaptureOrder.make(1),
      authoredStoryPosition(0),
      null
    )
  ])
  const selected = updateTraceCursorSelection(model, TraceCursorSelected.make({ cursor: first.cursor }))
  assert(projectTraceCursorSelection(selected).cursor?.position === first.cursor.position, "Selection must use the exact production cursor, not auxiliary chronology")
  assert(projectTraceCursorSelection(selected).cursor?.position !== 9_999, "Authored story position must not become a journal position")
  assert(projectTraceCursorSelection(updateTraceCursorSelection(selected, TraceCursorSelected.make({ cursor: later.cursor }))).cursor?.position === later.cursor.position, "Frame-like local values must not replace production cursor selection")
  assert(later.relationships.workflowCausalEdges.every(({ predecessorOperationId, successorOperationId }) => predecessorOperationId !== successorOperationId), "Causal edges must remain the production reader's operation identities")
})

await scenario("runs maintained application Exit stories through the production request boundary", () => {
  const idle = everyResult.find(({ catalogKey }) => catalogKey === "application-exit:idleSuccess")
  const failed = everyResult.find(({ catalogKey }) => catalogKey === "application-exit:drainFailure")
  assert(idle?._tag === "Completed", "The idle application Exit story must complete")
  assert(failed?._tag === "Completed", "The conclusive application Exit failure story must reach its declared end")
  if (idle?._tag !== "Completed" || failed?._tag !== "Completed") return
  assert(
    JSON.stringify(idle.executionEvidence).includes("RequestGracefulTermination"),
    "Idle Exit must request graceful process termination"
  )
  assert(
    JSON.stringify(failed.executionEvidence).includes("RequestForcedTermination"),
    "A conclusive drain failure must request forced process termination"
  )
  assert(
    executionSummaryItems(idle).some(({ description }) => description.includes("outside every Run journal")),
    "Application Exit evidence must not be presented as a Run-journal record"
  )
  assert(
    protocolDiagnosticItems(failed).some(({ term }) => term === "Process-end decision"),
    "Application Exit diagnostics must expose the production process-end decision"
  )
})

await scenario("runs maintained Codex executor stories through the concrete production executor", () => {
  for (const key of [
    "codex-executor:firstTurnRunning",
    "codex-executor:lostTurnResponseReconciled",
    "codex-executor:acceptedTerminal",
    "codex-executor:safelySuspended"
  ] as const) {
    const result = everyResult.find(({ catalogKey }) => catalogKey === key)
    assert(result?._tag === "Completed", `${key} must complete through the concrete executor`)
  }
  const lost = everyResult.find(({ catalogKey }) => catalogKey === "codex-executor:lostTurnResponseReconciled")
  assert(
    lost?._tag === "Completed" && JSON.stringify(lost.executionEvidence).includes('"turnStartCount":1'),
    "Lost turn response recovery must retain exactly one turn/start call"
  )
  if (lost?._tag === "Completed") {
    assert(
      executionSummaryItems(lost).some(({ description }) => description.includes("private behind the generic executor boundary")),
      "Codex-private facts must not be presented as Run-journal records"
    )
    assert(
      protocolDiagnosticItems(lost).some(({ term }) => term === "Generic executor reports"),
      "Codex diagnostics must expose only its normalized outer reports"
    )
  }
})

await scenario("captures every authored delivery frame from the real production publication and delivery composition", () => {
  const authored = everyResult.filter((result) => result._tag === "Completed" && result.category === "Authored")
  assert(authored.length === Object.keys(maintainedAuthoredCassetteCatalog).length, "Every authored catalog entry must complete")
  for (const result of authored) {
    if (result._tag !== "Completed" || result.deliveryFrames === null) continue
    assert(result.deliveryFrames[0]?.graph._tag === "NotEstablished", `${result.catalogKey} must retain the current-first production publication`)
    assert(
      result.deliveryFrames.some(({ graph }) => graph._tag === "Established"),
      `${result.catalogKey} must retain a production-established graph publication`
    )
    assert(
      result.deliveryFrames.every(({ settlements, trackerReflection }) =>
        trackerReflection._tag === "DeliveryReflection"
        && trackerReflection.settlementCount === settlements.length
      ),
      `${result.catalogKey} must retain the final tracker-reflection layer`
    )
  }
})

await scenario("shows the staggered double-diamond frontier being consumed on one graph", () => {
  const row = maintainedCassetteRows.find(({ catalogKey }) => catalogKey === "authored:deliveryInvariantStory")
  const result = everyResult.find(({ catalogKey }) => catalogKey === "authored:deliveryInvariantStory")
  assert(
    row?.storyName ===
      "accepted results settle through integration and later tracker observations consume a staggered double diamond while restart-delayed X waits for capacity",
    "The linked graph story title must name its concrete production chronology"
  )
  assert(result?._tag === "Completed" && result.deliveryFrames !== null, "The linked story must complete with frames")
  if (result?._tag !== "Completed" || result.deliveryFrames === null) return
  const frames = result.deliveryFrames
  const established = frames.filter(({ graph }) => graph._tag === "Established")
  const graph = established.find(({ graph }) => graph._tag === "Established" && graph.tasks.length === 10)?.graph
  const edges = graph?._tag === "Established"
    ? graph.tasks.flatMap(({ id, prerequisiteIds }) => prerequisiteIds.map((from) => `${from}->${id}`)).toSorted()
    : []
  const eligible = established.map(({ frontier }) => frontier
    .filter(({ standing }) => standing === "Eligible")
    .map(({ taskId }) => taskId)
    .toSorted()
    .join("+"))
  const positions = ["A", "B+C", "B+C+X", "D+X", "E+F", "H+I", "G", ""].reduce<ReadonlyArray<number>>(
    (found, wave) => [...found, eligible.indexOf(wave, (found.at(-1) ?? -1) + 1)],
    []
  )
  const heldMiddle = (frame: (typeof frames)[number]) => ["B", "C"].every((taskId) =>
      frame.heldPositions.some((position) => position.taskId === taskId)
    )
  const initial = frames.find(heldMiddle)
  const later = initial === undefined
    ? undefined
    : frames.find((frame) => frame.activationOrdinal > initial.activationOrdinal && heldMiddle(frame))
  const heldSequence = ["B+C", "C", "D+X", "X", "E+F", "F", "H+I", "I", "G"].reduce<ReadonlyArray<number>>(
    (found, tasks) => [...found, frames.findIndex((frame, index) =>
      index > (found.at(-1) ?? -1)
      && frame.heldPositions.map(({ taskId }) => taskId).toSorted().join("+") === tasks
    )],
    []
  )
  const correlations = (frame: NonNullable<typeof initial>) => frame.heldPositions
    .filter(({ taskId }) => taskId === "B" || taskId === "C")
    .map(({ attemptId, runId, taskId }) => `${taskId}:${runId}:${attemptId}`)
    .toSorted()

  assert(
    edges.join(",") === "A->B,A->C,A->X,B->D,C->D,D->E,D->F,E->H,F->I,H->G,I->G,X->G",
    "The graph must be the staggered double diamond with restart-added X"
  )
  assert(positions.every((position) => position >= 0), "The production frontier must consume every dependency wave in order")
  assert(heldSequence.every((position) => position >= 0), "The graph must expose each staggered held-position release in order")
  assert(initial !== undefined && later !== undefined, "B and C must remain held across restart")
  if (initial !== undefined && later !== undefined) {
    assert(later.heldPositions.map(({ taskId }) => taskId).toSorted().join(",") === "B,C", "The first post-restart frame with reconstructed positions must retain both middle-wave positions")
    assert(correlations(later).join(",") === correlations(initial).join(","), "A later activation must preserve both exact positions")
  }
})

await scenario("keeps a dependant blocked after executor completion until a later tracker observation", () => {
  const result = everyResult.find(({ catalogKey }) => catalogKey === "authored:dependentTasksCompleteInOneRun")
  assert(result?._tag === "Completed" && result.deliveryFrames !== null, "The dependant story must return delivery frames")
  if (result?._tag !== "Completed" || result.deliveryFrames === null) return
  const heldA = result.deliveryFrames.findIndex(({ heldPositions }) => heldPositions.some(({ taskId }) => taskId === "A"))
  const releasedButBlocked = result.deliveryFrames.findIndex((frame, index) =>
    index > heldA
    && !frame.heldPositions.some(({ taskId }) => taskId === "A")
    && frame.frontier.some(({ reasons, standing, taskId }) =>
      taskId === "B" && standing === "Excluded" && reasons.some(({ kind }) => kind === "PrerequisitesIncomplete")
    )
  )
  const dependantEligible = result.deliveryFrames.findIndex((frame, index) =>
    index > releasedButBlocked
    && frame.frontier.some(({ standing, taskId }) => taskId === "B" && standing === "Eligible")
  )
  assert(heldA >= 0, "A must visibly hold the exact task-work position")
  assert(releasedButBlocked > heldA, "B must remain blocked after A releases its process-local position")
  assert(dependantEligible > releasedButBlocked, "Only the later completed tracker graph may release B")
})

await scenario("separates desired tickets from exact held task-work positions", () => {
  const result = everyResult.find(({ catalogKey }) => catalogKey === "authored:dependentTasksCompleteInOneRun")
  assert(result?._tag === "Completed" && result.deliveryFrames !== null, "The bounded story must return delivery frames")
  if (result?._tag !== "Completed" || result.deliveryFrames === null) return
  assert(
    result.deliveryFrames.some((frame) =>
      frame.tickets.some(({ placement, taskId }) => taskId === "A" && placement.kind === "Selected")
      && !frame.heldPositions.some(({ taskId }) => taskId === "A")
    ),
    "A desired ticket must be visible before a process-local position is held"
  )
  assert(
    result.deliveryFrames.some((frame) => frame.heldPositions.some(({ taskId }) => taskId === "A")),
    "The later exact A position must remain a separate runtime fact"
  )
})

await scenario("separates delivery frames across authored coordinator activations", () => {
  const result = everyResult.find(({ catalogKey }) => catalogKey === "authored:runPauseRestartsPassively")
  assert(result?._tag === "Completed" && result.deliveryFrames !== null, "The recovery story must return delivery frames")
  if (result?._tag !== "Completed" || result.deliveryFrames === null) return
  const firstLaterActivation = result.deliveryFrames.findIndex(({ activationOrdinal }) => activationOrdinal === 2)
  assert(firstLaterActivation > 0, "Later-activation publications must follow the initial activation")
  assert(result.deliveryFrames.slice(0, firstLaterActivation).every(({ activationOrdinal }) => activationOrdinal === 1), "Activation frames must retain their boundary")
})

await scenario("keeps a paused task held until the exact safe-suspension report", () => {
  const result = everyResult.find(({ catalogKey }) => catalogKey === "authored:taskPauseLetsIndependentTaskContinue")
  assert(result?._tag === "Completed" && result.deliveryFrames !== null, "The task-pause story must return delivery frames")
  if (result?._tag !== "Completed" || result.deliveryFrames === null) return
  const safeSuspensionPosition = maintainedAuthoredCassetteCatalog.taskPauseLetsIndependentTaskContinue.story
    .findIndex((item) =>
      item._tag === "PlannedAttemptExecutorWorkReported" && item.report._tag === "SafelySuspended"
    )
  assert(safeSuspensionPosition >= 0, "The maintained pause story must declare safe suspension")
  const beforeSafeSuspension = result.deliveryFrames.find(({ storyPosition }) =>
    storyPosition === safeSuspensionPosition
  )
  const afterSafeSuspension = result.deliveryFrames.find(({ storyPosition }) =>
    storyPosition === safeSuspensionPosition + 1
  )
  assert(
    beforeSafeSuspension?.heldPositions.some(({ attemptId }) => attemptId === "attempt:A:0") === true,
    "Pause direction and a Running report must leave A holding its exact position"
  )
  assert(
    afterSafeSuspension?.heldPositions.some(({ attemptId }) => attemptId === "attempt:A:0") === false,
    "Only the exact SafelySuspended report may release A's position"
  )
})

await scenario("reports the exact authored item when production cannot complete a cassette", async () => {
  const singleton = maintainedAuthoredCassetteCatalog.singletonTaskCompletes
  const story: Array<unknown> = [...singleton.story]
  const selection = story[2]
  const graphRead = story[3]
  assert(selection !== undefined && graphRead !== undefined, "The mismatch fixture requires two story items")
  story[2] = graphRead
  story[3] = selection
  const mismatched = await runAuthoredCassetteInput("singletonTaskCompletes", { ...singleton, story })
  mismatchedResult = mismatched
  assert(mismatched._tag === "Failed", "An out-of-order boundary item must fail visibly")
  if (mismatched._tag !== "Failed") return
  assert(mismatched.location._tag === "Known", "The interaction mismatch must have a known story location")
  if (mismatched.location._tag !== "Known") return
  assert(mismatched.location.storyPosition === 2, "The failure must identify the exact zero-based cursor position")
  assert(mismatched.location.consumedItemCount === 2, "The failure must retain the actual consumed-item count")
  assert(
    mismatched.location.failedItemTag === "TrackerGraphReadReturned",
    "The failure must name the unconsumed story item"
  )
  assert(
    resultStatusText(mismatched).includes("item 3 (TrackerGraphReadReturned, index 2)"),
    "The browser status must expose human and zero-based failure positions"
  )
})

await scenario("accepts successful recovered completion at the terminal assertion boundary", async () => {
  const recovered = await runMaintainedCassette("authored:runPauseRestartsPassively")
  assert(recovered._tag === "Completed", "The maintained recovery story must complete")
  if (recovered._tag !== "Completed") return
  assert(recovered.activationOrdinals.join(",") === "1,2", "The story must execute both Run activations")
  assert(recovered.consumedItemCount === recovered.totalItemCount, "Terminal assertions must still be consumed")
})

await scenario("formats maintained cassette choices and summaries", () => {
  assert(maintainedCassetteRows.length === expectedCatalogSize, "The browser model must contain every catalog choice")
  assert(
    maintainedCassetteRows.map(({ catalogKey }) => catalogKey).join("|") === maintainedCassetteKeys.join("|"),
    "The browser model must preserve catalog order"
  )
  assert(
    maintainedCassetteRows.every(({ controlledBoundaries, runnerName }) =>
      controlledBoundaries.length > 0 && runnerName.startsWith("run")
    ),
    "Every browser choice must identify controlled boundaries and its production runner"
  )
  for (const result of everyResult) {
    assert(resultStatusText(result).includes(`${result.totalItemCount}/${result.totalItemCount}`), `${result.catalogKey} must render complete progress`)
    assert(resultEvidenceText(result).length > 2, `${result.catalogKey} must render execution evidence`)
  }
  assert(everyResult.length === maintainedCassetteRows.length, "Run all must retain one result per catalog choice")
  assert(
    runAllSummaryText(everyResult)
      === `${expectedCatalogSize} completed · 0 failed · 0 Lab defects · ${expectedCatalogSize} total`,
    "Run all must render the exact completed, failed, and total counts"
  )
})

const installDom = () => {
  const { document, window } = parseHTML('<!doctype html><html><body><main id="root"></main></body></html>')
  Object.assign(globalThis, {
    customElements: window.customElements,
    CustomEvent: window.CustomEvent,
    document,
    Event: window.Event,
    HTMLButtonElement: window.HTMLButtonElement,
    HTMLDetailsElement: window.HTMLDetailsElement,
    HTMLElement: window.HTMLElement,
    HTMLOutputElement: window.HTMLOutputElement,
    HTMLPreElement: window.HTMLPreElement
  })
  const root = document.getElementById("root")
  if (root === null) throw new Error("The browser root is missing")
  const settled = (eventName: string): Promise<void> =>
    new Promise((resolve) => root.addEventListener(eventName, () => resolve(), { once: true }))
  return { document, root, settled }
}

const resultByKey = new Map(everyResult.map((result) => [result.catalogKey, result]))
const cannedRunner = async (catalogKey: (typeof maintainedCassetteKeys)[number]) => {
  const result = resultByKey.get(catalogKey)
  if (result === undefined) throw new Error(`Missing real production result for ${catalogKey}`)
  return result
}

const chooseOption = (select: HTMLSelectElement, value: string): void => {
  for (const option of select.options) {
    if (option.value === value) option.setAttribute("selected", "")
    else option.removeAttribute("selected")
  }
  select.dispatchEvent(new Event("change"))
}

const chooseCassette = (search: HTMLInputElement, value: string): void => {
  search.value = value
  search.dispatchEvent(new Event("input"))
}

await scenario("shows only information that selects, explains, or diagnoses a maintained cassette", () => {
  const { document, root } = installDom()
  mountCassetteLab({ revision: "acceptance-revision+dirty", root, rows: maintainedCassetteRows, runCassette: cannedRunner })
  assert(document.title === "Dalph reducer lab", "The tab title must name the reducer Lab")
  assert(
    document.querySelector("[data-role='safety-context']")?.textContent?.includes("no GitHub issue, Git repository, executor process, or durable journal is changed") === true,
    "The Lab must state the concrete safety boundary"
  )
  assert(document.querySelector("[data-role='source-revision']")?.textContent?.includes("acceptance-revision+dirty") === true, "The Lab must identify its source revision")
  assert(
    document.querySelector("article [data-role='execution-evidence']") === null,
    "An unrun cassette must not expose an empty evidence panel"
  )
  assert(document.querySelectorAll("[data-role='selected-cassette-surface']").length === 1, "The Lab must expose one shared cassette surface")
  assert(document.querySelectorAll("article").length === 1, "Only the selected cassette may render a complete UI")
  assert(document.querySelectorAll("[data-role='cassette-options'] option").length === expectedCatalogSize, "Search suggestions must retain every catalog choice")
  const first = document.querySelector("article")
  assert(first?.querySelector("h2")?.textContent === maintainedCassetteRows[0]?.storyName, "The human story name must be primary")
  assert(first?.querySelector("h2")?.textContent?.includes("authored:") === false, "The prefixed key must not duplicate category in the heading")
  assert(first?.querySelector(".catalog-key")?.textContent?.includes("authored:") === true, "The selected cassette must retain its exact lookup key")
  const groupFacts = document.querySelector(".group-facts")?.textContent ?? ""
  assert(groupFacts.includes("Production runner") && groupFacts.includes("Available controlled boundaries"), "Catalog-level facts must explain execution and safety once without claiming every available boundary is exercised")
  assert(first?.querySelector("[data-role='declared-chronology']")?.textContent?.includes("not observed execution evidence") === true, "Declared input must be labelled separately from observed output")
  assert(document.querySelectorAll("[data-role='exact-declared-input'] pre").length === 1, "Only the selected cassette's exact input may be visible")
  assert(document.querySelector("[data-role='completion-legend']")?.textContent?.includes("matched the declared end") === true, "Completion must not imply that the modeled operation succeeded")
  assert(document.querySelectorAll("input[data-role='cassette-selector']").length === 1, "One searchable cassette control must own catalog selection")
})

await scenario("uses one shared cassette surface and replaces it when selection changes", async () => {
  const { document, root, settled } = installDom()
  mountCassetteLab({ revision: "acceptance-revision", root, rows: maintainedCassetteRows, runCassette: cannedRunner })
  const selector = document.querySelector("[data-role='cassette-selector']") as HTMLInputElement | null
  const first = maintainedCassetteRows[0]
  const direct = maintainedCassetteRows.find(({ category }) => category === "TargetPromotion")
  if (selector === null || first === undefined || direct === undefined) throw new Error("The replacement fixture is incomplete")
  assert(document.querySelector("article")?.dataset.catalogKey === first.catalogKey, "The first admitted choice must own the shared surface")
  assert(document.querySelectorAll("[data-role='delivery-workbench']").length === 1, "An authored selection may own one graph workbench")
  chooseCassette(selector, direct.catalogKey)
  assert(document.querySelectorAll("article").length === 1, "Changing selection must not append a second cassette UI")
  assert(document.querySelector("article")?.dataset.catalogKey === direct.catalogKey, "The new choice must replace the old cassette identity")
  assert(document.querySelector("article")?.textContent?.includes(first.storyName) === false, "No prior cassette content may remain visible")
  assert(document.querySelectorAll("[data-role='declared-chronology']").length === 1, "The shared surface must retain only the new chronology")
  assert(document.querySelector("[data-role='delivery-workbench']") === null, "A direct protocol choice must replace the authored graph workbench")
  assert(document.querySelectorAll("article .selected-cassette-controls button").length === 1, "The shared surface must expose one selected-cassette action")
  chooseCassette(selector, first.catalogKey)
  const completed = settled(singleCassetteSettledEvent)
  ;(document.querySelector("article .selected-cassette-controls button") as HTMLButtonElement | null)?.click()
  await completed
  assert(document.querySelector("article")?.dataset.state === "Completed", "The selected cassette must expose its retained terminal state")
  chooseCassette(selector, direct.catalogKey)
  chooseCassette(selector, first.catalogKey)
  assert(document.querySelector("article")?.dataset.state === "Completed", "Returning to a completed choice must restore its retained result")
  assert(document.querySelectorAll("[data-role='execution-evidence']").length === 1, "Restored evidence must remain confined to the shared surface")
})

await scenario("keeps one permanent delivery workbench stable while frames and selections change", async () => {
  const { document, root, settled } = installDom()
  const row = maintainedCassetteRows.find(({ catalogKey }) => catalogKey === "authored:dependentTasksCompleteInOneRun")
  if (row === undefined) throw new Error("The delivery-navigation fixture is missing")
  mountCassetteLab({ revision: "acceptance-revision", root, rows: maintainedCassetteRows, runCassette: cannedRunner })
  const selector = document.querySelector("[data-role='cassette-selector']") as HTMLInputElement | null
  const selectorLabel = selector?.closest("label")
  if (selector === null) throw new Error("The cassette selector is missing")
  assert(selectorLabel?.textContent?.includes(`Find cassette by ID or title(${expectedCatalogSize} available)`) === true, "The search control must clearly state its matching fields and available choice count")
  const cassetteOptions = [...document.querySelectorAll<HTMLOptionElement>("[data-role='cassette-options'] option")]
  const malformedOptions = cassetteOptions.filter((option) => {
    const choice = maintainedCassetteRows.find(({ catalogKey }) => option.value === catalogKey)
    return choice === undefined
      || !(option.label.startsWith(choice.storyName)
        && option.label.includes(choice.categoryLabel)
        && option.value === choice.catalogKey)
  })
  assert(malformedOptions.length === 0, `Every search suggestion must expose title, owning catalog, status, and exact ID: ${malformedOptions[0]?.outerHTML ?? "unknown"}`)
  const visibleOptionLabels = cassetteOptions.map(({ label }) => label)
  assert(
    new Set(visibleOptionLabels).size === visibleOptionLabels.length,
    "Every collapsed cassette option label must identify one unique maintained scenario"
  )
  chooseCassette(selector, row.catalogKey)
  assert(
    document.querySelector("[data-role='delivery-workbench'] > .selected-cassette-controls button") !== null,
    "An authored cassette Run/Rerun action must live inside its delivery workbench"
  )
  assert(
    document.querySelector("[data-role='delivery-workbench'] > .delivery-capacity-note")?.textContent === "Desired tickets are not held capacity.",
    "The desired-ticket and held-capacity distinction must remain visible before production runs"
  )
  const completed = settled(singleCassetteSettledEvent)
  ;(document.querySelector("article .selected-cassette-controls button") as HTMLButtonElement | null)?.click()
  await completed
  const workbench = document.querySelector<HTMLElement>("[data-role='delivery-workbench']")
  if (workbench === null) throw new Error("The completed delivery workbench is missing")
  assert(workbench.tagName === "SECTION", "The primary delivery workbench must be a permanent section, not a disclosure")
  assert(workbench.querySelector(":scope > summary") === null, "The primary visualization must not hide behind an accordion control")
  const readingGuide = workbench.querySelector<HTMLDetailsElement>(".delivery-reading-guide")
  assert(readingGuide?.hasAttribute("open") === false, "The explanatory delivery manual must be collapsed by default")
  assert(readingGuide?.querySelector(".delivery-provenance") !== null, "The collapsed delivery manual must retain production provenance")
  assert(readingGuide?.querySelector(".delivery-layer-chain") !== null, "The collapsed delivery manual must retain the production layer chain")
  assert(readingGuide?.querySelector(".delivery-graph-legend") !== null, "The collapsed delivery manual must retain the graph legend")
  const descendants = [...workbench.querySelectorAll("*")]
  assert(
    descendants.indexOf(workbench.querySelector(".delivery-timeline-controls")!) < descendants.indexOf(readingGuide!),
    "Playback controls must precede the explanatory delivery manual"
  )
  assert(
    descendants.indexOf(workbench.querySelector("dalph-delivery-graph")!) < descendants.indexOf(readingGuide!),
    "The primary graph must precede the explanatory delivery manual"
  )
  assert(
    workbench.querySelector(".delivery-playback-shortcuts")?.textContent === "Moment = one captured story, Delivery, or runtime observation · Jump = frontier, held positions, restart, or terminal landmark · Live = follow newest · Keys: ←/→ and [/].",
    "Visible playback help must distinguish adjacent moments, delivery landmarks, and live following"
  )
  const status = workbench.querySelector(".delivery-timeline-controls output")
  const next = workbench.querySelector<HTMLButtonElement>("button[data-role='next-frame']")
  const previous = workbench.querySelector<HTMLButtonElement>("button[data-role='previous-frame']")
  const total = Number(status?.textContent?.match(/\/ (\d+)/u)?.[1])
  assert(status?.textContent?.startsWith(`${total} / `) === true, "A completed followed timeline must remain on its newest production publication")
  previous?.click()
  assert(status?.textContent?.startsWith(`${total - 1} / `) === true, "Previous frame must rewind the visible timeline")
  const graph = workbench.querySelector("dalph-delivery-graph")
  graph?.dispatchEvent(new CustomEvent("task-selected", { detail: { taskId: "A" } }))
  assert(workbench.querySelector("[data-role='selected-task-facts']")?.textContent?.startsWith("Selected task A") === true, "The selected task must be retained with the frame playback state")
  next?.click()
  assert(status?.textContent?.startsWith(`${total} / `) === true, "Next frame must navigate forward without replacing the workbench")
  chooseCassette(selector, maintainedCassetteRows.find(({ category }) => category === "TargetPromotion")!.catalogKey)
  chooseCassette(selector, row.catalogKey)
  const restored = document.querySelector<HTMLElement>("[data-role='delivery-workbench']")
  assert(restored !== workbench, "Selecting another cassette must replace the old cassette surface")
  assert(restored?.querySelector(".delivery-timeline-controls output")?.textContent?.startsWith(`${total} / `) === true, "Returning to a cassette must restore its retained frame selection")
  assert(restored?.querySelector("[data-role='selected-task-facts']")?.textContent?.startsWith("Selected task A") === true, "Returning to a cassette must restore its retained task selection")
})

await scenario("shows production delivery frames before the authored cassette settles", async () => {
  const { document, root, settled } = installDom()
  const row = maintainedCassetteRows.find(({ catalogKey }) => catalogKey === "authored:dependentTasksCompleteInOneRun")
  const result = row === undefined ? undefined : resultByKey.get(row.catalogKey)
  if (
    row === undefined
    || result?._tag !== "Completed"
    || result.observationMoments === null
  ) {
    throw new Error("The live delivery fixture is incomplete")
  }
  const publicationMoments = result.observationMoments.filter((moment) => moment._tag === "DeliveryPublicationMoment")
  if (publicationMoments.length < 3) throw new Error("The live delivery fixture has too few publications")
  let finish: (() => void) | undefined
  let observer: CassetteRunObserver | undefined
  mountCassetteLab({
    revision: "acceptance-revision",
    root,
    rows: [row],
    runCassette: async (_key, nextObserver) => {
      observer = nextObserver
      await new Promise<void>((resolve) => { finish = resolve })
      return result
    }
  })
  const terminal = settled(singleCassetteSettledEvent)
  ;(document.querySelector("article .selected-cassette-controls button") as HTMLButtonElement | null)?.click()
  const article = document.querySelector("article")
  const permanentWorkbench = document.querySelector("[data-role='delivery-workbench']")
  const chronology = document.querySelector<HTMLDetailsElement>("[data-role='declared-chronology']")
  chronology?.setAttribute("open", "")
  observer?.onObservationMoment?.(publicationMoments[0]!)
  const workbench = document.querySelector<HTMLElement>("[data-role='delivery-workbench']")
  const timeline = workbench?.querySelector(".delivery-timeline-controls")
  const frameHost = workbench?.querySelector("[data-role='delivery-frame']")
  assert(document.querySelector("article")?.dataset.state === "Running", "A real delivery frame must be visible while the cassette is still running")
  assert(document.querySelector("article") === article && workbench === permanentWorkbench, "Starting production and receiving its first frame must not remount the selected cassette or permanent workbench")
  assert(workbench?.querySelectorAll(".delivery-timeline-controls option").length === 1, "The first live publication must create one frame before terminal settlement")
  observer?.onObservationMoment?.(publicationMoments[1]!)
  const status = workbench?.querySelector(".delivery-timeline-controls output")
  assert(status?.textContent?.startsWith("2 / 2") === true, "Follow live must advance to the newest running frame")
  const previous = workbench?.querySelector<HTMLButtonElement>("button[data-role='previous-frame']")
  previous?.click()
  const inspectedFrame = workbench?.querySelector("[data-role='delivery-frame']")
  const exactEvidence = inspectedFrame?.querySelector<HTMLDetailsElement>("details[data-role='all-task-facts']")
  exactEvidence?.setAttribute("open", "")
  observer?.onObservationMoment?.(publicationMoments[2]!)
  assert(status?.textContent?.startsWith("1 / 3") === true, "A rewound playhead must not move when another production frame arrives")
  assert(workbench?.querySelector(".delivery-timeline-controls") === timeline, "Appending a live frame must keep the same timeline controls mounted")
  assert(workbench?.querySelector("[data-role='delivery-frame']") === frameHost && inspectedFrame === frameHost, "Appending a live frame while paused must keep the inspected frame DOM mounted")
  assert(exactEvidence?.isConnected === true && exactEvidence.hasAttribute("open"), "Appending a live frame while paused must preserve an open exact-evidence disclosure")
  assert(chronology?.hasAttribute("open") === true, "Live publications must not close the declared chronology")
  finish?.()
  await terminal
  assert(document.querySelector("article") === article && document.querySelector("[data-role='delivery-workbench']") === workbench, "Terminal settlement must not remount the selected cassette or workbench")
  assert(workbench?.querySelector("[data-role='delivery-frame']") === frameHost && exactEvidence?.isConnected === true && exactEvidence.hasAttribute("open"), "Terminal settlement must preserve the paused frame and its disclosure state")
  const follow = workbench?.querySelector<HTMLButtonElement>("[data-role='follow-live']")
  follow?.click()
  const terminalStatus = workbench?.querySelector(".delivery-timeline-controls output")
  assert(terminalStatus?.textContent?.startsWith(`${result.observationMoments.length} / ${result.observationMoments.length}`) === true, "Follow live must move to the retained newest terminal moment")
  assert(document.querySelector("[data-role='journal-evidence']")?.hasAttribute("open") === false, "Terminal journal evidence must remain collapsed")
})

await scenario("shows an authored cassette declared graph only as input before production observes it", () => {
  const { document, root } = installDom()
  mountCassetteLab({ revision: "acceptance-revision", root, rows: maintainedCassetteRows, runCassette: cannedRunner })
  assert(document.querySelectorAll("[data-role='delivery-workbench']").length === 1, "The selected authored cassette must expose one delivery workbench")
  assert(document.querySelector("[data-role='delivery-frame']") === null, "Declared input must not become an observed delivery frame")
  const closed = document.querySelector<HTMLElement>("[data-role='delivery-workbench']")
  if (closed === null) throw new Error("The authored workbench is missing")
  assert(closed.tagName === "SECTION", "The pre-run graph must already occupy the permanent workbench")
  const first = document.querySelector("[data-role='delivery-workbench']")
  assert(first?.textContent?.includes("not yet observed") === true, "Derived delivery facts must remain explicitly unobserved")
  const graph = first?.querySelector("dalph-delivery-graph") as (HTMLElement & { projection?: { readonly key: string } }) | null
  assert(graph?.projection?.key.startsWith("declared:") === true, "The pre-run graph must identify itself as controlled declared input")
})

await scenario("shows the production-observed graph frontier bounded tickets and held positions", async () => {
  const { document, root, settled } = installDom()
  const row = maintainedCassetteRows.find(({ catalogKey }) => catalogKey === "authored:dependentTasksCompleteInOneRun")
  if (row === undefined) throw new Error("The dependant delivery row is missing")
  mountCassetteLab({ revision: "acceptance-revision", root, rows: [row], runCassette: cannedRunner })
  const done = settled(singleCassetteSettledEvent)
  ;(document.querySelector("article .selected-cassette-controls button") as HTMLButtonElement | null)?.click()
  await done
  const workbench = document.querySelector("[data-role='delivery-workbench']")
  const result = resultByKey.get(row.catalogKey)
  if (result?._tag !== "Completed" || result.deliveryFrames === null) throw new Error("The real delivery frames are missing")
  const establishedIndex = result.deliveryFrames.findIndex((frame) =>
    frame.graph._tag === "Established"
    && frame.heldPositions.some(({ attemptId }) => attemptId === "attempt:A:0")
  )
  const establishedMomentIndex = deliveryMomentIndex(result, establishedIndex)
  const timeline = workbench?.querySelector(".delivery-timeline-controls select") as HTMLSelectElement | null
  if (timeline === null || establishedIndex < 0) throw new Error("The production delivery timeline is missing")
  for (const option of timeline.options) {
    if (option.value === String(establishedMomentIndex)) option.setAttribute("selected", "")
    else option.removeAttribute("selected")
  }
  timeline.dispatchEvent(new Event("change"))
  const graph = workbench?.querySelector("dalph-delivery-graph") as (HTMLElement & {
    projection?: { readonly key: string; readonly tasks: ReadonlyArray<{ readonly id: string }> }
  }) | null
  assert(graph?.projection?.key.startsWith("observed:") === true, "The selected graph must come from a production delivery frame")
  assert(graph?.projection?.tasks.some(({ id }) => id === "A") === true, "The observed graph must render its production tasks")
  assert(graph?.projection?.tasks.every((task) => !("title" in task)) === true, "Observed graph nodes must not borrow declared task text")
  const stateTable = workbench?.querySelector("[data-role='delivery-task-state']")
  assert(stateTable?.textContent?.includes("PrerequisitesIncomplete") === true, "The exhaustive frontier must explain B's exclusion")
  assert(stateTable?.textContent?.includes("prerequisiteTaskIds") === true, "The exact frontier exclusion must retain its prerequisite payload")
  assert(stateTable?.textContent?.includes("Selected #0") === true, "The bounded ticket placement must be visible")
  assert(workbench?.textContent?.includes("tracker reflection") === true, "The workbench must expose the complete production layer chain")
  const headers = [...stateTable?.querySelectorAll("th") ?? []].map(({ textContent }) => textContent)
  assert(headers.includes("Desired bounded ticket") && headers.includes("Actual held position"), "Desired tickets and exact held positions must have distinct columns")
  assert(headers.includes("Ticket-delivery evidence / standing / obligation"), "Every ticket-delivery layer must remain visible")
  assert(
    [...workbench?.querySelectorAll("[data-role='delivery-frame'] pre") ?? []].some(({ textContent }) =>
      textContent?.includes("attempt:A:0")
    ),
    "Exact responsibility evidence must retain its attempt correlation"
  )
  assert(workbench?.querySelector(".delivery-frame-change")?.textContent?.includes("held positions changed for A") === true, "The selected frame must explain its change from the prior publication")
  graph?.dispatchEvent(new CustomEvent("task-selected", { detail: { taskId: "A" } }))
  assert(workbench?.querySelector("tr[data-task-id='A']")?.classList.contains("selected-task-row") === true, "Graph task selection must highlight the matching exact task row")
  workbench?.querySelector<HTMLButtonElement>("button[data-role='next-frame']")?.click()
  assert(workbench?.querySelector("tr[data-task-id='A']")?.getAttribute("aria-current") === "true", "Task selection must remain synchronized across frame navigation")

})

await scenario("selects exact production cursors for Lab back/forward history while keeping authored/runtime moments auxiliary", async () => {
  const { document, root, settled } = installDom()
  const row = maintainedCassetteRows.find(({ catalogKey }) => catalogKey === "authored:dependentTasksCompleteInOneRun")
  const result = row === undefined ? undefined : resultByKey.get(row.catalogKey)
  if (row === undefined || result?._tag !== "Completed" || result.traceHistories === null) {
    throw new Error("The production trace fixture is missing")
  }
  const done = settled(singleCassetteSettledEvent)
  mountCassetteLab({ revision: "acceptance-revision", root, rows: [row], runCassette: cannedRunner })
  ;(document.querySelector("article .selected-cassette-controls button") as HTMLButtonElement | null)?.click()
  await done
  const workbench = document.querySelector<HTMLElement>("[data-role='delivery-workbench']")
  const panel = workbench?.querySelector<HTMLElement>("[data-role='trace-history']")
  if (panel === undefined || panel === null) throw new Error("The production trace history panel is missing")
  assert(panel.textContent?.includes("production TraceReader") === true, "The Lab must name the production trace reader")
  assert(panel.querySelectorAll("[data-role='trace-cursor-selector'] option").length === result.traceHistories.length, "Every committed position must be selectable")
  assert(panel.querySelector("[data-role='trace-auxiliary-chronology']") !== null, "Authored/runtime chronology must be visibly auxiliary")

  const graphIndex = result.traceHistories.findIndex((history) =>
    history.graph !== null && history.relationships.workflowCausalEdges.length > 0
  )
  if (graphIndex < 0) throw new Error("The trace fixture has no graph and causal history cursor")
  const traceSelector = panel.querySelector<HTMLSelectElement>("[data-role='trace-cursor-selector']")
  if (traceSelector === null) throw new Error("The exact production cursor selector is missing")
  chooseOption(traceSelector, String(graphIndex))
  const graphHistory = result.traceHistories[graphIndex]
  if (graphHistory === undefined || graphHistory.graph === null) throw new Error("The selected graph cursor disappeared")
  const selectedCursor = panel.querySelector<HTMLElement>("[data-role='trace-cursor']")
  assert(selectedCursor?.dataset.runId === String(graphHistory.cursor.runId), "Selection must retain the production RunId")
  assert(selectedCursor?.dataset.journalPosition === String(graphHistory.cursor.position), "Selection must retain the exact JournalPosition")
  assert(panel.querySelector("[data-role='trace-graph']")?.textContent?.includes(String(graphHistory.graph.observation.recordedAt)) === true, "Graph display must come from the selected production history view")
  const causal = graphHistory.relationships.workflowCausalEdges[0]
  assert(causal !== undefined && panel.querySelector("[data-role='trace-causal-edges']")?.textContent?.includes(causal.predecessorOperationId) === true, "Causal navigation must display production predecessor evidence")
  const predecessorItem = causal === undefined
    ? undefined
    : graphHistory.items.find((item) => item.operationIds.includes(causal.predecessorOperationId))
  assert(predecessorItem !== undefined, "The production predecessor operation must be projected to an exact history item")
  const predecessorButton = panel.querySelector<HTMLButtonElement>("[data-role='trace-causal-predecessor']")
  predecessorButton?.click()
  assert(
    panel.querySelector<HTMLElement>("[data-role='trace-cursor']")?.dataset.journalPosition === String(predecessorItem?.identity.position),
    "Causal predecessor navigation must select the predecessor item's exact JournalPosition"
  )

  const latestIndex = result.traceHistories.length - 1
  chooseOption(traceSelector, String(latestIndex))
  assert(panel.querySelector<HTMLElement>("[data-role='trace-cursor']")?.dataset.journalPosition === String(result.traceHistories[latestIndex]?.cursor.position), "The selector must move to the exact latest production cursor")
  panel.querySelector<HTMLButtonElement>("button[data-role='trace-previous-cursor']")?.click()
  assert(panel.querySelector<HTMLElement>("[data-role='trace-cursor']")?.dataset.journalPosition === String(result.traceHistories[latestIndex - 1]?.cursor.position), "Back must select the preceding production cursor")
  panel.querySelector<HTMLButtonElement>("button[data-role='trace-next-cursor']")?.click()
  assert(panel.querySelector<HTMLElement>("[data-role='trace-cursor']")?.dataset.journalPosition === String(result.traceHistories[latestIndex]?.cursor.position), "Forward must restore the exact later production cursor")
})

await scenario("fails visibly when a displayed production predecessor is not projected", async () => {
  const { document, root, settled } = installDom()
  const row = maintainedCassetteRows.find(({ catalogKey }) => catalogKey === "authored:dependentTasksCompleteInOneRun")
  const result = row === undefined ? undefined : resultByKey.get(row.catalogKey)
  if (row === undefined || result?._tag !== "Completed" || result.traceHistories === null) {
    throw new Error("The production causal fixture is missing")
  }
  const graphIndex = result.traceHistories.findIndex((history) => history.relationships.workflowCausalEdges.length > 0)
  if (graphIndex < 0) throw new Error("The production causal fixture has no edge")
  const malformedResult = {
    ...result,
    traceHistories: result.traceHistories.map((history, index) => index === graphIndex ? { ...history, items: [] } : history)
  }
  mountCassetteLab({
    revision: "acceptance-revision",
    root,
    rows: [row],
    runCassette: async () => malformedResult
  })
  const done = settled(singleCassetteSettledEvent)
  ;(document.querySelector("article .selected-cassette-controls button") as HTMLButtonElement | null)?.click()
  await done
  const panel = document.querySelector<HTMLElement>("[data-role='trace-history']")
  const traceSelector = panel?.querySelector<HTMLSelectElement>("[data-role='trace-cursor-selector']")
  if (panel === null || panel === undefined || traceSelector === null || traceSelector === undefined) {
    throw new Error("The malformed production trace panel is missing")
  }
  chooseOption(traceSelector, String(graphIndex))
  panel.querySelector<HTMLButtonElement>("[data-role='trace-causal-predecessor']")?.click()
  assert(panel.querySelector("[data-role='trace-causal-navigation-error']")?.textContent?.includes("PredecessorNotProjected") === true, "A missing projected predecessor must fail visibly")
})

await scenario("shows represented and off-graph responsibilities without inventing tracker nodes", async () => {
  const { document, root, settled } = installDom()
  const row = maintainedCassetteRows.find(({ catalogKey }) => catalogKey === "authored:deliveryInvariantStory")
  const result = row === undefined ? undefined : resultByKey.get(row.catalogKey)
  if (row === undefined || result?._tag !== "Completed" || result.deliveryFrames === null) {
    throw new Error("The staggered delivery story is missing")
  }
  mountCassetteLab({ revision: "acceptance-revision", root, rows: [row], runCassette: cannedRunner })
  assert(
    document.querySelector(".delivery-story-scope")?.textContent?.includes(
      "one outer Integrator session"
    ) === true,
    "The Lab must present the maintained graph chronology with its outer Integrator evidence"
  )
  const done = settled(singleCassetteSettledEvent)
  ;(document.querySelector("article .selected-cassette-controls button") as HTMLButtonElement | null)?.click()
  await done
  const select = document.querySelector<HTMLSelectElement>(".delivery-timeline-controls select")
  if (select === null) throw new Error("The delivery timeline is missing")
  const selectFrame = (index: number): void => {
    for (const option of select.options) {
      if (option.value === String(index)) option.setAttribute("selected", "")
      else option.removeAttribute("selected")
    }
    select.dispatchEvent(new Event("change"))
  }
  const beforeRestart = result.deliveryFrames.find((frame) =>
    frame.heldPositions.map(({ taskId }) => taskId).toSorted().join(",") === "B,C"
  )
  const restartIndex = beforeRestart === undefined
    ? -1
    : result.deliveryFrames.findIndex((frame) =>
        frame.activationOrdinal > beforeRestart.activationOrdinal
        && frame.graph._tag === "NotEstablished"
        && frame.heldPositions.map(({ taskId }) => taskId).toSorted().join(",") === "B,C"
      )
  if (restartIndex < 0) throw new Error("The restart frame with reconstructed B/C positions is missing")
  selectFrame(deliveryMomentIndex(result, restartIndex))
  const capacity = document.querySelector("[data-role='delivery-capacity-positions']")
  const rail = document.querySelector("[data-role='delivery-off-graph-responsibilities']")
  assert(capacity?.textContent?.includes("2 held of capacity 2") === true, "The capacity strip must show both reconstructed positions")
  assert(capacity?.textContent?.includes("B · attempt:B:0") === true, "The capacity strip must correlate B's exact attempt")
  assert(capacity?.textContent?.includes("C · attempt:C:1") === true, "The capacity strip must correlate C's exact attempt")
  assert(capacity?.textContent?.toLowerCase().includes("anonymous") === true, "The capacity strip must not invent durable slot identities")
  assert(rail?.textContent?.includes("B") === true && rail.textContent.includes("C"), "The off-graph rail must retain both responsibilities")
  assert(rail?.textContent?.includes("graph not established") === true, "The rail must explain why the responsibilities are outside the graph")
  assert(rail?.textContent?.includes(`Run ${result.runId}`) === true, "The rail must retain the exact Run correlation")
  assert(rail?.textContent?.includes("placement GraphNotEstablished") === true, "The rail must name the exact delivery placement")
  assert(rail?.textContent?.includes("planned-attempt executor responsibility") === true, "The rail must name the retained obligation")
  assert(rail?.textContent?.includes("occupies capacity") === true, "The rail must state whether the responsibility holds capacity")

  const staggeredIndex = result.deliveryFrames.findIndex((frame) =>
    frame.graph._tag === "Established"
    && frame.heldPositions.map(({ taskId }) => taskId).join(",") === "C"
  )
  if (staggeredIndex < 0) throw new Error("The staggered C-only frame is missing")
  selectFrame(deliveryMomentIndex(result, staggeredIndex))
  const representedCapacity = document.querySelector("[data-role='delivery-capacity-positions']")
  assert(representedCapacity?.textContent?.includes("1 held of capacity 2") === true, "One released position must be visible before C finishes")
  assert(representedCapacity?.textContent?.includes("1 unheld position") === true, "Released capacity must remain anonymous and visible")
  assert(representedCapacity?.textContent?.includes("capacity, not permission") === true, "Unheld capacity must not imply that eligible work is already admitted")
  assert(document.querySelector("[data-role='delivery-off-graph-responsibilities']") === null, "Graph-represented responsibilities must stay on their graph nodes")
})

await scenario("shows an absent responsibility in the mismatch rail without inventing a graph node", async () => {
  const { document, root, settled } = installDom()
  const row = maintainedCassetteRows.find(({ catalogKey }) => catalogKey === "authored:deliveryInvariantStory")
  const result = row === undefined ? undefined : resultByKey.get(row.catalogKey)
  if (row === undefined || result?._tag !== "Completed" || result.deliveryFrames === null) {
    throw new Error("The staggered delivery story is missing")
  }
  const heldFrame = result.deliveryFrames.find((frame) =>
    frame.graph._tag === "NotEstablished"
    && frame.heldPositions.some(({ taskId }) => taskId === "B")
  )
  const establishedFrame = result.deliveryFrames.find((frame) => frame.graph._tag === "Established")
  if (heldFrame === undefined || establishedFrame?.graph._tag !== "Established") {
    throw new Error("The exact responsibility and established graph fixtures are missing")
  }
  const establishedGraph = establishedFrame.graph
  const absentFrame = {
    ...heldFrame,
    deliveries: heldFrame.deliveries.map((delivery) =>
      delivery.taskId === "B"
        ? {
            ...delivery,
            placement: {
              exact: JSON.stringify({ _tag: "AbsentFromCurrentGraph", graphRevision: establishedGraph.revision }),
              kind: "AbsentFromCurrentGraph"
            }
          }
        : delivery
    ),
    graph: { ...establishedGraph, tasks: [] }
  }
  const sourceMoment = result.observationMoments?.find((moment) =>
    moment._tag === "DeliveryPublicationMoment" && moment.deliveryFrame === heldFrame
  )
  if (sourceMoment === undefined) throw new Error("The exact responsibility moment is missing")
  const absentResult = {
    ...result,
    deliveryFrames: [absentFrame],
    observationMoments: [{ ...sourceMoment, deliveryFrame: absentFrame }]
  }
  mountCassetteLab({
    revision: "acceptance-revision",
    root,
    rows: [row],
    runCassette: async () => absentResult
  })
  const done = settled(singleCassetteSettledEvent)
  ;(document.querySelector("article .selected-cassette-controls button") as HTMLButtonElement | null)?.click()
  await done
  const graph = document.querySelector("dalph-delivery-graph") as (HTMLElement & {
    projection?: { readonly tasks: ReadonlyArray<{ readonly id: string }> }
  }) | null
  const rail = document.querySelector("[data-role='delivery-off-graph-responsibilities']")
  assert(graph?.projection?.tasks.some(({ id }) => id === "B") === false, "An absent responsibility must not become a topology node")
  assert(rail?.textContent?.includes("Task B · absent from current tracker graph") === true, "The rail must explain the exact graph mismatch")
  assert(rail?.textContent?.includes("placement AbsentFromCurrentGraph") === true, "The rail must retain the production placement kind")
  assert(rail?.textContent?.includes(`Run ${result.runId}`) === true, "The absent responsibility must retain its exact Run")
})

await scenario("does not fabricate delivery visualization for direct protocol cassettes", () => {
  const { document, root } = installDom()
  const protocolRows = maintainedCassetteRows.filter(({ category }) => category !== "Authored")
  mountCassetteLab({ revision: "acceptance-revision", root, rows: protocolRows, runCassette: cannedRunner })
  assert(document.querySelector("[data-role='delivery-workbench']") === null, "Direct protocol runners must not display invented graph-level delivery state")
  assert(document.querySelector(".group-facts")?.textContent?.includes("does not publish the graph-level delivery relation") === true, "The direct protocol group must explain why no graph workbench applies")
})

await scenario("renders the prototype source instrument beside its synchronized graph", async () => {
  const row = maintainedCassetteRows.find(({ catalogKey }) => catalogKey === "authored:deliveryInvariantStory")
  const result = everyResult.find(({ catalogKey }) => catalogKey === "authored:deliveryInvariantStory")
  if (row === undefined) throw new Error("The prototype cassette is missing from the maintained catalog")
  if (result?._tag !== "Completed" || result.observationMoments === null) throw new Error("The prototype cassette observations are missing")
  const { document, root, settled } = installDom()
  mountCassetteLab({ revision: "acceptance-revision", root, rows: [row], runCassette: cannedRunner })
  const done = settled(singleCassetteSettledEvent)
  ;(document.querySelector("article .selected-cassette-controls button") as HTMLButtonElement | null)?.click()
  await done

  const instrument = document.querySelector(".delivery-instrument-layout")
  const codeWindow = instrument?.querySelector(".delivery-code-window")
  const graphCanvas = instrument?.querySelector(".delivery-graph-canvas")
  assert(instrument !== null, "The source and graph must share the prototype instrument layout")
  assert(codeWindow?.textContent?.includes("export const delivery = Effect.gen(function* () {") === true, "The source panel must show the prototype production-shaped opening")
  assert(codeWindow?.textContent?.includes("const trackerGraph = yield* TrackerGraphRelation") === true, "The source panel must show relation acquisition as one literal setup line")
  assert(codeWindow?.textContent?.includes("const responsibilities = yield* executorResponsibilities(tickets)") === true, "The source panel must retain the prototype responsibility composition")
  assert(codeWindow?.textContent?.includes("return yield* reflectDeliverySettlements(settlements)") === true, "The source panel must show the production-shaped reflection boundary")
  assert(codeWindow?.querySelector(".delivery-syntax-keyword") !== null && codeWindow?.querySelector(".delivery-syntax-call") !== null, "The copied code window must retain source-token treatment")
  assert(codeWindow?.querySelectorAll("[data-source-stage] .delivery-code-gutter").length === 7, "Every prototype source stage must retain its gutter/change marker")
  assert(codeWindow?.querySelectorAll("[data-source-stage] .delivery-data-rectangle").length !== 0, "Typed live data rectangles must remain visible beside source lines")
  assert(graphCanvas?.querySelector("dalph-delivery-graph") !== null, "The synchronized Delivery graph must live inside the prototype dotted canvas")
  assert(instrument?.querySelectorAll(":scope > .delivery-instrument").length === 2, "The source and graph must be peer instrument panels")
  const timeline = document.querySelector<HTMLSelectElement>(".delivery-timeline-controls select")
  if (timeline === null) throw new Error("The prototype cassette timeline is missing")
  const publicationIndex = result.observationMoments.findIndex(({ _tag }) => _tag === "DeliveryPublicationMoment")
  const retainedIndex = result.observationMoments.findIndex((moment) => moment._tag !== "DeliveryPublicationMoment" && moment.deliveryFrame !== null)
  chooseOption(timeline, String(publicationIndex))
  assert(document.querySelector(".delivery-graph-freshness")?.classList.contains("stale") === false, "A coherent publication must retain the prototype fresh treatment")
  chooseOption(timeline, String(retainedIndex))
  assert(document.querySelector(".delivery-graph-freshness")?.classList.contains("stale") === true, "A retained frame at a story/runtime moment must use the prototype stale treatment")
})

await scenario("keeps current observed moment contained at the bottom of the frame", async () => {
  const row = maintainedCassetteRows.find(({ catalogKey }) => catalogKey === "authored:deliveryInvariantStory")
  if (row === undefined) throw new Error("The prototype cassette is missing")
  const { document, root, settled } = installDom()
  mountCassetteLab({ revision: "acceptance-revision", root, rows: [row], runCassette: cannedRunner })
  const done = settled(singleCassetteSettledEvent)
  ;(document.querySelector("article .selected-cassette-controls button") as HTMLButtonElement | null)?.click()
  await done
  const frame = document.querySelector<HTMLElement>("[data-role='delivery-frame']")
  const moment = frame?.querySelector<HTMLElement>(".delivery-moment-evidence")
  assert(frame?.lastElementChild === moment, "Current observed moment must be the bottommost Delivery-frame section")
  assert(moment?.dataset.layout === "contained", "Current observed moment must expose its fixed-height layout contract")
})

await scenario("updates an observed runtime task tone without fabricating a delivery publication", async () => {
  const match = everyResult.flatMap((result) => {
    if (result._tag !== "Completed" || result.observationMoments === null) return []
    const index = result.observationMoments.findIndex((moment) =>
      moment._tag === "DeliveryRuntimeOwnersMoment"
      && moment.deliveryFrame?.graph._tag === "Established"
      && moment.liveOwners.some((owner) =>
        owner._tag === "MaterializedDeliveryAction"
        && owner.proposal.admission.integrationTarget._tag === "IntegrationTargetResourceRequired"
      )
    )
    return index < 0 ? [] : [{ index, result }]
  })[0]
  if (match === undefined) throw new Error("The maintained runtime-owner fixture is missing")
  const row = maintainedCassetteRows.find(({ catalogKey }) => catalogKey === match.result.catalogKey)
  if (row === undefined) throw new Error("The maintained runtime-owner row is missing")
  const { document, root, settled } = installDom()
  mountCassetteLab({ revision: "acceptance-revision", root, rows: [row], runCassette: cannedRunner })
  const done = settled(singleCassetteSettledEvent)
  ;(document.querySelector("article .selected-cassette-controls button") as HTMLButtonElement | null)?.click()
  await done
  const timeline = document.querySelector<HTMLSelectElement>(".delivery-timeline-controls select")
  if (timeline === null) throw new Error("The observed-moment selector is missing")
  chooseOption(timeline, String(match.index))
  const graph = document.querySelector("dalph-delivery-graph") as (HTMLElement & {
    highlightedTaskIds: ReadonlyArray<string>
    selectedTaskId: string | null
    projection?: {
      readonly tasks: ReadonlyArray<{
        readonly display?: { readonly tone?: string }
        readonly id: string
      }>
    }
  }) | null
  const integratingTask = graph?.projection?.tasks.find(({ display }) => display?.tone === "integrating")
  assert(integratingTask !== undefined, "A live integration owner must dominate its task's trace-fill tone")
  assert(
    document.querySelector(".delivery-moment-evidence")?.textContent?.includes("exact proposal / operation correlation") === true
    && document.querySelector(".delivery-moment-evidence")?.textContent?.includes("operationId") === true,
    "A runtime moment must expose the exact proposal and operation correlation behind its live-owner tone"
  )
  assert(
    document.querySelector(".delivery-source-status")?.textContent
      === "No Delivery publication changed the source explanation at this moment.",
    "A runtime-only moment must not fabricate a Delivery source change"
  )
  assert(
    document.querySelectorAll(".delivery-source-stage-rows .source-output-changed").length === 0,
    "A runtime-only moment must retain every source row without changed-output highlighting"
  )
  const stageButton = [...document.querySelectorAll<HTMLButtonElement>("[data-source-stage] > button")]
    .find((button) => button.parentElement?.dataset.taskIds?.split(",").includes(integratingTask?.id ?? ""))
  stageButton?.click()
  assert(
    graph?.highlightedTaskIds.includes(integratingTask?.id ?? "") === true,
    "Selecting a source stage must highlight its graph task and incident edges"
  )
  assert(
    graph?.shadowRoot?.querySelector("li[data-edge-from].selection-related") !== null,
    "Selecting source data must visibly mark a relationship incident to its graph tasks"
  )
  const sourceTask = document.querySelector<HTMLButtonElement>("[data-source-stage] .delivery-source-task-buttons button")
  sourceTask?.click()
  assert(
    graph?.selectedTaskId === sourceTask?.textContent,
    "Selecting a task from typed source data must synchronize the graph selection"
  )
  graph?.dispatchEvent(new CustomEvent("task-selected", { detail: { taskId: integratingTask?.id } }))
  assert(
    document.querySelector("[data-source-stage].source-selection-related") !== null,
    "Selecting a graph task must highlight every source row containing that task"
  )
})

await scenario("uses an explicit Pause or failed fresh-read occurrence as the constraint tone", () => {
  const match = everyResult.flatMap((result) => {
    if (result._tag !== "Completed" || result.observationMoments === null) return []
    return result.observationMoments.flatMap((moment) => {
      if (moment._tag !== "AuthoredStoryOccurrenceMoment" || moment.deliveryFrame?.graph._tag !== "Established") return []
      const occurrence = moment.occurrence
      const graphTaskIds = moment.deliveryFrame.graph.tasks.map(({ id }) => id)
      const constraintTaskIds = occurrence._tag === "TrackerGraphReadFailed"
        ? graphTaskIds
        : occurrence._tag === "OperatorControlDirectionFailed"
          ? [occurrence.subject.taskId]
          : ((occurrence._tag === "OperatorAppliesControlDirection"
          || occurrence._tag === "OperatorAppliesControlDirectionBeforeDeliveryActionAdmission"
          || occurrence._tag === "OperatorAppliesControlDirectionWhileExecutorRequestInFlight")
          && occurrence.direction === "Pause")
            ? occurrence.subject._tag === "Task" ? [occurrence.subject.taskId] : graphTaskIds
            : []
      const taskId = constraintTaskIds.find((candidate) =>
        !moment.deliveryFrame?.settlements.some((settlement) => settlement.taskId === candidate)
        && !moment.liveOwners.some((owner) => deliveryProposalOrderTaskId(owner.proposal.order) === candidate)
        && !moment.deliveryFrame?.heldPositions.some((held) => held.taskId === candidate)
        && !moment.deliveryFrame?.tickets.some((ticket) =>
          ticket.taskId === candidate && ticket.placement.kind === "Selected"
        )
        && !moment.deliveryFrame?.frontier.some((standing) =>
          standing.taskId === candidate && standing.standing === "Eligible"
        )
      )
      return taskId === undefined ? [] : [{ frame: moment.deliveryFrame, taskId }]
    })
  })[0]
  if (match === undefined) throw new Error("The maintained Pause/fresh-read constraint fixture is missing")
  assert(
    dominantTaskTone(match.frame, match.taskId, [], [match.taskId]) === "paused",
    "A typed Pause or failed fresh-read occurrence must produce the explicit constraint tone"
  )
})

await scenario("keeps the graph primary and synchronizes story source data tasks and incident edges", async () => {
  const match = everyResult.flatMap((result) => {
    if (result._tag !== "Completed" || result.observationMoments === null) return []
    const index = result.observationMoments.findIndex((moment) => {
      if (moment._tag !== "AuthoredStoryOccurrenceMoment" || moment.deliveryFrame?.graph._tag !== "Established") return false
      const story = JSON.stringify(moment.occurrence)
      const graph = moment.deliveryFrame.graph
      const firstMentioned = graph.tasks.find(({ id }) => story.includes(`\"${id}\"`))?.id
      return firstMentioned !== undefined && graph.tasks.some(({ id, parentTaskId, prerequisiteIds }) =>
        id === firstMentioned && (parentTaskId !== null || prerequisiteIds.length > 0)
        || parentTaskId === firstMentioned
        || prerequisiteIds.includes(firstMentioned)
      )
    })
    return index < 0 ? [] : [{ index, result }]
  })[0]
  if (match === undefined) throw new Error("The maintained story/source selection fixture is missing")
  const row = maintainedCassetteRows.find(({ catalogKey }) => catalogKey === match.result.catalogKey)
  if (row === undefined) throw new Error("The maintained story/source selection row is missing")
  const { document, root, settled } = installDom()
  mountCassetteLab({ revision: "acceptance-revision", root, rows: [row], runCassette: cannedRunner })
  const done = settled(singleCassetteSettledEvent)
  ;(document.querySelector("article .selected-cassette-controls button") as HTMLButtonElement | null)?.click()
  await done
  const timeline = document.querySelector<HTMLSelectElement>(".delivery-timeline-controls select")
  if (timeline === null) throw new Error("The observed-moment selector is missing")
  chooseOption(timeline, String(match.index))
  const graph = document.querySelector("dalph-delivery-graph") as (HTMLElement & {
    selectedTaskId: string | null
  }) | null
  const storyTask = document.querySelector<HTMLButtonElement>(
    ".delivery-moment-evidence .delivery-source-task-buttons button"
  )
  storyTask?.click()
  assert(graph?.selectedTaskId === storyTask?.textContent, "A typed story task must select the same graph task")
  assert(
    graph?.shadowRoot?.querySelector("li[data-edge-from].selection-related") !== null,
    "A story task selection must visibly highlight an incident graph relationship"
  )
  const sourceTask = document.querySelector<HTMLButtonElement>("[data-source-stage] .delivery-source-task-buttons button")
  sourceTask?.click()
  assert(graph?.selectedTaskId === sourceTask?.textContent, "A source data task must select the same graph task")
  assert(
    document.querySelector("[data-source-stage].source-selection-related") !== null,
    "The selected graph task must keep containing source rows synchronized"
  )
})

await scenario("shows graph observation provenance quiescence and planned actions", async () => {
  const { document, root, settled } = installDom()
  const row = maintainedCassetteRows.find(({ catalogKey }) => catalogKey === "authored:runPauseSafelySuspends")
  const result = row === undefined ? undefined : resultByKey.get(row.catalogKey)
  if (row === undefined || result?._tag !== "Completed" || result.deliveryFrames === null) {
    throw new Error("The pause delivery fixture is missing")
  }
  const passiveIndex = result.deliveryFrames.findIndex(({ graph, quiescence }) =>
    graph._tag === "Established" && quiescence._tag === "QuiescencePassive"
  )
  if (passiveIndex < 0) throw new Error("The pause fixture has no established passive publication")
  mountCassetteLab({ revision: "acceptance-revision", root, rows: [row], runCassette: cannedRunner })
  const done = settled(singleCassetteSettledEvent)
  ;(document.querySelector("article .selected-cassette-controls button") as HTMLButtonElement | null)?.click()
  await done
  const timeline = document.querySelector(".delivery-timeline-controls select") as HTMLSelectElement | null
  if (timeline === null) throw new Error("The pause delivery timeline is missing")
  chooseOption(timeline, String(deliveryMomentIndex(result, passiveIndex)))
  const facts = document.querySelector("[data-role='delivery-frame']")?.textContent ?? ""
  const passiveFrame = result.deliveryFrames[passiveIndex]
  if (passiveFrame?.graph._tag !== "Established") throw new Error("The selected pause graph is not established")
  assert(facts.includes("first coordinator process"), "The initial activation must be explained in process terms")
  assert(
    facts.includes(passiveFrame.graph.observation.operationId)
      && facts.includes(`recorded at journal ${passiveFrame.graph.observation.recordedAt}`),
    "Observed graph provenance must expose its exact read and journal correlation"
  )
  assert(facts.includes("passive because RunPaused"), "The exact quiescence reason must explain why desired tickets cannot start")
  assert(facts.includes("planned action proposals") || facts.includes("planning fails closed"), "The downstream action plan must be summarized without implying execution")
  assert(facts.includes("Operator paused the Run"), "A batched publication must retain the concrete operator Pause landmark")
  assert(
    facts.includes("Attempt attempt:A:0 reported Running"),
    "A batched publication must retain the exact executor-attempt landmark after Pause"
  )
  assert(document.querySelector("[data-role='delivery-action-planning']") !== null, "Exact action proposals and isolated planning issues must remain inspectable")
})

await scenario("explains restart continuity at the first later activation boundary", async () => {
  const { document, root, settled } = installDom()
  const row = maintainedCassetteRows.find(({ catalogKey }) =>
    catalogKey === "authored:acceptedResultRestartsIntoIntegration"
  )
  const result = row === undefined ? undefined : resultByKey.get(row.catalogKey)
  if (row === undefined || result?._tag !== "Completed" || result.deliveryFrames === null) {
    throw new Error("The restart delivery fixture is missing")
  }
  const recoveredIndex = result.deliveryFrames.findIndex(({ activationOrdinal }, index) =>
    activationOrdinal === 2 && result.deliveryFrames?.[index - 1]?.activationOrdinal === 1
  )
  if (recoveredIndex < 1) throw new Error("The restart boundary is missing")
  mountCassetteLab({ revision: "acceptance-revision", root, rows: [row], runCassette: cannedRunner })
  const done = settled(singleCassetteSettledEvent)
  ;(document.querySelector("article .selected-cassette-controls button") as HTMLButtonElement | null)?.click()
  await done
  const timeline = document.querySelector(".delivery-timeline-controls select") as HTMLSelectElement | null
  if (timeline === null) throw new Error("The recovery delivery timeline is missing")
  chooseOption(timeline, String(deliveryMomentIndex(result, recoveredIndex)))
  const boundary = document.querySelector(".delivery-restart-boundary")?.textContent ?? ""
  assert(
    boundary.includes("Coordinator restarted: Initial activation 1 → Later activation 2"),
    "The first later-activation publication must visibly mark the process restart"
  )
  assert(
    boundary.includes("Changed: none")
      && boundary.includes("Disappeared:")
      && boundary.includes("Disappeared: held position · task A")
      && boundary.includes("obligation · task A · planned-attempt executor responsibility")
      && boundary.includes("Added: obligation · task A · accepted result awaiting integration"),
    "The first later-activation publication must show task A's responsibility and held position disappeared while accepted integration was added"
  )
})

await scenario("shows integration order separately from task-work capacity", async () => {
  const { document, root, settled } = installDom()
  const row = maintainedCassetteRows.find(({ catalogKey }) =>
    catalogKey === "authored:acceptedResultRestartsIntoIntegration"
  )
  const result = row === undefined ? undefined : resultByKey.get(row.catalogKey)
  if (row === undefined || result?._tag !== "Completed" || result.deliveryFrames === null) {
    throw new Error("The accepted-result integration fixture is missing")
  }
  const awaitingIndex = result.deliveryFrames.findIndex(({ integrationOrder }) =>
    integrationOrder.awaitingResponsibility.length === 1
  )
  const queuedIndex = result.deliveryFrames.findIndex(({ integrationOrder }) =>
    integrationOrder.responsibilities.some(({ state }) => state === "QueuedBeforeCutoff")
  )
  const startedIndex = result.deliveryFrames.findIndex(({ integrationOrder }) =>
    integrationOrder.responsibilities.some(({ state }) => state === "StartedPastCutoff")
  )
  if (awaitingIndex < 0 || queuedIndex < 0 || startedIndex < 0) {
    throw new Error("The accepted, queued, and started integration frames are incomplete")
  }

  mountCassetteLab({ revision: "acceptance-revision", root, rows: [row], runCassette: cannedRunner })
  const done = settled(singleCassetteSettledEvent)
  ;(document.querySelector("article .selected-cassette-controls button") as HTMLButtonElement | null)?.click()
  await done
  const timeline = document.querySelector(".delivery-timeline-controls select") as HTMLSelectElement | null
  if (timeline === null) throw new Error("The integration delivery timeline is missing")

  chooseOption(timeline, String(deliveryMomentIndex(result, awaitingIndex)))
  const order = document.querySelector("[data-role='delivery-integration-order']")
  assert(order?.textContent?.includes("0 ordered · 1 awaiting responsibility") === true, "An accepted result must remain outside integration order until its responsibility is durable")
  assert(order?.textContent?.includes("Accepted results not ordered yet") === true, "The waiting result must not receive an invented position")
  assert(order?.textContent?.includes("accepted commit aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa") === true, "The waiting result must retain its exact commit")

  chooseOption(timeline, String(deliveryMomentIndex(result, queuedIndex)))
  assert(order?.textContent?.includes("#1 · Task A · queued before integration cutoff") === true, "The durable responsibility must expose its target-relative position")
  assert(order?.textContent?.includes("/dalph/cassettes/integration.git · refs/heads/master") === true, "Integration order must be scoped to the exact repository/ref target")
  assert(order?.textContent?.includes(`Run ${result.runId} · attempt attempt:A:0`) === true, "Integration order must retain its exact Run and attempt")

  chooseOption(timeline, String(deliveryMomentIndex(result, startedIndex)))
  assert(order?.textContent?.includes("started past integration cutoff at journal") === true, "The durable cutoff must replace the queued state")
  assert(order?.textContent?.includes("not a persisted queue row or proof that this process holds") === true, "Integration order must not claim process-local ownership")
  assert(
    document.querySelector("[data-role='delivery-capacity-positions']")?.textContent?.includes("held of capacity") === true,
    "Task-work capacity must remain a separate visible resource"
  )
})

await scenario("separates every coordinator activation in a multi-restart delivery timeline", async () => {
  const { document, root, settled } = installDom()
  const row = maintainedCassetteRows.find(({ catalogKey }) =>
    catalogKey === "authored:changedAttemptStopLostThirdSuspension"
  )
  const result = row === undefined ? undefined : resultByKey.get(row.catalogKey)
  if (row === undefined || result?._tag !== "Completed" || result.deliveryFrames === null) {
    throw new Error("The multi-restart delivery fixture is missing")
  }
  const boundaryIndexes = result.deliveryFrames.flatMap((frame, index) =>
    index > 0 && frame.activationOrdinal !== result.deliveryFrames?.[index - 1]?.activationOrdinal ? [index] : []
  )
  assert(boundaryIndexes.length === 6, "Every recovered coordinator process must retain a distinct frame boundary")
  mountCassetteLab({ revision: "acceptance-revision", root, rows: [row], runCassette: cannedRunner })
  const done = settled(singleCassetteSettledEvent)
  ;(document.querySelector("article .selected-cassette-controls button") as HTMLButtonElement | null)?.click()
  await done
  const timeline = document.querySelector(".delivery-timeline-controls select") as HTMLSelectElement | null
  if (timeline === null) throw new Error("The multi-restart delivery timeline is missing")
  for (const [boundaryOrdinal, frameIndex] of boundaryIndexes.entries()) {
    chooseOption(timeline, String(deliveryMomentIndex(result, frameIndex)))
    const marker = document.querySelector(".delivery-restart-boundary")?.textContent ?? ""
    assert(
      marker.includes(`activation ${boundaryOrdinal + 1} → Later activation ${boundaryOrdinal + 2}`),
      `Later activation ${boundaryOrdinal + 2} must have its own visible boundary`
    )
  }
})

await scenario("keeps graph-not-established frames dimensionally stable and truthful", async () => {
  const { document, root, settled } = installDom()
  const row = maintainedCassetteRows.find(({ catalogKey }) =>
    catalogKey === "authored:acceptedResultRestartsIntoIntegration"
  )
  const result = row === undefined ? undefined : resultByKey.get(row.catalogKey)
  if (row === undefined || result?._tag !== "Completed" || result.deliveryFrames === null) {
    throw new Error("The recovery delivery fixture is missing")
  }
  const emptyIndex = result.deliveryFrames.findIndex(({ activationOrdinal, graph }) =>
    activationOrdinal > 1 && graph._tag === "NotEstablished"
  )
  const establishedIndex = result.deliveryFrames.findIndex((frame, index) =>
    index > emptyIndex && frame.graph._tag === "Established"
  )
  if (emptyIndex < 0 || establishedIndex < 0) throw new Error("The recovery graph transition is missing")
  mountCassetteLab({ revision: "acceptance-revision", root, rows: [row], runCassette: cannedRunner })
  const done = settled(singleCassetteSettledEvent)
  ;(document.querySelector("article .selected-cassette-controls button") as HTMLButtonElement | null)?.click()
  await done
  const timeline = document.querySelector(".delivery-timeline-controls select") as HTMLSelectElement | null
  if (timeline === null) throw new Error("The recovery delivery timeline is missing")
  chooseOption(timeline, String(deliveryMomentIndex(result, emptyIndex)))
  const emptyGraph = document.querySelector("dalph-delivery-graph") as (HTMLElement & {
    projection?: { readonly tasks: ReadonlyArray<unknown> }
  }) | null
  assert(emptyGraph?.projection?.tasks.length === 0, "The recovery frame must retain the exact graph-not-established projection")
  assert(
    document.querySelector("[data-role='selected-task-facts']")?.textContent?.includes("No production-observed task is selectable") === true,
    "An empty recovery graph must not invite impossible task selection"
  )
  assert(
    document.querySelector("[data-role='delivery-workbench'] .delivery-graph-view-controls button")?.textContent
      === "Reset graph view",
    "The graph reset action must be visible beside the graph"
  )
  const reset = document.querySelector<HTMLButtonElement>(".delivery-graph-view-controls button")
  assert(reset?.disabled === true, "An absent production graph must not offer a no-op reset")
  assert(
    document.querySelector(".delivery-graph-view-controls")?.textContent?.includes("Drag to pan · pinch, wheel, or trackpad to zoom")
      === true,
    "The graph must visibly explain its pointer gestures"
  )
  chooseOption(timeline, String(deliveryMomentIndex(result, establishedIndex)))
  const establishedGraph = document.querySelector("dalph-delivery-graph") as (HTMLElement & {
    projection?: { readonly tasks: ReadonlyArray<unknown> }
  }) | null
  assert(establishedGraph === emptyGraph, "Graph authority changes must keep one dimensionally stable graph element")
  assert((establishedGraph?.projection?.tasks.length ?? 0) > 0, "A later observed graph must restore its useful task projection")
  assert(reset?.disabled === false, "An established production graph must enable deterministic reset")
})

await scenario("names concrete planned transitions and their admission requirements", async () => {
  const summaryFor = async (marker: string): Promise<string> => {
    const match = everyResult.flatMap((result) => {
      if (result._tag !== "Completed" || result.deliveryFrames === null) return []
      return result.deliveryFrames.flatMap((frame, frameIndex) => {
        const values = frame.actionPlanning._tag === "DeliveryProposalsAvailable"
          ? frame.actionPlanning.proposals
          : frame.actionPlanning.conflicts
        return values.some(({ exact }) => exact.includes(marker)) ? [{ frameIndex, key: result.catalogKey }] : []
      })
    })[0]
    if (match === undefined) throw new Error(`No maintained delivery proposal contains ${marker}`)
    const row = maintainedCassetteRows.find(({ catalogKey }) => catalogKey === match.key)
    if (row === undefined) throw new Error(`The proposal row ${match.key} is missing`)
    const { document, root, settled } = installDom()
    mountCassetteLab({ revision: "acceptance-revision", root, rows: [row], runCassette: cannedRunner })
    const done = settled(singleCassetteSettledEvent)
    ;(document.querySelector("article .selected-cassette-controls button") as HTMLButtonElement | null)?.click()
    await done
    const timeline = document.querySelector(".delivery-timeline-controls select") as HTMLSelectElement | null
    if (timeline === null) throw new Error("The planned-action timeline is missing")
    const matchedResult = everyResult.find(({ catalogKey }) => catalogKey === match.key)
    if (matchedResult?._tag !== "Completed") throw new Error(`The proposal result ${match.key} is missing`)
    chooseOption(timeline, String(deliveryMomentIndex(matchedResult, match.frameIndex)))
    const item = [...document.querySelectorAll("[data-role='delivery-action-planning'] li")].find((candidate) =>
      candidate.querySelector("pre")?.textContent?.includes(marker)
    )
    return item?.querySelector(":scope > span")?.textContent ?? ""
  }

  const fresh = await summaryFor('"_tag": "FreshWorkflowRoute"')
  assert(fresh.includes("Read the tracker graph for the selected task"), "Fresh workflow proposals must name their concrete boundary action")
  assert(fresh.includes("waits for live operation"), "A proposal must name the live operation that blocks it")
  const recovered = await summaryFor('"_tag": "RecoveredNewActionRoute"')
  assert(recovered.startsWith("Read") && !recovered.startsWith("Recovered New Action"), "Recovered proposals must name their concrete authority action")
  const pause = await summaryFor('"_tag": "SuspendPlannedAttemptExecutorWork"')
  assert(pause.includes("Request safe suspension of the exact planned-attempt executor work") && pause.includes("task A"), "Pause planning must use the concrete task action")
  assert(
    pause.includes("attempt ID attempt:A:0")
      && pause.includes("must serialize this action with executor commands and Continue or Stop"),
    "Pause planning must expose one exact attempt correlation and its process-local executor/Stop exclusion"
  )
  assert(pause.includes("requires the existing task-work position"), "Pause planning must explain its exact position admission")
  const queued = await summaryFor('"_tag": "QueueAcceptedResultIntegrationResponsibility"')
  assert(queued.includes("Queue the accepted result for integration") && queued.includes("task A"), "Accepted-result planning must name the concrete integration action")
  assert(queued.includes("needs no task-work position") && queued.includes("needs no integration-target resource"), "Accepted-result queueing must state its non-admission requirements")
  const targetResource = await summaryFor('"_tag": "IntegrationTargetResourceRequired"')
  assert(
    targetResource.includes("must acquire the integration-target resource")
      || targetResource.includes("must release the held integration-target resource")
      || targetResource.includes("requires the held integration-target resource"),
    "Integration proposals must explain their exact target-resource admission"
  )
})

await scenario("distinguishes competing claim reads and exact responsibilities after Stop recovery", () => {
  const result = resultByKey.get("authored:changedAttemptStopReleaseResponseLost")
  if (result?._tag !== "Completed" || result.deliveryFrames === null) {
    throw new Error("The lost claim-release response fixture is missing")
  }
  const frame = result.deliveryFrames.find(({ actionPlanning, deliveries }) => {
    if (actionPlanning._tag !== "DeliveryProposalsAvailable") return false
    const summaries = actionPlanning.proposals.map(({ summary }) => summary)
    const obligations = deliveries.flatMap((delivery) => delivery.obligations.map(({ summary }) => summary))
    return summaries.some((summary) => summary.includes("current workflow responsibility"))
      && summaries.some((summary) => summary.includes("before releasing a stopped attempt"))
      && obligations.some((summary) => summary.includes("planned-attempt executor responsibility"))
      && obligations.some((summary) => summary.includes("task-claim release responsibility"))
  })
  if (frame === undefined || frame.actionPlanning._tag !== "DeliveryProposalsAvailable") {
    throw new Error("The distinct Stop-recovery claim-read frame is missing")
  }
  const claimReads = frame.actionPlanning.proposals.filter(({ summary }) =>
    summary.startsWith("Read the current task claim from the tracker")
  )
  assert(claimReads.length === 2, "Both exact tracker claim reads must remain visible")
  assert(
    new Set(claimReads.map(({ summary }) => summary)).size === 2,
    "The same tracker boundary call must retain each distinct workflow purpose"
  )
  const protocolProposal = result.deliveryFrames.flatMap(({ actionPlanning }) =>
    actionPlanning._tag === "DeliveryProposalsAvailable" ? actionPlanning.proposals : []
  ).find(({ summary }) =>
    summary.includes("attempt ID attempt:A:0")
    && summary.includes("must serialize this action with executor commands and Continue or Stop")
  )
  assert(
    protocolProposal !== undefined,
    "The Stop chronology must expose the process-local executor/Stop exclusion where production requires it"
  )
})

await scenario("uses production authored prose for current story items", () => {
  const row = maintainedCassetteRows.find(({ catalogKey }) => catalogKey === "authored:changedAttemptChoiceRace")
  const projectionRow = maintainedCassetteRows.find(({ catalogKey }) =>
    catalogKey === "authored:changedAttemptStopRemainsUnproved"
  )
  if (row === undefined || projectionRow === undefined) throw new Error("The authored prose fixtures are missing")
  const raceIndex = row.storyItemTags.indexOf("OperatorRacesContinueAndStop")
  const projectionIndex = projectionRow.storyItemTags.indexOf("PlannedAttemptExecutorProjectionReturned")
  const race = row.storyItemSummaries[raceIndex] ?? ""
  const projection = projectionRow.storyItemSummaries[projectionIndex] ?? ""
  assert(
    race.includes("Alice concurrently submits Continue") && race.includes("exactly one journaled request wins"),
    "The defining race must use the exhaustive production authored presenter"
  )
  assert(
    projection.includes("A read-only executor projection returns")
      && !projection.includes("PlannedAttemptExecutorProjectionReturned"),
    "Executor projection input must be described as a readable boundary event rather than a raw tag"
  )
  const activationFinalRead = renderAuthoredStoryItemLandmark(
    AuthoredCassetteStoryItem.cases.RunActivationFinalTrackerGraphReadReturned.make({
      graph: maintainedAuthoredCassetteCatalog.contractedCapacityRetainsTwoAttempts.startingFacts.trackerGraph
    })
  )
  assert(
    activationFinalRead?.startsWith("Activation-final tracker read returned graph") === true,
    "The Lab must consume the production-authored landmark for an activation-final tracker read"
  )
})

await scenario("reports the established dependency-story settlements and keeps the direct-protocol caveat secondary", async () => {
  const { document, root, settled } = installDom()
  const row = maintainedCassetteRows.find(({ catalogKey }) => catalogKey === "authored:dependentTasksCompleteInOneRun")
  if (row === undefined) throw new Error("The dependency delivery row is missing")
  mountCassetteLab({ revision: "acceptance-revision", root, rows: [row], runCassette: cannedRunner })
  const done = settled(singleCassetteSettledEvent)
  ;(document.querySelector("article .selected-cassette-controls button") as HTMLButtonElement | null)?.click()
  await done
  assert(
    document.querySelector(".delivery-settlement-coverage")?.textContent?.startsWith(
      "This timeline contains 2 distinct established delivery settlements"
    ) === true,
    "The workbench must report the timeline's exact established settlements without unrelated primary explanation"
  )
  assert(
    document.querySelector(".delivery-reading-guide:not([open]) .delivery-direct-protocol-note")?.textContent?.includes("Direct integration-finality cassettes") === true,
    "The direct-protocol caveat must remain available as collapsed secondary guidance"
  )
})

await scenario("counts one delivery settlement once across repeated production publications", async () => {
  const { document, root, settled } = installDom()
  const row = maintainedCassetteRows.find(({ catalogKey }) => catalogKey === "authored:deliveryFinalitySpine")
  const result = row === undefined ? undefined : resultByKey.get(row.catalogKey)
  if (row === undefined || result?._tag !== "Completed" || result.deliveryFrames === null) {
    throw new Error("The linked delivery story settlement frames are missing")
  }
  const distinctSettlements = new Set(
    result.deliveryFrames.flatMap(({ settlements }) =>
      settlements.map(({ attemptId, taskId }) => `${taskId}:${attemptId}`)
    )
  ).size
  const settlementBearingPublications = result.deliveryFrames.filter(({ settlements }) => settlements.length > 0).length
  assert(
    distinctSettlements === 1 && settlementBearingPublications > distinctSettlements,
    "The fixture must republish one exact settlement"
  )

  mountCassetteLab({ revision: "acceptance-revision", root, rows: [row], runCassette: cannedRunner })
  const done = settled(singleCassetteSettledEvent)
  ;(document.querySelector("article .selected-cassette-controls button") as HTMLButtonElement | null)?.click()
  await done
  const coverage = document.querySelector(".delivery-settlement-coverage")?.textContent ?? ""
  assert(
    coverage.includes(`${distinctSettlements} distinct established delivery settlement`)
      && coverage.includes(`across ${settlementBearingPublications} production publications`),
    "The timeline must distinguish exact settlements from frames that republish them"
  )
  assert(
    (root.textContent ?? "").includes(
      "A CompletedSuccessfully node does not prove Dalph executed or delivery-settled that task"
    ),
    "The workbench must separate tracker lifecycle observations from exact Dalph settlements"
  )
  assert(
    (root.textContent ?? "").includes(
      "B remains open. Later graph answers report C through G successful, but this cassette contains no executor or integration chronology for those tasks"
    ),
    "The linked cassette must visibly state the exact chronology it executes"
  )
})

await scenario("keeps multi-task chronology landmarks attributable", () => {
  const row = maintainedCassetteRows.find(({ catalogKey }) => catalogKey === "authored:dependentTasksCompleteInOneRun")
  if (row === undefined) throw new Error("The dependency delivery row is missing")
  assert(
    row.storyItemLandmarks.some((landmark) => landmark?.includes("task A") === true && landmark.includes("task B")),
    "A multi-task tracker graph return must name each task beside its lifecycle"
  )
})

await scenario("composes simultaneous graph ticket held and delivery encodings", async () => {
  const { document, root, settled } = installDom()
  const row = maintainedCassetteRows.find(({ catalogKey }) => catalogKey === "authored:dependentTasksCompleteInOneRun")
  const result = row === undefined ? undefined : resultByKey.get(row.catalogKey)
  if (row === undefined || result?._tag !== "Completed" || result.deliveryFrames === null) {
    throw new Error("The dependency delivery fixture is missing")
  }
  const combinedIndex = result.deliveryFrames.findIndex((frame) =>
    frame.graph._tag === "Established"
    && frame.graph.tasks.some(({ id }) => {
      const ticket = frame.tickets.find(({ taskId }) => taskId === id)
      const delivery = frame.deliveries.find(({ taskId }) => taskId === id)
      return ticket?.placement.kind === "Selected" && delivery !== undefined
    })
  )
  if (combinedIndex < 0) throw new Error("No frame combines selected-ticket and delivery standing")
  mountCassetteLab({ revision: "acceptance-revision", root, rows: [row], runCassette: cannedRunner })
  const done = settled(singleCassetteSettledEvent)
  ;(document.querySelector("article .selected-cassette-controls button") as HTMLButtonElement | null)?.click()
  await done
  const timeline = document.querySelector(".delivery-timeline-controls select") as HTMLSelectElement | null
  if (timeline === null) throw new Error("The dependency delivery timeline is missing")
  chooseOption(timeline, String(deliveryMomentIndex(result, combinedIndex)))
  const graph = document.querySelector("dalph-delivery-graph") as (HTMLElement & {
    projection?: { readonly tasks: ReadonlyArray<{ readonly display?: { readonly classes?: ReadonlyArray<string> } }> }
  }) | null
  assert(
    graph?.projection?.tasks.some(({ display }) =>
      display?.classes?.includes("placement") === true && display.classes.includes("standing")
    ) === true,
    "A task must retain simultaneous selected-ticket and ticket-delivery encodings"
  )
  const legend = document.querySelector(".delivery-graph-legend")?.textContent ?? ""
  assert(legend.includes("Purple halo") && legend.includes("Gold fill"), "The legend must name composable ticket and delivery encodings")
})

await scenario("keeps selected-task feedback separate from delivery encodings", async () => {
  const { document, root, settled } = installDom()
  const row = maintainedCassetteRows.find(({ catalogKey }) => catalogKey === "authored:dependentTasksCompleteInOneRun")
  if (row === undefined) throw new Error("The dependency delivery row is missing")
  mountCassetteLab({ revision: "acceptance-revision", root, rows: [row], runCassette: cannedRunner })
  const done = settled(singleCassetteSettledEvent)
  ;(document.querySelector("article .selected-cassette-controls button") as HTMLButtonElement | null)?.click()
  await done
  const graph = document.querySelector("dalph-delivery-graph") as (HTMLElement & {
    selectedTaskId?: string | null
  }) | null
  graph?.dispatchEvent(new CustomEvent("task-selected", { detail: { taskId: "A" } }))
  assert(graph?.selectedTaskId === "A", "Graph selection must remain controlled without changing its delivery projection")
  assert(document.querySelector("tr[data-task-id='A']")?.getAttribute("aria-current") === "true", "Selected-task feedback must retain its accessible table correlation")
  assert(document.querySelector(".delivery-graph-legend")?.textContent?.includes("Cyan outer outline") === true, "The interaction highlight must be explained separately from domain encodings")
})

await scenario("shows grouping relationships exact obligations and settlement state", async () => {
  const { document, root, settled } = installDom()
  const row = maintainedCassetteRows.find(({ catalogKey }) => catalogKey === "authored:taskPauseCoversGroupingChild")
  if (row === undefined) throw new Error("The grouping delivery row is missing")
  mountCassetteLab({ revision: "acceptance-revision", root, rows: [row], runCassette: cannedRunner })
  const done = settled(singleCassetteSettledEvent)
  ;(document.querySelector("article .selected-cassette-controls button") as HTMLButtonElement | null)?.click()
  await done
  const result = resultByKey.get(row.catalogKey)
  if (result?._tag !== "Completed" || result.deliveryFrames === null) throw new Error("Grouping frames are missing")
  const groupingIndex = result.deliveryFrames.findIndex((frame) =>
    frame.graph._tag === "Established"
    && frame.graph.tasks.some(({ parentTaskId }) => parentTaskId !== null)
    && frame.deliveries.some(({ obligations }) => obligations.length > 0)
  )
  const workbench = document.querySelector("[data-role='delivery-workbench']")
  const select = workbench?.querySelector(".delivery-timeline-controls select") as HTMLSelectElement | null
  if (select === null || groupingIndex < 0) throw new Error("Grouping timeline controls are missing")
  for (const option of select.options) {
    if (option.value === String(deliveryMomentIndex(result, groupingIndex))) option.setAttribute("selected", "")
    else option.removeAttribute("selected")
  }
  select.dispatchEvent(new Event("change"))
  const graph = workbench?.querySelector("dalph-delivery-graph") as (HTMLElement & {
    projection?: { readonly edges: ReadonlyArray<{ readonly kind: string }> }
  }) | null
  assert(graph?.projection?.edges.some(({ kind }) => kind === "Grouping") === true, "The production-observed parent relation must render as a grouping edge")
  assert(workbench?.textContent?.includes("exact obligations") === true, "Ticket-delivery obligations must be explicitly inspectable and attributable to a task")
  assert(workbench?.textContent?.includes("Settlement") === true, "Every task must expose its current delivery-settlement state")
})

await scenario("finds and auto-selects cassettes by catalog ID or human title", async () => {
  const { document, root, settled } = installDom()
  const calls: Array<string> = []
  mountCassetteLab({
    revision: "acceptance-revision",
    root,
    rows: maintainedCassetteRows,
    runCassette: async (key) => {
      calls.push(key)
      return cannedRunner(key)
    }
  })
  const search = document.querySelector("[data-role='cassette-selector']") as HTMLInputElement | null
  const options = document.querySelector("datalist[data-role='cassette-options']")
  const searchStatus = document.querySelector("[data-role='cassette-search-status']")
  if (search === null || options === null) throw new Error("The searchable cassette selector is missing")
  assert(search.type === "search", "The cassette selector must be a native search input")
  assert(search.getAttribute("aria-label") === "Find cassette by ID or title", "The search purpose must be explicit")
  assert(options.querySelectorAll("option").length === expectedCatalogSize, "Search suggestions must retain the complete catalog")
  const invariantOption = options.querySelector<HTMLOptionElement>(
    'option[value="authored:deliveryInvariantStory"]'
  )
  assert(
    invariantOption?.label.includes("staggered double diamond") === true,
    "Every suggestion must pair its exact catalog ID with the human title"
  )
  search.value = "deliveryInvariantStory"
  search.dispatchEvent(new Event("input"))
  assert(
    document.querySelector("article")?.dataset.catalogKey === "authored:deliveryInvariantStory",
    "A unique catalog-ID suffix must auto-select the matching cassette"
  )
  const titleTarget = maintainedCassetteRows.find(({ catalogKey }) =>
    catalogKey === "authored:productionShapedFiveTaskDiamond"
  )
  if (titleTarget === undefined) throw new Error("The title-search fixture is missing")
  search.value = titleTarget.storyName
  search.dispatchEvent(new Event("input"))
  assert(
    document.querySelector("article")?.dataset.catalogKey === titleTarget.catalogKey,
    "An exact human title must auto-select the matching cassette"
  )
  search.value = "definitely-not-a-maintained-cassette"
  search.dispatchEvent(new Event("input"))
  assert(
    document.querySelector("article")?.dataset.catalogKey === titleTarget.catalogKey,
    "No-match text must retain the last valid cassette selection"
  )
  assert(searchStatus?.textContent?.includes("No maintained cassette matches") === true, "No-match text must be explained")
  const allSettled = settled(everyCassetteSettledEvent)
  const runAll = [...document.querySelectorAll("button")].find(({ textContent }) => textContent?.startsWith("Run all "))
  runAll?.click()
  await allSettled
  assert(calls.length === expectedCatalogSize, "Run all must execute the full catalog")
})

await scenario("runs browser Run all sequentially without changing its complete cassette set", async () => {
  const { document, root, settled } = installDom()
  const rows = maintainedCassetteRows.slice(0, 5)
  const started: Array<(typeof maintainedCassetteKeys)[number]> = []
  const pending = new Map<
    (typeof maintainedCassetteKeys)[number],
    (result: Awaited<ReturnType<typeof cannedRunner>>) => void
  >()
  mountCassetteLab({
    revision: "acceptance-revision",
    root,
    rows,
    runCassette: (key) => new Promise((resolve) => {
      started.push(key)
      pending.set(key, resolve)
    })
  })
  const runAll = [...document.querySelectorAll("button")].find(({ textContent }) => textContent?.startsWith("Run all "))
  runAll?.click()
  assert(started.length === 1, "Run all must start only one browser cassette runner at a time")
  const firstKey = started[0]
  const firstResult = firstKey === undefined ? undefined : resultByKey.get(firstKey)
  if (firstKey === undefined || firstResult === undefined) throw new Error("The first bounded result is missing")
  const firstSettled = settled(cassetteSettledEvent)
  pending.get(firstKey)?.(firstResult)
  await firstSettled
  assert(started.length === 2, "The next maintained cassette must start as soon as the prior runner settles")
  const allSettled = settled(everyCassetteSettledEvent)
  while (started.length < rows.length) {
    const key = started.at(-1)
    if (key === undefined) throw new Error("The next sequential cassette is missing")
    const result = resultByKey.get(key)
    if (result === undefined) throw new Error(`The sequential result for ${key} is missing`)
    const nextSettled = settled(cassetteSettledEvent)
    pending.get(key)?.(result)
    await nextSettled
  }
  const finalKey = started.at(-1)
  const finalResult = finalKey === undefined ? undefined : resultByKey.get(finalKey)
  if (finalKey === undefined || finalResult === undefined) throw new Error("The final sequential result is missing")
  pending.get(finalKey)?.(finalResult)
  await allSettled
  assert(
    document.querySelector("[data-role='catalog-summary']")?.textContent?.startsWith("5 completed") === true,
    "Bounded Run all must retain every terminal result"
  )
})

await scenario("keeps batch progress concise for keyboard and nonvisual maintainers", () => {
  const { document, root } = installDom()
  mountCassetteLab({ revision: "acceptance-revision", root, rows: maintainedCassetteRows, runCassette: cannedRunner })
  const rowButtons = [...document.querySelectorAll("article .selected-cassette-controls button")]
  assert(rowButtons.length === 1, "The shared surface must contain one selected-cassette action")
  assert(rowButtons[0]?.getAttribute("aria-label")?.includes(maintainedCassetteRows[0]?.catalogKey ?? "") === true, "The selected action must name its cassette")
  assert(document.querySelector("[data-role='catalog-summary']")?.getAttribute("aria-live") === null, "Per-cassette batch settlements must not create a live-region announcement storm")
  assert(document.querySelector("[data-role='run-announcement'][aria-live='polite']") !== null, "Batch start and finish must have one dedicated announcement channel")
})

await scenario("replaces stale evidence with live cassette progress and settles cassettes independently", async () => {
  const { document, root, settled } = installDom()
  const rows = maintainedCassetteRows.slice(0, 2)
  const results = rows.map(({ catalogKey }) => resultByKey.get(catalogKey))
  if (results[0] === undefined || results[1] === undefined) throw new Error("Two real results are required")
  const firstResult = results[0]
  const secondResult = results[1]
  let resolveFirst: ((result: typeof firstResult) => void) | undefined
  let resolveSecond: ((result: typeof secondResult) => void) | undefined
  mountCassetteLab({
    revision: "acceptance-revision",
    root,
    rows,
    runCassette: (key) => new Promise((resolve) => {
      if (key === rows[0]?.catalogKey) resolveFirst = resolve
      else resolveSecond = resolve
    })
  })
  const selector = document.querySelector("[data-role='cassette-selector']") as HTMLInputElement | null
  if (selector === null) throw new Error("The cassette selector is missing")
  const runAll = [...document.querySelectorAll("button")].find(({ textContent }) => textContent?.startsWith("Run all "))
  runAll?.click()
  assert(document.querySelectorAll("article").length === 1, "Batch execution must retain one shared cassette surface")
  assert(document.querySelector("article")?.dataset.state === "Running", "The selected affected cassette must become running immediately")
  assert(document.querySelectorAll("[data-role='cassette-options'] option").length === 2, "Batch execution must retain both cassette choices")
  assert(document.querySelector("[data-role='execution-evidence']") === null, "Previous evidence must be absent while rerunning")
  const firstSettled = settled(cassetteSettledEvent)
  resolveFirst?.(firstResult)
  await firstSettled
  assert(document.querySelector("article")?.dataset.state === "Completed", "The selected cassette must show its result as soon as it settles")
  if (rows[1] === undefined) throw new Error("The second batch cassette is missing")
  chooseCassette(selector, rows[1].catalogKey)
  assert(document.querySelector("article")?.dataset.state === "Running", "The selector must expose the other cassette while it is still running")
  const everySettled = settled(everyCassetteSettledEvent)
  resolveSecond?.(secondResult)
  await everySettled
  assert(document.querySelector("article")?.dataset.state === "Completed", "The second selected cassette must show its retained terminal result")
})

await scenario("presents concise execution proof before chronological journal and raw output", async () => {
  const { document, root, settled } = installDom()
  const row = maintainedCassetteRows.find(({ catalogKey }) => catalogKey === "authored:runPauseRestartsPassively")
  if (row === undefined) throw new Error("The recovery row is missing")
  mountCassetteLab({ revision: "acceptance-revision", root, rows: [row], runCassette: runMaintainedCassette })
  const done = settled(singleCassetteSettledEvent)
  ;(document.querySelector("article button") as HTMLButtonElement | null)?.click()
  await done
  const evidence = document.querySelector("[data-role='execution-evidence']")
  const facts = evidence?.querySelector(".execution-facts")?.textContent ?? ""
  assert(facts.includes("runAuthoredScenarioCassette"), "Execution proof must name the exact production runner")
  assert(facts.includes("Activation 1 → Activation 2"), "Execution proof must show later Run activations")
  assert(facts.includes("Run identity"), "Authored execution proof must show its Run identity")
  assert((evidence?.querySelectorAll("[data-role='journal-chronology'] tbody tr").length ?? 0) > 0, "Journal evidence must be chronological within a Run")
  assert(evidence?.querySelector("[data-role='journal-chronology'] caption") !== null, "Journal evidence must name its ordering scope")
  assert([...evidence?.querySelectorAll("[data-role='journal-chronology'] th") ?? []].every((cell) => cell.getAttribute("scope") === "col"), "Journal columns must expose header scope")
  assert(evidence?.querySelector("[data-role='journal-chronology'] tbody details pre") !== null, "Each journal row must retain its exact event")
  assert(evidence?.querySelector("[data-role='raw-execution-result']") !== null, "Raw output must remain secondary and explicitly labelled")
  assert(evidence?.textContent?.includes("Production journal evidence") === false, "The UI must not mislabel the complete execution result")
})

await scenario("shows continuation authorization prefixes and retained Run/attempt identity", async () => {
  const { document, root, settled } = installDom()
  const row = maintainedCassetteRows.find(({ catalogKey }) => catalogKey === "authored:coordinatorProcessDeathContinues")
  if (row === undefined) throw new Error("The continuation-authorization cassette row is missing")
  mountCassetteLab({ revision: "acceptance-revision", root, rows: [row], runCassette: cannedRunner })
  const done = settled(singleCassetteSettledEvent)
  ;(document.querySelector("article button") as HTMLButtonElement | null)?.click()
  await done
  const authorization = document.querySelector("[data-role='continuation-authorization']")
  assert(authorization !== null, "The selected recovery result must render continuation authorization evidence")
  if (authorization === null) return
  const prefixRows = [...authorization.querySelectorAll("[data-role='continuation-prefixes'] tbody tr")]
  assert(prefixRows.length === 3, "The maintained recovery cassette must render pre-auth, post-auth, and terminal prefixes")
  const prefixText = prefixRows.map(({ textContent }) => textContent ?? "").join("|")
  assert(prefixText.includes("BeforeAuthorization") && prefixText.includes("AfterAuthorizationBeforeReport") && prefixText.includes("AfterTerminal"), "Each durable continuation prefix must remain named")
  assert(authorization.textContent?.includes("no recovery event is inferred") === true, "The Lab must explain that coordinator death is not a journal event")
  assert(
    authorization.textContent?.includes("all correlations retain structured Run/attempt identity") === true,
    "The Lab must show structured Run/attempt identity without inventing invocation identities"
  )
  assert(
    authorization.textContent?.includes("ExecutorReportObserved at journal 28") === true,
    "The Lab must distinguish an observed executor report from a command intent"
  )
  assert(authorization.querySelectorAll("[data-role='continuation-witness-operations'] li").length === 4, "All four witness operation identities must be visible")
})

await scenario("links, reveals, and retries cassette failures and Lab defects", async () => {
  const { document, root, settled } = installDom()
  if (mismatchedResult?._tag !== "Failed") throw new Error("The real mismatch result is missing")
  const failureResult = mismatchedResult
  const rows = maintainedCassetteRows.slice(0, 2)
  const calls = new Map<string, number>()
  mountCassetteLab({
    revision: "acceptance-revision",
    root,
    rows,
    runCassette: async (key) => {
      const count = (calls.get(key) ?? 0) + 1
      calls.set(key, count)
      if (key === rows[0]?.catalogKey) return count === 1 ? failureResult : cannedRunner(key)
      throw new Error("synthetic browser composition rejection")
    }
  })
  const allSettled = settled(everyCassetteSettledEvent)
  const runAll = [...document.querySelectorAll("button")].find(({ textContent }) => textContent?.startsWith("Run all "))
  runAll?.click()
  await allSettled
  const problemLink = document.querySelector("[data-role='problem-links'] a") as HTMLAnchorElement | null
  assert(problemLink?.textContent?.includes(rows[0]?.storyName ?? "") === true, "The aggregate must link a failed cassette by human story and exact key")
  const problemLinks = [...document.querySelectorAll<HTMLAnchorElement>("[data-role='problem-links'] a")]
  assert(problemLinks.length === 2, "Cassette failures and Lab defects must both remain navigable")
  assert([...document.querySelectorAll("button")].every(({ disabled }) => !disabled), "A Lab defect must restore usable controls")
  if (problemLink === null) throw new Error("Problem navigation controls are missing")
  problemLink.click()
  assert(document.querySelector("article")?.dataset.catalogKey === rows[0]?.catalogKey, "Problem navigation must select the failed cassette")
  problemLinks[1]?.click()
  assert(document.querySelector("article")?.dataset.state === "LabDefect", "Selecting the defect link must replace the failure UI with the Lab defect")
  assert(document.querySelectorAll("article").length === 1, "Problem navigation must still use the shared surface")
  const rerun = [...document.querySelectorAll("button")].find(({ textContent }) => textContent === "Retry problem cassettes")
  rerun?.click()
  await Promise.all([settled(cassetteSettledEvent), settled(cassetteSettledEvent)])
  assert(calls.get(rows[0]?.catalogKey ?? "") === 2, "Retry problems must repeat the typed cassette failure")
  assert(calls.get(rows[1]?.catalogKey ?? "") === 2, "Retry problems must repeat the separate Lab defect")
})

await scenario("offers an explicit reload escape while a runner is still waiting", () => {
  const { document, root } = installDom()
  let reloadCount = 0
  mountCassetteLab({
    reloadLab: () => { reloadCount += 1 },
    revision: "acceptance-revision",
    root,
    rows: maintainedCassetteRows.slice(0, 1),
    runCassette: () => new Promise(() => undefined)
  })
  ;(document.querySelector("article button") as HTMLButtonElement | null)?.click()
  const reload = [...document.querySelectorAll("button")].find(({ textContent }) => textContent === "Reload Lab and discard displayed results")
  assert(reload?.hidden === false, "A waiting invocation must expose a recovery action")
  reload?.click()
  assert(reloadCount === 1, "The recovery action must reload the isolated Lab")
})

await scenario("the real browser entry runs every maintained cassette and retains every terminal result", async () => {
  const { document, root, settled } = installDom()
  await import("./entry.ts")
  const allSettled = settled(everyCassetteSettledEvent)
  const runAll = [...document.querySelectorAll("button")].find(({ textContent }) => textContent?.startsWith("Run all "))
  runAll?.click()
  await allSettled
  assert(document.querySelectorAll("article").length === 1, "The real entry must retain one shared cassette UI after Run all")
  assert(document.querySelector("article")?.dataset.state === "Completed", "The selected maintained cassette must project its retained terminal result")
  assert(document.querySelectorAll("[data-role='execution-evidence']").length === 1, "Only the selected cassette's retained evidence may be projected")
  const selector = document.querySelector("[data-role='cassette-selector']") as HTMLInputElement | null
  const completedOptions = [...document.querySelectorAll<HTMLOptionElement>("[data-role='cassette-options'] option")]
  assert(completedOptions.length === expectedCatalogSize, "Run all must retain every completed cassette as a searchable result")
  const incompleteOption = completedOptions.find(({ label }) => !label.includes("completed"))
  assert(incompleteOption === undefined, `Every selector choice must expose its retained terminal status: ${incompleteOption?.outerHTML ?? "unknown"}`)
  assert(document.querySelectorAll("section[data-role='delivery-workbench']").length === 1, "Run all must retain one permanent workbench for the selected cassette")
  assert(document.querySelector("[data-role='delivery-workbench'] dalph-delivery-graph") !== null, "The selected cassette's permanent workbench must retain its current graph")
  assert(document.querySelector("details[data-role='all-task-facts']")?.hasAttribute("open") === false, "Run all must keep the secondary all-task matrix collapsed")
  assert([...document.querySelectorAll<HTMLDetailsElement>("[data-role='execution-evidence']")].every(({ open }) => !open), "Run all must keep successful terminal evidence collapsed")
  assert(root.querySelector("[data-role='catalog-summary']")?.textContent?.startsWith(`${expectedCatalogSize} completed`) === true, "The real entry must show the complete catalog summary")
  const replacement = maintainedCassetteRows.find(({ category }) => category === "IntegrationFinality")
  if (selector === null || replacement === undefined) throw new Error("A completed replacement cassette is required")
  chooseCassette(selector, replacement.catalogKey)
  assert(document.querySelector("article")?.dataset.catalogKey === replacement.catalogKey, "Selecting another completed result must replace the projected cassette")
  assert(document.querySelectorAll("[data-role='execution-evidence']").length === 1, "The replacement must not append a second evidence tree")
})

await scenario("reruns one maintained cassette with fresh production identity", async () => {
  const first = everyResult.find(({ catalogKey }) => catalogKey === "authored:singletonTaskCompletes")
  const repeated = await runMaintainedCassette("authored:singletonTaskCompletes")
  assert(first?._tag === "Completed" && repeated._tag === "Completed", "The maintained authored cassette must rerun")
  if (first?._tag === "Completed" && repeated._tag === "Completed") {
    assert(first.runId !== repeated.runId, "A repeat must allocate a fresh production Run identity")
  }
})

console.log(`Reducer Lab ran ${everyResult.length} maintained cassettes through production.`)

// Drop the retained evidence after all browser-command assertions have inspected it.
everyResult = []
