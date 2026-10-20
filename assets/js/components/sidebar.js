import { CONFIG } from '../config.js';
import { getIndex, pageExists } from '../store.js';
import { escapeHtml as esc, docHref, timeAgo } from '../utils.js';

const RECENT_COUNT = 8;

/** @param {HTMLElement} el */
export function renderSidebar(el) {
  const index = getIndex();

  const featured = CONFIG.featured
    .map(
      ({ icon, title }) =>
        `<li>${icon} <a class="${pageExists(title) ? '' : 'wiki-link-missing'}" href="${docHref(title)}">${esc(title)}</a></li>`,
    )
    .join('');

  const seen = new Set();
  const recent = index.recent
    .filter((r) => !seen.has(r.title) && seen.add(r.title))
    .slice(0, RECENT_COUNT)
    .map(
      (r) =>
        `<li><a href="${docHref(r.title)}" title="${esc(r.title)}"${r.status === 'D' ? ' style="text-decoration:line-through"' : ''}>${esc(r.title)}</a><time datetime="${esc(r.date)}">${timeAgo(r.date)}</time></li>`,
    )
    .join('');

  el.innerHTML = `
    <section class="card side-card">
      <h3>⭐ 주요 문서</h3>
      <ul class="side-links">${featured}</ul>
    </section>
    <section class="card side-card">
      <h3>🕘 최근 변경</h3>
      ${recent ? `<ul class="side-links side-recent">${recent}</ul>` : '<p class="muted">기록이 없습니다.</p>'}
      <a class="side-more" href="#/recent">[더보기]</a>
    </section>
    <section class="card side-powered">
      Powered by <strong>namumark-lite</strong><br />
      NoLifeCrew Wiki · 문서 ${Object.keys(index.pages).length}개
    </section>`;
}
