import { describe, expect, it, afterEach } from 'vitest'
import { readFileSync } from 'node:fs'
import ts from 'typescript'
import { recipientLayoutProbe } from '../helpers/keyDestinationLayoutProbe'

const focusedFile = readFileSync('tests/e2e/keyDestinationLayout.e2e.test.ts', 'utf8')
const focusedPart = focusedFile.slice(
  focusedFile.indexOf('export const recipientLayoutScript'),
  focusedFile.indexOf("describe('native recipient")
)
const exportsOf: Record<string, (screen: string) => string> = {}
new Function(
  'exports',
  'recipientLayoutProbe',
  'shots',
  ts.transpileModule(focusedPart, {
    compilerOptions: { module: ts.ModuleKind.CommonJS },
  }).outputText
)(exportsOf, recipientLayoutProbe, '/unused')
const focusedScript = exportsOf.recipientLayoutScript
const broadFile = readFileSync('tests/e2e/phoneLayout.e2e.test.ts', 'utf8')
const broadLoop = broadFile.slice(
  broadFile.indexOf('    report.__dialogs ='),
  broadFile.indexOf("    // The timeline's", broadFile.indexOf('    report.__dialogs ='))
)
const helper = () =>
  new Function(
    recipientLayoutProbe + '; return { recipientFixture, cleanupRecipientConsumer };'
  )() as {
    recipientFixture(): () => Promise<void>
    cleanupRecipientConsumer: (...args: any[]) => Promise<void>
  }

const setup = () => {
  const ai = { secrets: ['ambient sample'], providers: [] }
  const config = { ai, fireflyBaseUrl: 'sample ledger', calendars: { feeds: [] } }
  const stores = new Map<string, unknown>()
  const app = { loadLocalStorage: (key: string) => stores.get(key) }
  const api: Record<string, any> = { AbeleConfig: { getInstance: () => config } }
  Object.assign(window, { __abeleTest: api })
  Object.assign(globalThis, { app })
  return { ai, config, api, stores }
}
const modal = (name: string) => {
  const root = document.createElement('div')
  root.className = 'modal abele-modal'
  root.dataset.abeleFixture = name
  root.appendChild(Object.assign(document.createElement('div'), { className: 'abele-modal__body' }))
  root.appendChild(
    Object.assign(document.createElement('div'), { className: 'abele-modal__footer' })
  )
  document.body.appendChild(root)
  return root
}
const runFocused = (script: string) =>
  new Function('return ' + script)() as Promise<Record<string, any>>
afterEach(() => {
  document.body.replaceChildren()
  delete (globalThis as any).app
  delete (window as any).__abeleTest
  for (const key of Object.keys(currentReport)) delete currentReport[key]
})

// Expand the exact native eval template, including its ordinary-review finalizer.
const nativeTemplate = () => {
  const file = readFileSync('tests/e2e/keyDestinationLayout.e2e.test.ts', 'utf8')
  const start = file.indexOf('`(async () => {', file.indexOf("describe('native recipient"))
  const end = file.indexOf('})()`', start) + 5
  return new Function(
    'fault',
    'shots',
    'recipientLayoutScript',
    'recipientLayoutProbe',
    'return ' + file.slice(start, end)
  )(
    'opening-refusal',
    '/unused',
    () => 'Promise.resolve({error:"Sample opening refusal",cleanupErrors:[]})',
    recipientLayoutProbe
  ) as string
}

describe('actual ordinary native guard finalization', () => {
  it.each(['sample-unrelated', 'key-destinations'])(
    'observes ordinary opening refusal without closing prior %s modal',
    async (name) => {
      const { api, ai, config } = setup()
      const unrelated = modal(name)
      let escaped = false
      unrelated.addEventListener('keydown', () => {
        escaped = true
      })
      api.secrets = () => ({ get: () => undefined })
      const original = () => Promise.reject(Error('Sample ordinary refusal'))
      api.openDialog = original
      const result = await new Function('return ' + nativeTemplate())()
      expect(result.ordinaryError).toBe('Sample ordinary refusal')
      expect(result.ordinaryCleanupErrors).toEqual([
        { stage: 'completion', message: 'Sample ordinary refusal' },
      ])
      expect(escaped).toBe(false)
      expect(unrelated.isConnected).toBe(true)
      expect(config.ai).toBe(ai)
      expect(api.openDialog).toBe(original)
    }
  )
  it.each([
    ['capture', ''],
    ['write', ''],
    ['capture', 'close'],
    ['write', 'completion'],
    ['', 'close'],
    ['', 'completion'],
  ])('closes and drains ordinary capture=%s cleanup=%s failures', async (failure, secondary) => {
    const { api, ai, config, stores } = setup()
    const calendars = config.calendars
    const before = JSON.stringify(config)
    stores.set('abele-key-destinations-v1', { sample: 'original' })
    const local = stores.get('abele-key-destinations-v1')
    api.secrets = () => ({ get: () => undefined })
    let closed = false
    let owned: HTMLElement | undefined
    let openings = 0
    const original = () => {
      const first = openings++ === 0
      owned = modal('key-destinations')
      config.ai = { secrets: ['synthetic'], providers: [] }
      stores.set('abele-key-destinations-v1', { sample: 'temporary' })
      if (first && secondary === 'close') {
        const dispatch = owned.dispatchEvent.bind(owned)
        let dispatching = false
        owned.dispatchEvent = (event) => {
          if (dispatching) return dispatch(event)
          dispatching = true
          try {
            dispatch(event)
          } finally {
            dispatching = false
          }
          throw Error('Sample close failure')
        }
      }
      return new Promise<void>((resolve, reject) =>
        owned!.addEventListener('keydown', () => {
          closed = true
          owned!.remove()
          queueMicrotask(() => {
            config.ai = ai
            stores.set('abele-key-destinations-v1', local)
            if (first && secondary === 'completion') reject(Error('Sample completion failure'))
            else resolve()
          })
        })
      )
    }
    api.openDialog = original
    const requireMock = (name: string) =>
      name === 'fs'
        ? {
            writeFileSync: () => {
              if (failure === 'write') throw Error('Sample write failure')
            },
          }
        : {
            getCurrentWindow: () => ({
              webContents: {
                capturePage: async () => {
                  if (failure === 'capture') throw Error('Sample capture failure')
                  return { toPNG: () => new Uint8Array() }
                },
              },
            }),
          }
    const pending = new Function('require', 'return ' + nativeTemplate())(
      requireMock
    ) as Promise<any>
    // Do not await a stranded consumer: inspect the actual close boundary after its microtasks.
    for (let i = 0; i < 40; i++) await Promise.resolve()
    const closedByConsumer = closed
    if (!closed) owned?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    const result = await pending.catch((error) => ({ ordinaryError: error.message }))
    expect(closedByConsumer).toBe(true)
    if (failure) expect(result.ordinaryError).toBe('Sample ' + failure + ' failure')
    else expect(result.ordinaryError).toContain('Recipient cleanup failed:')
    expect(result.ordinaryCleanupErrors).toEqual(
      secondary ? [{ stage: secondary, message: 'Sample ' + secondary + ' failure' }] : []
    )
    expect(config.ai).toBe(ai)
    expect(config.calendars).toBe(calendars)
    expect(JSON.stringify(config)).toBe(before)
    expect(stores.get('abele-key-destinations-v1')).toBe(local)
    expect(api.openDialog).toBe(original)
    expect(document.querySelector('.modal[data-abele-fixture]')).toBeNull()
    const next = api.openDialog('key-destinations')
    owned?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    await next
    expect(config.ai).toBe(ai)
  })
})

describe('actual recipient cleanup consumers', () => {
  it.each(['occupied slot', 'opening failure'])(
    'restores the focused wrapper after %s and keeps both primary and completion errors',
    async (reason) => {
      const { api, ai, config } = setup()
      const failure = new Error('Sample ' + reason)
      const original = (_name: string, options?: unknown) => {
        if (options) {
          const rejection = Promise.reject(failure)
          rejection.catch(() => {})
          return rejection
        }
        return Promise.resolve()
      }
      api.openDialog = original
      let result: Record<string, any> | undefined
      try {
        result = await runFocused(
          focusedScript('sample').replace('await wait(300)', 'await wait(0)')
        )
      } catch {
        /* Old finalizer rejected and leaked the wrapper. */
      }
      expect(api.openDialog).toBe(original)
      expect(config.ai).toBe(ai)
      expect(result?.error).toContain('Sample ' + reason)
      expect(result?.cleanupErrors.map((entry: { message: string }) => entry.message)).toContain(
        'Sample ' + reason
      )
      await api.openDialog('key-destinations')
    }
  )

  it('preserves a primary failure while recording both close and restoration failures', async () => {
    const { api } = setup()
    const original = () => Promise.resolve()
    api.openDialog = original
    const restore = helper().recipientFixture()
    const report = { error: 'Sample primary failure', cleanupErrors: [] }
    await helper().cleanupRecipientConsumer(
      report,
      async () => {
        throw new Error('Sample close failure')
      },
      async () => {
        await restore()
        throw new Error('Sample restoration failure')
      }
    )
    expect(report.error).toBe('Sample primary failure')
    expect(report.cleanupErrors).toEqual([
      { stage: 'close', message: 'Sample close failure' },
      { stage: 'restore', message: 'Sample restoration failure' },
    ])
    expect(api.openDialog).toBe(original)
  })

  it('drains all completion outcomes before checking restoration', async () => {
    const { api } = setup()
    let release!: () => void
    let first = true
    const original = () =>
      first
        ? ((first = false), Promise.reject(new Error('Sample refused opening')))
        : new Promise<void>((resolve) => {
            release = resolve
          })
    api.openDialog = original
    const restore = helper().recipientFixture()
    api.openDialog('key-destinations').catch(() => {})
    api.openDialog('key-destinations-new')
    let settled = false
    const restoration = restore().catch(() => {
      settled = true
    })
    await Promise.resolve()
    await Promise.resolve()
    expect(settled).toBe(false)
    release()
    await restoration
    expect(settled).toBe(true)
    expect(api.openDialog).toBe(original)
  })

  it('restores helper identity even when its own completion verification rejects', async () => {
    const { api } = setup()
    const original = () => Promise.reject(new Error('Sample completion failure'))
    api.openDialog = original
    const restore = helper().recipientFixture()
    const completion = api.openDialog('key-destinations')
    completion.catch(() => {})
    await expect(restore()).rejects.toThrow('Sample completion failure')
    expect(api.openDialog).toBe(original)
  })

  it.each(['occupied slot', 'opening failure'])(
    'captures broad %s refusal and restores the wrapper before the next ordinary fixture',
    async (reason) => {
      const { api, ai, config } = setup()
      let closed: (() => void) | undefined
      const original = (name: string, options?: unknown) => {
        if (options) {
          const rejection = Promise.reject(new Error('Sample ' + reason))
          rejection.catch(() => {})
          return rejection
        }
        config.ai = { secrets: [name], providers: [] }
        const root = modal(name)
        return new Promise<void>((resolve) => {
          closed = () => {
            root.remove()
            config.ai = ai
            resolve()
          }
        })
      }
      api.openDialog = original
      api.dialogNames = () => ['key-destinations', 'key-destinations-new']
      const run = new Function(
        'recipientFixture',
        'recipientActions',
        'cleanupRecipientConsumer',
        'closeDialog',
        'screen',
        'shoot',
        'measure',
        'until',
        'wait',
        'ringClipped',
        'report',
        'return (async () => {' + broadLoop + '; return report; })()'
      )
      const report = (await run(
        helper().recipientFixture,
        async () => ({}),
        helper().cleanupRecipientConsumer,
        async () => {
          closed?.()
        },
        async (label: string) => {
          currentReport[label] = {}
        },
        async () => '',
        () => ({}),
        async (fn: () => boolean) => {
          await Promise.resolve()
          return fn()
        },
        async () => {},
        () => [],
        currentReport
      )) as Record<string, any>
      expect(report['dialog key-destinations'].error).toBe('Sample ' + reason)
      expect(report['dialog key-destinations'].cleanupErrors).toEqual([
        { stage: 'completion', message: 'Sample ' + reason },
        { stage: 'restore', message: 'Sample ' + reason },
      ])
      expect(report['dialog key-destinations-new'].error ?? '').toBe('')
      expect(api.openDialog).toBe(original)
      expect(config.ai).toBe(ai)
    }
  )

  it('awaits broad cleanup before next fixture mutation and captures its rejection instead of leaking it', async () => {
    const { api, config, ai } = setup()
    const restores: Promise<void>[] = []
    let closed: (() => void) | undefined
    const original = (name: string) => {
      config.ai = { secrets: [name], providers: [] }
      const root = modal(name)
      return new Promise<void>((resolve) => {
        closed = () => {
          root.remove()
          config.ai = ai
          resolve()
        }
      })
    }
    api.openDialog = original
    api.dialogNames = () => ['key-destinations', 'key-destinations-new']
    const fixture = () => {
      const restore = helper().recipientFixture()
      return () => {
        const promise = restore()
        restores.push(promise)
        promise.catch(() => {})
        return promise
      }
    }
    const run = new Function(
      'recipientFixture',
      'recipientActions',
      'cleanupRecipientConsumer',
      'closeDialog',
      'screen',
      'shoot',
      'measure',
      'until',
      'wait',
      'ringClipped',
      'report',
      'return (async () => {' + broadLoop + '; return report; })()'
    )
    const report = (await run(
      fixture,
      async () => ({}),
      helper().cleanupRecipientConsumer,
      async () => {
        closed?.()
      },
      async (label: string) => {
        currentReport[label] = {}
      },
      async () => '',
      () => ({}),
      async (fn: () => boolean) => fn(),
      async () => {},
      () => [],
      currentReport
    )) as Record<string, any>
    const outcomes = await Promise.allSettled(restores)
    expect(outcomes.map((result) => result.status)).toEqual(['fulfilled'])
    expect(report['dialog key-destinations'].error ?? '').toBe('')
    expect(api.openDialog).toBe(original)
    expect(config.ai).toBe(ai)
  })
})
const currentReport: Record<string, any> = {}
