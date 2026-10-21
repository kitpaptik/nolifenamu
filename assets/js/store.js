import { CONFIG } from './config.js';

/**
 * @typedef {{ sha: string, date: string, author: string, message: string, status: string }} Revision
 * @typedef {{ file: string, updated: string|null, author: string|null, size: number,
 *   links: string[], includes: string[], categories: string[], text: string, history: Revision[] }} PageMeta
 * @typedef {{ title: string, sha: string, date: string, author: string, message: string, status: string }} RecentChange
 * @typedef {{ generated: string|null, pages: Record<string, PageMeta>,
 *   backlinks: Record<string, Array<{from: string, type: 'link'|'include'}>>,
 *   categories: Record<string, string[]>, recent: RecentChange[], missing?: boolean }} WikiIndex
 */

const NAMESPACES = ['틀', '분류', '파일'];

/** "틀:멤버" → "틀/멤버.txt", "나무" → "나무.txt" */
/** @param {string} title */
export function titleToPath(title) {
  const m = title.match(/^([^:/]+):(.+)$/);
  const rel = m && NAMESPACES.includes(m[1]) ? `${m[1]}/${m[2]}` : title;
  return `${rel}.txt`;
}

/** @type {WikiIndex} */
const EMPTY_INDEX = { generated: null, pages: {}, backlinks: {}, categories: {}, recent: [], missing: true };

/** @type {WikiIndex} */
let index = EMPTY_INDEX;
/** @type {Promise<WikiIndex> | null} */
let indexPromise = null;
/** @type {Map<string, Promise<string|null>>} */
const sourceCache = new Map();

/** @returns {Promise<WikiIndex>} */
export function loadIndex() {
  indexPromise ??= fetch(`${CONFIG.wikiDir}/index.json`, { cache: 'no-cache' })
    .then((r) => (r.ok ? r.json() : null))
    .catch(() => null)
    .then((data) => (index = data ? { ...EMPTY_INDEX, ...data, missing: false } : EMPTY_INDEX));
  return indexPromise;
}

/** 이미 불러온 인덱스 (loadIndex 이후 동기 접근용) */
export const getIndex = () => index;

/** 인덱스가 없으면 모든 문서가 존재한다고 가정해 빨간 링크를 남발하지 않는다 */
/** @param {string} title */
export const pageExists = (title) => index.missing || Object.hasOwn(index.pages, title);

export const allTitles = () => Object.keys(index.pages);

/** 사이트 경로로 불러온 원문의 캐시 키 */
/** @param {string} title */
const sourceUrl = (title) => `${CONFIG.wikiDir}/${titleToPath(title).split('/').map(encodeURIComponent).join('/')}`;

/**
 * 문서 원문을 가져온다. 없으면 null.
 * @param {string} title
 * @param {string} [url] 특정 리비전의 raw URL
 * @returns {Promise<string|null>}
 */
export function fetchSource(title, url) {
  const target = url ?? sourceUrl(title);
  if (!sourceCache.has(target)) {
    const p = fetch(target, { cache: url ? 'force-cache' : 'no-cache' })
      .then((r) => (r.ok ? r.text() : null))
      .catch(() => null);
    sourceCache.set(target, p);
  }
  return /** @type {Promise<string|null>} */ (sourceCache.get(target));
}

/**
 * 방금 저장한 문서를 재배포 전에도 바로 보이도록 캐시와 인덱스에 반영한다.
 * @param {string} title @param {string} content @param {string} author
 */
export function rememberSaved(title, content, author) {
  sourceCache.set(sourceUrl(title), Promise.resolve(content));
  if (index.missing || Object.hasOwn(index.pages, title)) return;
  index.pages[title] = {
    file: titleToPath(title),
    updated: new Date().toISOString(),
    author,
    size: content.length,
    links: [],
    includes: [],
    categories: [],
    text: content.slice(0, 3000),
    history: [],
  };
}
