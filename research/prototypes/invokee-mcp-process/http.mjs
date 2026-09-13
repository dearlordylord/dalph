// THROWAWAY: local Unix-socket JSON requests, no retry or network discovery.
import { request } from "node:http"
export const callBackend = (socketPath, path, body, signal) => new Promise((resolve, reject) => {
  const req = request({ socketPath, path, method: body === undefined ? "GET" : "POST", agent: false, signal,
    headers: { "content-type": "application/json" } }, (res) => {
    let text = ""
    res.setEncoding("utf8")
    res.on("data", (chunk) => { text += chunk })
    res.on("error", reject)
    res.on("end", () => {
      try {
        if (res.statusCode !== 200) throw new Error(`backend status ${res.statusCode}: ${text}`)
        resolve(JSON.parse(text))
      } catch (error) { reject(error) }
    })
  })
  req.setTimeout(20_000, () => req.destroy(new Error("backend request timed out")))
  req.on("error", reject)
  req.end(body === undefined ? undefined : JSON.stringify(body))
})
