/** A deliberately broad bucket for the supported volume name policies. False
 * positives are filtered with the actual host policy; aliases must never be missed. */
export const portableCandidateKey = (path: string): string =>
  path
    .normalize('NFC')
    .split('/')
    .map((part) => part.replace(/[. ]+$/, '').toLowerCase())
    .join('/')
export const PORTABLE_CANDIDATES = Symbol.for('abele.sync.portable-candidates-v1')
