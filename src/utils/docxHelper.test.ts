import test from 'node:test';
import assert from 'node:assert/strict';
import JSZip from 'jszip';
import {
  parseImageRelationshipsXml,
  extractImageRIdsFromXmlFragment,
  normalizeDocxTargetPath,
  extractDocxWithReport,
} from './docxHelper';
import { parseExamText } from './examParser';

test('parseImageRelationshipsXml: handles Target before Id, ignores hyperlink/numbering and External, normalizes paths', () => {
  const relsXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
  <Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
    <Relationship Target="media/image1.png" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Id="rId10"/>
    <Relationship Id="rId11" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="/word/media/image2.jpg"/>
    <Relationship Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="../media/image3.png" Id="rId12"/>
    <Relationship Id="rId13" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink" Target="https://example.com" TargetMode="External"/>
    <Relationship Id="rId14" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/numbering" Target="numbering.xml"/>
    <Relationship Id="rId15" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="https://example.com/logo.png" TargetMode="External"/>
  </Relationships>`;

  const map = parseImageRelationshipsXml(relsXml);

  assert.equal(normalizeDocxTargetPath(map.get('rId10')?.target || ''), 'word/media/image1.png');
  assert.equal(normalizeDocxTargetPath(map.get('rId11')?.target || ''), 'word/media/image2.jpg');
  assert.equal(normalizeDocxTargetPath(map.get('rId12')?.target || ''), 'word/media/image3.png');
  assert.equal(map.get('rId13'), undefined);
  assert.equal(map.get('rId14'), undefined);
  assert.equal(map.get('rId15'), undefined);

  assert.equal(normalizeDocxTargetPath('media/image1.png'), 'word/media/image1.png');
  assert.equal(normalizeDocxTargetPath('/word/media/image1.png'), 'word/media/image1.png');
  assert.equal(normalizeDocxTargetPath('../media/image1.png'), 'word/media/image1.png');
});

test('extractImageRIdsFromXmlFragment: strips mc:Fallback, ignores w:hyperlink r:id, and extracts multiple blips in one paragraph', () => {
  const paragraphXml = `
    <w:p>
      <w:hyperlink r:id="rId9">
        <w:r><w:t>Link tham khảo</w:t></w:r>
      </w:hyperlink>
      <w:r>
        <mc:AlternateContent>
          <mc:Choice Requires="wps">
            <w:drawing><a:graphic><a:graphicData><pic:pic><pic:blipFill><a:blip r:embed="rId1"/></pic:blipFill></pic:pic></a:graphicData></a:graphic></w:drawing>
          </mc:Choice>
          <mc:Fallback>
            <w:pict><v:shape><v:imagedata r:id="rId1"/></v:shape></w:pict>
          </mc:Fallback>
        </mc:AlternateContent>
      </w:r>
      <w:r>
        <w:drawing><a:blip r:embed="rId2"/></w:drawing>
      </w:r>
    </w:p>
  `;

  const rIds = extractImageRIdsFromXmlFragment(paragraphXml);
  assert.deepEqual(rIds, ['rId1', 'rId2']);
});

test('extractDocxWithReport: extracts underline *B., ignores w:u val="none", extracts <w:tbl> into tableData, and warns on .emf', async () => {
  const zip = new JSZip();

  // 1x1 transparent PNG bytes
  const tinyPngBase64 =
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
  zip.file('word/media/image1.png', Buffer.from(tinyPngBase64, 'base64'));
  zip.file('word/media/formula2.emf', new Uint8Array([1, 2, 3, 4]));

  zip.file(
    'word/_rels/document.xml.rels',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
    <Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
      <Relationship Target="media/image1.png" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Id="rId1"/>
      <Relationship Target="../media/formula2.emf" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Id="rId2"/>
    </Relationships>`
  );

  zip.file(
    'word/document.xml',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
    <w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"
                xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"
                xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
      <w:body>
        <w:p>
          <w:r><w:t>Câu 1: Cho bảng số liệu GDP dưới đây:</w:t></w:r>
          <w:r><w:drawing><a:blip r:embed="rId1"/></w:drawing></w:r>
          <w:r><w:drawing><a:blip r:embed="rId2"/></w:drawing></w:r>
        </w:p>
        <w:tbl>
          <w:tr>
            <w:tc><w:p><w:r><w:t>Năm</w:t></w:r></w:p></w:tc>
            <w:tc><w:p><w:r><w:t>2020</w:t></w:r></w:p></w:tc>
            <w:tc><w:p><w:r><w:t>2024</w:t></w:r></w:p></w:tc>
          </w:tr>
          <w:tr>
            <w:tc><w:p><w:r><w:t>Hoa Kỳ</w:t></w:r></w:p></w:tc>
            <w:tc><w:p><w:r><w:t>21,3</w:t></w:r></w:p></w:tc>
            <w:tc><w:p><w:r><w:t>28,7</w:t></w:r></w:p></w:tc>
          </w:tr>
        </w:tbl>
        <w:p>
          <w:r><w:rPr><w:u w:val="none"/></w:rPr><w:t>A. Phương án A không gạch chân</w:t></w:r>
        </w:p>
        <w:p>
          <w:r><w:rPr><w:u w:val="single"/></w:rPr><w:t>B.</w:t></w:r>
          <w:r><w:t> Phương án B được gạch chân</w:t></w:r>
        </w:p>
        <w:p>
          <w:r><w:t>C. Phương án C</w:t></w:r>
        </w:p>
        <w:p>
          <w:r><w:t>D. Phương án D</w:t></w:r>
        </w:p>
      </w:body>
    </w:document>`
  );

  const arrayBuffer = await zip.generateAsync({ type: 'arraybuffer' });
  const report = await extractDocxWithReport(arrayBuffer);

  assert.equal(report.imageCount, 1);
  assert.equal(report.skippedImages, 1);
  assert.ok(
    report.warnings.some((w) => w.toLowerCase().includes('.emf')),
    'Should warn about unsupported .emf image'
  );
  assert.ok(report.text.includes('*B.'), 'Should mark underlined option B with *B.');
  assert.ok(!report.text.includes('*A.'), 'Should NOT mark w:u val="none" with *A.');
  assert.ok(report.text.includes('[TABLE_START]'), 'Should emit [TABLE_START] for <w:tbl>');
  assert.ok(report.text.includes('[TABLE_END]'), 'Should emit [TABLE_END] for <w:tbl>');

  const parsed = parseExamText(report.text);
  assert.equal(parsed.questions.length, 1);
  const q1 = parsed.questions[0];
  assert.equal(q1.correctAnswer, 'B');
  assert.ok(q1.imageUrl?.startsWith('data:image/png;base64,'));
  assert.ok(q1.tableData);
  assert.deepEqual(q1.tableData?.headers, ['Năm', '2020', '2024']);
  assert.deepEqual(q1.tableData?.rows, [['Hoa Kỳ', '21,3', '28,7']]);
});
