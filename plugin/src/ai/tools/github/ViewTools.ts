/**
 * `github_views` and `github_open`: what the person has open in GitHub tabs — the item, the
 * section, the open files, the lines they selected with their code — and a way to put something
 * in front of them in one of those tabs.
 */
import type { WorkspaceLeaf } from 'obsidian'
import type { AgentTool } from '../../client'
import { GlobalStore } from '@/stores/GlobalStore'
import {
  GITHUB_VIEW_TYPE,
  lastUsedGithubLeaf,
  openGithubUrl,
  parseForSettings,
} from '@/github/GithubService'
import type { GithubViewModel } from '@/github/model'
import { diffAnchorHash, shortName, type GithubTarget } from '@/github/urls'
import { answer, clip, parseNamed, text, webUrl, whole } from './shared'

const SELECTION_MAX = 8_000

const KIND_NAME: Record<string, string> = {
  issue: 'Issue',
  pull: 'Pull request',
  discussion: 'Discussion',
  commit: 'Commit',
  blob: 'File',
  tree: 'Folder',
}

const SECTION_NAME: Record<string, string> = {
  conversation: 'the conversation',
  files: 'the changed files',
  commits: 'the commits',
}

interface Shown {
  model: GithubViewModel
  leaf: WorkspaceLeaf
}

function openTabs(): Shown[] {
  const { app } = GlobalStore.getInstance()
  return app.workspace
    .getLeavesOfType(GITHUB_VIEW_TYPE)
    .map((leaf) => ({ leaf, model: (leaf.view as unknown as { model?: GithubViewModel }).model }))
    .filter((s): s is Shown => !!s.model)
}

const onScreen = (leaf: WorkspaceLeaf) => {
  const el = leaf.view?.containerEl as (HTMLElement & { isShown?: () => boolean }) | undefined
  return !!el?.isShown?.()
}

function describe(n: number, { leaf, model }: Shown): string[] {
  const t = model.target
  const s = model.screen
  const marks = [
    onScreen(leaf) ? 'on screen' : '',
    leaf === lastUsedGithubLeaf() ? 'used last' : '',
  ]
    .filter(Boolean)
    .join(', ')
  if (!t) return [`${n}. ${marks ? `[${marks}] ` : ''}A link no GitHub tab can show: ${model.url}`]

  const kind = KIND_NAME[s.kind || t.kind] ?? t.kind
  const name = shortName(t)
  const out = [
    `${n}. ${marks ? `[${marks}] ` : ''}${kind} ${name}${s.title ? ` — ${s.title}` : ''}`,
  ]
  out.push(`   URL: ${model.url}`)
  if (s.error) out.push(`   Could not be shown: ${s.error.split('\n')[0]}`)
  else if (!s.title) out.push('   Still loading.')
  if (s.section) out.push(`   Showing ${SECTION_NAME[s.section] ?? s.section}.`)
  if (model.tree) out.push('   The file tree panel is open beside it, at the version shown.')
  if (s.expanded.length) out.push(`   Open diffs: ${s.expanded.join(', ')}`)
  if (s.selection) {
    const sel = s.selection
    out.push(`   Selected: ${sel.path}, ${sel.label}${sel.url ? ` — ${sel.url}` : ''}`)
    const lang = t.kind === 'blob' ? '' : 'diff'
    out.push('   ```' + lang, clip(sel.code, SELECTION_MAX), '   ```')
  }
  return out
}

export function createGithubViewsTool(): AgentTool {
  return {
    name: 'github_views',
    label: 'GitHub tabs',
    description:
      "What the person is looking at in GitHub tabs: each open tab's item (issue, pull request, discussion, commit, file or folder), which one is on screen, the pull request section in front, the diffs they have open, the lines they selected — with the selected code — and whether the file tree panel is open. " +
      'Call it first when they ask about "this PR", "this code" or "these lines". Read-only.',
    parameters: { type: 'object', properties: {} },
    execute: async () => {
      const tabs = openTabs()
      if (tabs.length === 0) {
        return answer(
          'No GitHub tab is open. Ask the person for a link, or open one for them with github_open.'
        )
      }
      const out = [`${tabs.length} GitHub tab${tabs.length === 1 ? '' : 's'} open.`, '']
      tabs.forEach((tab, i) => out.push(...describe(i + 1, tab), ''))
      return answer(out.join('\n'))
    },
  }
}

/** A link to lines of a file within what `target` shows, the anchor written the way GitHub does. */
async function withLines(
  target: GithubTarget,
  url: string,
  path: string,
  start: number,
  end: number,
  old: boolean
): Promise<string> {
  const base = url.replace(/#.*$/, '')
  const repo = webUrl(target)
  if (target.kind === 'pull') {
    const side = old ? 'L' : 'R'
    const lines = start === end ? `${side}${start}` : `${side}${start}-${side}${end}`
    return `${repo}/pull/${target.number}/files#diff-${await diffAnchorHash(path)}${lines}`
  }
  if (target.kind === 'commit') {
    const side = old ? 'L' : 'R'
    const lines = start === end ? `${side}${start}` : `${side}${start}-${side}${end}`
    return `${base}#diff-${await diffAnchorHash(path)}${lines}`
  }
  if (target.kind === 'blob') return `${base}#L${start}${end !== start ? `-L${end}` : ''}`
  throw new Error('Lines can be shown in a pull request, a commit or a file.')
}

export function createGithubOpenTool(): AgentTool {
  return {
    name: 'github_open',
    label: 'Show on GitHub tab',
    description:
      'Show the person something in a GitHub tab inside Obsidian: an issue, pull request, discussion, commit, file or folder (a `tree/<ref>/<path>` link), by link or owner/repo#12. ' +
      "A link keeps its place — `#L10-L20` on a file, `#issuecomment-…` on a comment. To mark lines give `start_line` (and `end_line`): with `path` on a pull request or commit it marks them in that file's diff (`old: true` for removed lines), on a file link in the file. " +
      'The tab already showing the item is reused, else the GitHub tab used last; `new_tab: true` opens another. Nothing on GitHub changes.',
    parameters: {
      type: 'object',
      properties: {
        url: { type: 'string', description: 'A GitHub link, or owner/repo#12' },
        path: {
          type: 'string',
          description: 'With a pull request or commit: the file whose lines to mark',
        },
        start_line: { type: 'number', description: 'First line to mark' },
        end_line: { type: 'number', description: 'Last line to mark' },
        old: { type: 'boolean', description: 'Count the lines on the old side of a diff' },
        new_tab: { type: 'boolean', description: 'Open in a new tab instead of reusing one' },
      },
      required: ['url'],
    },
    execute: async (_id, params) => {
      const named = parseNamed(params.url)
      let url = text(params.url)
      if (!named.target) {
        if (!named.number) {
          throw new Error(
            'A GitHub tab shows an issue, pull request, discussion, commit, file or folder — not this link. Give the person the link instead.'
          )
        }
        url = `${webUrl(named.repo)}/issues/${named.number}`
      }

      if (params.start_line !== undefined) {
        const target = named.target ?? parseForSettings(url)
        const start = whole(params.start_line, 1)
        const end = Math.max(start, whole(params.end_line, start))
        const path = text(params.path)
        if (target && (target.kind === 'pull' || target.kind === 'commit') && !path) {
          throw new Error('Name the file with `path` to mark lines in a diff.')
        }
        if (
          !target ||
          target.kind === 'issue' ||
          target.kind === 'discussion' ||
          target.kind === 'tree'
        ) {
          throw new Error(
            'Lines can be marked in a pull request, a commit or a file. For an issue number that is a pull request, give its /pull/ link.'
          )
        }
        url = await withLines(target, url, path, start, end, params.old === true)
      }

      const { app } = GlobalStore.getInstance()
      const opened = await openGithubUrl(app, url, params.new_tab === true ? 'tab' : false)
      if (!opened) throw new Error(`No GitHub tab can show ${url}.`)
      return answer(`Shown in a GitHub tab: ${url}`)
    },
  }
}
