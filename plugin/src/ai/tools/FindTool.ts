import type { AgentTool } from '../client'
import { GlobalStore } from '@/stores/GlobalStore'
import { scopeOf } from '../toolContext'
import { Criterion } from '@/entities/Criterion'
import { getNoteBody } from '@/helpers/notesUtils'
import { TFile } from 'obsidian'
import { stringifyYaml } from 'obsidian'
import { chatForAgent, isChatLog } from '../chatText'
import { pathTree, groupByFolder, propertiesLine, sharedProperties } from './compactListing'

const READ_BATCH_SIZE = 64
const YIELD_EVERY = 1024

interface CriterionParam {
  type: 'path' | 'name' | 'property' | 'content'
  operator:
    | 'equals'
    | 'contains'
    | 'notContains'
    | 'startsWith'
    | 'endsWith'
    | 'regex'
    | 'exists'
    | 'notExists'
  property?: string
  value?: string
  case_insensitive?: boolean
}

/**
 * `compact` is for agents: paths grouped under their folder, properties on one line each, and
 * what every result shares said once. A script splits the answer into one path per line, so
 * it gets the flat list unless it asks.
 */
export function createFindTool(opts?: { skipScope?: boolean; compact?: boolean }): AgentTool {
  return {
    name: 'find',
    label: 'Find Files',
    description:
      'Search for files using criteria. Multiple criteria are combined with AND logic.\n' +
      'Each criterion: {type, operator, property?, value?}\n\n' +
      'Types: path (full path), name (filename without .md), property (frontmatter field), content (note body).\n' +
      'Operators: equals, contains, notContains, startsWith, endsWith, regex, exists, notExists.\n' +
      'exists/notExists — only for property type, no value needed.\n\n' +
      'IMPORTANT for property searches:\n' +
      '- Frontmatter values are matched as strings. For wikilinks use contains with the [[link]] syntax.\n' +
      '- Array properties (like groups, tags): "contains" checks if the array includes the value.\n\n' +
      'Examples:\n' +
      '- Find by type: {type:"property", operator:"equals", property:"type", value:"task"}\n' +
      '- Find notes with a group: {type:"property", operator:"contains", property:"groups", value:"[[Project A]]"}\n' +
      '- Find by tag: {type:"property", operator:"contains", property:"tags", value:"important"}\n' +
      '- Find uncompleted: {type:"property", operator:"notExists", property:"completed"}\n' +
      '- Find by name pattern: {type:"name", operator:"contains", value:"daily"}\n' +
      '- Find by content: {type:"content", operator:"contains", value:"TODO"}\n' +
      '- Find by path prefix: {type:"path", operator:"startsWith", value:"Projects/"}\n\n' +
      "Set include_frontmatter to see each file's properties in the results.",
    parameters: {
      type: 'object',
      properties: {
        criteria: {
          type: 'array',
          description: 'Search criteria (AND logic). Each: {type, operator, property?, value?}',
          items: {
            type: 'object',
            properties: {
              type: {
                type: 'string',
                enum: ['path', 'name', 'property', 'content'],
                description: 'What to match against',
              },
              operator: {
                type: 'string',
                enum: [
                  'equals',
                  'contains',
                  'notContains',
                  'startsWith',
                  'endsWith',
                  'regex',
                  'exists',
                  'notExists',
                ],
                description: 'How to match. exists/notExists only for property type.',
              },
              property: {
                type: 'string',
                description:
                  'Frontmatter property name (required when type is property). Common properties: type, tags, groups, date, due, completed, created.',
              },
              value: {
                type: 'string',
                description:
                  'Value to match (not needed for exists/notExists). For wikilinks in arrays like groups, include brackets: "[[Note Name]]".',
              },
              case_insensitive: {
                type: 'boolean',
                description: 'Case-insensitive matching (default false)',
              },
            },
            required: ['type', 'operator'],
          },
        },
        include_frontmatter: {
          type: 'boolean',
          description: 'Include frontmatter properties for each file in results (default false)',
        },
        limit: { type: 'number', description: 'Max results (default 50)' },
      },
      required: ['criteria'],
    },
    execute: async (_id, params, signal, ctx) => {
      signal?.throwIfAborted()
      const {
        criteria: rawCriteria,
        include_frontmatter: includeFm,
        limit: rawLimit,
      } = params as {
        criteria: CriterionParam[]
        include_frontmatter?: boolean
        limit?: number
      }

      if (!rawCriteria?.length) {
        return { content: [{ type: 'text', text: 'No criteria provided.' }] }
      }

      const scope = scopeOf(ctx)
      const { app } = GlobalStore.getInstance()
      const limit = rawLimit || 50

      // Build Criterion instances
      const criteria = rawCriteria.map((c) => {
        const cr = new Criterion()
        cr.type = c.type
        cr.operator = c.operator
        cr.property = c.property || ''
        cr.value = c.value || ''
        cr.caseInsensitive = c.case_insensitive ?? false
        return cr
      })

      const pathCriteria = criteria.filter((c) => c.type === 'path')
      const nameCriteria = criteria.filter((c) => c.type === 'name')
      const propertyCriteria = criteria.filter((c) => c.type === 'property')
      const contentCriteria = criteria.filter((c) => c.type === 'content')

      let paths = opts?.skipScope
        ? app.vault.getMarkdownFiles().map((f) => f.path)
        : scope.getAccessiblePaths()

      // Filter from the call-local scope once, using metadata before any body reads.
      // Even cached-only searches yield: Promise/microtask yields alone starve the UI.
      const candidates: string[] = []
      for (let at = 0; at < paths.length; at += YIELD_EVERY) {
        signal?.throwIfAborted()
        for (const p of paths.slice(at, at + YIELD_EVERY)) {
          if (!pathCriteria.every((c) => c.checkPathCriterion(p))) continue
          if (nameCriteria.length) {
            const name = p.split('/').pop()?.replace(/\.md$/, '') || ''
            if (!nameCriteria.every((c) => c.checkPathCriterion(name))) continue
          }
          if (propertyCriteria.length) {
            const file = app.vault.getAbstractFileByPath(p)
            if (!file) continue
            const fm = app.metadataCache.getFileCache(file as any)?.frontmatter || {}
            if (!propertyCriteria.every((c) => c.checkPropertyCriterion(fm))) continue
          }
          candidates.push(p)
        }
        if (at + YIELD_EVERY < paths.length) await yieldSearch(signal)
      }
      paths = candidates

      // Exact totals require checking every candidate, even with a small output limit.
      // Bound both outstanding reads and retained bodies; commit matches in input order.
      if (contentCriteria.length) {
        const matched: string[] = []
        for (let at = 0; at < paths.length; at += READ_BATCH_SIZE) {
          signal?.throwIfAborted()
          const batch = paths.slice(at, at + READ_BATCH_SIZE)
          const matches = await waitForReads(
            Promise.all(
              batch.map(async (p) => {
                const file = app.vault.getAbstractFileByPath(p)
                if (!file) return false
                const raw = await app.vault.cachedRead(file as any)
                signal?.throwIfAborted()
                // Match what `read` shows, never a chat's private tool results.
                const text = isChatLog(p) ? chatForAgent(raw, p) : raw
                const body = getNoteBody(text)
                return contentCriteria.every((c) => c.checkContentCriterion(body))
              })
            ),
            signal
          )
          for (let i = 0; i < batch.length; i++) {
            if (matches[i]) matched.push(batch[i])
          }
          if ((at + READ_BATCH_SIZE) % YIELD_EVERY === 0 && at + READ_BATCH_SIZE < paths.length) {
            await yieldSearch(signal)
          }
        }
        paths = matched
      }

      signal?.throwIfAborted()
      const total = paths.length
      paths = paths.slice(0, limit)

      if (!paths.length) {
        return { content: [{ type: 'text', text: 'No files found.' }] }
      }

      // Format output
      const countLabel = total > paths.length ? `${paths.length} of ${total}` : `${total}`
      let text: string
      if (opts?.compact) {
        text = includeFm
          ? compactWithProperties(paths, countLabel)
          : `${countLabel} files:\n${pathTree(paths)}`
      } else if (includeFm) {
        const lines: string[] = []
        for (const p of paths) {
          const file = app.vault.getAbstractFileByPath(p)
          const fm =
            file instanceof TFile ? app.metadataCache.getFileCache(file)?.frontmatter : undefined
          if (fm) {
            const clean = { ...fm }
            delete clean.position
            lines.push(`${p}\n${stringifyYaml(clean).trim()}`)
          } else {
            lines.push(p)
          }
        }
        text = `${countLabel} files:\n\n${lines.join('\n\n')}`
      } else {
        text = `${countLabel} files:\n${paths.join('\n')}`
      }

      return { content: [{ type: 'text', text }] }
    },
  }
}

async function yieldSearch(signal?: AbortSignal): Promise<void> {
  await new Promise<void>((resolve) => window.setTimeout(resolve, 0))
  signal?.throwIfAborted()
}

/** Obsidian reads cannot be cancelled; abandon only this bounded batch, not the whole scan. */
function waitForReads<T>(work: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return work
  return new Promise<T>((resolve, reject) => {
    const abort = () =>
      reject(
        signal.reason instanceof Error
          ? signal.reason
          : new DOMException('Search aborted', 'AbortError')
      )
    signal.addEventListener('abort', abort, { once: true })
    work.then(resolve, reject).finally(() => signal.removeEventListener('abort', abort))
    if (signal.aborted) abort()
  })
}

/** Frontmatter as a script would never parse it: each file one line, shared properties once. */
function compactWithProperties(paths: string[], countLabel: string): string {
  const { app } = GlobalStore.getInstance()
  const props = paths.map((p) => {
    const file = app.vault.getAbstractFileByPath(p)
    const fm = file instanceof TFile ? app.metadataCache.getFileCache(file)?.frontmatter : undefined
    if (!fm) return null
    const clean: Record<string, unknown> = { ...fm }
    delete clean.position
    return clean
  })
  const withFm = props.filter((p): p is Record<string, unknown> => !!p)
  // Shared only when every file has frontmatter: a file without any shares nothing.
  const shared = withFm.length === props.length ? sharedProperties(withFm) : {}
  const skip = new Set(Object.keys(shared))
  const head = skip.size
    ? `${countLabel} files, every one listed with ${propertiesLine(shared, new Set())}:`
    : `${countLabel} files:`
  const rows = paths.map((path, i) => ({ path, props: props[i] }))
  const body = groupByFolder(
    rows,
    (r) => r.path,
    (r, name) => {
      const line = r.props ? propertiesLine(r.props, skip) : ''
      return line ? `${name} | ${line}` : name
    }
  )
  return `${head}\n${body}`
}
