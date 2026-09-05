/** Bytes → hex, grouped in pairs. Reserved for phase 6's full hex-dump detail view too. */
export function toHexString(buffer: Buffer): string {
  return buffer
    .toString("hex")
    .replace(/(.{2})/g, "$1 ")
    .trim()
}

export function toHexPreview(buffer: Buffer, maxBytes = 32): string {
  const hex = toHexString(buffer.subarray(0, maxBytes))
  const truncated = buffer.length > maxBytes
  return `${hex}${truncated ? " …" : ""} (${buffer.length} bytes)`
}
