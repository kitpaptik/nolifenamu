import { fetchSource, titleToPath, rememberSaved } from '../store.js';
import { CONFIG } from '../config.js';
import { isConfigured, editFileUrl, newFileUrl } from '../github.js';
import { callApi, savedCredentials, rememberCredentials, forgetPassword } from '../api.js';
import { escapeHtml as esc, debounce, storage, toast, formatDate, docHref, gitBlobSha } from '../utils.js';
import { pageHeader, renderWiki, enhance, protectionNotice } from './viewer.js';

/** GitHub 새 파일 URL에 내용을 담을 수 있는 대략적인 한도 */
const MAX_PREFILL_URL = 7000;

/**
 * 편집기. 저장은 /api/save 서버 함수가 GitHub에 커밋한다 (Git 파일 기반 위키).
 * 서버 함수가 없는 환경(로컬 미리보기, GitHub Pages)에서는 GitHub 웹 편집기로 넘긴다.
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
      ${protectionNotice(title, 'edit')}
      ${hasDraft ? '<div class="notice">임시 저장된 내용을 불러왔습니다. <button type="button" class="btn" data-act="discard">임시 저장 버리기</button></div>' : ''}
      <div class="tabs" role="tablist">
        <button type="button" class="active" data-tab="edit">편집</button>
        <button type="button" data-tab="preview">미리보기</button>
      </div>
      <textarea class="editor-area" spellcheck="false" aria-label="문서 내용"></textarea>
      <div class="editor-preview wiki-body" hidden></div>
      <div class="editor-meta">
        <input type="text" name="summary" maxlength="200" placeholder="편집 요약 (선택)" aria-label="편집 요약" />
        <input type="text" name="author" maxlength="40" placeholder="이름" aria-label="편집자 이름" autocomplete="nickname" />
        <input type="password" name="password" placeholder="편집 비밀번호" aria-label="편집 비밀번호" autocomplete="current-password" />
      </div>
      <div class="editor-actions">
        <button type="button" class="btn btn-go" data-act="save">💾 저장</button>
        <button type="button" class="btn" data-act="copy">📋 복사</button>
        <button type="button" class="btn" data-act="download">⬇️ .txt 다운로드</button>
        <a class="btn" href="#/w/${encodeURIComponent(title)}">취소</a>
        <span class="editor-status"></span>
      </div>
      <div class="notice" style="margin-top:16px">
        파일: <code>${esc(filePath)}</code> · 크루 편집 비밀번호를 넣고 <b>저장</b>(⌘/Ctrl+S)을 누르면 바로 저장됩니다.
        다른 사람 화면에는 1분쯤 뒤 반영됩니다. 문법은 <a href="#/w/${encodeURIComponent('문법 도움말')}">문법 도움말</a> 참고.
      </div>
    </article>`;

  const $ = (sel) => /** @type {HTMLElement} */ (view.querySelector(sel));
  const area = /** @type {HTMLTextAreaElement} */ ($('.editor-area'));
  const preview = $('.editor-preview');
  const status = $('.editor-status');
  const field = (name) => /** @type {HTMLInputElement} */ (view.querySelector(`input[name="${name}"]`));
  const summaryInput = field('summary');
  const authorInput = field('author');
  const passwordInput = field('password');
  const saveBtn = /** @type {HTMLButtonElement} */ ($('[data-act="save"]'));
  area.value = initial;
  const credentials = savedCredentials();
  authorInput.value = credentials.author;
  passwordInput.value = credentials.password;

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

  /** 서버 함수가 없을 때: GitHub 웹 편집기로 넘겨 직접 커밋 */
  const saveViaGitHub = () => {
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

  const save = async () => {
    if (!isConfigured()) {
      toast('GitHub 저장소가 설정되지 않아 .txt 파일로 내려받습니다.');
      download();
      return;
    }
    if (!isNew && area.value === original) {
      toast('변경된 내용이 없습니다.');
      return;
    }
    const author = authorInput.value.trim();
    const password = passwordInput.value;
    if (!author) return (toast('이름을 입력해 주세요.'), authorInput.focus());
    if (!password) return (toast('편집 비밀번호를 입력해 주세요.'), passwordInput.focus());

    saveBtn.disabled = true;
    status.textContent = '저장 중…';
    const res = await callApi('save', {
      title,
      content: area.value,
      summary: summaryInput.value,
      author,
      password,
      baseSha: original === null ? null : await gitBlobSha(original),
    });
    saveBtn.disabled = false;
    status.textContent = '';

    if (!res) {
      toast('이 사이트에서는 바로 저장할 수 없어 GitHub 편집 화면으로 넘어갑니다.');
      saveViaGitHub();
      return;
    }
    if (!res.ok) {
      if (res.status === 401) {
        forgetPassword();
        passwordInput.select();
      }
      toast(res.data.error ?? `저장에 실패했습니다 (${res.status}).`, 8000);
      return;
    }

    rememberCredentials(author, password);
    storage.remove(draftKey);
    rememberSaved(title, area.value, author);
    toast('저장했습니다. 1분쯤 뒤 모두에게 반영됩니다.', 6000);
    location.hash = docHref(title);
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
