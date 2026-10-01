import { TFile } from 'obsidian'
import type { AgentTool } from '../client'
import { GlobalStore } from '@/stores/GlobalStore'
import { ScopeResolver } from '../ScopeResolver'
import { wordRevision } from '@/word/write'
import { loadWordBytes as openDocx, prepareWordChange, writeWordChange } from '@/word/vaultAdapter'
import { WORD_OPERATIONS, type WordEdit } from '@/word/edit'
import { DOCX_VIEW_TYPE, type DocxView } from '@/word/DocxView'

export function namedDocx(input: unknown): TFile {
  const path = typeof input === 'string' ? input : ''
  if (!ScopeResolver.getInstance().isInScope(path))
    throw new Error(`Access denied: ${path} is outside this chat's scope`)
  const file = GlobalStore.getInstance().app.vault.getAbstractFileByPath(path)
  if (!(file instanceof TFile) || file.extension.toLowerCase() !== 'docx')
    throw new Error('Name a .docx file by its exact vault path')
  if (!ScopeResolver.getInstance().isInScope(file.path))
    throw new Error(`Access denied: ${file.path} is outside this chat's scope`)
  return file
}
const answer = (text: string) => ({ content: [{ type: 'text' as const, text }] })
const integer = (value: unknown, fallback: number, max: number) =>
  Math.min(max, Math.max(1, Math.floor(Number(value) || fallback)))
const properties = { path: { type: 'string', description: 'Exact vault path of a .docx file' } }
export function createDocxTools(): AgentTool[] {
  return [
    {
      name: 'docx_edit',
      label: 'Edit Word document',
      category: 'Word',
      description:
        'Patch Word text, formatting and basic structure in place. Read docx_read first and pass its revision token; paragraph selects the body paragraph, including table cells/image paragraphs. replace requires unique old_text; insert uses offset. format uses from/to, format and enabled; style uses an existing style_id; list uses bullet/decimal/none. paragraph_add/split/merge/delete use text or offset. link uses selected from/to and url (empty removes a whole link). row_add/delete, cells_merge/split use table, row, column and to_row/to_column (logical grid coordinates). image_insert/replace/delete/resize use image number, image_path and pixel width/height; only inline images are editable, source images must be in scope. Revisions, fields, comments and unsupported structures are read-only and preserved. Own Off/Ask/On mode; defaults to write confirmation with text/structure preview.',
      parameters: {
        type: 'object',
        properties: {
          ...properties,
          revision: { type: 'string' },
          operation: { type: 'string', enum: [...WORD_OPERATIONS] },
          paragraph: { type: 'number' },
          old_text: { type: 'string' },
          new_text: { type: 'string' },
          offset: { type: 'number' },
          text: { type: 'string' },
          from: { type: 'number', description: 'Range start, UTF-16 offset, default 0' },
          to: { type: 'number', description: 'Range end (exclusive), default paragraph end' },
          format: { type: 'string', enum: ['bold', 'italic', 'underline', 'strike'] },
          enabled: { type: 'boolean' },
          style_id: { type: 'string' },
          list: { type: 'string', enum: ['none', 'bullet', 'decimal'] },
          url: {
            type: 'string',
            description: 'HTTP(S)/mail link; empty to remove the whole selected existing link',
          },
          table: { type: 'number' },
          row: { type: 'number' },
          column: {
            type: 'number',
            description: 'Logical grid column from 1, not physical cell index',
          },
          to_row: { type: 'number' },
          to_column: { type: 'number' },
          image: { type: 'number', description: 'Image number from docx_read' },
          image_path: { type: 'string', description: 'In-scope vault PNG/JPEG/GIF/WebP path' },
          width: { type: 'number', description: 'Pixels' },
          height: { type: 'number', description: 'Pixels' },
        },
        required: ['path', 'revision', 'operation', 'paragraph'],
      },
      execute: async (_id, params, signal) => {
        const file = namedDocx(params.path)
        if (typeof params.revision !== 'string' || !params.revision)
          throw new Error('Read with docx_read first and pass its revision')
        if (
          ['image_insert', 'image_replace'].includes(String(params.operation)) &&
          (typeof params.image_path !== 'string' ||
            !ScopeResolver.getInstance().isInScope(params.image_path))
        )
          throw new Error('Access denied: image is outside this chat’s scope')
        const app = GlobalStore.getInstance().app
        const prepared = await prepareWordChange(
          app,
          file,
          params as unknown as WordEdit,
          params.revision
        )
        signal?.throwIfAborted()
        await writeWordChange(app, file, prepared.original, prepared.updated, signal)
        return {
          ...answer(
            `Edited ${file.path}; revision ${wordRevision(prepared.updated)}. Read again after structural edits.`
          ),
          details: { path: file.path, diff: prepared.diff },
        }
      },
    },
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
        const metadata =
          `Styles: ${doc.styles.map((s) => `${s.id} (${s.name}${s.heading ? ', heading' : ''})`).join('; ')}\nTables: ${doc.tables.map((t) => `${t.number}: ${t.rows.length} rows`).join('; ')}\nImages: ${doc.images.map((i) => `${i.number}: paragraph ${i.paragraph}, ${i.inline ? 'inline' : 'floating/read-only'}, ${i.width}×${i.height}px`).join('; ')}\nLinks: ${doc.links
            .slice(0, 100)
            .map((l) => `paragraph ${l.paragraph}, ${l.from}–${l.to}: ${l.url}`)
            .join('; ')}`.slice(0, 5000)
        return answer(
          `${file.path}: revision ${wordRevision(doc.original)}; ${doc.paragraphs.length} paragraphs.\n${metadata}\nWindow from ${start}, characters ${offset}–${Math.min(text.length, offset + limit)} of ${text.length}.\n\n${text.slice(offset, offset + limit)}${offset + limit < text.length ? `\n[Continue with offset ${offset + limit}.]` : `\n[Next paragraph window: start ${start + count}.]`}`
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
