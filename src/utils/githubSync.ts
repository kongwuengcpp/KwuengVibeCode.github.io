import type { Exam, SiteBranding } from '../types/exam';

export const GITHUB_CONFIG_STORAGE_KEY = 'luyende_github_sync_config_v1';

export interface GitHubSyncConfig {
  token: string;
  owner: string;
  repo: string;
  branch: string;
  filePath: string;
  autoSync: boolean;
}

export interface GitHubSyncResult {
  ok: boolean;
  count?: number;
  commitUrl?: string;
  error?: string;
}

export function detectDefaultGitHubRepo(): { owner: string; repo: string } {
  if (typeof window !== 'undefined' && window.location) {
    const host = window.location.hostname.toLowerCase();
    if (host.endsWith('.github.io')) {
      const owner = host.replace(/\.github\.io$/, '');
      const segments = window.location.pathname.split('/').filter(Boolean);
      const firstSeg = segments[0];
      if (
        firstSeg &&
        !['index.html', 'thu-vien', 'tao-de', 'nguoi-dung', 'lam-bai', 'de'].includes(
          firstSeg.toLowerCase()
        )
      ) {
        return { owner, repo: firstSeg };
      }
      if (owner) {
        return { owner, repo: `${owner}.github.io` };
      }
    }
  }
  return {
    owner: 'kongwuengcpp',
    repo: 'KwuengVibeCode.github.io',
  };
}

export function loadGitHubSyncConfig(): GitHubSyncConfig {
  const detected = detectDefaultGitHubRepo();
  const defaults: GitHubSyncConfig = {
    token: '',
    owner: detected.owner,
    repo: detected.repo,
    branch: 'main',
    filePath: 'public/exams.json',
    autoSync: true,
  };

  if (typeof window === 'undefined' || typeof localStorage === 'undefined') {
    return defaults;
  }

  try {
    const raw = localStorage.getItem(GITHUB_CONFIG_STORAGE_KEY);
    if (!raw) return defaults;
    const parsed = JSON.parse(raw) as Partial<GitHubSyncConfig>;
    return {
      token: typeof parsed.token === 'string' ? parsed.token.trim() : defaults.token,
      owner: typeof parsed.owner === 'string' && parsed.owner.trim() ? parsed.owner.trim() : defaults.owner,
      repo: typeof parsed.repo === 'string' && parsed.repo.trim() ? parsed.repo.trim() : defaults.repo,
      branch: typeof parsed.branch === 'string' && parsed.branch.trim() ? parsed.branch.trim() : defaults.branch,
      filePath:
        typeof parsed.filePath === 'string' && parsed.filePath.trim()
          ? parsed.filePath.trim().replace(/^\/+/, '')
          : defaults.filePath,
      autoSync: typeof parsed.autoSync === 'boolean' ? parsed.autoSync : defaults.autoSync,
    };
  } catch {
    return defaults;
  }
}

export function saveGitHubSyncConfig(partial: Partial<GitHubSyncConfig>): GitHubSyncConfig {
  const current = loadGitHubSyncConfig();
  const updated: GitHubSyncConfig = {
    ...current,
    ...partial,
    token: (partial.token !== undefined ? partial.token : current.token).trim(),
    owner: (partial.owner !== undefined ? partial.owner : current.owner).trim() || current.owner,
    repo: (partial.repo !== undefined ? partial.repo : current.repo).trim() || current.repo,
    branch: (partial.branch !== undefined ? partial.branch : current.branch).trim() || 'main',
    filePath:
      (partial.filePath !== undefined ? partial.filePath : current.filePath)
        .trim()
        .replace(/^\/+/, '') || 'public/exams.json',
  };

  if (typeof window !== 'undefined' && typeof localStorage !== 'undefined') {
    try {
      localStorage.setItem(GITHUB_CONFIG_STORAGE_KEY, JSON.stringify(updated));
    } catch {
      // ignore storage errors
    }
  }
  return updated;
}

export function utf8ToBase64(str: string): string {
  const bytes = new TextEncoder().encode(str);
  const chunkSize = 0x8000;
  let binary = '';
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.subarray(i, i + chunkSize);
    binary += String.fromCharCode(...chunk);
  }
  return btoa(binary);
}

export function describeGitHubError(status: number, rawMessage: string): string {
  const msg = String(rawMessage || '').toLowerCase();
  if (status === 401 || msg.includes('bad credentials')) {
    return 'GitHub Token không hợp lệ hoặc đã hết hạn. Hãy kiểm tra lại Personal Access Token.';
  }
  if (status === 403 || msg.includes('resource not accessible')) {
    return 'Token chưa được cấp quyền ghi vào repo. Hãy bật quyền "repo" (Classic Token) hoặc "Contents: Read and write" (Fine-grained Token).';
  }
  if (status === 404) {
    return 'Không tìm thấy kho chứa (owner/repo) hoặc nhánh (branch) trên GitHub, hoặc Token không có quyền truy cập kho này.';
  }
  if (status === 409) {
    return 'Xung đột phiên bản file trên GitHub (409). Vui lòng bấm đồng bộ lại.';
  }
  if (status === 422) {
    return `Dữ liệu gửi lên GitHub không hợp lệ (422): ${rawMessage}`;
  }
  return rawMessage || `Lỗi GitHub API (HTTP ${status})`;
}

async function getExistingFileSha(
  owner: string,
  repo: string,
  branch: string,
  filePath: string,
  headers: Record<string, string>,
  fetchFn: typeof fetch
): Promise<{ sha?: string; notFoundBranch?: boolean; error?: string }> {
  const cleanPath = filePath.replace(/^\/+/, '');
  const parts = cleanPath.split('/');
  const fileName = parts[parts.length - 1];
  const parentDir = parts.slice(0, -1).join('/');

  // Query parent directory listing first so it works even when exams.json > 1 MB
  const dirUrl = `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(
    repo
  )}/contents/${parentDir}?ref=${encodeURIComponent(branch)}`;

  const res = await fetchFn(dirUrl, {
    method: 'GET',
    headers,
    cache: 'no-store',
  });

  if (res.status === 200) {
    const data = (await res.json()) as unknown;
    if (Array.isArray(data)) {
      const found = data.find(
        (item) =>
          item &&
          typeof item === 'object' &&
          ((item as { path?: string }).path === cleanPath ||
            (item as { name?: string }).name === fileName)
      ) as { sha?: string } | undefined;
      return { sha: found?.sha };
    }
    if (data && typeof data === 'object' && typeof (data as { sha?: string }).sha === 'string') {
      return { sha: (data as { sha: string }).sha };
    }
    return { sha: undefined };
  }

  if (res.status === 404) {
    let bodyMsg = '';
    try {
      const errJson = (await res.json()) as { message?: string };
      bodyMsg = String(errJson?.message || '');
    } catch {
      // ignore
    }
    if (bodyMsg.toLowerCase().includes('no commit found for the ref')) {
      return { notFoundBranch: true };
    }
    // Directory or file doesn't exist yet -> new file creation
    return { sha: undefined };
  }

  let errMsg = '';
  try {
    const errJson = (await res.json()) as { message?: string };
    errMsg = String(errJson?.message || '');
  } catch {
    // ignore
  }
  return { error: describeGitHubError(res.status, errMsg) };
}

export async function pushExamsToGitHub(
  exams: Exam[],
  branding: SiteBranding,
  overrideConfig?: Partial<GitHubSyncConfig>,
  commitMessage?: string,
  fetchFn: typeof fetch = fetch
): Promise<GitHubSyncResult> {
  const cfg: GitHubSyncConfig = {
    ...loadGitHubSyncConfig(),
    ...overrideConfig,
  };

  if (!cfg.token || !cfg.token.trim()) {
    return {
      ok: false,
      error: 'Chưa cấu hình GitHub Token. Hãy mở "Cấu hình GitHub" để dán Personal Access Token.',
    };
  }
  if (!cfg.owner || !cfg.repo) {
    return {
      ok: false,
      error: 'Thiếu thông tin kho GitHub (owner/repo).',
    };
  }

  const headers: Record<string, string> = {
    Accept: 'application/vnd.github+json',
    Authorization: `Bearer ${cfg.token.trim()}`,
    'X-GitHub-Api-Version': '2022-11-28',
  };

  let targetBranch = cfg.branch || 'main';
  let shaLookup = await getExistingFileSha(
    cfg.owner,
    cfg.repo,
    targetBranch,
    cfg.filePath,
    headers,
    fetchFn
  );

  // If branch wasn't found (e.g. repo uses master instead of main), detect default_branch
  if (shaLookup.notFoundBranch) {
    try {
      const repoRes = await fetchFn(
        `https://api.github.com/repos/${encodeURIComponent(cfg.owner)}/${encodeURIComponent(
          cfg.repo
        )}`,
        { method: 'GET', headers, cache: 'no-store' }
      );
      if (repoRes.ok) {
        const repoData = (await repoRes.json()) as { default_branch?: string };
        if (repoData.default_branch && repoData.default_branch !== targetBranch) {
          targetBranch = repoData.default_branch;
          saveGitHubSyncConfig({ branch: targetBranch });
          shaLookup = await getExistingFileSha(
            cfg.owner,
            cfg.repo,
            targetBranch,
            cfg.filePath,
            headers,
            fetchFn
          );
        }
      }
    } catch {
      // fall through
    }
  }

  if (shaLookup.error) {
    return { ok: false, error: shaLookup.error };
  }

  const exportPayload = {
    updatedAt: new Date().toISOString(),
    branding,
    exams,
  };
  const jsonString = JSON.stringify(exportPayload, null, 2);
  const contentBase64 = utf8ToBase64(jsonString);
  const cleanPath = cfg.filePath.replace(/^\/+/, '');
  const putUrl = `https://api.github.com/repos/${encodeURIComponent(cfg.owner)}/${encodeURIComponent(
    cfg.repo
  )}/contents/${cleanPath}`;

  const message =
    commitMessage ||
    `Cập nhật danh sách đề thi (${exams.length} đề) - ${new Date().toLocaleString('vi-VN')}`;

  const attemptPut = async (sha?: string) => {
    const body: Record<string, unknown> = {
      message,
      content: contentBase64,
      branch: targetBranch,
    };
    if (sha) {
      body.sha = sha;
    }
    return fetchFn(putUrl, {
      method: 'PUT',
      headers: {
        ...headers,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });
  };

  try {
    let putRes = await attemptPut(shaLookup.sha);

    // Retry once on 409 Conflict by re-fetching the latest file SHA
    if (putRes.status === 409) {
      const retrySha = await getExistingFileSha(
        cfg.owner,
        cfg.repo,
        targetBranch,
        cfg.filePath,
        headers,
        fetchFn
      );
      if (!retrySha.error) {
        putRes = await attemptPut(retrySha.sha);
      }
    }

    if (!putRes.ok) {
      let errMsg = '';
      try {
        const errJson = (await putRes.json()) as { message?: string };
        errMsg = String(errJson?.message || '');
      } catch {
        // ignore
      }
      return {
        ok: false,
        error: describeGitHubError(putRes.status, errMsg),
      };
    }

    let commitUrl: string | undefined;
    try {
      const resJson = (await putRes.json()) as { commit?: { html_url?: string } };
      commitUrl = resJson?.commit?.html_url;
    } catch {
      // ignore
    }

    return {
      ok: true,
      count: exams.length,
      commitUrl,
    };
  } catch (err) {
    return {
      ok: false,
      error: `Lỗi kết nối mạng tới GitHub: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}
