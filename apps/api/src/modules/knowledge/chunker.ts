export interface Chunk {
  ordinal: number;
  content: string;
  tokenCount: number;
}

const CHARS_PER_TOKEN = 4; // aproximación para español

/**
 * Corta por párrafos respetando un tamaño objetivo (~500 tokens) con solapamiento,
 * para que una tabla de especificaciones o un párrafo de certificado no quede partido sin contexto.
 */
export function chunkText(text: string, targetTokens = 500, overlapTokens = 60, header = ''): Chunk[] {
  const target = targetTokens * CHARS_PER_TOKEN;
  const overlap = overlapTokens * CHARS_PER_TOKEN;
  const paragraphs = text
    .replace(/\r/g, '')
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean);

  const chunks: string[] = [];
  let current = '';
  for (const p of paragraphs) {
    if (current && current.length + p.length > target) {
      chunks.push(current);
      current = current.slice(-overlap);
    }
    if (p.length > target) {
      for (let i = 0; i < p.length; i += target - overlap) chunks.push(p.slice(i, i + target));
      current = '';
      continue;
    }
    current = current ? `${current}\n\n${p}` : p;
  }
  if (current.trim()) chunks.push(current);

  return chunks.map((c, ordinal) => {
    const content = header ? `${header}\n\n${c}` : c;
    return { ordinal, content, tokenCount: Math.ceil(content.length / CHARS_PER_TOKEN) };
  });
}
