import { parse, collectIncludes } from '../parser/namumark.js';
import { fetchSource, getIndex, pageExists, allTitles } from '../store.js';
import { isConfigured, rawUrl } from '../github.js';
import { escapeHtml as esc, docHref, routeHref, formatDate } from '../utils.js';
import { bindFootnotes } from './footnote.js';

const MAX_INCLUDE_DEPTH = 3;

/**
 * include 대상 문서를 미리 불러온다 (파서는 동기식이므로)
 * @param {string} src
 */
async function loadIncludes(src) {
  /** @type {Map<string, string | null>} */
  const map = new Map();
  let queue = collectIncludes(src);
  for (let d = 0; d < MAX_INCLUDE_DEPTH && queue.length; d++) {
    const fresh = queue.filter((t) => !map.has(t));
    const texts = await Promise.all(fresh.map((t) => fetchSource(t)));
    queue = [];
    fresh.forEach((t, k) => {
      map.set(t, texts[k]);
      if (texts[k]) queue.push(...collectIncludes(/** @type {string} */ (texts[k])));
    });
  }
  return map;
}

/**
 * 나무마크 원문을 렌더링한다.
 * @param {string} src
 * @param {string} title
 */
export async function renderWiki(src, title) {
  const includes = await loadIncludes(src);
  return parse(src, {
    exists: pageExists,
    getInclude: (t) => includes.get(t) ?? null,
    currentTitle: title,
    pageCount: () => allTitles().length,
  });
}

/** 렌더된 본문에 각주 툴팁·문단 접기를 연결한다 */
/** @param {HTMLElement} root */
export function enhance(root) {
  bindFootnotes(root);
  root.addEventListener('click', (e) => {
    const target = /** @type {HTMLElement} */ (e.target);
    const heading = target.closest('.wiki-heading');
    if (!heading || target.closest('a')) return;
    const folded = heading.classList.toggle('folded');
    heading.nextElementSibling?.classList.toggle('folded', folded);
  });
}

const ACTIONS = [
  ['edit', '✏️ 편집'],
  ['history', '🕘 역사'],
  ['backlink', '🔗 역링크'],
  ['discuss', '💬 토론'],
];

/**
 * 문서 제목 + 우측 액션 버튼 (편집/역사/역링크/토론)
 * @param {string} title
 * @param {string} [subtitle] 제목 옆 작은 글씨 (예: "편집")
 */
export function pageHeader(title, subtitle) {
  const buttons = ACTIONS.map(
    ([route, label]) => `<a class="btn btn-light" href="${routeHref(route, title)}">${label}</a>`,
  ).join('');
  return `<div class="page-head">
    <h1 class="page-title"><a href="${docHref(title)}">${esc(title)}</a>${subtitle ? `<small>(${esc(subtitle)})</small>` : ''}</h1>
    <div class="btn-group">${buttons}</div>
  </div>`;
}

/**
 * 문서 보기
 * @param {HTMLElement} view
 * @param {string} title
 * @param {{ rev?: string | null }} [opts]
 */
export async function renderDocument(view, title, { rev } = {}) {
  const index = getIndex();
  const meta = index.pages[title];

  if (rev && !isConfigured()) {
    view.innerHTML = `<article class="wiki-article card">${pageHeader(title)}
      <div class="notice warn">이전 판을 보려면 <code>assets/js/config.js</code>에 GitHub 저장소를 설정해야 합니다.</div></article>`;
    return;
  }

  const src = await fetchSource(title, rev ? rawUrl(title, rev) : undefined);
  if (src === null) {
    renderMissing(view, title, Boolean(rev));
    return;
  }

  const result = await renderWiki(src, title);
  const revIndex = rev ? (meta?.history ?? []).findIndex((h) => h.sha.startsWith(rev)) : -1;
  const revLabel = revIndex >= 0 ? `r${meta.history.length - revIndex}` : rev?.slice(0, 7);

  const categories = result.categories
    .map((c) => `<a class="${pageExists(`분류:${c}`) ? 'wiki-link-internal' : 'wiki-link-missing'}" href="${docHref(`분류:${c}`)}">${esc(c)}</a>`)
    .join('');

  view.innerHTML = `
    <article class="wiki-article card">
      ${pageHeader(title, rev ? `${revLabel} 판` : '')}
      ${meta?.updated && !rev ? `<div class="page-meta">최근 수정 시각: ${formatDate(meta.updated)}</div>` : ''}
      ${rev ? `<div class="notice wiki-rev-banner">이전 판(${esc(revLabel ?? '')})을 보고 있습니다. <a href="${docHref(title)}">최신 판 보기</a></div>` : ''}
      <div class="wiki-body">${result.html}${categoryMembers(title)}</div>
      ${categories ? `<div class="wiki-categories">분류: ${categories}</div>` : ''}
    </article>`;
  enhance(/** @type {HTMLElement} */ (view.querySelector('.wiki-body')));
}

/** 분류 문서라면 소속 문서 목록을 덧붙인다 */
/** @param {string} title */
function categoryMembers(title) {
  if (!title.startsWith('분류:')) return '';
  const members = getIndex().categories[title.slice(3)] ?? [];
  const items = members.map((t) => `<li><a href="${docHref(t)}">${esc(t)}</a></li>`).join('');
  return `<h2 class="wiki-heading">"${esc(title.slice(3))}" 분류에 속하는 문서 (${members.length})</h2>
    ${items ? `<ul class="wiki-list">${items}</ul>` : '<p class="muted">아직 이 분류에 속한 문서가 없습니다.</p>'}`;
}

/**
 * @param {HTMLElement} view
 * @param {string} title
 * @param {boolean} isRev
 */
function renderMissing(view, title, isRev) {
  const backlinks = getIndex().backlinks[title] ?? [];
  view.innerHTML = `
    <article class="wiki-article card">
      ${pageHeader(title)}
      <div class="wiki-body">
        <p>${isRev ? '해당 판을 불러올 수 없습니다.' : '해당 문서를 찾을 수 없습니다.'}</p>
        ${isRev ? '' : `<p><a class="btn btn-go" href="${routeHref('edit', title)}">✏️ 새 문서 만들기</a></p>`}
        ${backlinks.length ? `<p class="muted"><a href="${routeHref('backlink', title)}">이 문서를 링크하는 문서 ${backlinks.length}개</a>가 있습니다.</p>` : ''}
        ${categoryMembers(title)}
      </div>
    </article>`;
}
