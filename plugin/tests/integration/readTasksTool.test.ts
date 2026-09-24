/**
 * `read_tasks` tells the agent a task's priority and labels, the same way the lists show
 * them: priority read forgivingly, labels from whichever property the settings name.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { createReadTasksTool } from '@/ai/tools/RelationTools'
import { VaultWatcherWrapper } from '@/helpers/VaultWatcherWrapper'
import { useVault, configureAbele } from '../helpers/testEnv'

const run = async (params: Record<string, unknown> = {}) => {
  const result = await createReadTasksTool().execute('call', params as never, undefined as never)
  return (result.content[0] as { text: string }).text
}

describe('read_tasks — priority and labels', () => {
  beforeEach(() => {
    useVault([
      { path: 'Notes/Project.md', content: 'Project\n' },
      {
        path: 'Tasks/Ship it.md',
        frontmatter: {
          type: 'task',
          priority: 'High',
          labels: ['work', '#home'],
          tags: ['other'],
          groups: ['[[Project]]'],
        },
        content: 'Ship it\n',
      },
      { path: 'Tasks/Plain.md', frontmatter: { type: 'task' }, content: 'Plain\n' },
    ])
    configureAbele().taskLabelProperty = 'labels'
  })

  afterEach(() => {
    VaultWatcherWrapper.destroy()
  })

  it('lists priority and labels across the vault', async () => {
    const text = await run()

    expect(text).toContain('Tasks/ (2)')
    expect(text).toContain('[ ] Ship it.md | priority:high | labels:work, home')
    expect(text).toContain('[ ] Plain.md')
  })

  it('reads labels from the configured property', async () => {
    configureAbele().taskLabelProperty = 'tags'

    expect(await run()).toContain('labels:other')
  })

  it('includes them for the tasks of one note too', async () => {
    const text = await run({ path: 'Notes/Project.md' })

    expect(text).toContain('priority:high')
    expect(text).toContain('labels:work, home')
  })
})
