import { spec } from "node:test/reporters"

// Let Node render every event so its suite tracking, failure details and final totals stay native.
// Only the output of an ordinary passing test is omitted; skip/todo and all other events remain visible.
export default async function* compactNodeTestReporter(source) {
  const reporter = new spec()
  let rendered = []
  reporter.on("data", (chunk) => rendered.push(chunk))
  // Transform errors are also delivered to the write/end callbacks below.
  reporter.on("error", () => {})
  try {
    for await (const event of source) {
      await new Promise((resolve, reject) => {
        reporter.write(event, (error) => (error ? reject(error) : resolve()))
      })
      if (event.type !== "test:pass" || event.data.skip || event.data.todo) {
        yield* rendered
      }
      rendered = []
    }
    await new Promise((resolve, reject) => {
      reporter.end((error) => (error ? reject(error) : resolve()))
    })
    yield* rendered
  } finally {
    reporter.destroy()
  }
}
