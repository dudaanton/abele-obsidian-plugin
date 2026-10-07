/** Synthetic presentation data, restored without saving; no scripts execute. */
export const SELECTION_MENUS_SETUP = `
  const menuConfig = window.__abeleTest.AbeleConfig.getInstance()
  const menuService = window.__abeleTest.ScriptService.getInstance()
  const oldMenuReader = menuConfig.reader
  const oldMenuAi = menuConfig.ai
  const oldMenuScripts = menuService.scriptList.value
  const menuEntries = Array.from({length: 12}, (_, i) => ({script: 'Sample selection script ' + i + ' with a long descriptive name', name: 'Sample menu label ' + i + ' with a long descriptive name', icon: ''}))
  menuService.scriptList.value = menuEntries.map(e => ({path: 'Scripts/sample.js', code: '', commandId: '', meta: {name: e.script, description: '', params: []}}))
  menuConfig.reader = {...oldMenuReader, selectionScripts: menuEntries}
  menuConfig.ai = {...oldMenuAi, scriptsEnabled: true, chatSelectionScripts: menuEntries.map(e => ({...e, name: e.name + ' in chat'}))}
  menuConfig.version.value++
`

export const SELECTION_MENUS_CLEANUP = `
  const cleanupDoc = app.setting.activeTab?.containerEl.ownerDocument
  if (!cleanupDoc?.querySelector('.abele-settings__nav .abele-tabs__tab')?.getBoundingClientRect().width) {
    cleanupDoc?.querySelector('.modal-setting-back-button')?.click()
    await wait(300)
  }
  app.setting.close()
  menuConfig.reader = oldMenuReader
  menuConfig.ai = oldMenuAi
  menuService.scriptList.value = oldMenuScripts
  menuConfig.version.value++
`

/** Uses the existing native settings navigation on desktop and narrow layouts. */
export const SELECTION_MENUS_OPEN = `
  app.setting.open()
  app.setting.openTabById('abele')
  if (!await until(() => app.setting.activeTab?.containerEl, 5000)) throw Error('Settings tab did not open')
  await wait(300)
  const menuDoc = app.setting.activeTab.containerEl.ownerDocument
  const menuNav = () => menuDoc.querySelector('.abele-settings__nav .abele-tabs__tab')?.getBoundingClientRect().width
  if (!menuNav()) { menuDoc.querySelector('.modal-setting-back-button')?.click(); await wait(300) }
  if (!await until(menuNav, 5000)) throw Error('Settings did not open')
  ;[...menuDoc.querySelectorAll('.abele-settings__nav .abele-tabs__tab')].find(t => t.textContent.trim() === 'Scripts')?.click()
  if (!await until(() => menuDoc.querySelector('.abele-settings__scripts-tabs'), 5000)) throw Error('Scripts settings did not open')
  ;[...menuDoc.querySelectorAll('.abele-settings__scripts-tabs .abele-tabs__tab')].find(t => t.textContent.trim() === 'Selection menus')?.click()
  if (!await until(() => menuDoc.querySelector('.abele-selection-scripts-settings'), 5000)) throw Error('Selection menus did not open')
`
