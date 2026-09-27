/**
 * A family from the fonts folder put into a book's page.
 *
 * Each chapter is its own document in its own frame, and a document only has the fonts it was
 * given, so every page gets the family's faces as it arrives. They are made from the file's bytes
 * (`FontFace` from an `ArrayBuffer`), not from a URL: the page's Content Security Policy
 * (`bookSafety.ts`) is left as it is, and WebKit on an iPhone takes them the same way.
 *
 * The page's own `FontFace` makes them where it can, so the faces belong to the page they are in.
 */

/** One face's file, read. */
export interface FaceData {
  path: string
  weight: string
  style: 'normal' | 'italic'
  /** Changes when the file does: the same path and stamp is the same face. */
  stamp: string
  data: ArrayBuffer
}

interface Placed {
  key: string
  faces: FontFace[]
}

const placed = new WeakMap<Document, Placed>()
/** The latest change asked of each page: an earlier one still loading gives way to it. */
const asked = new WeakMap<Document, number>()
let counter = 0

const keyOf = (family: string, faces: FaceData[]) =>
  family && faces.length
    ? `${family}\n${faces
        .map((f) => `${f.path}|${f.stamp}|${f.weight}|${f.style}`)
        .sort()
        .join('\n')}`
    : ''

/**
 * Puts a family's faces into a page, in place of any this put in before; an empty family, or no
 * faces, takes them out. The faces may still be being read: the latest call for a page wins all
 * the same. Resolves once they are ready to draw with: true when the page's fonts changed — and
 * its text needs laying out again — and false when it already had these, or a later call took
 * over, or the page closed.
 */
export async function setDocumentFonts(
  doc: Document,
  family: string,
  pending: FaceData[] | Promise<FaceData[]>
): Promise<boolean> {
  const token = ++counter
  asked.set(doc, token)
  const faces = await pending
  const win = doc.defaultView as (Window & { FontFace?: typeof FontFace }) | null
  // The set's own `add` and `delete`, which this TypeScript's DOM types leave out.
  const fonts = doc.fonts as unknown as
    | { add(face: FontFace): void; delete(face: FontFace): boolean }
    | undefined
  if (!win || !fonts || asked.get(doc) !== token) return false
  const key = keyOf(family, faces)
  const before = placed.get(doc)
  if ((before?.key ?? '') === key) return false
  const Face = win.FontFace ?? window.FontFace
  const made: FontFace[] = []
  if (family && Face)
    for (const f of faces)
      try {
        made.push(new Face(family, f.data, { weight: f.weight, style: f.style }))
      } catch (e) {
        console.warn(`[Abele] ${f.path} could not be used as a font`, e)
      }
  const ready = await Promise.all(
    made.map((face) =>
      face.loaded.then(
        () => face,
        (e: unknown): null => {
          console.warn(`[Abele] a font of ${family} could not be read`, e)
          return null
        }
      )
    )
  )
  if (asked.get(doc) !== token || !doc.defaultView) return false
  for (const old of placed.get(doc)?.faces ?? []) fonts.delete(old)
  const good = ready.filter((f): f is FontFace => !!f)
  for (const face of good) fonts.add(face)
  placed.set(doc, { key, faces: good })
  return true
}
