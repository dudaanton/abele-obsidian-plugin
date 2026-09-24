import type { AgentTool } from '../client'
import { GlobalStore } from '@/stores/GlobalStore'
import { ScopeResolver } from '../ScopeResolver'
import { TFile } from 'obsidian'
import { chatForAgent, isChatLog } from '../chatText'

export function createReadFileTool(opts?: { skipScope?: boolean }): AgentTool {
  return {
    name: 'read',
    label: 'Read File',
    description:
      'Read the content of a file. Only files within the current workspace scope are accessible.\n\n' +
      'With line_numbers, or start_line/end_line for a window, every line comes numbered from 1 over ' +
      'the whole file, frontmatter included. Use those numbers to point the person at lines: a link ' +
      '[[path/Note#L10-L12|what is there]] (or #L10 for one line) opens the note with those lines selected.',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'File path relative to vault root' },
        line_numbers: {
          type: 'boolean',
          description: 'Number every line (default false: the file as it is)',
        },
        start_line: {
          type: 'number',
          description: 'First line to return, 1-based; implies line_numbers',
        },
        end_line: {
          type: 'number',
          description: 'Last line to return, inclusive; implies line_numbers',
        },
      },
      required: ['path'],
    },
    execute: async (_id, params) => {
      const path = params.path as string
      if (!path) throw new Error('Missing required parameter: path')
      if (!opts?.skipScope && !ScopeResolver.getInstance().isInScope(path)) {
        throw new Error(`Access denied: ${path} is not in workspace scope`)
      }
      const { app } = GlobalStore.getInstance()
      const file = app.vault.getAbstractFileByPath(path)
      if (!(file instanceof TFile)) throw new Error(`File not found: ${path}`)
      const content = await app.vault.read(file)
      // A chat log is every note its own agent read and every result its tools returned. An
      // agent that can reach one — only with the whole vault open, since no scope takes a chat
      // log in — reads what was said in it and nothing more, as if it had been attached.
      if (isChatLog(file.path)) {
        return { content: [{ type: 'text', text: chatForAgent(content, file.basename) }] }
      }
      const start = params.start_line as number | undefined
      const end = params.end_line as number | undefined
      if (params.line_numbers || start !== undefined || end !== undefined) {
        return { content: [{ type: 'text', text: numberedLines(path, content, start, end) }] }
      }
      return { content: [{ type: 'text', text: content }] }
    },
  }
}

/**
 * The file's lines numbered the way a link to lines counts them — from 1, over the whole file,
 * the same numbers the editor shows — optionally only a window of them. A window past the end
 * ends at the last line.
 */
export function numberedLines(path: string, content: string, start?: number, end?: number): string {
  const lines = content.split('\n')
  const total = lines.length
  const window = start !== undefined || end !== undefined
  const from = Math.min(Math.max(1, Math.floor(start ?? 1)), total)
  const to = Math.min(total, Math.max(from, Math.floor(end ?? total)))
  const width = String(to).length
  const rows = lines.slice(from - 1, to).map((l, i) => `${String(from + i).padStart(width)}  ${l}`)
  const head = window
    ? `${path} — ${total} lines, showing ${from}–${to}`
    : `${path} — ${total} lines`
  const out = [head, ...rows]
  const outside = [
    from > 1 ? `lines 1–${from - 1} are before this window` : '',
    to < total ? `lines ${to + 1}–${total} after it` : '',
  ].filter(Boolean)
  if (outside.length) {
    const note = outside.join('; ')
    out.push(`[${note[0].toUpperCase()}${note.slice(1)}.]`)
  }
  return out.join('\n')
}
