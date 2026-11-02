import { describe, it, expect } from 'vitest'
import { isObsidianRunning, hasTestApi, evalRaw } from './helpers/obsidianCli'

const script = `(async () => {
  const t = window.__abeleTest
  const app = window.app
  const folder = 'SearchProbe-' + Date.now()
  const scope = new t.ScopeResolver()
  scope.setFullVaultAccess(true)
  const read = app.vault.cachedRead
  let reads = 0
  const samples = []
  try {
    await app.vault.createFolder(folder)
    const meta = JSON.stringify({v:2,k:'meta',type:'abele-chat',title:'Invented probe'})
    const privateLine = JSON.stringify({k:'int',role:'toolResult',content:'private-probe '.repeat(4096)})
    const raw = meta + '\\n' + JSON.stringify({k:'msg',id:'u',role:'user',content:'public-probe',timestamp:1}) + '\\n' + Array(1700).fill(privateLine).join('\\n') + '\\n'
    await app.vault.create(folder + '/Sample.abchat', raw)
    await app.vault.create(folder + '/Note.md', 'public-probe')
    await app.vault.createBinary(folder + '/Sample.pdf', new TextEncoder().encode('public-probe').buffer)
    app.vault.cachedRead = async function(file) {
      if (file.path.startsWith(folder + '/')) reads++
      return read.call(this, file)
    }
    const find = t.createAgentTools({scope}).find(x => x.name === 'find')
    for (const word of ['public-probe','private-probe']) {
      const before = reads
      let ticks = 0
      const timer = setInterval(() => ticks++, 5)
      const start = performance.now()
      try {
        const result = await find.execute('probe', {criteria:[{type:'path',operator:'startsWith',value:folder+'/'},{type:'content',operator:'contains',value:word}],limit:10})
        samples.push({word,text:result.content[0].text,reads:reads-before,ms:performance.now()-start,ticks})
      } finally { clearInterval(timer) }
    }
    return JSON.stringify(samples)
  } finally {
    app.vault.cachedRead = read
    scope.destroy()
    const file = app.vault.getAbstractFileByPath(folder)
    if (file) await app.vault.delete(file, true)
  }
})()`

describe.skipIf(!isObsidianRunning() || !hasTestApi())('large chat vault search in desktop', () => {
  it('searches only public text, skips binary bytes and reuses the transcript', () => {
    const samples = JSON.parse(evalRaw(script, 120_000))
    console.info('desktop large search', samples)
    expect(samples[0].text).toContain('2 files:')
    expect(samples[0].text).not.toContain('.pdf')
    expect(samples[0].ticks).toBeGreaterThan(0)
    expect(samples[1].text).toBe('No files found.')
    expect(samples[1].reads).toBe(1)
  }, 150_000)
})
