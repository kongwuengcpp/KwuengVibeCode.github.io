import JSZip from 'jszip';
import mammoth from 'mammoth';

export const MAX_IMAGE_SIDE = 1280;
export const MAX_SINGLE_IMAGE_BYTES = 180_000;
export const MAX_TOTAL_IMAGE_BYTES = 650_000;
const MIN_IMAGE_BUDGET_BYTES = 30_000;

export const COMPRESS_STEPS = [
  { side: 1280, quality: 0.72 },
  { side: 1024, quality: 0.6 },
  { side: 800, quality: 0.5 },
  { side: 600, quality: 0.45 },
  { side: 480, quality: 0.4 },
];

const SUPPORTED_RASTER_EXTS = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp']);
const SUPPORTED_IMAGE_EXTS = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'svg']);

// A clean, lightweight SVG historical timeline diagram encoded as a data URI for sample questions
export const SAMPLE_QUESTION_DIAGRAM_DATA_URI =
  'data:image/svg+xml;utf8,' +
  encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" width="680" height="180" viewBox="0 0 680 180">
      <rect width="680" height="180" rx="12" fill="#f8fafc" stroke="#cbd5e1" stroke-width="1.5"/>
      <text x="340" y="34" text-anchor="middle" font-family="sans-serif" font-size="14" font-weight="bold" fill="#0f172a">SƠ ĐỒ TIẾN TRÌNH CÁC CUỘC CÁCH MẠNG TƯ SẢN TIÊU BIỂU (THẾ KỈ XVI - XVIII)</text>
      <line x1="60" y1="100" x2="620" y2="100" stroke="#22c55e" stroke-width="4" stroke-linecap="round"/>
      <circle cx="110" cy="100" r="10" fill="#16a34a"/>
      <text x="110" y="78" text-anchor="middle" font-family="sans-serif" font-size="12" font-weight="bold" fill="#16a34a">1566</text>
      <text x="110" y="132" text-anchor="middle" font-family="sans-serif" font-size="12" fill="#334155">CMTS Hà Lan</text>
      <circle cx="265" cy="100" r="10" fill="#16a34a"/>
      <text x="265" y="78" text-anchor="middle" font-family="sans-serif" font-size="12" font-weight="bold" fill="#16a34a">1640</text>
      <text x="265" y="132" text-anchor="middle" font-family="sans-serif" font-size="12" fill="#334155">CMTS Anh</text>
      <circle cx="420" cy="100" r="10" fill="#16a34a"/>
      <text x="420" y="78" text-anchor="middle" font-family="sans-serif" font-size="12" font-weight="bold" fill="#16a34a">1776</text>
      <text x="420" y="132" text-anchor="middle" font-family="sans-serif" font-size="12" fill="#334155">Độc lập Bắc Mỹ</text>
      <circle cx="570" cy="100" r="10" fill="#16a34a"/>
      <text x="570" y="78" text-anchor="middle" font-family="sans-serif" font-size="12" font-weight="bold" fill="#16a34a">1789</text>
      <text x="570" y="132" text-anchor="middle" font-family="sans-serif" font-size="12" fill="#334155">CMTS Pháp (?)</text>
    </svg>`
  );

export interface DocxExtractResult {
  text: string;
  imageCount: number;
  skippedImages: number;
  warnings: string[];
}

export interface ParsedRelationship {
  id: string;
  type: string;
  target: string;
  targetMode?: string;
}

/**
 * Strips <mc:Fallback>...</mc:Fallback> blocks so images inside <mc:AlternateContent>
 * are not extracted twice (once from mc:Choice and once from mc:Fallback).
 */
export function stripMcFallbackBlocks(xml: string): string {
  return xml.replace(/<mc:Fallback\b[\s\S]*?<\/mc:Fallback>/gi, '');
}

/**
 * Extracts image relationship IDs (rId) referenced by <a:blip> or <v:imagedata> in order of appearance.
 * Ignores <w:hyperlink r:id="..."> and other non-image relationships.
 */
export function extractImageRIdsFromXmlFragment(xmlFragment: string): string[] {
  const cleaned = stripMcFallbackBlocks(xmlFragment);
  const regex = new RegExp(
    '<(?:a:blip|v:imagedata)\\b[^>]*?\\br:(?:embed|id)\\s*=\\s*(["\'])([^"\']+)\\1',
    'gi'
  );
  const result: string[] = [];
  const seen = new Set<string>();
  let match: RegExpExecArray | null;
  while ((match = regex.exec(cleaned)) !== null) {
    const rId = match[2]?.trim();
    if (rId && !seen.has(rId)) {
      seen.add(rId);
      result.push(rId);
    }
  }
  return result;
}

/**
 * Normalizes a relationship Target path inside a .docx archive to a clean zip-relative path (e.g. `word/media/image1.png`).
 */
export function normalizeDocxTargetPath(rawTarget: string): string {
  const cleaned = rawTarget
    .trim()
    .replace(/\\/g, '/')
    .replace(/^\/+/, '')
    .replace(/^(?:\.\.?\/)+/, '');
  if (!cleaned) return '';
  return cleaned.startsWith('word/') ? cleaned : `word/${cleaned}`;
}

/**
 * Parses word/_rels/document.xml.rels regardless of attribute ordering,
 * returning only internal image relationships.
 */
export function parseImageRelationshipsXml(relsXml: string): Map<string, ParsedRelationship> {
  const map = new Map<string, ParsedRelationship>();
  const tagRegex = /<Relationship\b[^>]*\/?>/gi;
  let tagMatch: RegExpExecArray | null;

  while ((tagMatch = tagRegex.exec(relsXml)) !== null) {
    const tag = tagMatch[0];
    const idMatch = tag.match(/\bId\s*=\s*(["'])(.*?)\1/i);
    const typeMatch = tag.match(/\bType\s*=\s*(["'])(.*?)\1/i);
    const targetMatch = tag.match(/\bTarget\s*=\s*(["'])(.*?)\1/i);
    const modeMatch = tag.match(/\bTargetMode\s*=\s*(["'])(.*?)\1/i);

    if (!idMatch || !targetMatch) continue;
    const id = idMatch[2].trim();
    const type = typeMatch ? typeMatch[2].trim() : '';
    const target = targetMatch[2].trim();
    const targetMode = modeMatch ? modeMatch[2].trim() : undefined;

    if (!id || !target) continue;
    if (targetMode && targetMode.toLowerCase() === 'external') continue;
    // If Type attribute is present, only accept relationships ending with /image
    if (type && !/\/image$/i.test(type)) continue;

    map.set(id, { id, type, target, targetMode });
  }

  return map;
}

function getMimeFromExt(ext: string): string {
  switch (ext) {
    case 'jpg':
    case 'jpeg':
      return 'image/jpeg';
    case 'svg':
      return 'image/svg+xml';
    case 'gif':
      return 'image/gif';
    case 'webp':
      return 'image/webp';
    case 'bmp':
      return 'image/bmp';
    default:
      return 'image/png';
  }
}

async function renderDataUriAtStep(
  dataUri: string,
  maxSide: number,
  quality: number
): Promise<string | null> {
  if (typeof window === 'undefined' || typeof document === 'undefined') {
    return null;
  }

  // Try createImageBitmap first for lower memory overhead
  if (typeof createImageBitmap === 'function' && typeof fetch === 'function') {
    try {
      const res = await fetch(dataUri);
      const blob = await res.blob();
      const bitmap = await createImageBitmap(blob);
      try {
        let w = bitmap.width || 600;
        let h = bitmap.height || 400;
        if (w > maxSide || h > maxSide) {
          if (w >= h) {
            h = Math.max(1, Math.round((h * maxSide) / w));
            w = maxSide;
          } else {
            w = Math.max(1, Math.round((w * maxSide) / h));
            h = maxSide;
          }
        }
        const canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext('2d');
        if (!ctx) return null;
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, w, h);
        ctx.drawImage(bitmap, 0, 0, w, h);
        return canvas.toDataURL('image/jpeg', quality);
      } finally {
        bitmap.close();
      }
    } catch {
      // Fallback to HTMLImageElement below
    }
  }

  return new Promise<string | null>((resolve) => {
    const img = new Image();
    img.onload = () => {
      try {
        let w = img.naturalWidth || img.width || 600;
        let h = img.naturalHeight || img.height || 400;
        if (w > maxSide || h > maxSide) {
          if (w >= h) {
            h = Math.max(1, Math.round((h * maxSide) / w));
            w = maxSide;
          } else {
            w = Math.max(1, Math.round((w * maxSide) / h));
            h = maxSide;
          }
        }
        const canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          resolve(null);
          return;
        }
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, w, h);
        ctx.drawImage(img, 0, 0, w, h);
        resolve(canvas.toDataURL('image/jpeg', quality));
      } catch {
        resolve(null);
      }
    };
    img.onerror = () => resolve(null);
    img.src = dataUri;
  });
}

/**
 * Compresses a base64 image data URI in the browser using progressive COMPRESS_STEPS
 * until its length is <= maxBytes (default MAX_SINGLE_IMAGE_BYTES = 180_000).
 * Notice: if the caller passes a small number like 840 (legacy maxWidth), we treat values <= 4096 as maxSide
 * and values > 4096 as maxBytes cap!
 */
export async function compressImageDataUriIfNeeded(
  dataUri: string,
  maxBytesOrWidth = MAX_SINGLE_IMAGE_BYTES,
  initialQuality = 0.72
): Promise<string> {
  if (
    !dataUri ||
    !dataUri.startsWith('data:image/') ||
    dataUri.startsWith('data:image/svg')
  ) {
    return dataUri;
  }

  const maxBytes = maxBytesOrWidth > 4096 ? maxBytesOrWidth : MAX_SINGLE_IMAGE_BYTES;
  const customMaxSide = maxBytesOrWidth <= 4096 ? maxBytesOrWidth : undefined;

  if (dataUri.length <= maxBytes && (!customMaxSide || dataUri.length < 45_000)) {
    return dataUri;
  }

  if (typeof window === 'undefined' || typeof document === 'undefined') {
    return dataUri;
  }

  let bestCandidate = dataUri;
  const steps = customMaxSide
    ? [{ side: customMaxSide, quality: initialQuality }, ...COMPRESS_STEPS]
    : COMPRESS_STEPS;

  for (const step of steps) {
    const candidate = await renderDataUriAtStep(dataUri, step.side, step.quality);
    if (candidate) {
      if (candidate.length < bestCandidate.length) {
        bestCandidate = candidate;
      }
      if (candidate.length <= maxBytes) {
        return candidate;
      }
    }
  }

  return bestCandidate;
}

/**
 * Extracts text, data tables (<w:tbl>), and embedded images from a .docx ArrayBuffer with a detailed report,
 * enforcing per-image and total-exam image byte budgets.
 */
export async function extractDocxWithReport(
  arrayBuffer: ArrayBuffer,
  options?: {
    maxTotalImageBytes?: number;
    maxSingleImageBytes?: number;
    onProgress?: (current: number, total: number) => void;
  }
): Promise<DocxExtractResult> {
  const warnings: string[] = [];
  let imageCount = 0;
  let skippedImages = 0;
  const maxTotalBytes = options?.maxTotalImageBytes ?? MAX_TOTAL_IMAGE_BYTES;
  const maxSingleBytes = options?.maxSingleImageBytes ?? MAX_SINGLE_IMAGE_BYTES;

  try {
    const zip = await JSZip.loadAsync(arrayBuffer);
    const docXmlFile = zip.file('word/document.xml');
    if (docXmlFile) {
      const xmlText = await docXmlFile.async('string');
      const cleanedXml = stripMcFallbackBlocks(xmlText);
      const referencedRIds = extractImageRIdsFromXmlFragment(cleanedXml);

      const relIdToDataUri: Record<string, string> = {};
      const relsFile = zip.file('word/_rels/document.xml.rels');

      if (relsFile && referencedRIds.length > 0) {
        const relsXml = await relsFile.async('string');
        const relMap = parseImageRelationshipsXml(relsXml);

        // Identify unique valid image targets actually referenced in document.xml
        interface PendingImageTask {
          mediaPath: string;
          ext: string;
          rIds: string[];
        }
        const pathToTask = new Map<string, PendingImageTask>();

        for (const rId of referencedRIds) {
          const rel = relMap.get(rId);
          if (!rel) continue;
          const mediaPath = normalizeDocxTargetPath(rel.target);
          const ext = (mediaPath.split('.').pop() || '').toLowerCase();

          if (!SUPPORTED_IMAGE_EXTS.has(ext)) {
            skippedImages++;
            warnings.push(
              `Ảnh "${mediaPath.split('/').pop() || mediaPath}" có định dạng .${ext || 'lạ'} không được hỗ trợ. Hãy mở Word và chèn lại ảnh dạng PNG hoặc JPG.`
            );
            continue;
          }

          const existing = pathToTask.get(mediaPath);
          if (existing) {
            existing.rIds.push(rId);
          } else {
            pathToTask.set(mediaPath, { mediaPath, ext, rIds: [rId] });
          }
        }

        const tasks = Array.from(pathToTask.values());
        let remainingBudget = maxTotalBytes;

        for (let i = 0; i < tasks.length; i++) {
          const task = tasks[i];
          const remainingImages = tasks.length - i;
          options?.onProgress?.(i + 1, tasks.length);

          const mediaFile = zip.file(task.mediaPath);
          if (!mediaFile) {
            skippedImages++;
            warnings.push(
              `Không tìm thấy dữ liệu ảnh "${task.mediaPath}" bên trong file Word.`
            );
            continue;
          }

          if (remainingBudget < MIN_IMAGE_BUDGET_BYTES) {
            skippedImages++;
            warnings.push(
              `Ảnh ${i + 1} (${task.mediaPath.split('/').pop()}) bị bỏ qua vì tổng dung lượng ảnh của đề đã đạt trần cho phép (${Math.round(maxTotalBytes / 1024)} KB).`
            );
            continue;
          }

          const base64 = await mediaFile.async('base64');
          const mime = getMimeFromExt(task.ext);
          const rawUri = `data:${mime};base64,${base64}`;

          const cap = Math.min(
            maxSingleBytes,
            Math.max(
              MIN_IMAGE_BUDGET_BYTES,
              Math.floor(remainingBudget / Math.max(1, remainingImages))
            )
          );

          let finalUri = rawUri;
          if (rawUri.length > cap && SUPPORTED_RASTER_EXTS.has(task.ext)) {
            finalUri = await compressImageDataUriIfNeeded(rawUri, cap);
          }

          if (finalUri.length > remainingBudget || finalUri.length > maxSingleBytes) {
            skippedImages++;
            warnings.push(
              `Ảnh ${i + 1} (${task.mediaPath.split('/').pop()}, ~${Math.round(finalUri.length / 1024)} KB) vượt ngân sách dung lượng ảnh còn lại (${Math.round(Math.min(remainingBudget, maxSingleBytes) / 1024)} KB) nên đã được bỏ qua.`
            );
            continue;
          }

          for (const id of task.rIds) {
            relIdToDataUri[id] = finalUri;
          }
          remainingBudget -= finalUri.length;
          imageCount++;
        }
      }

      const parsedFromXml = parseWordDocumentXmlWithAnswerHighlights(cleanedXml, relIdToDataUri);
      if (parsedFromXml.trim().length > 0) {
        return {
          text: parsedFromXml,
          imageCount,
          skippedImages,
          warnings,
        };
      }
    }
  } catch {
    // Fallback to mammoth below
  }

  warnings.push(
    'File Word được đọc ở chế độ văn bản thuần (mammoth): không có ảnh và không tự nhận diện đáp án gạch chân/tô màu.'
  );
  const rawResult = await mammoth.extractRawText({ arrayBuffer });
  return {
    text: rawResult.value || '',
    imageCount: 0,
    skippedImages,
    warnings,
  };
}

/**
 * Backwards-compatible wrapper that returns the extracted text string.
 */
export async function extractTextFromDocxBuffer(arrayBuffer: ArrayBuffer): Promise<string> {
  const report = await extractDocxWithReport(arrayBuffer);
  return report.text;
}

function extractParagraphContent(
  pContent: string,
  relIdToDataUri: Record<string, string>
): { text: string; embeddedImageUris: string[] } {
  const cleanedP = stripMcFallbackBlocks(pContent);
  const rIds = extractImageRIdsFromXmlFragment(cleanedP);
  const embeddedImageUris = rIds
    .map((id) => relIdToDataUri[id])
    .filter((uri): uri is string => Boolean(uri));

  // Match non-self-closing <w:r>...</w:r> elements
  const rRegex = /<w:r(?:\s(?:[^>]*[^/>])?)?>([\s\S]*?)<\/w:r>/g;
  let rMatch: RegExpExecArray | null;

  interface RunSegment {
    text: string;
    isEmphasized: boolean;
  }

  const runs: RunSegment[] = [];

  while ((rMatch = rRegex.exec(cleanedP)) !== null) {
    const rInner = rMatch[1];
    const tRegex = /<w:t(?:\s(?:[^>]*[^/>])?)?>([\s\S]*?)<\/w:t>/g;
    let tMatch: RegExpExecArray | null;
    let runText = '';
    while ((tMatch = tRegex.exec(rInner)) !== null) {
      runText += decodeXmlEntities(tMatch[1]);
    }
    if (/w:tab\b/.test(rInner)) {
      runText += '\t';
    }

    if (!runText) continue;

    const rPrMatch = rInner.match(/<w:rPr(?:\s(?:[^>]*[^/>])?)?>([\s\S]*?)<\/w:rPr>/);
    let isEmphasized = false;
    if (rPrMatch) {
      const rPr = rPrMatch[1];
      const hasUnderline = /<w:u\b(?![^>]*w:val="none")/.test(rPr);
      const hasHighlight = /<w:highlight\b(?![^>]*w:val="none")/.test(rPr);
      const colorMatch = rPr.match(/<w:color\b[^>]*w:val="([^"]+)"/i);
      const hasAccentColor = Boolean(
        colorMatch &&
          !['auto', '000000', '111111', '222222', '333333'].includes(
            colorMatch[1].toLowerCase()
          )
      );

      if (hasUnderline || hasHighlight || hasAccentColor) {
        isEmphasized = true;
      }
    }

    runs.push({ text: runText, isEmphasized });
  }

  let lineText = '';
  for (let i = 0; i < runs.length; i++) {
    const seg = runs[i];
    if (seg.isEmphasized && /^\s*([ABCDabcd])\s*[.)]/.test(seg.text)) {
      lineText += seg.text.replace(/^\s*([ABCDabcd])\s*([.)])/, ' *$1$2');
    } else if (
      seg.isEmphasized &&
      /^\s*([ABCDabcd])\s*$/.test(seg.text) &&
      i + 1 < runs.length &&
      /^\s*[.)]/.test(runs[i + 1].text)
    ) {
      lineText += ` *${seg.text.trim()}`;
    } else {
      lineText += seg.text;
    }
  }

  return {
    text: lineText.trim(),
    embeddedImageUris,
  };
}

/**
 * Scans XML in document order and yields top-level `<w:tbl>...</w:tbl>` (handling nested tables by depth)
 * and top-level non-self-closing `<w:p>...</w:p>` blocks (ignoring self-closing `<w:p .../>`).
 */
function extractTopLevelBlocks(xmlString: string): Array<{ type: 'tbl' | 'p'; content: string }> {
  const blocks: Array<{ type: 'tbl' | 'p'; content: string }> = [];
  const tokenRegex = /<(\/?)w:(tbl|p)(?:\s[^>]*|\s*)?>/g;
  let tblDepth = 0;
  let tblStartIdx = -1;
  let pStartInnerIdx = -1;

  let match: RegExpExecArray | null;
  while ((match = tokenRegex.exec(xmlString)) !== null) {
    const fullTag = match[0];
    const isClosing = match[1] === '/';
    const tagName = match[2]; // 'tbl' | 'p'
    const isSelfClosing = !isClosing && fullTag.endsWith('/>');

    if (tagName === 'tbl') {
      if (isSelfClosing) continue;
      if (!isClosing) {
        if (tblDepth === 0) {
          tblStartIdx = match.index;
          pStartInnerIdx = -1;
        }
        tblDepth++;
      } else if (tblDepth > 0) {
        tblDepth--;
        if (tblDepth === 0 && tblStartIdx >= 0) {
          blocks.push({
            type: 'tbl',
            content: xmlString.slice(tblStartIdx, match.index + fullTag.length),
          });
          tblStartIdx = -1;
        }
      }
    } else if (tagName === 'p' && tblDepth === 0) {
      if (isSelfClosing) continue;
      if (!isClosing) {
        pStartInnerIdx = match.index + fullTag.length;
      } else if (pStartInnerIdx >= 0) {
        blocks.push({
          type: 'p',
          content: xmlString.slice(pStartInnerIdx, match.index),
        });
        pStartInnerIdx = -1;
      }
    }
  }

  return blocks;
}

/**
 * Parses OpenXML word/document.xml paragraphs (<w:p>), data tables (<w:tbl>), runs, and embedded image references.
 */
export function parseWordDocumentXmlWithAnswerHighlights(
  xmlString: string,
  relIdToDataUri: Record<string, string> = {}
): string {
  const cleanedXml = stripMcFallbackBlocks(xmlString);
  const paragraphLines: string[] = [];
  const blocks = extractTopLevelBlocks(cleanedXml);

  for (const block of blocks) {
    if (block.type === 'tbl') {
      const fullBlock = block.content;
      const trRegex = /<w:tr(?:\s(?:[^>]*[^/>])?)?>([\s\S]*?)<\/w:tr>/g;
      let trMatch: RegExpExecArray | null;
      const tableRows: string[][] = [];
      const tableImages: string[] = [];
      const seenTableImages = new Set<string>();

      while ((trMatch = trRegex.exec(fullBlock)) !== null) {
        const trInner = trMatch[1];
        const tcRegex = /<w:tc(?:\s(?:[^>]*[^/>])?)?>([\s\S]*?)<\/w:tc>/g;
        let tcMatch: RegExpExecArray | null;
        const rowCells: string[] = [];

        while ((tcMatch = tcRegex.exec(trInner)) !== null) {
          const tcInner = tcMatch[1];
          const pInCellRegex = /<w:p(?:\s(?:[^>]*[^/>])?)?>([\s\S]*?)<\/w:p>/g;
          let pCellMatch: RegExpExecArray | null;
          const cellParts: string[] = [];

          while ((pCellMatch = pInCellRegex.exec(tcInner)) !== null) {
            const { text, embeddedImageUris } = extractParagraphContent(
              pCellMatch[1],
              relIdToDataUri
            );
            if (text) cellParts.push(text);
            for (const uri of embeddedImageUris) {
              if (!seenTableImages.has(uri)) {
                seenTableImages.add(uri);
                tableImages.push(uri);
              }
            }
          }

          rowCells.push(cellParts.join(' ').replace(/\|/g, '/').trim());
        }

        if (rowCells.some((c) => c.length > 0)) {
          tableRows.push(rowCells);
        }
      }

      if (tableRows.length > 0) {
        const allCells = tableRows.flat().filter(Boolean);
        // Check if this Word table is just a layout grid for A. / B. / C. / D. options or Answer Key pairs
        const optionLikeCells = allCells.filter((c) =>
          /^(?:\*)?\s*\[?[ABCDabcd]\]?[.)]\s+/.test(c)
        );
        const answerKeyLikeCells = allCells.filter((c) =>
          /^(?:Câu\s*)?\d{1,3}\s*[.:=\-]?\s*[ABCD]{1,4}$/i.test(c)
        );

        if (optionLikeCells.length >= 2 || answerKeyLikeCells.length >= 2) {
          for (const c of allCells) {
            paragraphLines.push(c);
          }
        } else {
          // It is a genuine Data Table (Bảng số liệu)
          paragraphLines.push('[TABLE_START]');
          for (const r of tableRows) {
            paragraphLines.push(`| ${r.join(' | ')} |`);
          }
          paragraphLines.push('[TABLE_END]');
        }
      }

      for (const imgUri of tableImages) {
        paragraphLines.push(`[IMAGE:${imgUri}]`);
      }
      continue;
    }

    // Regular paragraph <w:p>
    const { text, embeddedImageUris } = extractParagraphContent(block.content, relIdToDataUri);
    if (text) {
      paragraphLines.push(text);
    }
    for (const imgUri of embeddedImageUris) {
      paragraphLines.push(`[IMAGE:${imgUri}]`);
    }
  }

  return paragraphLines.join('\n');
}

function decodeXmlEntities(str: string): string {
  return str
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'");
}

/**
 * Generates a valid Microsoft Word (.docx) ArrayBuffer containing:
 * - Single-choice questions (with image diagram)
 * - Multiple-choice (Đúng/Sai - nhiều lựa chọn đúng)
 * - Short-answer (Điền từ / trả lời ngắn)
 */
export async function generateSampleDocxArrayBuffer(): Promise<ArrayBuffer> {
  const zip = new JSZip();

  zip.file(
    '[Content_Types].xml',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Default Extension="svg" ContentType="image/svg+xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
</Types>`
  );

  zip.folder('_rels')?.file(
    '.rels',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`
  );

  const documentXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <w:body>
    <w:p><w:r><w:rPr><w:b/></w:rPr><w:t>Câu 1: </w:t></w:r><w:r><w:t>Quan sát sơ đồ tiến trình cách mạng tư sản dưới đây, cuộc cách mạng nổ ra vào năm 1789 là cuộc cách mạng nào?</w:t></w:r></w:p>
    <w:p><w:r><w:t>[IMAGE:${SAMPLE_QUESTION_DIAGRAM_DATA_URI}]</w:t></w:r></w:p>
    <w:p><w:r><w:rPr><w:u w:val="single"/><w:color w:val="FF0000"/></w:rPr><w:t>A. Cách mạng tư sản Pháp.</w:t></w:r></w:p>
    <w:p><w:r><w:t>B. Cách mạng tư sản Hà Lan.</w:t></w:r></w:p>
    <w:p><w:r><w:t>C. Cách mạng tư sản Anh.</w:t></w:r></w:p>
    <w:p><w:r><w:t>D. Chiến tranh giành độc lập Bắc Mỹ.</w:t></w:r></w:p>
    <w:p><w:r><w:t>Lời giải: Ngày 14/7/1789 mở đầu cuộc Cách mạng tư sản Pháp cuối thế kỉ XVIII.</w:t></w:r></w:p>

    <w:p><w:r><w:rPr><w:b/></w:rPr><w:t>Câu 2: </w:t></w:r><w:r><w:t>(Đúng/Sai - Nhiều lựa chọn) Những nhận định nào sau đây là ĐÚNG khi nói về nhiệm vụ và giai cấp lãnh đạo của các cuộc cách mạng tư sản thế kỉ XVI - XVIII?</w:t></w:r></w:p>
    <w:p><w:r><w:rPr><w:u w:val="single"/><w:color w:val="FF0000"/></w:rPr><w:t>A. Nhiệm vụ dân tộc nhằm xóa bỏ tình trạng phong kiến cát cứ, thống nhất thị trường dân tộc.</w:t></w:r></w:p>
    <w:p><w:r><w:t>B. Giai cấp công nhân độc quyền lãnh đạo tất cả các cuộc cách mạng tư sản thế kỉ XVI - XVIII.</w:t></w:r></w:p>
    <w:p><w:r><w:rPr><w:u w:val="single"/><w:color w:val="FF0000"/></w:rPr><w:t>C. Nhiệm vụ dân chủ nhằm xóa bỏ chế độ phong kiến chuyên chế, xác lập nền dân chủ tư sản.</w:t></w:r></w:p>
    <w:p><w:r><w:t>D. Các cuộc cách mạng tư sản đều xóa bỏ hoàn toàn chế độ tư hữu tư bản chủ nghĩa.</w:t></w:r></w:p>
    <w:p><w:r><w:t>Lời giải: Nhận định A và C đúng; giai cấp lãnh đạo là tư sản (và quý tộc mới/chủ nô), không phải công nhân.</w:t></w:r></w:p>

    <w:p><w:r><w:rPr><w:b/></w:rPr><w:t>Câu 3: </w:t></w:r><w:r><w:t>Lãnh đạo các cuộc cách mạng tư sản từ thế kỉ XVII đến thế kỉ XVIII không bao gồm lực lượng nào sau đây?</w:t></w:r></w:p>
    <w:p><w:r><w:t>A. Tư sản.</w:t></w:r></w:p>
    <w:p><w:r><w:t>B. Quý tộc mới.</w:t></w:r></w:p>
    <w:p><w:r><w:t>C. Chủ nô.</w:t></w:r></w:p>
    <w:p><w:r><w:rPr><w:u w:val="single"/><w:color w:val="FF0000"/></w:rPr><w:t>D. Công nhân.</w:t></w:r></w:p>
    <w:p><w:r><w:t>Lời giải: Giai cấp công nhân lúc này còn non trẻ, chỉ là lực lượng tham gia quần chúng.</w:t></w:r></w:p>

    <w:p><w:r><w:rPr><w:b/></w:rPr><w:t>Câu 4: </w:t></w:r><w:r><w:t>(Điền từ / Trả lời ngắn) Việt Nam chính thức gia nhập Hiệp hội các quốc gia Đông Nam Á (ASEAN) vào năm nào? (Chỉ điền số năm)</w:t></w:r></w:p>
    <w:p><w:r><w:t>Đáp án: 1995</w:t></w:r></w:p>
    <w:p><w:r><w:t>Lời giải: Ngày 28/7/1995, Việt Nam chính thức trở thành thành viên thứ 7 của ASEAN.</w:t></w:r></w:p>

    <w:p><w:r><w:rPr><w:b/></w:rPr><w:t>Câu 5: </w:t></w:r><w:r><w:t>(Điền từ / Trả lời ngắn) Ai là người đứng đầu Chính phủ Xô viết soạn thảo Sắc lệnh Hòa bình và Sắc lệnh Ruộng đất năm 1917?</w:t></w:r></w:p>
    <w:p><w:r><w:t>Đáp án: Lê-nin; Lênin; V.I. Lê-nin; Lenin</w:t></w:r></w:p>
    <w:p><w:r><w:t>Lời giải: V.I. Lê-nin đã thông qua Sắc lệnh Hòa bình và Sắc lệnh Ruộng đất ngay sau Cách mạng tháng Mười Nga 1917.</w:t></w:r></w:p>
  </w:body>
</w:document>`;

  zip.folder('word')?.file('document.xml', documentXml);

  return await zip.generateAsync({ type: 'arraybuffer' });
}
