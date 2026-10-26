import pdfParse from 'pdf-parse';
import mammoth from 'mammoth';

/** Extrae texto plano de los formatos habituales. Imágenes escaneadas: OCR en fase 2. */
export async function extractText(data: Buffer, mimeType: string): Promise<string | null> {
  switch (mimeType) {
    case 'text/plain':
    case 'text/csv':
    case 'text/markdown':
      return data.toString('utf8');
    case 'application/pdf':
      return (await pdfParse(data)).text;
    case 'application/vnd.openxmlformats-officedocument.wordprocessingml.document':
      return (await mammoth.extractRawText({ buffer: data })).value;
    default:
      return null;
  }
}
