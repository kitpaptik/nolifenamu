const HTML_ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

/** @param {unknown} s */
export const escapeHtml = (s) => String(s).replace(/[&<>"']/g, (c) => HTML_ESCAPES[c]);

/** @param {string} title @param {string} [anchor] */
export const docHref = (title, anchor) =>
  `#/w/${encodeURIComponent(title)}${anchor ? `#${encodeURIComponent(anchor)}` : ''}`;

/** @param {string} route @param {string} title */
export const routeHref = (route, title) => `#/${route}/${encodeURIComponent(title)}`;

/** @param {string} html */
export const stripTags = (html) =>
  html
    .replace(/<[^>]*>/g, '')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&');

/** @param {string | null | undefined} iso */
export function formatDate(iso) {
  if (!iso) return '-';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '-';
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

/** @param {string | null | undefined} iso */
export function timeAgo(iso) {
  if (!iso) return '';
  const diff = (Date.now() - new Date(iso).getTime()) / 1000;
  if (Number.isNaN(diff)) return '';
  if (diff < 60) return '방금';
  if (diff < 3600) return `${Math.floor(diff / 60)}분 전`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}시간 전`;
  if (diff < 86400 * 30) return `${Math.floor(diff / 86400)}일 전`;
  return formatDate(iso).slice(0, 10);
}

/** @template {(...args: any[]) => void} F @param {F} fn @param {number} ms */
export function debounce(fn, ms) {
  let timer = 0;
  return /** @type {F} */ ((...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), ms);
  });
}

/**
 * git이 파일 내용을 식별하는 blob sha1. 저장 API가 편집 충돌을 감지하는 데 쓴다.
 * @param {string} text
 */
export async function gitBlobSha(text) {
  const body = new TextEncoder().encode(text);
  const head = new TextEncoder().encode(`blob ${body.length}\0`);
  const buf = new Uint8Array(head.length + body.length);
  buf.set(head);
  buf.set(body, head.length);
  const digest = await crypto.subtle.digest('SHA-1', buf);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** localStorage는 사생활 보호 모드 등에서 예외를 던질 수 있으므로 감싼다 */
export const storage = {
  /** @param {string} key */
  get(key) {
    try {
      return localStorage.getItem(key);
    } catch {
      return null;
    }
  },
  /** @param {string} key @param {string} value */
  set(key, value) {
    try {
      localStorage.setItem(key, value);
    } catch {
      /* 무시 */
    }
  },
  /** @param {string} key */
  remove(key) {
    try {
      localStorage.removeItem(key);
    } catch {
      /* 무시 */
    }
  },
};

let toastTimer = 0;
/** @param {string} message @param {number} [ms] */
export function toast(message, ms = 4000) {
  const el = document.getElementById('toast');
  if (!el) return;
  el.textContent = message;
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (el.hidden = true), ms);
}
