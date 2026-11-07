export type OptionKey = 'A' | 'B' | 'C' | 'D';

export const OPTION_KEYS: OptionKey[] = ['A', 'B', 'C', 'D'];

export type QuestionType = 'single' | 'multiple' | 'short';

export interface QuestionTableData {
  title?: string; // Ví dụ: "Bảng 1. Tốc độ tăng trưởng GDP giai đoạn 2020 - 2023"
  unit?: string; // Ví dụ: "Đơn vị: %"
  headers: string[]; // Cột tiêu đề: ["Năm", "2020", "2021", "2022", "2023"]
  rows: string[][]; // Các dòng số liệu: [["Việt Nam", "2,9", "2,6", "8,0", "5,05"]]
  sourceNote?: string; // Ví dụ: "Nguồn: Tổng cục Thống kê"
}

export interface Question {
  id: string;
  number: number;
  type?: QuestionType; // default 'single'
  text: string;
  imageUrl?: string; // Base64 data URL or image link
  tableData?: QuestionTableData; // Bảng số liệu đi kèm câu hỏi
  options: Record<OptionKey, string>;
  correctAnswer: OptionKey; // Used when type === 'single'
  /**
   * Used when type === 'multiple' (Câu hỏi Đúng/Sai).
   * Contains all OptionKeys ('A' | 'B' | 'C' | 'D') that are TRUE (Đúng).
   * Any OptionKey not in this array is FALSE (Sai).
   * Can be empty `[]` if all 4 statements are Sai, or `['A','B','C','D']` if all 4 are Đúng.
   */
  correctAnswers?: OptionKey[];
  shortAnswer?: string; // Used when type === 'short' (câu điền từ / trả lời ngắn, hỗ trợ nhiều đáp án cách nhau bởi ';')
  explanation?: string;
}

/**
 * Map of statement key ('A' | 'B' | 'C' | 'D') to user's chosen boolean:
 * `true` = Đúng, `false` = Sai.
 */
export type TrueFalseAnswerMap = Partial<Record<OptionKey, boolean>>;

/**
 * User's answer for a single question:
 * - For 'single': OptionKey ('A' | 'B' | 'C' | 'D')
 * - For 'multiple' (Đúng/Sai): TrueFalseAnswerMap (e.g. { A: true, B: false, C: true, D: false }) or legacy OptionKey[]
 * - For 'short': string (e.g. '1945')
 */
export type UserAnswerValue = OptionKey | OptionKey[] | TrueFalseAnswerMap | string;

export type ExamCategory =
  | 'Công nghệ CN'
  | 'Công nghệ NN'
  | 'GDKT & PL'
  | 'Hóa học'
  | 'Lịch sử'
  | 'Sinh học'
  | 'Tin học'
  | 'Tiếng Anh'
  | 'Toán'
  | 'Vật lí'
  | 'Địa lí'
  | 'Đại Học'
  | 'Đề thi THPT'
  | 'Lớp 12'
  | 'Lớp 11'
  | 'Lớp 10';

export const LIBRARY_SUBJECTS: ExamCategory[] = [
  'Công nghệ CN',
  'Công nghệ NN',
  'GDKT & PL',
  'Hóa học',
  'Lịch sử',
  'Sinh học',
  'Tin học',
  'Tiếng Anh',
  'Toán',
  'Vật lí',
  'Địa lí',
];

export const EXAM_CATEGORIES: ExamCategory[] = LIBRARY_SUBJECTS;

export interface Exam {
  id: string;
  examCode?: string; // 5-digit library ID e.g. '02008'
  title: string;
  category: ExamCategory;
  durationMinutes: number;
  createdAt: string;
  uploadTime?: string; // e.g. '11:31'
  questions: Question[];
  isFavorite?: boolean;
  shuffleQuestions?: boolean;
  shuffleOptions?: boolean;
  sourceType?: 'docx' | 'text' | 'manual' | 'sample';
  fileName?: string;
}

export interface ExamAttempt {
  id: string;
  examId: string;
  examTitle: string;
  completedAt: string;
  durationSeconds: number;
  totalQuestions: number;
  correctCount: number;
  wrongCount: number;
  unansweredCount: number;
  scorePercent: number;
  scoreTen: number;
  answers: Record<string, UserAnswerValue>;
  questionsSnapshot?: Question[];
}

export interface SiteBranding {
  title: string;
  subtitle: string;
  version: string;
  logoUrl?: string; // custom uploaded image data URI or empty for default svg emblem
}

export const DEFAULT_SITE_BRANDING: SiteBranding = {
  title: 'Luyện đề Online',
  subtitle: 'From : NguyenCongQuang',
  version: 'VERSION 4.16',
  logoUrl: '',
};


