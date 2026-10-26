import { chunkText } from './chunker';

describe('chunkText', () => {
  it('agrupa párrafos chicos en un chunk', () => {
    expect(chunkText('a\n\nb\n\nc')).toHaveLength(1);
  });

  it('parte textos largos y antepone el encabezado', () => {
    const long = Array.from({ length: 50 }, (_, i) => `Párrafo ${i} `.repeat(40)).join('\n\n');
    const chunks = chunkText(long, 200, 20, 'Ficha técnica: Pimentón');
    expect(chunks.length).toBeGreaterThan(5);
    expect(chunks.every((c) => c.content.startsWith('Ficha técnica: Pimentón'))).toBe(true);
  });
});
