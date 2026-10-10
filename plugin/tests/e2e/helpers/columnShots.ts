import { evalRawIdempotent } from './obsidianCli'
import { onPhone } from './target'
import { screenshot } from './phone'

/** Capturing pixels is idempotent; never replay the surrounding render or input action. */
export function columnShot(path: string): void {
  if (onPhone()) {
    screenshot(path)
    return
  }
  const result = evalRawIdempotent(`(async()=>{
    const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
    for(let i=0;i<3;i++){
      const image=await Promise.race([
        require('@electron/remote').getCurrentWindow().webContents.capturePage(),
        wait(8000).then(()=>null),
      ]);
      if(image){require('fs').writeFileSync(${JSON.stringify(path)},image.toPNG());return true}
    }
    throw Error('the column screenshot did not arrive');
  })()`)
  if (result !== 'true') throw Error(result)
}
