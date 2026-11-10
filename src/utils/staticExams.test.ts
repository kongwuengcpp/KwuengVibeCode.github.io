import test from 'node:test';
import assert from 'node:assert/strict';
import { parseStaticExamsPayload } from './staticExams';

const exam = (id: string, nQ = 1) => ({
  id, title: `Đề ${id}`, category: 'GDKT & PL', durationMinutes: 45, createdAt: '10/11/2026',
  questions: Array.from({ length: nQ }, (_, i) => ({ id: `q${i}`, number: i + 1, text: 'x', options: { A: 'a', B: 'b', C: 'c', D: 'd' }, correctAnswer: 'A' })),
});

test('đọc được cả dạng { branding, exams } lẫn mảng đề', () => {
  assert.equal(parseStaticExamsPayload({ branding: {}, exams: [exam('a'), exam('b')] }).length, 2);
  assert.equal(parseStaticExamsPayload([exam('a')]).length, 1);
});

test('bỏ đề hỏng, đề không có câu hỏi và id trùng', () => {
  const out = parseStaticExamsPayload([exam('a'), exam('a'), exam('empty', 0), { id: 'x' }, null, 'str']);
  assert.deepEqual(out.map((e) => e.id), ['a']);
});

test('dữ liệu rác hoặc file rỗng trả về mảng rỗng (để quay lại dùng Firestore)', () => {
  assert.deepEqual(parseStaticExamsPayload([]), []);
  assert.deepEqual(parseStaticExamsPayload(null), []);
  assert.deepEqual(parseStaticExamsPayload({ exams: 'no' }), []);
});
