import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { TFile, type App } from 'obsidian'
import { useVault } from '../helpers/testEnv'
import { ChangeTracker } from '@/ai/rewind/ChangeTracker'
import { ChatRewind } from '@/ai/rewind/ChatRewind'
import { memoryStore } from '@/ai/rewind/RewindStore'
import { AbeleConfig } from '@/services/AbeleConfig'
import { DEFAULT_AI_SETTINGS } from '@/ai/types'
import { ScopeResolver } from '@/ai/ScopeResolver'
import { buildScriptContext } from '@/scripting/ScriptContext'

let app: App
let store: ReturnType<typeof memoryStore>
let a: ChatRewind
let b: ChatRewind
const file = () => app.vault.getAbstractFileByPath('sample.md') as TFile
const text = () => app.vault.read(file())

beforeEach(() => {
  app = useVault([{ path: 'sample.md', content: 'original' }]) as unknown as App
  AbeleConfig.getInstance().ai = { ...DEFAULT_AI_SETTINGS }
  ChangeTracker.install(app)
  store = memoryStore()
  a = new ChatRewind(app, { key: () => 'chat-a', turn: () => 'turn-a' }, store)
  b = new ChatRewind(app, { key: () => 'chat-b', turn: () => 'turn-b' }, store)
})
afterEach(() => {
  ChangeTracker.get()?.uninstall()
  vi.restoreAllMocks()
})

it('does not claim human edits while either chat has a live invocation', async () => {
  const left = a.track('edit', 'run-a'),
    right = b.track('edit', 'run-b')
  await app.vault.modify(file(), 'human')
  await left.app.vault.modify(file(), 'alpha')
  await right.app.vault.create('other.md', 'beta')
  await Promise.all([left.close(), right.close()])
  expect(a.entries.value).toMatchObject([
    {
      chat: 'chat-a',
      run: 'run-a',
      turn: 'turn-a',
      changes: [{ path: 'sample.md', before: { text: 'human' } }],
    },
  ])
  expect(b.entries.value).toMatchObject([
    { chat: 'chat-b', run: 'run-b', changes: [{ path: 'other.md' }] },
  ])
  await a.apply(await a.planSince(0), {})
  expect(await text()).toBe('human')
  expect(await app.vault.read(app.vault.getAbstractFileByPath('other.md') as TFile)).toBe('beta')
  const reopened = new ChatRewind(app, { key: () => 'chat-b', turn: () => null }, store)
  await reopened.load()
  expect(reopened.entries.value).toMatchObject([{ chat: 'chat-b', run: 'run-b' }])
})

it('routes script file helpers through the original chat after the tool has returned', async () => {
  const recording = a.track('script_sample', 'run-a')
  const scope = new ScopeResolver()
  scope.fullVaultAccess.value = true
  const script = buildScriptContext({
    params: {},
    logs: [],
    signal: new AbortController().signal,
    toolContext: { app: recording.app, scope, interactive: true },
  })
  await recording.close()
  await script.write('sample.md', 'script words')
  await a.flush()
  expect(a.entries.value).toMatchObject([
    { chat: 'chat-a', run: 'run-a', changes: [{ path: 'sample.md' }] },
  ])
  expect(b.entries.value).toEqual([])
})

it('captures turn and tool once even if a suspended invocation resumes later', async () => {
  let turn = 'first'
  const log = new ChatRewind(app, { key: () => 'chat-a', turn: () => turn }, store)
  const scope = log.track('script_sample', 'branch-a')
  await scope.close()
  turn = 'second'
  await scope.app.vault.modify(file(), 'resumed script')
  await log.flush()
  expect(log.entries.value).toMatchObject([
    { turn: 'first', tool: 'script_sample', run: 'branch-a' },
  ])
})

it('refuses both snapshots when two owned mutations overlap on the same file', async () => {
  const left = a.track('write', 'run-a'),
    right = b.track('write', 'run-b')
  await Promise.all([
    left.app.vault.modify(file(), 'alpha'),
    right.app.vault.modify(file(), 'beta'),
  ])
  await Promise.all([left.close(), right.close()])
  expect(a.entries.value).toHaveLength(1)
  expect(b.entries.value).toHaveLength(1)
  const before = await text()
  for (const log of [a, b]) {
    const plan = await log.planSince(0)
    expect(plan.items[0].conflict).toBe(true)
    expect((await log.apply(plan, { 'sample.md': 'overwrite' })).skipped).toEqual(['sample.md'])
  }
  expect(await text()).toBe(before)
})

it('refuses the A-B-A gap even when the current bytes match A’s last result', async () => {
  const left = a.track('edit', 'run-a'),
    right = b.track('edit', 'run-b')
  await left.app.vault.modify(file(), 'alpha')
  await right.app.vault.modify(file(), 'alpha + beta')
  await left.app.vault.modify(file(), 'alpha + beta + alpha')
  await Promise.all([left.close(), right.close()])
  const plan = await a.planSince(0)
  expect(plan.items[0].conflict).toBe(true)
  await a.apply(plan, { 'sample.md': 'overwrite' })
  expect(await text()).toBe('alpha + beta + alpha')
})

it('reads legacy entries without identity and applies the same later-edit safety rule', async () => {
  const scope = a.track('write', 'run-a')
  await scope.app.vault.modify(file(), 'alpha')
  await scope.close()
  const entries = a.entries.value.map(({ chat: _chat, run: _run, ...entry }) => entry)
  await store.writeLog('legacy', { version: 1, entries })
  const legacy = new ChatRewind(app, { key: () => 'legacy', turn: () => null }, store)
  await app.vault.modify(file(), 'human')
  expect(
    (await legacy.apply(await legacy.planSince(0), { 'sample.md': 'overwrite' })).skipped
  ).toEqual(['sample.md'])
  expect(await text()).toBe('human')
  await app.vault.modify(file(), 'alpha')
  // Matching the broadcast journal's bytes does not prove this chat wrote them.
  const result = await legacy.apply(await legacy.planSince(0), {})
  expect(result.restored).toEqual([])
  expect(result.skipped).toEqual(['sample.md'])
  expect(await text()).toBe('alpha')
  expect(legacy.entries.value).toHaveLength(1)
})

it('rejects a plan belonging to another chat', async () => {
  const scope = a.track('write', 'run-a')
  await scope.app.vault.modify(file(), 'alpha')
  await scope.close()
  await expect(b.apply(await a.planSince(0), {})).rejects.toThrow(/belongs to this chat/)
  expect(await text()).toBe('alpha')
})

it('refuses a stale binary preview after loading its kept blob', async () => {
  const binary = await app.vault.createBinary('sample.bin', new Uint8Array([1]).buffer)
  const scope = a.track('write', 'run-a')
  await scope.app.vault.modifyBinary(binary, new Uint8Array([2]).buffer)
  await scope.close()
  const plan = await a.planSince(0)
  const readBlob = store.readBlob.bind(store)
  vi.spyOn(store, 'readBlob').mockImplementation(async (key, name) => {
    await app.vault.modifyBinary(binary, new Uint8Array([3]).buffer)
    return readBlob(key, name)
  })
  const result = await a.apply(plan, {})
  expect(result.failed[0].error).toMatch(/changed/i)
  expect(new Uint8Array(await app.vault.readBinary(binary))).toEqual(new Uint8Array([3]))
})
