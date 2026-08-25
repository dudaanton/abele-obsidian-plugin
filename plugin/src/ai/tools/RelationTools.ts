import type { AgentTool } from '../client'
import { GlobalStore } from '@/stores/GlobalStore'
import { NoteRelations } from '@/entities/NoteRelations'
import { DATE_FORMAT } from '@/constants/dates'
import { parseDateOrNull } from '@/helpers/datesHelper'
import { normalizePath, TFile } from 'obsidian'
import dayjs from 'dayjs'

// ── Helpers ──

function resolvePath(path: string): string | null {
  const { app } = GlobalStore.getInstance()
  const file = app.vault.getAbstractFileByPath(normalizePath(path))
  return file instanceof TFile ? file.path : null
}

function formatDate(d: dayjs.Dayjs | null): string {
  return d ? d.format(DATE_FORMAT) : ''
}

function inPeriod(
  d: dayjs.Dayjs | null,
  from: dayjs.Dayjs | null,
  to: dayjs.Dayjs | null
): boolean {
  if (!d) return false
  if (from && d.isBefore(from, 'day')) return false
  if (to && d.isAfter(to, 'day')) return false
  return true
}

/** Create NoteRelations, extract data, cleanup immediately */
function withRelations<T>(path: string, fn: (nr: NoteRelations) => T): T {
  const nr = new NoteRelations(path)
  try {
    return fn(nr)
  } finally {
    nr.cleanup()
  }
}

// ── read_logs ──

export function createReadLogsTool(): AgentTool {
  return {
    name: 'read_logs',
    label: 'Read Logs',
    description:
      'Read log entries related to a note. Returns log content (paragraphs mentioning the note or its group members).',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Vault path of the note to read logs for' },
      },
      required: ['path'],
    },
    execute: async (_id, params) => {
      const path = params.path as string
      if (!path) throw new Error('Missing required parameter: path')
      const resolved = resolvePath(path)
      if (!resolved) throw new Error(`File not found: ${path}`)

      const logs = withRelations(resolved, (nr) =>
        Array.from(nr.logs.values()).map((log) => ({
          path: log.filePath,
          date: formatDate(log.createdAt),
          type: log.type,
        }))
      )

      if (!logs.length) {
        return { content: [{ type: 'text', text: 'No logs found.' }] }
      }

      // Load content for each log
      const { app } = GlobalStore.getInstance()
      const lines: string[] = []
      for (const log of logs) {
        const file = app.vault.getAbstractFileByPath(log.path)
        if (!(file instanceof TFile)) continue
        const raw = await app.vault.cachedRead(file)
        const body = raw.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, '')
        const header = [log.path, log.date, log.type].filter(Boolean).join(' | ')
        lines.push(`## ${header}\n${body.trim()}`)
      }

      return { content: [{ type: 'text', text: lines.join('\n\n') }] }
    },
  }
}

// ── read_backlinks ──

export function createReadBacklinksTool(): AgentTool {
  return {
    name: 'read_backlinks',
    label: 'Read Backlinks',
    description:
      'Read notes linked to a note through groups (transitive backlinks). Returns note paths with metadata.',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Vault path of the note' },
        include_content: {
          type: 'boolean',
          description: 'Include note body content (default false)',
        },
      },
      required: ['path'],
    },
    execute: async (_id, params) => {
      const path = params.path as string
      const includeContent = params.include_content as boolean
      if (!path) throw new Error('Missing required parameter: path')
      const resolved = resolvePath(path)
      if (!resolved) throw new Error(`File not found: ${path}`)

      const notes = withRelations(resolved, (nr) =>
        Array.from(nr.notes.values()).map((n) => ({
          path: n.filePath,
          type: n.type,
          created: formatDate(n.createdAt),
        }))
      )

      if (!notes.length) {
        return { content: [{ type: 'text', text: 'No backlinks found.' }] }
      }

      const { app } = GlobalStore.getInstance()
      const lines: string[] = []
      for (const note of notes) {
        if (includeContent) {
          const file = app.vault.getAbstractFileByPath(note.path)
          if (file instanceof TFile) {
            const raw = await app.vault.cachedRead(file)
            const body = raw.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, '')
            lines.push(`## ${note.path}\n${body.trim()}`)
          } else {
            lines.push(note.path)
          }
        } else {
          const parts = [note.path]
          if (note.type) parts.push(`type=${note.type}`)
          if (note.created) parts.push(note.created)
          lines.push(parts.join(' | '))
        }
      }

      const text = includeContent
        ? lines.join('\n\n')
        : `${notes.length} notes:\n${lines.join('\n')}`
      return { content: [{ type: 'text', text }] }
    },
  }
}

// ── read_transactions ──

export function createReadTransactionsTool(): AgentTool {
  return {
    name: 'read_transactions',
    label: 'Read Transactions',
    description:
      'Read financial transactions. Provide a note path to get transactions linked to that note, or omit to get all. Optionally filter by date period.',
    parameters: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: 'Vault path of a note to get related transactions (optional)',
        },
        from: { type: 'string', description: 'Start date YYYY-MM-DD (optional)' },
        to: { type: 'string', description: 'End date YYYY-MM-DD (optional)' },
      },
    },
    execute: async (_id, params) => {
      const path = params.path as string | undefined
      const fromDate = parseDateOrNull(params.from as string)
      const toDate = parseDateOrNull(params.to as string)
      const { app } = GlobalStore.getInstance()

      interface TxRow {
        path: string
        date: string
        from: string
        to: string
        amount: string
        category: string
      }

      let rows: TxRow[]

      if (path) {
        const resolved = resolvePath(path)
        if (!resolved) throw new Error(`File not found: ${path}`)

        rows = withRelations(resolved, (nr) =>
          Array.from(nr.transactions.values()).map((t) => ({
            path: t.transactionPath,
            date: formatDate(t.date),
            from: t.from || '',
            to: t.to || '',
            amount: t.amount != null ? `${t.amount} ${t.currency || ''}`.trim() : '',
            category: t.category || '',
          }))
        )
      } else {
        // Scan all vault files for transactions
        rows = []
        for (const file of app.vault.getMarkdownFiles()) {
          const fm = app.metadataCache.getFileCache(file)?.frontmatter
          if (fm?.type !== 'transaction') continue
          rows.push({
            path: file.path,
            date: fm.date || '',
            from: fm.from || '',
            to: fm.to || '',
            amount: fm.amount != null ? `${fm.amount} ${fm.currency || ''}`.trim() : '',
            category: fm.category || '',
          })
        }
      }

      // Filter by period
      if (fromDate || toDate) {
        rows = rows.filter((r) => {
          const d = parseDateOrNull(r.date)
          return inPeriod(d, fromDate, toDate)
        })
      }

      if (!rows.length) {
        return { content: [{ type: 'text', text: 'No transactions found.' }] }
      }

      const lines = rows.map((r) =>
        [r.date, r.from, r.to, r.amount, r.category, r.path].filter(Boolean).join(' | ')
      )
      return {
        content: [{ type: 'text', text: `${rows.length} transactions:\n${lines.join('\n')}` }],
      }
    },
  }
}

// ── read_tasks ──

export function createReadTasksTool(): AgentTool {
  return {
    name: 'read_tasks',
    label: 'Read Tasks',
    description:
      'Read tasks. Provide a note path to get tasks linked to that note, or omit to get all. Optionally filter by date period.',
    parameters: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: 'Vault path of a note to get related tasks (optional)',
        },
        from: { type: 'string', description: 'Start date YYYY-MM-DD (optional)' },
        to: { type: 'string', description: 'End date YYYY-MM-DD (optional)' },
        completed: {
          type: 'string',
          enum: ['all', 'yes', 'no'],
          description: 'Filter by completion status (default: all)',
        },
      },
    },
    execute: async (_id, params) => {
      const path = params.path as string | undefined
      const fromDate = parseDateOrNull(params.from as string)
      const toDate = parseDateOrNull(params.to as string)
      const completed = (params.completed as string) || 'all'
      const { app } = GlobalStore.getInstance()

      interface TaskRow {
        path: string
        title: string
        date: string
        due: string
        completed: string
        recurrence: string
      }

      let rows: TaskRow[]

      if (path) {
        const resolved = resolvePath(path)
        if (!resolved) throw new Error(`File not found: ${path}`)

        rows = withRelations(resolved, (nr) =>
          Array.from(nr.tasks.values()).map((t) => ({
            path: t.taskPath,
            title: t.title || t.taskName,
            date: formatDate(t.date),
            due: formatDate(t.due),
            completed: formatDate(t.completedAt),
            recurrence: t.recurrence || '',
          }))
        )
      } else {
        rows = []
        for (const file of app.vault.getMarkdownFiles()) {
          const fm = app.metadataCache.getFileCache(file)?.frontmatter
          if (fm?.type !== 'task') continue
          rows.push({
            path: file.path,
            title: file.basename,
            date: fm.date || '',
            due: fm.due || '',
            completed: fm.completed || '',
            recurrence: fm.recurrence || '',
          })
        }
      }

      // Filter by period (uses date or due)
      if (fromDate || toDate) {
        rows = rows.filter((r) => {
          const d = parseDateOrNull(r.date) || parseDateOrNull(r.due)
          return inPeriod(d, fromDate, toDate)
        })
      }

      // Filter by completion
      if (completed === 'yes') {
        rows = rows.filter((r) => !!r.completed)
      } else if (completed === 'no') {
        rows = rows.filter((r) => !r.completed)
      }

      if (!rows.length) {
        return { content: [{ type: 'text', text: 'No tasks found.' }] }
      }

      const lines = rows.map((r) => {
        const parts = [r.completed ? '[x]' : '[ ]', r.title]
        if (r.due) parts.push(`due:${r.due}`)
        if (r.date) parts.push(`date:${r.date}`)
        if (r.recurrence) parts.push(`recur:${r.recurrence}`)
        parts.push(r.path)
        return parts.join(' | ')
      })
      return {
        content: [{ type: 'text', text: `${rows.length} tasks:\n${lines.join('\n')}` }],
      }
    },
  }
}
