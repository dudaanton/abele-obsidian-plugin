import { readFileSync } from 'node:fs'
import ts from 'typescript'
import { IDBFactory } from 'fake-indexeddb'
import { afterEach, expect, it, vi } from 'vitest'
import type { App } from 'obsidian'
import { TokenConnectionRegistry, TOKEN_REGISTRY_KEY } from '@/sync/tokenConnectionRegistry'
import { activateScriptProvenance, scriptTrustFor } from '@/scripting/trust/scriptTrustStorage'
import { scriptForExecution } from '@/scripting/trust/scriptExecutionGate'
import { useVault } from '../helpers/testEnv'

function liveProbe(): string {
  const source = ts.createSourceFile(
    'probe.ts',
    readFileSync('tests/e2e/scriptApproval.e2e.test.ts', 'utf8'),
    ts.ScriptTarget.Latest,
    true
  )
  let template = ''
  const visit = (node: ts.Node): void => {
    if (
      ts.isTemplateExpression(node) &&
      node.getText(source).includes("const key = 'abele-script-provenance'")
    )
      template = node.getText(source)
    ts.forEachChild(node, visit)
  }
  visit(source)
  if (!template) throw new Error('Approval persistence probe not found')
  return new Function('probePrelude', 'shots', 'TOKEN_REGISTRY_KEY', `return ${template}`)(
    () => 'const until = async check => !!check()',
    '',
    TOKEN_REGISTRY_KEY
  )
}

afterEach(() => {
  document.body.replaceChildren()
  delete (window as any).__abeleTest
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

it.each([
  { selected: false, failCleanup: false },
  { selected: true, failCleanup: false },
  { selected: true, failCleanup: true },
])(
  'owns and restores approval context (selected=$selected, cleanup failure=$failCleanup)',
  async ({ selected, failCleanup }) => {
    const app = useVault([])
    const factory = new IDBFactory()
    vi.stubGlobal('indexedDB', factory)
    const original = await activateScriptProvenance(
      app as unknown as App,
      {
        endpoint: 'local:',
        vaultId: 'local',
        principal: 'local',
        facet: 'personal',
        grantId: null,
      },
      factory
    )
    await original.store.setMeta('sample-retained-evidence', 'keep')
    original.store.close()
    const registry = TokenConnectionRegistry.open(app)
    if (selected) registry.add()
    const savedRegistry = structuredClone(app.loadLocalStorage(TOKEN_REGISTRY_KEY))
    const savedDescriptor = structuredClone(app.loadLocalStorage('abele-script-provenance'))
    const savedMarker = await app.vault.adapter.readBinary('.abele-script-managed')
    app.saveLocalStorage('abele-sync-connection', { vaultId: 'sample-retired-vault' })
    const savedLegacy = structuredClone(app.loadLocalStorage('abele-sync-connection'))
    const dialog: { value: { answer(value: boolean): void } | null } = { value: null }
    ;(window as any).__abeleTest = {
      scriptTrust: {
        activate: activateScriptProvenance,
        load: scriptForExecution,
        dialog,
        confirm: () =>
          new Promise<boolean>((resolve) => {
            const review = document.createElement('div')
            review.className = 'abele-script-approval'
            const approve = document.createElement('button')
            approve.textContent = 'Approve and run'
            dialog.value = {
              answer: (value) => {
                dialog.value = null
                review.remove()
                resolve(value)
              },
            }
            approve.onclick = () => dialog.value?.answer(true)
            review.append(approve)
            document.body.append(review)
          }),
      },
    }
    // The probe starts its load asynchronously; let its real approval request reach the fake dialog.
    const probe = liveProbe().replace(
      'const until = async check => !!check()',
      'const until = async check => { for(let i=0;i<100;i++){if(check())return true;await new Promise(r=>setTimeout(r,1))}return false }'
    )
    if (failCleanup)
      vi.spyOn(factory, 'deleteDatabase').mockImplementation(() => {
        const request = {
          error: new DOMException('Sample database cleanup failed'),
          onerror: null as (() => void) | null,
        }
        queueMicrotask(() => request.onerror?.())
        return request as unknown as IDBOpenDBRequest
      })
    const pending = new Function('app', `return ${probe}`)(app)
    if (failCleanup) await expect(pending).rejects.toThrow('Sample database cleanup failed')
    else {
      const result = await pending
      expect(result).toMatchObject({ matches: true, dialogClosed: true })
      expect(result.code).toContain('return "native-approved"')
    }
    expect(app.loadLocalStorage(TOKEN_REGISTRY_KEY)).toEqual(savedRegistry)
    expect(app.loadLocalStorage('abele-sync-connection')).toEqual(savedLegacy)
    expect(app.loadLocalStorage('abele-script-provenance')).toEqual(savedDescriptor)
    expect(await app.vault.adapter.readBinary('.abele-script-managed')).toEqual(savedMarker)
    expect(app.vault.getAbstractFileByPath('ScriptApprovalProbe')).toBeNull()
    const restored = await scriptTrustFor(app as unknown as App, factory)
    expect(await restored!.store.getMeta('sample-retained-evidence')).toBe('keep')
    restored!.store.close()
  }
)

it('blocks approval when the real token connection selection changes during the decision', async () => {
  const path = 'Scripts/sample.js'
  const app = useVault([{ path, content: '// @name Sample\nreturn "sample"' }])
  const factory = new IDBFactory()
  vi.stubGlobal('indexedDB', factory)
  const registry = TokenConnectionRegistry.open(app)
  const context = await activateScriptProvenance(
    app as unknown as App,
    {
      endpoint: 'local:',
      vaultId: 'local',
      principal: 'local',
      facet: 'personal',
      grantId: null,
    },
    factory
  )
  await context.provenance.record(path, 'sample-file')
  context.store.close()
  await expect(
    scriptForExecution(app as unknown as App, path, async () => {
      registry.add()
      return true
    })
  ).rejects.toThrow(/changed/)
})
