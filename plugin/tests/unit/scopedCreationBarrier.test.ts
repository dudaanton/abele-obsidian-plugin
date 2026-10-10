import { afterEach, expect, it, vi } from 'vitest'
import { TokenEngines } from '@/sync/tokenEngines'
import { tokenHostFixture } from '../helpers/tokenHostFixture'
import { IndexedDbStateStore } from '@/sync/IndexedDbStateStore'
import { pendingTeardown, recordTeardown } from '@/sync/teardownBarrier'
import { setSecrets } from '@/secrets/SecretStore'
import { deferred } from '../helpers/deferred'

const hosts: TokenEngines[] = []
afterEach(async () => {
  for (const host of hosts.splice(0)) await host.close()
  setSecrets(null)
  vi.restoreAllMocks()
})
function setup(fetcher: typeof fetch) {
  const fixture = tokenHostFixture(fetcher)
  hosts.push(fixture.host)
  return fixture
}

it('creation waits for the old writer and its opening is included in close', async () => {
  const fetcher = vi.fn(async () => {
    throw new Error('sample network refusal')
  })
  const { app, host } = setup(fetcher as never)
  const opened = vi.spyOn(IndexedDbStateStore, 'open')
  const old = deferred<void>()
  recordTeardown(app, old.promise)
  host.start()
  const creation = Promise.resolve()
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
  const { app, host, registry, id } = setup(fetcher as never)
  recordTeardown(app, Promise.reject(new Error('sample old writer failure')))
  host.start()
  await vi.waitFor(() => expect(host).toBeDefined())
  await new Promise((resolve) => setTimeout(resolve, 0))
  expect(fetcher).not.toHaveBeenCalled()
  expect(registry.records().find((one) => one.id === id)?.status).toBe('error')
  await host.close()
  await expect(pendingTeardown(app)).rejects.toThrow('sample old writer failure')
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
  host.start()
  const creation = Promise.resolve()
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
