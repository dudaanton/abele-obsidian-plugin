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
  return { ai, config, api }
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
