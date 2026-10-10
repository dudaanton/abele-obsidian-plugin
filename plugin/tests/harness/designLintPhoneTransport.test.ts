import { afterEach, expect, it, vi } from 'vitest'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { get } from 'node:http'

const transport = vi.hoisted(() => ({ eval: vi.fn(), shot: vi.fn(), expose: vi.fn(() => vi.fn()) }))
vi.mock('../e2e/helpers/obsidianCli', () => ({ evalLong: transport.eval }))
vi.mock('../e2e/helpers/target', () => ({ onPhone: () => true }))
vi.mock('../e2e/helpers/phone', () => ({
  screenshot: transport.shot,
  exposeToPhone: transport.expose,
}))
import { measureDesign } from '../e2e/helpers/designLint'

let directory: string
// The transport is entirely mocked: this harness test never takes or drives a device.
afterEach(() => {
  if (directory) rmSync(directory, { recursive: true, force: true })
  vi.clearAllMocks()
})
it('captures and annotates native phone evidence without Electron, Node or filesystem APIs in the page', async () => {
  directory = mkdtempSync(join(tmpdir(), 'sample-design-transport-'))
  const image = Buffer.alloc(512 * 1024, 42)
  transport.shot.mockImplementation((path) => writeFileSync(path, image))
  transport.eval
    .mockResolvedValueOnce(
      JSON.stringify({
        selector: '.sample',
        viewport: { width: 390, height: 844 },
        mobile: true,
        scale: [0, 4, 8],
        elements: [],
      })
    )
    .mockImplementationOnce(async (code: string) => {
      const url = JSON.parse(/url:("[^"]+")/.exec(code)![1]) as string
      const payload = await new Promise<string>((resolve, reject) => {
        get(url, (response) => {
          let body = ''
          response.setEncoding('utf8')
          response.on('data', (chunk) => {
            body += chunk
          })
          response.on('end', () => resolve(body))
          response.on('error', reject)
        }).on('error', reject)
      })
      expect(JSON.parse(payload)).toMatchObject({
        snapshot: { selector: '.sample' },
        violations: [],
        png: 'data:image/png;base64,' + image.toString('base64'),
      })
      return JSON.stringify([
        { name: 'annotated.png', data: 'data:image/png;base64,' + image.toString('base64') },
      ])
    })
  const report = await measureDesign('.sample', directory)
  expect(report.violations).toEqual([])
  expect(transport.shot).toHaveBeenCalledWith(join(directory, 'capture.png'))
  for (const [code] of transport.eval.mock.calls)
    expect(code).not.toMatch(/require\(['"](?:fs|path|@electron\/remote)/)
  expect(transport.eval.mock.calls[1][0]).not.toContain(image.toString('base64'))
  expect(transport.eval.mock.calls[1][0].length).toBeLessThan(12_000)
  expect(transport.expose).toHaveBeenCalledOnce()
  expect(transport.expose.mock.results[0].value).toHaveBeenCalledOnce()
  expect(readFileSync(join(directory, 'annotated.png'))).toEqual(image)
})
