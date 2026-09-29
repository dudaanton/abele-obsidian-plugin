import type { TFile } from 'obsidian'
import { GlobalStore } from '@/stores/GlobalStore'

/** Always a wikilink, even in vaults configured to write Markdown links. */
export function noteWikilink(file: TFile): string {
  const { metadataCache } = GlobalStore.getInstance().app
  return `[[${metadataCache.fileToLinktext(file, '')}]]`
}
