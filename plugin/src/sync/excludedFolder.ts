/** Canonical selector for matching and placing SDK folder exclusions. Empty selectors do not match. */
export function excludedFolderPrefix(folder: string): string {
  return folder.normalize('NFC').replace(/\/+$/, '')
}
