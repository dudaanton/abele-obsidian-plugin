import { expect, it } from 'vitest'
import { evalLong } from './helpers/obsidianCli'
import { withEmulatedPhone } from './helpers/emulatedPhone'
import { columnShot } from './helpers/columnShots'
import { shotDir } from './helpers/shots'
import { onPhone, targets } from './helpers/target'

targets('desktop', 'phone')

const shots = shotDir('footer-chat-create')

async function checkCreatedFooter(label: string) {
  try {
    const result = JSON.parse(
      await evalLong(`(async () => {
        const T=window.__abeleTest, chats=T.ChatService.getInstance()
        const prior=chats.activeTabId.value, tab=chats.createTab(), session=chats.getSession(tab)
        const folder='ScaleTest/sample-footer-create-'+Date.now()
        const leaf=app.workspace.getLeaf('split')
        window.__footerCreateFixture={prior,tab,session,folder,leaf}
        await app.vault.createFolder(folder)
        session.scopeResolver.entries.value=[{type:'folder',path:folder}]
        session.permissionMode.value='allow-all'
        session.chatTitle.value='Sample creation chat'
        session.allChatMessages=[{id:'sample-input',role:'user',content:'Create a sample note',timestamp:Date.now()}]
        await session.save()
        const note=folder+'/Created sample.md'
        const create=session.getTools().find(tool=>tool.name==='create')
        if(!create)throw Error('Create tool unavailable')
        await create.execute('sample-create',{path:note,content:'A sample note created by the chat.'})
        const immediate=T.ChatStorage.getInstance().getHistory().find(e=>e.path===session.currentChatFile.value.path)?.notes?.some(n=>n.path===note)
        await session.save()
        window.__footerCreateFixture.chatFile=session.currentChatFile.value
        await leaf.openFile(app.vault.getAbstractFileByPath(note),{state:{mode:'source'}})
        const wait=ms=>new Promise(r=>setTimeout(r,ms))
        const until=async fn=>{for(let i=0;i<120;i++){if(fn())return;await wait(100)}throw Error('Created note footer did not render')}
        const footer=()=>leaf.view.containerEl.querySelector('.abele-chats-list')
        await until(()=>footer()?.textContent.includes('Sample creation chat'))
        footer().scrollIntoView({block:'center'})
        return JSON.stringify({immediate,visible:true})
      })()`)
    )
    expect(result).toEqual({ immediate: true, visible: true })
    columnShot(`${shots}/${label}-created.png`)

    const reopened = JSON.parse(
      await evalLong(`(async()=>{
        const f=window.__footerCreateFixture,T=window.__abeleTest,chats=T.ChatService.getInstance()
        await chats.closeTab(f.tab)
        await chats.openChatFile(f.chatFile)
        f.tab=chats.activeTabId.value
        const session=chats.getSession(f.tab)
        const path=f.folder+'/Created sample.md'
        return JSON.stringify({persisted:session.touched.value.some(n=>n.path===path),visible:f.leaf.view.containerEl.querySelector('.abele-chats-list')?.textContent.includes('Sample creation chat')===true})
      })()`)
    )
    expect(reopened).toEqual({ persisted: true, visible: true })
    columnShot(`${shots}/${label}-reopened.png`)
  } finally {
    await evalLong(`(async()=>{
      const f=window.__footerCreateFixture;if(!f)return true
      const chats=window.__abeleTest.ChatService.getInstance()
      await chats.closeTab(f.tab);chats.activeTabId.value=f.prior
      f.leaf.detach()
      const chat=f.chatFile||f.session.currentChatFile.value;if(chat)await app.vault.delete(chat)
      const folder=app.vault.getAbstractFileByPath(f.folder);if(folder)await app.vault.delete(folder,true)
      delete window.__footerCreateFixture;return true
    })()`)
  }
}

it('shows the creating chat in the note footer immediately and after reopening', async () => {
  await checkCreatedFooter(onPhone() ? 'phone' : 'desktop')
  if (!onPhone()) await withEmulatedPhone(() => checkCreatedFooter('mobile'))
})
