import test from 'node:test';
import assert from 'node:assert/strict';
import {
  parseExamText,
  extractAnswerKeyMap,
  gradeExam,
  isQuestionCorrect,
  shuffleQuestionOptions,
  createShuffledExam,
  organizeQuestionsBySection,
  groupQuestionsIntoSections,
  shouldShowInstantFeedback,
} from './examParser';
import { Exam } from '../types/exam';
import { generateSampleDocxArrayBuffer, extractTextFromDocxBuffer } from './docxHelper';
import { resolveAppRoute, verifyAdminKey } from './accessControl';

test('parses standard Vietnamese multiple choice questions with starred correct answers', () => {
  const sampleText = `
Câu 1: Các cuộc cách mạng tư sản thế kỉ XVI-XVIII có hai nhiệm vụ cơ bản là
*A. dân tộc và dân chủ.
B. dân tộc và dân sinh.
C. độc lập và tự do.
D. dân chủ và dân quyền.

Câu 2: Một trong những lực lượng lãnh đạo chủ yếu của các cuộc cách mạng tư sản thế kỉ XVI – XVIII là giai cấp
*A. tư sản.
B. công nhân.
C. nông dân.
D. địa chủ.
  `;

  const result = parseExamText(sampleText);
  assert.equal(result.questions.length, 2);
  assert.equal(result.detectedAnswerKeyCount, 2);
  assert.equal(result.questions[0].type, 'single');
  assert.equal(result.questions[0].correctAnswer, 'A');
  assert.equal(result.questions[1].correctAnswer, 'A');
});

test('parses multiple-choice (Đúng/Sai), short-answer (Điền từ), and image tags accurately', () => {
  const mixedText = `
Câu 1: Quan sát hình và chọn đáp án đúng
[IMAGE:data:image/svg+xml;utf8,<svg></svg>]
*A. Phương án đúng.
B. Phương án sai.
C. Phương án C.
D. Phương án D.

Câu 2: (Nhiều lựa chọn - Đúng/Sai) Chọn các nhận định đúng:
*A. Nhận định đúng 1.
B. Nhận định sai 1.
*C. Nhận định đúng 2.
D. Nhận định sai 2.

Câu 3: (Điền từ) Việt Nam gia nhập ASEAN vào năm nào?
Đáp án: 1995
Lời giải: Ngày 28/7/1995.
  `;

  const result = parseExamText(mixedText);
  assert.equal(result.questions.length, 3);

  // Q1: Single choice with image
  assert.equal(result.questions[0].type, 'single');
  assert.equal(result.questions[0].imageUrl, 'data:image/svg+xml;utf8,<svg></svg>');
  assert.equal(result.questions[0].correctAnswer, 'A');

  // Q2: Multiple choice (Đúng/Sai)
  assert.equal(result.questions[1].type, 'multiple');
  assert.deepEqual(result.questions[1].correctAnswers, ['A', 'C']);

  // Q3: Short answer (Điền từ)
  assert.equal(result.questions[2].type, 'short');
  assert.equal(result.questions[2].shortAnswer, '1995');
});

test('grades single-choice, multiple-choice (Đúng/Sai), and short-answer (Điền từ) accurately in browser', () => {
  const mockExam: Exam = {
    id: 'exam-mixed',
    title: 'Đề kiểm tra tổng hợp 3 dạng',
    category: 'Lớp 12',
    durationMinutes: 45,
    createdAt: '06/11/2026',
    questions: [
      {
        id: 'q1',
        number: 1,
        type: 'single',
        text: 'Câu trắc nghiệm 1 lựa chọn',
        options: { A: '1', B: '2', C: '3', D: '4' },
        correctAnswer: 'A',
      },
      {
        id: 'q2',
        number: 2,
        type: 'multiple',
        text: 'Câu hỏi Đúng/Sai nhiều lựa chọn',
        options: { A: 'Ý 1', B: 'Ý 2', C: 'Ý 3', D: 'Ý 4' },
        correctAnswer: 'A',
        correctAnswers: ['A', 'C'],
      },
      {
        id: 'q3',
        number: 3,
        type: 'short',
        text: 'Câu điền từ trả lời ngắn',
        options: { A: '', B: '', C: '', D: '' },
        correctAnswer: 'A',
        shortAnswer: 'Lê-nin; Lênin; Lenin',
      },
      {
        id: 'q4',
        number: 4,
        type: 'short',
        text: 'Câu điền số thập phân',
        options: { A: '', B: '', C: '', D: '' },
        correctAnswer: 'A',
        shortAnswer: '2,5',
      },
    ],
  };

  assert.equal(isQuestionCorrect(mockExam.questions[1], ['C', 'A']), true);
  assert.equal(isQuestionCorrect(mockExam.questions[1], ['A']), false);
  assert.equal(isQuestionCorrect(mockExam.questions[2], '  lênin '), true);
  assert.equal(isQuestionCorrect(mockExam.questions[3], '2.5'), true);

  const attempt = gradeExam(
    mockExam,
    {
      q1: 'A', // Correct
      q2: ['A', 'C'], // Correct
      q3: 'Lênin', // Correct
      q4: '3.0', // Wrong
    },
    120,
    new Date('2026-11-06T10:00:00Z')
  );

  assert.equal(attempt.totalQuestions, 4);
  assert.equal(attempt.correctCount, 3);
  assert.equal(attempt.wrongCount, 1);
  assert.equal(attempt.unansweredCount, 0);
  assert.equal(attempt.scorePercent, 75);
  assert.equal(attempt.scoreTen, 7.5);
});

test('extracts single, multiple, short-answer, and image from a real .docx buffer', async () => {
  const docxBuffer = await generateSampleDocxArrayBuffer();
  const extractedText = await extractTextFromDocxBuffer(docxBuffer);
  const parsed = parseExamText(extractedText);

  assert.equal(parsed.questions.length, 5);
  assert.equal(parsed.questions[0].type, 'single');
  assert.equal(Boolean(parsed.questions[0].imageUrl), true);
  assert.equal(parsed.questions[0].correctAnswer, 'A');

  assert.equal(parsed.questions[1].type, 'multiple');
  assert.deepEqual(parsed.questions[1].correctAnswers, ['A', 'C']);

  assert.equal(parsed.questions[2].type, 'single');
  assert.equal(parsed.questions[2].correctAnswer, 'D');

  assert.equal(parsed.questions[3].type, 'short');
  assert.equal(parsed.questions[3].shortAnswer, '1995');

  assert.equal(parsed.questions[4].type, 'short');
  assert.equal(parsed.questions[4].shortAnswer?.includes('Lê-nin'), true);
});

test('returns forbidden route ("bạn không nên ở đây") when accessing invalid exam links or non-admin create page', () => {
  const exams = [{ id: 'on-tap-su-tn-do-bi-lo' }, { id: 'sinh-hoc-12-giua-ki-1' }];

  const validPath = resolveAppRoute('/lam-bai/on-tap-su-tn-do-bi-lo', '', exams, false);
  assert.equal(validPath.type, 'take-exam');

  const invalidPath = resolveAppRoute('/lam-bai/de-khong-ton-tai', '', exams, false);
  assert.equal(invalidPath.type, 'forbidden');

  const guestCreate = resolveAppRoute('/nguoi-dung/tao-de', '', exams, false);
  assert.equal(guestCreate.type, 'forbidden');

  const adminCreate = resolveAppRoute('/nguoi-dung/tao-de', '', exams, true);
  assert.equal(adminCreate.type, 'create-exam');

  // GitHub Pages subdirectory path support (e.g. username.github.io/luyen-de-online/)
  const ghPagesDashboard = resolveAppRoute('/luyen-de-online/', '', exams, false);
  assert.equal(ghPagesDashboard.type, 'dashboard');

  const ghPagesExam = resolveAppRoute(
    '/luyen-de-online/',
    '?de=on-tap-su-tn-do-bi-lo',
    exams,
    false
  );
  assert.equal(ghPagesExam.type, 'take-exam');

  const ghPagesInvalidExam = resolveAppRoute(
    '/luyen-de-online/',
    '?de=khong-ton-tai',
    exams,
    false
  );
  assert.equal(ghPagesInvalidExam.type, 'forbidden');
});

test('verifies console admin key accurately', () => {
  assert.equal(verifyAdminKey('wangwibu2026'), true);
  assert.equal(verifyAdminKey('wrong-key'), false);
  assert.equal(extractAnswerKeyMap('BẢNG ĐÁP ÁN\n1.A 2.B')[2], 'B');
});

test('shuffles questions and options within each section without mixing unrelated sections', () => {
  const sampleExam: Exam = {
    id: 'exam-shuffle',
    title: 'Đề kiểm tra đảo câu hỏi & đáp án theo từng phần',
    category: 'Lớp 12',
    durationMinutes: 45,
    createdAt: '06/11/2026',
    questions: [
      {
        id: 'q1-single',
        number: 1,
        type: 'single',
        text: 'Câu 1 Trắc nghiệm',
        options: {
          A: 'Đáp án đúng duy nhất',
          B: 'Đáp án sai 1',
          C: 'Đáp án sai 2',
          D: 'Đáp án sai 3',
        },
        correctAnswer: 'A',
      },
      {
        id: 'q2-multi',
        number: 2,
        type: 'multiple',
        text: 'Câu 2 Đúng/Sai',
        options: {
          A: 'Mệnh đề ĐÚNG 1',
          B: 'Mệnh đề SAI 1',
          C: 'Mệnh đề SAI 2',
          D: 'Mệnh đề ĐÚNG 2',
        },
        correctAnswer: 'A',
        correctAnswers: ['A', 'D'],
      },
      {
        id: 'q3-short',
        number: 3,
        type: 'short',
        text: 'Câu 3 Điền từ',
        options: { A: '', B: '', C: '', D: '' },
        correctAnswer: 'A',
        shortAnswer: '1945',
      },
      {
        id: 'q4-single',
        number: 4,
        type: 'single',
        text: 'Câu 4 Trắc nghiệm',
        options: { A: '1', B: '2', C: '3', D: '4' },
        correctAnswer: 'B',
      },
      {
        id: 'q5-multi',
        number: 5,
        type: 'multiple',
        text: 'Câu 5 Đúng/Sai',
        options: { A: 'Ý 1', B: 'Ý 2', C: 'Ý 3', D: 'Ý 4' },
        correctAnswer: 'A',
        correctAnswers: ['B'],
      },
      {
        id: 'q6-short',
        number: 6,
        type: 'short',
        text: 'Câu 6 Điền từ',
        options: { A: '', B: '', C: '', D: '' },
        correctAnswer: 'A',
        shortAnswer: '1975',
      },
    ],
  };

  // Deterministic RNG that reverses 2-element arrays (always returns 0)
  const deterministicRng = () => 0;

  const shuffledSingle = shuffleQuestionOptions(sampleExam.questions[0], deterministicRng);
  assert.equal(
    shuffledSingle.options[shuffledSingle.correctAnswer],
    'Đáp án đúng duy nhất'
  );
  assert.equal(isQuestionCorrect(shuffledSingle, shuffledSingle.correctAnswer), true);

  const shuffledMulti = shuffleQuestionOptions(sampleExam.questions[1], deterministicRng);
  const newTrueTexts = (shuffledMulti.correctAnswers || [])
    .map((k) => shuffledMulti.options[k])
    .sort();
  assert.deepEqual(newTrueTexts, ['Mệnh đề ĐÚNG 1', 'Mệnh đề ĐÚNG 2']);
  assert.equal(isQuestionCorrect(shuffledMulti, shuffledMulti.correctAnswers), true);

  const fullShuffled = createShuffledExam(
    sampleExam,
    { shuffleQuestions: true, shuffleOptions: true },
    deterministicRng
  );
  assert.equal(fullShuffled.questions.length, 6);
  assert.deepEqual(
    fullShuffled.questions.map((q) => q.number),
    [1, 2, 3, 4, 5, 6]
  );
  // Questions are grouped by section (single -> multiple -> short) and shuffled ONLY within each section
  assert.deepEqual(
    fullShuffled.questions.map((q) => q.id),
    ['q4-single', 'q1-single', 'q5-multi', 'q2-multi', 'q6-short', 'q3-short']
  );

  const grouped = groupQuestionsIntoSections(
    organizeQuestionsBySection(sampleExam.questions, {
      shuffleQuestions: false,
      shuffleOptions: false,
    })
  );
  assert.equal(grouped.length, 3);
  assert.deepEqual(
    grouped[0].items.map((item) => item.question.id),
    ['q1-single', 'q4-single']
  );
  assert.deepEqual(
    grouped[1].items.map((item) => item.question.id),
    ['q2-multi', 'q5-multi']
  );
  assert.deepEqual(
    grouped[2].items.map((item) => item.question.id),
    ['q3-short', 'q6-short']
  );
});

test('shouldShowInstantFeedback requires confirmation for multiple-choice and short-answer before revealing answers', () => {
  const qSingle = {
    id: 'q1',
    number: 1,
    type: 'single' as const,
    text: 'Câu trắc nghiệm',
    options: { A: '1', B: '2', C: '3', D: '4' },
    correctAnswer: 'A' as const,
  };
  const qMulti = {
    id: 'q2',
    number: 2,
    type: 'multiple' as const,
    text: 'Câu đúng sai',
    options: { A: '1', B: '2', C: '3', D: '4' },
    correctAnswer: 'A' as const,
    correctAnswers: ['A' as const, 'C' as const],
  };
  const qShort = {
    id: 'q3',
    number: 3,
    type: 'short' as const,
    text: 'Câu điền từ',
    options: { A: '', B: '', C: '', D: '' },
    correctAnswer: 'A' as const,
    shortAnswer: '1995',
  };

  // Single choice reveals immediately when instantFeedback is true
  assert.equal(
    shouldShowInstantFeedback(qSingle, 'A', {
      isSubmitted: false,
      instantFeedback: true,
      isConfirmed: false,
    }),
    true
  );

  // Multiple choice does NOT reveal while user is still selecting checkboxes (isConfirmed: false)
  assert.equal(
    shouldShowInstantFeedback(qMulti, ['A'], {
      isSubmitted: false,
      instantFeedback: true,
      isConfirmed: false,
    }),
    false
  );
  // Multiple choice reveals once confirmed (isConfirmed: true)
  assert.equal(
    shouldShowInstantFeedback(qMulti, ['A', 'C'], {
      isSubmitted: false,
      instantFeedback: true,
      isConfirmed: true,
    }),
    true
  );

  // Short answer does NOT reveal while user is still typing characters (isConfirmed: false)
  assert.equal(
    shouldShowInstantFeedback(qShort, '19', {
      isSubmitted: false,
      instantFeedback: true,
      isConfirmed: false,
    }),
    false
  );
  // Short answer reveals once confirmed (isConfirmed: true)
  assert.equal(
    shouldShowInstantFeedback(qShort, '1995', {
      isSubmitted: false,
      instantFeedback: true,
      isConfirmed: true,
    }),
    true
  );
});

test('supports 2-box Đúng/Sai questions including all-True and all-False answer keys', () => {
  const qAllFalse = {
    id: 'q-all-false',
    number: 1,
    type: 'multiple' as const,
    text: 'Câu hỏi Đúng/Sai mà cả 4 phát biểu đều SAI',
    options: { A: 'Sai 1', B: 'Sai 2', C: 'Sai 3', D: 'Sai 4' },
    correctAnswer: 'A' as const,
    correctAnswers: [],
  };

  const qAllTrue = {
    id: 'q-all-true',
    number: 2,
    type: 'multiple' as const,
    text: 'Câu hỏi Đúng/Sai mà cả 4 phát biểu đều ĐÚNG',
    options: { A: 'Đúng 1', B: 'Đúng 2', C: 'Đúng 3', D: 'Đúng 4' },
    correctAnswer: 'A' as const,
    correctAnswers: ['A' as const, 'B' as const, 'C' as const, 'D' as const],
  };

  // All-False question graded with 2-box map
  assert.equal(
    isQuestionCorrect(qAllFalse, { A: false, B: false, C: false, D: false }),
    true
  );
  assert.equal(
    isQuestionCorrect(qAllFalse, { A: true, B: false, C: false, D: false }),
    false
  );
  // Incomplete selection (only 3 of 4 chosen) is not yet completely correct
  assert.equal(
    isQuestionCorrect(qAllFalse, { A: false, B: false, C: false }),
    false
  );

  // All-True question graded with 2-box map
  assert.equal(
    isQuestionCorrect(qAllTrue, { A: true, B: true, C: true, D: true }),
    true
  );
  assert.equal(
    isQuestionCorrect(qAllTrue, { A: true, B: true, C: true, D: false }),
    false
  );

  // Shuffling options preserves all-False ([]) and all-True (['A','B','C','D'])
  const shuffledAllFalse = shuffleQuestionOptions(qAllFalse, () => 0);
  assert.deepEqual(shuffledAllFalse.correctAnswers, []);
  const shuffledAllTrue = shuffleQuestionOptions(qAllTrue, () => 0);
  assert.deepEqual(shuffledAllTrue.correctAnswers, ['A', 'B', 'C', 'D']);
});



