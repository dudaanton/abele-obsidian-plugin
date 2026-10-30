import { expect, it } from 'vitest'
import { createCopyFileTool } from '@/ai/tools/CopyFileTool'
import { useVault } from '../helpers/testEnv'
import { TFile, type App } from 'obsidian'
import { createReadFileTool } from '@/ai/tools/ReadFileTool'
import { serializeChat } from '@/ai/ChatLog'
import { createMoveFileTool } from '@/ai/tools/MoveFileTool'
import { resolveAttachmentsForApi } from '@/ai/attachments'
import { createFindTool } from '@/ai/tools/FindTool'
import { ScopeResolver } from '@/ai/ScopeResolver'
import { createVaultZip } from '@/archive/vaultZip'
import { unzipSync } from 'fflate'

const snapshot = {
  metadata: { type: 'abele-chat', title: 'Sample conversation', created: '2026-01-01' },
  messages: [
    { id: 'u', role: 'user', content: 'A public question', timestamp: 1 },
    {
      id: 'a',
      role: 'assistant',
      content: 'A public answer',
      timestamp: 2,
      thinking: 'PRIVATE_REASONING',
      attachments: ['PRIVATE_ATTACHMENT.png'],
    },
    { id: 't', role: 'tool-result', content: 'PRIVATE_NODE_RESULT', timestamp: 3 },
  ],
  internalMessages: [{ role: 'user', content: 'PRIVATE_INTERNAL_CONTEXT', timestamp: 1 }],
} satisfies Parameters<typeof serializeChat>[0]

it.each(['md', 'txt', 'json', 'png'])(
  'copies only the readable conversation when a chat is disguised as .%s',
  async (extension) => {
    const raw = serializeChat(snapshot)
    const app = useVault([{ path: 'Other.abchat', raw }])
    const scope = new ScopeResolver()
    scope.setFullVaultAccess(true)
    const ctx = { scope, interactive: true, approved: true }
    const read = createReadFileTool()
    const original = await read.execute('read-chat', { path: 'Other.abchat' }, undefined, ctx)
    await createCopyFileTool().execute(
      'copy-chat',
      {
        from: 'Other.abchat',
        to: `Other.${extension}`,
      },
      undefined,
      ctx
    )
    const copy = app.vault.getAbstractFileByPath(`Other.${extension}`) as TFile
    const expected = original.content[0].text
    expect(await app.vault.read(copy)).toBe(expected)
    expect((await read.execute('read-copy', { path: copy.path }, undefined, ctx)).content).toEqual(
      original.content
    )
    expect(expected).toContain('A public answer')
    expect(expected).not.toContain('PRIVATE_')
    expect(await app.vault.read(app.vault.getAbstractFileByPath('Other.abchat') as TFile)).toBe(raw)
    await createCopyFileTool({ skipScope: true }).execute('copy-again', {
      from: copy.path,
      to: 'Again.txt',
    })
    await createMoveFileTool({ skipScope: true }).execute('move-copy', {
      from: 'Again.txt',
      to: 'Moved.md',
    })
    expect(
      (await read.execute('read-moved-copy', { path: 'Moved.md' }, undefined, ctx)).content
    ).toEqual(original.content)
    scope.destroy()
  }
)

it.each([
  serializeChat(snapshot),
  JSON.stringify(snapshot),
  '\ufeff' + serializeChat(snapshot),
  '\ufeff' + JSON.stringify(snapshot),
  ' '.repeat(255) + '\u2003' + serializeChat(snapshot),
])('recognizes a previously renamed chat by its content', async (raw) => {
  const app = useVault([{ path: 'Disguised.md', raw }])
  const read = await createReadFileTool({ skipScope: true }).execute('read', {
    path: 'Disguised.md',
  })
  expect(read.content[0].text).toContain('A public answer')
  expect(read.content[0].text).not.toContain('PRIVATE_')
  await createCopyFileTool({ skipScope: true }).execute('copy', {
    from: 'Disguised.md',
    to: 'Copy.txt',
  })
  expect(await app.vault.read(app.vault.getAbstractFileByPath('Copy.txt') as TFile)).toBe(
    read.content[0].text
  )
  const attached = await resolveAttachmentsForApi(['Disguised.md'])
  expect(JSON.stringify(attached)).not.toContain('PRIVATE_')
  const found = await createFindTool({ skipScope: true }).execute('find', {
    criteria: [{ type: 'content', operator: 'contains', value: 'PRIVATE_' }],
  })
  expect(found.content[0].text).not.toContain('Disguised.md')
})

it('refuses moving a chat out of the protected namespace', async () => {
  const raw = serializeChat(snapshot)
  const app = useVault([{ path: 'Other.abchat', raw }])
  await expect(
    createMoveFileTool({ skipScope: true }).execute('move', {
      from: 'Other.abchat',
      to: 'Other.md',
    })
  ).rejects.toThrow('Chat files can only be changed through chat controls')
  expect(app.vault.getAbstractFileByPath('Other.md')).toBeNull()
  expect(await app.vault.read(app.vault.getAbstractFileByPath('Other.abchat') as TFile)).toBe(raw)
})

it('keeps a chat inaccessible to scoped copy even after approval', async () => {
  const app = useVault([{ path: 'Other.abchat', raw: serializeChat(snapshot) }])
  const scope = new ScopeResolver()
  scope.addFile('Other.abchat')
  await expect(
    createCopyFileTool().execute(
      'copy',
      {
        from: 'Other.abchat',
        to: 'Other.md',
      },
      undefined,
      { scope, interactive: true, approved: true }
    )
  ).rejects.toThrow('Access denied')
  expect(app.vault.getAbstractFileByPath('Other.md')).toBeNull()
  scope.destroy()
})

it.each(['Other.abchat', 'Renamed.md'])(
  'packs only the readable transcript of %s, including renamed ZIP entries',
  async (path) => {
    const raw = serializeChat(snapshot)
    const app = useVault([{ path, raw }])
    ;(app.vault.getAbstractFileByPath(path) as TFile).stat.size = new TextEncoder().encode(
      raw
    ).length
    const attachment = new Uint8Array([0, 255, 254, 128])
    await app.vault.createBinary('sample.png', attachment.buffer)
    ;(app.vault.getAbstractFileByPath('sample.png') as TFile).stat.size = attachment.length
    const scope = new ScopeResolver()
    scope.setFullVaultAccess(true)
    await createVaultZip(
      {
        path: 'Sample.zip',
        files: [{ path, name: 'disguised.txt' }, { path: 'sample.png' }],
      },
      {
        app: app as unknown as App,
        scope,
        agentId: 'sample',
        validateWrite: () => {},
      }
    )
    const zip = unzipSync(
      new Uint8Array(
        await app.vault.readBinary(app.vault.getAbstractFileByPath('Sample.zip') as TFile)
      )
    )
    const transcript = new TextDecoder().decode(zip['disguised.txt'])
    const read = await createReadFileTool().execute('read', { path }, undefined, {
      scope,
      interactive: true,
    })
    expect(transcript).toBe(read.content[0].text)
    expect(transcript).not.toContain('PRIVATE_')
    expect(zip['sample.png']).toEqual(attachment)
    scope.destroy()
  }
)

it('copies binary files without decoding them as note text', async () => {
  const app = useVault([])
  const bytes = new Uint8Array([0, 255, 254, 1, 128]).buffer
  await app.vault.createBinary('sample-image.png', bytes)
  await createCopyFileTool({ skipScope: true }).execute('sample-copy', {
    from: 'sample-image.png',
    to: 'sample-copy.png',
  })
  const copied = app.vault.getAbstractFileByPath('sample-copy.png') as TFile
  expect(new Uint8Array(await app.vault.readBinary(copied))).toEqual(new Uint8Array(bytes))
})

it('preserves text and frontmatter exactly when copying a note', async () => {
  const text = '---\nname: Sample\n---\n\nText with accents: é.\n'
  const app = useVault([{ path: 'sample.md', raw: text }])
  await createCopyFileTool({ skipScope: true }).execute('sample-copy', {
    from: 'sample.md',
    to: 'sample-copy.md',
  })
  const copied = app.vault.getAbstractFileByPath('sample-copy.md') as TFile
  expect(await app.vault.read(copied)).toBe(text)
})

it('preserves ordinary JSON bytes, including a BOM and line endings', async () => {
  const text = '\ufeff{\r\n  "metadata": { "type": "sample" }, "messages": ["sample"]\r\n}\r\n'
  const bytes = new TextEncoder().encode(text)
  const app = useVault([])
  await app.vault.createBinary('sample.json', bytes.buffer)
  await createCopyFileTool({ skipScope: true }).execute('copy', {
    from: 'sample.json',
    to: 'copy.json',
  })
  expect(
    new Uint8Array(
      await app.vault.readBinary(app.vault.getAbstractFileByPath('copy.json') as TFile)
    )
  ).toEqual(bytes)
})
