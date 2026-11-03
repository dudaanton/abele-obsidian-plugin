/** Match the displayed basename AND folder; a sibling with the same name is not evidence. */
export function notSyncedRow(root: ParentNode, path: string): HTMLElement | null {
  const split = path.lastIndexOf('/')
  const folder = split < 0 ? '' : path.slice(0, split)
  const name = path.slice(split + 1)
  return (
    Array.from(root.querySelectorAll<HTMLElement>('.abele-not-synced__row')).find(
      (row) =>
        row.querySelector('.abele-not-synced__name')?.textContent?.trim() === name &&
        (row.querySelector('.abele-not-synced__folder')?.textContent?.trim() ?? '') === folder
    ) ?? null
  )
}
