import mammoth from 'mammoth';
import * as XLSX from 'xlsx';

/**
 * Decode a data URL to a Buffer.
 * Input format: data:<mediaType>;base64,<base64data>
 */
function decodeDataUrl(dataUrl: string): Buffer | null {
  const match = dataUrl.match(/^data:[^;]+;base64,(.+)$/);
  if (!match) return null;
  return Buffer.from(match[1], 'base64');
}

/**
 * Convert docx buffer to markdown text.
 */
async function convertDocx(buf: Buffer): Promise<string> {
  const result = await mammoth.convertToMarkdown({ buffer: buf });
  return result.value;
}

/**
 * Convert xlsx/xls buffer to markdown table text.
 * Each sheet becomes a section with a header.
 */
async function convertXlsx(buf: Buffer): Promise<string> {
  const workbook = XLSX.read(buf, { type: 'buffer' });
  const sections: string[] = [];

  for (const sheetName of workbook.SheetNames) {
    const sheet = workbook.Sheets[sheetName];
    const rows: (string | number | boolean | null)[][] = XLSX.utils.sheet_to_json(sheet, {
      header: 1,
      defval: '',
    });
    if (rows.length === 0) continue;

    const header = rows[0].map(String);
    const separator = header.map(() => '---');
    const dataRows = rows.slice(1).map((r) => r.map(String));

    const tableRows = [header, separator, ...dataRows];
    sections.push(
      `### ${sheetName}\n\n` +
      tableRows.map((r) => `| ${r.join(' | ')} |`).join('\n')
    );
  }

  return sections.join('\n\n') || '(空工作簿)';
}

/**
 * MIME types that can be converted to text.
 * Each converter takes a Buffer and returns text content.
 */
const CONVERTERS: Record<string, (buf: Buffer) => Promise<string>> = {
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': convertDocx,
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': convertXlsx,
  'application/vnd.ms-excel': convertXlsx,
};

/**
 * Supported convertible MIME types list (for frontend accept filter).
 */
export const CONVERTIBLE_MIME_TYPES = Object.keys(CONVERTERS);

/**
 * Try to convert a file part to text.
 * Returns the converted text, or null if the type is not convertible or conversion fails.
 */
export async function convertFileToText(
  dataUrl: string,
  mediaType: string
): Promise<string | null> {
  const converter = CONVERTERS[mediaType];
  if (!converter) return null;

  const buf = decodeDataUrl(dataUrl);
  if (!buf) return null;

  try {
    return await converter(buf);
  } catch (err) {
    console.error(`[FileConvert] Failed to convert ${mediaType}:`, err);
    return null;
  }
}
