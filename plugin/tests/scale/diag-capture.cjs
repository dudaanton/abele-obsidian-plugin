/* eslint-disable @typescript-eslint/no-require-imports -- Loaded inside the desktop host as CommonJS. */
const fs = require('node:fs')
const fsp = fs.promises
const path = require('node:path')
const crypto = require('node:crypto')
/* eslint-enable @typescript-eslint/no-require-imports -- CommonJS imports end here. */
function encode(_key, value) {
  if (typeof value === 'bigint') return { $bigint: String(value) }
  if (value instanceof ArrayBuffer) return { $type: 'ArrayBuffer', base64: Buffer.from(value).toString('base64') }
  if (ArrayBuffer.isView(value)) return { $type: value.constructor.name, base64: Buffer.from(value.buffer, value.byteOffset, value.byteLength).toString('base64') }
  if (value instanceof Map) return { $map: [...value] }
  if (value instanceof Set) return { $set: [...value] }
  return value
}
async function copyFiles(root, output) {
  await fsp.mkdir(output,{recursive:true})
  const files=[]
  const visit=async relative=>{
    const source=path.join(root,relative)
    const st=await fsp.lstat(source).catch(error=>{if(error.code==='ENOENT')return null;throw error})
    if(!st)return
    if(st.isSymbolicLink()){files.push({path:relative,skippedSymlink:await fsp.readlink(source)});return}
    if(st.isDirectory()){for(const child of await fsp.readdir(source))await visit(path.join(relative,child));return}
    if(!st.isFile())throw new Error('Diagnostic state contains unsupported file type')
    if(['.obsidian/plugins/abele/main.js','.obsidian/plugins/abele/styles.css','.obsidian/plugins/abele/manifest.json'].includes(relative))return
    const destination=path.join(output,'files',relative);await fsp.mkdir(path.dirname(destination),{recursive:true});await fsp.copyFile(source,destination)
    const hash=crypto.createHash('sha256');for await(const chunk of fs.createReadStream(destination))hash.update(chunk)
    files.push({path:relative,size:(await fsp.stat(destination)).size,sha256:hash.digest('hex')})
  }
  for(const relative of ['.abele-sync','.obsidian/plugins/abele'])await visit(relative)
  await fsp.writeFile(path.join(output,'files.json'),JSON.stringify(files,null,2))
  return files
}
async function capture(app, output, factory, modulePaths = { databaseExport: path.join(__dirname, 'indexeddb.cjs') }) {
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- Absolute deployed diagnostic dependency.
  const { exportDatabase } = require(modulePaths.databaseExport)
  const startedAt=Date.now();await fsp.mkdir(output,{recursive:true})
  const host=app.plugins.plugins.abele.tokenEngines,ui=host.ui
  const records=JSON.parse(JSON.stringify(ui.registry.records()))
  const context={startedAt,root:app.vault.adapter.getBasePath(),records,activity:ui.activity.value,rows:ui.rows.value,engines:[...host.live.values()].map(one=>({status:one.engine.status,fatal:one.fatalFailure?{message:one.fatalFailure.message,stack:one.fatalFailure.stack,code:one.fatalFailure.code}:null}))}
  context.localStorage={};for(const key of ['abele-sync-local-directories-v1','abele-sync-empty-directory-removals-v1','abele-sync-ledger'])context.localStorage[key]=app.loadLocalStorage(key)
  await fsp.writeFile(path.join(output,'context.json'),JSON.stringify(context,encode,2))
  const names=[...new Set(records.flatMap(record=>[record.ledgerId,record.pending?.ledgerId]).filter(Boolean))]
  const databases=[]
  for(const [i,name] of names.entries()){
    const target=path.join(output,'ledger-'+i+'.jsonl');let pieces=[],bytes=0
    const flush=()=>{if(pieces.length)fs.appendFileSync(target,pieces.join(''));pieces=[];bytes=0}
    fs.writeFileSync(target,'')
    try {const summary=await exportDatabase(factory,name,row=>{const line=JSON.stringify(row,encode)+'\n';pieces.push(line);bytes+=Buffer.byteLength(line);if(bytes>256*1024)flush()});flush();databases.push({...summary,file:path.basename(target)})}
    catch(error){flush();throw error}
  }
  const files=await copyFiles(context.root,output)
  const summary={startedAt,endedAt:Date.now(),databases,files:files.length,bytes:files.reduce((sum,one)=>sum+(one.size||0),0),coverage:'Existing connection ledger IDs only; one readonly transaction per database. Live disk copies are sequential; the post-crash offline copy is quiescent.'}
  await fsp.writeFile(path.join(output,'complete.json'),JSON.stringify(summary,null,2));return summary
}
module.exports={capture,copyFiles}
