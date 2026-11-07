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

/**
 * Compresses a large base64 image data URI in the browser using an offscreen canvas
 * so exam documents stay well within Firestore's 1 MiB document size limit.
 */
export async function compressImageDataUriIfNeeded(
  dataUri: string,
  maxWidth = 840,
  quality = 0.78
): Promise<string> {
  if (
    typeof window === 'undefined' ||
    typeof document === 'undefined' ||
    !dataUri.startsWith('data:image/') ||
    dataUri.startsWith('data:image/svg') ||
    dataUri.length < 45000
  ) {
    return dataUri;
  }

  return new Promise<string>((resolve) => {
    const img = new Image();
    img.onload = () => {
      try {
        let w = img.naturalWidth || img.width || 600;
        let h = img.naturalHeight || img.height || 400;
        if (w > maxWidth) {
          h = Math.round((h * maxWidth) / w);
          w = maxWidth;
        }
        const canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          resolve(dataUri);
          return;
        }
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, w, h);
        ctx.drawImage(img, 0, 0, w, h);
        const compressed = canvas.toDataURL('image/jpeg', quality);
        resolve(compressed.length < dataUri.length ? compressed : dataUri);
      } catch {
        resolve(dataUri);
      }
    };
    img.onerror = () => resolve(dataUri);
    img.src = dataUri;
  });
}

/**
 * Extracts text, data tables (<w:tbl>), and embedded images from a .docx ArrayBuffer,
 * preserving underlined/bold/highlighted/red option markers by prefixing them with '*'
 * so the exam parser detects single and multiple correct answers automatically.
 */
export async function extractTextFromDocxBuffer(arrayBuffer: ArrayBuffer): Promise<string> {
  try {
    const zip = await JSZip.loadAsync(arrayBuffer);
    const docXmlFile = zip.file('word/document.xml');
    if (docXmlFile) {
      const xmlText = await docXmlFile.async('string');

      // Build relationship map rId -> base64 data URI for any embedded images in word/media/*
      const relIdToDataUri: Record<string, string> = {};
      const relsFile = zip.file('word/_rels/document.xml.rels');
      if (relsFile) {
        const relsXml = await relsFile.async('string');
        const relRegex = /<Relationship\b[^>]*Id="([^"]+)"[^>]*Target="([^"]+)"[^>]*\/?>/gi;
        let relMatch: RegExpExecArray | null;
        while ((relMatch = relRegex.exec(relsXml)) !== null) {
          const rId = relMatch[1];
          const target = relMatch[2].replace(/^\/+/, '');
          const mediaPath = target.startsWith('word/') ? target : `word/${target}`;
          const mediaFile = zip.file(mediaPath);
          if (mediaFile) {
            const base64 = await mediaFile.async('base64');
            const ext = mediaPath.split('.').pop()?.toLowerCase() || 'png';
            const mime =
              ext === 'jpg' || ext === 'jpeg'
                ? 'image/jpeg'
                : ext === 'svg'
                ? 'image/svg+xml'
                : ext === 'gif'
                ? 'image/gif'
                : ext === 'webp'
                ? 'image/webp'
                : 'image/png';
            const rawUri = `data:${mime};base64,${base64}`;
            relIdToDataUri[rId] = await compressImageDataUriIfNeeded(rawUri);
          }
        }
      }

      const parsedFromXml = parseWordDocumentXmlWithAnswerHighlights(xmlText, relIdToDataUri);
      if (parsedFromXml.trim().length > 0) {
        return parsedFromXml;
      }
    }
  } catch {
    // Fallback to mammoth below
  }

  const rawResult = await mammoth.extractRawText({ arrayBuffer });
  return rawResult.value || '';
}

function extractParagraphContent(
  pContent: string,
  relIdToDataUri: Record<string, string>
): { text: string; embeddedImageUri?: string } {
  const blipMatch =
    pContent.match(/r:embed="([^"]+)"/) || pContent.match(/r:id="([^"]+)"/);
  const embeddedImageUri =
    blipMatch && relIdToDataUri[blipMatch[1]] ? relIdToDataUri[blipMatch[1]] : undefined;

  const rRegex = /<w:r(?:\s[^>]*)?>([\s\S]*?)<\/w:r>/g;
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
    embeddedImageUri,
  };
}

/**
 * Parses OpenXML word/document.xml paragraphs (<w:p>), data tables (<w:tbl>), runs, and embedded image references.
 */
export function parseWordDocumentXmlWithAnswerHighlights(
  xmlString: string,
  relIdToDataUri: Record<string, string> = {}
): string {
  const paragraphLines: string[] = [];

  // Match either a full <w:tbl>...</w:tbl> block or a top-level <w:p>...</w:p> block in document order
  const blockRegex = /<w:tbl(?:\s[^>]*)?>[\s\S]*?<\/w:tbl>|<w:p(?:\s[^>]*)?>([\s\S]*?)<\/w:p>/g;
  let blockMatch: RegExpExecArray | null;

  while ((blockMatch = blockRegex.exec(xmlString)) !== null) {
    const fullBlock = blockMatch[0];

    if (fullBlock.startsWith('<w:tbl')) {
      const trRegex = /<w:tr(?:\s[^>]*)?>([\s\S]*?)<\/w:tr>/g;
      let trMatch: RegExpExecArray | null;
      const tableRows: string[][] = [];
      const tableImages: string[] = [];

      while ((trMatch = trRegex.exec(fullBlock)) !== null) {
        const trInner = trMatch[1];
        const tcRegex = /<w:tc(?:\s[^>]*)?>([\s\S]*?)<\/w:tc>/g;
        let tcMatch: RegExpExecArray | null;
        const rowCells: string[] = [];

        while ((tcMatch = tcRegex.exec(trInner)) !== null) {
          const tcInner = tcMatch[1];
          const pInCellRegex = /<w:p(?:\s[^>]*)?>([\s\S]*?)<\/w:p>/g;
          let pCellMatch: RegExpExecArray | null;
          const cellParts: string[] = [];

          while ((pCellMatch = pInCellRegex.exec(tcInner)) !== null) {
            const { text, embeddedImageUri } = extractParagraphContent(
              pCellMatch[1],
              relIdToDataUri
            );
            if (text) cellParts.push(text);
            if (embeddedImageUri) tableImages.push(embeddedImageUri);
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
    const pContent = blockMatch[1] || '';
    const { text, embeddedImageUri } = extractParagraphContent(pContent, relIdToDataUri);
    if (text) {
      paragraphLines.push(text);
    }
    if (embeddedImageUri) {
      paragraphLines.push(`[IMAGE:${embeddedImageUri}]`);
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
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
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
