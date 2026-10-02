import { TFile } from 'obsidian'
import type { AgentTool } from '../client'
import { GlobalStore } from '@/stores/GlobalStore'
import { ScopeResolver } from '../ScopeResolver'
import { wordRevision as workbookRevision } from '@/ooxml/write'
import {
  loadWorkbookBytes,
  prepareWorkbookChange,
  writeWorkbookChange,
} from '@/spreadsheet/vaultAdapter'
import type { WorkbookEdit } from '@/spreadsheet/edit'
import { readRange } from '@/spreadsheet/read'
import { cellAddress } from '@/spreadsheet/address'
export function namedWorkbook(input: unknown): TFile {
  const path = typeof input === 'string' ? input : ''
  if (!ScopeResolver.getInstance().isInScope(path))
    throw new Error(`Access denied: ${path} is outside this chat's scope`)
  const file = GlobalStore.getInstance().app.vault.getAbstractFileByPath(path)
  if (!(file instanceof TFile) || !['xlsx', 'xlsm'].includes(file.extension.toLowerCase()))
    throw new Error('Name an .xlsx or .xlsm file by its exact vault path')
  if (!ScopeResolver.getInstance().isInScope(file.path))
    throw new Error(`Access denied: ${file.path} is outside this chat's scope`)
  return file
}
const answer = (text: string) => ({ content: [{ type: 'text' as const, text }] })
const integer = (value: unknown, fallback: number, max: number) =>
  Number.isFinite(Number(value))
    ? Math.min(max, Math.max(1, Math.floor(Number(value) || fallback)))
    : fallback
const offset = (v: unknown) => Math.max(0, Math.floor(Number(v) || 0))
const properties = {
  path: { type: 'string', description: 'Exact vault path of an .xlsx or read-only .xlsm workbook' },
}
export const openVaultWorkbook = async (file: TFile) =>
  loadWorkbookBytes(
    new Uint8Array(await GlobalStore.getInstance().app.vault.readBinary(file)),
    file.extension.toLowerCase() === 'xlsm'
  )
export function createXlsxTools(): AgentTool[] {
  return [
    {
      name: 'xlsx_write',
      label: 'Write workbook cells',
      category: 'Excel',
      description:
        'Patch a rectangular A1 range of values/formulas in an .xlsx workbook. Read xlsx_read first and pass revision. values is a rectangular matrix matching range: string, number, boolean, null (clear), {formula: "SUM(A1:A2)"}, or {value: "=literal text"}. Strings starting with = are formulas. Max 1000 cells. Uses the existing write preview/confirmation with its own Off/Ask/On mode, default Ask. Shared formulas are unshared before editing; array ranges, protected sheets, merged followers and .xlsm are read-only. Local HyperFormula recalculation updates dependent caches on edit (20000 stored-cell limit); unsupported functions show #NAME?. operation=recalculate refreshes caches without changing formulas/values and only needs path/revision. Array/dynamic formulas and larger calculations remain pending with an explicit warning.',
      parameters: {
        type: 'object',
        properties: {
          ...properties,
          revision: { type: 'string' },
          operation: { type: 'string', enum: ['cells', 'recalculate'] },
          sheet: { type: 'string' },
          range: { type: 'string' },
          values: { type: 'array', items: { type: 'array', items: {} } },
        },
        required: ['path', 'revision'],
      },
      execute: async (_id, params, signal) => {
        const file = namedWorkbook(params.path)
        if (typeof params.revision !== 'string' || !params.revision)
          throw new Error('Read with xlsx_read first and pass its revision')
        const app = GlobalStore.getInstance().app
        const prepared = await prepareWorkbookChange(
          app,
          file,
          params as unknown as WorkbookEdit,
          params.revision,
          signal
        )
        signal?.throwIfAborted()
        if (namedWorkbook(file.path) !== file)
          throw new Error('Workbook moved while editing; read again')
        await writeWorkbookChange(app, file, prepared.original, prepared.updated, signal)
        return {
          ...answer(
            `Edited ${file.path}; revision ${workbookRevision(prepared.updated)}. ${prepared.calculation.note}`
          ),
          details: { path: file.path, diff: prepared.diff },
        }
      },
    },
    {
      name: 'xlsx_sheets',
      label: 'Workbook sheets',
      category: 'Excel',
      description:
        'List workbook sheet names, hidden state and used ranges, without opening a tab. Includes the revision for writes. Scope checked; read-only.',
      parameters: { type: 'object', properties, required: ['path'] },
      execute: async (_id, params, signal) => {
        const file = namedWorkbook(params.path)
        const book = await openVaultWorkbook(file)
        const lines = []
        for (const info of book.sheets) {
          signal?.throwIfAborted()
          const sheet = await book.sheet(info.name)
          lines.push(
            `${info.name}${info.hidden ? ' (hidden)' : ''}: A1:${cellAddress(sheet.maxRow, sheet.maxColumn)}, ${sheet.cells.size} stored cells${sheet.protected ? ', protected' : ''}`
          )
        }
        return answer(
          `${file.path}: revision ${workbookRevision(book.original)}; ${book.readOnly ? 'read-only' : 'editable'}; ${book.stale ? 'values may be stale' : 'cached values'}.\n${lines.join('\n').slice(0, 25000)}`
        )
      },
    },
    {
      name: 'xlsx_read',
      label: 'Read workbook range',
      category: 'Excel',
      description:
        'Read an A1 range on the named sheet as markdown or CSV, with cached values and formulas. Max 1000 cells and 25000 characters per page; offset continues the same range. Includes revision token. Does not need an open tab. Read-only.',
      parameters: {
        type: 'object',
        properties: {
          ...properties,
          sheet: { type: 'string' },
          range: { type: 'string', description: 'A1 range, default A1:J20' },
          format: { type: 'string', enum: ['markdown', 'csv'] },
          offset: { type: 'number' },
          limit: { type: 'number' },
        },
        required: ['path', 'sheet'],
      },
      execute: async (_id, params, signal) => {
        const file = namedWorkbook(params.path)
        const book = await openVaultWorkbook(file)
        signal?.throwIfAborted()
        const sheet = await book.sheet(String(params.sheet || ''))
        const range = String(params.range || 'A1:J20')
        const text = readRange(book, sheet, range, String(params.format || 'markdown'))
        const start = offset(params.offset)
        const limit = integer(params.limit, 12000, 25000)
        return answer(
          `${file.path}, ${sheet.name}!${range}; revision ${workbookRevision(book.original)}; ${book.stale ? 'values may be stale' : 'cached values'}.\nCharacters ${start}–${Math.min(start + limit, text.length)} of ${text.length}.\n\n${text.slice(start, start + limit)}${start + limit < text.length ? `\n[Continue with offset ${start + limit}.]` : ''}`
        )
      },
    },
    {
      name: 'xlsx_search',
      label: 'Search workbook',
      category: 'Excel',
      description:
        'Literal case-insensitive search across workbook values and formulas. Optional sheet restricts the search. Returns at most 40 cells with bounded excerpts; after continues results. Read-only.',
      parameters: {
        type: 'object',
        properties: {
          ...properties,
          sheet: { type: 'string' },
          query: { type: 'string' },
          after: { type: 'number' },
          limit: { type: 'number' },
        },
        required: ['path', 'query'],
      },
      execute: async (_id, params, signal) => {
        const file = namedWorkbook(params.path)
        const query = typeof params.query === 'string' ? params.query : ''
        if (!query || query.length > 1000) throw new Error('Search text must be 1–1000 characters')
        const book = await openVaultWorkbook(file)
        const after = offset(params.after)
        const limit = integer(params.limit, 20, 40)
        let total = 0
        const finds = []
        const q = query.toLowerCase()
        const sheets = params.sheet ? [String(params.sheet)] : book.sheets.map((s) => s.name)
        for (const name of sheets) {
          signal?.throwIfAborted()
          const sheet = await book.sheet(name)
          for (const cell of sheet.cells.values()) {
            const text =
              String(cell.value ?? '') + (cell.formula !== undefined ? ' =' + cell.formula : '')
            const at = text.toLowerCase().indexOf(q)
            if (at < 0) continue
            if (total >= after && finds.length < limit)
              finds.push(
                `${name}!${cell.address}: ${text.slice(Math.max(0, at - 80), at + q.length + 80)}`
              )
            total++
          }
        }
        return answer(
          `${total} matching cells in ${file.path}.\n${finds.join('\n')}\n[Continue with after ${after + finds.length}.]`
        )
      },
    },
  ]
}
