// Deferred eviction helper for the release-on-quit plugin.
//
// The TUI spawns this detached during shutdown. It waits until the TUI process
// is really gone (the parent changes), then disposes cached services. When no
// other OpenCode client is running, it sweeps every loaded location so the end
// of the day actually leaves nothing behind.
import { appendFile } from "node:fs/promises"
import { execSync } from "node:child_process"
import { Service } from "@opencode/client/service"
import { OpenCode } from "@opencode/client"

const logPath = `${process.env.HOME ?? ""}/.local/share/opencode/release-on-quit.log`
const log = async (message) => {
  try {
    await appendFile(logPath, `${new Date().toISOString()} ${message}\n`)
  } catch {
    // Logging is best effort.
  }
}

const directories = process.argv.slice(2)
if (directories.length === 0) process.exit(0)

const startedAt = Date.now()
const initialPPID = process.ppid
await log(`start ppid=${initialPPID} dirs=${directories.length}`)

// Wait for the TUI to exit: a detached child is reparented when its parent
// dies, so process.ppid stops matching. A parent that is already gone (ppid
// 1) means the spawn happened late: proceed directly. Give up after 90s and
// skip instead of evicting under a still-running client.
if (initialPPID !== 1) {
  const deadline = startedAt + 90_000
  while (process.ppid === initialPPID && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 200))
  }
  if (process.ppid === initialPPID) {
    await log("parent never exited; skipping")
    process.exit(0)
  }
  await log(`parent gone after ${Date.now() - startedAt}ms`)
} else {
  await log("parent already gone at start")
}

// Grace period for any request already in flight from the dying client.
await new Promise((resolve) => setTimeout(resolve, 1500))

const endpoint = await Service.discover().catch(() => undefined)
if (!endpoint) {
  await log("service not found; skipping")
  process.exit(0)
}

const client = OpenCode.make({ baseUrl: endpoint.url, headers: Service.headers(endpoint) })
const unwrap = (value) => (value && typeof value === "object" && "data" in value ? value.data : value)

// Count running OpenCode clients (TUI or CLI), excluding the background
// service and this helper itself.
const countClients = () => {
  try {
    const output = execSync("ps -axo command", { encoding: "utf8" })
    let count = 0
    for (const line of output.split("\n")) {
      const command = line.trim()
      if (!command || command.includes("serve --service") || command.includes("evict-deferred")) continue
      if (command === "opencode" || command.startsWith("opencode ") || command.includes("/.opencode/bin/opencode")) count++
    }
    return count
  } catch {
    return 1 // On failure assume other clients exist and stay scoped.
  }
}

const targets = new Set(directories)
const otherClients = countClients()
if (otherClients === 0) {
  await log("no other clients; sweeping all loaded locations")
  try {
    const loaded = unwrap(await client.debug.location.list()) ?? []
    for (const entry of loaded) {
      const directory = entry?.directory
      if (directory) targets.add(directory)
    }
  } catch {
    // Fall back to the directories we were given.
  }
} else {
  await log(`other clients running: ${otherClients}`)
}

for (const directory of targets) {
  const active = unwrap(await client.session.active().catch(() => ({}))) ?? {}
  let busy = false
  for (const id of Object.keys(active)) {
    const info = await client.session.get({ sessionID: id }).catch(() => undefined)
    if (info?.location?.directory === directory) {
      busy = true
      break
    }
  }
  if (busy) {
    await log(`skipped (busy): ${directory}`)
    continue
  }
  try {
    await client.debug.location.evict({ location: { directory } })
    await log(`evicted: ${directory}`)
  } catch (error) {
    await log(`evict failed: ${directory}: ${error?.message ?? error}`)
  }
}

await log("done")
process.exit(0)
