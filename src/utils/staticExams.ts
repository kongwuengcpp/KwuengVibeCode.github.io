import type { Exam } from '../types/exam';

/**
 * Đọc đề thi từ file tĩnh `exams.json` (cùng thư mục với trang, phục vụ miễn phí bởi GitHub Pages).
 * Khách / học sinh dùng nguồn này nên KHÔNG tốn lượt đọc Firestore.
 * File do Admin xuất bằng nút "Xuất exams.json" (dạng { branding, exams } hoặc mảng đề).
 */
export function parseStaticExamsPayload(data: unknown): Exam[] {
  const raw = Array.isArray(data)
    ? data
    : data && typeof data === 'object'
    ? (data as { exams?: unknown }).exams
    : null;
  if (!Array.isArray(raw)) return [];

  const seen = new Set<string>();
  const out: Exam[] = [];
  for (const item of raw) {
    if (
      item &&
      typeof item.id === 'string' &&
      item.id &&
      typeof item.title === 'string' &&
      Array.isArray(item.questions) &&
      item.questions.length > 0 &&
      !seen.has(item.id)
    ) {
      seen.add(item.id);
      out.push(item as Exam);
    }
  }
  return out;
}

export async function fetchStaticExams(): Promise<Exam[]> {
  try {
    const url = new URL('exams.json', document.baseURI).toString();
    const res = await fetch(url, { cache: 'no-cache' });
    if (!res.ok) return [];
    return parseStaticExamsPayload(await res.json());
  } catch {
    return [];
  }
}
