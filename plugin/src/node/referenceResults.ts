import { reactive } from 'vue'
import type { NodeLspDocument, LspLocation, LspPosition } from './NodeLspDocument'
import type { ResultFile } from '@/repository/model'

export interface ReferenceResults {
  symbol: string
  more?: () => Promise<void>
  presenter?: symbol
  shown: boolean
  loading: boolean
  message: string
  files: ResultFile[]
  count: number
  fileCount: number
  omitted: number
  definitions: string[]
  active: string
  generation: number
  locations: Record<string, LspLocation>
}
export function createReferenceResults(): ReferenceResults {
  return reactive({
    symbol: '',
    shown: false,
    loading: false,
    message: '',
    files: [],
    count: 0,
    fileCount: 0,
    omitted: 0,
    definitions: [],
    active: '',
    generation: 0,
    locations: {},
  })
}
const results = new WeakMap<object, Map<string, ReferenceResults>>()
export function referenceResultsFor(client: object, root: string): ReferenceResults {
  let roots = results.get(client)
  if (!roots) results.set(client, (roots = new Map()))
  let state = roots.get(root)
  if (!state) {
    if (roots.size >= 16) roots.delete(roots.keys().next().value)
    roots.set(root, (state = createReferenceResults()))
  }
  return state
}
export const referenceLocationKey = (hit: LspLocation) =>
  JSON.stringify([hit.path, hit.range.start.line, hit.range.start.character])

/** Bounded preview reads, one per file, with superseded queries unable to replace newer results. */
export async function findNodeReferences(
  state: ReferenceResults,
  document: NodeLspDocument,
  position: LspPosition,
  text: string,
  read: (path: string) => Promise<string>,
  unavailable: () => string,
  symbol = ''
) {
  const originPath = document.path
  const generation = ++state.generation
  const current = () => generation === state.generation
  Object.assign(state, {
    symbol,
    more: undefined,
    locations: {},
    shown: true,
    loading: true,
    message: '',
    files: [],
    definitions: [],
    active: '',
    count: 0,
    fileCount: 0,
    omitted: 0,
  })
  try {
    const hits = await document.query('references', position, text)
    if (!current()) return
    state.message = unavailable()
    if (state.message) return
    if (!hits.length) return
    const definitions = await document.query('definition', position, text)
    if (!current()) return
    const unique = [
      ...new Map([...hits, ...definitions].map((hit) => [referenceLocationKey(hit), hit])).values(),
    ]
    const definitionKeys = new Set(definitions.map(referenceLocationKey))
    unique.sort(
      (a, b) =>
        Number(b.path === originPath) - Number(a.path === originPath) ||
        a.path.localeCompare(b.path) ||
        a.range.start.line - b.range.start.line ||
        a.range.start.character - b.range.start.character
    )
    state.count = unique.length
    state.fileCount = new Set(unique.map((hit) => hit.path)).size
    const files = new Map<string, ResultFile>()
    const sources = new Map<string, string[]>()
    let shown = 0
    let reading = false
    const load = async () => {
      if (!current() || reading) return
      reading = true
      state.loading = true
      const end = Math.min(shown + 100, unique.length)
      for (const hit of unique.slice(shown, end)) {
        if (!current()) return
        let lines = sources.get(hit.path)
        if (!lines) {
          let source = ''
          try {
            source = hit.path === originPath ? text : await read(hit.path)
          } catch (error) {
            console.debug('[node] Reference preview unavailable', error)
          }
          if (!current()) return
          sources.set(hit.path, (lines = source.split('\n')))
        }
        let file = files.get(hit.path)
        if (!file) files.set(hit.path, (file = { path: hit.path, url: hit.path, lines: [] }))
        const url = referenceLocationKey(hit)
        const raw = lines[hit.range.start.line] ?? ''
        const trim = raw.length - raw.trimStart().length
        state.locations[url] = hit
        file.lines.push({
          url,
          label: String(hit.range.start.line + 1),
          text: raw.trim(),
          column: Math.max(0, hit.range.start.character - trim),
          length:
            hit.range.end.line === hit.range.start.line
              ? hit.range.end.character - hit.range.start.character
              : 0,
        })
        if (definitionKeys.has(url)) state.definitions.push(url)
      }
      shown = end
      state.files = [...files.values()]
      state.omitted = unique.length - shown
      state.more = state.omitted ? load : undefined
      state.loading = false
      reading = false
    }
    await load()
  } finally {
    if (current()) state.loading = false
  }
}
