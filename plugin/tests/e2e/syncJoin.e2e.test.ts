import { expect } from 'vitest'
import { liveSuite, liveCase } from './helpers/syncLiveCases'
import { AccessClient } from '@abele/sync-sdk/core'
import { decodeAccessToken } from '@abele/sync-sdk/protocol'
import { fixtureFetch } from './helpers/syncServer'
const fixture = liveSuite()
liveCase(
  'syncJoin',
  'bad unreachable and revoked tokens explain refusal without disturbing an existing connection',
  [7, 8, 9],
  async () => {
    const s = fixture(),
      a = s.primary,
      id = await s.connect(),
      path = s.root + '/kept.md'
    a.create(path, 'existing local content')
    await a.syncNow()
    const root = decodeAccessToken(s.server.rootToken),
      access = AccessClient.fromToken(s.server.rootToken, { fetch: fixtureFetch })
    const revoked = await access.issue({
      scope: { kind: 'folder', id: root.scope.id },
      label: 'Sample revoked token',
    })
    await access.revoke(revoked.info.id)
    const offline = await s.addServer()
    await offline.kill()
    for (const [token, reason] of [
      ['damaged token', /token/i],
      [offline.rootToken, /reach|connect|network/i],
      [revoked.token, /closed|revok/i],
    ] as const) {
      const message = await a.long<string>(
        'review refused token',
        `const root=await openSyncTab();await press(root,'Connect…');await poll(()=>modal('Connect to a server'));const box=modal('Connect to a server');typeInto(box.querySelector('input[placeholder="Paste your token"]'),${JSON.stringify(token)});await press(box,'Connect');await poll(()=>box.querySelector('[role="alert"]'));const error=textOf(box.querySelector('[role="alert"]'));await press(box,'Close');await closeSettings();return error`,
        true
      )
      expect(message).toMatch(reason)
      expect(a.rows().map((one) => one.id)).toEqual([id])
      expect(a.read(path)).toBe('existing local content')
    }
  },
  fixture
)
liveCase(
  'syncJoin',
  'first contact keeps identical files singular and preserves different local bytes',
  [36, 38, 39],
  async () => {
    const s = fixture(),
      a = s.primary,
      same = s.root + '/same.md',
      different = s.root + '/different.md'
    await s.put(same, 'same')
    await s.put(different, 'server version')
    a.create(same, 'same')
    a.create(different, 'local version')
    a.create(s.root + '/local-only.md', 'local only')
    await s.connect()
    await a.syncNow()
    expect(a.read(same)).toBe('same')
    expect(a.filesUnder(s.root).filter((one) => one.startsWith(s.root + '/same'))).toHaveLength(1)
    expect(a.read(different)).toBe('server version')
    const copies = a.filesUnder(s.root).filter((one) => one.includes('different (Conflicted copy'))
    expect(copies).toHaveLength(1)
    expect(a.read(copies[0])).toBe('local version')
    expect((await s.items()).map((one) => one.path)).toContain(s.root + '/local-only.md')
    await a.syncNow()
    expect(
      a.filesUnder(s.root).filter((one) => one.includes('different (Conflicted copy'))
    ).toEqual(copies)
  },
  fixture
)
liveCase(
  'syncJoin',
  'plugin restart resumes the same token without another paste or duplicate file',
  [10, 103],
  async () => {
    const s = fixture(),
      a = s.primary,
      path = s.root + '/restart.md'
    const id = await s.connect()
    a.create(path, 'saved before restart')
    await a.syncNow()
    a.run(
      `await app.plugins.disablePlugin('abele');await app.plugins.enablePlugin('abele');return true`
    )
    await a.waitIdle(id)
    await a.syncNow(id)
    expect(a.rows().map((one) => one.id)).toEqual([id])
    expect(a.read(path)).toBe('saved before restart')
    expect((await s.items()).filter((one) => one.path === path)).toHaveLength(1)
  },
  fixture
)
