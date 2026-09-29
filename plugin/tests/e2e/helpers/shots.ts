/**
 * Where the tier's pictures go. Each file names its directory (`abele-phone`, `abele-tablet`…);
 * a run that sets ABELE_E2E_SHOTS gets them all under that directory, so runs side by side —
 * several pool vaults, a phone run — keep their pictures apart. Without it they go to /tmp.
 *
 * Read when the file loads, in the test process; the path is then written into the page's code
 * as a string, since the pictures are saved from inside the app.
 */
import { join } from 'node:path'

export function shotDir(name: string): string {
  const root = process.env.ABELE_E2E_SHOTS
  return join(root ? root : '/tmp', name)
}
