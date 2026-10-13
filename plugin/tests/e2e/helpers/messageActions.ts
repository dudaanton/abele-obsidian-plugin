/** A real local chat message, rendered by the sidebar; no provider or tools run. */
export const MESSAGE_ACTIONS_SETUP = `
  const actionService = window.__abeleTest.ChatService.getInstance()
  const actionPrevious = actionService.activeTabId.value
  const actionPath = 'sample-message-actions-' + crypto.randomUUID() + '.abchat'
  if (app.vault.getAbstractFileByPath(actionPath)) throw Error('Synthetic message file already exists')
  const actionConfig = window.__abeleTest.AbeleConfig.getInstance().ai
  const actionFile = await app.vault.create(actionPath, [
    {v:2,k:'meta',type:'abele-chat',title:'Sample conversation',created:'2025-01-01',
      providerId:actionConfig.activeProviderId,modelId:actionConfig.activeModelId,
      agentId:window.__abeleTest.AgentRegistry.getInstance().defaultAgent()?.id,
      activeLeafId:'sample-later'},
    {k:'msg',id:'sample-user',role:'user',content:'Explain how a small garden changes with the seasons.',timestamp:1},
    {k:'msg',id:'sample-answer',parentId:'sample-user',role:'assistant',content:'In spring the garden starts growing. In summer it flowers. Autumn brings seeds, and winter gives the soil time to rest.',timestamp:2},
    {k:'msg',id:'sample-later',parentId:'sample-answer',role:'user',content:'What would you plant first?',timestamp:3}
  ].map(record=>JSON.stringify(record)).join('\\n')+'\\n')
  let actionSourceId, actionRow
  const cleanupActionFixture = async () => {
    try { if (actionSourceId) await actionService.deleteChat(actionSourceId) }
    finally {
      if (app.vault.getAbstractFileByPath(actionPath) === actionFile) await app.vault.delete(actionFile)
      if (actionPrevious) actionService.switchTab(actionPrevious)
    }
  }
  try {
  await actionService.openChatFile(actionFile)
  actionSourceId = actionService.getSessionByFile(actionPath)?.id
  await actionService.revealSidebar({ focus: false })
  if (!await until(()=>document.querySelector('.abele-chat-msg_assistant button.abele-chat-msg__icon')?.getBoundingClientRect().width,5000)) throw Error('Sample message did not render')
  actionRow = document.querySelector('.abele-chat-msg_assistant')
  actionRow.querySelector('button.abele-chat-msg__icon').click()
  await wait(200)
  } catch (error) { await cleanupActionFixture(); throw error }
`

export const MESSAGE_ACTIONS_CLEANUP = `
  document.body.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',code:'Escape',keyCode:27,bubbles:true}))
  await cleanupActionFixture()
`
