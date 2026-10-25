import { readFileSync } from 'node:fs'
import { expect, it, vi } from 'vitest'
import { NodeFolderPicker, nodeFolderChoices } from '@/components/nodeFolderPicker'
import { useVault } from '../helpers/testEnv'

it('renders generated worktrees by their own label, with ordinary branches unchanged', async () => {
  const app = useVault([])
  const host = {
    nodes: () => [{ id: 'sample-node', label: 'Sample node' }],
    connection: () => ({
      client: {
        connected: true,
        listSessions: async () => [
          { workspace_id: 'sample-workspace', title: 'Fix sample parser' },
        ],
        listProjects: async () => [
          {
            project_id: 'sample-project',
            root_path: '/samples/project',
            repository_path: '/samples/project',
          },
        ],
        repository: {
          worktrees: async () => ({
            entries: [
              {
                worktree_id: 'sample-tree',
                workspace_id: 'sample-workspace',
                branch: 'abele/11111111-2222-4333-8444-555555555555',
                path_label: '/samples/Fix sample parser',
              },
              {
                worktree_id: 'sample-other',
                branch: 'refs/heads/feature/sample-parser',
                path_label: '/samples/other',
              },
            ],
            cursor: null,
          }),
        },
      },
    }),
  }
  const choices = await nodeFolderChoices(host as never)
  const picker = new NodeFolderPicker(app as never, choices, vi.fn())
  const row = document.createElement('div')
  picker.renderSuggestion({ item: choices[1] } as never, row)
  expect(row.textContent).toContain('Fix sample parser')
  expect(row.textContent).not.toContain('11111111-2222')
  expect(choices[2].branch).toBe('feature/sample-parser')
  const note = row.querySelector('.suggestion-note') as HTMLElement
  expect(note.textContent).toBe('Fix sample parser')
  const style = document.createElement('style')
  style.textContent = readFileSync('src/components/nodeFolderPicker.css', 'utf8')
  document.head.append(style)
  document.body.append(row)
  try {
    expect(getComputedStyle(note).whiteSpace).toBe('nowrap')
    expect(getComputedStyle(note).textOverflow).toBe('ellipsis')
    const flair = row.querySelector('.suggestion-flair') as HTMLElement
    expect(getComputedStyle(flair).whiteSpace).toBe('nowrap')
    expect(getComputedStyle(flair).textOverflow).toBe('ellipsis')
  } finally {
    row.remove()
    style.remove()
  }
})

it.each(['abele/', 'abele-'])(
  'renders opaque %s worktrees using session titles or a short fallback',
  async (prefix) => {
    const app = useVault([])
    const id = '12345678-2222-4333-8444-555555555555'
    const raw = prefix + id + (prefix === 'abele-' ? '-abcdef0123456789' : '')
    const client = {
      connected: true,
      listProjects: async () => [
        {
          project_id: 'sample-project',
          root_path: '/samples/project',
          repository_path: '/samples/project',
        },
      ],
      listSessions: vi.fn(async () => [
        { workspace_id: 'sample-titled', title: 'Fix sample parser' },
      ]),
      repository: {
        worktrees: async () => ({
          entries: ['sample-titled', 'sample-untitled'].map((workspace_id, index) => ({
            worktree_id: 'sample-tree-' + index,
            workspace_id,
            branch: raw,
            path_label: '/samples/' + raw.replace('/', '-'),
          })),
          cursor: null,
        }),
      },
    }
    const choices = await nodeFolderChoices({
      nodes: () => [{ id: 'sample-node', label: 'Sample node' }],
      connection: () => ({ client }),
    } as never)
    const picker = new NodeFolderPicker(app as never, choices, vi.fn())
    const titled = document.createElement('div'),
      untitled = document.createElement('div')
    picker.renderSuggestion({ item: choices[1] } as never, titled)
    picker.renderSuggestion({ item: choices[2] } as never, untitled)
    expect(titled.querySelector('.suggestion-note')?.textContent).toBe('Fix sample parser')
    expect(untitled.querySelector('.suggestion-note')?.textContent).toBe("Agent's branch · 123456")
    expect(untitled.textContent).not.toContain(id)
    expect(untitled.title).toContain(raw)
    expect(client.listSessions).toHaveBeenCalledOnce()
  }
)
