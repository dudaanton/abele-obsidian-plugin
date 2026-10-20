// @vitest-environment node
import { afterEach, describe, expect, it } from 'vitest'
import { AccessClient, V2EngineClient, sha256 } from '@abele/sync-sdk/core'
import { v2Server, type V2Server } from '@abele/sync-server/tests/helpers/v2Server.js'
import { createUser } from '@abele/sync-server/src/access/tokens.js'

/**
 * The harness itself, proved once. Everything downstream — the service, the settings screens —
 * builds on it, so if the cross-repo wiring breaks (an alias, a moved helper, a sibling that
 * was not installed) this is the test that says so rather than twenty confusing ones.
 *
 * Node, not happy-dom: the server is Fastify on better-sqlite3.
 */
describe('syncServer', () => {
  let server: V2Server | null = null

  afterEach(async () => {
    await server?.close()
    server = null
  })

  it('keeps the live head and copies a stale device edit whose base version was pruned', async () => {
    server = await v2Server()
    const user = await createUser(
      { db: server.db, pepper: server.config.tokenPepper },
      'Sample user',
      server.address
    )
    const access = AccessClient.fromToken(user.token, { fetch: globalThis.fetch })
    const authority = await access.connection()
    const issued = await access.issue({
      scope: { kind: authority.scope.kind, id: authority.scope.id },
      label: 'Sample offline device',
    })
    const currentClient = new V2EngineClient(user.token, { fetch: globalThis.fetch })
    const staleClient = new V2EngineClient(issued.token, { fetch: globalThis.fetch })
    expect((await currentClient.state()).settings.conflict).toBe('merge')
    const upload = async (client: typeof currentClient, text: string) => {
      const bytes = new TextEncoder().encode(text)
      const sha = await sha256(bytes)
      await client.putBlob(sha, bytes)
      return { sha, size: bytes.length }
    }
    const base = await upload(currentClient, 'Sample base\nremoved paragraph\n')
    const created = (
      await currentClient.commit(
        [{ op: 'create', path: 'Notes/sample.md', ...base, mtime: 1 }],
        'sample-create'
      )
    ).results[0]
    expect(created.status).toBe('applied')
    if (created.status !== 'applied') throw new Error('Sample creation was not applied')
    const currentText = 'Sample current note\n'
    const current = await upload(currentClient, currentText)
    const latest = (
      await currentClient.commit(
        [
          {
            op: 'modify',
            file_id: created.file_id,
            base_version_id: created.version_id,
            ...current,
            mtime: 2,
          },
        ],
        'sample-current-edit'
      )
    ).results[0]
    expect(latest.status).toBe('applied')
    if (latest.status !== 'applied') throw new Error('Sample current edit was not applied')
    // Model retention removing the version the offline device still edits from.
    await server.db.deleteFrom('versions').where('id', '=', created.version_id).execute()
    const incomingText = 'Sample base\nédition hors ligne\n'
    const incoming = await upload(staleClient, incomingText)
    const result = (
      await staleClient.commit(
        [
          {
            op: 'modify',
            file_id: created.file_id,
            base_version_id: created.version_id,
            ...incoming,
            mtime: 3,
          },
        ],
        'sample-stale-edit'
      )
    ).results[0]
    expect(result).toMatchObject({
      status: 'conflict',
      file_id: created.file_id,
      version_id: latest.version_id,
      sha: current.sha,
    })
    if (result.status !== 'conflict') throw new Error('Expected a stale-base conflict copy')
    const manifest = await currentClient.manifest(null)
    expect(manifest.items).toHaveLength(2)
    expect(manifest.items.find((item) => item.file_id === created.file_id)).toMatchObject({
      path: 'Notes/sample.md',
      version_id: latest.version_id,
      sha: current.sha,
    })
    expect(manifest.items.find((item) => item.file_id === result.conflict_file_id)).toMatchObject({
      path: result.conflict_path,
      version_id: result.conflict_version_id,
      ...incoming,
    })
    expect(result.conflict_path).not.toBe('Notes/sample.md')
    expect(await currentClient.getBlob(current.sha)).toEqual(new TextEncoder().encode(currentText))
    expect(await currentClient.getBlob(incoming.sha)).toEqual(
      new TextEncoder().encode(incomingText)
    )
    const changes = await currentClient.changes(latest.seq)
    expect(changes.items).toMatchObject([
      {
        op: 'modify',
        file_id: result.conflict_file_id,
        version_id: result.conflict_version_id,
        sha: incoming.sha,
      },
    ])
    expect(changes.items).toHaveLength(1)
  })

  it('runs a real server a device can ask for the state of its vault', async () => {
    server = await v2Server()
    const user = await createUser(
      { db: server.db, pepper: server.config.tokenPepper },
      'Sample user',
      server.address
    )
    const client = new V2EngineClient(user.token, { fetch: globalThis.fetch })
    const state = await client.state()
    expect(state.head_seq).toBe(0)
    expect(server.address).toMatch(/^https?:\/\//)
    expect((await client.connection()).status).toBe('active')
  })
})
