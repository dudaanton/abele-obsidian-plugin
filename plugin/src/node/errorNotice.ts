import { Notice } from 'obsidian'
import { nodeErrorDetails } from './errorWords'

/** Transient node errors use the same words and retained diagnostic as persistent lines. */
export function nodeErrorNotice(error: unknown, fallback = 'Node request failed'): Notice {
  const raw = error instanceof Error ? error.message : typeof error === 'string' ? error : fallback
  const content = createFragment()
  content.append(createSpan({ text: nodeErrorDetails(raw), attr: { title: raw } }))
  return new Notice(content)
}
