import { initializeApp } from 'firebase/app';
import { getAuth } from 'firebase/auth';
import {
  getFirestore,
  initializeFirestore,
  doc,
  getDocs,
  setDoc,
  deleteDoc,
  collection,
  onSnapshot,
  getDocFromServer,
  QuerySnapshot,
  DocumentData,
  QueryDocumentSnapshot,
  FirestoreError,
} from 'firebase/firestore';
import firebaseConfig from '../firebase-applet-config.json';
import { Exam, ExamCategory, SiteBranding, DEFAULT_SITE_BRANDING } from './types/exam';
import { DEFAULT_ADMIN_KEY } from './utils/accessControl';

const app = initializeApp(firebaseConfig);

function createFirestoreInstance() {
  try {
    return initializeFirestore(
      app,
      {
        experimentalAutoDetectLongPolling: true,
      },
      firebaseConfig.firestoreDatabaseId
    );
  } catch {
    return getFirestore(app, firebaseConfig.firestoreDatabaseId);
  }
}

export const db = createFirestoreInstance();
export const auth = getAuth(app);

export enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

export interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId?: string | null;
    email?: string | null;
    emailVerified?: boolean | null;
    isAnonymous?: boolean | null;
    tenantId?: string | null;
    providerInfo?: {
      providerId?: string | null;
      email?: string | null;
    }[];
  };
}

export interface CloudResult {
  ok: boolean;
  error?: string;
}

export const MAX_EXAM_DOC_BYTES = 900_000;
export const MAX_QUESTIONS = 500;
export const MAX_LOGO_CHARS = 700_000;

export class ExamTooLargeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ExamTooLargeError';
  }
}

export const utf8Bytes = (s: string): number => new TextEncoder().encode(s).length;

export function describeFirestoreError(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err);
  const m = msg.toLowerCase();
  if (m.includes('exceeds the maximum allowed size') || m.includes('too large')) {
    return 'Đề quá nặng so với giới hạn 1 MB của Firestore. Hãy giảm số ảnh hoặc dùng ảnh nhỏ hơn.';
  }
  if (m.includes('permission') || m.includes('insufficient')) {
    return 'Không có quyền ghi lên Cloud. Kiểm tra khóa admin và Firestore Rules đã deploy.';
  }
  if (m.includes('nested arrays')) {
    return 'Dữ liệu có mảng lồng nhau (thường do bảng số liệu). Hãy báo lại để sửa.';
  }
  if (
    m.includes('offline') ||
    m.includes('unavailable') ||
    m.includes('network') ||
    m.includes('failed to fetch')
  ) {
    return 'Mất kết nối mạng. Đề chưa được lưu lên Cloud.';
  }
  return msg.length > 200 ? msg.slice(0, 200) + '…' : msg;
}

export function isOfflineErrorMessage(errOrMsg: unknown): boolean {
  const msg = errOrMsg instanceof Error ? errOrMsg.message : String(errOrMsg || '');
  const m = msg.toLowerCase();
  return (
    m.includes('mất kết nối mạng') ||
    m.includes('offline') ||
    m.includes('unavailable') ||
    m.includes('network') ||
    m.includes('failed to fetch')
  );
}

export function handleFirestoreError(
  error: unknown,
  operationType: OperationType,
  path: string | null
): never {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
      isAnonymous: auth.currentUser?.isAnonymous,
      tenantId: auth.currentUser?.tenantId,
      providerInfo:
        auth.currentUser?.providerData?.map((provider) => ({
          providerId: provider.providerId,
          email: provider.email,
        })) || [],
    },
    operationType,
    path,
  };
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}

async function testConnection() {
  if (typeof window === 'undefined') return;
  try {
    await getDocFromServer(doc(db, 'test', 'connection'));
  } catch (error) {
    if (error instanceof Error && error.message.includes('the client is offline')) {
      console.error('Please check your Firebase configuration.');
    }
  }
}

void testConnection();

export const IGNORED_EXAM_IDS = new Set(['catalog_index', 'exam-test-123']);

export function sanitizeDocId(rawId: string): string {
  const cleaned = String(rawId || '')
    .trim()
    .replace(/[^a-zA-Z0-9_-]/g, '-')
    .replace(/-+/g, '-')
    .slice(0, 120);
  return cleaned || `exam-${Date.now()}`;
}

export function deriveExamCode(id: string, existingCode?: string): string {
  if (existingCode && String(existingCode).trim()) {
    return String(existingCode).trim().slice(0, 32);
  }
  const digits = String(id || '').replace(/\D/g, '');
  if (digits.length >= 5) {
    return digits.slice(-5);
  }
  let hash = 0;
  const str = String(id || 'exam');
  for (let i = 0; i < str.length; i++) {
    hash = (hash * 31 + str.charCodeAt(i)) % 90000;
  }
  return String(10000 + Math.abs(hash));
}

export function sanitizeSiteBrandingPayload(branding: SiteBranding): Record<string, unknown> {
  const title =
    String(branding.title || DEFAULT_SITE_BRANDING.title).trim().slice(0, 200) ||
    DEFAULT_SITE_BRANDING.title;
  const subtitle =
    String(branding.subtitle || DEFAULT_SITE_BRANDING.subtitle).trim().slice(0, 200) ||
    DEFAULT_SITE_BRANDING.subtitle;
  const version =
    String(branding.version || DEFAULT_SITE_BRANDING.version).trim().slice(0, 100) ||
    DEFAULT_SITE_BRANDING.version;
  const logoUrl = String(branding.logoUrl || '').trim();

  if (logoUrl.length > MAX_LOGO_CHARS) {
    throw new ExamTooLargeError('Logo quá nặng, hãy chọn ảnh nhỏ hơn.');
  }

  return {
    title,
    subtitle,
    version,
    logoUrl,
    updatedAt: new Date().toISOString(),
    adminToken: DEFAULT_ADMIN_KEY,
  };
}

export function normalizeQuestionTableData(raw: unknown): Exam['questions'][number]['tableData'] {
  if (!raw || typeof raw !== 'object') return undefined;
  const obj = raw as Record<string, unknown>;
  const headers = Array.isArray(obj.headers)
    ? obj.headers.map((h) => String(h ?? '').trim())
    : [];

  let rows: string[][] = [];
  if (Array.isArray(obj.rows)) {
    rows = obj.rows
      .map((r) => {
        if (Array.isArray(r)) {
          return r.map((c) => String(c ?? '').trim());
        }
        if (r && typeof r === 'object' && Array.isArray((r as { cells?: unknown[] }).cells)) {
          return ((r as { cells: unknown[] }).cells || []).map((c) => String(c ?? '').trim());
        }
        return [];
      })
      .filter((r) => r.length > 0);
  } else if (typeof obj.rowsJson === 'string') {
    try {
      const parsed = JSON.parse(obj.rowsJson);
      if (Array.isArray(parsed)) {
        rows = parsed.map((r) => (Array.isArray(r) ? r.map((c) => String(c ?? '').trim()) : []));
      }
    } catch {
      // ignore
    }
  }

  if (headers.length === 0 && rows.length === 0) return undefined;

  const colCount = Math.max(headers.length, ...rows.map((r) => r.length), 1);
  const normalizedHeaders = Array.from({ length: colCount }, (_, i) => headers[i] ?? '');
  const normalizedRows = rows.map((r) =>
    Array.from({ length: colCount }, (_, i) => r[i] ?? '')
  );

  return {
    title: typeof obj.title === 'string' && obj.title.trim() ? obj.title.trim() : undefined,
    unit: typeof obj.unit === 'string' && obj.unit.trim() ? obj.unit.trim() : undefined,
    headers: normalizedHeaders,
    rows: normalizedRows,
    sourceNote:
      typeof obj.sourceNote === 'string' && obj.sourceNote.trim()
        ? obj.sourceNote.trim()
        : undefined,
  };
}

function serializeQuestionForFirestore(
  q: Exam['questions'][number],
  idx: number
): Record<string, unknown> {
  const qType = q.type === 'multiple' || q.type === 'short' ? q.type : 'single';
  const safeOptions = {
    A: String(q.options?.A ?? (qType === 'short' ? '' : 'Phương án A')),
    B: String(q.options?.B ?? (qType === 'short' ? '' : 'Phương án B')),
    C: String(q.options?.C ?? (qType === 'short' ? '' : 'Phương án C')),
    D: String(q.options?.D ?? (qType === 'short' ? '' : 'Phương án D')),
  };

  const serialized: Record<string, unknown> = {
    id: String(q.id || `q-${idx + 1}`),
    number: Number(q.number) || idx + 1,
    type: qType,
    text: String(q.text || `Câu hỏi ${idx + 1}`),
    options: safeOptions,
    correctAnswer: ['A', 'B', 'C', 'D'].includes(q.correctAnswer) ? q.correctAnswer : 'A',
  };

  if (q.imageUrl && typeof q.imageUrl === 'string' && q.imageUrl.trim()) {
    serialized.imageUrl = q.imageUrl.trim();
  }
  if (Array.isArray(q.correctAnswers)) {
    serialized.correctAnswers = q.correctAnswers.filter((k) =>
      ['A', 'B', 'C', 'D'].includes(k)
    );
  }
  if (typeof q.shortAnswer === 'string') {
    serialized.shortAnswer = q.shortAnswer;
  }
  if (typeof q.explanation === 'string' && q.explanation.trim()) {
    serialized.explanation = q.explanation.trim();
  }

  const normTable = normalizeQuestionTableData(q.tableData);
  if (normTable) {
    // Store rows as an array of { cells: string[] } objects because Firestore forbids nested arrays (string[][])
    const tableObj: Record<string, unknown> = {
      headers: normTable.headers,
      rows: normTable.rows.map((r) => ({ cells: r })),
    };
    if (normTable.title) tableObj.title = normTable.title;
    if (normTable.unit) tableObj.unit = normTable.unit;
    if (normTable.sourceNote) tableObj.sourceNote = normTable.sourceNote;
    serialized.tableData = tableObj;
  }

  return serialized;
}

function buildRawExamPayload(exam: Exam): {
  id: string;
  payload: Record<string, unknown>;
  cleanQuestions: Record<string, unknown>[];
} {
  const safeId = sanitizeDocId(exam.id);
  const rawQuestions = Array.isArray(exam.questions) ? exam.questions : [];
  const cleanQuestions = rawQuestions.map((q, idx) => serializeQuestionForFirestore(q, idx));

  const payload: Record<string, unknown> = {
    id: safeId,
    examCode: deriveExamCode(safeId, exam.examCode),
    title: (String(exam.title || 'Đề thi mới').trim() || 'Đề thi mới').slice(0, 300),
    category: (String(exam.category || 'Lịch sử').trim() || 'Lịch sử').slice(0, 100),
    durationMinutes: Math.min(600, Math.max(1, Number(exam.durationMinutes) || 45)),
    createdAt: (
      String(exam.createdAt || new Date().toLocaleDateString('vi-VN')).trim() || '07/11/2026'
    ).slice(0, 64),
    uploadTime: (String(exam.uploadTime || '11:30').trim() || '11:30').slice(0, 16),
    questions: cleanQuestions,
    shuffleQuestions: Boolean(exam.shuffleQuestions),
    shuffleOptions: Boolean(exam.shuffleOptions),
    isFavorite: Boolean(exam.isFavorite),
    updatedAt: new Date().toISOString(),
    adminToken: DEFAULT_ADMIN_KEY,
  };

  return { id: safeId, payload, cleanQuestions };
}

export function estimateExamBytes(exam: Exam): number {
  try {
    const { payload } = buildRawExamPayload(exam);
    return utf8Bytes(JSON.stringify(payload));
  } catch {
    return 0;
  }
}

export function sanitizeExamPayload(exam: Exam): { id: string; payload: Record<string, unknown> } {
  if (Array.isArray(exam.questions) && exam.questions.length > MAX_QUESTIONS) {
    throw new ExamTooLargeError(`Đề có ${exam.questions.length} câu, tối đa ${MAX_QUESTIONS} câu.`);
  }

  const { id: safeId, payload, cleanQuestions } = buildRawExamPayload(exam);
  const bytes = utf8Bytes(JSON.stringify(payload));

  if (bytes > MAX_EXAM_DOC_BYTES) {
    const heavy = cleanQuestions
      .map((q, i) => ({
        n: i + 1,
        b: typeof q.imageUrl === 'string' ? utf8Bytes(q.imageUrl) : 0,
      }))
      .filter((x) => x.b > 0)
      .sort((a, b) => b.b - a.b)
      .slice(0, 3)
      .map((x) => `câu ${x.n} (${Math.round(x.b / 1024)} KB)`)
      .join(', ');
    throw new ExamTooLargeError(
      `Đề nặng ${(bytes / 1024).toFixed(0)} KB, vượt giới hạn ${(MAX_EXAM_DOC_BYTES / 1024).toFixed(0)} KB.` +
        (heavy ? ` Ảnh nặng nhất: ${heavy}.` : '') +
        ' Hãy giảm số ảnh hoặc dùng ảnh nhỏ hơn.'
    );
  }

  return { id: safeId, payload };
}

export function subscribeToSiteBranding(
  onUpdate: (branding: SiteBranding | null) => void
): () => void {
  const path = 'settings/site_config';
  return onSnapshot(
    doc(db, 'settings', 'site_config'),
    (snapshot) => {
      if (!snapshot.exists()) {
        onUpdate(null);
        return;
      }
      const data = snapshot.data();
      onUpdate({
        title: typeof data.title === 'string' && data.title ? data.title : DEFAULT_SITE_BRANDING.title,
        subtitle:
          typeof data.subtitle === 'string' && data.subtitle
            ? data.subtitle
            : DEFAULT_SITE_BRANDING.subtitle,
        version:
          typeof data.version === 'string' && data.version
            ? data.version
            : DEFAULT_SITE_BRANDING.version,
        logoUrl: typeof data.logoUrl === 'string' ? data.logoUrl : '',
      });
    },
    (error) => {
      try {
        handleFirestoreError(error, OperationType.GET, path);
      } catch {
        // Logged via handleFirestoreError
      }
    }
  );
}

export async function saveSiteBrandingToCloud(branding: SiteBranding): Promise<CloudResult> {
  const path = 'settings/site_config';
  let payload: Record<string, unknown>;
  try {
    payload = sanitizeSiteBrandingPayload(branding);
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
  try {
    await setDoc(doc(db, 'settings', 'site_config'), payload);
    return { ok: true };
  } catch (error) {
    try {
      handleFirestoreError(error, OperationType.WRITE, path);
    } catch {
      // Logged via handleFirestoreError
    }
    return { ok: false, error: describeFirestoreError(error) };
  }
}

function getExamCreationSortValue(exam: Exam): number {
  const idDigits = String(exam.id || '').match(/(\d{10,15})/);
  if (idDigits) {
    return Number(idDigits[1]);
  }
  return 0;
}

export function parseExamsSnapshot(snapshot: QuerySnapshot<DocumentData>): Exam[] {
  const list: Exam[] = [];
  snapshot.forEach((docSnap: QueryDocumentSnapshot<DocumentData>) => {
    const docId = docSnap.id;
    const data = docSnap.data();
    if (IGNORED_EXAM_IDS.has(docId) || (data && IGNORED_EXAM_IDS.has(String(data.id || '')))) {
      return;
    }
    if (data && Array.isArray(data.questions)) {
      const canonicalId = docId || String(data.id || '');
      if (!canonicalId) return;
      const normalizedQuestions: Exam['questions'] = data.questions.map(
        (rawQ: Record<string, unknown>, idx: number) => {
          const qType =
            rawQ?.type === 'multiple' || rawQ?.type === 'short' ? rawQ.type : 'single';
          const rawOpts =
            rawQ?.options && typeof rawQ.options === 'object'
              ? (rawQ.options as Record<string, unknown>)
              : {};
          return {
            id: String(rawQ?.id || `q-${idx + 1}`),
            number: Number(rawQ?.number) || idx + 1,
            type: qType,
            text: String(rawQ?.text || `Câu hỏi ${idx + 1}`),
            imageUrl:
              typeof rawQ?.imageUrl === 'string' && rawQ.imageUrl.trim()
                ? rawQ.imageUrl.trim()
                : undefined,
            tableData: normalizeQuestionTableData(rawQ?.tableData),
            options: {
              A: String(rawOpts.A ?? (qType === 'short' ? '' : 'Phương án A')),
              B: String(rawOpts.B ?? (qType === 'short' ? '' : 'Phương án B')),
              C: String(rawOpts.C ?? (qType === 'short' ? '' : 'Phương án C')),
              D: String(rawOpts.D ?? (qType === 'short' ? '' : 'Phương án D')),
            },
            correctAnswer: ['A', 'B', 'C', 'D'].includes(String(rawQ?.correctAnswer))
              ? (String(rawQ?.correctAnswer) as 'A' | 'B' | 'C' | 'D')
              : 'A',
            correctAnswers: Array.isArray(rawQ?.correctAnswers)
              ? (rawQ.correctAnswers.filter((k: unknown) =>
                  ['A', 'B', 'C', 'D'].includes(String(k))
                ) as ('A' | 'B' | 'C' | 'D')[])
              : undefined,
            shortAnswer:
              typeof rawQ?.shortAnswer === 'string' ? rawQ.shortAnswer : undefined,
            explanation:
              typeof rawQ?.explanation === 'string' ? rawQ.explanation : undefined,
          };
        }
      );

      list.push({
        id: canonicalId,
        examCode: deriveExamCode(
          canonicalId,
          typeof data.examCode === 'string' ? data.examCode : undefined
        ),
        title: String(data.title || 'Đề thi'),
        category: String(data.category || 'Lịch sử') as ExamCategory,
        durationMinutes: Number(data.durationMinutes) || 45,
        createdAt: String(data.createdAt || '07/11/2026'),
        uploadTime:
          typeof data.uploadTime === 'string' && data.uploadTime.trim()
            ? data.uploadTime.trim()
            : '11:30',
        questions: normalizedQuestions,
        shuffleQuestions: Boolean(data.shuffleQuestions),
        shuffleOptions: Boolean(data.shuffleOptions),
        isFavorite: Boolean(data.isFavorite),
      });
    }
  });

  list.sort((a, b) => {
    const diff = getExamCreationSortValue(b) - getExamCreationSortValue(a);
    if (diff !== 0) return diff;
    return b.id.localeCompare(a.id);
  });

  return list;
}

export async function fetchExamsFromCloudOnce(): Promise<{
  ok: boolean;
  exams: Exam[];
  error?: string;
}> {
  const path = 'exams';
  try {
    const snap = await getDocs(collection(db, 'exams'));
    const list = parseExamsSnapshot(snap);
    return { ok: true, exams: list };
  } catch (error) {
    try {
      handleFirestoreError(error, OperationType.LIST, path);
    } catch {
      // Logged via handleFirestoreError
    }
    return { ok: false, exams: [], error: describeFirestoreError(error) };
  }
}

export function subscribeToCloudExams(
  onUpdate: (exams: Exam[]) => void,
  onError?: (errorMsg: string) => void
): () => void {
  const path = 'exams';
  let cancelled = false;

  const unsubscribe = onSnapshot(
    collection(db, 'exams'),
    (snapshot: QuerySnapshot<DocumentData>) => {
      if (cancelled) return;
      // Avoid wiping out local state with an empty offline-cache snapshot before server responds
      if (snapshot.empty && snapshot.metadata.fromCache) {
        void fetchExamsFromCloudOnce().then((res) => {
          if (cancelled) return;
          if (res.ok) {
            onUpdate(res.exams);
          } else if (res.error) {
            onError?.(res.error);
          }
        });
        return;
      }
      const list = parseExamsSnapshot(snapshot);
      onUpdate(list);
    },
    (error: FirestoreError) => {
      try {
        handleFirestoreError(error, OperationType.LIST, path);
      } catch {
        // Logged via handleFirestoreError
      }
      void fetchExamsFromCloudOnce().then((res) => {
        if (cancelled) return;
        if (res.ok) {
          onUpdate(res.exams);
        } else {
          onError?.(res.error || describeFirestoreError(error));
        }
      });
    }
  );

  return () => {
    cancelled = true;
    unsubscribe();
  };
}

export async function saveExamToCloud(exam: Exam): Promise<CloudResult> {
  if (!exam || !exam.id || IGNORED_EXAM_IDS.has(exam.id)) {
    return { ok: false, error: 'Mã đề không hợp lệ.' };
  }
  let built: { id: string; payload: Record<string, unknown> };
  try {
    built = sanitizeExamPayload(exam);
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
  try {
    await setDoc(doc(db, 'exams', built.id), built.payload);
    return { ok: true };
  } catch (error) {
    try {
      handleFirestoreError(error, OperationType.WRITE, `exams/${built.id}`);
    } catch {
      // Logged via handleFirestoreError
    }
    return { ok: false, error: describeFirestoreError(error) };
  }
}

export async function deleteExamFromCloud(examId: string): Promise<CloudResult> {
  const raw = String(examId || '').trim();
  if (!raw) return { ok: false, error: 'Mã đề cần xoá không hợp lệ.' };
  const safeId = sanitizeDocId(raw);
  const path = `exams/${safeId}`;
  try {
    await deleteDoc(doc(db, 'exams', safeId));
    if (raw && raw !== safeId) {
      await deleteDoc(doc(db, 'exams', raw)).catch(() => {});
    }
    try {
      const snap = await getDocs(collection(db, 'exams'));
      const extraDeletes: Promise<void>[] = [];
      snap.forEach((docSnap) => {
        const data = docSnap.data();
        if (docSnap.id === raw || docSnap.id === safeId || data?.id === raw || data?.id === safeId) {
          extraDeletes.push(deleteDoc(doc(db, 'exams', docSnap.id)));
        }
      });
      if (extraDeletes.length > 0) {
        await Promise.allSettled(extraDeletes);
      }
    } catch {
      // Ignore secondary cleanup query errors if primary deleteDoc succeeded
    }
    return { ok: true };
  } catch (error) {
    try {
      handleFirestoreError(error, OperationType.DELETE, path);
    } catch {
      // Logged via handleFirestoreError
    }
    return { ok: false, error: describeFirestoreError(error) };
  }
}

export interface SyncAllResult {
  success: boolean;
  count: number;
  failed: { id: string; title?: string; error: string }[];
  brandingError?: string;
}

export async function syncAllToCloud(
  exams: Exam[],
  branding: SiteBranding,
  deps?: {
    saveExam?: (exam: Exam) => Promise<CloudResult>;
    saveBranding?: (branding: SiteBranding) => Promise<CloudResult>;
  }
): Promise<SyncAllResult> {
  const writeExam = deps?.saveExam || saveExamToCloud;
  const writeBranding = deps?.saveBranding || saveSiteBrandingToCloud;

  let successCount = 0;
  const failed: { id: string; title?: string; error: string }[] = [];
  let brandingError: string | undefined;

  const brandingRes = await writeBranding(branding);
  if (!brandingRes.ok) {
    brandingError = brandingRes.error || 'Không thể đồng bộ giao diện.';
  }

  for (const exam of exams) {
    if (!exam || !exam.id || IGNORED_EXAM_IDS.has(exam.id)) continue;
    const res = await writeExam(exam);
    if (res.ok) {
      successCount++;
    } else {
      failed.push({
        id: exam.id,
        title: exam.title,
        error: res.error || 'Lỗi không xác định',
      });
    }
  }

  return {
    success: failed.length === 0 && !brandingError,
    count: successCount,
    failed,
    brandingError,
  };
}
