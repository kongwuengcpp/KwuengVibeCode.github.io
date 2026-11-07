import {
  Exam,
  ExamAttempt,
  OPTION_KEYS,
  OptionKey,
  Question,
  QuestionType,
  TrueFalseAnswerMap,
  UserAnswerValue,
} from '../types/exam';

export interface ParsedExamResult {
  questions: Question[];
  detectedAnswerKeyCount: number;
  warnings: string[];
}

export interface RawAnswerKeyEntry {
  type: 'single' | 'multiple' | 'short';
  single?: OptionKey;
  multiple?: OptionKey[];
  short?: string;
}

/**
 * Type guard for TrueFalseAnswerMap (`{ A?: boolean, B?: boolean, C?: boolean, D?: boolean }`).
 */
export function isTrueFalseAnswerMap(
  val: UserAnswerValue | undefined
): val is TrueFalseAnswerMap {
  return (
    typeof val === 'object' &&
    val !== null &&
    !Array.isArray(val)
  );
}

/**
 * Returns the list of TRUE ('Đúng') statement keys for a 'multiple' (Đúng/Sai) question.
 * Preserves empty array `[]` when all 4 statements are FALSE ('Sai').
 */
export function getQuestionTrueKeys(question: Question): OptionKey[] {
  if (Array.isArray(question.correctAnswers)) {
    return question.correctAnswers;
  }
  return question.correctAnswer ? [question.correctAnswer] : [];
}

/**
 * Normalizes a short-answer string for comparison:
 * - trims and collapses whitespace
 * - lowercases
 * - if numeric with comma (e.g. "2,5"), normalizes to "2.5"
 */
export function normalizeShortAnswer(val: string): string {
  const trimmed = val.trim().replace(/\s+/g, ' ').toLowerCase();
  if (/^-?\d+,\d+$/.test(trimmed)) {
    return trimmed.replace(',', '.');
  }
  return trimmed;
}

/**
 * Returns whether the user has provided an answer for a given question.
 */
export function isQuestionAnswered(
  question: Question,
  userAnswer: UserAnswerValue | undefined
): boolean {
  if (userAnswer === undefined || userAnswer === null) return false;
  const qType: QuestionType = question.type || 'single';
  if (qType === 'multiple') {
    if (Array.isArray(userAnswer)) {
      return userAnswer.length > 0;
    }
    if (isTrueFalseAnswerMap(userAnswer)) {
      return OPTION_KEYS.some((k) => typeof userAnswer[k] === 'boolean');
    }
    return false;
  }
  if (qType === 'short') {
    return typeof userAnswer === 'string' && userAnswer.trim().length > 0;
  }
  return typeof userAnswer === 'string' && ['A', 'B', 'C', 'D'].includes(userAnswer);
}

/**
 * Evaluates whether the user's answer for a question is completely correct.
 */
export function isQuestionCorrect(
  question: Question,
  userAnswer: UserAnswerValue | undefined
): boolean {
  if (!isQuestionAnswered(question, userAnswer)) return false;
  const qType: QuestionType = question.type || 'single';

  if (qType === 'multiple') {
    const targetTrueKeys = getQuestionTrueKeys(question);

    if (isTrueFalseAnswerMap(userAnswer)) {
      // Every statement A, B, C, D must have a boolean selection matching whether it is in targetTrueKeys
      return OPTION_KEYS.every((k) => {
        const chosen = userAnswer[k];
        if (typeof chosen !== 'boolean') return false;
        const expected = targetTrueKeys.includes(k);
        return chosen === expected;
      });
    }

    if (Array.isArray(userAnswer)) {
      const uniqueTarget = Array.from(new Set(targetTrueKeys)).sort();
      const uniqueUser = Array.from(new Set(userAnswer)).sort();
      if (uniqueTarget.length !== uniqueUser.length) return false;
      return uniqueTarget.every((k, i) => k === uniqueUser[i]);
    }

    return false;
  }

  if (qType === 'short') {
    if (typeof userAnswer !== 'string') return false;
    const rawExpected = (question.shortAnswer || '').trim();
    if (!rawExpected) return false;
    const normalizedUser = normalizeShortAnswer(userAnswer);
    const acceptedVariants = rawExpected
      .split(/[;|]/)
      .map((s) => normalizeShortAnswer(s))
      .filter(Boolean);
    return acceptedVariants.includes(normalizedUser);
  }

  // Default 'single'
  return userAnswer === question.correctAnswer;
}

/**
 * Determines whether the answer key / correctness feedback should be revealed for a question.
 * - Always true when the entire exam is submitted (`isSubmitted === true`).
 * - When `instantFeedback` is enabled during the exam:
 *   - For `'single'` choice: reveals immediately once an option is selected.
 *   - For `'multiple'` (Đúng/Sai) and `'short'` (Điền từ): requires the user to click
 *     the "Xác nhận" button (`isConfirmed === true`) so the answer is not leaked
 *     while the user is still checking boxes or typing characters.
 */
export function shouldShowInstantFeedback(
  question: Question,
  userAnswer: UserAnswerValue | undefined,
  state: {
    isSubmitted: boolean;
    instantFeedback: boolean;
    isConfirmed?: boolean;
  }
): boolean {
  if (state.isSubmitted) return true;
  if (!state.instantFeedback) return false;
  if (!isQuestionAnswered(question, userAnswer)) return false;

  const qType: QuestionType = question.type || 'single';
  if (qType === 'multiple' || qType === 'short') {
    return Boolean(state.isConfirmed);
  }
  return true;
}

/**
 * Formats the correct answer of a question for display in feedback UI.
 */
export function formatCorrectAnswerLabel(question: Question): string {
  const qType: QuestionType = question.type || 'single';
  if (qType === 'multiple') {
    const trueKeys = getQuestionTrueKeys(question);
    return OPTION_KEYS.map((k) => `${k}:${trueKeys.includes(k) ? 'Đ' : 'S'}`).join(' · ');
  }
  if (qType === 'short') {
    return question.shortAnswer || '';
  }
  return question.correctAnswer;
}

/**
 * Formats the user's answer for display in feedback UI.
 */
export function formatUserAnswerLabel(
  question: Question,
  userAnswer: UserAnswerValue | undefined
): string {
  if (!isQuestionAnswered(question, userAnswer)) return 'Chưa trả lời';
  const qType: QuestionType = question.type || 'single';
  if (qType === 'multiple') {
    if (isTrueFalseAnswerMap(userAnswer)) {
      return OPTION_KEYS.map((k) => {
        const v = userAnswer[k];
        if (v === true) return `${k}:Đ`;
        if (v === false) return `${k}:S`;
        return `${k}:-`;
      }).join(' · ');
    }
    if (Array.isArray(userAnswer)) {
      return userAnswer.join(', ');
    }
  }
  return String(userAnswer);
}

/**
 * Extracts a trailing answer key map (question number -> OptionKey)
 * and extended answer map (single, multiple like 1.AC, or short answer)
 * from sections like "ĐÁP ÁN", "BẢNG ĐÁP ÁN", "ANSWER KEY".
 */
export function extractAnswerKeyMap(rawText: string): Record<number, OptionKey> {
  const rich = extractRichAnswerKeyMap(rawText);
  const simple: Record<number, OptionKey> = {};
  for (const [k, v] of Object.entries(rich)) {
    const num = Number(k);
    if (v.type === 'single' && v.single) {
      simple[num] = v.single;
    } else if (v.type === 'multiple' && v.multiple && v.multiple[0]) {
      simple[num] = v.multiple[0];
    }
  }
  return simple;
}

export function extractRichAnswerKeyMap(rawText: string): Record<number, RawAnswerKeyEntry> {
  const map: Record<number, RawAnswerKeyEntry> = {};
  const lines = rawText.split(/\r?\n/);

  let inAnswerSection = false;
  const answerLines: string[] = [];

  for (const line of lines) {
    const trimmed = line.trim();
    if (
      /^(?:BẢNG\s+ĐÁP\s+ÁN|ĐÁP\s+ÁN(?:\s+CHI\s+TIẾT)?|ANSWER\s+KEY|ĐÁP\s+ÁN\s+ĐỀ\s+THI)\b/i.test(
        trimmed
      )
    ) {
      inAnswerSection = true;
      answerLines.push(trimmed);
      continue;
    }
    if (inAnswerSection) {
      answerLines.push(trimmed);
    }
  }

  const targetText = inAnswerSection ? answerLines.join('\n') : '';
  if (targetText) {
    // Match multi-choice or single-choice like "1.A", "2.AC", "2.A,C", "3: B"
    const pairRegex = /(?:Câu\s*)?(\d{1,3})\s*(?:[.:=\-\s]\s*)?([ABCD](?:\s*,\s*[ABCD]|[ABCD])*)\b/gi;
    let match: RegExpExecArray | null;
    while ((match = pairRegex.exec(targetText)) !== null) {
      const qNum = parseInt(match[1], 10);
      const rawLetters = match[2]
        .toUpperCase()
        .replace(/[^ABCD]/g, '')
        .split('') as OptionKey[];
      const uniqueLetters = Array.from(new Set(rawLetters));
      if (qNum > 0 && uniqueLetters.length === 1) {
        map[qNum] = { type: 'single', single: uniqueLetters[0] };
      } else if (qNum > 0 && uniqueLetters.length > 1) {
        map[qNum] = { type: 'multiple', multiple: uniqueLetters };
      }
    }
  }

  return map;
}

/**
 * Splits a block of text containing inline options (e.g. "A. opt1   B. opt2   C. opt3   D. opt4")
 * into discrete lines so each option is processed cleanly.
 */
function normalizeInlineOptions(text: string): string {
  return text
    .replace(/(\s{2,}|\t+|\n)\s*(\*?\[?[ABCD]\]?[.)]\s+)/g, '\n$2')
    .replace(/([.;?!])\s+(\*?[BCD][.)]\s+)/g, '$1\n$2');
}

/**
 * Parses raw text (extracted from Word .docx, pasted text, or OCR) into structured Question objects.
 * Supports:
 * - Single-choice ('single')
 * - Multiple-choice / True-False ('multiple', when 2+ options are starred *A, *C or Đáp án: A, C)
 * - Short-answer / Fill-in-the-blank ('short', when no A/B/C/D options exist and Đáp án: <text> is provided)
 * - Embedded images via `[IMAGE:<url_or_data_uri>]` or `Hình ảnh: <url>`
 */
export function parseExamText(rawText: string): ParsedExamResult {
  const warnings: string[] = [];
  if (!rawText || !rawText.trim()) {
    return { questions: [], detectedAnswerKeyCount: 0, warnings: ['Nội dung trống.'] };
  }

  const richAnswerMap = extractRichAnswerKeyMap(rawText);

  const bodyWithoutAnswerSection = rawText.replace(
    /\n\s*(?:BẢNG\s+ĐÁP\s+ÁN|ĐÁP\s+ÁN\s+ĐỀ\s+THI|ANSWER\s+KEY|ĐÁP\s+ÁN\s*(?:\r?\n|$))[\s\S]*$/i,
    ''
  );

  const normalizedText = normalizeInlineOptions(bodyWithoutAnswerSection);
  const lines = normalizedText
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0);

  const questionStartRegex = /^(?:Câu\s*(?:hỏi\s*)?|Question\s*|Bài\s*)(\d+)\s*[.:)\-]?\s*(.*)$/i;
  const numberedStartRegex = /^(\d{1,3})[.)]\s+(.+)$/;
  const optionLineRegex = /^(\*)?\s*\[?([ABCD])\]?[.)]\s*(.+)$/i;
  const inlineAnswerRegex = /^(?:Đáp\s*án(?:\s*đúng)?|Chọn(?:\s*đáp\s*án)?|Trả\s*lời(?:\s*ngắn)?|Điền\s*từ|Answer)\s*[:=\-]\s*(.+)$/i;
  const explanationRegex = /^(?:Lời\s*giải|Giải\s*thích|Hướng\s*dẫn(?:\s*giải)?)\s*[:.\-]?\s*(.*)$/i;
  const imageTagRegex = /\[(?:IMAGE|ẢNH|IMG)\s*:\s*([^\]]+)\]/i;
  const imageLineRegex = /^(?:Hình\s*ảnh|Ảnh\s*minh\s*hoạ|Image)\s*[:=]\s*(\S+)$/i;

  interface DraftQuestion {
    number: number;
    textLines: string[];
    imageUrl?: string;
    options: Partial<Record<OptionKey, string>>;
    starredOptions: OptionKey[];
    inlineAnswerRaw?: string;
    explanationLines: string[];
    currentField: 'text' | OptionKey | 'explanation';
  }

  const drafts: DraftQuestion[] = [];
  let current: DraftQuestion | null = null;

  const commitCurrent = () => {
    if (current) {
      drafts.push(current);
      current = null;
    }
  };

  for (let rawLine of lines) {
    // Extract inline [IMAGE:...] marker if present on any line
    const imgMatch = rawLine.match(imageTagRegex);
    let extractedImgOnLine: string | undefined;
    if (imgMatch) {
      extractedImgOnLine = imgMatch[1].trim();
      rawLine = rawLine.replace(imageTagRegex, '').trim();
    }

    if (!rawLine && extractedImgOnLine && current) {
      current.imageUrl = extractedImgOnLine;
      continue;
    }
    if (!rawLine) continue;

    // 1. Check explicit "Câu X:" start
    const qMatch = rawLine.match(questionStartRegex);
    if (qMatch) {
      commitCurrent();
      const qNum = parseInt(qMatch[1], 10);
      const remainder = qMatch[2].trim();
      current = {
        number: qNum,
        textLines: remainder ? [remainder] : [],
        imageUrl: extractedImgOnLine,
        options: {},
        starredOptions: [],
        explanationLines: [],
        currentField: 'text',
      };
      continue;
    }

    // 2. Check explicit Image line
    const imgLineMatch = rawLine.match(imageLineRegex);
    if (imgLineMatch && current) {
      current.imageUrl = imgLineMatch[1].trim();
      continue;
    }

    // 3. Check option line (A. / *A. / B. / C. / D.)
    const optMatch = rawLine.match(optionLineRegex);
    if (optMatch && current) {
      const isStarred = Boolean(optMatch[1]);
      const optKey = optMatch[2].toUpperCase() as OptionKey;
      let optText = optMatch[3].trim();

      if (/\(\s*đúng\s*\)$/i.test(optText)) {
        optText = optText.replace(/\(\s*đúng\s*\)$/i, '').trim();
        if (!current.starredOptions.includes(optKey)) {
          current.starredOptions.push(optKey);
        }
      } else if (/\(\s*sai\s*\)$/i.test(optText)) {
        optText = optText.replace(/\(\s*sai\s*\)$/i, '').trim();
      }

      if (isStarred && !current.starredOptions.includes(optKey)) {
        current.starredOptions.push(optKey);
      }

      current.options[optKey] = optText;
      current.currentField = optKey;
      if (extractedImgOnLine && !current.imageUrl) {
        current.imageUrl = extractedImgOnLine;
      }
      continue;
    }

    // 4. Check numbered question "1. ..."
    const numMatch = rawLine.match(numberedStartRegex);
    if (numMatch && (!current || Object.keys(current.options).length >= 2 || current.inlineAnswerRaw)) {
      commitCurrent();
      const qNum = parseInt(numMatch[1], 10);
      const remainder = numMatch[2].trim();
      current = {
        number: qNum,
        textLines: remainder ? [remainder] : [],
        imageUrl: extractedImgOnLine,
        options: {},
        starredOptions: [],
        explanationLines: [],
        currentField: 'text',
      };
      continue;
    }

    if (!current) {
      continue;
    }

    if (extractedImgOnLine && !current.imageUrl) {
      current.imageUrl = extractedImgOnLine;
    }

    // 5. Check inline answer line like "Đáp án: A" or "Đáp án: A, C" or "Đáp án: 1945"
    const ansMatch = rawLine.match(inlineAnswerRegex);
    if (ansMatch) {
      current.inlineAnswerRaw = ansMatch[1].trim();
      continue;
    }

    // 6. Check explanation line like "Lời giải: ..."
    const expMatch = rawLine.match(explanationRegex);
    if (expMatch) {
      current.currentField = 'explanation';
      if (expMatch[1].trim()) {
        current.explanationLines.push(expMatch[1].trim());
      }
      continue;
    }

    // 7. Append continuation line
    if (current.currentField === 'text') {
      current.textLines.push(rawLine);
    } else if (current.currentField === 'explanation') {
      current.explanationLines.push(rawLine);
    } else {
      const activeOpt = current.currentField;
      current.options[activeOpt] = `${current.options[activeOpt] || ''} ${rawLine}`.trim();
    }
  }

  commitCurrent();

  let detectedAnswerKeyCount = 0;
  const questions: Question[] = [];

  drafts.forEach((draft, idx) => {
    const qNumber = draft.number || idx + 1;
    const rawPrompt = draft.textLines.join(' ').trim();
    const cleanedPrompt =
      rawPrompt.replace(/^(?:Câu\s*\d+\s*[.:)\-]\s*)/i, '').trim() || `Câu hỏi số ${qNumber}`;

    const hasOptions = Object.keys(draft.options).length > 0;
    const keyEntry = richAnswerMap[qNumber] || richAnswerMap[idx + 1];

    let qType: QuestionType = 'single';
    let correctAnswer: OptionKey = 'A';
    let correctAnswers: OptionKey[] | undefined;
    let shortAnswer: string | undefined;
    let hasDetectedAnswer = false;

    if (!hasOptions) {
      // Short-answer / Fill-in-the-blank question
      qType = 'short';
      if (draft.inlineAnswerRaw) {
        shortAnswer = draft.inlineAnswerRaw;
        hasDetectedAnswer = true;
      } else if (keyEntry?.short) {
        shortAnswer = keyEntry.short;
        hasDetectedAnswer = true;
      } else {
        shortAnswer = '';
        warnings.push(`Câu ${qNumber} (Điền từ): Chưa có đáp án mẫu.`);
      }
    } else {
      // Has options A, B, C, D -> check if multiple or single
      let resolvedMulti: OptionKey[] = [...draft.starredOptions];
      const isExplicitMulti =
        /(?:Đúng\s*[\/-]\s*Sai|Nhiều\s*lựa\s*chọn|Phần\s*II)\b/i.test(rawPrompt) ||
        Boolean(
          draft.inlineAnswerRaw &&
            /(?:Đúng|Sai|[ABCD]\s*[:=-]\s*[ĐS]|toàn\s*(?:đúng|sai))/i.test(draft.inlineAnswerRaw)
        );

      if (draft.inlineAnswerRaw) {
        // Check for format: A: Đúng, B: Sai or A: Đ, B: S
        const tfRegex = /([ABCD])\s*[:=\-]?\s*(Đúng|Đ|True|T|Sai|S|False|F)\b/gi;
        let tfMatch: RegExpExecArray | null;
        let hasTfMatch = false;
        const matchedTrueLetters: OptionKey[] = [];
        while ((tfMatch = tfRegex.exec(draft.inlineAnswerRaw)) !== null) {
          hasTfMatch = true;
          const letter = tfMatch[1].toUpperCase() as OptionKey;
          const status = tfMatch[2].toUpperCase();
          if (['ĐÚNG', 'Đ', 'TRUE', 'T'].includes(status)) {
            matchedTrueLetters.push(letter);
          }
        }
        if (hasTfMatch) {
          resolvedMulti = Array.from(new Set([...resolvedMulti, ...matchedTrueLetters]));
        } else {
          const letters = draft.inlineAnswerRaw
            .toUpperCase()
            .split(/[\s,;]+/)
            .filter((t): t is OptionKey => ['A', 'B', 'C', 'D'].includes(t));
          if (letters.length > 0) {
            resolvedMulti = Array.from(new Set([...resolvedMulti, ...letters]));
          } else if (/^[ABCD]{2,4}$/i.test(draft.inlineAnswerRaw.trim())) {
            resolvedMulti = Array.from(
              new Set(draft.inlineAnswerRaw.toUpperCase().split('') as OptionKey[])
            );
          }
        }
      }

      if (resolvedMulti.length === 0 && keyEntry) {
        if (keyEntry.type === 'multiple' && keyEntry.multiple) {
          resolvedMulti = keyEntry.multiple;
        } else if (keyEntry.type === 'single' && keyEntry.single) {
          resolvedMulti = [keyEntry.single];
        }
      }

      if (resolvedMulti.length > 1 || isExplicitMulti) {
        qType = 'multiple';
        correctAnswers = resolvedMulti;
        correctAnswer = resolvedMulti[0] || 'A';
        hasDetectedAnswer = true;
      } else if (resolvedMulti.length === 1) {
        qType = 'single';
        correctAnswer = resolvedMulti[0];
        hasDetectedAnswer = true;
      } else {
        qType = 'single';
        correctAnswer = 'A';
        warnings.push(
          `Câu ${qNumber}: Chưa phát hiện đáp án đúng (mặc định chọn A, bạn có thể chỉnh lại).`
        );
      }
    }

    if (hasDetectedAnswer) {
      detectedAnswerKeyCount++;
    }

    const options: Record<OptionKey, string> = {
      A: draft.options.A || 'Phương án A',
      B: draft.options.B || 'Phương án B',
      C: draft.options.C || 'Phương án C',
      D: draft.options.D || 'Phương án D',
    };

    questions.push({
      id: `q-${Date.now()}-${idx + 1}`,
      number: idx + 1,
      type: qType,
      text: cleanedPrompt,
      imageUrl: draft.imageUrl,
      options,
      correctAnswer,
      correctAnswers,
      shortAnswer,
      explanation:
        draft.explanationLines.length > 0 ? draft.explanationLines.join(' ') : undefined,
    });
  });

  return {
    questions,
    detectedAnswerKeyCount,
    warnings,
  };
}

/**
 * Fisher-Yates shuffle that returns a new array without mutating the input.
 */
export function shuffleArray<T>(
  items: readonly T[],
  rng: () => number = Math.random
): T[] {
  const arr = [...items];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const temp = arr[i];
    arr[i] = arr[j];
    arr[j] = temp;
  }
  return arr;
}

/**
 * Shuffles options A, B, C, D of a question (for 'single' or 'multiple' question types)
 * and updates correctAnswer / correctAnswers so the correct option text(s) remain mapped
 * to their new letter keys.
 */
export function shuffleQuestionOptions(
  question: Question,
  rng: () => number = Math.random
): Question {
  const qType: QuestionType = question.type || 'single';
  if (qType === 'short') {
    return {
      ...question,
      options: { ...question.options },
    };
  }

  // permutedOldKeys[newIdx] is the old key whose text moves to OPTION_KEYS[newIdx]
  const permutedOldKeys = shuffleArray(OPTION_KEYS, rng);
  const newOptions: Record<OptionKey, string> = {
    A: '',
    B: '',
    C: '',
    D: '',
  };
  const oldToNewKeyMap: Record<OptionKey, OptionKey> = {
    A: 'A',
    B: 'B',
    C: 'C',
    D: 'D',
  };

  OPTION_KEYS.forEach((newKey, idx) => {
    const oldKey = permutedOldKeys[idx];
    newOptions[newKey] = question.options[oldKey];
    oldToNewKeyMap[oldKey] = newKey;
  });

  const newCorrectAnswer = oldToNewKeyMap[question.correctAnswer] || 'A';
  let newCorrectAnswers: OptionKey[] | undefined;

  if (qType === 'multiple') {
    const sourceList = getQuestionTrueKeys(question);
    newCorrectAnswers = sourceList
      .map((oldK) => oldToNewKeyMap[oldK])
      .sort() as OptionKey[];
  }

  return {
    ...question,
    options: newOptions,
    correctAnswer: newCorrectAnswer,
    correctAnswers: newCorrectAnswers,
  };
}

export interface QuestionSectionMeta {
  type: QuestionType;
  partLabel: string;
  title: string;
  shortTitle: string;
  description: string;
}

export const QUESTION_SECTIONS: QuestionSectionMeta[] = [
  {
    type: 'single',
    partLabel: 'PHẦN I',
    title: 'Trắc nghiệm nhiều phương án lựa chọn',
    shortTitle: 'Phần I · Trắc nghiệm',
    description: 'Mỗi câu hỏi thí sinh chỉ chọn một phương án đúng A, B, C hoặc D.',
  },
  {
    type: 'multiple',
    partLabel: 'PHẦN II',
    title: 'Câu hỏi trắc nghiệm Đúng / Sai',
    shortTitle: 'Phần II · Đúng / Sai',
    description: 'Trong mỗi ý A, B, C, D ở mỗi câu, thí sinh chọn Đúng hoặc Sai.',
  },
  {
    type: 'short',
    partLabel: 'PHẦN III',
    title: 'Câu hỏi trả lời ngắn / Điền từ',
    shortTitle: 'Phần III · Trả lời ngắn',
    description: 'Thí sinh điền câu trả lời ngắn hoặc kết quả vào ô trống.',
  },
];

/**
 * Organizes questions into 3 separate sections ('single', 'multiple', 'short').
 * When `shuffleQuestions` is enabled, questions are shuffled ONLY within their own section
 * so Trắc nghiệm, Đúng/Sai, and Trả lời ngắn are never mixed together.
 * When `shuffleOptions` is enabled, options A, B, C, D are shuffled within each question.
 */
export function organizeQuestionsBySection(
  questions: readonly Question[],
  config: {
    shuffleQuestions?: boolean;
    shuffleOptions?: boolean;
    targetSectionToShuffle?: QuestionType;
  } = {},
  rng: () => number = Math.random
): Question[] {
  const cloned = questions.map((q) => ({
    ...q,
    type: (q.type || 'single') as QuestionType,
    options: { ...q.options },
    correctAnswers: q.correctAnswers ? [...q.correctAnswers] : undefined,
  }));

  const grouped: Record<QuestionType, Question[]> = {
    single: [],
    multiple: [],
    short: [],
  };

  for (const q of cloned) {
    const qType: QuestionType = q.type || 'single';
    grouped[qType].push(q);
  }

  const ordered: Question[] = [];
  for (const sec of QUESTION_SECTIONS) {
    const bucket = grouped[sec.type];
    const shouldShuffleThisBucket =
      Boolean(config.shuffleQuestions) &&
      (!config.targetSectionToShuffle || config.targetSectionToShuffle === sec.type);
    const processedBucket = shouldShuffleThisBucket
      ? shuffleArray(bucket, rng)
      : bucket;
    ordered.push(...processedBucket);
  }

  return ordered.map((q, idx) => {
    const shouldShuffleOpts =
      Boolean(config.shuffleOptions) &&
      (!config.targetSectionToShuffle || config.targetSectionToShuffle === (q.type || 'single'));
    const withOptions = shouldShuffleOpts ? shuffleQuestionOptions(q, rng) : q;
    return {
      ...withOptions,
      number: idx + 1,
    };
  });
}

/**
 * Groups an array of questions into the 3 standard sections ('single', 'multiple', 'short')
 * while preserving each question's global `.number` and providing 1-based `sectionIndex` within each section.
 */
export function groupQuestionsIntoSections(
  questions: readonly Question[]
): Array<
  QuestionSectionMeta & {
    items: Array<{ question: Question; globalIndex: number; sectionNumber: number }>;
  }
> {
  return QUESTION_SECTIONS.map((meta) => {
    const items: Array<{ question: Question; globalIndex: number; sectionNumber: number }> = [];
    questions.forEach((q, idx) => {
      const qType: QuestionType = q.type || 'single';
      if (qType === meta.type) {
        items.push({
          question: q,
          globalIndex: idx,
          sectionNumber: items.length + 1,
        });
      }
    });
    return {
      ...meta,
      items,
    };
  });
}

/**
 * Returns a new Exam with questions organized into sections ('single' -> 'multiple' -> 'short')
 * and shuffled within each section (never mixing different question types together).
 */
export function createShuffledExam(
  exam: Exam,
  config: { shuffleQuestions: boolean; shuffleOptions: boolean },
  rng: () => number = Math.random
): Exam {
  const finalQuestions = organizeQuestionsBySection(
    exam.questions,
    {
      shuffleQuestions: config.shuffleQuestions,
      shuffleOptions: config.shuffleOptions,
    },
    rng
  );

  return {
    ...exam,
    questions: finalQuestions,
  };
}

/**
 * Pure client-side grading function supporting single-choice, multiple-choice (true/false), and short-answer questions.
 */
export function gradeExam(
  exam: Exam,
  answers: Record<string, UserAnswerValue>,
  durationSeconds: number,
  completedAtDate: Date = new Date()
): ExamAttempt {
  const totalQuestions = exam.questions.length;
  let correctCount = 0;
  let wrongCount = 0;
  let unansweredCount = 0;

  for (const q of exam.questions) {
    const userAns = answers[q.id];
    if (!isQuestionAnswered(q, userAns)) {
      unansweredCount++;
    } else if (isQuestionCorrect(q, userAns)) {
      correctCount++;
    } else {
      wrongCount++;
    }
  }

  const scorePercent =
    totalQuestions > 0 ? Math.round((correctCount / totalQuestions) * 100) : 0;
  const scoreTen =
    totalQuestions > 0 ? Number(((correctCount / totalQuestions) * 10).toFixed(2)) : 0;

  const day = String(completedAtDate.getDate()).padStart(2, '0');
  const month = String(completedAtDate.getMonth() + 1).padStart(2, '0');
  const year = completedAtDate.getFullYear();

  return {
    id: `attempt-${completedAtDate.getTime()}`,
    examId: exam.id,
    examTitle: exam.title,
    completedAt: `${day}/${month}/${year}`,
    durationSeconds: Math.max(1, Math.round(durationSeconds)),
    totalQuestions,
    correctCount,
    wrongCount,
    unansweredCount,
    scorePercent,
    scoreTen,
    answers: { ...answers },
    questionsSnapshot: exam.questions.map((q) => ({
      ...q,
      options: { ...q.options },
      correctAnswers: q.correctAnswers ? [...q.correctAnswers] : undefined,
    })),
  };
}

