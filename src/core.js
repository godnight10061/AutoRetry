/**
 * Returns true when `text` contains at least one `<正文>...</正文>` pair whose inner
 * content, after trimming whitespace, is non-empty.
 * @param {unknown} text
 */
export function hasValidZhengwenTag(text) {
  if (typeof text !== 'string') return false;

  const regex = /<(正文|game)>([\s\S]*?)<\/\1>/g;
  for (let match = regex.exec(text); match !== null; match = regex.exec(text)) {
    const inner = match[2];
    if (typeof inner === 'string' && inner.trim().length > 0) {
      return true;
    }
  }

  return false;
}
