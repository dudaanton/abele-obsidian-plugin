import { execFileSync } from 'node:child_process'
export const CAPTURE_CLIPBOARD = `ObjC.import('AppKit');const pb=$.NSPasteboard.generalPasteboard,items=pb.pasteboardItems,result=[];for(let i=0;i<(items?items.count:0);i++){const item=items.objectAtIndex(i),types=item.types,row=[];for(let j=0;j<types.count;j++){const type=types.objectAtIndex(j),data=item.dataForType(type);if(!data)throw new Error('Clipboard format cannot be preserved');row.push([ObjC.unwrap(type),ObjC.unwrap(data.base64EncodedStringWithOptions(0))]);}result.push(row);}JSON.stringify(result);`
export const RESTORE_CLIPBOARD = `ObjC.import('AppKit');ObjC.import('Foundation');const data=$.NSFileHandle.fileHandleWithStandardInput.readDataToEndOfFile,raw=ObjC.unwrap($.NSString.alloc.initWithDataEncoding(data,$.NSUTF8StringEncoding)),rows=JSON.parse(raw),items=[];for(const row of rows){const item=$.NSPasteboardItem.alloc.init;for(const [type,bytes] of row){const data=$.NSData.alloc.initWithBase64EncodedStringOptions($(bytes),0);if(!item.setDataForType(data,$(type)))throw new Error('Clipboard format restore failed');}items.push(item);}const pb=$.NSPasteboard.generalPasteboard;pb.clearContents;if(items.length&&!pb.writeObjects($(items)))throw new Error('Clipboard item restore failed');true;`
/** Read/write every native pasteboard item/type in one transaction. Electron writeBuffer()
 * creates a new clipboard writer per call, so a loop can silently retain only the last format.
 * Private bytes remain in this process and the restore stdin, never argv/logs/files/reports.
 */
function clipboardCode(code: string, name?: string) {
  if (!name) return code
  if (!/^abele-clipboard-fixture-[a-f0-9-]+$/.test(name))
    throw new Error('Non-owned named clipboard refused')
  return code.replace(
    '$.NSPasteboard.generalPasteboard',
    `$.NSPasteboard.pasteboardWithName($(${JSON.stringify(name)}))`
  )
}
export function captureNativeClipboard(name?: string): string {
  try {
    return execFileSync(
      'osascript',
      ['-l', 'JavaScript', '-e', clipboardCode(CAPTURE_CLIPBOARD, name)],
      {
        encoding: 'utf8',
        timeout: 10000,
        stdio: ['pipe', 'pipe', 'pipe'],
      }
    ).trim()
  } catch {
    throw new Error('Native clipboard archive capture failed')
  }
}
export function restoreNativeClipboard(archive: string, name?: string): void {
  try {
    execFileSync('osascript', ['-l', 'JavaScript', '-e', clipboardCode(RESTORE_CLIPBOARD, name)], {
      input: archive,
      encoding: 'utf8',
      timeout: 10000,
      stdio: ['pipe', 'pipe', 'pipe'],
    })
    if (!sameNativeClipboard(archive, captureNativeClipboard(name))) throw new Error()
  } catch {
    throw new Error('Native clipboard exact restoration failed')
  }
}
export function sameNativeClipboard(left: string, right: string): boolean {
  const canonical = (raw: string) =>
    JSON.stringify(
      (JSON.parse(raw) as [string, string][][]).map((item) =>
        [...item].sort(([a], [b]) => a.localeCompare(b))
      )
    )
  return canonical(left) === canonical(right)
}
