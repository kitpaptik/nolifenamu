import { CONFIG } from '../config.js';
import { fetchSource, forgetSource } from '../store.js';
import { isConfigured, deleteFileUrl } from '../github.js';
import { callApi, savedCredentials, rememberCredentials, forgetPassword } from '../api.js';
import { escapeHtml as esc, docHref, routeHref, storage, toast, gitBlobSha } from '../utils.js';
import { pageHeader } from './viewer.js';

/**
 * 문서 삭제. 저장과 같은 크루 비밀번호로 /api/delete 서버 함수가 삭제 커밋을 만든다.
 * @param {HTMLElement} view
 * @param {string} title
 */
export async function renderDelete(view, title) {
  const original = await fetchSource(title);
  const head = `<article class="wiki-article card">${pageHeader(title, '삭제')}`;

  if (original === null) {
    view.innerHTML = `${head}<div class="notice">이미 없는 문서입니다. <a href="${docHref(title)}">문서로 돌아가기</a></div></article>`;
    return;
  }
  if (title === CONFIG.frontPage) {
    view.innerHTML = `${head}<div class="notice warn">대문은 삭제할 수 없습니다.</div></article>`;
    return;
  }

  view.innerHTML = `${head}
      <div class="notice warn">
        <b>${esc(title)}</b> 문서를 삭제합니다. 삭제해도 기록은 남아서
        <a href="${routeHref('history', title)}">역사</a>에서 이전 판을 보고 내용을 복사해 다시 만들 수 있습니다.
      </div>
      <form class="delete-form">
        <div class="editor-meta">
          <input type="text" name="reason" maxlength="200" placeholder="삭제 사유" aria-label="삭제 사유" required />
          <input type="text" name="author" maxlength="40" placeholder="이름" aria-label="편집자 이름" autocomplete="nickname" required />
          <input type="password" name="password" placeholder="편집 비밀번호" aria-label="편집 비밀번호" autocomplete="current-password" required />
        </div>
        <label class="delete-confirm">
          <input type="checkbox" name="confirm" required /> 문서를 삭제하는 것에 대해 친구들에게 책임질 수 있습니다.
        </label>
        <div class="editor-actions">
          <button type="submit" class="btn btn-danger">🗑️ 삭제</button>
          <a class="btn" href="${docHref(title)}">취소</a>
        </div>
      </form>
    </article>`;

  const form = /** @type {HTMLFormElement} */ (view.querySelector('form'));
  const field = (name) => /** @type {HTMLInputElement} */ (form.elements.namedItem(name));
  const submitBtn = /** @type {HTMLButtonElement} */ (form.querySelector('button[type="submit"]'));
  const credentials = savedCredentials();
  field('author').value = credentials.author;
  field('password').value = credentials.password;

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!isConfigured()) {
      toast('GitHub 저장소가 설정되지 않아 삭제할 수 없습니다.');
      return;
    }
    const author = field('author').value.trim();
    const password = field('password').value;

    submitBtn.disabled = true;
    const res = await callApi('delete', {
      title,
      reason: field('reason').value,
      author,
      password,
      baseSha: await gitBlobSha(original),
    });
    submitBtn.disabled = false;

    if (!res) {
      toast('이 사이트에서는 바로 삭제할 수 없어 GitHub 삭제 화면으로 넘어갑니다.');
      window.open(deleteFileUrl(title), '_blank', 'noopener');
      return;
    }
    if (!res.ok && !res.data.gone) {
      if (res.status === 401) {
        forgetPassword();
        field('password').select();
      }
      toast(res.data.error ?? `삭제에 실패했습니다 (${res.status}).`, 8000);
      return;
    }

    rememberCredentials(author, password);
    storage.remove(`draft:${title}`);
    forgetSource(title);
    toast(res.ok ? '삭제했습니다. 1분쯤 뒤 모두에게 반영됩니다.' : '이미 삭제된 문서입니다.', 6000);
    location.hash = docHref(title);
  });
}
