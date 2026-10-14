/** Serialize these functions into live probes; no module state is available in the app. */
interface FixtureLeaf {
  view: { requestSave?: { cancel?: () => unknown }; save?: () => Promise<unknown> }
  setViewState(state: { type: string }): Promise<unknown>
  detach(): unknown
}

export async function closeFixtureLeaves(leaves: FixtureLeaf[]): Promise<void> {
  for (const leaf of leaves) {
    // Flush, do not throw away, the edits whose two-second timer would outlive deletion.
    leaf.view.requestSave?.cancel?.()
    await leaf.view.save?.()
    // detach() is not awaitable. Text-file unload can save again; await the empty transition
    // while its fixture still exists, then remove the empty leaf and finally delete files.
    await leaf.setViewState({ type: 'empty' })
    leaf.detach()
  }
}

export async function dismissBoundaryNotices(
  doc: Document,
  wait: () => Promise<unknown>,
  attempts = 100
): Promise<string[]> {
  const notices = [...doc.querySelectorAll<HTMLElement>('.notice')]
  const text = notices.map((notice) => notice.textContent ?? '')
  for (const notice of notices) notice.click()
  for (let i = 0; i < attempts; i++) {
    if (notices.every((notice) => !notice.isConnected)) return text
    await wait()
  }
  throw new Error('Previous file notices did not dismiss: ' + JSON.stringify(text))
}
