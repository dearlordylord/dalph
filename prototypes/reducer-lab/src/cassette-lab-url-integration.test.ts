import assert from "node:assert/strict"
import { parseHTML } from "linkedom"
import {
  mountCassetteLab,
  singleCassetteSettledEvent
} from "./cassette-lab-browser.ts"
import {
  maintainedCassetteRows,
  runMaintainedCassette,
  type MaintainedCassetteKey
} from "./cassette-lab.ts"
import type { CassetteLabUrlAdapter } from "./cassette-lab-url-state.ts"

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
  return { document, root }
}

const controlledUrlAdapter = (initialHref: string) => {
  let current = new URL(initialHref)
  const listeners = new Set<() => void>()
  const adapter: CassetteLabUrlAdapter = {
    read: () => new URL(current.href),
    replace: (url) => {
      current = new URL(url.href)
    },
    subscribe: (listener) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    }
  }
  return {
    adapter,
    current: () => new URL(current.href),
    navigate: (href: string) => {
      current = new URL(href)
      for (const listener of listeners) listener()
    }
  }
}

const urlFixtureRow = maintainedCassetteRows.find(({ catalogKey }) =>
  catalogKey === "authored:dependentTasksCompleteInOneRun")
if (urlFixtureRow === undefined) throw new Error("The URL playback fixture is missing")
const urlFixtureResult = await runMaintainedCassette(urlFixtureRow.catalogKey)
if (
  urlFixtureResult._tag !== "Completed"
  || urlFixtureResult.observationMoments === null
  || urlFixtureResult.observationMoments.length < 3
) {
  throw new Error("The URL playback cassette did not produce the required observed moments")
}

{
  const { document, root } = installDom()
  const url = controlledUrlAdapter(
    `https://lab.example.test/reducer?keep=yes&cassette=${encodeURIComponent(urlFixtureRow.catalogKey)}&step=2#evidence`
  )
  const calls: Array<MaintainedCassetteKey> = []
  const settled = new Promise<void>((resolve) =>
    root.addEventListener(singleCassetteSettledEvent, () => resolve(), { once: true }))
  mountCassetteLab({
    revision: "acceptance-revision",
    root,
    rows: maintainedCassetteRows,
    runCassette: async (catalogKey) => {
      calls.push(catalogKey)
      return urlFixtureResult
    },
    urlAdapter: url.adapter
  })
  assert.equal(document.querySelector("article")?.getAttribute("data-catalog-key"), urlFixtureRow.catalogKey)
  await settled
  assert.deepEqual(calls, [urlFixtureRow.catalogKey], "Refresh must execute the exact URL-selected cassette once")
  assert.equal(
    document.querySelector<HTMLElement>(".delivery-timeline-controls output")?.textContent?.startsWith("2 / "),
    true,
    "The pending URL step must restore after automatic execution"
  )

  document.querySelector<HTMLButtonElement>("button[data-role='next-frame']")?.click()
  assert.equal(url.current().searchParams.get("step"), "3")
  document.querySelector<HTMLButtonElement>("button[data-role='follow-live']")?.click()
  assert.equal(url.current().searchParams.get("step"), null)
  assert.equal(url.current().searchParams.get("keep"), "yes")
  assert.equal(url.current().hash, "#evidence")
  console.log("✓ refresh executes the URL-selected cassette and restores its playback step")
}

{
  const { document, root } = installDom()
  const url = controlledUrlAdapter("https://lab.example.test/reducer?keep=yes")
  let runCount = 0
  mountCassetteLab({
    revision: "acceptance-revision",
    root,
    rows: [urlFixtureRow],
    runCassette: async () => {
      runCount += 1
      return urlFixtureResult
    },
    urlAdapter: url.adapter
  })
  assert.equal(runCount, 0, "A missing cassette parameter must retain the ordinary non-running initial state")
  assert.equal(url.current().searchParams.get("cassette"), null, "The default selection must remain absent from the URL")
  const settled = new Promise<void>((resolve) =>
    root.addEventListener(singleCassetteSettledEvent, () => resolve(), { once: true }))
  url.navigate(
    `https://lab.example.test/reducer?keep=yes&cassette=${encodeURIComponent(urlFixtureRow.catalogKey)}&step=1`
  )
  await settled
  assert.equal(document.querySelector("article")?.getAttribute("data-catalog-key"), urlFixtureRow.catalogKey)
  assert.equal(runCount, 1, "Browser navigation must execute a valid cassette that has not run locally")
  assert.equal(url.current().searchParams.get("step"), "1")
  assert.equal(
    document.querySelector<HTMLElement>(".delivery-timeline-controls output")?.textContent?.startsWith("1 / "),
    true
  )
  console.log("✓ browser navigation executes a valid cassette that has not run locally")
}
