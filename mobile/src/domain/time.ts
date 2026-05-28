export function countWords(raw: string) {
  return String(raw || '')
    .replace(/!\[\[[^\]]+\]\]/g, ' ')
    .replace(/[`*_>#-]/g, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .length;
}
