import { storage } from './utils.js';

/** 저장·삭제 폼에서 공통으로 쓰는 편집자 이름·비밀번호 (성공하면 기억해 둔다) */
const AUTHOR_KEY = 'editor:author';
const PASSWORD_KEY = 'editor:password';

export const savedCredentials = () => ({
  author: storage.get(AUTHOR_KEY) ?? '',
  password: storage.get(PASSWORD_KEY) ?? '',
});

/** @param {string} author @param {string} password */
export function rememberCredentials(author, password) {
  storage.set(AUTHOR_KEY, author);
  storage.set(PASSWORD_KEY, password);
}

export const forgetPassword = () => storage.remove(PASSWORD_KEY);

/**
 * 위키 서버 함수(/api/...)를 호출한다.
 * 서버 함수가 없는 환경(로컬 미리보기, GitHub Pages)이면 null을 돌려준다.
 * @param {string} name 예: 'save'
 * @param {Record<string, unknown>} body
 * @returns {Promise<{ ok: boolean, status: number,
 *   data: { error?: string, gone?: boolean, protection?: import('./store.js').Protection | null } } | null>}
 */
export async function callApi(name, body) {
  /** @type {Response} */
  let res;
  try {
    res = await fetch(`/api/${name}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  } catch {
    return null;
  }
  const data = await res.json().catch(() => null);
  // 우리 API는 항상 JSON으로 답한다. JSON이 아닌 404/405는 서버 함수가 없다는 뜻
  if (data === null) return res.status === 404 || res.status === 405 ? null : { ok: false, status: res.status, data: {} };
  return { ok: res.ok, status: res.status, data };
}
