/**
 * An estimate of how many tokens a text costs a model, without shipping a tokenizer.
 *
 * The plugin talks to whatever OpenAI-compatible provider the person set up, so there is no
 * one vocabulary to count against, and a real BPE table is megabytes. This follows the shape
 * those tokenizers share instead: the text is cut the way cl100k/o200k pre-tokenize it (a word
 * with its leading space, a run of digits, a run of punctuation, whitespace), and each piece is
 * priced by what such a piece usually costs — a common Latin word is one token, a long one
 * about one per four letters, digits three to a token, other scripts about one per two and a
 * half letters. English prose comes out near the usual four characters a token. It is good for
 * comparing one form of a result with another, which is all it is used for; it is not a bill.
 */

const PIECE = /'(?:[sdmt]|ll|ve|re)| ?\p{L}+| ?\p{N}+| ?[^\s\p{L}\p{N}]+|\s+/gu
const LATIN = /^ ?[A-Za-z]+$/

export function estimateTokens(text: string): number {
  if (!text) return 0
  let tokens = 0
  for (const match of text.matchAll(PIECE)) {
    const piece = match[0]
    const bare = piece.startsWith(' ') ? piece.slice(1) : piece
    if (/^\s+$/.test(piece)) {
      tokens += 1
    } else if (LATIN.test(piece)) {
      tokens += bare.length <= 7 ? 1 : Math.ceil(bare.length / 4)
    } else if (/^\p{L}+$/u.test(bare)) {
      tokens += Math.ceil(bare.length / 2.5)
    } else if (/^\p{N}+$/u.test(bare)) {
      tokens += Math.ceil(bare.length / 3)
    } else {
      tokens += Math.ceil(bare.length / 2)
    }
  }
  return tokens
}
