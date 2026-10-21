import { expect, it } from 'vitest'
import { targets, onPhone } from './helpers/target'
import { evalLong } from './helpers/obsidianCli'
import { withEmulatedPhone } from './helpers/emulatedPhone'
import { shotDir } from './helpers/shots'

targets('desktop', 'phone')

it.each(onPhone() ? [true] : [false, true])(
  'shows cross-chat approval, waiting, incoming, reply and refusal; phone layout: %s',
  async (phone) => {
    const run = async () => {
      const result = JSON.parse(
        await evalLong(`(async () => {
      const T=window.__abeleTest, chats=T.ChatService.getInstance(), prior=chats.activeTabId.value;
      const wait=ms=>new Promise(r=>setTimeout(r,ms));
      const until=async fn=>{for(let i=0;i<120;i++){if(fn())return;await wait(50)}throw Error('Chat letter did not render')};
      const existingLeaf=app.workspace.getLeavesOfType('abele-ai-sidebar-view')[0];
      const leaf=existingLeaf||app.workspace.getLeaf('split'), ids=[], files=[];
      const shots=${JSON.stringify(shotDir('chat-messaging'))};
      const shot=async state=>{await wait(150);const path=shots+'/'+${JSON.stringify(phone ? 'phone-' : 'desktop-')}+state+'.png';if(window.__e2eHost)await window.__e2eHost.shot(path);else require('fs').writeFileSync(path,(await require('@electron/remote').getCurrentWebContents().capturePage()).toPNG())};
      const root=()=>leaf.view.containerEl;
      const textStart=el=>{const walker=document.createTreeWalker(el,NodeFilter.SHOW_TEXT);let node;while(node=walker.nextNode()){if(node.textContent.trim()){const range=document.createRange();range.selectNodeContents(node);return range.getBoundingClientRect().left}}throw Error('Missing letter text')};
      let release, pending, target, originalLoop, originalAfter, originalCheck, originalDirectory, nodeFixture=false;
      try {
        const caller=chats.getSession(chats.createTab());ids.push(caller.id);
        target=chats.getSession(chats.createTab());ids.push(target.id);
        caller.chatTitle.value='Sample request';target.chatTitle.value='Sample documentation with a long descriptive title';
        await caller.addUserNote('Ask the documentation chat about the sample.');await target.addUserNote('Sample reference context.');
        files.push(caller.currentChatFile.value,target.currentChatFile.value);
        caller.inheritToolSections(['delegation']);
        const list=caller.getTools().find(t=>t.name==='list_chats'), send=caller.getTools().find(t=>t.name==='send_message_to_chat');
        if(!list||!send)throw Error('Messaging tools are missing');
        const listed=await list.execute('listing',{});
        caller.appendChatMessage({id:'listed',role:'tool-call',content:'',timestamp:Date.now(),toolName:'list_chats',toolStatus:'approved',toolResult:listed.content[0].text});
        caller.updateVisibleMessages();chats.switchTab(caller.id);await leaf.setViewState({type:'abele-ai-sidebar-view',active:true});await app.workspace.revealLeaf(leaf);
        await until(()=>root().querySelector('[data-run-ids~="listed"] .tree-item-self'));
        root().querySelector('[data-run-ids~="listed"] .tree-item-self').click();
        await until(()=>root().querySelector('[data-run-ids~="listed"] .abele-chat-msg__icon'));
        root().querySelector('[data-run-ids~="listed"] .abele-chat-msg__icon').click();
        await until(()=>root().textContent.includes('Sample documentation with a long descriptive title'));await shot('list-chats');
        root().querySelector('[data-run-ids~="listed"] .tree-item-self').click();
        const call={id:'letter',role:'tool-call',content:'',timestamp:Date.now(),toolCallId:'ask',toolName:'send_message_to_chat',toolStatus:'pending',toolParams:{chat_id:target.id,message:'Explain the sample behavior.\\nInclude the recovery steps.'}};
        caller.permissionMode.value='confirm-all';target.permissionMode.value='allow-all';
        caller.toolModes.value={...caller.toolModes.value,send_message_to_chat:'auto'};
        if(!caller.needsApproval(call.toolName,call.toolParams))throw Error('Broader target bypassed approval');
        caller.appendChatMessage(call);caller.updateVisibleMessages();
        caller.pendingToolCalls.value=[{type:'toolCall',id:'ask',name:call.toolName,arguments:call.toolParams}];
        chats.switchTab(caller.id);await leaf.setViewState({type:'abele-ai-sidebar-view',active:true});
        await until(()=>root().querySelector('.abele-tool-approval__message'));
        const approval=root().querySelector('.abele-tool-approval').textContent;
        await shot('approval-long-message');
        caller.pendingToolCalls.value=[];caller.updateChatMessage(m=>m.id==='letter',m=>({...m,toolStatus:'approved'}));caller.updateVisibleMessages();
        originalLoop=target.runAgentLoop;
        originalAfter=target.afterTurn;originalCheck=target.checkAnswer;
        target.afterTurn=async()=>{};target.checkAnswer=async()=>{};
        target.runAgentLoop=async function(){this.isStreaming.value=true;try{await new Promise(r=>release=r);this.appendChatMessage({id:'sample-answer',role:'assistant',content:'The sample reconnects after waking. Check the connection state before retrying.',timestamp:Date.now()});this.updateVisibleMessages()}finally{this.isStreaming.value=false}};
        pending=send.execute('ask',call.toolParams,undefined,{approved:true});
        await until(()=>release&&root().querySelector('.abele-chat-letter_running'));
        await shot('asking');
        chats.switchTab(target.id);await until(()=>root().querySelector('.abele-chat-msg__from'));
        const incoming=root().querySelector('.abele-chat-msg__from').textContent;
        await shot('incoming');
        const targetApproval={id:'target-approval',role:'tool-call',content:'',timestamp:Date.now(),toolCallId:'target-action',toolName:'eval_js',toolStatus:'pending',toolParams:{code:'return 2 + 2'}};
        target.appendChatMessage(targetApproval);target.updateVisibleMessages();target.isStreaming.value=false;
        target.pendingToolCalls.value=[{type:'toolCall',id:'target-action',name:'eval_js',arguments:targetApproval.toolParams}];
        await until(()=>root().querySelector('.abele-tool-approval'));await shot('target-approval');
        target.pendingToolCalls.value=[];target.updateChatMessage(m=>m.id==='target-approval',m=>({...m,toolStatus:'rejected',toolResult:'Sample action declined'}));target.isStreaming.value=true;
        target.inheritToolSections(['delegation']);
        const reverse=target.getTools().find(t=>t.name==='send_message_to_chat');
        if(reverse)throw Error('Letter turn offered chained sending');
        release();await pending;
        await until(()=>root().querySelector('.abele-chat-msg__sent-to'));
        const sent=root().querySelector('.abele-chat-msg__sent-to').textContent;await shot('sent');
        chats.switchTab(caller.id);await until(()=>root().querySelector('.abele-chat-letter [aria-expanded="false"]'));
        root().querySelector('.abele-chat-letter .tree-item-self').click();
        await until(()=>root().querySelector('.abele-chat-letter [aria-expanded="true"]'));await until(()=>root().querySelector('.abele-chat-letter__reply')?.textContent.includes('reconnects'));await shot('answer-expanded');
        const replyOffset=Math.abs(textStart(root().querySelector('.abele-chat-letter .abele-tree-item__text'))-textStart(root().querySelector('.abele-chat-letter__reply')));
        const replyBorder=getComputedStyle(root().querySelector('.abele-chat-letter > .tree-item-children')).borderInlineStartWidth;
        const answeredDots=root().querySelector('[data-message-id="letter"]').querySelectorAll('.abele-status-dot').length;
        const refused={...call,id:'refused',toolCallId:'refusal',toolParams:{chat_id:caller.id,message:'Sample self request'}};
        caller.appendChatMessage(refused);caller.updateVisibleMessages();
        try{await send.execute('refusal',refused.toolParams)}catch{}
        await until(()=>root().querySelector('.abele-chat-msg__letter-refusal'));await shot('refused');
        const refusedRow=root().querySelector('[data-message-id="refused"]');
        const noteOffset=Math.abs(textStart(refusedRow.querySelector('.abele-tree-item__text'))-textStart(refusedRow.querySelector('.abele-call-note')));
        if(!refusedRow.querySelector('.abele-status-dot_red'))throw Error('Refused letter has no state dot');
        const labelFlex=getComputedStyle(refusedRow.querySelector('.abele-tree-item__inner')).flex;
        const reply=caller.messages.value.find(m=>m.id==='letter').chatLetter.reply,refusal=caller.messages.value.find(m=>m.id==='refused').chatLetter.refusal;
        const targetPath=target.currentChatFile.value.path;
        for(const [id,chatId] of [['unknown','missing-chat'],['closed',target.id]]){
          if(id==='closed')await chats.closeTab(target.id);
          const unavailable={...call,id,toolCallId:id,toolParams:{chat_id:chatId,message:'Sample unavailable request'}};
          caller.appendChatMessage(unavailable);caller.updateVisibleMessages();try{await send.execute(id,unavailable.toolParams)}catch{}
          await until(()=>root().querySelector('[data-message-id="'+id+'"] .abele-chat-msg__letter-refusal'));
          root().querySelector('[data-message-id="'+id+'"]').scrollIntoView({block:'center'});await shot(id+'-refused');
        }
        const dotColumnOffset=Math.max(...['closed','unknown'].map(id=>Math.abs(root().querySelector('[data-message-id="refused"] .abele-status-dot').getBoundingClientRect().left-root().querySelector('[data-message-id="'+id+'"] .abele-status-dot').getBoundingClientRect().left)));
        const dotColumns=['refused','closed','unknown'].map(id=>{const row=root().querySelector('[data-message-id="'+id+'"]');return {id,dot:row.querySelector('.abele-status-dot').getBoundingClientRect().left,flair:row.querySelector('.tree-item-flair-outer').getBoundingClientRect().width,actions:row.querySelector('.abele-tree-item__actions')?.getBoundingClientRect().width}});
        await T.openNodeSessionFixture('letter',true,false);nodeFixture=true;
        const nodeId=chats.activeTabId.value,node=chats.getNodeSession(nodeId);
        if(!node)throw Error('Node letter fixture did not open');
        const nodeLetter={...call,id:'node-answer',toolCallId:'node-answer',toolParams:{chat_id:nodeId,message:'Check the sample request on the node.'}};
        caller.appendChatMessage(nodeLetter);caller.updateVisibleMessages();
        await send.execute('node-answer',nodeLetter.toolParams,undefined,{approved:true});
        chats.switchTab(nodeId);await until(()=>root().querySelector('.abele-chat-msg__from')?.textContent.includes('Sample request'));
        root().querySelector('.abele-chat-msg__from').scrollIntoView({block:'center'});await shot('node-incoming');
        const nodeIncoming=root().querySelector('.abele-chat-msg__from').textContent;
        const received=node.messages.value.find(m=>m.role==='user'&&m.content.includes('Check the sample request'));
        if(received?.fromSession?.id!==caller.id)throw Error('Missing node sender provenance');
        chats.switchTab(caller.id);await until(()=>root().querySelector('[data-message-id="node-answer"] .abele-chat-letter'));
        root().querySelector('[data-message-id="node-answer"] .tree-item-self').click();
        await until(()=>root().querySelector('[data-message-id="node-answer"] .abele-chat-letter__reply'));
        root().querySelector('[data-message-id="node-answer"]').scrollIntoView({block:'center'});await wait(150);
        const answerRect=root().querySelector('[data-message-id="node-answer"] .abele-chat-letter__reply').getBoundingClientRect();
        if(answerRect.left<0||answerRect.right>innerWidth||answerRect.top<0||answerRect.bottom>innerHeight)throw Error('Node reply is not visible in the captured viewport');
        await shot('node-answer-expanded');
        const nodeAnswer=caller.messages.value.find(m=>m.id==='node-answer').chatLetter.reply;
        await T.closeNodeSessionFixture();nodeFixture=false;
        originalDirectory=chats.listOpenChats;
        chats.listOpenChats=function(){return [...originalDirectory.call(this),{id:'sample-node',title:'Sample node chat',folder:'Examples',agent:null,state:'idle'}]};
        const nodeCall={...call,id:'node-refused',toolCallId:'node-refused',toolParams:{chat_id:'sample-node',message:'Sample remote question'}};
        caller.appendChatMessage(nodeCall);caller.updateVisibleMessages();try{await send.execute('node-refused',nodeCall.toolParams)}catch{}
        await until(()=>root().querySelector('[data-message-id="node-refused"] .abele-call-note'));
        root().querySelector('[data-message-id="node-refused"]').scrollIntoView({block:'center'});await shot('node-refused');
        chats.listOpenChats=originalDirectory;originalDirectory=undefined;
        caller.appendChatMessage({...call,id:'interrupted',toolCallId:'interrupted',toolStatus:'approved',chatLetter:{to:{id:target.id,title:target.chatTitle.value,path:targetPath}}});caller.updateVisibleMessages();await caller.save();
        const saved=caller.currentChatFile.value;await chats.closeTab(caller.id);await chats.openChatFile(saved);
        const reopened=chats.getSessionByFile(saved.path);ids.push(reopened.id);
        await until(()=>root().textContent.includes('interrupted by a reload'));root().querySelector('[data-message-id="interrupted"]')?.scrollIntoView({block:'center'});await shot('interrupted-reload');
        return JSON.stringify({approval,incoming,sent,reply,refusal,noteOffset,replyOffset,replyBorder,nodeIncoming,nodeAnswer,answeredDots,labelFlex,dotColumnOffset,dotColumns});
      } finally {
        if(originalDirectory)chats.listOpenChats=originalDirectory;
        if(nodeFixture)await T.closeNodeSessionFixture();
        if(release)release();if(pending)await pending.catch(()=>{});if(target&&originalLoop)target.runAgentLoop=originalLoop;
        if(target&&originalAfter)target.afterTurn=originalAfter;if(target&&originalCheck)target.checkAnswer=originalCheck;
        for(const id of ids)await chats.closeTab(id);for(const file of files)if(file&&app.vault.getAbstractFileByPath(file.path))await app.vault.delete(file);
        chats.switchTab(prior);if(!existingLeaf)leaf.detach();
      }
    })()`)
      )
      expect(result.approval).toContain('Sample documentation')
      expect(result.approval).toContain('Include the recovery steps.')
      expect(result.approval).toContain('file edits, copies, moves and deletion')
      expect(result.incoming).toContain('Sample request')
      expect(result.sent).toContain('Sample request')
      expect(result.reply).toContain('reconnects')
      expect(result.refusal).toBe('That is this chat.')
      expect(result.noteOffset).toBeLessThanOrEqual(1)
      expect(result.replyOffset).toBeLessThanOrEqual(1)
      expect(result.replyBorder).toBe('0px')
      expect(result.answeredDots).toBe(0)
      expect(result.labelFlex).toBe('1 1 auto')
      expect(result.dotColumnOffset, JSON.stringify(result.dotColumns)).toBeLessThanOrEqual(1)
      expect(result.nodeIncoming).toContain('Sample request')
      expect(result.nodeAnswer).toContain('only to the sending chat')
    }
    if (phone && !onPhone()) await withEmulatedPhone(run)
    else await run()
  }
)
