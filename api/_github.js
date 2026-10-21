import { createHash, timingSafeEqual } from 'node:crypto';
import { CONFIG } from '../assets/js/config.js';
import { titleToPath } from '../assets/js/store.js';

/**
 * 저장·삭제 API가 함께 쓰는 GitHub 연동과 검증. (_로 시작하는 파일은 Vercel이 엔드포인트로 만들지 않는다)
 *
 * 환경변수
 * - GITHUB_TOKEN  : 이 저장소 Contents 읽기/쓰기 권한이 있는 fine-grained 토큰
 * - WIKI_PASSWORD : 크루 공용 편집 비밀번호
 */

const MAX_TITLE = 100;

const owner = process.env.GITHUB_OWNER || CONFIG.github.owner;
const repo = process.env.GITHUB_REPO || CONFIG.github.repo;
export const branch = process.env.GITHUB_BRANCH || CONFIG.github.branch;

/** @param {number} status @param {Record<string, unknown>} body */
export const reply = (status, body) => Response.json(body, { status });

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

/** @param {string} title */
export const contentsPath = (title) =>
  `${CONFIG.wikiDir}/${titleToPath(title)}`.split('/').map(encodeURIComponent).join('/');

/** @param {unknown} author */
export const authorName = (author) =>
  typeof author === 'string' && author.trim() ? author.trim().slice(0, 40) : '익명';

/**
 * 요청 본문을 읽고 서버 설정·비밀번호·제목을 검증한다.
 * @param {Request} request
 * @returns {Promise<{ error: Response } | { body: any }>}
 */
export async function readAuthorized(request) {
  const password = process.env.WIKI_PASSWORD;
  if (!process.env.GITHUB_TOKEN || !password) {
    return { error: reply(500, { error: '서버에 GITHUB_TOKEN 또는 WIKI_PASSWORD가 설정되지 않았습니다.' }) };
  }
  /** @type {any} */
  let body;
  try {
    body = await request.json();
  } catch {
    return { error: reply(400, { error: '잘못된 요청입니다.' }) };
  }
  if (typeof body?.password !== 'string' || !safeEqual(body.password, password)) {
    return { error: reply(401, { error: '편집 비밀번호가 틀렸습니다.' }) };
  }
  if (!validTitle(body.title)) return { error: reply(400, { error: '사용할 수 없는 문서 제목입니다.' }) };
  return { body };
}

/** @param {string} path @param {RequestInit} [init] */
export function github(path, init = {}) {
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

/**
 * 현재 파일의 blob sha (없으면 null). 편집을 시작한 판(baseSha)과 다르면 그 사이 누가 바꾼 것.
 * @param {string} path
 * @returns {Promise<{ error: Response } | { sha: string | null }>}
 */
export async function currentSha(path) {
  const res = await github(`/contents/${path}?ref=${encodeURIComponent(branch)}`);
  if (res.status === 404) return { sha: null };
  if (!res.ok) return { error: reply(502, { error: `GitHub 조회 실패 (${res.status})` }) };
  return { sha: (await res.json()).sha };
}
