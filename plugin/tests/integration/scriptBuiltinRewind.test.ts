import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { templateHarness } from '../helpers/templateHarness'
import { AbeleConfig } from '@/services/AbeleConfig'
import { DEFAULT_AI_SETTINGS } from '@/ai/types'
import { AgentRegistry } from '@/ai/agents/AgentRegistry'
import { AgentLoop } from '@/ai/client/AgentLoop'
import type { ModelConfig } from '@/ai/client'
import { buildScriptContext } from '@/scripting/ScriptContext'
import { ScopeResolver } from '@/ai/ScopeResolver'
import { ChatRewind } from '@/ai/rewind/ChatRewind'
import { ChangeTracker } from '@/ai/rewind/ChangeTracker'
import { memoryStore } from '@/ai/rewind/RewindStore'
import { getTemplateComposable } from '@/composables/useTemplates'
import * as vaultUtils from '@/helpers/vaultUtils'

let env: ReturnType<typeof templateHarness>
let log: ChatRewind
let script: ReturnType<typeof buildScriptContext>
let close: () => Promise<void>
beforeEach(() => {
  env = templateHarness([
    { path: 'Notes/sample.md', content: 'original' },
    { path: 'Media/sample.png', content: 'picture' },
  ])
  AbeleConfig.getInstance().ai = { ...DEFAULT_AI_SETTINGS }
  ChangeTracker.install(env.app)
  log = new ChatRewind(env.app, { key: () => 'chat-a', turn: () => 'turn-a' }, memoryStore())
  const owned = log.track('script_sample', 'run-a')
  close = owned.close
  const scope = new ScopeResolver()
  scope.fullVaultAccess.value = true
  script = buildScriptContext({
    params: {},
    logs: [],
    signal: new AbortController().signal,
    toolContext: { app: owned.app, scope, interactive: true, approved: true },
  })
})
afterEach(() => {
  getTemplateComposable().resetState()
  ChangeTracker.get()?.uninstall()
  AgentRegistry.destroy()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})
const paths = () => log.entries.value.flatMap((entry) => entry.changes.map((change) => change.path))

it('records script-started agent edits without borrowing the parent approval or scope', async () => {
  const registry = AgentRegistry.getInstance()
  const agent = registry.create({
    name: 'Sample worker',
    permissionMode: 'allow-edit',
    scope: [{ type: 'folder', path: 'Notes' }],
  })
  registry.setDefault(agent.id)
  vi.spyOn(registry, 'resolveModel').mockReturnValue({
    id: 'sample',
    baseUrl: 'https://model.invalid',
    apiKey: '',
  } as ModelConfig)
  vi.spyOn(registry, 'buildSystemPrompt').mockResolvedValue('')
  vi.spyOn(AgentLoop.prototype, 'run').mockImplementation(async (opts) => {
    expect((await opts.beforeToolCall!('rm', 'denied', { path: 'Notes/sample.md' }))?.block).toBe(
      true
    )
    expect(
      (await opts.beforeToolCall!('read', 'outside', { path: 'Private/sample.md' }))?.block
    ).toBe(true)
    await opts.tools
      .find((tool) => tool.name === 'read')!
      .execute('read', { path: 'Notes/sample.md' })
    await opts.tools
      .find((tool) => tool.name === 'edit')!
      .execute('edit', { path: 'Notes/sample.md', old_string: 'original', new_string: 'nested' })
    return { messages: [] }
  })
  await close()
  await script.agent('Edit the sample')
  await log.flush()
  expect(paths()).toEqual(['Notes/sample.md'])
  expect(log.entries.value[0]).toMatchObject({ chat: 'chat-a', run: 'run-a' })
  await log.apply(await log.planSince(0))
  expect(await env.app.vault.read(env.app.vault.getFileByPath('Notes/sample.md')!)).toBe('original')
})

it('records frontmatter changed by setCover', async () => {
  await close()
  await script.setCover('Notes/sample.md', 'Media/sample.png')
  await log.flush()
  expect(paths()).toEqual(['Notes/sample.md'])
  expect(
    env.app.metadataCache.getFileCache(env.app.vault.getFileByPath('Notes/sample.md')!)?.frontmatter
      ?.cover
  ).toBe('Media/sample.png')
  await log.apply(await log.planSince(0))
  expect(await env.app.vault.read(env.app.vault.getFileByPath('Notes/sample.md')!)).toBe('original')
})

it('records the generated video thumbnail and its cover property', async () => {
  await env.app.vault.createBinary('Media/sample.mp4', new Uint8Array([1]).buffer)
  const video = {
    onloadedmetadata: undefined as undefined | (() => void),
    onseeked: undefined as undefined | (() => void),
    videoWidth: 16,
    videoHeight: 16,
    load() {
      queueMicrotask(() => this.onloadedmetadata?.())
    },
    set currentTime(_value: number) {
      queueMicrotask(() => this.onseeked?.())
    },
  }
  vi.stubGlobal('createEl', (tag: string) =>
    tag === 'video'
      ? video
      : tag === 'canvas'
        ? {
            getContext: () => ({ drawImage: () => {} }),
            toBlob: (done: (blob: Blob) => void) => done(new Blob([new Uint8Array([2, 3])])),
          }
        : document.createElement(tag)
  )
  vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:sample')
  vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})
  await script.setCover('Notes/sample.md', 'Media/sample.mp4')
  await close()
  expect(paths()).toEqual(['Attachments', 'Attachments/sample-cover.jpg', 'Notes/sample.md'])
  expect(log.entries.value.every((entry) => entry.chat === 'chat-a')).toBe(true)
  const result = await log.apply(await log.planSince(0))
  expect(result.failed).toEqual([])
  expect(env.app.vault.getFileByPath('Attachments/sample-cover.jpg')).toBeNull()
  expect(env.app.vault.getFileByPath('Media/sample.mp4')).not.toBeNull()
  expect(await env.app.vault.read(env.app.vault.getFileByPath('Notes/sample.md')!)).toBe('original')
})

it('retains the owned app while createFromTemplate waits for user variables', async () => {
  await env.template('Hello {{name}}', { target_name: 'generated' })
  vi.spyOn(vaultUtils, 'openFile').mockResolvedValue(undefined)
  await script.createFromTemplate('Templates/sample.md')
  expect(getTemplateComposable().isVariablesModalOpen.value).toBe(true)
  await close()
  await getTemplateComposable().onVariablesConfirmed(new Map([['name', 'sample']]))
  await log.flush()
  expect(paths()).toEqual(['generated.md'])
  expect(log.entries.value[0]).toMatchObject({ chat: 'chat-a', run: 'run-a' })
  await log.apply(await log.planSince(0))
  expect(env.app.vault.getFileByPath('generated.md')).toBeNull()
})
