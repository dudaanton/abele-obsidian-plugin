/** Scoped instrumentation of the actual ports used by a live engine, restored after the case. */
export const MOVE_DIAGNOSTICS = `
const installMoveDiagnostics = (runtime, root) => {
 const engine=runtime.engine, opts=engine.opts, originalFs=opts.fs;
 const originalSync=opts.onSync, context=engine.cycle.ctx, originalLog=context.log;
 const watchFs=engine.watch.ctx.fs;
 const calls=[]; let lastReport=null;
 const record=entry=>{calls.push(entry);if(calls.length>120)calls.shift()};
 opts.fs=new Proxy(originalFs,{get(target,key){
  const fn=Reflect.get(target,key);
  if(typeof fn!=='function')return fn;
  if(!['stat','fingerprint','move','remove','beginAtomicWrite','reopenStage'].includes(key))return fn.bind(target);
  return async (...args)=>{
   const relevant=typeof args[0]==='string'&&args[0].startsWith(root+'/');
   try{const result=await fn.apply(target,args);if(relevant)record({method:key,path:args[0],destination:key==='move'?args[1]:undefined,result:['stat','fingerprint'].includes(key)?result:undefined});return result}
   catch(error){if(relevant)record({method:key,path:args[0],error:String(error?.message||error),cause:String(error?.cause?.message||'')});throw error}
  }
 }});
 engine.watch.ctx.fs=opts.fs;
 opts.onSync=report=>{lastReport=report;return originalSync?.(report)};
 context.log=message=>{if(message.includes('holding'))record({hold:message,noticed:[...engine.watch.noticed],reported:[...engine.watch.reported],kept:[...engine.cycle.kept],unsettled:[...engine.cycle.unsettled]});return originalLog(message)};
 return {
  async snapshot(paths){
   const files=[];
   for(const path of paths){
    const file={path,exists:await app.vault.adapter.exists(path),adapterStat:await app.vault.adapter.stat(path),indexed:app.vault.getFileByPath(path)?.stat||null,ledger:await opts.state.get(path)};
    if(file.ledger)file.pending=await opts.state.getMeta('pull-write:'+file.ledger.fileId);
    try{file.engineStat=await originalFs.stat(path);if(file.engineStat)file.fingerprint=await originalFs.fingerprint(path)}catch(error){file.error=String(error?.message||error);file.cause=String(error?.cause?.message||'')}
    files.push(file);
   }
   return {files,lastReport,calls:[...calls],noticed:[...engine.watch.noticed],reported:[...engine.watch.reported]};
  },
  close(){opts.fs=originalFs;opts.onSync=originalSync;context.log=originalLog;engine.watch.ctx.fs=watchFs}
 };
};`
