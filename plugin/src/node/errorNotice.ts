import { Notice } from 'obsidian'
import { nodeErrorWords } from './errorWords'
import { presentUiError } from '@/i18n/streamBErrors'

/** Transient node errors use plain words; retain the diagnostic in the tooltip. */
export function nodeErrorNotice(error: unknown, fallback = 'Node request failed'): Notice {
  const raw =
    error instanceof Error ? presentUiError(error) : typeof error === 'string' ? error : fallback
  const content = createFragment()
  content.append(createSpan({ text: nodeErrorWords(raw), attr: { title: raw } }))
  return new Notice(content)
}
