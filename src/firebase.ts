import { initializeApp } from 'firebase/app';
import { getAuth } from 'firebase/auth';
import {
  getFirestore,
  doc,
  getDoc,
  setDoc,
  deleteDoc,
  onSnapshot,
  getDocFromServer,
} from 'firebase/firestore';
import firebaseConfig from '../firebase-applet-config.json';
import { Exam, ExamCategory, SiteBranding, DEFAULT_SITE_BRANDING } from './types/exam';
import { DEFAULT_ADMIN_KEY } from './utils/accessControl';

const app = initializeApp(firebaseConfig);
export const db = getFirestore(app, firebaseConfig.firestoreDatabaseId);
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
  try {
    await getDocFromServer(doc(db, 'test', 'connection'));
  } catch (error) {
    if (error instanceof Error && error.message.includes('the client is offline')) {
      console.error('Please check your Firebase configuration.');
    }
  }
}

testConnection();

export function sanitizeDocId(rawId: string): string {
  const cleaned = String(rawId || '')
    .trim()
    .replace(/[^a-zA-Z0-9_-]/g, '-')
    .replace(/-+/g, '-')
    .slice(0, 120);
  return cleaned || `exam-${Date.now()}`;
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
  const logoUrl = String(branding.logoUrl || '').trim().slice(0, 850000);

  return {
    title,
    subtitle,
    version,
    logoUrl,
    updatedAt: new Date().toISOString(),
    adminToken: DEFAULT_ADMIN_KEY,
  };
}

export function sanitizeExamPayload(exam: Exam): { id: string; payload: Record<string, unknown> } {
  const safeId = sanitizeDocId(exam.id);
  const cleanQuestions = JSON.parse(
    JSON.stringify(Array.isArray(exam.questions) ? exam.questions : [])
  ).slice(0, 500);

  const payload: Record<string, unknown> = {
    id: safeId,
    title: (String(exam.title || 'Đề thi mới').trim() || 'Đề thi mới').slice(0, 300),
    category: (String(exam.category || 'Lịch sử').trim() || 'Lịch sử').slice(0, 100),
    durationMinutes: Math.min(600, Math.max(1, Number(exam.durationMinutes) || 45)),
    createdAt: (
      String(exam.createdAt || new Date().toLocaleDateString('vi-VN')).trim() || '2026'
    ).slice(0, 64),
    questions: cleanQuestions,
    shuffleQuestions: Boolean(exam.shuffleQuestions),
    shuffleOptions: Boolean(exam.shuffleOptions),
    isFavorite: Boolean(exam.isFavorite),
    updatedAt: new Date().toISOString(),
    adminToken: DEFAULT_ADMIN_KEY,
  };

  if (exam.examCode) {
    payload.examCode = String(exam.examCode).trim().slice(0, 32);
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

export async function saveSiteBrandingToCloud(branding: SiteBranding): Promise<void> {
  const path = 'settings/site_config';
  try {
    const payload = sanitizeSiteBrandingPayload(branding);
    await setDoc(doc(db, 'settings', 'site_config'), payload);
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, path);
  }
}

const CATALOG_DOC_ID = 'catalog_index';

export async function saveCatalogIdsToCloud(examIds: string[]): Promise<void> {
  const path = `exams/${CATALOG_DOC_ID}`;
  const uniqueIds = Array.from(
    new Set(
      examIds
        .map((id) => sanitizeDocId(id))
        .filter((id) => Boolean(id) && id !== CATALOG_DOC_ID)
    )
  ).slice(0, 500);
  try {
    await setDoc(doc(db, 'exams', CATALOG_DOC_ID), {
      id: CATALOG_DOC_ID,
      title: 'Danh mục đề thi Cloud',
      category: 'Lịch sử',
      durationMinutes: 45,
      createdAt: '2026',
      questions: uniqueIds.map((examId) => ({ id: examId })),
      updatedAt: new Date().toISOString(),
      adminToken: DEFAULT_ADMIN_KEY,
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, path);
  }
}

function extractCatalogIds(data: Record<string, unknown> | undefined): string[] {
  if (!data || !Array.isArray(data.questions)) return [];
  return data.questions
    .map((item: unknown) => {
      if (item && typeof item === 'object' && 'id' in item && typeof (item as { id: unknown }).id === 'string') {
        return (item as { id: string }).id;
      }
      return '';
    })
    .filter((id) => Boolean(id) && id !== CATALOG_DOC_ID);
}

export function subscribeToCloudExams(
  onUpdate: (exams: Exam[], catalogExists: boolean) => void
): () => void {
  const catalogPath = `exams/${CATALOG_DOC_ID}`;
  return onSnapshot(
    doc(db, 'exams', CATALOG_DOC_ID),
    async (catalogSnap) => {
      if (!catalogSnap.exists()) {
        onUpdate([], false);
        return;
      }
      const rawIds = extractCatalogIds(catalogSnap.data() as Record<string, unknown>);

      if (rawIds.length === 0) {
        onUpdate([], true);
        return;
      }

      const loadedExams: Exam[] = [];
      for (const rawId of rawIds) {
        const safeId = sanitizeDocId(rawId);
        if (!safeId || safeId === CATALOG_DOC_ID) continue;
        const examPath = `exams/${safeId}`;
        try {
          const examSnap = await getDoc(doc(db, 'exams', safeId));
          if (examSnap.exists()) {
            const data = examSnap.data();
            if (data && typeof data.id === 'string' && Array.isArray(data.questions)) {
              loadedExams.push({
                id: data.id,
                examCode: typeof data.examCode === 'string' ? data.examCode : undefined,
                title: String(data.title || 'Đề thi'),
                category: String(data.category || 'Lịch sử') as ExamCategory,
                durationMinutes: Number(data.durationMinutes) || 45,
                createdAt: String(data.createdAt || ''),
                questions: data.questions,
                shuffleQuestions: Boolean(data.shuffleQuestions),
                shuffleOptions: Boolean(data.shuffleOptions),
                isFavorite: Boolean(data.isFavorite),
              });
            }
          }
        } catch (error) {
          try {
            handleFirestoreError(error, OperationType.GET, examPath);
          } catch {
            // Logged via handleFirestoreError
          }
        }
      }
      onUpdate(loadedExams, true);
    },
    (error) => {
      try {
        handleFirestoreError(error, OperationType.GET, catalogPath);
      } catch {
        // Logged via handleFirestoreError
      }
    }
  );
}

export async function saveExamToCloud(exam: Exam, allExamsList?: Exam[]): Promise<void> {
  const { id, payload } = sanitizeExamPayload(exam);
  const path = `exams/${id}`;
  try {
    await setDoc(doc(db, 'exams', id), payload);
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, path);
  }

  if (allExamsList) {
    await saveCatalogIdsToCloud(allExamsList.map((e) => e.id));
  } else {
    try {
      const catSnap = await getDoc(doc(db, 'exams', CATALOG_DOC_ID));
      const existingIds = catSnap.exists()
        ? extractCatalogIds(catSnap.data() as Record<string, unknown>)
        : [];
      const merged = [id, ...existingIds.filter((x) => x !== id)];
      await saveCatalogIdsToCloud(merged);
    } catch (error) {
      handleFirestoreError(error, OperationType.GET, `exams/${CATALOG_DOC_ID}`);
    }
  }
}

export async function deleteExamFromCloud(examId: string, remainingExams?: Exam[]): Promise<void> {
  const safeId = sanitizeDocId(examId);
  const path = `exams/${safeId}`;
  try {
    await deleteDoc(doc(db, 'exams', safeId));
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, path);
  }

  if (remainingExams) {
    await saveCatalogIdsToCloud(remainingExams.map((e) => e.id));
  } else {
    try {
      const catSnap = await getDoc(doc(db, 'exams', CATALOG_DOC_ID));
      const existingIds = catSnap.exists()
        ? extractCatalogIds(catSnap.data() as Record<string, unknown>)
        : [];
      await saveCatalogIdsToCloud(existingIds.filter((x) => x !== safeId));
    } catch (error) {
      handleFirestoreError(error, OperationType.GET, `exams/${CATALOG_DOC_ID}`);
    }
  }
}

export async function syncAllToCloud(exams: Exam[], branding: SiteBranding): Promise<void> {
  await saveSiteBrandingToCloud(branding);
  for (const exam of exams) {
    const { id, payload } = sanitizeExamPayload(exam);
    const path = `exams/${id}`;
    try {
      await setDoc(doc(db, 'exams', id), payload);
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, path);
    }
  }
  await saveCatalogIdsToCloud(exams.map((e) => e.id));
}
