import { expect, it } from 'vitest'
import { evalAsync } from './helpers/githubLive'

it('reads and selects the saved active conversation before background tabs', () => {
  const result = evalAsync<
    Array<{ readyMs: number; totalMs: number; bytesAtReady: number; first: string; active: string }>
  >(
    `(async () => {
    const T = window.__abeleTest
    const service = T.ChatService.getInstance()
    const storage = T.ChatStorage.getInstance()
    const key = 'abele-agent-tabs'
    const previous = app.loadLocalStorage(key)
    const folder = 'SampleStartupChats'
    if (app.vault.getAbstractFileByPath(folder)) throw new Error('Fixture folder already exists')
    const paths = Array.from({length: 4}, (_, i) => folder + '/sample-chat-' + i + '.abchat')
    const active = paths[3]
    const load = storage.loadChat
    const samples = []
    try {
      await app.vault.createFolder(folder)
      for (let i = 0; i < paths.length; i++) {
        const rows = [JSON.stringify({v: 2, k: 'meta', type: 'abele-chat', title: 'Sample chat ' + i, created: '2024-01-01'})]
        for (let m = 0; m < (i === 3 ? 1 : 150); m++) rows.push(JSON.stringify({
          k: 'msg', id: 'sample-message-' + m, parentId: m ? 'sample-message-' + (m - 1) : null,
          role: m % 2 ? 'assistant' : 'user', content: 'sample '.repeat(i === 3 ? 40 : 1400), timestamp: m + 1,
        }))
        await app.vault.create(paths[i], rows.join('\\n') + '\\n')
      }
      for (let run = 0; run < 5; run++) {
        app.saveLocalStorage(key, {tabs: paths.map(chatFilePath => ({chatFilePath})), activeIndex: 3})
        let bytes = 0, readyMs = null, bytesAtReady = null, first = null
        const start = performance.now()
        const check = () => {
          if (readyMs === null && service.activeSession.value?.currentChatFile.value?.path === active) {
            readyMs = performance.now() - start
            bytesAtReady = bytes
          }
        }
        storage.loadChat = async function(file) {
          check()
          first ??= file.path
          bytes += file.stat.size
          return await load.call(this, file)
        }
        await service.restoreTabs()
        check()
        samples.push({readyMs, totalMs: performance.now() - start, bytesAtReady, first, active})
      }
      return samples
    } finally {
      storage.loadChat = load
      app.saveLocalStorage(key, previous)
      await service.restoreTabs()
      const made = app.vault.getAbstractFileByPath(folder)
      if (made) await app.vault.delete(made, true)
    }
  })()`,
    120_000
  )
  console.info('chat restoration samples', JSON.stringify(result))
  expect(result).toHaveLength(5)
  for (const sample of result) {
    expect(sample.first).toBe(sample.active)
    expect(sample.bytesAtReady).toBeLessThan(1000)
  }
}, 130_000)
