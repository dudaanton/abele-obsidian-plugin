import { reactive } from 'vue'
import type { NodeLspDocument, LspLocation, LspPosition } from './NodeLspDocument'
import type { ResultFile } from '@/repository/model'

export interface ReferenceResults {
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
  unavailable: () => string
) {
  const generation = ++state.generation
  const current = () => generation === state.generation
  Object.assign(state, {
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
    const unique = [...new Map(hits.map((hit) => [referenceLocationKey(hit), hit])).values()]
    const definitionKeys = new Set(definitions.map(referenceLocationKey))
    const definitionFiles = new Set(definitions.map((hit) => hit.path))
    unique.sort(
      (a, b) =>
        Number(definitionFiles.has(b.path)) - Number(definitionFiles.has(a.path)) ||
        a.path.localeCompare(b.path) ||
        a.range.start.line - b.range.start.line ||
        a.range.start.character - b.range.start.character
    )
    state.count = unique.length
    state.fileCount = new Set(unique.map((hit) => hit.path)).size
    state.locations = Object.fromEntries(
      unique.slice(0, 100).map((hit) => [referenceLocationKey(hit), hit])
    )
    state.omitted = Math.max(0, unique.length - 100)
    const files = new Map<string, ResultFile>()
    for (const hit of unique.slice(0, 100)) {
      let file = files.get(hit.path)
      if (!file) files.set(hit.path, (file = { path: hit.path, url: hit.path, lines: [] }))
      const url = referenceLocationKey(hit)
      file.lines.push({
        url,
        label: String(hit.range.start.line + 1),
        text: '',
        column: hit.range.start.character,
        length:
          hit.range.end.line === hit.range.start.line
            ? hit.range.end.character - hit.range.start.character
            : 0,
      })
      if (definitionKeys.has(url)) state.definitions.push(url)
    }
    // Sequential bounded reads keep large reference sets from flooding the node transport.
    for (const file of files.values()) {
      if (!current()) return
      let source = ''
      try {
        source = file.path === document.path ? text : await read(file.path)
      } catch (error) {
        console.debug('[node] Reference preview unavailable', error)
      }
      const lines = source.split('\n')
      for (const line of file.lines) {
        const raw = lines[Number(line.label) - 1] ?? ''
        const trim = raw.length - raw.trimStart().length
        line.text = raw.trim()
        line.column = Math.max(0, line.column - trim)
      }
    }
    if (current()) state.files = [...files.values()]
  } finally {
    if (current()) state.loading = false
  }
}
