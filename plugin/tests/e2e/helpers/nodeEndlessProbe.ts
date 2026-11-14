/** Browser program shared with deterministic harness coverage. */
export const ENDLESS_COMPACT = `
  // Restoring the fixture transport starts a connection; it does not await it.
  await waitFor(()=>connection.state.value==='connected'&&client.connected,'Connection before compaction');
  try{await presenter().control.compact('sample summary')}catch(error){throw diagnose(error)}
  await waitFor(()=>[...chat().querySelectorAll('.abele-session-mark__label')].some(m=>m.textContent.includes('Compacted')),'Compaction');
  return 'compacted';`

export const ENDLESS_DIAGNOSTICS = `
  const received=[];
  const recordEvent=e=>{if(e.stream_id===sid){received.push({type:e.type,seq:e.seq,data:['compaction.started','compaction.completed','session.process','turn.completed'].includes(e.type)?e.data:undefined});if(received.length>16)received.shift()}};
  const diagnose=error=>{
    const p=presenter(),root=chat(),list=root?.querySelector('.abele-ai-chat__messages');
    return Error(String(error)+'; '+JSON.stringify({
      connected:client.connected,connection:connection.state.value,visibility:document.visibilityState,
      error:p?.error.value,draftNotice:p?.draftNotice.value,streaming:p?.isStreaming.value,
      session:p?.control.state.value,projection:p?.projection.value.state,received,
      projected:p?.messages.value.slice(-4).map(m=>({id:m.id,role:m.role,content:m.content?.slice(-250),mark:m.sessionMark})),
      visible:[...root?.querySelectorAll('.abele-chat-msg')??[]].slice(-3).map(m=>m.textContent.slice(-250)),
      labels:[...root?.querySelectorAll('.abele-session-mark__label')??[]].map(m=>m.textContent),
      scroll:list?{top:list.scrollTop,height:list.scrollHeight,client:list.clientHeight}:null
    }));
  };
  const waitFor=async(fn,what)=>{try{return await until(fn,what)}catch(error){throw diagnose(error)}};`
