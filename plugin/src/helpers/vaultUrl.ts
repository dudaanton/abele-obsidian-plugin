/**
 * The address a file of the vault is loaded from, another one for each version of the file.
 *
 * On a desktop Obsidian's own address already carries the file's time. On an iPhone or an iPad
 * it is the same address whatever the file holds, and the browser, handed an address it has
 * loaded before, shows what it loaded then — a picture rotated, made smaller or drawn on stays
 * as it was until Obsidian is restarted. There the file's time and size are added. A `#fragment`
 * would not do: the browser's cache does not see it.
 */
import type { App, TFile } from 'obsidian'

export function versionedUrl(url: string, file: TFile): string {
  if (url.includes('?')) return url
  return `${url}?${file.stat.mtime}-${file.stat.size}`
}

export const vaultUrl = (app: App, file: TFile): string =>
  versionedUrl(app.vault.getResourcePath(file), file)
