// @vitest-environment node
import { expect, it } from 'vitest'
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { join } from 'node:path'
import { SERVER_TEST_COMMIT } from '../../scripts/server-test-fixtures.mjs'
import { openServer, verifyServerLimits, verifyUploadPresence } from '../scale/local-server.mjs'

it('starts only the pinned scratch fixture with isolated SQLite/blobs and removes it on close', async () => {
  const root = await mkdtemp(join(process.cwd(), '.scale-local-'))
  let session
  try {
    const fixture = join(root, 'fixture'),
      data = join(root, 'data')
    const files = {
      'package-lock.json': '{}',
      'packages/server/package.json': '{"version":"0.5.0-test"}',
      'packages/core/package.json': '{"version":"0.3.5"}',
      'packages/server/dist/index.js':
        "const http=require('node:http');const s=http.createServer((q,r)=>r.end('ok'));s.listen(Number(process.env.ABELE_PORT),process.env.ABELE_HOST);process.on('SIGTERM',()=>s.close(()=>process.exit()));",
      'packages/cli/dist/index.js': '',
      'packages/server/dist/admin-cli/index.js': "console.log('sample-token')",
    }
    for (const [path, text] of Object.entries(files)) {
      await mkdir(join(fixture, path, '..'), { recursive: true })
      await writeFile(join(fixture, path), text)
    }
    await writeFile(
      join(fixture, '.abele-sync-fixture.json'),
      JSON.stringify({
        commit: SERVER_TEST_COMMIT,
        lockSha256: createHash('sha256').update('{}').digest('hex'),
        files: Object.fromEntries(
          Object.entries(files)
            .filter(([p]) => p !== 'package-lock.json')
            .map(([p, v]) => [p, createHash('sha256').update(v).digest('hex')])
        ),
      })
    )
    session = await openServer({
      serverMode: 'local',
      serverFixture: fixture,
      localServerDirectory: data,
    })
    expect(session.address).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/)
    expect(session.receipt).toMatchObject({
      mode: 'local',
      revision: SERVER_TEST_COMMIT,
      version: '0.5.0-test',
      database: 'sqlite',
      bind: '127.0.0.1',
    })
    expect(JSON.stringify(session.receipt)).not.toContain('sample-token')
    expect(session.token).toBe('sample-token')
    await session.close()
    await session.close()
    await expect(readFile(join(data, 'anything'))).rejects.toThrow()
    await expect(
      openServer({ serverMode: 'local', serverFixture: fixture, localServerDirectory: fixture })
    ).rejects.toThrow('empty')
    await expect(globalThis.fetch(session.address + '/healthz')).rejects.toThrow()
    const markerPath = join(fixture, '.abele-sync-fixture.json')
    const marker = JSON.parse(await readFile(markerPath, 'utf8'))
    const selected = '1'.repeat(40)
    marker.commit = selected
    await writeFile(markerPath, JSON.stringify(marker))
    const candidate = await openServer({
      serverMode: 'local',
      serverFixture: fixture,
      localServerDirectory: data,
      serverCommit: selected,
      serverSdkVersion: '0.3.5',
    })
    expect(candidate.receipt).toMatchObject({ revision: selected, coreVersion: '0.3.5' })
    await candidate.close()
    const paired = await openServer({
      serverMode: 'local',
      serverFixture: fixture,
      localServerDirectory: data,
      serverCommit: selected,
      serverCoreVersion: '0.3.5',
      serverSdkVersion: '0.3.5-pre.1',
    })
    expect(paired.receipt).toMatchObject({ coreVersion: '0.3.5', pairedSdkVersion: '0.3.5-pre.1' })
    await paired.close()
    await expect(
      openServer({
        serverMode: 'local',
        serverFixture: fixture,
        localServerDirectory: data,
        serverCommit: selected,
        serverSdkVersion: '0.3.4',
      })
    ).rejects.toThrow('SDK')
    await expect(
      openServer({
        serverMode: 'local',
        serverFixture: fixture,
        localServerDirectory: data,
        serverCommit: 'master',
      })
    ).rejects.toThrow('exact')
    marker.commit = SERVER_TEST_COMMIT
    const failedSource = 'process.exit(1)'
    await writeFile(join(fixture, 'packages/server/dist/index.js'), failedSource)
    marker.files['packages/server/dist/index.js'] = createHash('sha256')
      .update(failedSource)
      .digest('hex')
    await writeFile(markerPath, JSON.stringify(marker))
    await expect(
      openServer({ serverMode: 'local', serverFixture: fixture, localServerDirectory: data })
    ).rejects.toThrow('startup failed')
    marker.commit = '0'.repeat(40)
    await writeFile(markerPath, JSON.stringify(marker))
    await expect(
      openServer({ serverMode: 'local', serverFixture: fixture, localServerDirectory: data })
    ).rejects.toThrow('revision')
  } finally {
    await session?.close()
    await rm(root, { recursive: true, force: true })
  }
})

it('proves upload HEAD on known and absent bytes rather than accepting a missing route', async () => {
  const stored = new Set<string>()
  const fetch = async (url: string, options: { method: string }) => {
    if (options.method === 'PUT') {
      stored.add(url)
      return new Response(null, { status: 201 })
    }
    return new Response(null, { status: stored.has(url) ? 200 : 404 })
  }
  expect(await verifyUploadPresence('http://127.0.0.1:1234', 'sample-key', fetch)).toMatchObject({
    presentStatus: 200,
    absentStatus: 404,
  })
  await expect(
    verifyUploadPresence(
      'http://127.0.0.1:1234',
      'sample-key',
      async () => new Response(null, { status: 404 })
    )
  ).rejects.toThrow('upload HEAD')
})

it('keeps remote mode explicit and rejects advertised-limit drift instead of trimming data', async () => {
  const root = await mkdtemp(join(process.cwd(), '.scale-remote-'))
  try {
    const file = join(root, 'token')
    await writeFile(file, 'sample-token')
    const session = await openServer({
      server: 'https://sync.example.test',
      tokenFile: file,
      serverVersion: '0.5.0',
    })
    expect(session.receipt).toMatchObject({ mode: 'remote', version: '0.5.0' })
    await session.close()
    expect(() =>
      verifyServerLimits(
        { max_file_bytes: 200, quota_bytes: null },
        { max_file_bytes: 256, quota_bytes: null }
      )
    ).toThrow('limit')
    expect(() =>
      verifyServerLimits(
        { max_file_bytes: 200, quota_bytes: null },
        { max_file_bytes: 200, quota_bytes: null }
      )
    ).not.toThrow()
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
