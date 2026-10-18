import { UiError, uiMessage } from '@/i18n/streamBErrors'
import type { NodeClient } from '@abele/node-client'

export type NodeSession = Awaited<ReturnType<NodeClient['getSession']>>
/** Lists can be byte-bounded well below 256 entries. Only an empty page is terminal. */
export async function nodePages<T>(
  read: (after?: string) => Promise<T[]>,
  id: (item: T) => string
): Promise<T[]> {
  const all: T[] = []
  let after: string | undefined
  for (;;) {
    const page = await read(after)
    if (!page.length) return all
    const next = id(page[page.length - 1])
    if (next === after) throw new UiError(uiMessage('streamBError.fd3e95b2aa'))
    all.push(...page)
    after = next
  }
}
