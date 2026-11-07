import JSZip from 'jszip';
import mammoth from 'mammoth';

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

/* -------------------------------------------------------------------------- */
/*  Image budget                                                              */
/* -------------------------------------------------------------------------- */

/**
 * Firestore giới hạn 1 MiB cho một document, và cả đề thi (chữ + ảnh) nằm trong
 * một document. Vì vậy toàn bộ ảnh của một file Word chỉ được dùng một ngân sách
 * cố định, phần còn lại dành cho nội dung câu hỏi.
 * (firebase.ts nên chặn ở khoảng 950 KB cho cả document.)
 */
export const MAX_IMAGE_SIDE = 1280; // px, cạnh dài tối đa
export const MAX_SINGLE_IMAGE_BYTES = 180_000; // trần cho 1 ảnh (độ dài chuỗi data URI)
export const MAX_TOTAL_IMAGE_BYTES = 650_000; // trần cho tất cả ảnh của 1 đề
const MIN_IMAGE_BUDGET_BYTES = 30_000; // ngân sách tối thiểu chia cho mỗi ảnh

// Các mức nén thử lần lượt cho tới khi ảnh nằm trong ngân sách
const COMPRESS_STEPS: ReadonlyArray<{ side: number; quality: number }> = [
  { side: MAX_IMAGE_SIDE, quality: 0.72 },
  { side: 1024, quality: 0.6 },
  { side: 800, quality: 0.5 },
  { side: 600, quality: 0.45 },
  { side: 480, quality: 0.4 },
];

const RASTER_MIME_BY_EXT: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  bmp: 'image/bmp',
};

export interface DocxExtractResult {
  /** Văn bản đã trích xuất, ảnh nằm trong các dòng [IMAGE:...] */
  text: string;
  /** Số ảnh đã đưa vào đề */
  imageCount: number;
  /** Số ảnh bị bỏ qua (định dạng không hỗ trợ, quá nặng, lỗi giải mã...) */
  skippedImages: number;
  /** Cảnh báo để hiển thị cho người dùng */
  warnings: string[];
}

/**
 * Giữ nguyên chữ ký cũ để các nơi đang gọi không phải sửa.
 * Muốn có số ảnh và cảnh báo thì dùng extractDocxWithReport.
 */
export async function extractTextFromDocxBuffer(arrayBuffer: ArrayBuffer): Promise<string> {
  const result = await extractDocxWithReport(arrayBuffer);
  return result.text;
}

/**
 * Extracts text and embedded images from a .docx ArrayBuffer, preserving underlined/bold/highlighted/red
 * option markers by prefixing them with '*' so the exam parser detects single and multiple correct answers automatically.
 *
 * Ảnh: chỉ nạp những ảnh thật sự được document.xml tham chiếu, đọc quan hệ không phụ thuộc
 * thứ tự thuộc tính, và nén theo ngân sách dung lượng chung.
 */
export async function extractDocxWithReport(arrayBuffer: ArrayBuffer): Promise<DocxExtractResult> {
  const warnings: string[] = [];

  try {
    const zip = await JSZip.loadAsync(arrayBuffer);
    const docXmlFile = zip.file('word/document.xml');
    if (docXmlFile) {
      const xmlText = await docXmlFile.async('string');

      const referencedIds = collectReferencedImageRelIds(xmlText);
      const imageResult = await buildImageDataUriMap(zip, referencedIds, warnings);

      const parsedFromXml = parseWordDocumentXmlWithAnswerHighlights(xmlText, imageResult.map);
      if (parsedFromXml.trim().length > 0) {
        return {
          text: parsedFromXml,
          imageCount: imageResult.loaded,
          skippedImages: imageResult.skipped,
          warnings,
        };
      }
    }
  } catch {
    // Fallback to mammoth below
  }

  const rawResult = await mammoth.extractRawText({ arrayBuffer });
  warnings.push('Không đọc được cấu trúc file Word, đã chuyển sang đọc văn bản thuần (không có ảnh, không nhận đáp án gạch chân).');
  return {
    text: rawResult.value || '',
    imageCount: 0,
    skippedImages: 0,
    warnings,
  };
}

/* -------------------------------------------------------------------------- */
/*  Relationship + image helpers                                              */
/* -------------------------------------------------------------------------- */

// <a:blip r:embed="rIdX"> (DrawingML) và <v:imagedata r:id="rIdX"> (VML).
// Không dùng r:id chung chung vì <w:hyperlink r:id> cũng có thuộc tính này.
const IMAGE_REF_SOURCE = '<(?:a:blip|v:imagedata)\\b[^>]*?\\br:(?:embed|id)="([^"]+)"';

/** Bỏ khối <mc:Fallback> để cùng một ảnh không bị đếm hai lần. */
function stripAlternateFallback(xml: string): string {
  return xml.replace(/<mc:Fallback>[\s\S]*?<\/mc:Fallback>/g, '');
}

function extractImageRelIds(xmlFragment: string): string[] {
  const ids: string[] = [];
  const seen = new Set<string>();
  const regex = new RegExp(IMAGE_REF_SOURCE, 'g');
  let m: RegExpExecArray | null;
  while ((m = regex.exec(stripAlternateFallback(xmlFragment))) !== null) {
    if (!seen.has(m[1])) {
      seen.add(m[1]);
      ids.push(m[1]);
    }
  }
  return ids;
}

function collectReferencedImageRelIds(documentXml: string): string[] {
  return extractImageRelIds(documentXml);
}

interface RelationshipInfo {
  target: string;
  type: string;
  external: boolean;
}

function readXmlAttribute(tag: string, name: string): string {
  const m = tag.match(new RegExp(`\\b${name}\\s*=\\s*(["'])(.*?)\\1`, 'i'));
  return m ? m[2] : '';
}

/** Đọc rels bằng từng thuộc tính riêng, không phụ thuộc thứ tự Id/Type/Target. */
function parseRelationships(relsXml: string): Map<string, RelationshipInfo> {
  const map = new Map<string, RelationshipInfo>();
  const tagRegex = /<Relationship\b[^>]*>/gi;
  let m: RegExpExecArray | null;
  while ((m = tagRegex.exec(relsXml)) !== null) {
    const tag = m[0];
    const id = readXmlAttribute(tag, 'Id');
    const target = readXmlAttribute(tag, 'Target');
    if (!id || !target) continue;
    map.set(id, {
      target,
      type: readXmlAttribute(tag, 'Type'),
      external: /^external$/i.test(readXmlAttribute(tag, 'TargetMode')),
    });
  }
  return map;
}

/** Chuẩn hóa đường dẫn đích (tương đối so với thư mục word/) và xử lý "../". */
function resolveWordPartPath(target: string): string {
  const cleaned = target.replace(/^\/+/, '');
  const full = cleaned.startsWith('word/') ? cleaned : `word/${cleaned}`;
  const out: string[] = [];
  for (const part of full.split('/')) {
    if (part === '..') out.pop();
    else if (part && part !== '.') out.push(part);
  }
  return out.join('/');
}

function uint8ToBase64(bytes: Uint8Array): string {
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

interface DecodedImage {
  drawable: CanvasImageSource;
  width: number;
  height: number;
  release: () => void;
}

async function decodeToDrawable(blob: Blob): Promise<DecodedImage> {
  if (typeof createImageBitmap === 'function') {
    try {
      const bitmap = await createImageBitmap(blob);
      return {
        drawable: bitmap,
        width: bitmap.width,
        height: bitmap.height,
        release: () => bitmap.close(),
      };
    } catch {
      // thử cách <img> bên dưới
    }
  }
  const url = URL.createObjectURL(blob);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error('Không giải mã được ảnh'));
      el.src = url;
    });
    return {
      drawable: img,
      width: img.naturalWidth,
      height: img.naturalHeight,
      release: () => URL.revokeObjectURL(url),
    };
  } catch (err) {
    URL.revokeObjectURL(url);
    throw err;
  }
}

/** Thu nhỏ + nén JPEG, thử các mức giảm dần cho tới khi vừa ngân sách. */
async function compressRasterToDataUri(
  bytes: Uint8Array,
  mime: string,
  capChars: number
): Promise<string | null> {
  if (typeof document === 'undefined') return null;

  let decoded: DecodedImage;
  try {
    decoded = await decodeToDrawable(new Blob([bytes], { type: mime }));
  } catch {
    return null;
  }

  try {
    if (!decoded.width || !decoded.height) return null;
    let smallest: string | null = null;

    for (const step of COMPRESS_STEPS) {
      const scale = Math.min(1, step.side / Math.max(decoded.width, decoded.height));
      const w = Math.max(1, Math.round(decoded.width * scale));
      const h = Math.max(1, Math.round(decoded.height * scale));

      const canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext('2d');
      if (!ctx) return null;
      // JPEG không có nền trong suốt nên tô nền trắng trước
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, w, h);
      ctx.drawImage(decoded.drawable, 0, 0, w, h);

      const out = canvas.toDataURL('image/jpeg', step.quality);
      canvas.width = 0;
      canvas.height = 0;

      if (!smallest || out.length < smallest.length) smallest = out;
      if (out.length <= capChars) return out;
    }
    return smallest;
  } finally {
    decoded.release();
  }
}

interface ImageMapResult {
  map: Record<string, string>;
  loaded: number;
  skipped: number;
}

/**
 * Chỉ xử lý các rId mà document.xml thật sự dùng, theo thứ tự xuất hiện.
 * Mỗi ảnh được chia một phần ngân sách chung; ảnh nhỏ hơn thì để lại phần dư cho ảnh sau.
 */
async function buildImageDataUriMap(
  zip: JSZip,
  referencedIds: string[],
  warnings: string[]
): Promise<ImageMapResult> {
  const result: ImageMapResult = { map: {}, loaded: 0, skipped: 0 };
  if (referencedIds.length === 0) return result;

  const relsFile = zip.file('word/_rels/document.xml.rels');
  if (!relsFile) return result;
  const relationships = parseRelationships(await relsFile.async('string'));

  // Nhiều rId có thể trỏ cùng một file ảnh, chỉ xử lý một lần
  const dataUriByPath = new Map<string, string | null>();
  let remainingBudget = MAX_TOTAL_IMAGE_BYTES;
  let imagesLeft = referencedIds.length;
  let imageNo = 0;

  for (const rId of referencedIds) {
    imageNo++;
    const rel = relationships.get(rId);
    const finishOne = () => {
      imagesLeft = Math.max(0, imagesLeft - 1);
    };

    if (!rel || rel.external) {
      result.skipped++;
      finishOne();
      warnings.push(`Ảnh ${imageNo}: được liên kết từ bên ngoài file Word nên không đọc được.`);
      continue;
    }

    const path = resolveWordPartPath(rel.target);
    if (dataUriByPath.has(path)) {
      const cached = dataUriByPath.get(path);
      if (cached) {
        result.map[rId] = cached;
        result.loaded++;
      } else {
        result.skipped++;
      }
      finishOne();
      continue;
    }

    const ext = path.split('.').pop()?.toLowerCase() || '';
    const mediaFile = zip.file(path);
    if (!mediaFile) {
      dataUriByPath.set(path, null);
      result.skipped++;
      finishOne();
      warnings.push(`Ảnh ${imageNo}: không tìm thấy dữ liệu trong file Word.`);
      continue;
    }

    // SVG: giữ nguyên nếu nhỏ
    if (ext === 'svg') {
      const bytes = await mediaFile.async('uint8array');
      const uri = `data:image/svg+xml;base64,${uint8ToBase64(bytes)}`;
      if (uri.length <= MAX_SINGLE_IMAGE_BYTES && uri.length <= remainingBudget) {
        remainingBudget -= uri.length;
        dataUriByPath.set(path, uri);
        result.map[rId] = uri;
        result.loaded++;
      } else {
        dataUriByPath.set(path, null);
        result.skipped++;
        warnings.push(`Ảnh ${imageNo} (SVG): quá nặng nên bị bỏ qua.`);
      }
      finishOne();
      continue;
    }

    const mime = RASTER_MIME_BY_EXT[ext];
    if (!mime) {
      // emf, wmf, tif... trình duyệt không hiển thị được
      dataUriByPath.set(path, null);
      result.skipped++;
      finishOne();
      warnings.push(
        `Ảnh ${imageNo}: định dạng .${ext || '?'} không được trình duyệt hỗ trợ. Hãy chèn lại ảnh dạng PNG/JPG.`
      );
      continue;
    }

    const bytes = await mediaFile.async('uint8array');
    const capChars = Math.min(
      MAX_SINGLE_IMAGE_BYTES,
      Math.max(MIN_IMAGE_BUDGET_BYTES, Math.floor(remainingBudget / Math.max(1, imagesLeft)))
    );

    let dataUri: string | null = null;
    const base64Estimate = Math.ceil(bytes.length / 3) * 4 + `data:${mime};base64,`.length;
    if (base64Estimate <= capChars) {
      // Ảnh đã đủ nhẹ: giữ nguyên bản gốc, không nén lại để khỏi giảm chất lượng
      dataUri = `data:${mime};base64,${uint8ToBase64(bytes)}`;
    } else {
      dataUri = await compressRasterToDataUri(bytes, mime, capChars);
    }

    if (dataUri && dataUri.length <= remainingBudget) {
      remainingBudget -= dataUri.length;
      dataUriByPath.set(path, dataUri);
      result.map[rId] = dataUri;
      result.loaded++;
      if (dataUri.length > capChars) {
        warnings.push(`Ảnh ${imageNo}: đã nén mạnh nhưng vẫn khá nặng, có thể ảnh hưởng chất lượng hiển thị.`);
      }
    } else {
      dataUriByPath.set(path, null);
      result.skipped++;
      warnings.push(
        dataUri
          ? `Ảnh ${imageNo}: vượt giới hạn dung lượng chung của đề nên bị bỏ qua. Hãy giảm số ảnh hoặc dùng ảnh nhỏ hơn.`
          : `Ảnh ${imageNo}: không nén được (lỗi giải mã) nên bị bỏ qua.`
      );
    }
    finishOne();
  }

  return result;
}

/* -------------------------------------------------------------------------- */
/*  document.xml parser                                                       */
/* -------------------------------------------------------------------------- */

/**
 * Parses OpenXML word/document.xml paragraphs, runs, and embedded image references.
 */
export function parseWordDocumentXmlWithAnswerHighlights(
  xmlString: string,
  relIdToDataUri: Record<string, string> = {}
): string {
  const paragraphLines: string[] = [];

  // (?:\s(?:[^>]*[^/>])?)? để không khớp nhầm thẻ tự đóng như <w:p w:rsidR="..."/>
  const pRegex = /<w:p(?:\s(?:[^>]*[^/>])?)?>([\s\S]*?)<\/w:p>/g;
  let pMatch: RegExpExecArray | null;

  while ((pMatch = pRegex.exec(xmlString)) !== null) {
    const pContent = pMatch[1];

    // Mọi ảnh trong đoạn (không trùng lặp), theo thứ tự xuất hiện
    const embeddedImageUris = extractImageRelIds(pContent)
      .map((rId) => relIdToDataUri[rId])
      .filter((uri): uri is string => Boolean(uri));

    const rRegex = /<w:r(?:\s(?:[^>]*[^/>])?)?>([\s\S]*?)<\/w:r>/g;
    let rMatch: RegExpExecArray | null;

    interface RunSegment {
      text: string;
      isEmphasized: boolean;
    }

    const runs: RunSegment[] = [];

    while ((rMatch = rRegex.exec(pContent)) !== null) {
      const rInner = rMatch[1];
      const tRegex = /<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>/g;
      let tMatch: RegExpExecArray | null;
      let runText = '';
      while ((tMatch = tRegex.exec(rInner)) !== null) {
        runText += decodeXmlEntities(tMatch[1]);
      }
      if (/w:tab\b/.test(rInner)) {
        runText += '\t';
      }

      if (!runText) continue;

      const rPrMatch = rInner.match(/<w:rPr>([\s\S]*?)<\/w:rPr>/);
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
      if (seg.isEmphasized && /^\s*([ABCD])\s*[.)]/.test(seg.text)) {
        lineText += seg.text.replace(/^\s*([ABCD])\s*([.)])/, ' *$1$2');
      } else if (
        seg.isEmphasized &&
        /^\s*([ABCD])\s*$/.test(seg.text) &&
        i + 1 < runs.length &&
        /^\s*[.)]/.test(runs[i + 1].text)
      ) {
        lineText += ` *${seg.text.trim()}`;
      } else {
        lineText += seg.text;
      }
    }

    const cleaned = lineText.trim();
    if (cleaned) {
      paragraphLines.push(cleaned);
    }
    for (const uri of embeddedImageUris) {
      paragraphLines.push(`[IMAGE:${uri}]`);
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
