import { createHash, timingSafeEqual } from 'node:crypto';
import { CONFIG } from '../assets/js/config.js';
import { titleToPath } from '../assets/js/store.js';

/**
 * 문서 저장 API (Vercel 서버 함수). 크루 공용 비밀번호를 확인한 뒤
 * 서버에 있는 GitHub 토큰으로 wiki/ 파일을 커밋한다. 커밋되면 Vercel이 자동 재배포한다.
 *
 * 환경변수
 * - GITHUB_TOKEN  : 이 저장소 Contents 읽기/쓰기 권한이 있는 fine-grained 토큰
 * - WIKI_PASSWORD : 크루 공용 편집 비밀번호
 */

const MAX_CONTENT = 500_000;
const MAX_TITLE = 100;

const owner = process.env.GITHUB_OWNER || CONFIG.github.owner;
const repo = process.env.GITHUB_REPO || CONFIG.github.repo;
const branch = process.env.GITHUB_BRANCH || CONFIG.github.branch;

/** @param {number} status @param {Record<string, unknown>} body */
const reply = (status, body) => Response.json(body, { status });

/** 길이가 달라도 시간 차이로 비밀번호가 새지 않도록 해시끼리 비교 */
/** @param {string} a @param {string} b */
const safeEqual = (a, b) =>
  timingSafeEqual(createHash('sha256').update(a).digest(), createHash('sha256').update(b).digest());

/** @param {unknown} title */
function validTitle(title) {
  if (typeof title !== 'string') return false;
  const t = title.trim();
  if (!t || t !== title || t.length > MAX_TITLE) return false;
  // 경로 탈출, 숨김 파일, 제어 문자 방지
  if (/[\\\u0000-\u001f]/.test(t)) return false;
  return t.split('/').every((seg) => seg && seg !== '.' && seg !== '..' && !seg.startsWith('.'));
}

/** @param {string} path @param {RequestInit} [init] */
function github(path, init = {}) {
  return fetch(`https://api.github.com/repos/${owner}/${repo}${path}`, {
    ...init,
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${process.env.GITHUB_TOKEN}`,
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'nolifecrew-wiki',
      ...init.headers,
    },
  });
}

/** @param {Request} request */
export async function POST(request) {
  const password = process.env.WIKI_PASSWORD;
  if (!process.env.GITHUB_TOKEN || !password) {
    return reply(500, { error: '서버에 GITHUB_TOKEN 또는 WIKI_PASSWORD가 설정되지 않았습니다.' });
  }

  /** @type {any} */
  let body;
  try {
    body = await request.json();
  } catch {
    return reply(400, { error: '잘못된 요청입니다.' });
  }
  const { title, content, summary, author, baseSha } = body ?? {};

  if (typeof body?.password !== 'string' || !safeEqual(body.password, password)) {
    return reply(401, { error: '편집 비밀번호가 틀렸습니다.' });
  }
  if (!validTitle(title)) return reply(400, { error: '사용할 수 없는 문서 제목입니다.' });
  if (typeof content !== 'string' || content.length > MAX_CONTENT) {
    return reply(400, { error: '문서 내용이 비었거나 너무 깁니다.' });
  }
  const name = typeof author === 'string' && author.trim() ? author.trim().slice(0, 40) : '익명';
  const note = typeof summary === 'string' ? summary.trim().slice(0, 200) : '';

  const path = `${CONFIG.wikiDir}/${titleToPath(title)}`.split('/').map(encodeURIComponent).join('/');

  // 현재 파일의 blob sha. 편집을 시작한 판(baseSha)과 다르면 그 사이 누가 저장한 것
  const current = await github(`/contents/${path}?ref=${encodeURIComponent(branch)}`);
  if (!current.ok && current.status !== 404) {
    return reply(502, { error: `GitHub 조회 실패 (${current.status})` });
  }
  const currentSha = current.ok ? (await current.json()).sha : null;
  if ((baseSha ?? null) !== currentSha) {
    return reply(409, {
      error: currentSha
        ? '편집하는 사이 다른 사람이 이 문서를 수정했습니다. 내용을 복사해 두고 새로고침한 뒤 다시 편집해 주세요.'
        : '그 사이 문서가 삭제되었거나 아직 반영되지 않았습니다.',
    });
  }

  const res = await github(`/contents/${path}`, {
    method: 'PUT',
    body: JSON.stringify({
      message: `${title}: ${note || (currentSha ? '편집' : '새 문서')}`,
      content: Buffer.from(content, 'utf8').toString('base64'),
      branch,
      ...(currentSha && { sha: currentSha }),
      author: { name, email: 'wiki@nolifecrew.org' },
    }),
  });
  if (res.status === 409 || res.status === 422) {
    return reply(409, { error: '다른 저장과 충돌했습니다. 잠시 후 다시 시도해 주세요.' });
  }
  if (!res.ok) return reply(502, { error: `GitHub 저장 실패 (${res.status})` });

  const data = await res.json();
  return reply(200, { sha: data.content.sha, commit: data.commit.sha });
}
