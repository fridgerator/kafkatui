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

/** Classic offset/hex/ASCII-gutter dump of the whole buffer, for the detail view's raw toggle. */
export function toFullHexDump(buffer: Buffer): string {
  if (buffer.length === 0) return "(empty)"

  const lines: string[] = []
  for (let offset = 0; offset < buffer.length; offset += 16) {
    const chunk = buffer.subarray(offset, offset + 16)
    const hex = Array.from(chunk, (b) => b.toString(16).padStart(2, "0"))
      .join(" ")
      .padEnd(47)
    const ascii = Array.from(chunk, (b) => (b >= 32 && b < 127 ? String.fromCharCode(b) : "."))
      .join("")
    lines.push(`${offset.toString(16).padStart(8, "0")}  ${hex}  ${ascii}`)
  }
  return lines.join("\n")
}
