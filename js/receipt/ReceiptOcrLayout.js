/** @param {string} tsv */
export function parseTsvLayout(tsv) {
  const rows = String(tsv || "").trim().split(/\r?\n/);
  if (rows.length < 2) return { words: [], lines: [] };
  const words = [];
  for (const row of rows.slice(1)) {
    const columns = row.split("\t");
    if (columns.length < 12 || Number(columns[0]) !== 5) continue;
    const text = columns.slice(11).join("\t").trim();
    if (!text) continue;
    const left = Number(columns[6]);
    const top = Number(columns[7]);
    const width = Number(columns[8]);
    const height = Number(columns[9]);
    words.push({
      text,
      confidence: Number(columns[10]),
      bbox: { x0: left, y0: top, x1: left + width, y1: top + height },
      lineKey: `${columns[2]}:${columns[3]}:${columns[4]}`,
    });
  }
  const groups = new Map();
  for (const word of words) {
    if (!groups.has(word.lineKey)) groups.set(word.lineKey, []);
    groups.get(word.lineKey).push(word);
  }
  const lines = [...groups.values()].map((lineWords) => {
    lineWords.sort((a, b) => a.bbox.x0 - b.bbox.x0);
    return {
      text: lineWords.map((word) => word.text).join(" "),
      words: lineWords,
      bbox: {
        x0: Math.min(...lineWords.map((word) => word.bbox.x0)),
        y0: Math.min(...lineWords.map((word) => word.bbox.y0)),
        x1: Math.max(...lineWords.map((word) => word.bbox.x1)),
        y1: Math.max(...lineWords.map((word) => word.bbox.y1)),
      },
    };
  }).sort((a, b) => a.bbox.y0 - b.bbox.y0 || a.bbox.x0 - b.bbox.x0);
  return { words, lines };
}

/** @param {Array<object>} blocks */
export function parseBlocksLayout(blocks) {
  const lines = [];
  const words = [];
  for (const block of blocks || []) {
    for (const paragraph of block.paragraphs || []) {
      for (const line of paragraph.lines || []) {
        const lineWords = (line.words || []).map((word) => ({
          text: word.text || "",
          confidence: Number(word.confidence || 0),
          bbox: word.bbox,
        })).filter((word) => word.text && word.bbox);
        if (!lineWords.length || !line.bbox) continue;
        words.push(...lineWords);
        lines.push({ text: String(line.text || "").trim(), words: lineWords, bbox: line.bbox });
      }
    }
  }
  lines.sort((a, b) => a.bbox.y0 - b.bbox.y0 || a.bbox.x0 - b.bbox.x0);
  return { words, lines };
}
