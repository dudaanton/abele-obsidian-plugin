export function nodeFailureMessage(error: unknown, state: string, stderr: string): string {
  return `${error instanceof Error ? error.message : String(error)}\nnode: ${state}\n${stderr.slice(-1200)}`
}

/** Debugger failures include stop/point evidence after the first few hundred characters. */
export function parseDebugAttachResult<T>(raw: string): T {
  try {
    return JSON.parse(raw) as T
  } catch {
    throw new Error(`Not JSON from the app: ${raw}`)
  }
}

export async function cleanupCreatedViews(
  workspace: {
    getLeavesOfType(type: string): { id: string; detach(): void }[]
    requestSaveLayout: { run(): unknown }
  },
  ids: readonly string[],
  types: readonly string[]
): Promise<void> {
  for (const type of types)
    for (const leaf of workspace.getLeavesOfType(type)) if (ids.includes(leaf.id)) leaf.detach()
  await workspace.requestSaveLayout.run()
}

/** Runs in the active window, before switching away from its separately saved phone layout. */
export async function cleanupDebugAttachViews(
  api: { DebuggerService: { instance: { destroy(): void } } },
  workspace: {
    getLeavesOfType(type: string): { detach(): void }[]
    requestSaveLayout: { run(): unknown }
  }
): Promise<void> {
  // A completed trace can otherwise reopen a run tab after the cleanup has closed it.
  api.DebuggerService.instance.destroy()
  for (const type of [
    'abele-node-file',
    'abele-debug-view',
    'abele-trace-run',
    'abele-trace-value',
  ])
    for (const leaf of workspace.getLeavesOfType(type)) leaf.detach()
  await workspace.requestSaveLayout.run()
}
