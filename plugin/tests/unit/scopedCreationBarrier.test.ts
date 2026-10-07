import { afterEach, expect, it, vi } from 'vitest'
import { IDBFactory } from 'fake-indexeddb'
import { ScopedPluginHost } from '@/sync/scoped/scopedPluginHost'
import { IndexedDbStateStore } from '@/sync/IndexedDbStateStore'
import { SCOPED_CONNECTION_KEY, type ScopedLocalConnection } from '@/sync/scoped/scopedJoin'
import { recordTeardown } from '@/sync/teardownBarrier'
import { secrets, setSecrets } from '@/secrets/SecretStore'
import { useVault } from '../helpers/testEnv'
import { deferred } from '../helpers/deferred'

const hosts: ScopedPluginHost[] = []
afterEach(async () => {
  for (const host of hosts.splice(0)) await host.close()
  setSecrets(null)
  vi.restoreAllMocks()
})
function setup(fetcher: typeof fetch) {
  const app = useVault([])
  setSecrets(null)
  const c: ScopedLocalConnection = {
    version: 4,
    facet: 'scoped',
    issuer: 'https://sync.example',
    vaultId: 'sample-vault',
    grantId: 'sample-grant',
    memberId: 'sample-member',
    principalId: 'sample-install',
    principalKind: 'installation',
    role: 'editor',
    rootFileId: 'sample-root',
    tokenId: 'abele-scoped-installation-sample',
    ledgerId: 'sample-ledger',
    scriptPolicy: 'refuse',
  }
  const token = 'absi_' + 'a'.repeat(43)
  secrets().setLocal(c.tokenId, token)
  secrets().setLocal(c.tokenId + '-binding', JSON.stringify({ connection: c, token }))
  app.saveLocalStorage(SCOPED_CONNECTION_KEY, c)
  const host = new ScopedPluginHost(app as never, fetcher, new IDBFactory())
  hosts.push(host)
  return { app, host }
}

it('creation waits for the old writer and its opening is included in close', async () => {
  const fetcher = vi.fn(async () => {
    throw new Error('sample network refusal')
  })
  const { app, host } = setup(fetcher as never)
  const opened = vi.spyOn(IndexedDbStateStore, 'open')
  const old = deferred<void>()
  recordTeardown(app, old.promise)
  const creation = host.creation().catch((error) => error)
  await new Promise((resolve) => setTimeout(resolve, 0))
  let closed = false
  const closing = host.close().then(() => {
    closed = true
  })
  await Promise.resolve()
  try {
    expect(opened).not.toHaveBeenCalled()
    expect(fetcher).not.toHaveBeenCalled()
    expect(closed).toBe(false)
  } finally {
    old.resolve()
    await closing
    await creation
  }
  expect(fetcher).not.toHaveBeenCalled()
})

it('a failed old-writer barrier cannot be bypassed by creation', async () => {
  const fetcher = vi.fn(async () => {
    throw new Error('sample network refusal')
  })
  const { app, host } = setup(fetcher as never)
  recordTeardown(app, Promise.reject(new Error('sample old writer failure')))
  await expect(host.creation()).rejects.toThrow('sample old writer failure')
  expect(fetcher).not.toHaveBeenCalled()
})

it('close awaits an in-flight creation opening instead of abandoning it', async () => {
  const entered = deferred<void>(),
    response = deferred<Response>()
  const fetcher = vi.fn()
  const { host } = setup(fetcher as never)
  vi.spyOn(IndexedDbStateStore, 'open').mockImplementationOnce(async () => {
    entered.resolve()
    await response.promise
    throw new Error('sample opening failure')
  })
  const creation = host.creation().catch((error) => error)
  await entered.promise
  let closed = false
  const closing = host.close().then(() => {
    closed = true
  })
  await new Promise((resolve) => setTimeout(resolve, 0))
  try {
    expect(closed).toBe(false)
  } finally {
    response.reject(new Error('sample interrupted network opening'))
    await creation
    await closing
  }
})
