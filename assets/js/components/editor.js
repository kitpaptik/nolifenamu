import { fetchSource, titleToPath } from '../store.js';
import { CONFIG } from '../config.js';
import { isConfigured, editFileUrl, newFileUrl } from '../github.js';
import { escapeHtml as esc, debounce, storage, toast, formatDate } from '../utils.js';
import { pageHeader, renderWiki, enhance } from './viewer.js';

/** GitHub 새 파일 URL에 내용을 담을 수 있는 대략적인 한도 */
const MAX_PREFILL_URL = 7000;

/**
 * 편집기. 저장은 GitHub 웹 편집기로 넘겨 커밋하는 방식 (Git 파일 기반 위키).
 * @param {HTMLElement} view
 * @param {string} title
 */
export async function renderEditor(view, title) {
  const original = await fetchSource(title);
  const isNew = original === null;
  const draftKey = `draft:${title}`;
  const draft = storage.get(draftKey);
  const hasDraft = draft !== null && draft !== original;
  const initial = hasDraft ? draft : (original ?? `[목차]\n\n== 개요 ==\n'''${title}'''은(는) \n`);
  const filePath = `${CONFIG.wikiDir}/${titleToPath(title)}`;

  view.innerHTML = `
    <article class="wiki-article card">
      ${pageHeader(title, isNew ? '새 문서' : '편집')}
      ${
        isConfigured()
          ? ''
          : '<div class="notice warn"><code>assets/js/config.js</code>에 GitHub 저장소(owner/repo)를 설정하면 바로 GitHub에 저장할 수 있습니다. 지금은 .txt 다운로드만 가능합니다.</div>'
      }
      ${hasDraft ? '<div class="notice">임시 저장된 내용을 불러왔습니다. <button type="button" class="btn" data-act="discard">임시 저장 버리기</button></div>' : ''}
      <div class="tabs" role="tablist">
        <button type="button" class="active" data-tab="edit">편집</button>
        <button type="button" data-tab="preview">미리보기</button>
      </div>
      <textarea class="editor-area" spellcheck="false" aria-label="문서 내용"></textarea>
      <div class="editor-preview wiki-body" hidden></div>
      <div class="editor-actions">
        <button type="button" class="btn btn-go" data-act="save">💾 GitHub에 저장</button>
        <button type="button" class="btn" data-act="copy">📋 복사</button>
        <button type="button" class="btn" data-act="download">⬇️ .txt 다운로드</button>
        <a class="btn" href="#/w/${encodeURIComponent(title)}">취소</a>
        <span class="editor-status"></span>
      </div>
      <div class="notice" style="margin-top:16px">
        <strong>저장 방법</strong> · 파일: <code>${esc(filePath)}</code><br />
        ${
          isNew
            ? '"GitHub에 저장"을 누르면 내용이 채워진 GitHub 새 파일 화면이 열립니다. 아래의 <b>Commit changes</b>를 누르면 저장됩니다.'
            : '"GitHub에 저장"을 누르면 내용이 복사되고 GitHub 편집 화면이 열립니다. 기존 내용을 전체 선택(⌘/Ctrl+A) 후 붙여넣기(⌘/Ctrl+V) → <b>Commit changes</b>.'
        }
        <br />커밋 후 1~2분 뒤 사이트에 반영됩니다. 문법은 <a href="#/w/${encodeURIComponent('문법 도움말')}">문법 도움말</a> 참고.
      </div>
    </article>`;

  const $ = (sel) => /** @type {HTMLElement} */ (view.querySelector(sel));
  const area = /** @type {HTMLTextAreaElement} */ ($('.editor-area'));
  const preview = $('.editor-preview');
  const status = $('.editor-status');
  area.value = initial;

  const saveDraft = debounce(() => {
    if (area.value === (original ?? '')) storage.remove(draftKey);
    else storage.set(draftKey, area.value);
    status.textContent = `임시 저장됨 ${formatDate(new Date().toISOString()).slice(11)}`;
  }, 500);
  area.addEventListener('input', saveDraft);

  view.querySelectorAll('[data-tab]').forEach((btn) =>
    btn.addEventListener('click', async () => {
      const tab = /** @type {HTMLElement} */ (btn).dataset.tab;
      view.querySelectorAll('[data-tab]').forEach((b) => b.classList.toggle('active', b === btn));
      area.hidden = tab !== 'edit';
      preview.hidden = tab !== 'preview';
      if (tab === 'preview') {
        preview.innerHTML = '<div class="loading">미리보기 생성 중…</div>';
        const result = await renderWiki(area.value, title);
        preview.innerHTML = result.html;
        enhance(preview);
      }
    }),
  );

  /** 새 탭을 열기 전에 동기적으로 복사해야 브라우저가 막지 않는다 */
  const copyNow = () => {
    const { selectionStart, selectionEnd, hidden } = area;
    area.hidden = false;
    area.select();
    let ok = false;
    try {
      ok = document.execCommand('copy');
    } catch {
      ok = false;
    }
    area.setSelectionRange(selectionStart, selectionEnd);
    area.hidden = hidden;
    if (!ok) navigator.clipboard?.writeText(area.value).catch(() => {});
    return ok;
  };

  const download = () => {
    const blob = new Blob([area.value], { type: 'text/plain;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = titleToPath(title).split('/').pop() ?? 'document.txt';
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  };

  const save = () => {
    if (!isConfigured()) {
      toast('GitHub 저장소가 설정되지 않아 .txt 파일로 내려받습니다.');
      download();
      return;
    }
    if (!isNew && area.value === original) {
      toast('변경된 내용이 없습니다.');
      return;
    }
    if (isNew) {
      const url = newFileUrl(title, area.value);
      if (url.length <= MAX_PREFILL_URL) {
        window.open(url, '_blank', 'noopener');
        toast('GitHub 새 파일 화면에서 "Commit changes"를 누르면 저장됩니다.', 7000);
        return;
      }
    }
    const copied = copyNow();
    window.open(isNew ? newFileUrl(title) : editFileUrl(title), '_blank', 'noopener');
    toast(
      copied
        ? '내용을 복사했습니다. GitHub 편집기에서 전체 선택 후 붙여넣고 "Commit changes"를 누르세요.'
        : '복사가 차단되었을 수 있습니다. "📋 복사" 버튼으로 다시 복사해 주세요.',
      8000,
    );
  };

  view.querySelector('[data-act="save"]')?.addEventListener('click', save);
  view.querySelector('[data-act="copy"]')?.addEventListener('click', () =>
    toast(copyNow() ? '클립보드에 복사했습니다.' : '복사에 실패했습니다.'),
  );
  view.querySelector('[data-act="download"]')?.addEventListener('click', download);
  view.querySelector('[data-act="discard"]')?.addEventListener('click', (e) => {
    storage.remove(draftKey);
    area.value = original ?? '';
    /** @type {HTMLElement} */ (e.currentTarget).closest('.notice')?.remove();
  });
  area.addEventListener('keydown', (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key === 's') {
      e.preventDefault();
      save();
    }
  });
}
