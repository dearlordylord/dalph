import assert from "node:assert/strict"
import {
  decodeCassetteLabUrlSelection,
  encodeCassetteLabUrlSelection
} from "./cassette-lab-url-state.ts"

{
  const decoded = decodeCassetteLabUrlSelection(
    new URL("https://lab.example.test/reducer?keep=yes&cassette=authored%3Astory&step=3#evidence")
  )
  assert.deepEqual(decoded, {
    cassetteKey: "authored:story",
    invalid: false,
    stepIndex: 2
  })
}

for (const query of [
  "cassette=authored%3Astory&step=0",
  "cassette=authored%3Astory&step=-1",
  "cassette=authored%3Astory&step=1.5",
  "cassette=authored%3Astory&step=nope",
  "cassette=authored%3Astory&step=1&step=2",
  "cassette=one&cassette=two",
  "step=2"
]) {
  assert.equal(
    decodeCassetteLabUrlSelection(new URL(`https://lab.example.test/reducer?${query}`)).invalid,
    true,
    `${query} must be rejected as non-canonical Lab URL state`
  )
}

{
  const current = new URL("https://lab.example.test/reducer?keep=yes&cassette=old&step=8#evidence")
  const encoded = encodeCassetteLabUrlSelection(current, {
    cassetteKey: "authored:new-story",
    stepIndex: 1
  })
  assert.equal(encoded.pathname, "/reducer")
  assert.equal(encoded.searchParams.get("keep"), "yes")
  assert.equal(encoded.searchParams.get("cassette"), "authored:new-story")
  assert.equal(encoded.searchParams.get("step"), "2")
  assert.equal(encoded.hash, "#evidence")

  const live = encodeCassetteLabUrlSelection(encoded, {
    cassetteKey: "authored:new-story",
    stepIndex: null
  })
  assert.equal(live.searchParams.get("step"), null)
  assert.equal(live.searchParams.get("keep"), "yes")
}

console.log("✓ decodes and canonicalizes Reducer Lab URL selection without changing unowned URL state")
