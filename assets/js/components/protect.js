import { getProtection, setProtection } from '../store.js';
import { isConfigured } from '../github.js';
import { callApi, savedCredentials, rememberCredentials, forgetPassword } from '../api.js';
import { escapeHtml as esc, docHref, toast, formatDate } from '../utils.js';
import { pageHeader, PROTECTION_LABEL } from './viewer.js';

const LEVELS = [
  ['', '보호 없음', '크루 비밀번호로 누구나 편집·삭제'],
  ['delete', PROTECTION_LABEL.delete, '편집은 누구나, 삭제는 관리자만'],
  ['edit', PROTECTION_LABEL.edit, '편집·삭제 모두 관리자만'],
];

/**
 * 문서 보호 설정. 관리자 비밀번호로 /api/protect 서버 함수가 protected.json을 커밋한다.
 * @param {HTMLElement} view
 * @param {string} title
 */
export async function renderProtect(view, title) {
  const current = getProtection(title);
  const status = current
    ? `현재 <b>${PROTECTION_LABEL[current.level]}</b> 중입니다${current.reason ? ` (사유: ${esc(current.reason)})` : ''}.
       <span class="muted">${esc(current.by)} · ${formatDate(current.date)}</span>`
    : '현재 보호되지 않은 문서입니다.';

  view.innerHTML = `
    <article class="wiki-article card">
      ${pageHeader(title, '보호')}
      <div class="notice">${status}</div>
      <form class="protect-form">
        <fieldset class="protect-levels">
          <legend>보호 수준</legend>
          ${LEVELS.map(
            ([value, label, desc]) => `<label>
              <input type="radio" name="level" value="${value}" ${(current?.level ?? '') === value ? 'checked' : ''} />
              <b>${label}</b> <span class="muted">${desc}</span>
            </label>`,
          ).join('')}
        </fieldset>
        <div class="editor-meta">
          <input type="text" name="reason" maxlength="200" placeholder="사유 (선택)" aria-label="보호 사유" value="${esc(current?.reason ?? '')}" />
          <input type="text" name="author" maxlength="40" placeholder="이름" aria-label="관리자 이름" autocomplete="nickname" required />
          <input type="password" name="password" placeholder="관리자 비밀번호" aria-label="관리자 비밀번호" autocomplete="current-password" required />
        </div>
        <div class="editor-actions">
          <button type="submit" class="btn btn-go">🔒 적용</button>
          <a class="btn" href="${docHref(title)}">취소</a>
        </div>
      </form>
    </article>`;

  const form = /** @type {HTMLFormElement} */ (view.querySelector('form'));
  const field = (name) => /** @type {HTMLInputElement} */ (form.elements.namedItem(name));
  const submitBtn = /** @type {HTMLButtonElement} */ (form.querySelector('button[type="submit"]'));
  field('author').value = savedCredentials().author;

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!isConfigured()) {
      toast('GitHub 저장소가 설정되지 않아 보호를 설정할 수 없습니다.');
      return;
    }
    const level = /** @type {HTMLInputElement | null} */ (form.querySelector('input[name="level"]:checked'))?.value || null;
    const author = field('author').value.trim();
    const password = field('password').value;

    submitBtn.disabled = true;
    const res = await callApi('protect', { title, level, reason: field('reason').value, author, password });
    submitBtn.disabled = false;

    if (!res) {
      toast('이 사이트에서는 보호를 설정할 수 없습니다. 저장소의 protected.json을 직접 고쳐 주세요.', 8000);
      return;
    }
    if (!res.ok) {
      if (res.status === 401) {
        forgetPassword();
        field('password').select();
      }
      toast(res.data.error ?? `보호 설정에 실패했습니다 (${res.status}).`, 8000);
      return;
    }

    // 관리자 비밀번호는 일반 편집에도 쓸 수 있으므로 기억해 둔다
    rememberCredentials(author, password);
    setProtection(title, res.data.protection ?? null);
    toast(level ? `${PROTECTION_LABEL[level]}를 적용했습니다.` : '보호를 해제했습니다.');
    location.hash = docHref(title);
  });
}
