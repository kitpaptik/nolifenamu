import { CONFIG } from '../config.js';
import { fetchSource, getIndex, pageExists } from '../store.js';
import { isConfigured, searchDiscussions, newIssueUrl, issueSearchUrl } from '../github.js';
import { escapeHtml as esc, docHref, routeHref, formatDate, timeAgo } from '../utils.js';
import { pageHeader, renderWiki, enhance } from './viewer.js';
import { mountSearch } from './search.js';

const NAV_CARDS = [
  ['📖', '대문', docHref(CONFIG.frontPage), '위키의 첫 페이지. 이용 규칙과 주요 문서를 안내합니다.'],
  ['✏️', '새 문서 작성', '#/new', '새로운 문서를 만들고 나무마크로 내용을 작성합니다.'],
  ['🕘', '최근 변경', '#/recent', '친구들이 최근에 수정한 문서를 시간순으로 봅니다.'],
  ['🎲', '랜덤 문서', '#/random', '아무 문서나 하나 골라 읽어 봅니다.'],
  ['📚', '모든 문서', '#/all', '위키에 있는 모든 문서를 가나다순으로 봅니다.'],
  ['📝', '문법 도움말', docHref('문법 도움말'), '목차, 각주, 표, 색상 등 나무마크 문법 정리.'],
];

/** @param {HTMLElement} view */
export async function renderHome(view) {
  const cards = NAV_CARDS.map(
    ([icon, title, href, desc]) =>
      `<a class="card nav-card" href="${href}"><h3>${icon} ${esc(title)}</h3><p>${esc(desc)}</p></a>`,
  ).join('');

  view.innerHTML = `
    <section class="card hero">
      <div class="hero-icon">🌳</div>
      <h1>NoLifeCrew Wiki</h1>
      <p>nolifecrew 친구들이 함께 만들어 가는 우리만의 백과사전</p>
      <form class="hero-search" role="search" autocomplete="off">
        <input type="search" name="q" placeholder="문서 이름을 입력하세요 (예: 나무)" aria-label="문서 검색" />
        <button class="btn btn-go" type="submit">Go</button>
      </form>
    </section>
    <h2 class="section-title">🛠️ 둘러보기</h2>
    <div class="nav-grid">${cards}</div>
    <section class="card card-pad notice-card">
      <h2>📢 ${esc(CONFIG.noticePage)}</h2>
      <div class="wiki-body"><div class="loading">불러오는 중…</div></div>
    </section>`;

  mountSearch(/** @type {HTMLFormElement} */ (view.querySelector('.hero-search')));

  const body = /** @type {HTMLElement} */ (view.querySelector('.notice-card .wiki-body'));
  const src = await fetchSource(CONFIG.noticePage);
  if (src === null) {
    body.innerHTML = `<p class="muted">공지사항이 없습니다. <a href="${routeHref('edit', CONFIG.noticePage)}">작성하기</a></p>`;
    return;
  }
  body.innerHTML = (await renderWiki(src, CONFIG.noticePage)).html;
  enhance(body);
}

const STATUS = {
  A: ['새 문서', 'add'],
  M: ['수정', ''],
  D: ['삭제', 'del'],
  R: ['이동', ''],
};

/**
 * @param {HTMLElement} view
 * @param {string | null} filter 'A' | 'D' | null
 */
export function renderRecent(view, filter) {
  const all = getIndex().recent;
  const list = filter ? all.filter((r) => r.status === filter) : all;
  const tab = (f, label) =>
    `<a class="btn ${String(filter ?? '') === f ? 'btn-light' : ''}" href="#/recent${f ? `?type=${f}` : ''}">${label}</a>`;

  const rows = list
    .map((r) => {
      const [label, cls] = STATUS[r.status] ?? [r.status, ''];
      const link =
        r.status === 'D'
          ? `<a class="wiki-link-missing" href="${docHref(r.title)}">${esc(r.title)}</a>`
          : `<a href="${docHref(r.title)}">${esc(r.title)}</a>`;
      return `<tr>
        <td>${link} <span class="muted">(<a href="${routeHref('history', r.title)}">역사</a>)</span>
          <div class="muted">${esc(r.message)}</div></td>
        <td class="nowrap"><span class="tag ${cls}">${label}</span></td>
        <td class="nowrap hide-sm">${esc(r.author)}</td>
        <td class="nowrap" title="${formatDate(r.date)}">${timeAgo(r.date)}</td>
      </tr>`;
    })
    .join('');

  view.innerHTML = `
    <article class="wiki-article card">
      <div class="page-head"><h1 class="page-title">최근 변경</h1>
        <div class="btn-group">${tab('', '전체')}${tab('A', '새 문서')}${tab('D', '삭제')}</div></div>
      ${
        rows
          ? `<table class="list-table"><thead><tr><th>문서 / 요약</th><th>변경</th><th class="hide-sm">작성자</th><th>시각</th></tr></thead><tbody>${rows}</tbody></table>`
          : '<p class="muted">아직 기록이 없습니다.</p>'
      }
    </article>`;
}

/** @param {HTMLElement} view */
export function renderAll(view) {
  /** @type {Record<string, string[]>} */
  const groups = {};
  for (const title of Object.keys(getIndex().pages)) {
    const ns = title.match(/^(틀|분류|파일):/)?.[1] ?? '일반 문서';
    (groups[ns] ??= []).push(title);
  }
  const order = ['일반 문서', '틀', '분류', '파일'];
  const sections = order
    .filter((ns) => groups[ns])
    .map((ns) => {
      const items = groups[ns]
        .sort((a, b) => a.localeCompare(b, 'ko'))
        .map((t) => `<li><a href="${docHref(t)}">${esc(t)}</a></li>`)
        .join('');
      return `<h2 class="section-title">${ns} (${groups[ns].length})</h2><ul class="wiki-list">${items}</ul>`;
    })
    .join('');
  view.innerHTML = `
    <article class="wiki-article card">
      <div class="page-head"><h1 class="page-title">모든 문서</h1></div>
      ${sections || '<p class="muted">문서가 없습니다.</p>'}
    </article>`;
}

/**
 * @param {HTMLElement} view
 * @param {string} title
 */
export function renderBacklinks(view, title) {
  const links = getIndex().backlinks[title] ?? [];
  const items = links
    .map((l) => `<li><a href="${docHref(l.from)}">${esc(l.from)}</a>${l.type === 'include' ? ' <span class="muted">(include)</span>' : ''}</li>`)
    .join('');
  view.innerHTML = `
    <article class="wiki-article card">
      ${pageHeader(title, '역링크')}
      ${items ? `<ul class="wiki-list">${items}</ul>` : '<p class="muted">이 문서를 가리키는 문서가 없습니다.</p>'}
    </article>`;
}

/**
 * 토론: 문서 제목이 붙은 GitHub 이슈를 토론 스레드로 사용한다
 * @param {HTMLElement} view
 * @param {string} title
 */
export async function renderDiscuss(view, title) {
  if (!isConfigured()) {
    view.innerHTML = `
      <article class="wiki-article card">
        ${pageHeader(title, '토론')}
        <div class="notice warn">토론은 GitHub Issues로 운영됩니다. <code>assets/js/config.js</code>에 저장소를 설정하면 이 문서의 토론 목록이 표시됩니다.</div>
      </article>`;
    return;
  }

  view.innerHTML = `
    <article class="wiki-article card">
      ${pageHeader(title, '토론')}
      <p><a class="btn btn-go" href="${newIssueUrl(title)}" target="_blank" rel="noopener">💬 새 토론 열기</a></p>
      <div class="discuss-list"><div class="loading">토론 목록을 불러오는 중…</div></div>
    </article>`;

  const out = /** @type {HTMLElement} */ (view.querySelector('.discuss-list'));
  try {
    const issues = await searchDiscussions(title);
    out.innerHTML = issues.length
      ? `<table class="list-table"><thead><tr><th>주제</th><th>상태</th><th class="hide-sm">댓글</th><th>최근</th></tr></thead><tbody>${issues
          .map(
            (it) => `<tr>
              <td><a href="${esc(it.html_url)}" target="_blank" rel="noopener">${esc(it.title)}</a><div class="muted">${esc(it.user.login)}</div></td>
              <td class="nowrap"><span class="tag ${it.state === 'open' ? 'add' : ''}">${it.state === 'open' ? '진행 중' : '닫힘'}</span></td>
              <td class="nowrap hide-sm">${it.comments}</td>
              <td class="nowrap">${timeAgo(it.updated_at)}</td>
            </tr>`,
          )
          .join('')}</tbody></table>`
      : '<p class="muted">진행 중인 토론이 없습니다.</p>';
  } catch {
    out.innerHTML = `<div class="notice error">토론 목록을 불러오지 못했습니다 (GitHub API 요청 한도 초과일 수 있음).
      <a href="${issueSearchUrl(title)}" target="_blank" rel="noopener">GitHub에서 직접 보기</a></div>`;
  }
}

/** @param {HTMLElement} view */
export function renderNewDoc(view) {
  view.innerHTML = `
    <article class="wiki-article card">
      <div class="page-head"><h1 class="page-title">새 문서 작성</h1></div>
      <form class="hero-search" style="margin:0" autocomplete="off">
        <input name="title" placeholder="문서 제목 (예: 철수, 틀:멤버)" aria-label="문서 제목" required />
        <button class="btn btn-go" type="submit">만들기</button>
      </form>
      <p class="muted">하위 문서는 <code>상위/하위</code>, 틀은 <code>틀:이름</code>, 분류는 <code>분류:이름</code> 형식으로 입력하세요.</p>
    </article>`;
  const input = /** @type {HTMLInputElement} */ (view.querySelector('input[name="title"]'));
  input.addEventListener('input', () => input.setCustomValidity(''));
  view.querySelector('form')?.addEventListener('submit', (e) => {
    e.preventDefault();
    const title = input.value.trim().replace(/\s+/g, ' ');
    if (!title || /[#?\\]|\.\./.test(title)) {
      input.setCustomValidity('#, ?, \\, .. 은 제목에 쓸 수 없습니다.');
      input.reportValidity();
      return;
    }
    location.hash = pageExists(title) && !getIndex().missing ? docHref(title) : routeHref('edit', title);
  });
}

/** @param {HTMLElement} view */
export function renderNotFound(view) {
  view.innerHTML = `
    <article class="wiki-article card">
      <div class="page-head"><h1 class="page-title">페이지를 찾을 수 없습니다</h1></div>
      <p><a href="#/">대문으로 돌아가기</a></p>
    </article>`;
}
