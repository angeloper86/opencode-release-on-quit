import { Plugin } from "@opencode/plugin/tui"

type SessionLike = {
  location?: { directory?: string }
}

export default Plugin.define({
  id: "opencode-release-on-quit",
  setup(context) {
    // Spawn a detached helper that waits for this process to exit and then
    // disposes the given locations' cached services. Doing the release only
    // after death avoids two failure modes seen in practice: the dying
    // client's last syncs re-loading the location right after an inline
    // release, and plugin reloads running the cleanup while the app is alive.
    async function spawnDeferredRelease(directories: string[]): Promise<void> {
      if (directories.length === 0) return
      try {
        const { spawn } = await import("node:child_process")
        const { fileURLToPath } = await import("node:url")
        const helper = fileURLToPath(new URL("./evict-deferred.mjs", import.meta.url))
        const child = spawn("node", [helper, ...directories], { detached: true, stdio: "ignore" })
        child.unref?.()
      } catch {
        // Best effort: quitting must never fail because of the helper.
      }
    }

    // The client disposes several plugin instances during shutdown, so they
    // share a guard and only the first one spawns the helper.
    const [cleanupState, setCleanupState] = context.storage.memory("cleanup", { initial: { lastRunAt: 0 } })

    // Release on quit: dispose the cached services for this window's own project
    // (and the session it was viewing) once this process is gone. Best effort:
    // never block quitting.
    return async () => {
      const now = Date.now()
      if (now - cleanupState.lastRunAt < 5000) return
      setCleanupState((draft) => {
        draft.lastRunAt = now
      })

      const directories = new Set<string>()
      const own = context.location?.directory
      if (own) directories.add(own)
      try {
        const route = context.ui.router.current()
        if (route.type === "session") {
          const session = context.data.session.get(route.sessionID) as unknown as SessionLike | undefined
          const directory = session?.location?.directory
          if (directory) directories.add(directory)
        }
      } catch {
        // Router state may already be gone during shutdown.
      }

      await spawnDeferredRelease([...directories])
    }
  },
})
