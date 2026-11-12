import test from 'node:test';
import assert from 'node:assert/strict';
import {
  sanitizeExamPayload,
  sanitizeSiteBrandingPayload,
  estimateExamBytes,
  ExamTooLargeError,
  syncAllToCloud,
  MAX_EXAM_DOC_BYTES,
} from './firebase';
import { Exam, DEFAULT_SITE_BRANDING } from './types/exam';

function createSampleExam(overrides: Partial<Exam> = {}): Exam {
  return {
    id: 'exam-test-1',
    examCode: '12345',
    title: 'Đề kiểm tra Lịch sử 12',
    category: 'Lịch sử',
    durationMinutes: 45,
    createdAt: '08/11/2026',
    uploadTime: '10:30',
    isFavorite: false,
    questions: [
      {
        id: 'q-1',
        number: 1,
        type: 'single',
        text: 'Câu 1: Nội dung câu hỏi 1?',
        imageUrl: 'data:image/jpeg;base64,' + 'A'.repeat(20_000),
        tableData: {
          title: 'Bảng 1',
          unit: '%',
          headers: ['Năm', '2020', '2024'],
          rows: [
            ['Việt Nam', '2,9', '7,1'],
            ['Thế giới', '-3,1', '3,2'],
          ],
          sourceNote: 'Niên giám thống kê',
        },
        options: {
          A: 'Đáp án A',
          B: 'Đáp án B',
          C: 'Đáp án C',
          D: 'Đáp án D',
        },
        correctAnswer: 'A',
      },
    ],
    ...overrides,
  };
}

test('sanitizeExamPayload: preserves all imageUrl when total UTF-8 size <= 900 KB and converts tableData.rows to { cells: string[] }[]', () => {
  const exam = createSampleExam({
    questions: Array.from({ length: 5 }, (_, i) => ({
      id: `q-${i + 1}`,
      number: i + 1,
      type: 'single',
      text: `Câu ${i + 1}: Nội dung câu hỏi`,
      imageUrl: 'data:image/jpeg;base64,' + 'B'.repeat(50_000),
      tableData: {
        headers: ['Cột 1', 'Cột 2'],
        rows: [
          ['Dòng 1A', 'Dòng 1B'],
          ['Dòng 2A', 'Dòng 2B'],
        ],
      },
      options: { A: 'A', B: 'B', C: 'C', D: 'D' },
      correctAnswer: 'A',
    })),
  });

  const bytes = estimateExamBytes(exam);
  assert.ok(bytes > 0 && bytes <= MAX_EXAM_DOC_BYTES);

  const { payload } = sanitizeExamPayload(exam);

  const questions = payload.questions as Array<Record<string, unknown>>;
  assert.equal(questions.length, 5);
  for (const q of questions) {
    assert.equal(typeof q.imageUrl, 'string');
    assert.ok((q.imageUrl as string).length > 50_000);
    const td = q.tableData as { rows: Array<{ cells: string[] }> };
    assert.ok(Array.isArray(td.rows));
    assert.ok(!Array.isArray(td.rows[0]), 'Rows must not be nested arrays');
    assert.deepEqual(td.rows[0], { cells: ['Dòng 1A', 'Dòng 1B'] });
  }
});

test('sanitizeExamPayload: throws ExamTooLargeError instead of silently dropping images when size > 900 KB', () => {
  const exam = createSampleExam({
    questions: Array.from({ length: 10 }, (_, i) => ({
      id: `q-${i + 1}`,
      number: i + 1,
      type: 'single',
      text: `Câu ${i + 1}: Câu hỏi có ảnh nặng`,
      imageUrl: 'data:image/jpeg;base64,' + 'X'.repeat(120_000),
      options: { A: 'A', B: 'B', C: 'C', D: 'D' },
      correctAnswer: 'A',
    })),
  });

  assert.throws(
    () => sanitizeExamPayload(exam),
    (err: unknown) => {
      assert.ok(err instanceof ExamTooLargeError);
      assert.match(err.message, /vượt giới hạn/i);
      assert.match(err.message, /câu 1/i);
      return true;
    }
  );
});

test('sanitizeExamPayload: throws ExamTooLargeError when questions.length > 500', () => {
  const exam = createSampleExam({
    questions: Array.from({ length: 501 }, (_, i) => ({
      id: `q-${i + 1}`,
      number: i + 1,
      type: 'single',
      text: `Câu ${i + 1}`,
      options: { A: 'A', B: 'B', C: 'C', D: 'D' },
      correctAnswer: 'A',
    })),
  });

  assert.throws(
    () => sanitizeExamPayload(exam),
    (err: unknown) => {
      assert.ok(err instanceof ExamTooLargeError);
      assert.match(err.message, /501 câu/i);
      return true;
    }
  );
});

test('syncAllToCloud: reports success === false, count === 2, failed.length === 1 when 1 of 3 exams fails', async () => {
  const exams: Exam[] = [
    createSampleExam({ id: 'exam-1', title: 'Đề 1' }),
    createSampleExam({ id: 'exam-2', title: 'Đề 2 (Nặng)' }),
    createSampleExam({ id: 'exam-3', title: 'Đề 3' }),
  ];

  const result = await syncAllToCloud(exams, DEFAULT_SITE_BRANDING, {
    saveExam: async (e) => {
      if (e.id === 'exam-2') {
        return { ok: false, error: 'Đề quá nặng so với giới hạn 1 MB của Firestore.' };
      }
      return { ok: true };
    },
    saveBranding: async () => ({ ok: true }),
  });

  assert.equal(result.success, false);
  assert.equal(result.count, 2);
  assert.equal(result.failed.length, 1);
  assert.equal(result.failed[0].id, 'exam-2');
  assert.equal(result.failed[0].title, 'Đề 2 (Nặng)');
});

test('sanitizeSiteBrandingPayload: preserves multiline subtitle with contributor credits up to 2000 characters', () => {
  const multilineSubtitle = [
    'Mục tri ân người đóng góp sửa chữa đáp án :',
    '- Nguyễn Công Quang (12B2)',
    '- Bạn Trần Minh Quân (Đóng góp đề Lý & Hóa)',
    '- Bạn Lê Thị Mai Anh (Rà soát đáp án Sinh học & Lịch sử)',
    '- Tập thể lớp 12B2 trường THPT',
    'Cảm ơn tất cả các bạn đã đồng hành xây dựng ngân hàng đề!',
  ].join('\n');

  assert.ok(multilineSubtitle.length > 200, 'Test string should exceed old 200-char limit');

  const payload = sanitizeSiteBrandingPayload({
    title: 'Ôn Tập Online',
    subtitle: multilineSubtitle,
    version: 'VERSION 3.6.6.7',
    logoUrl: '',
  });

  assert.equal(payload.subtitle, multilineSubtitle);
  assert.ok((payload.subtitle as string).includes('\n- Nguyễn Công Quang'));
});

