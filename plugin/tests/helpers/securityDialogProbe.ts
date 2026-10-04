export interface DialogReport {
  shell: boolean
  bodyActions: string[]
  actions: string[]
  rows: { name: string; description: string; actions: string[] }[]
  outside: string[]
  scrolled: boolean
  footerMoved: number
  shot: string
  restored: boolean
}

export const securityDialogScript = (name: string, shot: string) => `(async () => {
  const wait = ms => new Promise(resolve => setTimeout(resolve, ms))
  const until = async fn => {
    const deadline = Date.now() + 5000
    while (Date.now() < deadline) { if (fn()) return; await wait(50) }
    throw Error('owned security dialog did not open')
  }
  const config = window.__abeleTest.AbeleConfig.getInstance()
  const originalAi = config.ai
  const state = () => JSON.stringify({ ai: config.ai, firefly: config.fireflyBaseUrl, calendars: config.calendars,
    local: ['abele-key-destinations-v1', 'abele-key-http-origins-v1'].map(key => app.loadLocalStorage(key)) })
  const beforeState = state()
  const completion = window.__abeleTest.openDialog(${JSON.stringify(name)})
  let result, modal
  try {
    await until(() => document.querySelector('.modal[data-abele-fixture=' + ${JSON.stringify(JSON.stringify(name))} + ']'))
    modal = document.querySelector('.modal[data-abele-fixture=' + ${JSON.stringify(JSON.stringify(name))} + ']')
    await wait(400)
    const body = modal.querySelector('.abele-modal__body'), footer = modal.querySelector('.abele-modal__footer')
    if (!body || !footer) throw Error('security dialog is missing the shared body or footer')
    let saved
    if (window.__e2eHost) saved = await window.__e2eHost.shot(${JSON.stringify(shot)})
    else {
      const image = await require('@electron/remote').getCurrentWindow().webContents.capturePage()
      require('fs').writeFileSync(${JSON.stringify(shot)}, image.toPNG()); saved = ${JSON.stringify(shot)}
    }
    const rows = [...body.querySelectorAll('.setting-item')].filter(row => row.querySelector('button')).map(row => ({
      name: row.querySelector('.setting-item-name')?.textContent.trim() ?? '',
      description: row.querySelector('.setting-item-description')?.textContent.trim() ?? '',
      actions: [...row.querySelectorAll('button')].map(button => button.textContent.trim()),
    }))
    for (let i = 0; i < 30; i++) body.createEl('p', { text: 'Sample explanation of a saved-key destination.' })
    await wait(100)
    const before = footer.getBoundingClientRect().top
    body.scrollTop = body.scrollHeight
    await wait(100)
    const outside = [...footer.querySelectorAll('button')].filter(button => {
      const r = button.getBoundingClientRect()
      return r.width <= 0 || r.left < 0 || r.right > innerWidth || r.top < 0 || r.bottom > innerHeight
    }).map(button => button.textContent.trim())
    const r = modal.getBoundingClientRect()
    if (r.top < 0 || r.bottom > innerHeight) outside.push('dialog')
    result = { shell: modal.matches('.modal.abele-modal'), rows,
      bodyActions: [...body.querySelectorAll('button')].map(button => button.textContent.trim()),
      actions: [...footer.querySelectorAll('button')].map(button => button.textContent.trim()),
      outside, scrolled: body.scrollTop > 0, footerMoved: Math.abs(footer.getBoundingClientRect().top - before), shot: saved }
  } finally {
    modal?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', keyCode: 27, bubbles: true }))
    await completion
    if (document.querySelector('.modal[data-abele-fixture]')) throw Error('owned security fixture did not close')
  }
  result.restored = config.ai === originalAi && state() === beforeState
  if (!result.restored) throw Error('security fixture did not restore exact state')
  return result
})()`
