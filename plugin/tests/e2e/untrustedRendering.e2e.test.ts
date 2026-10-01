import { describe, expect, it } from 'vitest'
import { hasTestApi, isObsidianRunning } from './helpers/obsidianCli'
import { evalAsync } from './helpers/githubLive'

const available = isObsidianRunning() && hasTestApi()
describe.runIf(available)('untrusted rendering in the app', () => {
  it('runs a sample plugin block in notes, never in replies or GitHub text', () => {
    const result = evalAsync<{
      trusted: number
      untrusted: number
      code: string
    }>(String.raw`(async () => {
      const api = window.__abeleTest
      const r = api.rendering
      const owner = new r.Component(); owner.load()
      const host = document.createElement('div')
      document.body.append(host)
      let ran = 0
      const processor = api.plugin.registerMarkdownCodeBlockProcessor('sample-executable', () => { ran++ })
      const text = ['- ' + '\x60'.repeat(3) + 'sample-executable', '  sample()', '  ' + '\x60'.repeat(3)].join('\n')
      try {
        await r.MarkdownRenderer.render(app, text, host, '', owner)
        const trusted = ran
        host.replaceChildren()
        await r.renderUntrustedMarkdown(host, text, owner)
        const code = host.textContent
        host.replaceChildren()
        await r.renderGithubMarkdown(host, text, { host:'github.com', owner:'sample-org', repo:'sample-repo', ref:'HEAD', path:'README.md' }, owner)
        return { trusted, untrusted: ran - trusted, code }
      } finally {
        r.MarkdownPreviewRenderer.unregisterPostProcessor(processor)
        delete r.MarkdownPreviewRenderer.codeBlockPostProcessors['sample-executable']
        owner.unload(); host.remove()
      }
    })()`)
    expect(result.trusted).toBeGreaterThan(0)
    expect(result.untrusted).toBe(0)
    expect(result.code).toContain('sample()')
  })

  it('holds GitHub image requests and strips active markup in the real renderer', () => {
    const result = evalAsync<{
      images: number
      buttons: number
      frames: number
      forms: number
      fixed: number
      requests: number
    }>(`(async () => {
      const r = window.__abeleTest.rendering
      const owner = new r.Component(); owner.load()
      const host = document.createElement('div'); document.body.append(host)
      const address = 'https://render-fixture.example.invalid/sample-image.png'
      const start = performance.now()
      try {
        await r.renderGithubMarkdown(host, '<img src="' + address + '"><iframe src="https://render-fixture.example.invalid/sample-frame"></iframe><form action="obsidian://abele"><input><button>Submit</button></form><p style="position:fixed;inset:0;color:red">Sample</p>', {host:'github.com',owner:'sample-org',repo:'sample-repo',ref:'HEAD',path:''}, owner)
        await new Promise(resolve => setTimeout(resolve, 600))
        return { images: host.querySelectorAll('img[src]').length, buttons: host.querySelectorAll('.abele-remote-image').length, frames: host.querySelectorAll('iframe').length, forms: host.querySelectorAll('form').length, fixed: [...host.querySelectorAll('[style]')].filter(el => el.style.position === 'fixed').length, requests: performance.getEntriesByType('resource').filter(e => e.startTime >= start && e.name.includes('render-fixture.example.invalid')).length }
      } finally { owner.unload(); host.remove() }
    })()`)
    expect(result).toEqual({ images: 0, buttons: 1, frames: 0, forms: 0, fixed: 0, requests: 0 })
  })

  it('preserves CDATA as table text with the browser XML parser', () => {
    const result = evalAsync<{ injected: boolean; cell: string }>(`(() => {
      const doc = new DOMParser().parseFromString('<html xmlns="http://www.w3.org/1999/xhtml"><head/><body><table><tr><td><![CDATA[sample><img id="sample-injected" src="x"/>]]></td></tr></table></body></html>', 'application/xhtml+xml')
      const html = window.__abeleTest.rendering.tablePage(doc.querySelector('table'))
      const shown = new DOMParser().parseFromString(html, 'text/html')
      return { injected: !!shown.getElementById('sample-injected'), cell: shown.querySelector('td').textContent }
    })()`)
    expect(result.injected).toBe(false)
    expect(result.cell).toBe('sample><img id="sample-injected" src="x"/>')
  })
})
