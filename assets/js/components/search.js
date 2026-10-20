import { allTitles, getIndex, pageExists } from '../store.js';
import { escapeHtml as esc, docHref, routeHref } from '../utils.js';

const MAX_SUGGESTIONS = 10;

/**
 * 제목 일치도 순으로 정렬한 추천 목록 (정확히 일치 > 앞부분 일치 > 포함)
 * @param {string} q
 */
export function suggest(q) {
  const needle = q.toLowerCase();
  return allTitles()
    .map((title) => {
      const t = title.toLowerCase();
      const score = t === needle ? 0 : t.startsWith(needle) ? 1 : t.includes(needle) ? 2 : -1;
      return { title, score };
    })
    .filter((x) => x.score >= 0)
    .sort((a, b) => a.score - b.score || a.title.length - b.title.length || a.title.localeCompare(b.title, 'ko'))
    .slice(0, MAX_SUGGESTIONS)
    .map((x) => x.title);
}

/** @param {string} text @param {string} q */
export function highlight(text, q) {
  const idx = text.toLowerCase().indexOf(q.toLowerCase());
  if (idx < 0 || !q) return esc(text);
  return `${esc(text.slice(0, idx))}<mark>${esc(text.slice(idx, idx + q.length))}</mark>${esc(text.slice(idx + q.length))}`;
}

/** 검색어로 이동: 문서가 있으면 바로, 없으면 검색 결과 페이지 */
/** @param {string} q */
export function go(q) {
  location.hash = pageExists(q) ? docHref(q) : `#/search?q=${encodeURIComponent(q)}`;
}

/**
 * 검색 폼에 실시간 자동완성을 붙인다. 폼 안의 첫 input을 사용한다.
 * @param {HTMLFormElement} form
 */
export function mountSearch(form) {
  const input = /** @type {HTMLInputElement} */ (form.querySelector('input'));
  const list = document.createElement('ul');
  list.className = 'ac-list';
  list.hidden = true;
  form.append(list);

  /** @type {string[]} */
  let items = [];
  let active = -1;

  const draw = () => {
    const q = input.value.trim();
    if (!q) {
      list.hidden = true;
      return;
    }
    list.innerHTML = items.length
      ? items
          .map((t, i) => `<li data-i="${i}" class="${i === active ? 'active' : ''}">${highlight(t, q)}</li>`)
          .join('')
      : `<li class="ac-hint">일치하는 문서가 없습니다 · Enter로 검색</li>`;
    list.hidden = false;
  };

  const update = () => {
    const q = input.value.trim();
    items = q && !getIndex().missing ? suggest(q) : [];
    active = -1;
    draw();
  };

  const hide = () => {
    list.hidden = true;
    active = -1;
  };

  /** @param {string} q */
  const choose = (q) => {
    hide();
    input.value = '';
    input.blur();
    go(q);
  };

  input.addEventListener('input', update);
  input.addEventListener('focus', update);
  input.addEventListener('blur', () => setTimeout(hide, 150));
  input.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      if (!items.length) return;
      e.preventDefault();
      const n = items.length; // -1(입력값 그대로) ~ n-1 사이를 순환
      if (e.key === 'ArrowDown') active = active + 1 >= n ? -1 : active + 1;
      else active = active <= -1 ? n - 1 : active - 1;
      draw();
    } else if (e.key === 'Escape') {
      hide();
    }
  });
  list.addEventListener('mousedown', (e) => {
    const li = /** @type {HTMLElement} */ (e.target).closest('li[data-i]');
    if (!li) return;
    e.preventDefault();
    choose(items[Number(/** @type {HTMLElement} */ (li).dataset.i)]);
  });
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const q = active >= 0 ? items[active] : input.value.trim();
    if (q) choose(q);
  });
}

/**
 * 검색 결과 페이지
 * @param {HTMLElement} view
 * @param {string} q
 */
export function renderSearch(view, q) {
  const needle = q.toLowerCase();
  const index = getIndex();
  const titleHits = q ? suggest(q) : [];
  const textHits = q
    ? Object.entries(index.pages)
        .filter(([title, meta]) => !titleHits.includes(title) && meta.text.toLowerCase().includes(needle))
        .slice(0, 50)
    : [];

  /** @param {string} text */
  const snippet = (text) => {
    const idx = text.toLowerCase().indexOf(needle);
    const start = Math.max(0, idx - 50);
    return `${start > 0 ? '…' : ''}${highlight(text.slice(start, idx + q.length + 80), q)}…`;
  };

  const exact = q && pageExists(q) && !index.missing;
  view.innerHTML = `
    <article class="wiki-article card">
      <div class="page-head"><h1 class="page-title">"${esc(q)}" 검색 결과</h1></div>
      ${
        !q
          ? '<p class="muted">검색어를 입력하세요.</p>'
          : exact
            ? `<p>➡️ <a href="${docHref(q)}">'${esc(q)}' 문서로 바로 가기</a></p>`
            : `<p>'${esc(q)}' 문서가 없습니다. <a class="wiki-link-missing" href="${routeHref('edit', q)}">새 문서 만들기</a></p>`
      }
      <h2 class="section-title">제목 일치 (${titleHits.length})</h2>
      ${titleHits.length ? `<ul class="wiki-list">${titleHits.map((t) => `<li><a href="${docHref(t)}">${highlight(t, q)}</a></li>`).join('')}</ul>` : '<p class="muted">없음</p>'}
      <h2 class="section-title">내용 일치 (${textHits.length})</h2>
      ${
        textHits.length
          ? `<ul class="wiki-list">${textHits
              .map(([t, meta]) => `<li><a href="${docHref(t)}">${esc(t)}</a><div class="muted">${snippet(meta.text)}</div></li>`)
              .join('')}</ul>`
          : '<p class="muted">없음</p>'
      }
    </article>`;
}
