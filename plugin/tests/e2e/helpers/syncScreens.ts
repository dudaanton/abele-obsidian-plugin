import type { SyncDriver } from './syncDriver'
import { probePrelude, type Screen } from './layoutProbe'
import { shotDir } from './shots'
/** Real dialogs, measured in their own owner document. No synthetic UI components. */
export async function captureSyncScreen(
  sync: SyncDriver,
  label: string,
  selector?: string
): Promise<Screen> {
  return sync.long(
    'capture ' + label,
    `
 ${probePrelude(shotDir('abele-token-screens'))}
 const root=${selector?.startsWith('title:') ? 'modal(' + JSON.stringify(selector.slice(6)) + ')' : selector ? 'settingsDoc().querySelector(' + JSON.stringify(selector) + ')||document.querySelector(' + JSON.stringify(selector) + ')' : 'await openSyncTab()'}
 if(!root)throw new Error('Live screen unavailable')
 const owner=root.ownerDocument
 const sheet=root.closest('.modal')||root
 const result=await screen(${JSON.stringify(label)},sheet,sheet.querySelector('.abele-modal__body')||root)
 const buttons=[...sheet.querySelectorAll('.abele-modal__footer button')].filter(one=>one.getBoundingClientRect().width>0)
 result.width=owner.defaultView.innerWidth
 result.extra.buttons=buttons.length
 result.extra.buttonsInView=buttons.filter(one=>{const r=one.getBoundingClientRect();return r.left>=0&&r.top>=0&&r.right<=owner.defaultView.innerWidth+1&&r.bottom<=owner.defaultView.innerHeight+1}).length
 result.extra.onTop=buttons.every(one=>{const r=one.getBoundingClientRect();const hit=owner.elementFromPoint(r.left+r.width/2,r.top+r.height/2);return !!hit&&one.contains(hit)})
 result.extra.voids=[...sheet.querySelectorAll('.setting-item')].flatMap(row=>[...row.querySelectorAll('.setting-item-info,.setting-item-control')].filter(one=>{const boxes=[...one.children].map(child=>child.getBoundingClientRect()).filter(box=>box.height>0);return boxes.length&&one.getBoundingClientRect().height-(Math.max(...boxes.map(box=>box.bottom))-Math.min(...boxes.map(box=>box.top)))>4}).map(one=>one.className))
 return result
 `
  )
}
export function closeSyncScreens(sync: SyncDriver): void {
  sync.run(
    `for(const doc of new Set([document,settingsDoc()]))for(const button of [...doc.querySelectorAll('.modal-close-button, .modal-header-button:has(svg.lucide-x)')].reverse())button.click();await closeSettings();return true`
  )
}
