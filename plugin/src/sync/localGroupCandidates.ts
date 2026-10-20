import { groupLinkKey } from '@abele/sync-sdk/protocol'

/** Cached membership proposes discovery only; core still validates the actual note bytes. */
export function localGroupCandidates(
  root: string,
  notes: readonly { path: string; groups: unknown }[]
): string[] {
  const exact = new Map<string, string | null>(),
    suffix = new Map<string, string | null>()
  const add = (map: Map<string, string | null>, key: string, path: string) => {
    if (!map.has(key)) map.set(key, path)
    else if (map.get(key) !== path) map.set(key, null)
  }
  const paths = new Set([root, ...notes.map((one) => one.path)])
  for (const path of paths) {
    const key = path.replace(/\.md$/i, '').normalize('NFC').toLowerCase()
    add(exact, key, path)
    const parts = key.split('/')
    for (let i = 1; i < parts.length; i++) add(suffix, parts.slice(i).join('/'), path)
  }
  const reverse = new Map<string, Set<string>>()
  for (const note of notes) {
    const cached = note.groups
    const groups = Array.isArray(cached) ? cached : [cached]
    for (const link of groups) {
      if (typeof link !== 'string') continue
      const key = groupLinkKey(link, note.path)
      if (!key) continue
      const target = exact.has(key) ? exact.get(key) : suffix.get(key)
      if (!target) continue
      let members = reverse.get(target)
      if (!members) reverse.set(target, (members = new Set()))
      members.add(note.path)
    }
  }
  const found = new Set([root]),
    queue = [root]
  for (let i = 0; i < queue.length; i++)
    for (const path of reverse.get(queue[i]) ?? [])
      if (!found.has(path)) {
        found.add(path)
        queue.push(path)
      }
  return [...found]
}
