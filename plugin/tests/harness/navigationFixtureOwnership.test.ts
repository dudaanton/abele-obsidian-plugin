import { readFileSync } from 'node:fs'
import { expect, it, vi } from 'vitest'

const source = readFileSync('tests/e2e/chatNavigation.e2e.test.ts', 'utf8')
const cleanup = source.slice(source.indexOf('  const stale ='), source.indexOf('  let owner'))
const emitted = new Function(`return \`${cleanup}\``)() as string

it.each(['owned', 'foreign', 'changed-message', 'foreign-discussion'])(
  'removes only a proven leftover navigation fixture: %s',
  async (kind) => {
    const path = 'sample-navigation.abchat'
    const meta = { v: 2, type: 'abele-chat', title: 'Sample navigation', created: '2023-11-14' }
    const records = [{ k: 'msg', id: 'sample-message', content: 'Invented sample content' }]
    const files = new Map([
      [
        path,
        [
          { k: 'meta', ...meta, title: kind === 'foreign' ? 'Another chat' : meta.title },
          {
            ...records[0],
            content: kind === 'changed-message' ? 'Changed text' : records[0].content,
          },
        ]
          .map((row) => JSON.stringify(row))
          .join('\n'),
      ],
      [
        'navd01',
        [
          JSON.stringify({
            type: 'abele-chat',
            kind: 'comment',
            created: meta.created,
            anchor: { note: kind === 'foreign-discussion' ? 'another.abchat' : path },
          }),
          JSON.stringify({
            k: 'msg',
            id: 'du',
            role: 'user',
            content: 'Which plants need shade?',
            timestamp: 1700000005000,
          }),
        ].join('\n'),
      ],
      ['unrelated.abchat', 'Unrelated content'],
    ])
    const remove = vi.fn(async (file: { path: string }) => {
      files.delete(file.path)
    })
    const app = {
      vault: {
        getAbstractFileByPath: (path: string) => (files.has(path) ? { path } : null),
        read: async (file: { path: string }) => files.get(file.path),
        delete: remove,
      },
    }
    const comments = {
      commentPath: (id: string) => id,
      isShown: () => false,
      remove: vi.fn(async (id: string) => {
        files.delete(id)
      }),
    }
    const chats = { getSessionByFile: () => null, deleteChat: vi.fn() }
    const run = new Function(
      'app',
      'comments',
      'chats',
      'path',
      'meta',
      'records',
      `return (async()=>{${emitted}})()`
    )
    if (kind === 'owned') {
      await run(app, comments, chats, path, meta, records)
      expect(files.has(path)).toBe(false)
      expect(files.has('navd01')).toBe(false)
    } else {
      await expect(run(app, comments, chats, path, meta, records)).rejects.toThrow('unowned file')
      expect(remove).not.toHaveBeenCalled()
      expect(comments.remove).not.toHaveBeenCalled()
    }
    expect(files.get('unrelated.abchat')).toBe('Unrelated content')
  }
)
