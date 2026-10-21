import { expect, it } from 'vitest'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { evalLong, enterPhone, reloadApp } from './helpers/obsidianCli'
import { targets, onPhone } from './helpers/target'
import { startPairedNode } from './helpers/pairedNode'
import { columnShot } from './helpers/columnShots'
import { shotDir } from './helpers/shots'

targets('desktop', 'phone')
const shots = shotDir('abele-node-commit')

async function inspectCommit(label: string) {
  const node = await startPairedNode()
  const project = join(dirname(node.state), 'sample-project')
  const setup = `const api=window.__abeleTest,chats=api.ChatService.getInstance(),client=api.NodeService.getInstance().connection(${JSON.stringify(node.registration)}).client;`
  try {
    const open = async () =>
      evalLong(`(async()=>{${setup}
      const id=await api.openRegularChatFixture(),session=chats.getSession(id);
      window.__sampleCommitChat=id;
      await session.saveForRelease();
      await api.giveNodeChatAccess(session,{kind:'node',node_id:${JSON.stringify(node.node)},access:'edit'});
      const project=(await client.listProjects())[0];
      const root=(await client.repository.worktrees({project_id:project.project_id})).entries.find(entry=>entry.kind==='root');
      window.__sampleCommitArgs={node:${JSON.stringify(node.registration)},project:project.project_id,workspace:root.worktree_id,target_kind:'worktree',expected_head:root.head,message:'Sample staged change',operation_id:crypto.randomUUID()};
      session.pendingToolCalls.value=[{id:'sample-commit',name:'node_git_commit',arguments:window.__sampleCommitArgs}];
      session.ensurePendingToolCallMessage({id:'sample-commit',name:'node_git_commit',arguments:window.__sampleCommitArgs});
    })()`)
    await open()
    const inspect = async (state: string, expected: string) => {
      const report = JSON.parse(
        await evalLong(`(async()=>{
        for(let i=0;i<300;i++){
          const root=document.querySelector('.abele-ai-chat .abele-tool-approval');
          if(root?.textContent.includes(${JSON.stringify(expected)})){
            root.scrollIntoView({block:'center'});
            return JSON.stringify({text:root.textContent,overflow:root.scrollWidth>root.clientWidth+1,files:root.querySelectorAll('[data-node-commit-diff]').length});
          }
          await new Promise(r=>setTimeout(r,50));
        }
        throw Error('Commit preview did not settle: '+document.querySelector('.abele-tool-approval')?.textContent);
      })()`)
      ) as { text: string; overflow: boolean; files: number }
      expect(report.overflow).toBe(false)
      columnShot(`${shots}/${label}-${state}.png`)
      return report
    }
    expect((await inspect('empty', '0 files')).files).toBe(0)
    writeFileSync(join(project, 'sample.txt'), 'Sample changed content\n')
    const long = 'sample-long-file-name-for-staged-commit-review-on-a-small-screen.txt'
    writeFileSync(join(project, long), 'Sample added content\n')
    await promisify(execFile)('/usr/bin/git', ['add', '--', 'sample.txt', long], { cwd: project })
    await evalLong(
      `(()=>{${setup}const session=chats.activeSession.value;session.updateChatMessage(m=>m.toolCallId==='sample-commit',m=>({...m,toolParams:{...window.__sampleCommitArgs}}));session.updateVisibleMessages()})()`
    )
    const loaded = await inspect('files-folded', long)
    expect(loaded.files).toBe(2)
    expect(loaded.text).not.toContain('+Sample changed content')
    await evalLong(
      `document.querySelector('[data-node-commit-diff] .abele-disclosure__control').click()`
    )
    await inspect('diff-open', '+Sample')
    await evalLong(
      `(()=>{${setup}const session=chats.activeSession.value;session.updateChatMessage(m=>m.toolCallId==='sample-commit',m=>({...m,toolParams:{...window.__sampleCommitArgs,expected_head:'b'.repeat(40)}}));session.updateVisibleMessages()})()`
    )
    await inspect('stale', 'The folder or worktree has changed')
  } finally {
    await evalLong(
      '(async()=>{const api=window.__abeleTest;if(window.__sampleCommitChat)await api.ChatService.getInstance().deleteChat(window.__sampleCommitChat);await api.closeRegularChatFixture();delete window.__sampleCommitArgs;delete window.__sampleCommitChat})()'
    )
    await node.close()
  }
}

it('shows real staged files and folded patches, including empty and unavailable states', async () => {
  await inspectCommit(onPhone() ? 'phone' : 'desktop')
}, 240000)

it.skipIf(onPhone())(
  'fits the phone layout',
  async () => {
    try {
      await enterPhone()
      await inspectCommit('phone-emulated')
    } finally {
      await reloadApp('app.emulateMobile(false)')
    }
  },
  240000
)
