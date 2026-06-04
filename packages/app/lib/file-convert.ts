import mammoth from 'mammoth';
import * as XLSX from 'xlsx';
import JSZip from 'jszip';

/**
 * Decode a data URL to a Buffer.
 * Input format: data:<mediaType>;base64,<base64data>
 */
function decodeDataUrl(dataUrl: string): Buffer | null {
  const marker = ';base64,';
  const idx = dataUrl.indexOf(marker);
  if (idx === -1) return null;
  const base64 = dataUrl.slice(idx + marker.length).replace(/\s/g, '');
  return Buffer.from(base64, 'base64');
}

/**
 * Convert docx buffer to text.
 */
async function convertDocx(buf: Buffer): Promise<string> {
  const result = await mammoth.extractRawText({ buffer: buf });
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
 * Extract text content from a pptx buffer by parsing slide XML.
 * Each slide becomes a section with extracted text paragraphs.
 */
async function convertPptx(buf: Buffer): Promise<string> {
  const zip = await JSZip.loadAsync(buf);
  const sections: string[] = [];

  // Collect slide files (ppt/slides/slide1.xml, slide2.xml, ...)
  const slideFiles = Object.keys(zip.files)
    .filter((name) => /^ppt\/slides\/slide\d+\.xml$/.test(name))
    .sort((a, b) => {
      const na = parseInt(a.match(/slide(\d+)\.xml$/)![1]);
      const nb = parseInt(b.match(/slide(\d+)\.xml$/)![1]);
      return na - nb;
    });

  for (const slideFile of slideFiles) {
    const xml = await zip.file(slideFile)!.async('string');
    // Extract text from <a:t> tags (text runs in PowerPoint XML)
    const texts: string[] = [];
    const regex = /<a:t>([^<]*)<\/a:t>/g;
    let match;
    while ((match = regex.exec(xml)) !== null) {
      const t = match[1].trim();
      if (t) texts.push(t);
    }
    if (texts.length === 0) continue;

    const slideNum = slideFile.match(/slide(\d+)\.xml/)![1];
    sections.push(`### 幻灯片 ${slideNum}\n\n${texts.join('\n')}`);
  }

  return sections.join('\n\n') || '(空演示文稿)';
}

/**
 * MIME types that can be converted to text.
 * Each converter takes a Buffer and returns text content.
 */
const CONVERTERS: Record<string, (buf: Buffer) => Promise<string>> = {
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': convertDocx,
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': convertXlsx,
  'application/vnd.ms-excel': convertXlsx,
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': convertPptx,
  'application/vnd.ms-powerpoint': convertPptx,
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
