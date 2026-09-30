import type { App } from 'obsidian'
import { vi } from 'vitest'
import { UserTemplate, type UserTemplateProperties } from '@/templates/UserTemplate'
import { useVault } from './testEnv'
import type { FakeFileSpec } from './fakeVault'

/** Real vault reads/writes, with only the host's workspace and commands supplied locally. */
export function templateHarness(specs: FakeFileSpec[] = []) {
  const fake = useVault(specs)
  const workspace = {
    getActiveFile: vi.fn(() => fake.vault.getFileByPath('Notes/sample.md')),
    getActiveViewOfType: vi.fn(() => null),
    getLeavesOfType: vi.fn(() => []),
    openLinkText: vi.fn(),
  }
  const commands = { executeCommandById: vi.fn(async (_id: string) => true) }
  const app = Object.assign(fake, { workspace, commands }) as typeof fake &
    App & { commands: typeof commands }
  return {
    app,
    workspace,
    commands,
    async template(
      body: string,
      properties: Partial<UserTemplateProperties> = {},
      path = 'Templates/sample.md'
    ) {
      const file = await app.vault.create(path, body)
      const props = { type: 'template' as const, template_for: 'sample', ...properties }
      app.setFrontmatter(path, props)
      return new UserTemplate(file, props)
    },
  }
}
