import { expect, it } from 'vitest'
import { spawn, execFile, type ChildProcess } from 'node:child_process'
import { promisify } from 'node:util'
import { mkdirSync, mkdtempSync, writeFileSync, rmSync, realpathSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, resolve } from 'node:path'
import { createServer } from 'node:http'
import { connect, type Socket } from 'node:net'
import { evalLong, evalRaw, reloadApp } from './helpers/obsidianCli'
import { targets } from './helpers/target'
import { checkNodeFileMenuGeometry } from '../helpers/nodeFileMenuGeometry'
import { checkNodeChatGeometry } from '../helpers/nodeChatGeometry'

targets('desktop')
const cli = process.env.ABELE_NODE_CLI
const shots = process.env.ABELE_NODE_PATH_SCREENSHOTS ?? process.env.ABELE_E2E_SHOTS
const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))
const prelude = `const api=window.__abeleTest,nodes=api.NodeService.getInstance();const wait=ms=>new Promise(r=>setTimeout(r,ms));const until=async f=>{for(let i=0;i<400;i++){if(f())return;await wait(50)}throw Error('Node path did not settle: '+f.toString())};const visible=selector=>[...document.querySelectorAll(selector)].find(el=>el.getBoundingClientRect().width>0&&getComputedStyle(el).visibility!=='hidden'&&!el.closest('.workspace-leaf.mod-hidden')); const button=(root,text)=>[...root.querySelectorAll('button')].find(b=>b.textContent.trim()===text);const tab=m=>visible('.abele-node-modes [role="tab"][aria-label^="'+m+'"]');const shownMode=m=>tab(m)?.getAttribute('aria-selected')==='true';const nodeControls=async()=>{if(visible('.abele-node-panel_ready')&&(!app.isMobile||app.workspace.leftSplit.collapsed===false))return;const leaf=app.workspace.getLeavesOfType('abele-node-sidebar')[0];if(!leaf)throw Error('Node drawer leaf missing');await leaf.setViewState({type:'abele-node-sidebar',active:true,state:leaf.view.getState()});await app.workspace.revealLeaf(leaf);app.workspace.setActiveLeaf(leaf,{focus:true});app.workspace.leftSplit.expand();await until(()=>visible('.abele-node-panel_ready'))};const pickMode=async m=>{await nodeControls();await until(()=>tab(m));if(!shownMode(m))tab(m).click();await until(()=>shownMode(m))};const menuItem=t=>[...document.querySelectorAll('.menu-item')].find(i=>i.textContent.includes(t));const placeMenu=async t=>{await nodeControls();visible('.abele-node-place > .abele-obsidian-icon').click();await until(()=>menuItem(t));return menuItem(t)};const nodeMenu=async t=>{await nodeControls();const own=visible('.abele-node-panel__node-menu');if(own)own.click();else visible('.abele-node-place > .abele-obsidian-icon').click();await until(()=>menuItem(t));return menuItem(t)};const closePrompt=async()=>{const input=document.querySelector('.prompt-input');input?.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',code:'Escape',keyCode:27,bubbles:true}));await wait(150);if(document.querySelector('.prompt'))document.querySelector('.modal-container .modal-bg')?.click();await until(()=>!document.querySelector('.prompt'))};`
async function capture(name: string) {
  if (!shots) return
  await evalLong(
    `(async()=>{await new Promise(r=>setTimeout(r,250));const path=${JSON.stringify(resolve(shots, name + '.png'))};require('fs').mkdirSync(require('path').dirname(path),{recursive:true});const image=await require('@electron/remote').getCurrentWebContents().capturePage();require('fs').writeFileSync(path,image.toPNG());return 'captured'})()`
  )
}
async function checkCodeCitation(shell: 'desktop' | 'phone') {
  // The desktop editor saves the next working version before the phone phase begins.
  const expected = shell === 'phone' ? 'value = 4' : 'value = 3'
  const reveal = async (line: number, endLine: number) =>
    evalLong(
      `(async()=>{${prelude}const leaf=app.workspace.getLeavesOfType('abele-node-file').find(l=>l.view.contentEl.contains(visible('.abele-file-view')));const state={...leaf.view.getState(),line:${line},endLine:${endLine}};await leaf.setViewState({type:'abele-node-file',active:true,state});await app.workspace.revealLeaf(leaf);await until(()=>visible('.abele-file-view .cm-line'));if(leaf.view.file.mode.value!=='file')throw Error('Code citation opened a diff');return 'revealed citation'})()`
    )
  await reveal(1, 1)
  await evalLong(
    `(async()=>{${prelude}await until(()=>visible('.abele-file-view .abele-github-code__line_target'));if(!visible('.abele-file-view').textContent.includes(${JSON.stringify(expected)}))throw Error('Working-tree content missing');return 'working line marked'})()`
  )
  await capture(shell + '-code-link-range')
  await reveal(99999, 99999)
  await evalLong(
    `(async()=>{${prelude}await until(()=>visible('.abele-node-main')?.textContent.includes('The linked lines no longer exist'));return 'missing lines explained'})()`
  )
  await capture(shell + '-code-link-missing-lines')
  await reveal(1, 1)
}

/** The comparison of a code file is coloured the way the code view colours the file. */
async function checkDiffColours() {
  await evalLong(
    `(async()=>{${prelude}await until(()=>visible('.abele-file-view .abele-diff_code .abele-diff__line_added .abele-diff__text'));const text=visible('.abele-file-view .abele-diff__line_added .abele-diff__text');const keyword=[...text.querySelectorAll('span[class]')].find(s=>s.textContent==='const'&&!s.classList.contains('abele-diff__changed'));if(!keyword)throw Error('Syntax colours missing in the diff: '+text.innerHTML);if(getComputedStyle(keyword).color===getComputedStyle(text).color)throw Error('The keyword is drawn in the text colour');if(!/^export const value = \\d+$/.test(text.textContent))throw Error('The coloured line reads '+text.textContent);return 'diff colours'})()`
  )
}

async function reopenNodePane(name: string) {
  try {
    await evalLong(
      `(async()=>{${prelude}for(const leaf of app.workspace.getLeavesOfType('abele-node-sidebar'))leaf.detach();app.commands.executeCommandById('abele:open-node');await until(()=>app.workspace.getLeavesOfType('abele-node-sidebar').length===1);const view=app.workspace.getLeavesOfType('abele-node-sidebar')[0].view;await until(()=>visible('.abele-node-panel_ready .abele-status-dot_green')||(visible('.abele-node-panel_ready .abele-node-place__row')&&nodes.connection(view.getState().registrationId).state.value==='connected'));if(!nodes.nodes.value.some(n=>n.id===view.getState().registrationId))throw Error('Reopened pane lost its registered node');if(visible('.abele-node-panel_found,.abele-node-panel_remote'))throw Error('Reopened pane asks to connect again');return 'registered pane reopened'})()`
    )
  } catch (error) {
    await capture(name + '-error')
    const diagnostic = await evalLong(
      `(()=>{${prelude}return JSON.stringify({mobile:app.isMobile,drawer:{collapsed:app.workspace.leftSplit.collapsed,width:app.workspace.leftSplit.containerEl?.offsetWidth},nodes:nodes.nodes.value.map(n=>({id:n.id,state:nodes.connection(n.id).state.value})),views:app.workspace.getLeavesOfType('abele-node-sidebar').map(l=>({state:l.view.getState(),phase:l.view.localPhase?.value,hidden:l.containerEl.classList.contains('mod-hidden')})),panels:[...document.querySelectorAll('.abele-node-panel')].map(el=>({class:el.className,rect:el.getBoundingClientRect().toJSON(),visibility:getComputedStyle(el).visibility,text:el.textContent.slice(0,300)}))})})()`
    )
    throw new Error(`${error instanceof Error ? error.message : String(error)}\n${diagnostic}`)
  }
  await capture(name)
}
async function checkFileLookup(prefix: 'desktop' | 'phone') {
  await evalLong(
    `(async()=>{${prelude}await pickMode('Files');await until(()=>visible('.abele-file-tree')?.textContent.includes('Ignored files are not shown.'));if(visible('.abele-file-tree').textContent.includes('hidden.txt'))throw Error('Ignored content was included');return 'all files'})()`
  )
  await capture(prefix + '-all-files')
  // The fixture's nested entries are now loaded by expansion, not by an eager repository walk.
  await evalLong(
    `(async()=>{${prelude}for(const [folder,file] of [['lookup','lookup-72.txt'],['src','sample.ts']]){const tree=visible('.abele-file-tree');const row=[...tree.querySelectorAll('.tree-item-self')].find(el=>el.querySelector('.abele-tree-item__text')?.textContent===folder);if(!row)throw Error('Fixture folder missing: '+folder);if(row.getAttribute('aria-expanded')==='false')row.click();await until(()=>[...tree.querySelectorAll('.abele-tree-item__text')].some(el=>el.textContent===file))}return 'fixture directories loaded lazily'})()`
  )
  await evalLong(
    `(async()=>{${prelude}const input=visible('.abele-file-tree input');input.value='lookup';input.dispatchEvent(new Event('input',{bubbles:true}));await until(()=>visible('.abele-file-tree')?.textContent.includes('50 of 73 · type more to narrow'));if(visible('.abele-file-tree').querySelectorAll('.tree-item-self').length!==50)throw Error('Lookup cap changed');visible('.abele-file-tree__note').scrollIntoView({block:'center'});return 'bounded lookup'})()`
  )
  await capture(prefix + '-lookup-limit')
  await evalLong(
    `(async()=>{${prelude}const tree=visible('.abele-file-tree'),input=tree.querySelector('input');input.value='src/sample.ts';input.dispatchEvent(new Event('input',{bubbles:true}));input.scrollIntoView({block:'center'});await until(()=>tree.querySelectorAll('.tree-item-self').length===1&&tree.textContent.includes('sample.ts'));return 'path lookup'})()`
  )
  await capture(prefix + '-lookup-path')
  await evalLong(
    `(async()=>{${prelude}const input=visible('.abele-file-tree input');input.value='no-such-fixture';input.dispatchEvent(new Event('input',{bubbles:true}));await until(()=>visible('.abele-file-tree')?.textContent.includes('No file matches.'));return 'missing lookup'})()`
  )
  await capture(prefix + '-lookup-missing')
  await evalLong(
    `(async()=>{${prelude}const input=visible('.abele-file-tree input');input.value='';input.dispatchEvent(new Event('input',{bubbles:true}));await until(()=>[...visible('.abele-file-tree').querySelectorAll('.tree-item-self')].some(row=>row.querySelector('.abele-tree-item__text')?.textContent==='sample.ts'));[...visible('.abele-file-tree').querySelectorAll('.tree-item-self')].find(row=>row.querySelector('.abele-tree-item__text')?.textContent==='sample.ts').click();await until(()=>visible('.abele-file-view'));return 'opened from file tree'})()`
  )
  await checkFileSearch(prefix, 'tree')
  await evalLong(
    `(async()=>{${prelude}const leaf=app.workspace.getLeavesOfType("abele-node-file").find(l=>l.view.contentEl.contains(visible(".abele-file-view")));leaf.detach();await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));const sidebar=app.workspace.getLeavesOfType("abele-node-sidebar")[0];await sidebar.setViewState({type:"abele-node-sidebar",active:true,state:sidebar.view.getState()});await app.workspace.revealLeaf(sidebar);app.workspace.setActiveLeaf(sidebar,{focus:true});app.workspace.leftSplit.expand();await pickMode("Changes");return "changes restored"})()`
  )
}
async function checkMixedCommit() {
  await evalLong(
    `(async()=>{${prelude}await until(()=>visible('.abele-history__commit-head'));await until(()=>!visible('.abele-history').textContent.includes('Loading changes…'));const history=visible('.abele-history');if(!history.textContent.includes('sample.bin')||!history.textContent.includes('Binary file · no text diff.'))throw Error('Binary metadata missing');if(!history.textContent.includes('Updated sample repository')||!history.querySelector('.abele-diff'))throw Error('Text diff in mixed commit is unavailable');if(visible('.abele-node-main [role="alert"]'))throw Error('Mixed commit failed');return 'mixed commit readable'})()`
  )
}
async function selectText(selector: string) {
  await evalLong(
    `(async()=>{${prelude}await until(()=>visible(${JSON.stringify(selector)}));const text=visible(${JSON.stringify(selector)});if(getComputedStyle(text).userSelect!=='text')throw Error('File text is not selectable');const range=document.createRange();range.selectNodeContents(text);window.getSelection().removeAllRanges();window.getSelection().addRange(range);document.dispatchEvent(new Event('selectionchange'));await until(()=>visible('.abele-selection-bar_placed'));const bar=visible('.abele-selection-bar_placed').getBoundingClientRect();if(bar.left<0||bar.right>innerWidth||bar.top<0||bar.bottom>innerHeight)throw Error('Selection actions are clipped');const header=text.closest('.abele-file-view').querySelector('.abele-file-view__header,.abele-diff__header');if(header&&bar.top<header.getBoundingClientRect().bottom)throw Error('Selection actions cover the file header');if(document.body.classList.contains('is-phone')&&bar.top<range.getBoundingClientRect().bottom)throw Error('Phone actions overlap the native selection menu');return 'selected'})()`
  )
}
/** The place search lists each worktree with the chats that work there under it, in one column. */
async function checkPlaceSearch() {
  await evalLong(
    `(()=>{${prelude}const items=[...document.querySelectorAll('.prompt .suggestion-item')],titles=items.map(i=>i.querySelector('.suggestion-title')?.textContent);const copy=titles.indexOf('sample-repository / topic'),chat=titles.indexOf('Sample fake chat');if(copy<0||chat<0)throw Error('The worktree or its chat is not listed: '+titles.join(' | '));if(chat<copy)throw Error('The chat is not listed under its worktree: '+titles.join(' | '));if(!items[chat].querySelector('.suggestion-note')?.textContent.startsWith('sample-repository / topic'))throw Error('The chat does not say where it works: '+items[chat].textContent);if(items[chat].querySelector('.abele-node-suggestion__kind')?.getAttribute('aria-label')!=='Chat')throw Error('The chat row is not marked as a chat');const columns=items.map(i=>i.querySelector('.abele-node-suggestion__kind').getBoundingClientRect().left);if(Math.max(...columns)-Math.min(...columns)>1)throw Error('Place and chat glyphs are not aligned: '+columns.join(','));return 'aligned'})()`
  )
}
async function clearSelection() {
  await evalLong(
    `(()=>{window.getSelection().removeAllRanges();document.dispatchEvent(new Event('selectionchange'));return 'cleared'})()`
  )
}
async function checkCodeGeometry() {
  await evalLong(
    `(async()=>{${prelude}await until(()=>visible('.abele-node-main .cm-line'));await wait(200);const line=visible('.abele-node-main .cm-line'),content=visible('.abele-node-main .cm-content');if(content.getBoundingClientRect().width<150)throw Error('Code content collapsed');if(line.getBoundingClientRect().height>parseFloat(getComputedStyle(line).lineHeight)*2)throw Error('A short code line wraps one character at a time');if(!line.querySelector('span[class]'))throw Error('Syntax colours missing');if(!visible('.abele-node-main .cm-lineNumbers'))throw Error('Line numbers missing');return 'code geometry'})()`
  )
}

async function checkFileSearch(shell: 'desktop' | 'phone', entry = 'panel') {
  // Start where a person lands after clicking a changed file, without changing the model.
  await evalLong(
    `(async()=>{${prelude}const find=visible(".abele-file-view [data-node-find]");if(!find)throw Error("Ordinary changed file has no find button");find.click();await until(()=>visible(".abele-file-view .abele-github-find input"));const input=visible(".abele-file-view .abele-github-find input");input.value="value";input.dispatchEvent(new Event("input",{bubbles:true}));await until(()=>visible(".abele-file-view .abele-github-find__match"));input.dispatchEvent(new KeyboardEvent("keydown",{key:"Escape",bubbles:true}));await until(()=>!visible(".abele-file-view .abele-github-find"));if(!app.commands.executeCommandById("editor:open-search"))throw Error("Host current-file search command unavailable");await until(()=>visible(".abele-file-view .abele-github-find input"));visible(".abele-file-view .abele-github-find input").dispatchEvent(new KeyboardEvent("keydown",{key:"Escape",bubbles:true}));await until(()=>!visible(".abele-file-view .abele-github-find"));visible(".abele-file-view .cm-content").focus();return "button and command"})()`
  )
  // Native input goes through the host keymap, unlike dispatchEvent on our component root.
  await evalLong(
    `(()=>{const web=require("@electron/remote").getCurrentWebContents(),modifiers=require("process").platform==="darwin"?["meta"]:["control"];web.sendInputEvent({type:"keyDown",keyCode:"F",modifiers});web.sendInputEvent({type:"keyUp",keyCode:"F",modifiers});return "pressed find"})()`
  )
  await evalLong(
    `(async()=>{${prelude}await until(()=>visible(".abele-file-view .abele-github-find input"));const input=visible(".abele-file-view .abele-github-find input");if(document.activeElement!==input)throw Error("Native find did not focus the field");input.value="value";input.dispatchEvent(new Event("input",{bubbles:true}));await until(()=>visible(".abele-file-view .abele-github-find__match"));return "native find matches"})()`
  )
  await capture(shell + '-' + entry + '-file-search')
  await evalLong(
    `(async()=>{${prelude}visible(".abele-file-view .abele-github-find input").dispatchEvent(new KeyboardEvent("keydown",{key:"Escape",bubbles:true}));await until(()=>!visible(".abele-file-view .abele-github-find"));return "closed find"})()`
  )
}

async function checkFileRepositoryTools(shell: 'desktop' | 'phone', registration: string) {
  try {
    await evalLong(
      `(async()=>{${prelude}await until(()=>visible('.abele-file-view.abele-code-nav [aria-label="Toggle line blame"]'));const toggle=visible('.abele-file-view [aria-label="Toggle line blame"]');if(toggle.getAttribute('aria-pressed')!=='false')throw Error('Blame must start off');const repository=nodes.connection(${JSON.stringify(registration)}).client.repository;window.__fileBlameOriginal=repository.blame;repository.blame=async(...args)=>{await new Promise(resolve=>window.__fileBlameRelease=resolve);return window.__fileBlameOriginal.apply(repository,args)};return 'blame off'})()`
    )
    await capture(shell + '-file-blame-off')
    await evalLong(
      `(async()=>{${prelude}visible('.abele-file-view [aria-label="Toggle line blame"]').click();await until(()=>visible('.abele-file-view [data-repository-blame-status]')?.textContent.includes('Loading line blame'));return 'blame loading'})()`
    )
    await capture(shell + '-file-blame-loading')
    await evalLong(
      `(async()=>{${prelude}window.__fileBlameRelease();await until(()=>visible('.abele-file-view .abele-github-blame-range'));if(!visible('.abele-file-view .abele-github-blame-range').textContent.includes('Uncommitted'))throw Error('Working file blame missing');const code=visible('.abele-file-view .abele-github-code'),gutter=visible('.abele-file-view .abele-github-blame'),line=visible('.abele-file-view .cm-line');if(gutter.getBoundingClientRect().width>code.getBoundingClientRect().width*0.4)throw Error('Blame crowds the code');if(line.getBoundingClientRect().height>parseFloat(getComputedStyle(line).lineHeight)*1.5)throw Error('Blame wraps a short code line');return 'blame on'})()`
    )
    await capture(shell + '-file-blame-on')
    await evalLong(
      `(async()=>{${prelude}const toggle=visible('.abele-file-view [aria-label="Toggle line blame"]');toggle.click();nodes.connection(${JSON.stringify(registration)}).client.repository.blame=async()=>{throw Error('Sample blame unavailable')};toggle.click();await until(()=>visible('.abele-file-view .abele-github-notice')?.textContent.includes('Sample blame unavailable'));return 'blame error'})()`
    )
    await capture(shell + '-file-blame-error')
    await evalLong(
      `(async()=>{${prelude}nodes.connection(${JSON.stringify(registration)}).client.repository.blame=window.__fileBlameOriginal;visible('.abele-file-view .abele-github-notice__retry').click();await until(()=>!visible('.abele-file-view .abele-github-notice')&&visible('.abele-file-view .abele-github-blame-range'));visible('.abele-file-view [aria-label="Toggle line blame"]').click();visible('.abele-file-view').dispatchEvent(new KeyboardEvent('keydown',{key:'f',ctrlKey:true,bubbles:true,cancelable:true}));await until(()=>visible('.abele-file-view .abele-github-find input'));const input=visible('.abele-file-view .abele-github-find input');input.value='value';input.dispatchEvent(new Event('input',{bubbles:true}));await until(()=>visible('.abele-file-view .abele-github-find__match'));if(input.getBoundingClientRect().width<parseFloat(getComputedStyle(input).fontSize)*4)throw Error('Find input is squeezed by its controls');return 'find matches file text'})()`
    )
    await capture(shell + '-file-search-open')
    await evalLong(
      `(async()=>{${prelude}visible('.abele-file-view .abele-github-find input').dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}));await until(()=>!visible('.abele-file-view .abele-github-find'));const leaf=app.workspace.getLeavesOfType('abele-node-file').find(l=>l.view.contentEl.contains(visible('.abele-file-view')));const state={...leaf.view.getState()};delete state.line;delete state.endLine;await leaf.setViewState({type:'abele-node-file',active:true,state});await until(()=>!visible('.abele-file-view .abele-github-code__line_target'));const row=visible('.abele-file-view .cm-line');const walker=document.createTreeWalker(row,NodeFilter.SHOW_TEXT);let word;while(walker.nextNode()){if(walker.currentNode.textContent.includes('value')){word=walker.currentNode;break}}if(!word)throw Error('Code identifier missing');const range=document.createRange(),offset=word.textContent.indexOf('value');range.setStart(word,offset);range.setEnd(word,offset+5);const r=range.getBoundingClientRect();word.parentElement.dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,cancelable:true,clientX:r.left+r.width/2,clientY:r.top+r.height/2}));await until(()=>menuItem('Find references to'));if(menuItem('Copy path'))throw Error('File menu replaced code navigation');menuItem('Go to definition of').click();await until(()=>!visible('.menu')&&visible('.abele-file-view .abele-github-code__line_target')&&leaf.view.getState().line===1);return 'definition opens in file tab'})()`
    )
  } finally {
    await evalLong(
      `(()=>{${prelude}if(window.__fileBlameOriginal)nodes.connection(${JSON.stringify(registration)}).client.repository.blame=window.__fileBlameOriginal;window.__fileBlameRelease?.();delete window.__fileBlameOriginal;delete window.__fileBlameRelease;return 'restored blame transport'})()`
    )
  }
}

async function checkFileLineMenu(shell: 'desktop' | 'phone') {
  try {
    await evalLong(
      `(async()=>{${prelude}await clearSelectionForMenu();async function clearSelectionForMenu(){window.getSelection()?.removeAllRanges();document.dispatchEvent(new Event('selectionchange'));await wait(100)}const line=visible('.abele-file-view .cm-line');line.scrollIntoView({block:'center'});await wait(100);const r=line.getBoundingClientRect(),x=r.right-4,y=r.top+r.height/2;line.dispatchEvent(new PointerEvent('contextmenu',{bubbles:true,cancelable:true,clientX:x,clientY:y,pointerType:${JSON.stringify(shell === 'phone' ? 'touch' : 'mouse')},detail:0}));await until(()=>menuItem('Copy path'));const menuEl=menuItem('Copy path').closest('.menu');await new Promise(requestAnimationFrame);await until(()=>!menuEl.getAnimations().some(a=>a.playState==='running')&&getComputedStyle(menuEl).transform==='none');const menu=menuEl.getBoundingClientRect(),anchor=${shell === 'phone' ? 'r.bottom' : 'y'};(${checkNodeFileMenuGeometry.toString()})(menu,{width:innerWidth,height:innerHeight},anchor,document.body.classList.contains('is-phone'));return 'line menu anchored'})()`
    )
    await capture(shell + '-file-line-menu')
  } finally {
    await evalLong(
      `(async()=>{${prelude}menuItem('Copy path').click();await until(()=>!visible('.menu'));return 'closed line menu'})()`
    )
  }
}

it('pairs and opens target-bound node files history editor and fake chats in the desktop and phone shells', async () => {
  if (!cli) throw new Error('Set ABELE_NODE_CLI to a built node CLI')
  const fixtureRoot = resolve(process.env.ABELE_NODE_PATH_FIXTURE_DIR || realpathSync(tmpdir()))
  mkdirSync(fixtureRoot, { recursive: true, mode: 0o700 })
  const dir = mkdtempSync(resolve(fixtureRoot, 'node-path-')),
    state = resolve(dir, 'state'),
    home = resolve(dir, 'home'),
    repo = resolve(home, 'sample-repository'),
    plain = resolve(home, 'plain-folder')
  mkdirSync(repo, { recursive: true })
  mkdirSync(plain)
  writeFileSync(resolve(plain, 'sample.txt'), 'Plain folder content\n')
  const git = (...args: string[]) =>
    promisify(execFile)('/usr/bin/git', ['-c', 'core.hooksPath=/dev/null', ...args], { cwd: repo })
  await git('init', '--initial-branch=trunk')
  mkdirSync(resolve(repo, 'src'))
  writeFileSync(resolve(repo, 'src/sample.ts'), 'export const value = 1\n')
  writeFileSync(resolve(repo, 'sample.md'), '# Sample repository\n')
  writeFileSync(resolve(repo, 'sample.bin'), Buffer.from([0, 1, 2, 3]))
  writeFileSync(
    resolve(repo, 'sample-image.png'),
    Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
      'base64'
    )
  )
  mkdirSync(resolve(repo, 'lookup'))
  for (let i = 0; i < 73; i++)
    writeFileSync(resolve(repo, `lookup/lookup-${i}.txt`), 'Lookup fixture\n')
  writeFileSync(resolve(repo, '.gitignore'), 'ignored/\n')
  await git('add', '.')
  await git(
    '-c',
    'user.name=Sample',
    '-c',
    'user.email=sample@example.invalid',
    '-c',
    'commit.gpgsign=false',
    'commit',
    '-m',
    'Add sample files'
  )
  writeFileSync(resolve(repo, 'sample.md'), '# Updated sample repository\n')
  writeFileSync(resolve(repo, 'sample.bin'), Buffer.from([0, 4, 5, 6]))
  await git('add', 'sample.md', 'sample.bin')
  await git(
    '-c',
    'user.name=Sample',
    '-c',
    'user.email=sample@example.invalid',
    '-c',
    'commit.gpgsign=false',
    'commit',
    '-m',
    'Update document and binary'
  )
  mkdirSync(resolve(repo, 'ignored'))
  writeFileSync(resolve(repo, 'ignored/hidden.txt'), 'Ignored fixture\n')
  writeFileSync(resolve(repo, 'src/sample.ts'), 'export const value = 2\n')
  await git('add', 'src/sample.ts')
  writeFileSync(resolve(repo, 'src/sample.ts'), 'export const value = 3\n')
  writeFileSync(resolve(repo, 'new.txt'), 'New sample file\n')
  const external = resolve(home, 'external-copy')
  await git('worktree', 'add', '-b', 'topic', external)
  mkdirSync(state, { mode: 0o700 })
  const endpoint = 'wss://sample.example.ts.net:8443/channel',
    config = resolve(state, 'paired.json')
  writeFileSync(
    config,
    JSON.stringify({
      endpoint,
      backend_port: 0,
      origins: ['app://obsidian.md'],
      allow_missing_origin: false,
      allow_null_origin: false,
    }),
    { mode: 0o600 }
  )
  const env = {
    ...process.env,
    HOME: home,
    // Keep the fixture independent of host-installed provider and language CLIs.
    PATH:
      process.platform === 'win32'
        ? process.env.PATH
        : [dirname(process.execPath), '/usr/bin', '/bin', '/usr/sbin', '/sbin'].join(':'),
    ABELE_CLAUDE_PATH: resolve('tests/fixtures/nodeClaude.mjs'),
    ABELE_CODEX_PATH: '',
  }
  const command = async (...args: string[]) =>
    JSON.parse(
      (
        await promisify(execFile)(
          process.execPath,
          [cli, ...args, '--state-dir', state, '--json'],
          { env }
        )
      ).stdout
    )
  const proxy = createServer(),
    sockets = new Set<Socket>()
  let child: ChildProcess | undefined,
    registration = '',
    localRegistration = '',
    mobile = false
  const oldSize = JSON.parse(
    evalRaw(`JSON.stringify(require('@electron/remote').getCurrentWindow().getContentSize())`)
  ) as number[]
  let savedPreferences = ''
  try {
    child = spawn(
      process.execPath,
      [
        cli,
        'start',
        '--port',
        '0',
        '--paired-config',
        config,
        '--node-name',
        'Sample node',
        '--state-dir',
        state,
        '--json',
      ],
      { env, stdio: ['ignore', 'pipe', 'pipe'] }
    )
    let output = '',
      errors = ''
    child.stdout!.on('data', (data) => {
      output += data
    })
    child.stderr!.on('data', (data) => {
      errors += data
    })
    for (let i = 0; i < 400 && !output.includes('"listening"'); i++) {
      if (child.exitCode !== null) throw new Error(errors)
      await wait(20)
    }
    const ready = JSON.parse(output.split('\n').find((line) => line.includes('"listening"'))!)
    proxy.on('upgrade', (request, socket: Socket, head) => {
      if (request.url !== '/channel') {
        socket.destroy()
        return
      }
      const upstream = connect(ready.paired_port, '127.0.0.1')
      for (const peer of [socket, upstream]) {
        sockets.add(peer)
        peer.on('close', () => sockets.delete(peer))
        peer.on('error', () => {
          socket.destroy()
          upstream.destroy()
        })
      }
      upstream.on('connect', () => {
        const headers = request.rawHeaders.slice()
        for (let i = 0; i < headers.length; i += 2)
          if (headers[i].toLowerCase() === 'host') headers[i + 1] = 'sample.example.ts.net:8443'
        upstream.write(
          `GET /channel HTTP/1.1\r\n${headers.reduce((text, value, i) => text + (i % 2 ? value + '\r\n' : value + ': '), '')}\r\n`
        )
        if (head.length) upstream.write(head)
        socket.pipe(upstream)
        upstream.pipe(socket)
      })
    })
    await new Promise<void>((resolve) => proxy.listen(0, '127.0.0.1', resolve))
    const port = (proxy.address() as { port: number }).port
    savedPreferences = evalRaw(
      `JSON.stringify({directory:app.loadLocalStorage('abele-node-local-state-dir')??null,device:app.loadLocalStorage('abele-node-device-name')??null,aiEnabled:window.__abeleTest.AbeleConfig.getInstance().ai.enabled})`
    )
    await evalLong(
      `(async()=>{${prelude}if(nodes.nodes.value.length)throw Error('Use a clean node registry fixture');app.saveLocalStorage('abele-node-local-state-dir',${JSON.stringify(state)});app.saveLocalStorage('abele-node-device-name','Sample device');require('@electron/remote').getCurrentWindow().setContentSize(1200,850);app.commands.executeCommandById('abele:open-node');try{await until(()=>visible('.abele-node-panel_found'))}catch(error){const leaf=app.workspace.getLeavesOfType('abele-node-sidebar')[0];const view=leaf?.view;let diagnostic='no view';try{view.discovery.inspect(view.discovery.load(),${JSON.stringify(state)});diagnostic='inspection succeeded'}catch(failure){diagnostic=failure.message}throw Error(JSON.stringify({phase:view?.localPhase?.value,desktop:view?.discovery?.desktop,diagnostic,body:visible('.abele-node-panel')?.textContent}))}return 'opened node'})()`
    )
    await evalLong(
      `(async()=>{${prelude}const view=app.workspace.getLeavesOfType('abele-node-sidebar')[0].view;view.localPhase.value='not-found';await until(()=>visible('.abele-node-panel_not-found code'));if(!visible('.abele-node-panel_not-found code').textContent.includes('install.sh | sh'))throw Error('Unsupported installer command');return 'installer'})()`
    )
    await capture('desktop-installer')
    await evalLong(
      `(async()=>{${prelude}app.workspace.getLeavesOfType('abele-node-sidebar')[0].view.localPhase.value='found';await until(()=>visible('.abele-node-panel_found'));return 'local discovery restored'})()`
    )
    await capture('desktop-found')
    localRegistration = await evalLong(
      `(async()=>{${prelude}button(visible('.abele-node-panel'),'Connect').click();await until(()=>nodes.nodes.value.length===1&&visible('.abele-node-panel_ready'));return nodes.nodes.value[0].id})()`
    )
    await capture('desktop-empty')
    const invitation = await command('pair', '--node-name', 'Sample node')
    await evalLong(
      `(async()=>{${prelude}api.pairedLoopbackTransport(nodes,'ws://127.0.0.1:${port}/channel');(await nodeMenu('Connect another node')).click();await until(()=>visible('.abele-pair'));return 'pair open'})()`
    )
    await capture('desktop-pair-empty')
    await evalLong(
      `(async()=>{${prelude}const field=visible('.abele-pair textarea');field.value=${JSON.stringify(invitation.code)};field.dispatchEvent(new Event('input',{bubbles:true}));await until(()=>visible('.abele-pair__card'));return 'decoded locally'})()`
    )
    await capture('desktop-pair-decoded')
    await evalLong(
      `(async()=>{${prelude}const address=visible('.abele-pair input[aria-label="Address"]');address.value='invalid host name';address.dispatchEvent(new Event('input',{bubbles:true}));await wait(50);button(visible('.abele-pair'),'Connect').click();await until(()=>visible('.abele-pair .setting-item.is-invalid'));if(!visible('.abele-pair .setting-item.is-invalid').textContent.includes('Address'))throw Error('Pairing error was not on Address');return 'address error'})()`
    )
    await capture('desktop-pair-address-error')
    await evalLong(
      `(async()=>{${prelude}const address=visible('.abele-pair input[aria-label="Address"]');address.value='sample.example.ts.net';address.dispatchEvent(new Event('input',{bubbles:true}));return 'address restored'})()`
    )
    await evalLong(
      `(async()=>{${prelude}const field=visible('.abele-pair input[aria-label="Port"]');field.value='1e2';field.dispatchEvent(new Event('input',{bubbles:true}));await wait(100);if(!button(visible('.abele-pair'),'Connect').disabled)throw Error('Invalid port admitted');return 'invalid port'})()`
    )
    await capture('desktop-pair-error')
    await evalLong(
      `(async()=>{${prelude}const field=visible('.abele-pair input[aria-label="Port"]');field.value='8443';field.dispatchEvent(new Event('input',{bubbles:true}));await wait(50);button(visible('.abele-pair'),'Connect').click();await until(()=>visible('.abele-pair_waiting'));if(nodes.nodes.value.length!==1)throw Error('Pending claim became a registration');return 'waiting'})()`
    )
    await capture('desktop-pair-waiting')
    const pending = await command('approve-pair', '--list')
    expect(pending).toHaveLength(1)
    expect(pending[0].device_name).toBe('Sample device')
    await command('approve-pair', 'Sample device')
    registration = await evalLong(
      `(async()=>{${prelude}try{await until(()=>!visible('.abele-pair')&&nodes.nodes.value.some(n=>n.profile==='paired-wss-v1'))}catch(error){throw Error(error.message+'; '+JSON.stringify({pairing:visible('.abele-pair')?.textContent,connections:nodes.nodes.value.map(n=>({profile:n.profile??'local-token-v1',state:nodes.connection(n.id).state.value,error:nodes.connection(n.id).error.value}))}))}const node=nodes.nodes.value.find(n=>n.profile==='paired-wss-v1');await until(()=>nodes.connection(node.id).state.value==='connected');return node.id})()`
    )
    const ids = JSON.parse(
      await evalLong(
        `(async()=>{${prelude}const client=nodes.connection(${JSON.stringify(registration)}).client;const project=await client.nodePath.register({path:${JSON.stringify(repo)},trust:'untrusted',exact_root:true});await client.setRepositorySettings({project_id:project.project_id,external_read:true,default_branch:'trunk'});const plain=await client.nodePath.register({path:${JSON.stringify(plain)},trust:'untrusted',exact_root:true});const rows=await client.repository.worktrees({project_id:project.project_id,include_selection:true});const root=rows.entries.find(w=>w.kind==='root'),external=rows.entries.find(w=>w.kind==='external');await client.nodePath.worktreeSelection({project_id:project.project_id,worktree_id:external.worktree_id,listed:true});const model=api.NodePathService.getInstance().model(${JSON.stringify(registration)});await api.NodePathService.getInstance().ready(${JSON.stringify(registration)});await model.refresh();await model.select(root.worktree_id);return JSON.stringify({project:project.project_id,root:root.worktree_id,external:external.worktree_id,plain:plain.project_id})})()`
      )
    )
    const rootTarget = {
      nodeId: invitation.invite.node_id,
      registrationId: registration,
      projectId: ids.project,
      kind: 'worktree',
      id: ids.root,
    }
    const open = async (
      kind: string,
      extra: { sessionId?: string; title?: string; [key: string]: unknown } = {},
      target = rootTarget
    ) => {
      // Chat leaves from old layouts migrate asynchronously. Revealing that disposable
      // leaf races the sidebar reveal; use the same chat destination as the node panel.
      if (kind === 'chat')
        return evalLong(
          `(async()=>{${prelude}const chats=api.ChatService.getInstance();await chats.openNodeSession(${JSON.stringify({ kind: 'node-session', nodeId: target.nodeId, registrationId: target.registrationId, sessionId: extra.sessionId, title: extra.title ?? '' })});await chats.revealSidebar({focus:false});await until(()=>visible('.abele-node-chat')?.dataset.sessionId===${JSON.stringify(extra.sessionId)});return 'opened sidebar chat'})()`
        )
      return evalLong(
        `(async()=>{const leaf=app.workspace.getLeaf('tab');await leaf.setViewState({type:${JSON.stringify('abele-node-' + kind)},active:true,state:${JSON.stringify({ kind, target, ...extra })}});await app.workspace.revealLeaf(leaf);return 'opened'})()`
      )
    }
    const timings = await evalLong(
      `(async()=>{${prelude}const connection=nodes.connection(${JSON.stringify(registration)}),client=connection.client,records=[];const methods=['observe','status','blob','content','compare','patch','tree','history'];const originals=methods.map(name=>[name,client.repository[name]]);for(const [name,original] of originals)client.repository[name]=async function(...args){const start=performance.now();try{return await original.apply(this,args)}finally{records.push({name,ms:Math.round(performance.now()-start)})}};try{const start=performance.now(),leaf=app.workspace.getLeaf('tab');await leaf.setViewState({type:'abele-node-file',active:true,state:${JSON.stringify({ kind: 'file', target: rootTarget, path: 'sample.md', markdownMode: 'code' })}});const shellMs=Math.round(performance.now()-start);await until(()=>leaf.view.file?.document.value);await until(()=>leaf.containerEl.querySelector('.cm-line'));if(leaf.containerEl.querySelector('.abele-lsp-status'))throw Error('Analysis banner rendered in the file');const totalMs=Math.round(performance.now()-start);leaf.detach();return JSON.stringify({shellMs,totalMs,records})}finally{for(const [name,original] of originals)client.repository[name]=original}})()`
    )
    console.info('Node file open timing', timings)
    const measurement = JSON.parse(timings)
    // The selected target already has a fresh working observation and change metadata.
    // An unchanged file needs only its blob and retained content, not another repository scan.
    expect(measurement.records.map((record: { name: string }) => record.name)).toEqual([
      'blob',
      'content',
    ])
    expect(measurement.shellMs).toBeLessThan(500)
    await reopenNodePane('desktop-reopened-node')
    await evalLong(
      `(async()=>{const view=app.workspace.getLeavesOfType('abele-node-sidebar')[0].view;await view.setState({registrationId:${JSON.stringify(registration)}},{});return 'selected paired fixture'})()`
    )
    await capture('desktop-changes')
    await checkFileLookup('desktop')
    await evalLong(
      `(async()=>{${prelude}const chats=api.ChatService.getInstance();const id=await chats.newTab();const chat=chats.getAllSessions().find(s=>s.id===id);if(!chat)throw Error('Chat was not created');chat.chatTitle.value='Sample Obsidian chat '+id;window.__nodePathScopeChat=id;if(visible('.abele-node-place__name')?.textContent!=='trunk')throw Error('The place shown is not the root worktree');(await placeMenu('Give a chat access')).click();await until(()=>[...document.querySelectorAll('.suggestion-item')].some(i=>i.textContent.includes(id)));[...document.querySelectorAll('.suggestion-item')].find(i=>i.textContent.includes(id)).click();await until(()=>[...document.querySelectorAll('.modal button')].some(b=>b.textContent.trim()==='Give access'));[...document.querySelectorAll('.modal button')].find(b=>b.textContent.trim()==='Give access').click();await until(()=>chat.overrides.value.nodeScope?.length===1&&!visible('.modal'));await chats.revealSidebar({focus:false});try{await until(()=>visible('.abele-ai-chat .abele-chat-input__scope')?.getAttribute('aria-label')?.includes('worktree trunk'))}catch(e){throw Error(e.message+' label: '+visible('.abele-ai-chat .abele-chat-input__scope')?.getAttribute('aria-label'))}return 'scope granted by place menu'})()`
    )
    await capture('desktop-chat-scope-header')
    await evalLong(
      `(async()=>{${prelude}const panel=visible('.abele-node-panel');const file=[...panel.querySelectorAll('.tree-item-self')].find(r=>r.textContent.includes('sample.ts'));file.click();await until(()=>visible('.abele-file-view')?.textContent.includes('value = 3'));const view=app.workspace.getLeavesOfType('abele-node-file')[0].view;if(view.file.mode.value!=='diff')throw Error('Changed file did not default to diff');if(JSON.stringify(view.getState()).includes('wss://'))throw Error('Transport URL leaked into layout');return 'diff'})()`
    )
    await capture('desktop-diff')
    await checkDiffColours()
    await selectText('.abele-file-view .abele-diff__line_added .abele-diff__text')
    await capture('desktop-diff-selection')
    await clearSelection()
    await checkFileSearch('desktop')
    await evalLong(
      `(async()=>{${prelude}const view=app.workspace.getLeavesOfType('abele-node-file')[0].view;const model=api.NodePathService.getInstance().model(${JSON.stringify(registration)});await model.select(${JSON.stringify(ids.external)});await view.file.step(1);if(view.file.target.id!==${JSON.stringify(ids.root)})throw Error('File arrows followed the sidebar');await view.file.open('src/sample.ts');view.file.mode.value='file';return 'bound navigation'})()`
    )
    await capture('desktop-whole')
    await checkCodeCitation('desktop')
    await checkCodeGeometry()
    await checkFileRepositoryTools('desktop', registration)
    await checkFileLineMenu('desktop')
    await selectText('.abele-file-view .cm-line')
    await capture('desktop-file-selection')
    await evalLong(
      `(async()=>{${prelude}const chats=api.ChatService.getInstance(),id=window.__nodePathScopeChat;if(chats.activeTabId.value!==id)throw Error('The scoped fixture chat is not active');visible('.abele-selection-bar_placed').querySelector('[data-action=add]').click();const chat=chats.getAllSessions().find(s=>s.id===id);await until(()=>chat.draft.value.text.includes('src/sample.ts:1')&&chat.draft.value.text.includes('> export const value = 3'));if([...document.querySelectorAll('.suggestion-item')].some(i=>i.offsetParent&&i.textContent.includes(id)))throw Error('Add unnecessarily asked which chat');if(/"(?:node_context|node_id|content_id)"/.test(chat.draft.value.text))throw Error('Routing payload appeared in the composer');return 'quoted directly to the active Obsidian draft'})()`
    )
    await clearSelection()
    await selectText('.abele-file-view .cm-line')
    await evalLong(
      `(async()=>{${prelude}visible('.abele-selection-bar_placed').querySelector('[data-action=ask]').click();await until(()=>[...document.querySelectorAll('.suggestion-item')].some(i=>i.querySelector('.suggestion-title')?.textContent.trim()==='Test agent'));[...document.querySelectorAll('.suggestion-item')].find(i=>i.querySelector('.suggestion-title')?.textContent.trim()==='Test agent').click();await until(()=>[...document.querySelectorAll('.modal button')].some(b=>b.textContent.trim()==='Trust folder'));return 'trust ready'})()`
    )
    await capture('desktop-folder-trust')
    await evalLong(
      `(async()=>{${prelude}[...document.querySelectorAll('.modal button')].find(b=>b.textContent.trim()==='Trust folder').click();const chats=api.ChatService.getInstance();await until(()=>chats.getNodeSession(chats.activeTabId.value)?.draft.value.text.includes('src/sample.ts:1')&&visible('.abele-node-chat textarea')?.value.includes('src/sample.ts:1'));const presenter=chats.getNodeSession(chats.activeTabId.value);await until(()=>presenter.binding.value);if(presenter.binding.value?.target.worktree_id!==${JSON.stringify(ids.root)}||presenter.isStreaming.value)throw Error('Selected quote was sent or followed the drawer target');if(!presenter.draft.value.text.includes('> export const value = 3')||/"(?:node_context|node_id|content_id)"/.test(presenter.draft.value.text))throw Error('Node draft is not a readable excerpt');return 'quoted to target-bound node draft'})()`
    )
    await clearSelection()
    await capture('desktop-node-selection-context')
    await selectText('.abele-file-view .cm-line')
    await evalLong(
      `(async()=>{${prelude}const chats=api.ChatService.getInstance(),node=chats.getNodeSession(chats.activeTabId.value);const before=node.draft.value.text;visible('.abele-selection-bar_placed').querySelector('[data-action=add]').click();await until(()=>node.draft.value.text.length>before.length);if(document.querySelector('.abele-node-suggestion_current'))throw Error('Add unnecessarily asked which node chat');if(!node.draft.value.text.startsWith(before+'\\n\\n')||node.isStreaming.value)throw Error('Selection replaced the draft or sent a turn');return 'added selection directly to open node chat'})()`
    )
    await clearSelection()
    await evalLong(
      `(async()=>{${prelude}const chats=api.ChatService.getInstance(),node=chats.getNodeSession(chats.activeTabId.value),blank=chats.createTab();chats.switchTab(node.id);await chats.closeTab(node.id);if(!chats.getSession(blank)||!chats.tabOrder.value.includes(blank))throw Error('Closing node chat removed blank vault chat');await chats.openNodeSession(node.reference);await chats.closeTab(blank);return 'only node tab closed, session reopened'})()`
    )

    await open('file', {
      path: 'src/sample.ts',
      debug: {
        conversationId: 'sample-debug-chat',
        sourceId: 'sample-source',
        debugSessionId: 'sample-debug',
        incarnation: 'sample-incarnation',
      },
    })
    await evalLong(
      `(async()=>{${prelude}await until(()=>visible('.abele-debug-source__margin'));return 'debug margin'})()`
    )
    await capture('desktop-file-debug-margin')
    await open('history')
    await evalLong(
      `(async()=>{${prelude}await until(()=>visible('.abele-history__row'));return 'history'})()`
    )
    await capture('desktop-history')
    await evalLong(
      `(async()=>{${prelude}visible('.abele-history__row').click();try{await until(()=>visible('.abele-history__commit-head'))}catch(error){throw Error(JSON.stringify(app.workspace.getLeavesOfType('abele-node-history').map(l=>({error:l.view.history?.error.value,busy:l.view.history?.busy.value,open:l.view.history?.openCommit.value}))))}return 'commit'})()`
    )
    await checkMixedCommit()
    await capture('desktop-commit')
    await open('file', { path: 'sample-image.png' })
    await evalLong(
      `(async()=>{${prelude}await until(()=>visible('.abele-file-view img.abele-image')?.naturalWidth===1);return 'image rendered'})()`
    )
    await capture('desktop-image')
    await evalLong(
      `(async()=>{${prelude}const leaf=app.workspace.getLeavesOfType('abele-node-file').find(l=>l.view.getState().path==='src/sample.ts'&&!l.view.getState().debug);await app.workspace.revealLeaf(leaf);if(leaf.containerEl.querySelector('[aria-label="Open in code editor"]'))throw Error('The code editor action is back');const action=leaf.containerEl.querySelector('.view-action[aria-label="Edit the file"]');if(!action)throw Error('Edit action missing');action.click();await until(()=>visible('.abele-node-main .cm-content')?.contentEditable==='true');if(leaf.view.getState().edit!==true||app.workspace.getLeavesOfType('abele-node-editor').length)throw Error('The file is not edited in its own tab');return 'editor action'})()`
    )
    await evalLong(
      `(async()=>{${prelude}await until(()=>visible('.abele-node-main .cm-content')?.contentEditable==='true');const editor=api.codeView(visible('.abele-node-main .cm-content'));editor.dispatch({changes:{from:0,to:editor.state.doc.length,insert:${JSON.stringify('export const value = 4\n')}}});const leaf=app.workspace.getLeavesOfType('abele-node-file').find(l=>l.view.getState().edit===true);const save=()=>leaf.containerEl.querySelector('.view-action[aria-label="Save to the node · ⌘ S"]');await until(save);save().click();await until(()=>visible('.abele-node-save')?.textContent.includes('Saved ·'));return 'saved'})()`
    )
    await checkCodeGeometry()
    await capture('desktop-editor')
    await evalLong(
      `(async()=>{${prelude}const model=api.NodePathService.getInstance().model(${JSON.stringify(registration)});await model.select(${JSON.stringify(ids.root)});if(visible('.abele-node-panel [aria-label="Open folder"]'))throw Error('The header glyphs stand beside the modes');(await placeMenu('Open a folder…')).click();await until(()=>visible('.abele-folder-picker'));return 'picker'})()`
    )
    await capture('desktop-folder-picker')
    await evalLong(
      `(async()=>{${prelude}const input=visible('.abele-folder-picker input');input.value=${JSON.stringify(resolve(home, 'created-folder'))};input.dispatchEvent(new Event('input',{bubbles:true}));await until(()=>button(visible('.abele-folder-picker'),'Create'));return 'new folder'})()`
    )
    await capture('desktop-new-folder')
    await evalLong(
      `(async()=>{${prelude}button(visible('.abele-folder-picker'),'Create').click();await until(()=>[...document.querySelectorAll('.modal button')].some(b=>b.textContent.trim()==='Trust folder'));[...document.querySelectorAll('.modal button')].find(b=>b.textContent.trim()==='Trust folder').click();await until(()=>!visible('.abele-folder-picker'));const model=api.NodePathService.getInstance().model(${JSON.stringify(registration)});if(!model.folders.value.some(f=>f.name==='created-folder'))throw Error('Created folder was not registered');try{await model.select(${JSON.stringify(ids.root)})}catch(error){throw Error('Selecting root after folder creation: '+String(error))};await until(()=>visible('.abele-node-place__name')?.textContent==='trunk');(await placeMenu('New worktree')).click();await until(()=>visible('.abele-worktree-dialog'));const branch=visible('.abele-worktree-dialog input');branch.value='created-topic';branch.dispatchEvent(new Event('input',{bubbles:true}));await wait(100);return 'named worktree'})()`
    )
    await capture('desktop-new-worktree')
    await evalLong(
      `(async()=>{${prelude}button(visible('.abele-worktree-dialog'),'Create').click();await until(()=>!visible('.abele-worktree-dialog'));const model=api.NodePathService.getInstance().model(${JSON.stringify(registration)});for(let i=0;i<100&&!model.folders.value.flatMap(f=>f.copies).some(c=>c.branch==='created-topic');i++){await model.refresh();await wait(50)}if(!model.folders.value.flatMap(f=>f.copies).some(c=>c.branch==='created-topic'))throw Error('Named worktree never became ready');return 'created named worktree'})()`
    )
    const sessionId = await evalLong(
      `(async()=>{${prelude}const client=nodes.connection(${JSON.stringify(registration)}).client;await client.nodePath.trust({project_id:${JSON.stringify(ids.project)},trust:'trusted'});await client.nodePath.execution({project_id:${JSON.stringify(ids.project)},target:{kind:'worktree',worktree_id:${JSON.stringify(ids.root)}},enabled:true});await client.nodePath.execution({project_id:${JSON.stringify(ids.project)},target:{kind:'worktree',worktree_id:${JSON.stringify(ids.external)}},enabled:true});const session=await client.nodePath.createSession({title:'Sample fake chat',provider:'fake',target:{kind:'worktree',worktree_id:${JSON.stringify(ids.root)}}});await api.NodePathService.getInstance().model(${JSON.stringify(registration)}).refresh();return session.session_id})()`
    )
    await open('chat', { sessionId, title: 'Sample fake chat' })
    await evalLong(
      `(async()=>{${prelude}const chats=api.ChatService.getInstance();await until(()=>chats.tabOrder.value.some(id=>chats.getNodeSession(id)?.reference.sessionId===${JSON.stringify(sessionId)}));const presenter=chats.getNodeSession(chats.tabOrder.value.find(id=>chats.getNodeSession(id)?.reference.sessionId===${JSON.stringify(sessionId)}));await until(()=>presenter.projection.value.session?.session_id===${JSON.stringify(sessionId)}&&presenter.nodeDescription.value&&presenter.binding.value?.target.worktree_id===${JSON.stringify(ids.root)});await presenter.send('Sample task',[{kind:'hang'}]);if(presenter.error.value||presenter.draftNotice.value)throw Error('Fake turn was not admitted: '+(presenter.error.value||presenter.draftNotice.value));await until(()=>presenter.isStreaming.value);const model=api.NodePathService.getInstance().model(${JSON.stringify(registration)});await model.refresh();if(!model.folders.value.flatMap(f=>f.copies).find(c=>c.id===${JSON.stringify(ids.root)}).running)throw Error('No running marker');return 'running'})()`
    )
    await capture('desktop-chat-running')
    await evalLong(
      `(async()=>{${prelude}const chats=api.ChatService.getInstance();const presenter=chats.getNodeSession(chats.tabOrder.value.find(id=>chats.getNodeSession(id)?.reference.sessionId===${JSON.stringify(sessionId)}));await presenter.interrupt(presenter.projection.value.activeRuns[0]);await until(()=>!presenter.isStreaming.value);const client=nodes.connection(${JSON.stringify(registration)}).client;await client.nodePath.sessionWorktreeSet({session_id:${JSON.stringify(sessionId)},expected_target:{kind:'worktree',worktree_id:${JSON.stringify(ids.root)}},target:{kind:'worktree',worktree_id:${JSON.stringify(ids.external)}}});await until(()=>visible('.abele-worktree-switch'));await api.NodePathService.getInstance().model(${JSON.stringify(registration)}).refresh();return 'journal switch'})()`
    )
    await capture('desktop-chat-switch')
    await evalLong(
      `(async()=>{${prelude}const model=api.NodePathService.getInstance().model(${JSON.stringify(registration)});model.selectedChat.value=${JSON.stringify(sessionId)};await model.select(${JSON.stringify(ids.external)});await until(()=>visible('.abele-node-place__name')?.textContent==='topic');visible('.abele-node-place__row').click();await until(()=>[...document.querySelectorAll('.prompt .suggestion-title')].some(t=>t.textContent==='Sample fake chat'));return 'nested rows'})()`
    )
    await checkPlaceSearch()
    await capture('desktop-nested-panel')
    await evalLong(`(async()=>{${prelude}await closePrompt();return 'search closed'})()`)
    await evalLong(
      `(async()=>{${prelude}const model=api.NodePathService.getInstance().model(${JSON.stringify(registration)});await model.select(${JSON.stringify(ids.plain)});await until(()=>visible('.abele-node-place__name')?.textContent==='plain-folder');if(tab('Changes')||tab('History'))throw Error('A plain folder shows git modes');return 'plain'})()`
    )
    await capture('desktop-plain')
    const removedRepo = resolve(home, 'removed-repository')
    mkdirSync(removedRepo)
    await git('-C', removedRepo, 'init', '--initial-branch=trunk')
    await git(
      '-C',
      removedRepo,
      '-c',
      'user.name=Sample',
      '-c',
      'user.email=sample@example.com',
      'commit',
      '--allow-empty',
      '-m',
      'Initial fixture'
    )
    mkdirSync(resolve(removedRepo, '.abele'))
    writeFileSync(resolve(removedRepo, '.abele/retained.txt'), 'Retained local data\n')
    const removedProject = await evalLong(
      `(async()=>{${prelude}const client=nodes.connection(${JSON.stringify(registration)}).client;const project=await client.nodePath.register({path:${JSON.stringify(removedRepo)},trust:'untrusted',exact_root:true});const model=api.NodePathService.getInstance().model(${JSON.stringify(registration)});await model.refresh();await model.select(model.targets.value.find(t=>t.projectId===project.project_id).id);return project.project_id})()`
    )
    rmSync(resolve(removedRepo, '.git'), { recursive: true })
    await evalLong(
      `(async()=>{${prelude}const model=api.NodePathService.getInstance().model(${JSON.stringify(registration)});try{await model.refresh()}catch(error){const client=nodes.connection(model.registrationId).client,checks={};for(const [name,read] of [['projects',()=>client.listProjects()],['sessions',()=>client.listSessions()],['workspaces',()=>client.listWorkspaces(${JSON.stringify(removedProject)})],['worktrees',()=>client.repository.worktrees({project_id:${JSON.stringify(removedProject)}})]]){try{await read();checks[name]='ok'}catch(failure){checks[name]=String(failure)}}throw Error(String(error)+' catalogue diagnostics '+JSON.stringify(checks))};await until(()=>visible('.abele-node-panel [role="alert"]')?.textContent.includes('no longer available'));if(visible('.abele-node-panel')?.textContent.includes('choose it again'))throw Error('Unavailable folder asks for reselection');if(visible('.abele-file-tree'))throw Error('Unavailable folder retains a file tree');if(visible('.abele-node-place__name')?.textContent==='trunk')throw Error('Unavailable folder still looks like a branch');if(!button(visible('.abele-node-panel [role="alert"]'),'Remove the folder from the node…'))throw Error('No unregister action');return 'unavailable folder'})()`
    )
    await capture('desktop-folder-unavailable')
    // A phone registry contains paired nodes, not a desktop-only loopback registration.
    await evalLong(
      `(()=>{window.__abeleTest.NodeService.getInstance().remove(${JSON.stringify(localRegistration)});return 'desktop registration removed'})()`
    )
    localRegistration = ''
    const scopeBeforeReload = JSON.parse(
      await evalLong(
        `(async()=>{${prelude}const chats=api.ChatService.getInstance();const chat=chats.getAllSessions().find(s=>s.overrides.value.nodeScope?.some(scope=>scope.node_id===${JSON.stringify(rootTarget.nodeId)}));if(!chat)throw Error('Scoped chat missing before reload');const file=chat.currentChatFile.value;return JSON.stringify({path:file?.path??null,scope:chat.overrides.value.nodeScope,tabs:app.loadLocalStorage('abele-agent-tabs'),stored:file?(await app.vault.read(file)).split(String.fromCharCode(10)).flatMap(line=>{try{const record=JSON.parse(line);return record.k==='meta'?[record]:[]}catch{return[]}}).at(-1)?.overrides?.nodeScope:null})})()`
      )
    )
    console.info('Node scoped chat before reload', JSON.stringify(scopeBeforeReload))
    // Presentation restoration must not depend on optional model/tool execution being enabled.
    await evalLong(
      `(async()=>{const config=window.__abeleTest.AbeleConfig.getInstance();config.editSettings(()=>{config.ai.enabled=false});await config.saveSettings();return 'optional AI disabled for restoration fixture'})()`
    )
    // Reload into the real phone shell, then restore only this fixture's paired transport.
    await reloadApp('app.emulateMobile(true)')
    mobile = true
    await evalLong(
      `(async()=>{${prelude}require('@electron/remote').getCurrentWindow().setContentSize(390,844);if(api.AbeleConfig.getInstance().ai.enabled)throw Error('Restoration fixture unexpectedly enabled optional AI');api.pairedLoopbackTransport(nodes,'ws://127.0.0.1:${port}/channel');await nodes.connection(${JSON.stringify(registration)}).refreshAuthorization();nodes.connection(${JSON.stringify(registration)}).start();await nodes.connection(${JSON.stringify(registration)}).connect();const model=api.NodePathService.getInstance().model(${JSON.stringify(registration)});await api.NodePathService.getInstance().ready(${JSON.stringify(registration)});await model.refresh();await model.select(${JSON.stringify(ids.root)});const sidebar=app.workspace.getLeavesOfType('abele-node-sidebar')[0]??app.workspace.getLeftLeaf(false);if(!sidebar)throw Error('No native left drawer leaf');await sidebar.setViewState({type:'abele-node-sidebar',active:true,state:{registrationId:${JSON.stringify(registration)}}});await app.workspace.revealLeaf(sidebar);app.workspace.leftSplit.expand();await until(()=>visible('.abele-node-panel'));return 'phone drawer'})()`,
      60000
    )
    await reopenNodePane('phone-reopened-node')
    await evalLong(
      `(async()=>{${prelude}const sidebar=app.workspace.getLeavesOfType('abele-node-sidebar')[0];await sidebar.view.setState({registrationId:${JSON.stringify(registration)}},{});await app.workspace.revealLeaf(sidebar);app.workspace.leftSplit.expand();await until(()=>visible('.abele-node-panel_ready'));return 'paired drawer'})()`
    )
    await capture('phone-changes')
    await evalLong(
      `(async()=>{${prelude}const model=api.NodePathService.getInstance().model(${JSON.stringify(registration)});await model.select(${JSON.stringify(removedProject)});await until(()=>visible('.abele-node-panel [role="alert"]')?.textContent.includes('no longer available'));if(model.panelBranch.value)throw Error('Unavailable folder retains previous branch metadata');if(visible('.abele-node-panel')?.textContent.includes('choose it again'))throw Error('Unavailable folder asks for reselection');return 'phone unavailable folder'})()`
    )
    await capture('phone-folder-unavailable')
    await evalLong(
      `(async()=>{${prelude}button(visible('.abele-node-panel [role="alert"]'),'Remove the folder from the node…').click();await until(()=>document.querySelector('.modal')&&button(document.querySelector('.modal'),'Remove folder'));button(document.querySelector('.modal'),'Remove folder').click();const model=api.NodePathService.getInstance().model(${JSON.stringify(registration)});await until(()=>!model.folders.value.some(f=>f.id===${JSON.stringify(removedProject)}));await model.select(${JSON.stringify(ids.root)});return 'unregistered without deleting files'})()`
    )
    expect(readFileSync(resolve(removedRepo, '.abele/retained.txt'), 'utf8')).toBe(
      'Retained local data\n'
    )
    await checkFileLookup('phone')
    await evalLong(
      `(async()=>{${prelude}const model=api.NodePathService.getInstance().model(${JSON.stringify(registration)});model.selectedChat.value=${JSON.stringify(sessionId)};await model.select(${JSON.stringify(ids.external)});await until(()=>visible('.abele-node-place__name')?.textContent==='topic');visible('.abele-node-place__row').click();await until(()=>[...document.querySelectorAll('.prompt .suggestion-title')].some(t=>t.textContent==='Sample fake chat'));return 'nested phone rows'})()`
    )
    await checkPlaceSearch()
    await capture('phone-nested-panel')
    await evalLong(`(async()=>{${prelude}await closePrompt();return 'search closed'})()`)
    await evalLong(
      `(async()=>{${prelude}await api.NodePathService.getInstance().model(${JSON.stringify(registration)}).select(${JSON.stringify(ids.root)});return 'root'})()`
    )
    await evalLong(
      `(async()=>{${prelude}(await nodeMenu('Connect another node')).click();await until(()=>visible('.abele-pair'));return 'phone pair'})()`
    )
    await capture('phone-pair-empty')
    await evalLong(
      `(async()=>{${prelude}const field=visible('.abele-pair textarea');field.value=${JSON.stringify(invitation.code)};field.dispatchEvent(new Event('input',{bubbles:true}));await until(()=>visible('.abele-pair__card'));return 'phone code fields'})()`
    )
    await capture('phone-pair-decoded')
    await evalLong(
      `(async()=>{${prelude}const address=visible('.abele-pair input[aria-label="Address"]');address.value='invalid host name';address.dispatchEvent(new Event('input',{bubbles:true}));await wait(50);button(visible('.abele-pair'),'Connect').click();await until(()=>visible('.abele-pair .setting-item.is-invalid'));return 'phone address error'})()`
    )
    await capture('phone-pair-address-error')
    await evalLong(
      `(async()=>{${prelude}const port=visible('.abele-pair input[aria-label="Port"]');port.value='0';port.dispatchEvent(new Event('input',{bubbles:true}));await wait(50);return 'phone error'})()`
    )
    await capture('phone-pair-error')
    await evalLong(
      `(async()=>{${prelude}const modal=visible('.abele-pair').closest('.modal');const close=modal.closest('.modal-container').querySelector('.modal-close-button, .modal-close, .modal-header-button, [aria-label="Close"]');if(!close)throw Error('Native modal dismiss control missing: '+[...modal.closest('.modal-container').querySelectorAll('button,.clickable-icon')].map(el=>el.className+' '+el.getAttribute('aria-label')).join('|'));close.click();await until(()=>!visible('.abele-pair'));(await placeMenu('Open a folder…')).click();await until(()=>visible('.abele-folder-picker'));return 'phone folder picker'})()`
    )
    await capture('phone-folder-picker')
    await evalLong(
      `(async()=>{${prelude}button(visible('.abele-folder-picker'),'Cancel').click();await until(()=>!visible('.abele-folder-picker'));return 'picker closed'})()`
    )
    await evalLong(
      `(async()=>{${prelude}const panel=visible('.abele-node-panel');[...panel.querySelectorAll('.tree-item-self')].find(r=>r.textContent.includes('sample.ts')).click();await until(()=>visible('.abele-file-view'));if(app.workspace.leftSplit.collapsed===false)throw Error('File did not close the drawer');return JSON.stringify({width:innerWidth,height:innerHeight})})()`
    )
    await capture('phone-diff')
    await checkDiffColours()
    await selectText('.abele-file-view .abele-diff__line_added .abele-diff__text')
    await capture('phone-diff-selection')
    await clearSelection()
    await checkFileSearch('phone')
    await evalLong(
      `(async()=>{${prelude}const view=app.workspace.getLeavesOfType('abele-node-file').find(l=>l.view.contentEl.contains(visible('.abele-file-view'))).view;view.file.mode.value='file';await until(()=>visible('.abele-file-view .cm-line'));return 'whole file'})()`
    )
    await checkCodeGeometry()
    await checkCodeCitation('phone')
    await checkFileRepositoryTools('phone', registration)
    await checkFileLineMenu('phone')
    await selectText('.abele-file-view .cm-line')
    await capture('phone-file-selection')
    await clearSelection()
    await evalLong(
      `(async()=>{${prelude}const model=api.NodePathService.getInstance().model(${JSON.stringify(registration)});window.__selectionTrustPlace=model.selected.value;await model.select(${JSON.stringify(ids.plain)});app.workspace.leftSplit.expand();await until(()=>visible('.abele-node-place__name')?.textContent==='plain-folder');return 'plain folder for trust'})()`
    )
    await evalLong(
      `(async()=>{${prelude}(await placeMenu('New chat here')).click();await until(()=>[...document.querySelectorAll('.suggestion-item')].some(i=>i.querySelector('.suggestion-title')?.textContent.trim()==='Test agent'));[...document.querySelectorAll('.suggestion-item')].find(i=>i.querySelector('.suggestion-title')?.textContent.trim()==='Test agent').click();await until(()=>[...document.querySelectorAll('.modal button')].some(b=>b.textContent.trim()==='Trust folder'));return 'phone trust prompt'})()`
    )
    await capture('phone-folder-trust')
    await evalLong(
      `(async()=>{${prelude}[...document.querySelectorAll('.modal button')].find(b=>b.textContent.trim()==='Cancel').click();await until(()=>!document.querySelector('.modal button.mod-warning'));return 'trust cancelled'})()`
    )
    await evalLong(
      `(async()=>{${prelude}await api.NodePathService.getInstance().model(${JSON.stringify(registration)}).select(window.__selectionTrustPlace);delete window.__selectionTrustPlace;app.workspace.leftSplit.collapse();return 'original folder restored'})()`
    )
    await evalLong(
      `(async()=>{${prelude}const model=api.NodePathService.getInstance().model(${JSON.stringify(registration)});await model.select(${JSON.stringify(ids.root)});const previousChat=api.ChatService.getInstance().activeTabId.value;app.workspace.leftSplit.expand();(await placeMenu('New chat here')).click();await until(()=>[...document.querySelectorAll('.suggestion-title')].some(el=>el.textContent.trim()==='Test agent'));[...document.querySelectorAll('.suggestion-item')].find(el=>el.querySelector('.suggestion-title')?.textContent.trim()==='Test agent').click();await until(()=>api.ChatService.getInstance().activeTabId.value!==previousChat&&app.workspace.leftSplit.collapsed&&visible('.abele-node-chat'));const chats=api.ChatService.getInstance(),presenter=chats.getNodeSession(chats.activeTabId.value);await until(()=>presenter?.binding.value?.target.worktree_id===${JSON.stringify(ids.root)});return 'new chat revealed from phone folder'})()`
    )
    await capture('phone-new-chat-here')
    await open('file', {
      path: 'src/sample.ts',
      debug: {
        conversationId: 'sample-debug-chat',
        sourceId: 'sample-source',
        debugSessionId: 'sample-debug',
        incarnation: 'sample-incarnation',
      },
    })
    await evalLong(
      `(async()=>{${prelude}app.workspace.leftSplit.collapse();try{await until(()=>visible('.abele-debug-source__margin'))}catch(error){throw Error(JSON.stringify(app.workspace.getLeavesOfType('abele-node-file').map(l=>({state:l.view.getState(),mode:l.view.file?.mode.value,error:l.view.file?.error.value,document:l.view.file?.document.value,html:l.view.contentEl.innerHTML.slice(0,1800)}))))};return 'phone debug margin'})()`
    )
    await capture('phone-file-debug-margin')
    await evalLong(
      `(async()=>{${prelude}const chats=api.ChatService.getInstance();const chat=chats.getAllSessions().find(s=>s.overrides.value.nodeScope?.some(scope=>scope.node_id===${JSON.stringify(rootTarget.nodeId)}));if(!chat){const expectedPath=${JSON.stringify(scopeBeforeReload.path)},file=expectedPath?app.vault.getAbstractFileByPath(expectedPath):null;throw Error('Scoped chat was not restored '+JSON.stringify({before:${JSON.stringify(scopeBeforeReload)},tabs:app.loadLocalStorage('abele-agent-tabs'),restoring:chats.restoringTabs,sessions:chats.getAllSessions().map(s=>({path:s.currentChatFile.value?.path,scope:s.overrides.value.nodeScope})),stored:file?(await app.vault.read(file)).split(String.fromCharCode(10)).flatMap(line=>{try{const record=JSON.parse(line);return record.k==='meta'?[record]:[]}catch{return[]}}).at(-1)?.overrides?.nodeScope:null}))}chats.switchTab(chat.id);await chats.revealSidebar({focus:false});await until(()=>visible('.abele-ai-chat .abele-chat-input__scope')?.getAttribute('aria-label')?.includes('worktree trunk'));return 'phone scoped chat'})()`
    )
    await capture('phone-chat-scope-header')
    await open('history')
    await evalLong(
      `(async()=>{${prelude}app.workspace.leftSplit.collapse();await until(()=>visible('.abele-history__row'));return 'phone history'})()`
    )
    await capture('phone-history')
    await evalLong(
      `(async()=>{${prelude}visible('.abele-history__row').click();await until(()=>visible('.abele-history__commit-head'));return 'phone commit'})()`
    )
    await checkMixedCommit()
    await capture('phone-commit')
    await open('file', { path: 'sample-image.png' })
    await evalLong(
      `(async()=>{${prelude}app.workspace.leftSplit.collapse();await until(()=>visible('.abele-file-view img.abele-image')?.naturalWidth===1);return 'phone image rendered'})()`
    )
    await capture('phone-image')
    await open(
      'chat',
      { sessionId, title: 'Sample fake chat' },
      { ...rootTarget, id: ids.external }
    )
    // Unlike a file, the chat lives in the foreground drawer. Keep it open while measuring.
    await evalLong(
      `(async()=>{${prelude}await until(()=>visible('.abele-worktree-chip')?.textContent.includes('topic'));return 'phone chat visible'})()`
    )
    await capture('phone-chat-before-navbar-check')
    await evalLong(
      `(async()=>{${prelude}await until(()=>visible('.abele-worktree-chip')?.textContent.includes('topic'));const toolbar=visible('.abele-node-chat .abele-chat-input__toolbar'),navbar=visible('.mobile-navbar');(${checkNodeChatGeometry.toString()})(toolbar.getBoundingClientRect(),navbar?.getBoundingClientRect()??null,{width:innerWidth,height:innerHeight},(x,y)=>!!navbar?.contains(document.elementFromPoint(x,y)));return 'phone chat'})()`
    )
    await capture('phone-chat')
    await open('editor', { path: 'src/sample.ts' })
    await evalLong(
      `(async()=>{${prelude}app.workspace.leftSplit.collapse();await until(()=>app.workspace.getLeavesOfType('abele-node-file').some(l=>l.view.getState().path==='src/sample.ts'&&l.view.getState().edit===true));if(app.workspace.getLeavesOfType('abele-node-editor').length)throw Error('The editor tab stayed an editor tab');await until(()=>visible('.abele-node-main .cm-content'));return 'phone editor'})()`
    )
    await checkCodeGeometry()
    await capture('phone-editor')
    await evalLong(
      `(async()=>{${prelude}app.workspace.leftSplit.expand();const model=api.NodePathService.getInstance().model(${JSON.stringify(registration)});await model.select(${JSON.stringify(ids.plain)});await until(()=>visible('.abele-node-place__name')?.textContent==='plain-folder');return 'phone plain'})()`
    )
    await capture('phone-plain')
    child.kill('SIGTERM')
    await new Promise<void>((resolve) => {
      if (child!.exitCode !== null) resolve()
      else child!.once('exit', () => resolve())
    })
    child = undefined
    await evalLong(
      `(async()=>{${prelude}await until(()=>nodes.connection(${JSON.stringify(registration)}).state.value!=='connected');if(!visible('.abele-file-tree_stale'))throw Error('Offline rows lost their retained state');return 'offline'})()`
    )
    await capture('phone-offline')
  } finally {
    try {
      await evalLong(
        `(async()=>{${prelude}for(const type of ['abele-node-sidebar','abele-node-file','abele-node-history','abele-node-chat','abele-node-editor'])for(const leaf of app.workspace.getLeavesOfType(type))leaf.detach();for(const id of ${JSON.stringify([registration, localRegistration].filter(Boolean))})nodes.remove(id);const old=${savedPreferences || '{}'};app.saveLocalStorage('abele-node-local-state-dir',old.directory);app.saveLocalStorage('abele-node-device-name',old.device);if(typeof old.aiEnabled==='boolean'){const config=api.AbeleConfig.getInstance();config.editSettings(()=>{config.ai.enabled=old.aiEnabled});await config.saveSettings()}app.workspace.requestSaveLayout();await wait(1000);return 'cleaned'})()`
      )
    } catch {
      /* The daemon and proxy must still stop after a failed shell probe. */
    }
    for (const socket of sockets) socket.destroy()
    await new Promise<void>((resolve) => proxy.close(() => resolve()))
    if (child && child.exitCode === null) {
      child.kill('SIGTERM')
      await new Promise<void>((resolve) => child!.once('exit', () => resolve()))
    }
    if (mobile) await reloadApp('app.emulateMobile(false)')
    await evalLong(
      `(async()=>{for(const type of ['abele-node-sidebar','abele-node-file','abele-node-history','abele-node-chat','abele-node-editor'])for(const leaf of app.workspace.getLeavesOfType(type))leaf.detach();app.workspace.requestSaveLayout();await new Promise(r=>setTimeout(r,1000));return 'desktop roots cleared'})()`
    )
    // The chat this file opened to give access from the row menu, so later files find the tabs
    // the vault started with.
    evalRaw(
      `(async()=>{const chats=window.__abeleTest.ChatService.getInstance();for(const s of chats.getAllSessions())if(String(s.chatTitle.value).startsWith('Sample Obsidian chat '))await chats.closeTab(s.id);return 'chat closed'})()`
    )
    evalRaw(
      `require('@electron/remote').getCurrentWindow().setContentSize(${oldSize[0]},${oldSize[1]});'restored'`
    )
    rmSync(dir, { recursive: true, force: true })
  }
}, 240000)
