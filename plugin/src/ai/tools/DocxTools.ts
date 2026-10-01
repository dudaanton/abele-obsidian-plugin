import { TFile } from 'obsidian'
import type { AgentTool } from '../client'
import { GlobalStore } from '@/stores/GlobalStore'
import { ScopeResolver } from '../ScopeResolver'
import { openDocx } from '@/word/package'
import { DOCX_VIEW_TYPE, type DocxView } from '@/word/DocxView'

export function namedDocx(input: unknown): TFile {
  const path = typeof input === 'string' ? input : ''
  if (!ScopeResolver.getInstance().isInScope(path))
    throw new Error(`Access denied: ${path} is outside this chat's scope`)
  const file = GlobalStore.getInstance().app.vault.getAbstractFileByPath(path)
  if (!(file instanceof TFile) || file.extension.toLowerCase() !== 'docx')
    throw new Error('Name a .docx file by its exact vault path')
  return file
}
const answer = (text: string) => ({ content: [{ type: 'text' as const, text }] })
const integer = (value: unknown, fallback: number, max: number) =>
  Math.min(max, Math.max(1, Math.floor(Number(value) || fallback)))
const properties = { path: { type: 'string', description: 'Exact vault path of a .docx file' } }
export function createDocxTools(): AgentTool[] {
  return [
    {
      name: 'docx_views',
      label: 'Word tabs',
      category: 'Word',
      description:
        'List open Word documents in this chat’s scope and the paragraph text window shown. Read-only.',
      parameters: { type: 'object', properties: {} },
      execute: async () => {
        const app = GlobalStore.getInstance().app
        return answer(
          app.workspace
            .getLeavesOfType(DOCX_VIEW_TYPE)
            .map((leaf) => leaf.view as DocxView)
            .filter((v) => v.file && ScopeResolver.getInstance().isInScope(v.file.path))
            .map(
              (v) =>
                `${v.file!.path} — paragraph ${v.paragraph}, ${v.document?.paragraphs.length ?? 0} paragraphs`
            )
            .join('\n') || 'No Word document is open in scope.'
        )
      },
    },
    {
      name: 'docx_read',
      label: 'Read Word document',
      category: 'Word',
      description:
        'Read Word text by numbered paragraph window, including table-cell coordinates, styles, headers/footers, comments and notes. Deleted revisions are excluded. The document need not be open. Output bounded to 25000 characters; use smaller counts/offset for long paragraphs.',
      parameters: {
        type: 'object',
        properties: {
          ...properties,
          start: { type: 'number', description: 'First paragraph, from 1' },
          count: { type: 'number', description: 'Paragraphs, default 50, max 200' },
          offset: { type: 'number', description: 'Character offset in this paragraph window' },
          limit: { type: 'number', description: 'Characters, default 12000, max 25000' },
        },
        required: ['path'],
      },
      execute: async (_id, params, signal) => {
        const file = namedDocx(params.path)
        const doc = await openDocx(
          new Uint8Array(await GlobalStore.getInstance().app.vault.readBinary(file))
        )
        signal?.throwIfAborted()
        const start = integer(params.start, 1, doc.paragraphs.length)
        const count = integer(params.count, 50, 200)
        const offset = Math.max(0, Math.floor(Number(params.offset) || 0))
        const limit = integer(params.limit, 12000, 25000)
        const text = doc.read(start, count, Number.MAX_SAFE_INTEGER)
        return answer(
          `${file.path}: ${doc.paragraphs.length} paragraphs; window from ${start}, characters ${offset}–${Math.min(text.length, offset + limit)} of ${text.length}.\n\n${text.slice(offset, offset + limit)}${offset + limit < text.length ? `\n[Continue with offset ${offset + limit}.]` : `\n[Next paragraph window: start ${start + count}.]`}`
        )
      },
    },
    {
      name: 'docx_search',
      label: 'Search Word document',
      category: 'Word',
      description:
        'Literal case-insensitive search in Word text, including split runs and supplementary parts. Returns numbered paragraphs and character offsets, 20 finds by default (max 40). after continues the result page. Read-only.',
      parameters: {
        type: 'object',
        properties: {
          ...properties,
          query: { type: 'string' },
          after: { type: 'number' },
          limit: { type: 'number' },
        },
        required: ['path', 'query'],
      },
      execute: async (_id, params, signal) => {
        const file = namedDocx(params.path)
        const query = typeof params.query === 'string' ? params.query : ''
        if (!query || query.length > 1000) throw new Error('Search text must be 1–1000 characters')
        const doc = await openDocx(
          new Uint8Array(await GlobalStore.getInstance().app.vault.readBinary(file))
        )
        signal?.throwIfAborted()
        const after = Math.max(0, Math.floor(Number(params.after) || 0))
        const result = doc.search(query, after, integer(params.limit, 20, 40))
        return answer(
          `${result.total} matches in ${file.path}.\n${result.finds.map((f) => `Paragraph ${f.paragraph}, offset ${f.offset}: ${f.excerpt}`).join('\n')}\n[Continue with after ${after + result.finds.length}.]`
        )
      },
    },
  ]
}
