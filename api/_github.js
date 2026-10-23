import { createHash, timingSafeEqual } from 'node:crypto';
import { CONFIG } from '../assets/js/config.js';
import { titleToPath } from '../assets/js/store.js';

/**
 * 저장·삭제 API가 함께 쓰는 GitHub 연동과 검증. (_로 시작하는 파일은 Vercel이 엔드포인트로 만들지 않는다)
 *
 * 환경변수
 * - GITHUB_TOKEN  : 이 저장소 Contents 읽기/쓰기 권한이 있는 fine-grained 토큰
 * - WIKI_PASSWORD : 크루 공용 편집 비밀번호
 * - WIKI_ADMIN_PASSWORD : 관리자 비밀번호. 보호 문서 편집·삭제와 보호 설정에 필요 (일반 편집에도 쓸 수 있음)
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

/** 문서 보호 목록 파일 (저장소 루트, 사이트에서도 /protected.json으로 읽는다) */
export const PROTECTION_FILE = 'protected.json';

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
 * 요청 본문을 읽고 서버 설정·비밀번호·제목을 검증한다. admin은 관리자 비밀번호로 들어왔는지 여부.
 * @param {Request} request
 * @returns {Promise<{ error: Response } | { body: any, admin: boolean }>}
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
  const given = typeof body?.password === 'string' ? body.password : null;
  const adminPassword = process.env.WIKI_ADMIN_PASSWORD;
  // 두 비교를 모두 수행해 어느 쪽과 맞았는지 시간 차이로 드러나지 않게 한다
  const admin = given !== null && Boolean(adminPassword) && safeEqual(given, adminPassword ?? '');
  const member = given !== null && safeEqual(given, password);
  if (!admin && !member) return { error: reply(401, { error: '편집 비밀번호가 틀렸습니다.' }) };
  if (!validTitle(body.title)) return { error: reply(400, { error: '사용할 수 없는 문서 제목입니다.' }) };
  return { body, admin };
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

/**
 * @typedef {{ level: 'edit' | 'delete', reason: string, by: string, date: string }} Protection
 */

/**
 * 저장소의 현재 보호 목록. 배포본이 아니라 GitHub에서 바로 읽으므로 설정 즉시 적용된다.
 * @returns {Promise<{ error: Response } | { map: Record<string, Protection>, sha: string | null }>}
 */
export async function readProtection() {
  const res = await github(`/contents/${PROTECTION_FILE}?ref=${encodeURIComponent(branch)}`);
  if (res.status === 404) return { map: {}, sha: null };
  if (!res.ok) return { error: reply(502, { error: `보호 목록 조회 실패 (${res.status})` }) };
  const data = await res.json();
  try {
    return { map: JSON.parse(Buffer.from(data.content, 'base64').toString('utf8')), sha: data.sha };
  } catch {
    return { error: reply(500, { error: `${PROTECTION_FILE} 형식이 잘못되었습니다.` }) };
  }
}

/**
 * 관리자가 아니면 보호 수준에 따라 막는다.
 * @param {string} title @param {boolean} admin @param {'edit' | 'delete'} action
 * @returns {Promise<Response | null>} 막을 때 응답, 통과하면 null
 */
export async function guardProtection(title, admin, action) {
  if (admin) return null;
  const protection = await readProtection();
  if ('error' in protection) return protection.error;
  const p = protection.map[title];
  if (!p || (action === 'edit' && p.level !== 'edit')) return null;
  const what = p.level === 'edit' ? '편집 보호' : '삭제 보호';
  return reply(403, { error: `${what} 중인 문서입니다${p.reason ? ` (사유: ${p.reason})` : ''}. 관리자 비밀번호가 필요합니다.` });
}
