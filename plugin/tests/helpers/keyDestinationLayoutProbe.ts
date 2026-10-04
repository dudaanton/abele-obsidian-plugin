// Browser-side test instrumentation shared by the broad layout tier and focused/device probes.
// Metadata and form input only: it never clicks a consent/removal action or sends credentials.
export const recipientLayoutProbe = String.raw`
  const recipientError = error => String(error?.message ?? error)
  const cleanupRecipientConsumer = async (report, close, restore, completion) => {
    const failures = report.cleanupErrors ??= []
    try { await close() } catch (error) { failures.push({ stage: 'close', message: recipientError(error) }) }
    try { if (completion) await completion } catch (error) { failures.push({ stage: 'completion', message: recipientError(error) }) }
    // Restoration is unconditional, including when close or the completion itself rejected.
    try { if (restore) await restore() } catch (error) { failures.push({ stage: 'restore', message: recipientError(error) }) }
    if (failures.length && !report.error) report.error = 'Recipient cleanup failed: ' + failures.map(failure => failure.stage + ': ' + failure.message).join('; ')
    report.restored = failures.length === 0
  }
  const recipientFixture = () => {
    const api = window.__abeleTest, config = api.AbeleConfig.getInstance()
    const open = api.openDialog, completions = []
    const snapshot = () => JSON.stringify({ ai: config.ai, firefly: config.fireflyBaseUrl, calendars: config.calendars,
      local: ['abele-key-destinations-v1', 'abele-key-http-origins-v1'].map(key => app.loadLocalStorage(key)) })
    const before = snapshot(), originalAi = config.ai
    // Select an explicit owned profile instead of mutating ambient settings underneath a
    // dialog that has an independently settling restoration callback.
    api.openDialog = (name, options) => {
      const completion = open(name, name === 'key-destinations' ? { ...options, recipientRows: true } : options)
      if (completion) completions.push(completion)
      return completion
    }
    return async () => {
      let failures = []
      try {
        const results = await Promise.allSettled(completions)
        failures = results.filter(result => result.status === 'rejected').map(result => result.reason)
      } finally { api.openDialog = open }
      if (config.ai !== originalAi || snapshot() !== before) failures.push(Error('Recipient fixture state was not restored exactly'))
      if (failures.length === 1) throw failures[0]
      if (failures.length) throw new AggregateError(failures, failures.map(recipientError).join('; '))
    }
  }
  const recipientActions = async modal => {
    const wait = ms => new Promise(resolve => setTimeout(resolve, ms))
    const name = el => ((el.className || el.tagName) + '').split(' ')[0].slice(0, 48)
    const body = modal.querySelector('.abele-modal__body'), footer = modal.querySelector('.abele-modal__footer')
    const set = (label, value) => {
      const field = body.querySelector('input[aria-label="' + label + '"]')
      if (!field) throw Error('missing sample field: ' + label)
      field.value = value; field.dispatchEvent(new Event('input', { bubbles: true }))
    }
    const picker = body.querySelector('select[aria-label="Saved key"]')
    picker.value = 'new'; picker.dispatchEvent(new Event('change', { bubbles: true }))
    set('Recipient address', 'https://primary.sample.example/status')
    set('New key name', 'Sample primary key'); set('New key value', 'fake-layout-only-value')
    const fullyVisible = (element, container = body) => {
      const r = element.getBoundingClientRect(), b = container.getBoundingClientRect()
      return r.width > 0 && r.height > 0 && r.left >= b.left && r.right <= b.right && r.top >= b.top && r.bottom <= b.bottom
    }
    const action = async (button, row) => {
      row.scrollIntoView({ block: 'center', behavior: 'instant' })
      button.focus({ preventScroll: true }); await wait(30)
      const r = button.getBoundingClientRect(), cs = getComputedStyle(button)
      const nums = (cs.boxShadow.match(/-?\d+(\.\d+)?px/g) || []).map(parseFloat)
      const shadow = nums.length >= 4 ? Math.max(0, nums[2]) + Math.max(0, nums[3]) : 0
      const outline = cs.outlineStyle !== 'none' ? parseFloat(cs.outlineWidth) + parseFloat(cs.outlineOffset || '0') : 0
      const reach = Math.max(shadow, outline), clipped = []
      for (let el = button.parentElement; el && el !== document.documentElement; el = el.parentElement) {
        const style = getComputedStyle(el), b = el.getBoundingClientRect()
        const top = b.top + el.clientTop, left = b.left + el.clientLeft
        if (style.overflowY !== 'visible' && Math.max(top - (r.top - reach), r.bottom + reach - (top + el.clientHeight)) > .5) clipped.push('vertical ' + name(el))
        if (style.overflowX !== 'visible' && Math.max(left - (r.left - reach), r.right + reach - (left + el.clientWidth)) > .5) clipped.push('horizontal ' + name(el))
      }
      const hit = document.elementFromPoint((r.left + r.right) / 2, (r.top + r.bottom) / 2)
      const label = row.querySelector('.setting-item-name'), description = row.querySelector('.setting-item-description')
      const result = { text: button.textContent.trim(), focused: document.activeElement === button,
        reachable: !!hit && button.contains(hit), inViewport: r.width > 0 && r.height > 0 && r.left >= 0 && r.right <= innerWidth && r.top >= 0 && r.bottom <= innerHeight,
        contextVisible: row === footer ? fullyVisible(footer.querySelector('p'), footer) : !!label && !!description && fullyVisible(label) && fullyVisible(description), clipped }
      button.blur(); return result
    }
    const rows = [], unpairedActions = []
    for (const button of body.querySelectorAll('button')) if (!button.closest('.setting-item')) unpairedActions.push(button.textContent.trim())
    for (const row of body.querySelectorAll('.setting-item')) {
      if (!row.querySelector('button')) continue
      let sibling = row
      while (sibling.parentElement !== body) sibling = sibling.parentElement
      while (sibling && sibling.tagName !== 'H3') sibling = sibling.previousElementSibling
      const label = row.querySelector('.setting-item-name')?.textContent.trim() ?? ''
      const description = row.querySelector('.setting-item-description')?.textContent.trim() ?? ''
      const recipient = (description.match(/https?:\/\/[^\s]+/) || label.match(/^https?:\/\/[^\s]+/) || [''])[0]
      const actions = []
      // Serial focus is essential: the last button must not steal another button's proof.
      for (const button of row.querySelectorAll('button')) actions.push(await action(button, row))
      rows.push({ section: sibling?.textContent.trim() ?? '', name: label, description, recipient, actions })
    }
    const primary = footer.querySelector('button'), primaryResult = await action(primary, footer)
    primaryResult.pinned = primary.closest('.abele-modal__footer') === footer
    primaryResult.summary = footer.querySelector('p')?.textContent.trim() ?? ''
    body.scrollTop = 0
    return { rows, unpairedActions, primary: primaryResult,
      bodyActions: [...body.querySelectorAll('button')].map(button => button.textContent.trim()),
      pinnedActions: [...footer.querySelectorAll('button')].map(button => button.textContent.trim()) }
  }
`
