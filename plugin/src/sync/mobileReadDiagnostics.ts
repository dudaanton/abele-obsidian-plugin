// Device-local scalar counters only; no paths, contents, or durable state.
const counters = {
  streams: 0,
  wholeReads: 0,
  chunks: 0,
  bytesRead: 0,
  discardedBytes: 0,
  restarts: 0,
  activeStreams: 0,
  retainedBytes: 0,
  peakRetainedBytes: 0,
  peakReaderBytes: 0,
  maxChunkBytes: 0,
  oversizedChunks: 0,
  maxOutputBytes: 0,
}
export const mobileReadSnapshot = () => ({ ...counters })
export function mobileReadMeter() {
  let held = 0,
    active = false
  return {
    wholeRead() {
      counters.wholeReads++
    },
    opened() {
      counters.streams++
      counters.activeStreams++
      active = true
    },
    closed() {
      if (active) counters.activeStreams--
      active = false
    },
    hold(bytes: number) {
      counters.retainedBytes += bytes - held
      held = bytes
      counters.peakReaderBytes = Math.max(counters.peakReaderBytes, held)
      counters.peakRetainedBytes = Math.max(counters.peakRetainedBytes, counters.retainedBytes)
    },
    chunk(bytes: number, backing: number, limit: number) {
      counters.chunks++
      counters.bytesRead += bytes
      counters.maxChunkBytes = Math.max(counters.maxChunkBytes, backing)
      if (backing > limit) counters.oversizedChunks++
    },
    output(bytes: number) {
      counters.maxOutputBytes = Math.max(counters.maxOutputBytes, bytes)
    },
    skip(bytes: number) {
      counters.discardedBytes += bytes
    },
    restart() {
      counters.restarts++
    },
  }
}
