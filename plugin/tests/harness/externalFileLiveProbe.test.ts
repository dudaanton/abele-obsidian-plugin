// @vitest-environment node
import { readFileSync } from 'node:fs'
import ts from 'typescript'
import { expect, it, vi } from 'vitest'

function freeInstallProbe(): string {
  const source = ts.createSourceFile(
    'probe.ts',
    readFileSync('tests/e2e/externalFilePorts.e2e.test.ts', 'utf8'),
    ts.ScriptTarget.Latest,
    true
  )
  let body = ''
  const visit = (node: ts.Node): void => {
    if (
      ts.isNoSubstitutionTemplateLiteral(node) &&
      node.text.includes("const target=root+'/sample-free.bin'")
    )
      body = node.text
    ts.forEachChild(node, visit)
  }
  visit(source)
  if (!body) throw new Error('Free-install probe not found')
  return body
}

async function runProbe(installation: 'rename' | 'write' | 'copy' = 'rename') {
  const root = 'sample-probe'
  const adapter = {
    writeBinary: vi.fn(async (_path: string, _data?: Uint8Array) => {}),
    copy: vi.fn(async (_from: string, _to: string) => {}),
    rename: vi.fn(async (_from: string, _to: string) => {}),
    exists: async () => false,
  }
  const host = {
    run: async (_serial: unknown, _request: unknown, work: (effects: unknown) => unknown) =>
      work({
        stage: async (artifact: { path: string }, data: Uint8Array) => {
          await adapter.writeBinary('.obsidian/plugins/sample/sync-staging/sample.tmp')
          await adapter.rename('other/sample.incoming', 'other/sample.bin')
          await adapter.copy('other/sample.bin', 'other/sample-copy.bin')
          await adapter.writeBinary(artifact.path, data)
        },
        install: async (artifact: { path: string }, target: string) => {
          if (installation === 'copy') await adapter.copy(artifact.path, target)
          else if (installation === 'write') await adapter.writeBinary(target)
          else await adapter.rename(artifact.path, target)
          return { status: 'installed' }
        },
      }),
  }
  const execute = new Function(
    'root',
    'adapter',
    'host',
    `return (async()=>{
      const encode=s=>new TextEncoder().encode(s),artifact=async path=>({path}),
        read=async()=> 'sample incoming',serial={},request=paths=>({paths});
      ${freeInstallProbe()}
    })()`
  )
  return execute(root, adapter, host)
}

it('counts only probe-owned paths while unrelated vault work proceeds', async () => {
  const result = await runProbe()
  expect(result.writes).toEqual(['sample-probe/.abele-external-free.incoming'])
  expect(result.copies).toBe(0)
  expect(result.renames).toBe(1)
})

it('still records an invalid final-target write', async () => {
  const result = await runProbe('write')
  expect(result.writes).toEqual([
    'sample-probe/.abele-external-free.incoming',
    'sample-probe/sample-free.bin',
  ])
})

it('still refuses adapter copy for the probe-owned installation', async () => {
  await expect(runProbe('copy')).rejects.toThrow('Copy is not an installer')
})
