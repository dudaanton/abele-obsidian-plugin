/**
 * Where the links in a person's message point, told to the agent.
 *
 * A link is written the way the vault's settings say — usually by name alone, `[[Budget]]` —
 * and the agent's tools take a path. Left to itself the agent guesses, or searches, and with
 * two notes of one name it can settle on the wrong one. So the message the model receives ends
 * with the path each link resolves to, the way Obsidian resolves it. What the person sees in
 * the chat is left as they wrote it.
 *
 * Only notes the chat can reach are named: a link to anything outside its scope tells the
 * agent nothing it could act on, and naming the path would say what is in a part of the vault
 * it was not given.
 */
import type { App } from 'obsidian'
import type { ScopeResolver } from './ScopeResolver'

const WIKILINK = /!?\[\[([^\]|#^]+)(?:[#^][^\]|]*)?(?:\|[^\]]*)?\]\]/g
const MDLINK = /!?\[[^\]]*\]\(([^)\s]+)\)/g
const SCHEME = /^[a-z][a-z0-9+.-]*:/i

/** Every link target in the text, as written, first occurrence first. */
export function linkTargets(text: string): string[] {
  const found: { at: number; target: string }[] = []
  for (const m of text.matchAll(WIKILINK)) found.push({ at: m.index, target: m[1].trim() })
  for (const m of text.matchAll(MDLINK)) {
    const raw = m[1].replace(/^<|>$/g, '')
    if (SCHEME.test(raw)) continue
    let target = raw.split('#')[0]
    try {
      target = decodeURI(target)
    } catch {
      // A malformed escape is taken as written.
    }
    if (target) found.push({ at: m.index, target })
  }
  return [...new Set(found.sort((a, b) => a.at - b.at).map((f) => f.target))]
}

/** The line appended for the model, or '' when no link needs explaining. */
export function linkedNotesNote(text: string, app: App, scope: ScopeResolver): string {
  const lines: string[] = []
  const named = new Set<string>()
  for (const target of linkTargets(text)) {
    const file = app.metadataCache.getFirstLinkpathDest(target, '')
    if (!file || named.has(file.path) || !scope.isInScope(file.path)) continue
    // Written as the path already: nothing to explain.
    if (target === file.path || `${target}.md` === file.path) continue
    named.add(file.path)
    lines.push(`- "${target}" is ${file.path}`)
  }
  return lines.length ? `\n\n[Links in this message resolve to:\n${lines.join('\n')}]` : ''
}
