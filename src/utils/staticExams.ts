import type { Exam, SiteBranding } from '../types/exam';
import { detectDefaultGitHubRepo, loadGitHubSyncConfig } from './githubSync';

/**
 * Đọc đề thi từ file tĩnh `exams.json` (cùng thư mục với trang hoặc từ GitHub Raw, phục vụ miễn phí).
 * Khách / học sinh dùng nguồn này nên KHÔNG tốn lượt đọc Firestore.
 * File do Admin xuất hoặc đồng bộ tự động bằng GitHub API (dạng { updatedAt, branding, exams } hoặc mảng đề).
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

export interface StaticExamsBundle {
  exams: Exam[];
  branding?: Partial<SiteBranding>;
  updatedAt?: string;
}

export function parseStaticBundlePayload(data: unknown): StaticExamsBundle {
  const exams = parseStaticExamsPayload(data);
  if (data && typeof data === 'object' && !Array.isArray(data)) {
    const obj = data as { branding?: unknown; updatedAt?: unknown };
    const branding =
      obj.branding && typeof obj.branding === 'object'
        ? (obj.branding as Partial<SiteBranding>)
        : undefined;
    const updatedAt = typeof obj.updatedAt === 'string' ? obj.updatedAt : undefined;
    return { exams, branding, updatedAt };
  }
  return { exams };
}

async function fetchJsonCandidate(url: string): Promise<StaticExamsBundle | null> {
  try {
    const res = await fetch(url, { cache: 'no-cache' });
    if (!res.ok) return null;
    const data: unknown = await res.json();
    const bundle = parseStaticBundlePayload(data);
    return bundle.exams.length > 0 ? bundle : null;
  } catch {
    return null;
  }
}

export async function fetchStaticExamsBundle(): Promise<StaticExamsBundle> {
  try {
    const cfg = loadGitHubSyncConfig();
    const detected = detectDefaultGitHubRepo();
    const owner = cfg.owner || detected.owner;
    const repo = cfg.repo || detected.repo;
    const branch = cfg.branch || 'main';
    const cleanPath = (cfg.filePath || 'public/exams.json').replace(/^\/+/, '');
    const cacheBuster = Math.floor(Date.now() / 5000);

    const localUrl =
      typeof document !== 'undefined' && document.baseURI
        ? `${new URL('exams.json', document.baseURI).toString()}?t=${cacheBuster}`
        : `./exams.json?t=${cacheBuster}`;

    const rawGitHubUrl = `https://raw.githubusercontent.com/${encodeURIComponent(
      owner
    )}/${encodeURIComponent(repo)}/${encodeURIComponent(branch)}/${cleanPath}?t=${cacheBuster}`;

    const [localBundle, rawBundle] = await Promise.all([
      fetchJsonCandidate(localUrl),
      fetchJsonCandidate(rawGitHubUrl),
    ]);

    if (localBundle && rawBundle) {
      const localTime = localBundle.updatedAt ? Date.parse(localBundle.updatedAt) : 0;
      const rawTime = rawBundle.updatedAt ? Date.parse(rawBundle.updatedAt) : 0;
      if (rawTime > localTime) return rawBundle;
      if (localTime > rawTime) return localBundle;
      return rawBundle.exams.length >= localBundle.exams.length ? rawBundle : localBundle;
    }

    if (rawBundle) return rawBundle;
    if (localBundle) return localBundle;

    // Fallback paths
    for (const fallbackUrl of ['./exams.json', '/exams.json']) {
      const fb = await fetchJsonCandidate(fallbackUrl);
      if (fb) return fb;
    }

    return { exams: [] };
  } catch {
    return { exams: [] };
  }
}

export async function fetchStaticExams(): Promise<Exam[]> {
  const bundle = await fetchStaticExamsBundle();
  return bundle.exams;
}
