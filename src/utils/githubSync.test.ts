import test from 'node:test';
import assert from 'node:assert/strict';
import {
  utf8ToBase64,
  pushExamsToGitHub,
  describeGitHubError,
} from './githubSync';
import { DEFAULT_SITE_BRANDING, Exam } from '../types/exam';

const sampleExam: Exam = {
  id: 'exam-ls-12',
  examCode: '10234',
  title: 'Ôn Tập Lịch Sử 12 Giữa Kì 1',
  category: 'Lịch sử',
  durationMinutes: 45,
  createdAt: '10/11/2026',
  questions: [
    {
      id: 'q-1',
      number: 1,
      type: 'single',
      text: 'Câu 1: Liên hợp quốc được thành lập năm nào?',
      options: { A: '1945', B: '1946', C: '1947', D: '1948' },
      correctAnswer: 'A',
    },
  ],
};

test('utf8ToBase64: encodes Vietnamese text accurately', () => {
  const original = 'Ôn Tập Lịch Sử 12 - Đúng/Sai & Trả lời ngắn';
  const encoded = utf8ToBase64(original);
  const decoded = Buffer.from(encoded, 'base64').toString('utf-8');
  assert.equal(decoded, original);
});

test('pushExamsToGitHub: fetches existing SHA from directory listing and sends PUT commit', async () => {
  const calls: Array<{ url: string; method: string; body?: Record<string, unknown> }> = [];

  const mockFetch: typeof fetch = async (input, init) => {
    const url = String(input);
    const method = init?.method || 'GET';
    const body = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : undefined;
    calls.push({ url, method, body });

    if (method === 'GET' && url.includes('/contents/public')) {
      return new Response(
        JSON.stringify([
          { name: 'exams.json', path: 'public/exams.json', sha: 'existing-sha-123' },
        ]),
        { status: 200 }
      );
    }

    if (method === 'PUT' && url.includes('/contents/public/exams.json')) {
      return new Response(
        JSON.stringify({
          commit: { html_url: 'https://github.com/kongwuengcpp/KwuengVibeCode.github.io/commit/abc' },
        }),
        { status: 200 }
      );
    }

    return new Response(JSON.stringify({ message: 'Not Found' }), { status: 404 });
  };

  const res = await pushExamsToGitHub(
    [sampleExam],
    DEFAULT_SITE_BRANDING,
    {
      token: 'ghp_test_token_123',
      owner: 'kongwuengcpp',
      repo: 'KwuengVibeCode.github.io',
      branch: 'main',
      filePath: 'public/exams.json',
      autoSync: true,
    },
    'Cập nhật đề Lịch sử',
    mockFetch
  );

  assert.equal(res.ok, true);
  assert.equal(res.count, 1);
  assert.equal(calls.length, 2);
  assert.equal(calls[1].method, 'PUT');
  assert.equal(calls[1].body?.sha, 'existing-sha-123');
  assert.equal(calls[1].body?.branch, 'main');

  const decodedPayload = JSON.parse(
    Buffer.from(String(calls[1].body?.content), 'base64').toString('utf-8')
  ) as { exams: Exam[]; branding: typeof DEFAULT_SITE_BRANDING };
  assert.equal(decodedPayload.exams.length, 1);
  assert.equal(decodedPayload.exams[0].title, 'Ôn Tập Lịch Sử 12 Giữa Kì 1');
});

test('describeGitHubError: returns clear Vietnamese message on 401 and 403', () => {
  assert.match(describeGitHubError(401, 'Bad credentials'), /Token không hợp lệ/);
  assert.match(describeGitHubError(403, 'Resource not accessible'), /quyền ghi/);
});
