/**
 * Where the tier's pictures go. Each file names its directory (`abele-phone`, `abele-tablet`…);
 * a run that sets ABELE_E2E_SHOTS gets them all under that directory, so runs side by side —
 * several pool vaults, a phone run — keep their pictures apart. Without it they go to /tmp.
 *
 * Read when the file loads, in the test process; the path is then written into the page's code
 * as a string, since the pictures are saved from inside the app.
 */
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'

/**
 * The directory, made if it is not there: some pictures are written by the phone's driver
 * straight to a path, with nothing on the way to create it (the /tmp ones survived that only
 * because an earlier run had made them).
 */
export function shotDir(name: string): string {
  // A file name here would become a directory, and the picture written to it then fails.
  if (/\.(png|jpe?g|webp|gif)$/i.test(name))
    throw new Error(`shotDir('${name}'): that is a picture's name, not a directory's`)
  const root = process.env.ABELE_E2E_SHOTS
  const dir = join(root ? root : '/tmp', name)
  mkdirSync(dir, { recursive: true })
  return dir
}
