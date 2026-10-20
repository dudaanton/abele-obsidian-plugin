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
      const leaf=app.workspace.getLeaf('split'), ids=[], files=[];
      const shots=${JSON.stringify(shotDir('chat-messaging'))};
      const shot=async state=>{await wait(150);const path=shots+'/'+${JSON.stringify(phone ? 'phone-' : 'desktop-')}+state+'.png';if(window.__e2eHost)await window.__e2eHost.shot(path);else require('fs').writeFileSync(path,(await require('@electron/remote').getCurrentWebContents().capturePage()).toPNG())};
      const root=()=>leaf.view.containerEl;
      let release, pending, target, originalLoop, originalAfter, originalCheck;
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
        const call={id:'letter',role:'tool-call',content:'',timestamp:Date.now(),toolCallId:'ask',toolName:'send_message_to_chat',toolStatus:'pending',toolParams:{chat_id:target.id,message:'Explain the sample behavior.\nInclude the recovery steps.'}};
        caller.appendChatMessage(call);caller.updateVisibleMessages();
        caller.pendingToolCalls.value=[{type:'toolCall',id:'ask',name:call.toolName,arguments:call.toolParams}];
        chats.switchTab(caller.id);await leaf.setViewState({type:'abele-ai-sidebar-view',active:true});
        await until(()=>root().querySelector('.abele-tool-approval__message'));
        const approval=root().querySelector('.abele-tool-approval').textContent;
        await shot('approval-long-message');
        caller.pendingToolCalls.value=[];call.toolStatus='approved';caller.updateVisibleMessages();
        originalLoop=target.runAgentLoop;
        originalAfter=target.afterTurn;originalCheck=target.checkAnswer;
        target.afterTurn=async()=>{};target.checkAnswer=async()=>{};
        target.runAgentLoop=async function(){this.isStreaming.value=true;try{await new Promise(r=>release=r);this.appendChatMessage({id:'sample-answer',role:'assistant',content:'The sample reconnects after waking. Check the connection state before retrying.',timestamp:Date.now()});this.updateVisibleMessages()}finally{this.isStreaming.value=false}};
        pending=send.execute('ask',call.toolParams);
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
        const cycle={...call,id:'cycle',toolCallId:'cycle',toolParams:{chat_id:caller.id,message:'Sample circular request'}};
        target.appendChatMessage(cycle);target.updateVisibleMessages();
        try{await reverse.execute('cycle',cycle.toolParams)}catch{}
        await until(()=>root().querySelector('.abele-chat-msg__letter-refusal'));await shot('cycle-refused');
        release();await pending;
        await until(()=>root().querySelector('.abele-chat-msg__sent-to'));
        const sent=root().querySelector('.abele-chat-msg__sent-to').textContent;await shot('sent');
        chats.switchTab(caller.id);await until(()=>root().querySelector('.abele-chat-letter [aria-expanded="false"]'));
        root().querySelector('.abele-chat-letter .tree-item-self').click();
        await until(()=>root().querySelector('.abele-chat-letter [aria-expanded="true"]'));await shot('answer-expanded');
        const refused={...call,id:'refused',toolCallId:'refusal',toolParams:{chat_id:caller.id,message:'Sample self request'}};
        caller.appendChatMessage(refused);caller.updateVisibleMessages();
        try{await send.execute('refusal',refused.toolParams)}catch{}
        await until(()=>root().querySelector('.abele-chat-msg__letter-refusal'));await shot('refused');
        const reply=caller.messages.value.find(m=>m.id==='letter').chatLetter.reply,refusal=caller.messages.value.find(m=>m.id==='refused').chatLetter.refusal;
        const targetPath=target.currentChatFile.value.path;
        for(const [id,chatId] of [['unknown','missing-chat'],['closed',target.id]]){
          if(id==='closed')await chats.closeTab(target.id);
          const unavailable={...call,id,toolCallId:id,toolParams:{chat_id:chatId,message:'Sample unavailable request'}};
          caller.appendChatMessage(unavailable);caller.updateVisibleMessages();try{await send.execute(id,unavailable.toolParams)}catch{}
          await until(()=>root().querySelector('[data-message-id="'+id+'"] .abele-chat-msg__letter-refusal'));
          root().querySelector('[data-message-id="'+id+'"]').scrollIntoView({block:'center'});await shot(id+'-refused');
        }
        caller.appendChatMessage({...call,id:'interrupted',toolCallId:'interrupted',toolStatus:'approved',chatLetter:{to:{id:target.id,title:target.chatTitle.value,path:targetPath}}});caller.updateVisibleMessages();await caller.save();
        const saved=caller.currentChatFile.value;await chats.closeTab(caller.id);await chats.openChatFile(saved);
        const reopened=chats.getSessionByFile(saved.path);ids.push(reopened.id);
        await until(()=>root().textContent.includes('interrupted by a reload'));root().querySelector('[data-message-id="interrupted"]')?.scrollIntoView({block:'center'});await shot('interrupted-reload');
        return JSON.stringify({approval,incoming,sent,reply,refusal});
      } finally {
        if(release)release();if(pending)await pending.catch(()=>{});if(target&&originalLoop)target.runAgentLoop=originalLoop;
        if(target&&originalAfter)target.afterTurn=originalAfter;if(target&&originalCheck)target.checkAnswer=originalCheck;
        for(const id of ids)await chats.closeTab(id);for(const file of files)if(file&&app.vault.getAbstractFileByPath(file.path))await app.vault.delete(file);
        chats.switchTab(prior);leaf.detach();
      }
    })()`)
      )
      expect(result.approval).toContain('Sample documentation')
      expect(result.approval).toContain('Include the recovery steps.')
      expect(result.incoming).toContain('Sample request')
      expect(result.sent).toContain('Sample request')
      expect(result.reply).toContain('reconnects')
      expect(result.refusal).toContain('own chat')
    }
    if (phone && !onPhone()) await withEmulatedPhone(run)
    else await run()
  }
)
