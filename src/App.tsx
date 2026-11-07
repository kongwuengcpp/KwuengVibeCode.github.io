import { useState, useEffect, useCallback, useRef } from 'react';
import { ShieldOff, ArrowLeft } from 'lucide-react';
import { Exam, ExamAttempt, SiteBranding, DEFAULT_SITE_BRANDING } from './types/exam';
import { INITIAL_ATTEMPTS, INITIAL_EXAMS } from './data/initialExams';
import { DashboardView } from './components/DashboardView';
import { ExamTakeView } from './components/ExamTakeView';
import { CreateExamView } from './components/CreateExamView';
import {
  ADMIN_STORAGE_KEY,
  CUSTOM_ADMIN_KEY_STORAGE,
  DEFAULT_ADMIN_KEY,
  resolveAppRoute,
  verifyAdminKey,
} from './utils/accessControl';
import {
  subscribeToSiteBranding,
  saveSiteBrandingToCloud,
  subscribeToCloudExams,
  saveExamToCloud,
  deleteExamFromCloud,
  syncAllToCloud,
  IGNORED_EXAM_IDS,
  sanitizeDocId,
} from './firebase';

const EXAMS_STORAGE_KEY = 'luyende_online_exams_prod_v1';
const DELETED_EXAMS_STORAGE_KEY = 'luyende_deleted_exam_ids_v1';
const PENDING_SAVE_STORAGE_KEY = 'luyende_pending_save_ids_v1';
const ATTEMPTS_STORAGE_KEY = 'luyende_online_attempts_prod_v1';
const BRANDING_STORAGE_KEY = 'luyende_site_branding_v1';
const LEGACY_KEYS_TO_CLEAR = [
  'baitaptracnghiem_exams_v3',
  'baitaptracnghiem_attempts_v3',
  'luyende_manual_done_exams_v1',
];

declare global {
  interface Window {
    admin?: (key: string) => string;
    loginAdmin?: (key: string) => string;
    logoutAdmin?: () => string;
    setAdminKey?: (newKey: string) => string;
    setBranding?: (branding: Partial<SiteBranding>) => string;
    syncCloud?: () => Promise<string>;
    ADMIN_KEY?: string;
  }
}

function getBasePathname(): string {
  const path = window.location.pathname.replace(/\/index\.html$/i, '');
  const stripped = path
    .replace(/\/(?:lam-bai|de)\/[^/]+\/?$/i, '')
    .replace(/\/(?:nguoi-dung\/)?tao-de\/?$/i, '')
    .replace(/\/thu-vien\/?$/i, '')
    .replace(/\/nguoi-dung\/?$/i, '');
  const clean = stripped.replace(/\/+$/, '');
  return clean ? `${clean}/` : '/';
}

function loadDeletedExamIds(): Set<string> {
  const set = new Set<string>(IGNORED_EXAM_IDS);
  try {
    const raw = localStorage.getItem(DELETED_EXAMS_STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        parsed.forEach((id) => {
          if (typeof id === 'string' && id) set.add(id);
        });
      }
    }
  } catch {
    // ignore
  }
  return set;
}

function loadPendingSaveExamIds(): Set<string> {
  const set = new Set<string>();
  try {
    const raw = localStorage.getItem(PENDING_SAVE_STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        parsed.forEach((id) => {
          if (typeof id === 'string' && id && !IGNORED_EXAM_IDS.has(id)) {
            set.add(id);
          }
        });
      }
    }
  } catch {
    // ignore
  }
  return set;
}

export default function App() {
  const deletedExamIdsRef = useRef<Set<string>>(loadDeletedExamIds());
  const pendingSaveExamIdsRef = useRef<Set<string>>(loadPendingSaveExamIds());
  const lastSavedExamRef = useRef<Exam | null>(null);

  const persistDeletedIds = useCallback(() => {
    try {
      localStorage.setItem(
        DELETED_EXAMS_STORAGE_KEY,
        JSON.stringify(Array.from(deletedExamIdsRef.current))
      );
    } catch {
      // ignore
    }
  }, []);

  const persistPendingSaveIds = useCallback(() => {
    try {
      localStorage.setItem(
        PENDING_SAVE_STORAGE_KEY,
        JSON.stringify(Array.from(pendingSaveExamIdsRef.current))
      );
    } catch {
      // ignore
    }
  }, []);

  const [exams, setExams] = useState<Exam[]>(() => {
    try {
      LEGACY_KEYS_TO_CLEAR.forEach((k) => localStorage.removeItem(k));
      const deletedSet = loadDeletedExamIds();
      const saved = localStorage.getItem(EXAMS_STORAGE_KEY);
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed)) {
          const seen = new Set<string>();
          const cleanList: Exam[] = [];
          for (const item of parsed) {
            if (
              item &&
              typeof item.id === 'string' &&
              !deletedSet.has(item.id) &&
              !deletedSet.has(sanitizeDocId(item.id)) &&
              !seen.has(item.id)
            ) {
              seen.add(item.id);
              cleanList.push(item);
            }
          }
          return cleanList;
        }
      }
    } catch {
      // Fallback to initial exams
    }
    return INITIAL_EXAMS;
  });

  const [attempts, setAttempts] = useState<ExamAttempt[]>(() => {
    try {
      const saved = localStorage.getItem(ATTEMPTS_STORAGE_KEY);
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed)) {
          return parsed;
        }
      }
    } catch {
      // Fallback to initial attempts
    }
    return INITIAL_ATTEMPTS;
  });

  const [isAdmin, setIsAdmin] = useState<boolean>(() => {
    try {
      return (
        localStorage.getItem(ADMIN_STORAGE_KEY) === 'true' ||
        sessionStorage.getItem(ADMIN_STORAGE_KEY) === 'true'
      );
    } catch {
      return false;
    }
  });

  const [activeView, setActiveView] = useState<
    'dashboard' | 'take-exam' | 'create-exam' | 'forbidden'
  >('dashboard');
  const [isLibraryOpen, setIsLibraryOpen] = useState<boolean>(false);
  const [forbiddenReason, setForbiddenReason] = useState<string>('');
  const [activeExamId, setActiveExamId] = useState<string>(
    INITIAL_EXAMS[0]?.id || ''
  );
  const [previewMode, setPreviewMode] = useState<boolean>(false);
  const [reviewingAttempt, setReviewingAttempt] = useState<ExamAttempt | null>(null);
  const [editingExam, setEditingExam] = useState<Exam | null>(null);
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [isSyncingCloud, setIsSyncingCloud] = useState<boolean>(false);
  const [cloudSynced, setCloudSynced] = useState<boolean>(false);

  const [branding, setBranding] = useState<SiteBranding>(() => {
    try {
      const saved = localStorage.getItem(BRANDING_STORAGE_KEY);
      if (saved) {
        const parsed = JSON.parse(saved);
        if (parsed && typeof parsed === 'object') {
          return { ...DEFAULT_SITE_BRANDING, ...parsed };
        }
      }
    } catch {
      // Fallback
    }
    return DEFAULT_SITE_BRANDING;
  });

  const handleUpdateBranding = useCallback((newBranding: Partial<SiteBranding>) => {
    setBranding((prev) => {
      const updated = { ...prev, ...newBranding };
      try {
        localStorage.setItem(BRANDING_STORAGE_KEY, JSON.stringify(updated));
      } catch {
        // ignore
      }
      void saveSiteBrandingToCloud(updated).then(() => {
        setCloudSynced(true);
      });
      return updated;
    });
  }, []);

  const [syncFeedbackMessage, setSyncFeedbackMessage] = useState<string | null>(null);

  const handleSyncCloud = useCallback(async () => {
    setIsSyncingCloud(true);
    setSyncFeedbackMessage(null);
    try {
      const res = await syncAllToCloud(exams, branding);
      if (res.success) {
        setCloudSynced(true);
        setSyncFeedbackMessage(`✅ Đã đồng bộ thành công ${res.count} đề thi và giao diện lên Cloud!`);
      } else {
        setSyncFeedbackMessage(`⚠️ Lỗi đồng bộ: ${res.error || 'Vui lòng kiểm tra lại'}`);
      }
    } catch (err) {
      setSyncFeedbackMessage(`❌ Lỗi: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setIsSyncingCloud(false);
      window.setTimeout(() => {
        setSyncFeedbackMessage((prev) => (prev ? prev : null));
      }, 5000);
    }
  }, [exams, branding]);

  // Real-time Firestore listener for Site Branding (/settings/site_config)
  useEffect(() => {
    const unsubscribe = subscribeToSiteBranding((cloudBranding) => {
      if (cloudBranding) {
        setBranding(cloudBranding);
        setCloudSynced(true);
        try {
          localStorage.setItem(BRANDING_STORAGE_KEY, JSON.stringify(cloudBranding));
        } catch {
          // ignore
        }
      } else {
        // Cloud has no branding document yet — if this browser has custom localStorage branding, push it up automatically
        try {
          const localSaved = localStorage.getItem(BRANDING_STORAGE_KEY);
          if (localSaved) {
            const parsed = JSON.parse(localSaved);
            if (parsed && typeof parsed === 'object') {
              void saveSiteBrandingToCloud({ ...DEFAULT_SITE_BRANDING, ...parsed }).then(() => {
                setCloudSynced(true);
              });
            }
          }
        } catch {
          // ignore
        }
      }
    });
    return () => unsubscribe();
  }, []);

  // Real-time Firestore listener for Shared Exams (/exams)
  useEffect(() => {
    const unsubscribe = subscribeToCloudExams((cloudExams) => {
      setCloudSynced(true);
      setExams((localPrev) => {
        const filteredCloud: Exam[] = [];
        const cloudIds = new Set<string>();

        for (const exam of cloudExams) {
          const safeId = sanitizeDocId(exam.id);
          if (
            deletedExamIdsRef.current.has(exam.id) ||
            deletedExamIdsRef.current.has(safeId) ||
            IGNORED_EXAM_IDS.has(exam.id) ||
            IGNORED_EXAM_IDS.has(safeId)
          ) {
            // If this browser explicitly deleted this exam, ensure it's also removed from Cloud
            if (deletedExamIdsRef.current.has(exam.id) || deletedExamIdsRef.current.has(safeId)) {
              void deleteExamFromCloud(exam.id).catch(() => {});
            }
            continue;
          }
          if (!cloudIds.has(exam.id)) {
            cloudIds.add(exam.id);
            cloudIds.add(safeId);
            if (
              pendingSaveExamIdsRef.current.has(exam.id) ||
              pendingSaveExamIdsRef.current.has(safeId)
            ) {
              pendingSaveExamIdsRef.current.delete(exam.id);
              pendingSaveExamIdsRef.current.delete(safeId);
              persistPendingSaveIds();
            }
            filteredCloud.push(exam);
          }
        }

        // Preserve any exam that was saved locally in this browser and not yet confirmed in Cloud snapshot
        const inFlightLocal = localPrev.filter((e) => {
          if (!e || !e.id) return false;
          const sid = sanitizeDocId(e.id);
          return (
            !cloudIds.has(e.id) &&
            !cloudIds.has(sid) &&
            (pendingSaveExamIdsRef.current.has(e.id) ||
              pendingSaveExamIdsRef.current.has(sid)) &&
            !deletedExamIdsRef.current.has(e.id) &&
            !deletedExamIdsRef.current.has(sid)
          );
        });

        return [...inFlightLocal, ...filteredCloud];
      });
    });
    return () => unsubscribe();
  }, [persistPendingSaveIds]);

  // Sync document title with branding
  useEffect(() => {
    if (branding.title) {
      document.title = `${branding.title} - ${branding.subtitle}`;
    }
  }, [branding]);

  const syncRouteFromLocation = useCallback(
    (currentExams: Exam[], currentIsAdmin: boolean) => {
      const resolved = resolveAppRoute(
        window.location.pathname,
        window.location.search,
        currentExams,
        currentIsAdmin
      );

      if (resolved.type === 'dashboard') {
        setActiveView('dashboard');
        if (typeof resolved.openLibrary === 'boolean') {
          setIsLibraryOpen(resolved.openLibrary);
        }
        setForbiddenReason('');
      } else if (resolved.type === 'take-exam') {
        setActiveExamId(resolved.examId);
        setPreviewMode(Boolean(resolved.previewOnly));
        setReviewingAttempt(null);
        setActiveView('take-exam');
        setForbiddenReason('');
      } else if (resolved.type === 'create-exam') {
        setActiveView('create-exam');
        setForbiddenReason('');
      } else {
        setActiveView('forbidden');
        setForbiddenReason(resolved.reason);
      }
    },
    []
  );

  const examsRef = useRef<Exam[]>(exams);
  examsRef.current = exams;

  // Initial URL resolution and popstate listener (without resetting active views on background exam sync)
  useEffect(() => {
    syncRouteFromLocation(examsRef.current, isAdmin);
    const onPopState = () => syncRouteFromLocation(examsRef.current, isAdmin);
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, [isAdmin, syncRouteFromLocation]);

  // If user landed on a direct exam link (?de=...) before Cloud exams finished loading, re-check once exams arrive
  useEffect(() => {
    if (activeView === 'forbidden' && exams.length > 0) {
      syncRouteFromLocation(exams, isAdmin);
    }
  }, [exams, activeView, isAdmin, syncRouteFromLocation]);

  // Register DevTools Console-only Admin authentication commands
  useEffect(() => {
    const authenticateWithKey = (inputKey: string): string => {
      const customSaved = localStorage.getItem(CUSTOM_ADMIN_KEY_STORAGE);
      if (verifyAdminKey(inputKey, customSaved)) {
        try {
          sessionStorage.setItem(ADMIN_STORAGE_KEY, 'true');
          localStorage.setItem(ADMIN_STORAGE_KEY, 'true');
        } catch {
          // ignore
        }
        setIsAdmin(true);
        const msg =
          '✅ Đăng nhập Admin thành công! Quyền tạo đề, số hoá Word (.docx), chỉnh sửa và đồng bộ Cloud đã được mở khoá.';
        console.info(`%c${msg}`, 'color: #22c55e; font-weight: bold; font-size: 13px;');
        return msg;
      }
      const errMsg = '❌ Sai Admin Key! Bạn không có quyền tạo đề.';
      console.error(errMsg);
      return errMsg;
    };

    window.admin = authenticateWithKey;
    window.loginAdmin = authenticateWithKey;

    window.logoutAdmin = () => {
      try {
        sessionStorage.removeItem(ADMIN_STORAGE_KEY);
        localStorage.removeItem(ADMIN_STORAGE_KEY);
      } catch {
        // ignore
      }
      setIsAdmin(false);
      setActiveView((prev) => (prev === 'create-exam' ? 'dashboard' : prev));
      const msg = '🔒 Đã đăng xuất quyền Admin.';
      console.info(msg);
      return msg;
    };

    window.setAdminKey = (newKey: string) => {
      if (!isAdmin) {
        return '❌ Bạn cần đăng nhập Admin trước khi đổi key.';
      }
      if (!newKey || newKey.trim().length < 4) {
        return '❌ Key mới phải có ít nhất 4 ký tự.';
      }
      localStorage.setItem(CUSTOM_ADMIN_KEY_STORAGE, newKey.trim());
      return `✅ Đã cập nhật Admin Key mới thành công!`;
    };

    window.setBranding = (newBranding: Partial<SiteBranding>) => {
      if (!isAdmin) {
        return '❌ Bạn cần đăng nhập Admin trước khi đổi thông tin trang (tiêu đề, tên tác giả, phiên bản, logo).';
      }
      handleUpdateBranding(newBranding);
      return `✅ Đã cập nhật và đồng bộ thông tin trang lên Cloud thành công!`;
    };

    window.syncCloud = async () => {
      await handleSyncCloud();
      return '✅ Đã đồng bộ toàn bộ đề thi và giao diện lên Cloud thành công!';
    };

    try {
      Object.defineProperty(window, 'ADMIN_KEY', {
        configurable: true,
        get() {
          return isAdmin ? 'Đang đăng nhập Admin' : 'Nhập: admin("wangwibu2026")';
        },
        set(val: string) {
          authenticateWithKey(String(val));
        },
      });
    } catch {
      // ignore if defineProperty fails
    }

    console.info(
      `%c[Luyện đề Online - Console Admin Auth]\n%cĐể mở khoá quyền Admin tạo đề, gõ lệnh sau vào Console:\n  admin("${DEFAULT_ADMIN_KEY}")\nHoặc đăng xuất bằng: logoutAdmin()`,
      'color: #22c55e; font-weight: bold; font-size: 13px;',
      'color: #94a3b8; font-size: 12px;'
    );
  }, [isAdmin, exams, branding, handleUpdateBranding, handleSyncCloud]);

  useEffect(() => {
    try {
      localStorage.setItem(EXAMS_STORAGE_KEY, JSON.stringify(exams));
    } catch {
      // Ignore quota errors
    }
  }, [exams]);

  useEffect(() => {
    try {
      localStorage.setItem(ATTEMPTS_STORAGE_KEY, JSON.stringify(attempts));
    } catch {
      // Ignore quota errors
    }
  }, [attempts]);

  const navigateToUrl = (url: string) => {
    window.history.pushState({}, '', url);
    syncRouteFromLocation(exams, isAdmin);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handleOpenLibrary = () => {
    const base = getBasePathname();
    window.history.pushState({}, '', `${base}?view=library`);
    setIsLibraryOpen(true);
    setActiveView('dashboard');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handleCloseLibrary = () => {
    const base = getBasePathname();
    window.history.pushState({}, '', base);
    setIsLibraryOpen(false);
    setActiveView('dashboard');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handleStartExam = (examId: string, previewOnly = false) => {
    const base = getBasePathname();
    const safeTarget = sanitizeDocId(examId);
    const found = exams.find((e) => e.id === examId || sanitizeDocId(e.id) === safeTarget);
    if (!found) {
      window.history.pushState({}, '', `${base}?de=${encodeURIComponent(examId)}`);
      setActiveView('forbidden');
      setForbiddenReason('Link đề thi không đúng hoặc đề thi không tồn tại.');
      return;
    }
    window.history.pushState({}, '', `${base}?de=${encodeURIComponent(found.id)}`);
    setActiveExamId(found.id);
    setPreviewMode(previewOnly);
    setReviewingAttempt(null);
    setActiveView('take-exam');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handleReviewAttempt = (attempt: ExamAttempt) => {
    const base = getBasePathname();
    const exists = exams.some((e) => e.id === attempt.examId);
    if (!exists) {
      navigateToUrl(`${base}?de=${encodeURIComponent(attempt.examId)}`);
      return;
    }
    window.history.pushState({}, '', `${base}?de=${encodeURIComponent(attempt.examId)}`);
    setActiveExamId(attempt.examId);
    setReviewingAttempt(attempt);
    setPreviewMode(false);
    setActiveView('take-exam');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handleCompleteAttempt = (newAttempt: ExamAttempt) => {
    setAttempts((prev) => [newAttempt, ...prev]);
  };

  const handleCreateNewExam = () => {
    const base = getBasePathname();
    if (!isAdmin) {
      window.history.pushState({}, '', `${base}?view=create`);
      setActiveView('forbidden');
      setForbiddenReason('Chỉ Admin mới được phép tạo đề thi.');
      return;
    }
    window.history.pushState({}, '', `${base}?view=create`);
    setEditingExam(null);
    setActiveView('create-exam');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handleEditExam = (exam: Exam) => {
    const base = getBasePathname();
    if (!isAdmin) {
      window.history.pushState({}, '', `${base}?view=create`);
      setActiveView('forbidden');
      setForbiddenReason('Chỉ Admin mới được phép chỉnh sửa đề thi.');
      return;
    }
    window.history.pushState({}, '', `${base}?view=create`);
    setEditingExam(exam);
    setActiveView('create-exam');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handleSaveExam = (savedExam: Exam, startImmediately: boolean) => {
    if (!isAdmin) {
      setActiveView('forbidden');
      setForbiddenReason('Chỉ Admin mới được phép lưu đề thi.');
      return;
    }

    const canonicalId = sanitizeDocId(savedExam.id);
    const normalizedExam: Exam = {
      ...savedExam,
      id: canonicalId,
    };

    lastSavedExamRef.current = normalizedExam;
    deletedExamIdsRef.current.delete(canonicalId);
    deletedExamIdsRef.current.delete(savedExam.id);
    persistDeletedIds();
    pendingSaveExamIdsRef.current.add(canonicalId);
    persistPendingSaveIds();

    setExams((prev) => {
      const exists = prev.some((e) => sanitizeDocId(e.id) === canonicalId);
      const next = exists
        ? prev.map((e) => (sanitizeDocId(e.id) === canonicalId ? normalizedExam : e))
        : [normalizedExam, ...prev];
      try {
        localStorage.setItem(EXAMS_STORAGE_KEY, JSON.stringify(next));
      } catch {
        // ignore storage quota errors
      }
      return next;
    });

    setEditingExam(null);
    setSyncFeedbackMessage(`✅ Đã lưu đề thi "${normalizedExam.title}" thành công!`);
    window.setTimeout(() => {
      setSyncFeedbackMessage((prev) => (prev ? null : null));
    }, 4500);

    void saveExamToCloud(normalizedExam).then((ok) => {
      if (ok) {
        setCloudSynced(true);
      }
    });

    const base = getBasePathname();
    if (startImmediately) {
      window.history.pushState({}, '', `${base}?de=${encodeURIComponent(normalizedExam.id)}`);
      setActiveExamId(normalizedExam.id);
      setPreviewMode(false);
      setReviewingAttempt(null);
      setActiveView('take-exam');
    } else {
      window.history.pushState({}, '', `${base}?view=library`);
      setIsLibraryOpen(true);
      setActiveView('dashboard');
    }
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handleToggleFavorite = (examId: string) => {
    setExams((prev) =>
      prev.map((e) => {
        if (e.id === examId) {
          const updated = { ...e, isFavorite: !e.isFavorite };
          if (isAdmin) {
            void saveExamToCloud(updated);
          }
          return updated;
        }
        return e;
      })
    );
  };

  const handleDeleteExam = (examId: string) => {
    if (!isAdmin) return;
    const safeTarget = sanitizeDocId(examId);
    deletedExamIdsRef.current.add(examId);
    deletedExamIdsRef.current.add(safeTarget);
    persistDeletedIds();
    pendingSaveExamIdsRef.current.delete(examId);
    pendingSaveExamIdsRef.current.delete(safeTarget);
    persistPendingSaveIds();
    if (
      lastSavedExamRef.current &&
      (lastSavedExamRef.current.id === examId ||
        sanitizeDocId(lastSavedExamRef.current.id) === safeTarget)
    ) {
      lastSavedExamRef.current = null;
    }

    setExams((prev) => {
      const remaining = prev.filter(
        (e) => e.id !== examId && sanitizeDocId(e.id) !== safeTarget
      );
      try {
        localStorage.setItem(EXAMS_STORAGE_KEY, JSON.stringify(remaining));
      } catch {
        // ignore storage quota errors
      }
      return remaining;
    });

    void deleteExamFromCloud(examId).then(() => {
      setSyncFeedbackMessage('🗑️ Đã xoá vĩnh viễn đề thi khỏi thư viện và Cloud!');
      setTimeout(() => setSyncFeedbackMessage(''), 4000);
    });
  };

  const handleExportExamsJson = () => {
    const exportPayload = {
      branding,
      exams,
    };
    const jsonString = JSON.stringify(exportPayload, null, 2);
    const blob = new Blob([jsonString], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'exams.json';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const handleImportExamsJson = (
    importedExams: Exam[],
    importedBranding?: Partial<SiteBranding>
  ) => {
    if (!isAdmin || !Array.isArray(importedExams)) return;
    const nextBranding =
      importedBranding && typeof importedBranding === 'object'
        ? { ...branding, ...importedBranding }
        : branding;
    if (importedBranding && typeof importedBranding === 'object') {
      handleUpdateBranding(importedBranding);
    }
    setExams((prev) => {
      const map = new Map<string, Exam>();
      for (const e of prev) {
        if (e && e.id) map.set(sanitizeDocId(e.id), { ...e, id: sanitizeDocId(e.id) });
      }
      for (const item of importedExams) {
        if (item && typeof item.id === 'string' && Array.isArray(item.questions)) {
          const cid = sanitizeDocId(item.id);
          deletedExamIdsRef.current.delete(cid);
          map.set(cid, { ...item, id: cid });
        }
      }
      persistDeletedIds();
      const merged = Array.from(map.values());
      void syncAllToCloud(merged, nextBranding);
      return merged;
    });
  };

  const currentExam =
    exams.find(
      (e) =>
        e.id === activeExamId ||
        (activeExamId && sanitizeDocId(e.id) === sanitizeDocId(activeExamId))
    ) ||
    (lastSavedExamRef.current &&
    activeExamId &&
    sanitizeDocId(lastSavedExamRef.current.id) === sanitizeDocId(activeExamId)
      ? lastSavedExamRef.current
      : undefined);

  return (
    <div className="min-h-screen flex flex-col bg-[#f8fafc] text-slate-900">
      <div className="flex-1">
        {activeView === 'forbidden' && (
          <main className="max-w-xl mx-auto px-4 py-20 text-center">
            <div className="bg-white rounded-3xl border border-slate-200/80 shadow-md shadow-slate-200/40 p-10 space-y-5">
              <div className="w-16 h-16 rounded-full bg-rose-50 border border-rose-200 text-rose-600 flex items-center justify-center mx-auto">
                <ShieldOff className="w-8 h-8" />
              </div>

              <h1 className="text-2xl sm:text-3xl font-extrabold text-slate-900 tracking-tight">
                bạn không nên ở đây
              </h1>

              {forbiddenReason && (
                <p className="text-sm text-slate-500 max-w-md mx-auto">
                  {forbiddenReason}
                </p>
              )}

              <div className="pt-2">
                <button
                  type="button"
                  onClick={handleCloseLibrary}
                  className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-[#2563eb] hover:bg-blue-700 text-white text-xs font-bold shadow-xs transition-colors cursor-pointer"
                >
                  <ArrowLeft className="w-4 h-4" />
                  <span>Quay về trang chính</span>
                </button>
              </div>
            </div>
          </main>
        )}

        {(activeView === 'dashboard' || (activeView === 'take-exam' && !currentExam)) && (
          <DashboardView
            exams={exams}
            attempts={attempts}
            isAdmin={isAdmin}
            branding={branding}
            onUpdateBranding={handleUpdateBranding}
            isLibraryOpen={activeView === 'take-exam' ? true : isLibraryOpen}
            onOpenLibrary={handleOpenLibrary}
            onCloseLibrary={handleCloseLibrary}
            searchQuery={searchQuery}
            onSearchChange={setSearchQuery}
            onClearFilters={() => setSearchQuery('')}
            onStartExam={handleStartExam}
            onReviewAttempt={handleReviewAttempt}
            onEditExam={handleEditExam}
            onCreateNewExam={handleCreateNewExam}
            onToggleFavorite={handleToggleFavorite}
            onDeleteExam={handleDeleteExam}
            onExportExamsJson={handleExportExamsJson}
            onImportExamsJson={handleImportExamsJson}
            onSyncCloud={handleSyncCloud}
            isSyncingCloud={isSyncingCloud}
            cloudSynced={cloudSynced}
            syncFeedbackMessage={syncFeedbackMessage}
          />
        )}

        {activeView === 'take-exam' && currentExam && (
          <ExamTakeView
            exam={currentExam}
            initialAttempt={reviewingAttempt}
            previewMode={previewMode}
            onCompleteAttempt={handleCompleteAttempt}
            onBackToDashboard={() => {
              setReviewingAttempt(null);
              handleOpenLibrary();
            }}
          />
        )}

        {activeView === 'create-exam' && isAdmin && (
          <CreateExamView
            branding={branding}
            editingExam={editingExam}
            onSaveExam={handleSaveExam}
            onCancel={() => {
              setEditingExam(null);
              handleCloseLibrary();
            }}
          />
        )}
      </div>
    </div>
  );
}

