export interface NodeAgentTurn {
  tools: string[]
  modelResults: string[]
  calls: { name: string; params: Record<string, unknown>; result: string }[]
  error?: string
}

/** The owner can inspect and approve an in-flight tool before its model turn settles. */
export const startNodeAgentTurn = (path: string, steps: string) =>
  `(()=>{window.__sampleNodeActionTurn=${nodeAgentTurn(path, steps)};return true})()`

/**
 * An ordinary Obsidian chat whose agent has every node tool switched on, driven by a scripted
 * model. Each step names the next call from what the earlier results said, the way a model
 * would: it only knows what the tools tell it.
 */
export const nodeAgentTurn = (path: string, steps: string) => `(async()=>{
  const T=window.__abeleTest,chats=T.ChatService.getInstance(),session=chats.getSessionByFile(${JSON.stringify(path)});
  const realFetch=window.fetch,endpoint='https://sample-node-files-model.invalid/v1',out={tools:[],calls:[],modelResults:[]};
  const steps=${steps},turnId=crypto.randomUUID();let n=0,initialResultCount;
  session.resolveModel=()=>({id:'sample',name:'Sample',baseUrl:endpoint,apiKey:'none',contextWindow:100000,maxTokens:1000,supportsReasoning:false});
  for(const key of ['generateTitle','generateSummary','generateRecap','autoCompactIfNeeded'])session.summarizer[key]=async()=>{};
  window.fetch=async(url,init)=>{
    if(typeof url!=='string'||!url.startsWith(endpoint))return realFetch(url,init);
    const body=JSON.parse(init.body);
    out.tools=(body.tools||[]).map(t=>t.function.name);
    const results=body.messages.filter(m=>m.role==='tool').map(m=>typeof m.content==='string'?m.content:JSON.stringify(m.content));
    initialResultCount??=results.length;out.modelResults=results.slice(initialResultCount);
    const step=n<steps.length?await steps[n](results):null;n++;
    const delta=step?{tool_calls:[{index:0,id:turnId+'-'+n,type:'function',function:{name:step.name,arguments:JSON.stringify(step.params)}}]}:{content:'Done.'};
    const enc=new TextEncoder();
    return new Response(new ReadableStream({start(c){for(const chunk of [{choices:[{delta}]},{choices:[{delta:{},finish_reason:step?'tool_calls':'stop'}]}])c.enqueue(enc.encode('data: '+JSON.stringify(chunk)+'\\n\\n'));c.enqueue(enc.encode('data: [DONE]\\n\\n'));c.close()}}),{status:200,headers:{'Content-Type':'text/event-stream'}});
  };
  try{
    const before=session.allMessages.value.length;
    await session.sendMessage('Work with the sample project files on the node.');
    const deadline=Date.now()+90000;
    while(session.pendingToolCalls?.value.length||session.isStreaming?.value||session.isExecutingTool?.value){
      if(Date.now()>deadline)throw Error('The scripted node turn did not finish after approval');
      await new Promise(r=>setTimeout(r,25));
    }
    if(session.error.value)out.error=String(session.error.value);
    for(const m of session.allMessages.value.slice(before))if(m.role==='tool-call'&&m.toolResult!==undefined)out.calls.push({name:m.toolName,params:m.toolParams||{},result:String(m.toolResult??m.content??'')});
  }finally{window.fetch=realFetch}
  return JSON.stringify(out)
})()`
