/**
 * 해시 라우터. 경로 형식:
 *   #/                     대문(랜딩)
 *   #/w/문서[?rev=sha][#앵커]  문서 보기
 *   #/edit|history|backlink|discuss/문서
 *   #/recent[?type=A|D]  #/all  #/random  #/new  #/search?q=
 */
import { CONFIG } from './config.js';
import { loadIndex, getIndex, allTitles } from './store.js';
import { storage, docHref } from './utils.js';
import { mountSearch, renderSearch } from './components/search.js';
import { renderSidebar } from './components/sidebar.js';
import { renderDocument } from './components/viewer.js';
import { renderEditor } from './components/editor.js';
import { renderHistory } from './components/history.js';
import { hideFootnote } from './components/footnote.js';
import {
  renderHome,
  renderRecent,
  renderAll,
  renderBacklinks,
  renderDiscuss,
  renderNewDoc,
  renderNotFound,
} from './components/pages.js';

const main = /** @type {HTMLElement} */ (document.getElementById('main'));
const sidebar = /** @type {HTMLElement} */ (document.getElementById('sidebar'));
let routeToken = 0;

function parseHash() {
  let h = location.hash.slice(1) || '/';
  let anchor = '';
  const hashIdx = h.indexOf('#');
  if (hashIdx >= 0) {
    anchor = safeDecode(h.slice(hashIdx + 1));
    h = h.slice(0, hashIdx);
  }
  const [path, qs = ''] = h.split('?');
  const parts = path.split('/').filter(Boolean);
  return {
    name: parts[0] ?? '',
    arg: parts.slice(1).map(safeDecode).join('/'),
    query: new URLSearchParams(qs),
    anchor,
  };
}

/** @param {string} s */
function safeDecode(s) {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}

/** @param {string} [title] */
const setTitle = (title) => (document.title = title ? `${title} - ${CONFIG.siteName}` : CONFIG.siteName);

/** @param {string} id */
function scrollToAnchor(id) {
  const el = document.getElementById(id);
  if (!el) return;
  // 접힌 문단 안이면 펼친다
  for (let p = el.closest('.wiki-section.folded'); p; p = p.parentElement?.closest('.wiki-section.folded') ?? null) {
    p.classList.remove('folded');
    p.previousElementSibling?.classList.remove('folded');
  }
  el.scrollIntoView({ block: 'start' });
  if (el.classList.contains('wiki-fn')) {
    el.classList.add('flash');
    setTimeout(() => el.classList.remove('flash'), 1500);
  }
}

async function route() {
  hideFootnote();
  const token = ++routeToken;
  const { name, arg, query, anchor } = parseHash();
  const view = document.createElement('div');
  main.innerHTML = '<div class="loading">불러오는 중…</div>';

  try {
    switch (name) {
      case '':
        setTitle();
        await renderHome(view);
        break;
      case 'w':
        if (!arg) return location.replace('#/');
        setTitle(arg);
        await renderDocument(view, arg, { rev: query.get('rev') });
        break;
      case 'edit':
        setTitle(`${arg} (편집)`);
        await renderEditor(view, arg);
        break;
      case 'history':
        setTitle(`${arg} (역사)`);
        renderHistory(view, arg);
        break;
      case 'backlink':
        setTitle(`${arg} (역링크)`);
        renderBacklinks(view, arg);
        break;
      case 'discuss':
        setTitle(`${arg} (토론)`);
        await renderDiscuss(view, arg);
        break;
      case 'recent':
        setTitle('최근 변경');
        renderRecent(view, query.get('type'));
        break;
      case 'all':
        setTitle('모든 문서');
        renderAll(view);
        break;
      case 'search':
        setTitle(`"${query.get('q') ?? ''}" 검색`);
        renderSearch(view, (query.get('q') ?? '').trim());
        break;
      case 'new':
        setTitle('새 문서');
        renderNewDoc(view);
        break;
      case 'random': {
        const titles = allTitles().filter((t) => !/^(틀|분류|파일):/.test(t));
        const pick = titles[Math.floor(Math.random() * titles.length)];
        return location.replace(pick ? docHref(pick) : '#/');
      }
      default:
        setTitle('찾을 수 없음');
        renderNotFound(view);
    }
  } catch (err) {
    console.error(err);
    view.innerHTML = '<div class="notice error">페이지를 표시하는 중 오류가 발생했습니다.</div>';
  }

  if (token !== routeToken) return; // 그 사이 다른 페이지로 이동함
  if (getIndex().missing) {
    view.insertAdjacentHTML(
      'afterbegin',
      '<div class="notice warn"><code>wiki/index.json</code>이 없습니다. <code>python3 scripts/build_index.py</code>를 실행하세요.</div>',
    );
  }
  main.replaceChildren(view);
  if (anchor) scrollToAnchor(anchor);
  else window.scrollTo(0, 0);
}

function setupTheme() {
  const btn = /** @type {HTMLButtonElement} */ (document.getElementById('theme-toggle'));
  const root = document.documentElement;
  const sync = () => (btn.textContent = root.dataset.theme === 'light' ? '☀️' : '🌙');
  btn.addEventListener('click', () => {
    root.dataset.theme = root.dataset.theme === 'light' ? 'dark' : 'light';
    storage.set('theme', root.dataset.theme);
    sync();
  });
  sync();
}

/** 해시 라우팅과 겹치지 않도록 "#s-1" 같은 문서 내 앵커는 직접 스크롤한다 */
function setupAnchors() {
  document.addEventListener('click', (e) => {
    const a = /** @type {HTMLElement} */ (e.target).closest('a[href^="#"]');
    if (!a) return;
    const href = /** @type {string} */ (a.getAttribute('href'));
    if (href.startsWith('#/') || e.metaKey || e.ctrlKey) return;
    e.preventDefault();
    scrollToAnchor(safeDecode(href.slice(1)));
  });
}

async function init() {
  setupTheme();
  setupAnchors();
  mountSearch(/** @type {HTMLFormElement} */ (document.getElementById('header-search')));
  await loadIndex();
  renderSidebar(sidebar);
  window.addEventListener('hashchange', route);
  await route();
}

init();
