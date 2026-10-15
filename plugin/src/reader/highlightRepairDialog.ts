import type { App } from 'obsidian'
import { openDialog } from '@/components/obsidian/dialogs'
import BookRepairLinks from '@/components/reader/BookRepairLinks.vue'
import type { HighlightRepairCandidate } from './highlightRepair'

/** No write or implicit confirmation: every way to close except the explicit button cancels. */
export function askToRepairLinks(
  _app: App,
  items: HighlightRepairCandidate[]
): {
  answer: Promise<boolean>
  cancel: () => void
} {
  const cancelled = new AbortController()
  const answer = openDialog<boolean>(BookRepairLinks, { items }, { signal: cancelled.signal }).then(
    (accepted) => accepted === true
  )
  return { answer, cancel: () => cancelled.abort() }
}
