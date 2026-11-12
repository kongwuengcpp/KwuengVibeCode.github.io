import React, { useState, useMemo, useEffect, useRef } from 'react';
import {
  Briefcase,
  Box,
  ArrowLeft,
  Check,
  CheckCircle2,
  BookOpen,
  Info,
  Search,
  Plus,
  SquarePen,
  Trash2,
  Link2,
  Settings,
  Moon,
  Sun,
  Terminal,
  SlidersHorizontal,
  ChevronDown,
  ChevronUp,
  Download,
  Upload,
  Edit3,
  Image,
  RefreshCw,
  X,
  Save,
} from 'lucide-react';
import {
  Exam,
  ExamAttempt,
  ExamCategory,
  LIBRARY_SUBJECTS,
  SiteBranding,
  DEFAULT_SITE_BRANDING,
} from '../types/exam';
import { compressImageDataUriIfNeeded } from '../utils/docxHelper';
import { MAX_LOGO_CHARS, sanitizeDocId } from '../firebase';
import { GitHubSyncConfig } from '../utils/githubSync';

interface DashboardViewProps {
  exams: Exam[];
  attempts: ExamAttempt[];
  isAdmin: boolean;
  branding?: SiteBranding;
  onUpdateBranding?: (branding: Partial<SiteBranding>) => void;
  isLibraryOpen: boolean;
  onOpenLibrary: () => void;
  onCloseLibrary: () => void;
  searchQuery: string;
  onSearchChange: (q: string) => void;
  onClearFilters: () => void;
  onStartExam: (examId: string, previewOnly?: boolean) => void;
  onReviewAttempt: (attempt: ExamAttempt) => void;
  onEditExam: (exam: Exam) => void;
  onCreateNewExam: () => void;
  onToggleFavorite: (examId: string) => void;
  onDeleteExam: (examId: string) => void;
  onExportExamsJson?: () => void;
  onImportExamsJson?: (exams: Exam[], importedBranding?: Partial<SiteBranding>) => void;
  onSyncCloud?: () => Promise<void>;
  isSyncingCloud?: boolean;
  githubConfig?: GitHubSyncConfig;
  onUpdateGitHubConfig?: (partial: Partial<GitHubSyncConfig>) => GitHubSyncConfig;
  onSyncGitHub?: (overrideCfg?: Partial<GitHubSyncConfig>) => Promise<boolean>;
  isSyncingGitHub?: boolean;
  cloudSynced?: boolean;
  isLoadingExams?: boolean;
  cloudLoadError?: string | null;
  onReloadFromCloud?: () => Promise<void>;
  syncFeedbackMessage?: string | null;
  onDismissSyncFeedback?: () => void;
  unsyncedExamIds?: string[];
  onRetrySyncExam?: (exam: Exam) => Promise<void>;
  darkMode?: boolean;
  onToggleDarkMode?: () => void;
  lastActiveExamId?: string | null;
  savedLibraryScrollY?: number;
  restoreScrollTrigger?: number;
}

type SortField = 'id' | 'category' | 'title' | 'date';
type SortOrder = 'asc' | 'desc';

const MANUAL_DONE_STORAGE_KEY = 'luyende_manual_done_exams_prod_v1';

function normalizeSubjectCategory(cat: ExamCategory): ExamCategory {
  if ((LIBRARY_SUBJECTS as string[]).includes(cat)) {
    return cat;
  }
  if (cat === 'Lớp 12' || cat === 'Lớp 11' || cat === 'Lớp 10') {
    return 'Lịch sử';
  }
  if (cat === 'Đề thi THPT') {
    return 'Sinh học';
  }
  if (cat === 'Đại Học') {
    return 'Toán';
  }
  return 'Lịch sử';
}

export const DashboardView: React.FC<DashboardViewProps> = ({
  exams,
  attempts,
  isAdmin,
  branding = DEFAULT_SITE_BRANDING,
  onUpdateBranding,
  isLibraryOpen,
  onOpenLibrary,
  onCloseLibrary,
  searchQuery,
  onSearchChange,
  onStartExam,
  onReviewAttempt,
  onEditExam,
  onCreateNewExam,
  onDeleteExam,
  onExportExamsJson,
  onImportExamsJson,
  onSyncCloud,
  isSyncingCloud = false,
  githubConfig,
  onUpdateGitHubConfig,
  onSyncGitHub,
  isSyncingGitHub = false,
  cloudSynced = false,
  isLoadingExams = false,
  cloudLoadError = null,
  onReloadFromCloud,
  syncFeedbackMessage,
  onDismissSyncFeedback,
  unsyncedExamIds = [],
  onRetrySyncExam,
  darkMode = true,
  onToggleDarkMode,
  lastActiveExamId = null,
  savedLibraryScrollY = 0,
  restoreScrollTrigger = 0,
}) => {
  const [filterNotDone, setFilterNotDone] = useState<boolean>(true);
  const [filterDone, setFilterDone] = useState<boolean>(true);
  const [mobileFiltersExpanded, setMobileFiltersExpanded] = useState<boolean>(false);
  const jsonInputRef = useRef<HTMLInputElement | null>(null);

  // Mặc định lúc mới mở thư viện không tích chọn toàn bộ đề các môn
  const [selectedSubjects, setSelectedSubjects] = useState<Record<string, boolean>>(() => {
    const map: Record<string, boolean> = {};
    LIBRARY_SUBJECTS.forEach((s) => {
      map[s] = false;
    });
    return map;
  });

  useEffect(() => {
    if (isLibraryOpen) {
      const resetMap: Record<string, boolean> = {};
      LIBRARY_SUBJECTS.forEach((s) => {
        resetMap[s] = false;
      });
      setSelectedSubjects(resetMap);
      setMobileFiltersExpanded(false);
    }
  }, [isLibraryOpen]);

  const [manualDoneMap, setManualDoneMap] = useState<Record<string, boolean>>(() => {
    try {
      const saved = localStorage.getItem(MANUAL_DONE_STORAGE_KEY);
      if (saved) return JSON.parse(saved);
    } catch {
      // ignore
    }
    return {};
  });

  const [sortField, setSortField] = useState<SortField>('date');
  const [sortOrder, setSortOrder] = useState<SortOrder>('desc');
  const [copiedExamId, setCopiedExamId] = useState<string | null>(null);
  const [showAdminHint, setShowAdminHint] = useState<boolean>(false);
  const [isEditingBranding, setIsEditingBranding] = useState<boolean>(false);
  const [isEditingGitHubConfig, setIsEditingGitHubConfig] = useState<boolean>(false);
  const [examPendingDelete, setExamPendingDelete] = useState<Exam | null>(null);
  const [editTitle, setEditTitle] = useState<string>(branding.title);
  const [editSubtitle, setEditSubtitle] = useState<string>(branding.subtitle);
  const [editVersion, setEditVersion] = useState<string>(branding.version);
  const [editLogoUrl, setEditLogoUrl] = useState<string>(branding.logoUrl || '');
  const [brandingLogoError, setBrandingLogoError] = useState<string>('');
  const [retryingExamId, setRetryingExamId] = useState<string | null>(null);
  const brandingLogoInputRef = useRef<HTMLInputElement | null>(null);

  const [ghToken, setGhToken] = useState<string>(githubConfig?.token || '');
  const [ghOwner, setGhOwner] = useState<string>(githubConfig?.owner || 'kongwuengcpp');
  const [ghRepo, setGhRepo] = useState<string>(
    githubConfig?.repo || 'KwuengVibeCode.github.io'
  );
  const [ghBranch, setGhBranch] = useState<string>(githubConfig?.branch || 'main');
  const [ghFilePath, setGhFilePath] = useState<string>(
    githubConfig?.filePath || 'public/exams.json'
  );
  const [ghAutoSync, setGhAutoSync] = useState<boolean>(
    githubConfig?.autoSync ?? true
  );

  useEffect(() => {
    if (!githubConfig) return;
    setGhToken(githubConfig.token || '');
    setGhOwner(githubConfig.owner || 'kongwuengcpp');
    setGhRepo(githubConfig.repo || 'KwuengVibeCode.github.io');
    setGhBranch(githubConfig.branch || 'main');
    setGhFilePath(githubConfig.filePath || 'public/exams.json');
    setGhAutoSync(githubConfig.autoSync ?? true);
  }, [githubConfig]);

  const unsyncedSet = useMemo(() => {
    const s = new Set<string>();
    unsyncedExamIds.forEach((id) => {
      s.add(id);
      s.add(sanitizeDocId(id));
    });
    return s;
  }, [unsyncedExamIds]);

  useEffect(() => {
    setEditTitle(branding.title);
    setEditSubtitle(branding.subtitle);
    setEditVersion(branding.version);
    setEditLogoUrl(branding.logoUrl || '');
    setBrandingLogoError('');
  }, [branding]);

  useEffect(() => {
    if (!isEditingBranding && !isEditingGitHubConfig && !examPendingDelete) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (examPendingDelete) setExamPendingDelete(null);
        else if (isEditingGitHubConfig) setIsEditingGitHubConfig(false);
        else if (isEditingBranding) setIsEditingBranding(false);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [isEditingBranding, isEditingGitHubConfig, examPendingDelete]);

  const hasGitHubToken = Boolean(githubConfig?.token?.trim());

  const handleTriggerGitHubSyncClick = () => {
    if (!hasGitHubToken) {
      setIsEditingGitHubConfig(true);
      return;
    }
    if (onSyncGitHub) {
      void onSyncGitHub();
    }
  };

  const renderGitHubConfigModal = () => {
    if (!isEditingGitHubConfig || !isAdmin) return null;
    return (
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="github-config-modal-title"
        onClick={() => setIsEditingGitHubConfig(false)}
        className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4 overflow-y-auto"
      >
        <div
          onClick={(e) => e.stopPropagation()}
          className="w-full max-w-lg bg-white rounded-3xl border border-slate-200 shadow-2xl p-6 sm:p-7 space-y-5 text-left"
        >
          <div className="flex items-center justify-between pb-3 border-b border-slate-100">
            <div className="flex items-center gap-2.5">
              <div className="w-9 h-9 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-600 flex items-center justify-center shrink-0">
                <Upload className="w-5 h-5" />
              </div>
              <div>
                <h3
                  id="github-config-modal-title"
                  className="text-base font-extrabold text-slate-900"
                >
                  Cấu hình tự động đồng bộ GitHub
                </h3>
                <p className="text-xs text-slate-500">
                  Đẩy thẳng đề thi vào <code className="font-mono">public/exams.json</code> trên GitHub (Miễn phí 100%, không lo hết hạn mức)
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={() => setIsEditingGitHubConfig(false)}
              aria-label="Đóng cửa sổ"
              className="w-8 h-8 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-600 flex items-center justify-center cursor-pointer transition-colors"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          <div className="rounded-2xl bg-blue-50/70 border border-blue-200/80 p-3.5 text-xs text-slate-700 space-y-1.5 leading-relaxed">
            <div className="font-bold text-[#2563eb]">
              Hướng dẫn lấy GitHub Token (chỉ làm 1 lần duy nhất):
            </div>
            <div>
              1. Vào GitHub &rarr; <strong>Settings</strong> (ảnh đại diện góc phải) &rarr; <strong>Developer settings</strong> &rarr; <strong>Personal access tokens</strong> &rarr; <strong>Tokens (classic)</strong>.
            </div>
            <div>
              2. Bấm <strong>Generate new token (classic)</strong> &rarr; Tích chọn ô <strong>repo</strong> &rarr; Bấm Generate và dán mã <code className="font-mono">ghp_...</code> vào ô bên dưới.
            </div>
          </div>

          <form
            onSubmit={async (e) => {
              e.preventDefault();
              const nextCfg: Partial<GitHubSyncConfig> = {
                token: ghToken.trim(),
                owner: ghOwner.trim() || 'kongwuengcpp',
                repo: ghRepo.trim() || 'KwuengVibeCode.github.io',
                branch: ghBranch.trim() || 'main',
                filePath: ghFilePath.trim() || 'public/exams.json',
                autoSync: ghAutoSync,
              };
              onUpdateGitHubConfig?.(nextCfg);
              setIsEditingGitHubConfig(false);
              if (nextCfg.token && onSyncGitHub) {
                await onSyncGitHub(nextCfg);
              }
            }}
            className="space-y-4"
          >
            <div>
              <label
                htmlFor="gh-token-input"
                className="block text-xs font-bold text-slate-700 mb-1"
              >
                GitHub Personal Access Token (chỉ lưu trên trình duyệt của bạn)
              </label>
              <input
                id="gh-token-input"
                type="password"
                value={ghToken}
                onChange={(e) => setGhToken(e.target.value)}
                placeholder="Dán mã ghp_... hoặc github_pat_... vào đây"
                className="w-full rounded-xl border border-slate-300 bg-white px-3.5 py-2.5 text-xs font-mono text-slate-900 focus:outline-none focus:ring-2 focus:ring-[#2563eb]"
                required
              />
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label
                  htmlFor="gh-owner-input"
                  className="block text-xs font-bold text-slate-700 mb-1"
                >
                  Tài khoản GitHub (Owner)
                </label>
                <input
                  id="gh-owner-input"
                  type="text"
                  value={ghOwner}
                  onChange={(e) => setGhOwner(e.target.value)}
                  placeholder="kongwuengcpp"
                  className="w-full rounded-xl border border-slate-300 bg-white px-3.5 py-2 text-xs font-semibold text-slate-800 focus:outline-none focus:ring-2 focus:ring-[#2563eb]"
                  required
                />
              </div>
              <div>
                <label
                  htmlFor="gh-repo-input"
                  className="block text-xs font-bold text-slate-700 mb-1"
                >
                  Tên Repository
                </label>
                <input
                  id="gh-repo-input"
                  type="text"
                  value={ghRepo}
                  onChange={(e) => setGhRepo(e.target.value)}
                  placeholder="KwuengVibeCode.github.io"
                  className="w-full rounded-xl border border-slate-300 bg-white px-3.5 py-2 text-xs font-semibold text-slate-800 focus:outline-none focus:ring-2 focus:ring-[#2563eb]"
                  required
                />
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label
                  htmlFor="gh-branch-input"
                  className="block text-xs font-bold text-slate-700 mb-1"
                >
                  Nhánh (Branch)
                </label>
                <input
                  id="gh-branch-input"
                  type="text"
                  value={ghBranch}
                  onChange={(e) => setGhBranch(e.target.value)}
                  placeholder="main"
                  className="w-full rounded-xl border border-slate-300 bg-white px-3.5 py-2 text-xs font-semibold text-slate-800 focus:outline-none focus:ring-2 focus:ring-[#2563eb]"
                  required
                />
              </div>
              <div>
                <label
                  htmlFor="gh-path-input"
                  className="block text-xs font-bold text-slate-700 mb-1"
                >
                  Đường dẫn file đề tĩnh
                </label>
                <input
                  id="gh-path-input"
                  type="text"
                  value={ghFilePath}
                  onChange={(e) => setGhFilePath(e.target.value)}
                  placeholder="public/exams.json"
                  className="w-full rounded-xl border border-slate-300 bg-white px-3.5 py-2 text-xs font-mono text-slate-800 focus:outline-none focus:ring-2 focus:ring-[#2563eb]"
                  required
                />
              </div>
            </div>

            <label className="flex items-center gap-2.5 pt-1 text-xs font-semibold text-slate-700 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={ghAutoSync}
                onChange={(e) => setGhAutoSync(e.target.checked)}
                className="w-4 h-4 rounded border-slate-300 text-[#2563eb] accent-[#2563eb] cursor-pointer"
              />
              <span>
                Tự động đẩy lên GitHub ngay mỗi khi Tạo mới, Sửa hoặc Xoá đề thi (1–2 giây)
              </span>
            </label>

            <div className="pt-3 border-t border-slate-100 flex flex-wrap items-center justify-between gap-2">
              <button
                type="button"
                onClick={() => {
                  onUpdateGitHubConfig?.({
                    token: ghToken.trim(),
                    owner: ghOwner.trim() || 'kongwuengcpp',
                    repo: ghRepo.trim() || 'KwuengVibeCode.github.io',
                    branch: ghBranch.trim() || 'main',
                    filePath: ghFilePath.trim() || 'public/exams.json',
                    autoSync: ghAutoSync,
                  });
                  setIsEditingGitHubConfig(false);
                }}
                className="px-3.5 py-2 rounded-xl border border-slate-200 text-slate-700 hover:bg-slate-100 text-xs font-bold transition-colors cursor-pointer"
              >
                Chỉ lưu cấu hình
              </button>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setIsEditingGitHubConfig(false)}
                  className="px-3.5 py-2 rounded-xl border border-slate-200 text-slate-500 hover:bg-slate-100 text-xs font-semibold transition-colors cursor-pointer"
                >
                  Đóng
                </button>
                <button
                  type="submit"
                  disabled={isSyncingGitHub}
                  className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 disabled:opacity-60 text-white text-xs font-bold shadow-xs transition-colors cursor-pointer"
                >
                  <RefreshCw className={`w-3.5 h-3.5 ${isSyncingGitHub ? 'animate-spin' : ''}`} />
                  <span>Lưu &amp; Đồng bộ ngay lên GitHub</span>
                </button>
              </div>
            </div>
          </form>
        </div>
      </div>
    );
  };

  // Khôi phục đúng vị trí cuộn của đề vừa làm khi nhấn Quay lại từ màn hình làm bài / chỉnh sửa
  useEffect(() => {
    if (!isLibraryOpen || !restoreScrollTrigger) return;
    const raf = window.requestAnimationFrame(() => {
      if (typeof savedLibraryScrollY === 'number' && savedLibraryScrollY > 0) {
        window.scrollTo({ top: savedLibraryScrollY, behavior: 'instant' });
      }
      if (lastActiveExamId) {
        const nodes = document.querySelectorAll<HTMLElement>('[data-exam-id]');
        let targetEl: HTMLElement | null = null;
        nodes.forEach((node) => {
          const attr = node.getAttribute('data-exam-id') || '';
          if (
            (attr === lastActiveExamId ||
              sanitizeDocId(attr) === sanitizeDocId(lastActiveExamId)) &&
            node.offsetParent !== null
          ) {
            targetEl = node;
          }
        });
        if (targetEl) {
          const rect = (targetEl as HTMLElement).getBoundingClientRect();
          const inViewport =
            rect.top >= 72 && rect.bottom <= window.innerHeight - 24;
          if (!inViewport || !savedLibraryScrollY) {
            (targetEl as HTMLElement).scrollIntoView({
              block: 'center',
              behavior: 'instant',
            });
          }
        }
      }
    });
    return () => window.cancelAnimationFrame(raf);
  }, [isLibraryOpen, restoreScrollTrigger, lastActiveExamId, savedLibraryScrollY]);

  const handleSaveBranding = (e: React.FormEvent) => {
    e.preventDefault();
    if (!onUpdateBranding) return;
    if (editLogoUrl.trim().length > MAX_LOGO_CHARS) {
      setBrandingLogoError(
        `Ảnh logo quá lớn (${Math.ceil(editLogoUrl.length / 1024)} KB). Hãy chọn ảnh nhỏ hơn.`
      );
      return;
    }
    onUpdateBranding({
      title: editTitle.trim() || DEFAULT_SITE_BRANDING.title,
      subtitle: editSubtitle.trim() || DEFAULT_SITE_BRANDING.subtitle,
      version: editVersion.trim() || DEFAULT_SITE_BRANDING.version,
      logoUrl: editLogoUrl.trim(),
    });
    setIsEditingBranding(false);
  };

  const handleResetBranding = () => {
    if (!onUpdateBranding) return;
    onUpdateBranding(DEFAULT_SITE_BRANDING);
    setEditTitle(DEFAULT_SITE_BRANDING.title);
    setEditSubtitle(DEFAULT_SITE_BRANDING.subtitle);
    setEditVersion(DEFAULT_SITE_BRANDING.version);
    setEditLogoUrl('');
    setBrandingLogoError('');
    setIsEditingBranding(false);
  };

  const handleLogoUpload = (file: File) => {
    setBrandingLogoError('');
    const reader = new FileReader();
    reader.onload = async () => {
      if (typeof reader.result === 'string') {
        const compressed = await compressImageDataUriIfNeeded(reader.result, 350_000);
        if (compressed.length > MAX_LOGO_CHARS) {
          setBrandingLogoError(
            `Ảnh logo quá lớn (${Math.ceil(compressed.length / 1024)} KB) sau khi nén. Hãy chọn ảnh PNG/JPG/WebP nhẹ hơn.`
          );
          return;
        }
        setEditLogoUrl(compressed);
      }
    };
    reader.readAsDataURL(file);
  };

  const toggleManualDone = (examId: string) => {
    setManualDoneMap((prev) => {
      const next = { ...prev, [examId]: !prev[examId] };
      try {
        localStorage.setItem(MANUAL_DONE_STORAGE_KEY, JSON.stringify(next));
      } catch {
        // ignore
      }
      return next;
    });
  };

  const toggleSubject = (subject: string) => {
    setSelectedSubjects((prev) => ({
      ...prev,
      [subject]: !prev[subject],
    }));
  };

  const clearAllSubjectFilters = () => {
    const resetMap: Record<string, boolean> = {};
    LIBRARY_SUBJECTS.forEach((s) => {
      resetMap[s] = false;
    });
    setSelectedSubjects(resetMap);
  };

  const handleSortClick = (field: SortField) => {
    if (sortField === field) {
      setSortOrder((prev) => (prev === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortField(field);
      setSortOrder('desc');
    }
  };

  const handleCopyExamLink = (examId: string) => {
    const basePath = window.location.pathname
      .replace(/\/index\.html$/i, '')
      .replace(/\/(?:thu-vien|(?:nguoi-dung\/)?tao-de)\/?$/i, '')
      .replace(/\/+$/, '');
    const url = `${window.location.origin}${basePath}/?de=${encodeURIComponent(examId)}`;
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(url).catch(() => {});
    }
    setCopiedExamId(examId);
    window.setTimeout(() => {
      setCopiedExamId((prev) => (prev === examId ? null : prev));
    }, 2000);
  };

  const handleJsonFileUpload = async (file: File) => {
    try {
      const text = await file.text();
      const parsed = JSON.parse(text);
      if (Array.isArray(parsed) && onImportExamsJson) {
        onImportExamsJson(parsed as Exam[]);
      } else if (parsed && typeof parsed === 'object' && Array.isArray(parsed.exams) && onImportExamsJson) {
        onImportExamsJson(parsed.exams as Exam[], parsed.branding);
      }
    } catch {
      // ignore invalid json
    } finally {
      if (jsonInputRef.current) {
        jsonInputRef.current.value = '';
      }
    }
  };

  // Compute subject counts across all exams
  const subjectCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    LIBRARY_SUBJECTS.forEach((s) => {
      counts[s] = 0;
    });
    exams.forEach((exam) => {
      const subj = normalizeSubjectCategory(exam.category);
      counts[subj] = (counts[subj] || 0) + 1;
    });
    return counts;
  }, [exams]);

  // Map latest attempt per examId
  const latestAttemptByExamId = useMemo(() => {
    const map: Record<string, ExamAttempt> = {};
    for (const att of attempts) {
      if (!map[att.examId]) {
        map[att.examId] = att;
      }
    }
    return map;
  }, [attempts]);

  const selectedSubjectCount = useMemo(
    () => LIBRARY_SUBJECTS.filter((s) => Boolean(selectedSubjects[s])).length,
    [selectedSubjects]
  );

  // Filter and sort exams for Thư Viện Đề Thi
  const filteredExams = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    const hasActiveSubjectFilter = selectedSubjectCount > 0;

    const list = exams.filter((exam) => {
      const subj = normalizeSubjectCategory(exam.category);
      if (hasActiveSubjectFilter && !selectedSubjects[subj]) return false;

      const hasAttempt = Boolean(latestAttemptByExamId[exam.id]);
      const isDone = hasAttempt || Boolean(manualDoneMap[exam.id]);

      if (isDone && !filterDone) return false;
      if (!isDone && !filterNotDone) return false;

      if (q) {
        const code = (exam.examCode || exam.id).toLowerCase();
        const matchTitle = exam.title.toLowerCase().includes(q);
        const matchSubj = subj.toLowerCase().includes(q);
        const matchCode = code.includes(q);
        if (!matchTitle && !matchSubj && !matchCode) return false;
      }

      return true;
    });

    const getStableCode = (exam: Exam) => {
      if (exam.examCode && String(exam.examCode).trim()) {
        return String(exam.examCode).trim();
      }
      let hash = 0;
      for (let i = 0; i < exam.id.length; i++) {
        hash = (hash * 31 + exam.id.charCodeAt(i)) >>> 0;
      }
      return String(10000 + (hash % 90000));
    };

    const extractIdTs = (id: string) => {
      const m = id.match(/(\d{10,})/);
      return m ? Number(m[1]) : 0;
    };

    const parseDateScore = (e: Exam) => {
      const parts = (e.createdAt || '').split('/');
      const d = /^\d+$/.test(parts[0] || '') ? parts[0].padStart(2, '0') : '01';
      const m = /^\d+$/.test(parts[1] || '') ? parts[1].padStart(2, '0') : '01';
      const y = /^\d{4}$/.test(parts[2] || '') ? parts[2] : '2026';
      const tParts = (e.uploadTime || '11:00').split(':');
      const hh = /^\d+$/.test(tParts[0] || '') ? tParts[0].padStart(2, '0') : '11';
      const mm = /^\d+$/.test(tParts[1] || '') ? tParts[1].padStart(2, '0') : '00';
      const score = Number(`${y}${m}${d}${hh}${mm}`);
      return Number.isFinite(score) ? score : 0;
    };

    return [...list].sort((a, b) => {
      const dir = sortOrder === 'asc' ? 1 : -1;
      if (sortField === 'id') {
        const cmp = getStableCode(a).localeCompare(getStableCode(b));
        if (cmp !== 0) return cmp * dir;
      } else if (sortField === 'category') {
        const catA = normalizeSubjectCategory(a.category);
        const catB = normalizeSubjectCategory(b.category);
        const cmp = catA.localeCompare(catB, 'vi');
        if (cmp !== 0) return cmp * dir;
      } else if (sortField === 'title') {
        const cmp = a.title.localeCompare(b.title, 'vi');
        if (cmp !== 0) return cmp * dir;
      } else {
        const diff = parseDateScore(a) - parseDateScore(b);
        if (diff !== 0) return diff * dir;
      }

      // Deterministic tie-breakers so exams never jump around when cloud snapshots arrive
      const tsDiff = extractIdTs(a.id) - extractIdTs(b.id);
      if (tsDiff !== 0) return tsDiff * dir;
      return a.id.localeCompare(b.id) * dir;
    });
  }, [
    exams,
    selectedSubjects,
    selectedSubjectCount,
    latestAttemptByExamId,
    manualDoneMap,
    filterDone,
    filterNotDone,
    searchQuery,
    sortField,
    sortOrder,
  ]);

  // VIEW 1: Centered Landing Card (Reference Image 1)
  if (!isLibraryOpen) {
    return (
      <main className="min-h-screen flex flex-col items-center justify-center p-4 sm:p-6 relative transition-colors bg-[#f8fafc] text-slate-900">
        {/* Top-Right Utility Buttons */}
        <div className="fixed top-3.5 right-4 sm:top-4 sm:right-5 flex items-center gap-2 z-20">
          <button
            type="button"
            onClick={() => setShowAdminHint((prev) => !prev)}
            aria-label="Cài đặt hệ thống"
            title="Thông tin hệ thống & Quyền Admin"
            className="w-10 h-10 rounded-full bg-white border border-slate-200/90 shadow-xs flex items-center justify-center text-slate-600 hover:text-slate-900 hover:bg-slate-50 transition-colors cursor-pointer"
          >
            <Settings className="w-4 h-4" />
          </button>
          <button
            type="button"
            onClick={() => onToggleDarkMode?.()}
            aria-label={darkMode ? 'Chuyển sang chế độ sáng' : 'Chuyển sang chế độ tối'}
            title={darkMode ? 'Chế độ sáng' : 'Chế độ tối'}
            className="w-10 h-10 rounded-full bg-white border border-slate-200/90 shadow-xs flex items-center justify-center text-slate-600 hover:text-slate-900 hover:bg-slate-50 transition-colors cursor-pointer"
          >
            {darkMode ? <Sun className="w-4 h-4 text-amber-400" /> : <Moon className="w-4 h-4" />}
          </button>
        </div>

        {showAdminHint && (
          <div className="fixed top-16 right-4 sm:right-5 z-30 max-w-xs bg-white text-slate-800 rounded-2xl border border-slate-200 shadow-lg p-4 text-xs space-y-2">
            <div className="font-bold text-slate-900 flex items-center gap-1.5">
              <Terminal className="w-3.5 h-3.5 text-[#2563eb]" />
              <span>Trạng thái quyền hạn</span>
            </div>
            {isAdmin ? (
              <p className="text-emerald-700 font-medium">
                Đang bật quyền <strong>Admin</strong>. Nút "MỞ CÔNG CỤ TẠO ĐỀ" đã được hiển thị.
              </p>
            ) : (
              <p className="text-slate-600 leading-relaxed">
                Chỉ Admin mới có quyền tạo đề thi. Mở DevTools Console (F12) và nhập lệnh{' '}
                <code className="bg-slate-100 px-1.5 py-0.5 rounded font-mono text-slate-900">
                  admin(&quot;...&quot;)
                </code>{' '}
                để mở khoá công cụ tạo đề.
              </p>
            )}
          </div>
        )}

        {/* Main Centered Card */}
        <div className="w-full max-w-[780px] bg-white text-slate-900 rounded-3xl border border-slate-200/80 shadow-xl shadow-slate-200/50 p-6 sm:p-11 my-10">
          <div className="grid grid-cols-1 md:grid-cols-12 gap-6 md:gap-8 items-center">
            {/* Left Branding & Admin Tool Column */}
            <div className="md:col-span-5 md:border-r md:border-slate-200/80 md:pr-8 flex flex-col items-center md:items-start text-center md:text-left">
              {/* Emblem / Logo Icon */}
              <div className="relative group">
                <div className="w-16 h-16 rounded-2xl bg-white border border-slate-200/80 shadow-sm flex items-center justify-center mb-4 sm:mb-5 p-1.5 overflow-hidden">
                  {branding.logoUrl ? (
                    <img
                      src={branding.logoUrl}
                      alt="Logo đề thi"
                      loading="lazy"
                      decoding="async"
                      className="w-full h-full object-contain rounded-xl"
                    />
                  ) : (
                    <svg
                      viewBox="0 0 64 64"
                      className="w-full h-full"
                      aria-hidden="true"
                    >
                      <circle
                        cx="32"
                        cy="32"
                        r="29"
                        fill="#fff"
                        stroke="#dc2626"
                        strokeWidth="3.5"
                      />
                      <circle
                        cx="32"
                        cy="32"
                        r="23"
                        fill="#eff6ff"
                        stroke="#0284c7"
                        strokeWidth="1.5"
                        strokeDasharray="3 2"
                      />
                      {/* Open Book */}
                      <path
                        d="M16 40 C22 37, 28 38, 32 41 C36 38, 42 37, 48 40 L48 45 C42 42, 36 43, 32 46 C28 43, 22 42, 16 45 Z"
                        fill="#0284c7"
                      />
                      {/* Torch / Flame */}
                      <path
                        d="M32 16 C35 21, 37 24, 34 29 C36 27, 37 30, 32 34 C27 30, 28 27, 30 29 C27 24, 29 21, 32 16 Z"
                        fill="#ef4444"
                      />
                      <rect x="30.5" y="33" width="3" height="7" rx="1" fill="#dc2626" />
                    </svg>
                  )}
                </div>

                {isAdmin && (
                  <button
                    type="button"
                    onClick={() => setIsEditingBranding(true)}
                    title="Chỉnh sửa logo, tên trang, người tạo & phiên bản"
                    className="absolute -top-1.5 -right-1.5 w-6 h-6 rounded-full bg-blue-600 hover:bg-blue-700 text-white flex items-center justify-center shadow-sm cursor-pointer transition-transform hover:scale-110"
                  >
                    <Edit3 className="w-3 h-3" />
                  </button>
                )}
              </div>

              <div className="flex items-center gap-1.5">
                <h1 className="text-2xl sm:text-[26px] font-extrabold text-[#1e293b] leading-tight tracking-tight">
                  {branding.title}
                </h1>
                {isAdmin && (
                  <button
                    type="button"
                    onClick={() => setIsEditingBranding(true)}
                    title="Đổi tiêu đề trang"
                    className="text-slate-400 hover:text-blue-600 transition-colors p-1"
                  >
                    <Edit3 className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>

              <p className="text-sm font-medium text-slate-500 mt-1.5 whitespace-pre-line leading-relaxed">
                {branding.subtitle}
              </p>

              <div className="mt-3 flex items-center gap-2">
                <span className="inline-block px-2.5 py-1 rounded-md bg-slate-100 border border-slate-200/60 text-slate-600 text-[11px] font-bold tracking-wider uppercase">
                  {branding.version}
                </span>
                {isAdmin && (
                  <button
                    type="button"
                    onClick={() => setIsEditingBranding(true)}
                    className="inline-flex items-center gap-1 text-[11px] font-bold text-blue-600 hover:text-blue-700 hover:underline cursor-pointer"
                  >
                    <span>[Chỉnh sửa thông tin]</span>
                  </button>
                )}
              </div>

              {/* MỞ CÔNG CỤ TẠO ĐỀ & ĐỒNG BỘ GITHUB - Only visible to Admin */}
              {isAdmin && (
                <div className="mt-5 md:mt-7 w-full flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={onCreateNewExam}
                    className="w-full sm:w-auto inline-flex items-center justify-center gap-2 px-4 py-3 md:py-2.5 rounded-xl border border-blue-200 bg-blue-50/40 hover:bg-blue-50 text-[#2563eb] text-xs font-bold uppercase tracking-wide transition-colors cursor-pointer"
                  >
                    <Box className="w-4 h-4 shrink-0" />
                    <span>MỞ CÔNG CỤ TẠO ĐỀ</span>
                  </button>

                  <button
                    type="button"
                    onClick={handleTriggerGitHubSyncClick}
                    disabled={isSyncingGitHub}
                    title={
                      hasGitHubToken
                        ? `Đẩy thẳng ${exams.length} đề thi vào public/exams.json trên GitHub (${githubConfig?.owner}/${githubConfig?.repo})`
                        : 'Cấu hình GitHub Token để tự động đẩy đề thi lên GitHub với 1 cú nhấp'
                    }
                    className="w-full sm:w-auto inline-flex items-center justify-center gap-1.5 px-3.5 py-3 md:py-2.5 rounded-xl border border-emerald-200 bg-emerald-50/60 hover:bg-emerald-100/70 text-emerald-700 text-xs font-bold uppercase tracking-wide transition-colors cursor-pointer disabled:opacity-60"
                  >
                    <RefreshCw
                      className={`w-3.5 h-3.5 shrink-0 ${isSyncingGitHub ? 'animate-spin' : ''}`}
                    />
                    <span>
                      {isSyncingGitHub
                        ? 'ĐANG ĐẨY GITHUB...'
                        : hasGitHubToken
                        ? 'ĐỒNG BỘ LÊN GITHUB'
                        : 'CẤU HÌNH ĐỒNG BỘ GITHUB'}
                    </span>
                  </button>

                  <button
                    type="button"
                    onClick={() => setIsEditingGitHubConfig(true)}
                    title="Cấu hình GitHub Token & Repository"
                    className="inline-flex items-center justify-center gap-1 px-3 py-2.5 rounded-xl border border-slate-200 bg-white hover:bg-slate-100 text-slate-600 text-xs font-bold transition-colors cursor-pointer"
                  >
                    <Settings className="w-3.5 h-3.5" />
                    <span>Token GitHub</span>
                  </button>
                </div>
              )}

              {syncFeedbackMessage && (
                <div className="mt-2.5 w-full px-3.5 py-2.5 rounded-xl text-xs font-semibold bg-slate-900 text-white shadow-lg animate-fade-in flex items-center justify-between gap-2">
                  <span className="text-left leading-relaxed">{syncFeedbackMessage}</span>
                  {onDismissSyncFeedback && (
                    <button
                      type="button"
                      onClick={onDismissSyncFeedback}
                      aria-label="Đóng thông báo"
                      className="p-1 rounded-lg hover:bg-slate-800 text-slate-300 hover:text-white cursor-pointer shrink-0"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>
              )}
            </div>

            {/* Right Action Column - Only keeping Open Exam Library */}
            <div className="md:col-span-7 flex flex-col justify-center space-y-3.5 sm:space-y-4">
              <button
                type="button"
                onClick={onOpenLibrary}
                className="w-full min-h-[52px] py-4 px-6 rounded-xl bg-[#2563eb] hover:bg-blue-700 active:scale-[0.99] text-white font-bold text-sm uppercase tracking-wide shadow-md shadow-blue-600/20 flex items-center justify-center gap-2.5 transition-all cursor-pointer"
              >
                <Briefcase className="w-4 h-4 shrink-0" />
                <span>MỞ THƯ VIỆN ĐỀ THI</span>
              </button>

              <div className="rounded-xl border border-slate-100 bg-slate-50/70 px-4 py-3 text-center">
                <p className="text-xs text-slate-500 leading-relaxed">
                  Hiện có <strong className="text-slate-700">{exams.length} đề thi</strong> trong thư viện · Hỗ trợ Trắc nghiệm, Đúng/Sai và Trả lời ngắn
                </p>
              </div>
            </div>
          </div>
        </div>

        {/* Modal chỉnh sửa thông tin trang dành cho Admin */}
        {isEditingBranding && isAdmin && (
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="branding-modal-title"
            onClick={() => setIsEditingBranding(false)}
            className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4 overflow-y-auto"
          >
            <div
              onClick={(e) => e.stopPropagation()}
              className="w-full max-w-lg bg-white rounded-3xl border border-slate-200 shadow-2xl p-6 sm:p-7 space-y-5"
            >
              <div className="flex items-center justify-between pb-3 border-b border-slate-100">
                <div className="flex items-center gap-2.5">
                  <div className="w-9 h-9 rounded-xl bg-blue-50 border border-blue-200 text-[#2563eb] flex items-center justify-center shrink-0">
                    <Edit3 className="w-5 h-5" />
                  </div>
                  <div>
                    <h3 id="branding-modal-title" className="text-base font-extrabold text-slate-900">
                      Chỉnh sửa thông tin trang
                    </h3>
                    <p className="text-xs text-slate-500">
                      Dành cho Admin · Thay đổi tên trang, người tạo, phiên bản và logo
                    </p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setIsEditingBranding(false)}
                  aria-label="Đóng cửa sổ"
                  className="w-8 h-8 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-600 flex items-center justify-center cursor-pointer transition-colors"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              <form onSubmit={handleSaveBranding} className="space-y-4">
                {/* Logo / Biểu tượng */}
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1.5">
                    Logo / Biểu tượng trang
                  </label>
                  <div className="flex items-center gap-4 p-3 bg-slate-50 border border-slate-200 rounded-2xl">
                    <div className="w-16 h-16 rounded-xl bg-white border border-slate-200 flex items-center justify-center p-1 overflow-hidden shrink-0">
                      {editLogoUrl ? (
                        <img
                          src={editLogoUrl}
                          alt="Logo xem trước"
                          loading="lazy"
                          decoding="async"
                          className="w-full h-full object-contain rounded-lg"
                        />
                      ) : (
                        <svg viewBox="0 0 64 64" className="w-full h-full" aria-hidden="true">
                          <circle cx="32" cy="32" r="29" fill="#fff" stroke="#dc2626" strokeWidth="3.5" />
                          <circle cx="32" cy="32" r="23" fill="#eff6ff" stroke="#0284c7" strokeWidth="1.5" strokeDasharray="3 2" />
                          <path d="M16 40 C22 37, 28 38, 32 41 C36 38, 42 37, 48 40 L48 45 C42 42, 36 43, 32 46 C28 43, 22 42, 16 45 Z" fill="#0284c7" />
                          <path d="M32 16 C35 21, 37 24, 34 29 C36 27, 37 30, 32 34 C27 30, 28 27, 30 29 C27 24, 29 21, 32 16 Z" fill="#ef4444" />
                          <rect x="30.5" y="33" width="3" height="7" rx="1" fill="#dc2626" />
                        </svg>
                      )}
                    </div>

                    <div className="flex-1 space-y-1.5">
                      <input
                        ref={brandingLogoInputRef}
                        type="file"
                        accept="image/*"
                        aria-label="Tải ảnh logo từ máy"
                        onChange={(e) => {
                          const file = e.target.files?.[0];
                          if (file) handleLogoUpload(file);
                        }}
                        className="sr-only"
                      />
                      <div className="flex flex-wrap items-center gap-2">
                        <button
                          type="button"
                          onClick={() => brandingLogoInputRef.current?.click()}
                          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-white hover:bg-slate-100 border border-slate-300 text-xs font-semibold text-slate-700 cursor-pointer transition-colors"
                        >
                          <Image className="w-3.5 h-3.5 text-blue-600" />
                          <span>Tải ảnh mới</span>
                        </button>
                        {editLogoUrl && (
                          <button
                            type="button"
                            onClick={() => {
                              setEditLogoUrl('');
                              setBrandingLogoError('');
                            }}
                            className="px-2.5 py-1.5 rounded-xl border border-rose-200 text-rose-600 hover:bg-rose-50 text-xs font-semibold cursor-pointer transition-colors"
                          >
                            Dùng logo mặc định
                          </button>
                        )}
                      </div>
                      <p className="text-[11px] text-slate-400">
                        Hỗ trợ PNG, JPG, SVG hoặc WebP vuông tỉ lệ 1:1
                      </p>
                      {brandingLogoError && (
                        <p className="text-xs font-semibold text-rose-600">
                          {brandingLogoError}
                        </p>
                      )}
                    </div>
                  </div>
                </div>

                {/* Tên trang web */}
                <div>
                  <label htmlFor="edit-site-title" className="block text-xs font-bold text-slate-700 mb-1">
                    Tiêu đề chính trang web
                  </label>
                  <input
                    id="edit-site-title"
                    type="text"
                    value={editTitle}
                    onChange={(e) => setEditTitle(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') e.preventDefault();
                    }}
                    placeholder="Ví dụ: Luyện đề Online"
                    className="w-full rounded-xl border border-slate-300 bg-white px-3.5 py-2.5 text-sm font-semibold text-slate-900 focus:outline-none focus:ring-2 focus:ring-[#2563eb]"
                    required
                  />
                </div>

                {/* Dòng chữ phụ / Người tạo / Ghi công đóng góp */}
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <label htmlFor="edit-site-subtitle" className="block text-xs font-bold text-slate-700">
                      Mục giới thiệu / Người tạo / Ghi công đóng góp
                    </label>
                    <span className="text-[11px] font-medium text-slate-400">
                      Nhấn Enter để xuống dòng
                    </span>
                  </div>
                  <textarea
                    id="edit-site-subtitle"
                    rows={4}
                    value={editSubtitle}
                    onChange={(e) => setEditSubtitle(e.target.value)}
                    placeholder={'Ví dụ:\nFrom : NguyenCongQuang\nMục tri ân người đóng góp sửa chữa đáp án :\n- Bạn A\n- Bạn B'}
                    className="w-full rounded-xl border border-slate-300 bg-white px-3.5 py-2.5 text-sm font-medium text-slate-800 leading-relaxed focus:outline-none focus:ring-2 focus:ring-[#2563eb] resize-y"
                    required
                  />
                </div>

                {/* Phiên bản (Version) */}
                <div>
                  <label htmlFor="edit-site-version" className="block text-xs font-bold text-slate-700 mb-1">
                    Nhãn phiên bản (Badge)
                  </label>
                  <input
                    id="edit-site-version"
                    type="text"
                    value={editVersion}
                    onChange={(e) => setEditVersion(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') e.preventDefault();
                    }}
                    placeholder="Ví dụ: VERSION 4.16"
                    className="w-full rounded-xl border border-slate-300 bg-white px-3.5 py-2.5 text-sm font-medium text-slate-800 focus:outline-none focus:ring-2 focus:ring-[#2563eb]"
                  />
                </div>

                {/* Nút thao tác */}
                <div className="pt-3 border-t border-slate-100 flex items-center justify-between gap-3">
                  <button
                    type="button"
                    onClick={handleResetBranding}
                    className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-semibold text-slate-500 hover:text-rose-600 hover:bg-rose-50 transition-colors cursor-pointer"
                  >
                    <RefreshCw className="w-3.5 h-3.5" />
                    <span>Khôi phục mặc định</span>
                  </button>

                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => setIsEditingBranding(false)}
                      className="px-4 py-2 rounded-xl border border-slate-200 text-slate-600 hover:bg-slate-100 text-xs font-semibold transition-colors cursor-pointer"
                    >
                      Hủy
                    </button>
                    <button
                      type="submit"
                      className="inline-flex items-center gap-1.5 px-5 py-2 rounded-xl bg-[#2563eb] hover:bg-blue-700 text-white text-xs font-bold shadow-xs transition-colors cursor-pointer"
                    >
                      <Save className="w-3.5 h-3.5" />
                      <span>Lưu thay đổi</span>
                    </button>
                  </div>
                </div>
              </form>
            </div>
          </div>
        )}
        {renderGitHubConfigModal()}
      </main>
    );
  }

  // VIEW 2: Thư Viện Đề Thi (Responsive Mobile + Desktop)
  return (
    <div className="min-h-screen flex flex-col bg-[#f8fafc] text-slate-900">
      <input
        ref={jsonInputRef}
        type="file"
        accept=".json,application/json"
        aria-label="Nhập dữ liệu đề thi (.json)"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) handleJsonFileUpload(f);
        }}
        className="sr-only"
      />

      {/* Top Library Header */}
      <header className="bg-white border-b border-slate-200 px-3.5 sm:px-6 py-2.5 sm:py-3.5 sticky top-0 z-30">
        <div className="flex items-center justify-between gap-2 sm:gap-4">
          <div className="flex items-center gap-2.5 sm:gap-3 min-w-0">
            <div className="w-9 h-9 rounded-xl bg-blue-50 border border-blue-100 text-[#2563eb] flex items-center justify-center shrink-0">
              <Briefcase className="w-5 h-5" />
            </div>
            <div className="min-w-0">
              <h1 className="text-base sm:text-xl font-extrabold text-slate-800 leading-tight truncate">
                Thư Viện Đề Thi
              </h1>
              <p
                className={`text-[11px] sm:text-xs font-medium truncate ${
                  cloudLoadError
                    ? 'text-rose-500'
                    : isLoadingExams && !cloudSynced
                    ? 'text-amber-500'
                    : cloudSynced
                    ? 'text-emerald-500'
                    : 'text-slate-400'
                }`}
              >
                {cloudLoadError
                  ? 'Kết nối Cloud bị gián đoạn · Nhấn tải lại'
                  : isLoadingExams && !cloudSynced
                  ? 'Đang tải dữ liệu đề thi từ Cloud...'
                  : cloudSynced
                  ? 'Đã đồng bộ xong dữ liệu'
                  : 'Đang kết nối dữ liệu...'}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            {/* Desktop Quick Search Input */}
            <div className="hidden sm:block relative w-52 md:w-64">
              <input
                type="search"
                aria-label="Tìm kiếm đề thi"
                value={searchQuery}
                onChange={(e) => onSearchChange(e.target.value)}
                placeholder="Tìm tên đề, mã ID..."
                className="w-full rounded-lg border border-slate-200 bg-slate-50/80 focus:bg-white pl-3 pr-8 py-2 text-xs text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-[#2563eb]"
              />
              <Search className="w-3.5 h-3.5 text-slate-400 absolute right-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
            </div>

            {isAdmin && (
              <>
                <button
                  type="button"
                  onClick={handleTriggerGitHubSyncClick}
                  disabled={isSyncingGitHub || isSyncingCloud}
                  title={
                    hasGitHubToken
                      ? `Đẩy thẳng toàn bộ đề thi vào public/exams.json trên GitHub (${githubConfig?.owner}/${githubConfig?.repo}) chỉ trong 1–2 giây`
                      : 'Nhấn để cấu hình GitHub Token và tự động đồng bộ đề thi lên GitHub'
                  }
                  className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-emerald-200 bg-emerald-50 hover:bg-emerald-100 text-emerald-700 text-xs font-bold transition-colors cursor-pointer whitespace-nowrap disabled:opacity-60"
                >
                  <RefreshCw
                    className={`w-3.5 h-3.5 ${
                      isSyncingGitHub || isSyncingCloud ? 'animate-spin' : ''
                    }`}
                  />
                  <span className="hidden sm:inline">
                    {isSyncingGitHub
                      ? 'Đang đẩy GitHub...'
                      : hasGitHubToken
                      ? 'Đồng bộ GitHub'
                      : 'Cấu hình GitHub'}
                  </span>
                </button>

                <button
                  type="button"
                  onClick={() => setIsEditingGitHubConfig(true)}
                  title="Cấu hình GitHub Token & tự động đồng bộ"
                  className="inline-flex items-center gap-1 px-2.5 py-2 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 text-slate-700 text-xs font-bold transition-colors cursor-pointer whitespace-nowrap"
                >
                  <Settings className="w-3.5 h-3.5 text-slate-600" />
                  <span className="hidden xl:inline">Token</span>
                </button>

                {onExportExamsJson && (
                  <button
                    type="button"
                    onClick={onExportExamsJson}
                    title="Xuất exams.json rồi đưa lên GitHub (public/exams.json). Học sinh đọc đề từ file này nên mỗi lần thêm/sửa/xóa đề hãy xuất lại. Cũng dùng để sao lưu."
                    className="hidden md:inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 text-slate-700 text-xs font-bold transition-colors cursor-pointer whitespace-nowrap"
                  >
                    <Download className="w-3.5 h-3.5 text-[#2563eb]" />
                    <span>Xuất exams.json</span>
                  </button>
                )}

                {onImportExamsJson && (
                  <button
                    type="button"
                    onClick={() => jsonInputRef.current?.click()}
                    title="Nhập dữ liệu đề thi từ file .json"
                    className="hidden md:inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 text-slate-700 text-xs font-bold transition-colors cursor-pointer whitespace-nowrap"
                  >
                    <Upload className="w-3.5 h-3.5 text-slate-600" />
                    <span>Nhập .json</span>
                  </button>
                )}

                <button
                  type="button"
                  onClick={onCreateNewExam}
                  className="inline-flex items-center gap-1.5 px-3 sm:px-3.5 py-2 rounded-lg bg-[#2563eb] hover:bg-blue-700 text-white text-xs font-bold transition-colors cursor-pointer whitespace-nowrap"
                >
                  <Plus className="w-4 h-4" />
                  <span className="hidden sm:inline">TẠO ĐỀ MỚI</span>
                  <span className="sm:hidden">TẠO ĐỀ</span>
                </button>
              </>
            )}

            {onToggleDarkMode && (
              <button
                type="button"
                onClick={onToggleDarkMode}
                aria-label={darkMode ? 'Chuyển sang chế độ sáng' : 'Chuyển sang chế độ tối'}
                title={darkMode ? 'Chế độ sáng' : 'Chế độ tối'}
                className="w-9 h-9 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 text-slate-600 hover:text-slate-900 flex items-center justify-center transition-colors cursor-pointer shrink-0"
              >
                {darkMode ? (
                  <Sun className="w-4 h-4 text-amber-400" />
                ) : (
                  <Moon className="w-4 h-4" />
                )}
              </button>
            )}

            <button
              type="button"
              onClick={onCloseLibrary}
              className="inline-flex items-center gap-1.5 px-3 sm:px-4 py-2 rounded-lg bg-slate-100 hover:bg-slate-200 border border-slate-200/80 text-slate-700 text-xs font-bold uppercase tracking-wide transition-colors cursor-pointer whitespace-nowrap"
            >
              <ArrowLeft className="w-3.5 h-3.5" />
              <span>QUAY LẠI</span>
            </button>
          </div>
        </div>

        {/* Mobile Search & Filter Toggle Row (Only visible on < sm / < lg) */}
        <div className="mt-2.5 flex items-center gap-2 lg:hidden">
          <div className="relative flex-1 sm:hidden">
            <input
              type="search"
              aria-label="Tìm kiếm đề thi trên điện thoại"
              value={searchQuery}
              onChange={(e) => onSearchChange(e.target.value)}
              placeholder="Tìm tên đề, môn học, mã ID..."
              className="w-full rounded-xl border border-slate-200 bg-slate-50 focus:bg-white pl-3 pr-8 py-2 text-xs text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-[#2563eb]"
            />
            <Search className="w-3.5 h-3.5 text-slate-400 absolute right-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
          </div>

          <button
            type="button"
            onClick={() => setMobileFiltersExpanded((prev) => !prev)}
            aria-expanded={mobileFiltersExpanded}
            className={`inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl border text-xs font-bold transition-colors cursor-pointer shrink-0 ${
              selectedSubjectCount > 0 || mobileFiltersExpanded
                ? 'bg-blue-50 border-blue-200 text-[#2563eb]'
                : 'bg-white border-slate-200 text-slate-700'
            }`}
          >
            <SlidersHorizontal className="w-3.5 h-3.5" />
            <span>
              Bộ lọc môn{selectedSubjectCount > 0 ? ` (${selectedSubjectCount})` : ''}
            </span>
            {mobileFiltersExpanded ? (
              <ChevronUp className="w-3.5 h-3.5" />
            ) : (
              <ChevronDown className="w-3.5 h-3.5" />
            )}
          </button>
        </div>
        {/* Sync Feedback Banner in Library View */}
        {syncFeedbackMessage && (
          <div className="mt-2.5 px-3.5 py-2.5 rounded-xl text-xs font-semibold bg-slate-900 text-white shadow-md flex items-center justify-between gap-2">
            <span>{syncFeedbackMessage}</span>
            {onDismissSyncFeedback && (
              <button
                type="button"
                onClick={onDismissSyncFeedback}
                aria-label="Đóng thông báo"
                className="p-1 rounded-lg hover:bg-slate-800 text-slate-300 hover:text-white cursor-pointer shrink-0"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
        )}
      </header>

      {/* Main 2-Column Content */}
      <div className="flex-1 flex flex-col lg:flex-row">
        {/* Left Sidebar Filters (Always visible on lg+, toggleable on mobile) */}
        <aside
          className={`${
            mobileFiltersExpanded ? 'block' : 'hidden'
          } lg:block w-full lg:w-[250px] shrink-0 bg-white border-b lg:border-b-0 lg:border-r border-slate-200 p-4 sm:p-5 space-y-5 lg:space-y-6`}
        >
          {/* TRẠNG THÁI LÀM BÀI */}
          <div>
            <div className="flex items-center gap-1.5 text-[11px] font-bold text-slate-400 uppercase tracking-wider mb-3">
              <CheckCircle2 className="w-3.5 h-3.5" />
              <span>TRẠNG THÁI LÀM BÀI</span>
            </div>
            <div className="flex flex-wrap lg:flex-col gap-4 lg:gap-2.5">
              <label className="flex items-center gap-2.5 text-xs font-semibold text-slate-700 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={filterNotDone}
                  onChange={() => setFilterNotDone(!filterNotDone)}
                  className="w-4 h-4 rounded border-slate-300 text-[#2563eb] accent-[#2563eb] cursor-pointer"
                />
                <span>Chưa làm</span>
              </label>

              <label className="flex items-center gap-2.5 text-xs font-semibold text-slate-700 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={filterDone}
                  onChange={() => setFilterDone(!filterDone)}
                  className="w-4 h-4 rounded border-slate-300 text-[#2563eb] accent-[#2563eb] cursor-pointer"
                />
                <span>Đã làm / Ngoài</span>
              </label>
            </div>
          </div>

          <hr className="border-slate-100" />

          {/* MÔN HỌC */}
          <div>
            <div className="flex items-center justify-between gap-2 mb-3">
              <div className="flex items-center gap-1.5 text-[11px] font-bold text-slate-400 uppercase tracking-wider">
                <BookOpen className="w-3.5 h-3.5" />
                <span>MÔN HỌC</span>
              </div>
              {selectedSubjectCount > 0 && (
                <button
                  type="button"
                  onClick={clearAllSubjectFilters}
                  className="text-[11px] font-bold text-[#2563eb] hover:underline cursor-pointer"
                >
                  Bỏ chọn ({selectedSubjectCount})
                </button>
              )}
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-1 gap-2.5">
              {LIBRARY_SUBJECTS.map((subject) => {
                const count = subjectCounts[subject] || 0;
                const isChecked = Boolean(selectedSubjects[subject]);
                return (
                  <label
                    key={subject}
                    className="flex items-center justify-between gap-2 text-xs font-semibold text-slate-700 cursor-pointer select-none hover:text-slate-900 py-1 lg:py-0"
                  >
                    <div className="flex items-center gap-2.5 min-w-0">
                      <input
                        type="checkbox"
                        checked={isChecked}
                        onChange={() => toggleSubject(subject)}
                        className="w-4 h-4 rounded border-slate-300 text-[#2563eb] accent-[#2563eb] cursor-pointer shrink-0"
                      />
                      <span className="truncate">{subject}</span>
                    </div>
                    <span className="px-2 py-0.5 rounded bg-slate-100 text-slate-500 text-[11px] font-bold tabular-nums shrink-0">
                      {count}
                    </span>
                  </label>
                );
              })}
            </div>
          </div>
        </aside>

        {/* Right Content Area */}
        <main className="flex-1 p-3.5 sm:p-6 overflow-x-hidden">
          {/* Quick Horizontal Subject Chips on Mobile (< lg) */}
          <div className="lg:hidden flex items-center gap-1.5 overflow-x-auto pb-2.5 mb-2 no-scrollbar">
            <button
              type="button"
              onClick={clearAllSubjectFilters}
              className={`px-3 py-1.5 rounded-xl text-xs font-bold whitespace-nowrap shrink-0 transition-colors cursor-pointer ${
                selectedSubjectCount === 0
                  ? 'bg-[#2563eb] text-white shadow-2xs'
                  : 'bg-white border border-slate-200 text-slate-600'
              }`}
            >
              Tất cả ({exams.length})
            </button>
            {LIBRARY_SUBJECTS.map((subject) => {
              const isSelected = Boolean(selectedSubjects[subject]);
              const count = subjectCounts[subject] || 0;
              return (
                <button
                  key={subject}
                  type="button"
                  onClick={() => toggleSubject(subject)}
                  className={`px-3 py-1.5 rounded-xl text-xs font-bold whitespace-nowrap shrink-0 transition-colors cursor-pointer ${
                    isSelected
                      ? 'bg-[#2563eb] text-white shadow-2xs'
                      : 'bg-white border border-slate-200 text-slate-700'
                  }`}
                >
                  {subject} ({count})
                </button>
              );
            })}
          </div>

          {/* Subheader Bar */}
          <div className="flex flex-wrap items-center justify-between gap-2 mb-3.5 text-xs">
            <div className="font-semibold text-slate-700">
              Tìm thấy{' '}
              <span className="text-[#2563eb] font-extrabold tabular-nums">
                {filteredExams.length}
              </span>{' '}
              đề thi
            </div>

            <div className="hidden md:inline-flex items-center gap-1.5 text-slate-500">
              <span>Bấm vào tiêu đề cột để sắp xếp</span>
              <span className="w-4 h-4 rounded bg-[#0284c7] text-white inline-flex items-center justify-center text-[10px] font-bold">
                <Info className="w-3 h-3" />
              </span>
            </div>
          </div>

          {/* MOBILE CARD LIST (< md) */}
          <div className="md:hidden space-y-3">
            {filteredExams.length === 0 ? (
              <div className="bg-white rounded-2xl border border-slate-200/90 p-8 text-center space-y-3">
                <p className="text-sm text-slate-500">
                  {exams.length === 0
                    ? isLoadingExams
                      ? 'Đang tải danh sách đề thi từ Cloud...'
                      : 'Chưa có đề thi nào hiển thị hoặc kết nối mạng bị chặn.'
                    : 'Không tìm thấy đề thi nào phù hợp với bộ lọc hiện tại.'}
                </p>
                {cloudLoadError && exams.length === 0 && (
                  <p className="text-xs text-rose-500 font-medium">
                    Chi tiết: {cloudLoadError}
                  </p>
                )}
                {exams.length === 0 && (
                  <div className="pt-1 flex flex-wrap items-center justify-center gap-2.5">
                    {onReloadFromCloud && (
                      <button
                        type="button"
                        disabled={isLoadingExams}
                        onClick={() => {
                          void onReloadFromCloud();
                        }}
                        className="inline-flex items-center gap-1.5 px-4 py-2.5 rounded-xl bg-[#2563eb] hover:bg-blue-700 disabled:opacity-60 text-white text-xs font-bold transition-colors cursor-pointer"
                      >
                        <RefreshCw
                          className={`w-3.5 h-3.5 ${isLoadingExams ? 'animate-spin' : ''}`}
                        />
                        <span>
                          {isLoadingExams ? 'Đang tải từ Cloud...' : 'Tải lại danh sách đề'}
                        </span>
                      </button>
                    )}
                    {isAdmin && (
                      <button
                        type="button"
                        onClick={onCreateNewExam}
                        className="inline-flex items-center gap-1.5 px-4 py-2.5 rounded-xl border border-slate-200 bg-slate-100 hover:bg-slate-200 text-slate-800 text-xs font-bold cursor-pointer"
                      >
                        <Plus className="w-4 h-4" />
                        <span>Tạo đề thi đầu tiên</span>
                      </button>
                    )}
                  </div>
                )}
              </div>
            ) : (
              filteredExams.map((exam) => {
                let hash = 0;
                for (let i = 0; i < exam.id.length; i++) {
                  hash = (hash * 31 + exam.id.charCodeAt(i)) >>> 0;
                }
                const displayCode =
                  exam.examCode || String(10000 + (hash % 90000));
                const subj = normalizeSubjectCategory(exam.category);
                const latestAttempt = latestAttemptByExamId[exam.id];
                const isManuallyDone = Boolean(manualDoneMap[exam.id]);
                const isCompleted = Boolean(latestAttempt) || isManuallyDone;
                const isUnsynced =
                  unsyncedSet.has(exam.id) || unsyncedSet.has(sanitizeDocId(exam.id));
                const isRecentlyActive = Boolean(
                  lastActiveExamId &&
                    (exam.id === lastActiveExamId ||
                      sanitizeDocId(exam.id) === sanitizeDocId(lastActiveExamId))
                );

                return (
                  <div
                    key={exam.id}
                    data-exam-id={exam.id}
                    className={`bg-white rounded-2xl border p-4 shadow-2xs space-y-3 transition-shadow ${
                      isRecentlyActive
                        ? 'border-[#2563eb] ring-2 ring-[#2563eb]/40'
                        : 'border-slate-200/90'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex flex-wrap items-center gap-2 min-w-0">
                        <span className="px-2.5 py-1 rounded-md bg-[#f1f5f9] border border-slate-200/70 text-slate-700 text-xs font-bold whitespace-nowrap">
                          {subj}
                        </span>
                        <span className="text-xs font-semibold text-slate-400 tabular-nums">
                          #{displayCode}
                        </span>
                        {isUnsynced && (
                          <span className="px-2 py-0.5 rounded-md bg-amber-50 border border-amber-200 text-amber-800 text-[11px] font-bold">
                            Chưa đồng bộ
                          </span>
                        )}
                      </div>

                      <div className="flex items-center gap-2 shrink-0">
                        {isUnsynced && isAdmin && onRetrySyncExam && (
                          <button
                            type="button"
                            disabled={retryingExamId === exam.id}
                            onClick={async () => {
                              setRetryingExamId(exam.id);
                              try {
                                await onRetrySyncExam(exam);
                              } finally {
                                setRetryingExamId(null);
                              }
                            }}
                            className="px-2.5 py-1 rounded-md bg-amber-600 hover:bg-amber-700 disabled:opacity-50 text-white text-xs font-bold cursor-pointer"
                          >
                            {retryingExamId === exam.id ? 'Đang gửi...' : 'Đồng bộ lại'}
                          </button>
                        )}
                        {latestAttempt ? (
                          <button
                            type="button"
                            onClick={() => onReviewAttempt(latestAttempt)}
                            className="px-2.5 py-1 rounded-md bg-emerald-50 border border-emerald-200 text-emerald-700 text-xs font-bold tabular-nums cursor-pointer"
                          >
                            {latestAttempt.scoreTen.toFixed(1)} đ ({latestAttempt.scorePercent}%)
                          </button>
                        ) : isManuallyDone ? (
                          <span className="px-2.5 py-1 rounded-md bg-emerald-50 text-emerald-700 text-xs font-semibold">
                            Đã làm
                          </span>
                        ) : (
                          <span className="px-2.5 py-1 rounded-md bg-slate-100 text-slate-600 text-xs font-semibold">
                            Chưa làm
                          </span>
                        )}
                      </div>
                    </div>

                    <div>
                      <button
                        type="button"
                        onClick={() => onStartExam(exam.id, false)}
                        className="text-left text-sm font-extrabold text-slate-900 hover:text-[#2563eb] leading-snug cursor-pointer"
                      >
                        {exam.title}
                      </button>
                      <div className="mt-1 flex items-center gap-2 text-[11px] text-slate-400 tabular-nums">
                        <span>{exam.questions.length} câu</span>
                        <span>·</span>
                        <span>{exam.durationMinutes} phút</span>
                        <span>·</span>
                        <span>
                          {exam.uploadTime || '11:30'} {exam.createdAt}
                        </span>
                      </div>
                    </div>

                    <div className="pt-1 flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => onStartExam(exam.id, false)}
                        className="flex-1 min-h-[42px] py-2.5 px-4 rounded-xl bg-[#2563eb] hover:bg-blue-700 active:scale-[0.99] text-white text-xs font-bold uppercase tracking-wide transition-all cursor-pointer"
                      >
                        LÀM BÀI
                      </button>

                      <button
                        type="button"
                        onClick={() => toggleManualDone(exam.id)}
                        aria-label={`Đánh dấu hoàn thành ${exam.title}`}
                        className={`w-10 h-10 rounded-xl flex items-center justify-center transition-colors cursor-pointer shrink-0 ${
                          isCompleted
                            ? 'bg-emerald-500 text-white'
                            : 'bg-emerald-100/80 text-emerald-600'
                        }`}
                      >
                        <Check className="w-4 h-4 stroke-[2.5]" />
                      </button>

                      {isAdmin && (
                        <>
                          <button
                            type="button"
                            onClick={() => handleCopyExamLink(exam.id)}
                            aria-label={`Copy link đề ${exam.title}`}
                            className="w-10 h-10 rounded-xl border border-slate-200 bg-white text-slate-600 flex items-center justify-center cursor-pointer shrink-0"
                          >
                            {copiedExamId === exam.id ? (
                              <Check className="w-4 h-4 text-emerald-600" />
                            ) : (
                              <Link2 className="w-4 h-4" />
                            )}
                          </button>
                          <button
                            type="button"
                            onClick={() => onEditExam(exam)}
                            aria-label={`Chỉnh sửa ${exam.title}`}
                            className="w-10 h-10 rounded-xl border border-slate-200 bg-white text-slate-700 flex items-center justify-center cursor-pointer shrink-0"
                          >
                            <SquarePen className="w-4 h-4" />
                          </button>
                          <button
                            type="button"
                            onClick={() => setExamPendingDelete(exam)}
                            aria-label={`Xoá ${exam.title}`}
                            className="w-10 h-10 rounded-xl border border-slate-200 bg-white text-slate-400 hover:text-rose-600 flex items-center justify-center cursor-pointer shrink-0"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </>
                      )}
                    </div>
                  </div>
                );
              })
            )}
          </div>

          {/* DESKTOP EXAM TABLE (md+) */}
          <div className="hidden md:block bg-white rounded-xl border border-slate-200/90 shadow-2xs overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="bg-[#f1f5f9] border-b border-slate-200 text-xs font-bold text-slate-600 select-none">
                    <th
                      onClick={() => handleSortClick('id')}
                      className="py-3.5 px-5 w-24 cursor-pointer hover:text-slate-900"
                    >
                      ID {sortField === 'id' && (sortOrder === 'asc' ? '▲' : '▼')}
                    </th>
                    <th
                      onClick={() => handleSortClick('category')}
                      className="py-3.5 px-4 w-36 cursor-pointer hover:text-slate-900"
                    >
                      Môn {sortField === 'category' && (sortOrder === 'asc' ? '▲' : '▼')}
                    </th>
                    <th
                      onClick={() => handleSortClick('title')}
                      className="py-3.5 px-4 cursor-pointer hover:text-slate-900"
                    >
                      Tên Đề Thi {sortField === 'title' && (sortOrder === 'asc' ? '▲' : '▼')}
                    </th>
                    <th
                      onClick={() => handleSortClick('date')}
                      className="py-3.5 px-4 w-36 text-center cursor-pointer hover:text-slate-900 whitespace-nowrap"
                    >
                      Ngày Upload {sortField === 'date' ? (sortOrder === 'asc' ? '▲' : '▼') : '▼'}
                    </th>
                    <th className="py-3.5 px-4 w-32 text-center whitespace-nowrap">
                      Kết Quả
                    </th>
                    <th className="py-3.5 px-5 w-44 text-center whitespace-nowrap">
                      Thao tác
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 text-sm">
                  {filteredExams.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="py-12 px-6 text-center text-sm text-slate-500">
                        <div className="space-y-3">
                          <p>
                            {exams.length === 0
                              ? isLoadingExams
                                ? 'Đang tải danh sách đề thi từ Cloud...'
                                : 'Chưa có đề thi nào trong thư viện.'
                              : 'Không tìm thấy đề thi nào phù hợp với bộ lọc hiện tại.'}
                          </p>
                          {cloudLoadError && exams.length === 0 && (
                            <p className="text-xs text-rose-500 font-medium">
                              Chi tiết: {cloudLoadError}
                            </p>
                          )}
                          {exams.length === 0 && (
                            <div className="pt-1 flex flex-wrap items-center justify-center gap-2.5">
                              {onReloadFromCloud && (
                                <button
                                  type="button"
                                  disabled={isLoadingExams}
                                  onClick={() => {
                                    void onReloadFromCloud();
                                  }}
                                  className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-[#2563eb] hover:bg-blue-700 disabled:opacity-60 text-white text-xs font-bold transition-colors cursor-pointer"
                                >
                                  <RefreshCw
                                    className={`w-3.5 h-3.5 ${
                                      isLoadingExams ? 'animate-spin' : ''
                                    }`}
                                  />
                                  <span>
                                    {isLoadingExams
                                      ? 'Đang tải từ Cloud...'
                                      : 'Tải lại danh sách đề từ Cloud'}
                                  </span>
                                </button>
                              )}
                              {isAdmin && (
                                <button
                                  type="button"
                                  onClick={onCreateNewExam}
                                  className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl border border-slate-200 bg-slate-100 hover:bg-slate-200 text-slate-800 text-xs font-bold transition-colors cursor-pointer"
                                >
                                  <Plus className="w-4 h-4" />
                                  <span>Tạo đề thi đầu tiên</span>
                                </button>
                              )}
                            </div>
                          )}
                        </div>
                      </td>
                    </tr>
                  ) : (
                    filteredExams.map((exam) => {
                      let hash = 0;
                      for (let i = 0; i < exam.id.length; i++) {
                        hash = (hash * 31 + exam.id.charCodeAt(i)) >>> 0;
                      }
                      const displayCode =
                        exam.examCode || String(10000 + (hash % 90000));
                      const subj = normalizeSubjectCategory(exam.category);
                      const latestAttempt = latestAttemptByExamId[exam.id];
                      const isManuallyDone = Boolean(manualDoneMap[exam.id]);
                      const isCompleted = Boolean(latestAttempt) || isManuallyDone;
                      const isUnsynced =
                        unsyncedSet.has(exam.id) || unsyncedSet.has(sanitizeDocId(exam.id));
                      const isRecentlyActive = Boolean(
                        lastActiveExamId &&
                          (exam.id === lastActiveExamId ||
                            sanitizeDocId(exam.id) === sanitizeDocId(lastActiveExamId))
                      );

                      return (
                        <tr
                          key={exam.id}
                          data-exam-id={exam.id}
                          className={`hover:bg-slate-50/80 transition-colors ${
                            isRecentlyActive
                              ? 'bg-blue-50/60 ring-1 ring-inset ring-[#2563eb]/50'
                              : ''
                          }`}
                        >
                          {/* ID */}
                          <td className="py-3.5 px-5 text-xs font-semibold text-slate-500 tabular-nums">
                            {displayCode}
                          </td>

                          {/* Môn */}
                          <td className="py-3.5 px-4">
                            <span className="inline-block px-3 py-1 rounded-md bg-[#f1f5f9] border border-slate-200/70 text-slate-700 text-xs font-bold whitespace-nowrap">
                              {subj}
                            </span>
                          </td>

                          {/* Tên Đề Thi */}
                          <td className="py-3.5 px-4">
                            <div className="flex flex-wrap items-center gap-2">
                              <button
                                type="button"
                                onClick={() => onStartExam(exam.id, false)}
                                className="text-left font-bold text-slate-800 hover:text-[#2563eb] transition-colors cursor-pointer"
                              >
                                {exam.title}
                              </button>
                              {isUnsynced && (
                                <span className="inline-flex items-center px-2 py-0.5 rounded-md bg-amber-50 border border-amber-200 text-amber-800 text-[11px] font-bold">
                                  Chưa đồng bộ
                                </span>
                              )}
                              {isUnsynced && isAdmin && onRetrySyncExam && (
                                <button
                                  type="button"
                                  disabled={retryingExamId === exam.id}
                                  onClick={async () => {
                                    setRetryingExamId(exam.id);
                                    try {
                                      await onRetrySyncExam(exam);
                                    } finally {
                                      setRetryingExamId(null);
                                    }
                                  }}
                                  className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-amber-600 hover:bg-amber-700 disabled:opacity-50 text-white text-[11px] font-bold cursor-pointer"
                                >
                                  <RefreshCw
                                    className={`w-3 h-3 ${
                                      retryingExamId === exam.id ? 'animate-spin' : ''
                                    }`}
                                  />
                                  <span>
                                    {retryingExamId === exam.id ? 'Đang gửi...' : 'Đồng bộ lại'}
                                  </span>
                                </button>
                              )}
                            </div>
                          </td>

                          {/* Ngày Upload */}
                          <td className="py-3.5 px-4 text-center whitespace-nowrap">
                            <div className="text-xs font-semibold text-slate-600 tabular-nums">
                              {exam.uploadTime || '11:30'}
                            </div>
                            <div className="text-[11px] italic text-slate-400 tabular-nums">
                              {exam.createdAt}
                            </div>
                          </td>

                          {/* Kết Quả */}
                          <td className="py-3.5 px-4 text-center whitespace-nowrap">
                            {latestAttempt ? (
                              <button
                                type="button"
                                onClick={() => onReviewAttempt(latestAttempt)}
                                title="Nhấn để xem lại chi tiết bài làm"
                                className="inline-block px-2.5 py-1 rounded-md bg-emerald-50 border border-emerald-200 text-emerald-700 text-xs font-bold hover:bg-emerald-100 transition-colors cursor-pointer tabular-nums"
                              >
                                {latestAttempt.scoreTen.toFixed(1)} đ ({latestAttempt.scorePercent}%)
                              </button>
                            ) : isManuallyDone ? (
                              <span className="inline-block px-2.5 py-1 rounded-md bg-emerald-50 text-emerald-700 text-xs font-semibold">
                                Đã làm
                              </span>
                            ) : (
                              <span className="inline-block px-2.5 py-1 rounded-md bg-slate-100 text-slate-600 text-xs font-semibold">
                                Chưa làm
                              </span>
                            )}
                          </td>

                          {/* Thao tác */}
                          <td className="py-3.5 px-5 text-center whitespace-nowrap">
                            <div className="inline-flex items-center justify-center gap-1.5">
                              <button
                                type="button"
                                onClick={() => onStartExam(exam.id, false)}
                                className="px-3.5 py-1.5 rounded-lg bg-[#2563eb] hover:bg-blue-700 text-white text-xs font-bold uppercase tracking-wide transition-colors cursor-pointer"
                              >
                                LÀM BÀI
                              </button>

                              <button
                                type="button"
                                onClick={() => toggleManualDone(exam.id)}
                                aria-label={`Đánh dấu hoàn thành ${exam.title}`}
                                title={
                                  isCompleted
                                    ? 'Đã hoàn thành (nhấn để đổi trạng thái)'
                                    : 'Đánh dấu đã làm'
                                }
                                className={`w-8 h-8 rounded-lg flex items-center justify-center transition-colors cursor-pointer ${
                                  isCompleted
                                    ? 'bg-emerald-500 text-white'
                                    : 'bg-emerald-100/80 hover:bg-emerald-200/80 text-emerald-600'
                                }`}
                              >
                                <Check className="w-4 h-4 stroke-[2.5]" />
                              </button>

                              {isAdmin && (
                                <>
                                  <button
                                    type="button"
                                    onClick={() => handleCopyExamLink(exam.id)}
                                    aria-label={`Copy link đề ${exam.title}`}
                                    title="Copy link trực tiếp của đề"
                                    className="w-8 h-8 rounded-lg border border-slate-200 bg-white hover:bg-slate-100 text-slate-600 flex items-center justify-center transition-colors cursor-pointer"
                                  >
                                    {copiedExamId === exam.id ? (
                                      <Check className="w-3.5 h-3.5 text-emerald-600" />
                                    ) : (
                                      <Link2 className="w-3.5 h-3.5" />
                                    )}
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => onEditExam(exam)}
                                    aria-label={`Chỉnh sửa ${exam.title}`}
                                    title="Chỉnh sửa đề thi (Admin)"
                                    className="w-8 h-8 rounded-lg border border-slate-200 bg-white hover:bg-slate-100 text-slate-700 flex items-center justify-center transition-colors cursor-pointer"
                                  >
                                    <SquarePen className="w-3.5 h-3.5" />
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => setExamPendingDelete(exam)}
                                    aria-label={`Xoá ${exam.title}`}
                                    title="Xoá đề thi (Admin)"
                                    className="w-8 h-8 rounded-lg border border-slate-200 bg-white hover:bg-rose-50 text-slate-400 hover:text-rose-600 flex items-center justify-center transition-colors cursor-pointer"
                                  >
                                    <Trash2 className="w-3.5 h-3.5" />
                                  </button>
                                </>
                              )}
                            </div>
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </main>
      </div>
      {/* Modal chỉnh sửa thông tin trang dành cho Admin */}
      {isEditingBranding && isAdmin && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="branding-modal-title"
          onClick={() => setIsEditingBranding(false)}
          className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4 overflow-y-auto"
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-lg bg-white rounded-3xl border border-slate-200 shadow-2xl p-6 sm:p-7 space-y-5"
          >
            <div className="flex items-center justify-between pb-3 border-b border-slate-100">
              <div className="flex items-center gap-2.5">
                <div className="w-9 h-9 rounded-xl bg-blue-50 border border-blue-200 text-[#2563eb] flex items-center justify-center shrink-0">
                  <Edit3 className="w-5 h-5" />
                </div>
                <div>
                  <h3 id="branding-modal-title" className="text-base font-extrabold text-slate-900">
                    Chỉnh sửa thông tin trang
                  </h3>
                  <p className="text-xs text-slate-500">
                    Dành cho Admin · Thay đổi tên trang, người tạo, phiên bản và logo
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setIsEditingBranding(false)}
                aria-label="Đóng cửa sổ"
                className="w-8 h-8 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-600 flex items-center justify-center cursor-pointer transition-colors"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleSaveBranding} className="space-y-4">
              {/* Logo / Biểu tượng */}
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1.5">
                  Logo / Biểu tượng trang
                </label>
                <div className="flex items-center gap-4 p-3 bg-slate-50 border border-slate-200 rounded-2xl">
                  <div className="w-16 h-16 rounded-xl bg-white border border-slate-200 flex items-center justify-center p-1 overflow-hidden shrink-0">
                    {editLogoUrl ? (
                      <img
                        src={editLogoUrl}
                        alt="Logo xem trước"
                        loading="lazy"
                        decoding="async"
                        className="w-full h-full object-contain rounded-lg"
                      />
                    ) : (
                      <svg viewBox="0 0 64 64" className="w-full h-full" aria-hidden="true">
                        <circle cx="32" cy="32" r="29" fill="#fff" stroke="#dc2626" strokeWidth="3.5" />
                        <circle cx="32" cy="32" r="23" fill="#eff6ff" stroke="#0284c7" strokeWidth="1.5" strokeDasharray="3 2" />
                        <path d="M16 40 C22 37, 28 38, 32 41 C36 38, 42 37, 48 40 L48 45 C42 42, 36 43, 32 46 C28 43, 22 42, 16 45 Z" fill="#0284c7" />
                        <path d="M32 16 C35 21, 37 24, 34 29 C36 27, 37 30, 32 34 C27 30, 28 27, 30 29 C27 24, 29 21, 32 16 Z" fill="#ef4444" />
                        <rect x="30.5" y="33" width="3" height="7" rx="1" fill="#dc2626" />
                      </svg>
                    )}
                  </div>

                  <div className="flex-1 space-y-1.5">
                    <input
                      ref={brandingLogoInputRef}
                      type="file"
                      accept="image/*"
                      aria-label="Tải ảnh logo từ máy"
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        if (file) handleLogoUpload(file);
                      }}
                      className="sr-only"
                    />
                    <div className="flex flex-wrap items-center gap-2">
                      <button
                        type="button"
                        onClick={() => brandingLogoInputRef.current?.click()}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-white hover:bg-slate-100 border border-slate-300 text-xs font-semibold text-slate-700 cursor-pointer transition-colors"
                      >
                        <Image className="w-3.5 h-3.5 text-blue-600" />
                        <span>Tải ảnh mới</span>
                      </button>
                      {editLogoUrl && (
                        <button
                          type="button"
                          onClick={() => {
                            setEditLogoUrl('');
                            setBrandingLogoError('');
                          }}
                          className="px-2.5 py-1.5 rounded-xl border border-rose-200 text-rose-600 hover:bg-rose-50 text-xs font-semibold cursor-pointer transition-colors"
                        >
                          Dùng logo mặc định
                        </button>
                      )}
                    </div>
                    <p className="text-[11px] text-slate-400">
                      Hỗ trợ PNG, JPG, SVG hoặc WebP vuông tỉ lệ 1:1
                    </p>
                    {brandingLogoError && (
                      <p className="text-xs font-semibold text-rose-600">
                        {brandingLogoError}
                      </p>
                    )}
                  </div>
                </div>
              </div>

              {/* Tên trang web */}
              <div>
                <label htmlFor="edit-site-title" className="block text-xs font-bold text-slate-700 mb-1">
                  Tiêu đề chính trang web
                </label>
                <input
                  id="edit-site-title"
                  type="text"
                  value={editTitle}
                  onChange={(e) => setEditTitle(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') e.preventDefault();
                  }}
                  placeholder="Ví dụ: Luyện đề Online"
                  className="w-full rounded-xl border border-slate-300 bg-white px-3.5 py-2.5 text-sm font-semibold text-slate-900 focus:outline-none focus:ring-2 focus:ring-[#2563eb]"
                  required
                />
              </div>

              {/* Dòng chữ phụ / Người tạo / Ghi công đóng góp */}
              <div>
                <div className="flex items-center justify-between mb-1">
                  <label htmlFor="edit-site-subtitle" className="block text-xs font-bold text-slate-700">
                    Mục giới thiệu / Người tạo / Ghi công đóng góp
                  </label>
                  <span className="text-[11px] font-medium text-slate-400">
                    Nhấn Enter để xuống dòng
                  </span>
                </div>
                <textarea
                  id="edit-site-subtitle"
                  rows={4}
                  value={editSubtitle}
                  onChange={(e) => setEditSubtitle(e.target.value)}
                  placeholder={'Ví dụ:\nFrom : NguyenCongQuang\nMục tri ân người đóng góp sửa chữa đáp án :\n- Bạn A\n- Bạn B'}
                  className="w-full rounded-xl border border-slate-300 bg-white px-3.5 py-2.5 text-sm font-medium text-slate-800 leading-relaxed focus:outline-none focus:ring-2 focus:ring-[#2563eb] resize-y"
                  required
                />
              </div>

              {/* Phiên bản (Version) */}
              <div>
                <label htmlFor="edit-site-version" className="block text-xs font-bold text-slate-700 mb-1">
                  Nhãn phiên bản (Badge)
                </label>
                <input
                  id="edit-site-version"
                  type="text"
                  value={editVersion}
                  onChange={(e) => setEditVersion(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') e.preventDefault();
                  }}
                  placeholder="Ví dụ: VERSION 4.16"
                  className="w-full rounded-xl border border-slate-300 bg-white px-3.5 py-2.5 text-sm font-medium text-slate-800 focus:outline-none focus:ring-2 focus:ring-[#2563eb]"
                />
              </div>

              {/* Nút thao tác */}
              <div className="pt-3 border-t border-slate-100 flex items-center justify-between gap-3">
                <button
                  type="button"
                  onClick={handleResetBranding}
                  className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-semibold text-slate-500 hover:text-rose-600 hover:bg-rose-50 transition-colors cursor-pointer"
                >
                  <RefreshCw className="w-3.5 h-3.5" />
                  <span>Khôi phục mặc định</span>
                </button>

                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setIsEditingBranding(false)}
                    className="px-4 py-2 rounded-xl border border-slate-200 text-slate-600 hover:bg-slate-100 text-xs font-semibold transition-colors cursor-pointer"
                  >
                    Hủy
                  </button>
                  <button
                    type="submit"
                    className="inline-flex items-center gap-1.5 px-5 py-2 rounded-xl bg-[#2563eb] hover:bg-blue-700 text-white text-xs font-bold shadow-xs transition-colors cursor-pointer"
                  >
                    <Save className="w-3.5 h-3.5" />
                    <span>Lưu thay đổi</span>
                  </button>
                </div>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal xác nhận xoá đề thi tránh bấm nhầm */}
      {examPendingDelete && isAdmin && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="delete-exam-modal-title"
          onClick={() => setExamPendingDelete(null)}
          className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4"
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-md bg-white rounded-3xl border border-slate-200 shadow-2xl p-6 space-y-4"
          >
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-center gap-3">
                <div className="w-11 h-11 rounded-2xl bg-rose-50 border border-rose-200 text-rose-600 flex items-center justify-center shrink-0">
                  <Trash2 className="w-5 h-5" />
                </div>
                <div>
                  <h3
                    id="delete-exam-modal-title"
                    className="text-base font-extrabold text-slate-900"
                  >
                    Xác nhận xoá đề thi?
                  </h3>
                  <p className="text-xs text-slate-500 mt-0.5">
                    Thao tác này sẽ xoá vĩnh viễn đề thi khỏi hệ thống
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setExamPendingDelete(null)}
                aria-label="Đóng thông báo xoá đề"
                className="w-8 h-8 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-600 flex items-center justify-center cursor-pointer transition-colors shrink-0"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="rounded-2xl border border-rose-200/80 bg-rose-50/50 p-3.5 space-y-1">
              <div className="text-sm font-bold text-slate-900 leading-snug">
                {examPendingDelete.title}
              </div>
              <div className="text-xs font-medium text-slate-600">
                Môn: <strong>{normalizeSubjectCategory(examPendingDelete.category)}</strong> ·{' '}
                {examPendingDelete.questions.length} câu hỏi
              </div>
            </div>

            <p className="text-xs text-slate-600 leading-relaxed">
              Bạn có chắc chắn muốn xoá đề thi này không? Đề thi sẽ bị xoá trên cả máy này và đồng bộ Cloud, <strong>không thể khôi phục lại</strong> sau khi xoá.
            </p>

            <div className="pt-2 border-t border-slate-100 flex items-center justify-end gap-2.5">
              <button
                type="button"
                onClick={() => setExamPendingDelete(null)}
                className="px-4 py-2.5 rounded-xl border border-slate-200 bg-white hover:bg-slate-100 text-slate-700 text-xs font-bold transition-colors cursor-pointer"
              >
                Huỷ bỏ
              </button>
              <button
                type="button"
                onClick={() => {
                  const targetId = examPendingDelete.id;
                  setExamPendingDelete(null);
                  onDeleteExam(targetId);
                }}
                className="inline-flex items-center gap-1.5 px-4 py-2.5 rounded-xl bg-rose-600 hover:bg-rose-700 text-white text-xs font-bold shadow-xs transition-colors cursor-pointer"
              >
                <Trash2 className="w-3.5 h-3.5" />
                <span>Xác nhận xoá</span>
              </button>
            </div>
          </div>
        </div>
      )}
      {renderGitHubConfigModal()}
    </div>
  );
};

