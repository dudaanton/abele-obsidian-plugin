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
  } finally {
    row.remove()
    style.remove()
  }
})
