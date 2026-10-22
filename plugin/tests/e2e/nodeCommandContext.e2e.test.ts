import { expect, it } from 'vitest'
import { evalLong, enterPhone, reloadApp } from './helpers/obsidianCli'
import { targets, onPhone } from './helpers/target'
import { startPairedNode } from './helpers/pairedNode'
import { columnShot } from './helpers/columnShots'
import { shotDir } from './helpers/shots'

targets('desktop', 'phone')
const shots = shotDir('abele-command-context')

async function closeCard() {
  await evalLong(
    `(async()=>{const root=document.querySelector('.abele-node-manager-run');const close=[...(root?.closest('.modal-container')?.querySelectorAll('.modal-header-button,.modal-close-button')??[])].find(el=>el.getBoundingClientRect().width);close?.click();for(let i=0;i<100&&root?.isConnected;i++)await new Promise(r=>setTimeout(r,50));if(root?.isConnected)throw Error('Command dialog did not close')})()`
  )
}
async function inspect(label: string) {
  const cases = [
    [
      'ask',
      {
        managerJustification: 'Check the runtime before running the project tests.',
        managerCommand: 'node --version',
      },
    ],
    [
      'long-justification',
      {
        managerJustification:
          'Check the runtime and the project test setup before selecting the next verification step. '
            .repeat(3)
            .slice(0, 200),
        managerCommand: 'node --version',
      },
    ],
    [
      'long-command',
      {
        managerJustification: 'Check the selected sample files.',
        managerCommand: 'npm test -- ' + 'tests/sample-long-file.test.ts '.repeat(12),
      },
    ],
    ['without', { managerCommand: 'node --version' }],
    [
      'running',
      {
        managerRunState: 'running',
        managerJustification: 'Check the runtime.',
        managerCommand: 'node --version',
      },
    ],
    [
      'done',
      {
        managerRunState: 'exited',
        managerJustification: 'Check the runtime.',
        managerCommand: 'node --version',
      },
    ],
    [
      'error',
      {
        managerRunState: 'failed',
        managerJustification: 'Check the runtime.',
        managerCommand: 'node --version',
      },
    ],
    [
      'old-node',
      {
        managerOldNode: true,
        managerJustification: 'Check the runtime.',
        managerCommand: 'node --version',
      },
    ],
    ['disagreement', { managerJustification: 'Run the tests', managerCommand: 'rm -rf build' }],
  ] as const
  for (const [name, options] of cases) {
    try {
      await evalLong(
        `window.__abeleTest.openDialog('node-manager-run', ${JSON.stringify(options)})`
      )
      const report = JSON.parse(
        await evalLong(`(async()=>{
        for(let i=0;i<100&&!document.querySelector('[data-manager-command]');i++)await new Promise(r=>setTimeout(r,50));
        const card=document.querySelector('.abele-node-manager-run');
        const command=card.querySelector('[data-manager-command]');
        return JSON.stringify({command:command.textContent,overflow:card.scrollWidth>card.clientWidth+1,text:card.textContent,justification:card.querySelector('[data-command-justification]')?.textContent,commandWrap:getComputedStyle(command).whiteSpace});
      })()`)
      ) as {
        command: string
        overflow: boolean
        text: string
        justification?: string
        commandWrap: string
      }
      expect(report.command).toBe(options.managerCommand)
      expect(report.overflow).toBe(false)
      if (name === 'old-node') expect(report.text).toContain('0.4.47')
      if (name === 'without') expect(report.justification).toBeUndefined()
      columnShot(`${shots}/${label}-${name}.png`)
    } finally {
      await closeCard()
    }
  }
}

it('renders the approved request form in desktop and phone geometry', async () => {
  await inspect(onPhone() ? 'phone' : 'desktop')
  if (!onPhone()) {
    try {
      await enterPhone()
      await inspect('phone-emulated')
    } finally {
      await reloadApp('app.emulateMobile(false)')
    }
  }
}, 180000)

it('runs an ordinary scoped chat command only after the owner approval, and keeps bypass and Off distinct', async () => {
  const node = await startPairedNode()
  const setup = `const api=window.__abeleTest,chats=api.ChatService.getInstance(),connection=api.NodeService.getInstance().connection(${JSON.stringify(node.registration)}),client=connection.client;`
  try {
    const prepared = JSON.parse(
      await evalLong(
        `(async()=>{${setup}
      const id=chats.createTab(),session=chats.getSession(id);window.__sampleCommandChat=id;
      session.runAgentLoop=async()=>{};session.afterTurn=async()=>{};session.checkAnswer=async()=>{};
      await session.addUserNote('Sample command context check');await session.saveForRelease();await chats.revealSidebar({focus:false});
      const project=(await client.listProjects())[0],tree=(await client.repository.worktrees({project_id:project.project_id,limit:256})).entries[0];
      await client.nodePath.execution({project_id:project.project_id,target:{kind:'worktree',worktree_id:tree.worktree_id},enabled:true});
      await api.giveNodeChatAccess(session,{kind:'target',node_id:${JSON.stringify(node.node)},project_id:project.project_id,target:{kind:'worktree',worktree_id:tree.worktree_id},access:'read'});
      session.permissionMode.value='confirm-all';session.toolModes.value={...session.toolModes.value,node_command_run:'ask'};
      const args={node:${JSON.stringify(node.registration)},worktree_id:tree.worktree_id,argv:['node','--version'],operation_id:crypto.randomUUID(),justification:'Check the runtime version.'};
      window.__sampleCommandArgs=args;
      const tool=session.getTools().find(t=>t.name==='node_command_run');if(!tool)throw Error('Command tool is missing');
      const result=JSON.parse((await tool.execute('sample-command',args,undefined,{session})).content[0].text);
      window.__sampleCommandRun=result;
      for(let i=0;i<100&&!document.querySelector('.abele-tool-approval');i++)await new Promise(r=>setTimeout(r,50));
      const argv=document.querySelector('.abele-tool-approval__argv');
      return JSON.stringify({state:result.state,cards:document.querySelectorAll('.abele-tool-approval').length,context:!!result.context_id,sessions:(await client.listSessions()).length,arguments:argv?.querySelectorAll('[data-command-argument]').length,argvDisplay:argv?getComputedStyle(argv).display:''});
    })()`,
        90000
      )
    ) as {
      state: string
      cards: number
      context: boolean
      sessions: number
      arguments: number
      argvDisplay: string
    }
    expect(prepared).toEqual({
      state: 'pending_approval',
      cards: 1,
      context: true,
      sessions: 0,
      arguments: 2,
      argvDisplay: 'flex',
    })
    columnShot(`${shots}/${onPhone() ? 'phone' : 'desktop'}-live-ask.png`)
    await evalLong(
      `(()=>{const button=[...document.querySelectorAll('.abele-tool-approval button')].find(b=>b.textContent.trim()==='Allow');if(!button)throw Error('Approval missing');button.click()})()`
    )
    const completed = JSON.parse(
      await evalLong(
        `(async()=>{${setup}
      const session=chats.getSession(window.__sampleCommandChat),run=window.__sampleCommandRun,parent=await session.ensureDelegationParentId();
      for(let i=0;i<200;i++){const status=await connection.manager.status(parent,run.session_id,run.run_id);if(status.state==='exited')return JSON.stringify(status);await new Promise(r=>setTimeout(r,50))}throw Error('Command did not settle');
    })()`,
        60000
      )
    ) as { exit_code: number; stdout: string }
    expect(completed.exit_code).toBe(0)
    expect(completed.stdout).toMatch(/^v\d+\./)
    const other = JSON.parse(
      await evalLong(
        `(async()=>{${setup}
      const session=chats.getSession(window.__sampleCommandChat),args={...window.__sampleCommandArgs,argv:['node','-e','process.stdout.write(process.cwd())'],operation_id:crypto.randomUUID()};
      session.permissionMode.value='allow-all';const tool=session.getTools().find(t=>t.name==='node_command_run');
      const bypass=JSON.parse((await tool.execute('sample-bypass',args,undefined,{session})).content[0].text);
      let final;for(let i=0;i<200;i++){final=await connection.manager.status(await session.ensureDelegationParentId(),bypass.session_id,bypass.run_id);if(final.state==='exited')break;await new Promise(r=>setTimeout(r,50))}
      session.toolModes.value={...session.toolModes.value,node_command_run:'off'};
      let refused='';try{await tool.execute('sample-off',{...args,operation_id:crypto.randomUUID()},undefined,{session})}catch(error){refused=error.message}
      return JSON.stringify({mode:bypass.permission_mode,approval:bypass.approval,refused,cwd:final.stdout,expectedCwd:window.__sampleCommandRun.approval.input.cwd,reused:bypass.context_id===window.__sampleCommandRun.context_id});
    })()`,
        60000
      )
    ) as {
      mode: string
      approval: unknown
      refused: string
      cwd: string
      expectedCwd: string
      reused: boolean
    }
    expect(other.mode).toBe('bypass')
    expect(other.approval).toBeNull()
    expect(other.cwd).toBe(other.expectedCwd)
    expect(other.reused).toBe(true)
    expect(other.refused).toMatch(/off/i)
    const refused = JSON.parse(
      await evalLong(
        `(async()=>{${setup}
      const session=chats.getSession(window.__sampleCommandChat);
      session.permissionMode.value='confirm-all';session.toolModes.value={...session.toolModes.value,node_command_run:'ask'};
      const tool=session.getTools().find(t=>t.name==='node_command_run');
      let reason='';try{await tool.execute('sample-missing-cwd',{...window.__sampleCommandArgs,operation_id:crypto.randomUUID(),cwd:'sample-missing-folder'},undefined,{session})}catch(error){reason=error.message}
      for(let i=0;i<100&&!document.querySelector('.abele-tool-approval');i++)await new Promise(r=>setTimeout(r,50));
      const cards=[...document.querySelectorAll('.abele-tool-approval')];
      return JSON.stringify({reason,cards:cards.length,text:cards[0]?.closest('.abele-node-manager-run').textContent});
    })()`,
        60000
      )
    ) as { reason: string; cards: number; text: string }
    expect(refused.reason).toContain('cwd')
    expect(refused.cards).toBe(1)
    expect(refused.text).toContain('not submitted for execution')
    columnShot(`${shots}/${onPhone() ? 'phone' : 'desktop'}-live-error.png`)
    await evalLong(
      `(async()=>{const card=document.querySelector('.abele-tool-approval');[...card.querySelectorAll('button')].find(b=>b.textContent.trim()==='Stop').click();for(let i=0;i<100&&card.isConnected;i++)await new Promise(r=>setTimeout(r,50));if(card.isConnected)throw Error('Local refusal did not stop')})()`
    )
  } finally {
    await evalLong(
      `(async()=>{const chats=window.__abeleTest.ChatService.getInstance();if(window.__sampleCommandChat)await chats.deleteChat(window.__sampleCommandChat);delete window.__sampleCommandChat;delete window.__sampleCommandArgs;delete window.__sampleCommandRun})()`
    )
    await node.close()
  }
}, 240000)
