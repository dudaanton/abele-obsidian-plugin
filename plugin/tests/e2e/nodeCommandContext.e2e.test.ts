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
          'Check the runtime and the project test setup before selecting the next verification step. Confirm the available runtime before choosing the checks, then review the results before continuing development.',
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
    [
      'disagreement',
      { managerJustification: 'Remove generated build output.', managerCommand: 'rm -rf build' },
    ],
    [
      'bypass-integration-fallback',
      {
        managerLegacyIntegration: true,
        managerJustification: 'Integrate the reviewed parser changes.',
      },
    ],
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
        const command=card.querySelector('[data-manager-command]'),log=card.querySelector('[role=log]'),stop=card.querySelector('[data-manager-stop] button');
        const reason=card.querySelector('[data-command-justification]'),glyph=reason?.previousElementSibling;
        await new Promise(r=>setTimeout(r,50));
        return JSON.stringify({command:command.textContent,overflow:card.scrollWidth>card.clientWidth+1,text:card.textContent,justification:reason?.textContent,glyphGap:reason?.getBoundingClientRect().left-glyph?.getBoundingClientRect().right,labelTop:reason?Math.abs(reason.querySelector('.abele-obsidian-button__label').getBoundingClientRect().top-glyph.getBoundingClientRect().top):0,commandWrap:getComputedStyle(command).whiteSpace,wordBreak:getComputedStyle(command).wordBreak,codeBackground:getComputedStyle(command).backgroundColor,logHeight:log?.clientHeight,logFont:log?parseFloat(getComputedStyle(log.querySelector('pre')??log).lineHeight):0,atBottom:log?Math.abs(log.scrollHeight-log.clientHeight-log.scrollTop)<2:true,stopLeft:stop?stop.getBoundingClientRect().left-card.getBoundingClientRect().left:0});
      })()`)
      ) as {
        command: string
        overflow: boolean
        text: string
        justification?: string
        commandWrap: string
        codeBackground: string
        logHeight?: number
        logFont: number
        atBottom: boolean
        stopLeft: number
        glyphGap: number
        labelTop: number
        wordBreak: string
      }
      expect(report.command).toBe(
        'managerCommand' in options
          ? options.managerCommand
          : 'work/sample-parser aaaaaaa → main bbbbbbb'
      )
      expect(report.overflow).toBe(false)
      expect(report.wordBreak).toBe('normal')
      if (report.justification) expect(report.glyphGap).toBeGreaterThanOrEqual(7)
      if (report.justification) expect(report.labelTop).toBeLessThanOrEqual(3)
      if (name === 'without')
        expect(report.codeBackground).not.toMatch(/^(transparent|rgba\(0, 0, 0, 0\))$/)
      if (name === 'running') {
        expect(report.text).toContain('Running')
        expect(report.logHeight).toBeLessThanOrEqual(report.logFont * 12 + 2)
        expect(report.atBottom).toBe(true)
        expect(report.stopLeft).toBeLessThan(25)
      }
      if (name === 'long-justification') {
        const expanded = JSON.parse(
          await evalLong(
            `(async()=>{const b=document.querySelector('[data-command-justification]');b.click();await new Promise(r=>setTimeout(r,50));return JSON.stringify({open:b.getAttribute('aria-expanded'),text:b.textContent,glyphTop:Math.abs(b.getBoundingClientRect().top-b.previousElementSibling.getBoundingClientRect().top)})})()`
          )
        ) as { open: string; text: string; glyphTop: number }
        expect(expanded.open).toBe('true')
        expect(expanded.glyphTop).toBeLessThanOrEqual(3)
        expect(expanded.text.trim()).toBe(
          'managerJustification' in options ? options.managerJustification : ''
        )
        columnShot(`${shots}/${label}-long-justification-expanded.png`)
        expect(
          await evalLong(
            `(async()=>{const b=document.querySelector('[data-command-justification]');b.click();await new Promise(r=>setTimeout(r,50));return b.getAttribute('aria-expanded')})()`
          )
        ).toBe('false')
      }
      if (name === 'old-node') expect(report.text).toContain('0.4.47')
      if (name === 'without') expect(report.justification).toBeUndefined()
      if (name === 'bypass-integration-fallback')
        expect(report.text).toContain(
          'This node version still asks before integrating. Update the node to integrate without asking.'
        )
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

async function runLive(label: string) {
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
      await api.giveNodeChatAccess(session,{kind:'target',node_id:${JSON.stringify(node.node)},project_id:project.project_id,target:{kind:'worktree',worktree_id:tree.worktree_id},access:'run'});
      session.overrides.value={...session.overrides.value,nodeScope:session.overrides.value.nodeScope.map(e=>({...e,access:'run'}))};session.permissionMode.value='confirm-all';session.toolModes.value={...session.toolModes.value,node_command_run:'ask'};
      const args={node:${JSON.stringify(node.registration)},worktree_id:tree.worktree_id,argv:['node','--version'],operation_id:crypto.randomUUID(),justification:'Check the runtime version.'};
      window.__sampleCommandArgs=args;
      const tool=session.getTools().find(t=>t.name==='node_command_run');if(!tool)throw Error('Command tool is missing');
      window.__sampleCommandSettled=false;
      window.__sampleCommandCompletion=tool.execute('sample-command',args,undefined,{session}).then(result=>{window.__sampleCommandSettled=true;return JSON.parse(result.content[0].text)});
      const parent=await session.ensureDelegationParentId();
      let result;for(let i=0;i<200;i++){result=(await connection.manager.cards(parent))[0]?.run;if(result?.state==='pending_approval')break;await new Promise(r=>setTimeout(r,50))}
      if(window.__sampleCommandSettled)throw Error('Command returned before approval');
      window.__sampleCommandRun=result;
      for(let i=0;i<100&&!document.querySelector('.abele-tool-approval');i++)await new Promise(r=>setTimeout(r,50));
      const argv=document.querySelector('.abele-tool-approval [data-manager-command]');
      return JSON.stringify({state:result.state,cards:document.querySelectorAll('.abele-tool-approval').length,context:!!result.context_id,sessions:(await client.listSessions()).length,command:argv?.textContent.trim()});
    })()`,
        90000
      )
    ) as {
      state: string
      cards: number
      context: boolean
      sessions: number
      command: string
    }
    expect(prepared).toEqual({
      state: 'pending_approval',
      cards: 1,
      context: true,
      sessions: 0,
      command: 'node --version',
    })
    columnShot(`${shots}/${label}-live-ask.png`)
    await evalLong(
      `(()=>{const button=[...document.querySelectorAll('.abele-tool-approval button')].find(b=>b.textContent.trim()==='Allow');if(!button)throw Error('Approval missing');button.click()})()`
    )
    const completed = JSON.parse(
      await evalLong(
        `(async()=>{${setup}
      return JSON.stringify(await window.__sampleCommandCompletion);
    })()`,
        60000
      )
    ) as { exit_code: number; stdout: string }
    expect(completed.exit_code).toBe(0)
    expect(completed.stdout).toMatch(/^v\d+\./)
    await evalLong(
      `(async()=>{${setup}await connection.refreshDelegations();await new Promise(r=>setTimeout(r,150))})()`
    )
    columnShot(`${shots}/${label}-live-finished.png`)
    const other = JSON.parse(
      await evalLong(
        `(async()=>{${setup}
      const session=chats.getSession(window.__sampleCommandChat),args={...window.__sampleCommandArgs,argv:['node','-e','process.stdout.write(process.cwd())'],justification:'Check the command working folder.',operation_id:crypto.randomUUID()};
      session.permissionMode.value='allow-all';const tool=session.getTools().find(t=>t.name==='node_command_run');
      const bypass=JSON.parse((await tool.execute('sample-bypass',args,undefined,{session})).content[0].text);
      if(bypass.state!=='exited'||bypass.exit_code!==0)throw Error('Command returned before completion');const final=bypass;
      session.overrides.value={...session.overrides.value,nodeScope:session.overrides.value.nodeScope.map(e=>({...e,access:'edit'}))};
      let refused='';try{await tool.execute('sample-off',{...args,operation_id:crypto.randomUUID()},undefined,{session})}catch(error){refused=error.message}
      await connection.refreshDelegations();await new Promise(r=>setTimeout(r,150));return JSON.stringify({cards:document.querySelectorAll('.abele-tool-approval').length,mode:bypass.permission_mode,approval:bypass.approval,refused,cwd:final.stdout,expectedCwd:window.__sampleCommandRun.approval.input.cwd,reused:bypass.context_id===window.__sampleCommandRun.context_id,gap:(()=>{const r=[...document.querySelectorAll('.abele-node-manager-run')];return r[1].getBoundingClientRect().top-r[0].getBoundingClientRect().bottom})(),emptyNotices:[...document.querySelectorAll('.abele-chat-msg_line')].filter(e=>!e.textContent.trim()).length});
    })()`,
        60000
      )
    ) as {
      cards: number
      mode: string
      approval: unknown
      refused: string
      cwd: string
      expectedCwd: string
      reused: boolean
      gap: number
      emptyNotices: number
    }
    expect(other.cards).toBe(0)
    expect(other.gap).toBeGreaterThanOrEqual(12)
    expect(other.emptyNotices).toBe(0)
    columnShot(`${shots}/${label}-bypass-manager.png`)
    expect(other.mode).toBe('bypass')
    expect(other.approval).toBeNull()
    expect(other.cwd).toBe(other.expectedCwd)
    expect(other.reused).toBe(true)
    expect(other.refused).toMatch(/off/i)
    const refused = JSON.parse(
      await evalLong(
        `(async()=>{${setup}
      const session=chats.getSession(window.__sampleCommandChat);
      session.overrides.value={...session.overrides.value,nodeScope:session.overrides.value.nodeScope.map(e=>({...e,access:'run'}))};session.permissionMode.value='confirm-all';session.toolModes.value={...session.toolModes.value,node_command_run:'ask'};
      const tool=session.getTools().find(t=>t.name==='node_command_run');
      let reason='';try{await tool.execute('sample-missing-cwd',{...window.__sampleCommandArgs,operation_id:crypto.randomUUID(),cwd:'sample-missing-folder',justification:'Check access to the selected subfolder.'},undefined,{session})}catch(error){reason=error.message}
      await connection.refreshDelegations();await new Promise(r=>setTimeout(r,150));
      const cards=[...document.querySelectorAll('.abele-tool-approval')],runs=[...document.querySelectorAll('.abele-node-manager-run')];
      return JSON.stringify({reason,cards:cards.length,text:runs.at(-1)?.textContent});
    })()`,
        60000
      )
    ) as { reason: string; cards: number; text: string }
    expect(refused.reason).toContain('cwd')
    expect(refused.cards).toBe(0)
    expect(refused.text).toContain("This folder can't be used for commands on the node.")
    expect(refused.text).not.toContain('Waiting for approval')
    columnShot(`${shots}/${label}-live-error.png`)
  } finally {
    await evalLong(
      `(async()=>{const chats=window.__abeleTest.ChatService.getInstance();if(window.__sampleCommandChat)await chats.deleteChat(window.__sampleCommandChat);delete window.__sampleCommandChat;delete window.__sampleCommandArgs;delete window.__sampleCommandRun;delete window.__sampleCommandCompletion;delete window.__sampleCommandSettled})()`
    )
    await node.close()
  }
}
it('runs scoped owner actions with one Ask approval and no bypass cards', async () => {
  await runLive(onPhone() ? 'phone' : 'desktop')
  if (!onPhone()) {
    try {
      await enterPhone()
      await runLive('phone-emulated')
    } finally {
      await reloadApp('app.emulateMobile(false)')
    }
  }
}, 360000)
