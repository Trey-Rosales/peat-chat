export function initialsFor(senderName: string, sender: string): string {
  const trimmed = senderName.trim()
  if (trimmed.length > 0) {
    const letters = trimmed
      .split(/\s+/)
      .map((w) => w[0])
      .filter(Boolean)
      .slice(0, 2)
      .join('')
      .toUpperCase()
    if (letters.length > 0) return letters
  }
  if (sender.length > 0) return sender.slice(0, 2).toUpperCase()
  return '?'
}
