import { fetchSource, getIndex } from '../store.js';
import { isConfigured, rawUrl, commitUrl, fileHistoryUrl } from '../github.js';
import { escapeHtml as esc, formatDate } from '../utils.js';
import { pageHeader } from './viewer.js';
import { lineDiff, renderDiff } from './diff.js';

const STATUS_LABEL = { A: '새 문서', M: '수정', D: '삭제', R: '이동' };

/**
 * 문서 역사: 리비전 목록 + 두 판 비교
 * @param {HTMLElement} view
 * @param {string} title
 */
export function renderHistory(view, title) {
  const history = getIndex().pages[title]?.history ?? [];
  const total = history.length;

  const rows = history
    .map((h, i) => {
      const rev = `r${total - i}`;
      return `<tr>
        <td class="nowrap"><input type="radio" name="old" value="${i}" ${i === 1 ? 'checked' : ''} aria-label="${rev} 이전 판으로 선택">
          <input type="radio" name="new" value="${i}" ${i === 0 ? 'checked' : ''} aria-label="${rev} 새 판으로 선택"></td>
        <td class="nowrap"><strong>${rev}</strong></td>
        <td class="nowrap hide-sm">${formatDate(h.date)}</td>
        <td><span class="tag ${h.status === 'A' ? 'add' : ''}">${STATUS_LABEL[h.status] ?? h.status}</span> ${esc(h.message)}
          <div class="muted">${esc(h.author)}</div></td>
        <td class="nowrap"><a href="#/w/${encodeURIComponent(title)}?rev=${h.sha}">보기</a>${
          isConfigured() ? ` · <a href="${commitUrl(h.sha)}" target="_blank" rel="noopener">커밋</a>` : ''
        }</td>
      </tr>`;
    })
    .join('');

  view.innerHTML = `
    <article class="wiki-article card">
      ${pageHeader(title, '역사')}
      ${
        total
          ? `${isConfigured() ? '' : '<div class="notice warn">판 보기·비교는 <code>assets/js/config.js</code>에 GitHub 저장소를 설정해야 동작합니다.</div>'}
            <table class="list-table">
              <thead><tr><th>비교</th><th>판</th><th class="hide-sm">시각</th><th>요약 / 작성자</th><th></th></tr></thead>
              <tbody>${rows}</tbody>
            </table>
            <div class="editor-actions">
              <button type="button" class="btn btn-go" data-act="compare" ${total < 2 || !isConfigured() ? 'disabled' : ''}>선택한 판 비교</button>
              ${isConfigured() ? `<a class="btn" href="${fileHistoryUrl(title)}" target="_blank" rel="noopener">GitHub에서 전체 기록 보기</a>` : ''}
            </div>
            <div class="diff-result"></div>`
          : '<p class="muted">아직 커밋된 기록이 없습니다. 문서를 GitHub에 커밋하고 배포되면 이곳에 표시됩니다.</p>'
      }
    </article>`;

  view.querySelector('[data-act="compare"]')?.addEventListener('click', async () => {
    const pick = (name) => Number(/** @type {HTMLInputElement} */ (view.querySelector(`input[name="${name}"]:checked`))?.value);
    let oldIdx = pick('old');
    let newIdx = pick('new');
    const out = /** @type {HTMLElement} */ (view.querySelector('.diff-result'));
    if (Number.isNaN(oldIdx) || Number.isNaN(newIdx) || oldIdx === newIdx) {
      out.innerHTML = '<p class="muted">서로 다른 두 판을 선택하세요.</p>';
      return;
    }
    if (oldIdx < newIdx) [oldIdx, newIdx] = [newIdx, oldIdx]; // 인덱스가 클수록 오래된 판
    out.innerHTML = '<div class="loading">불러오는 중…</div>';
    const [a, b] = await Promise.all([
      fetchSource(title, rawUrl(title, history[oldIdx].sha)),
      fetchSource(title, rawUrl(title, history[newIdx].sha)),
    ]);
    if (a === null || b === null) {
      out.innerHTML = '<div class="notice error">판을 불러오지 못했습니다. 저장소가 공개(public)인지 확인하세요.</div>';
      return;
    }
    out.innerHTML = `<h2 class="section-title">r${total - oldIdx} → r${total - newIdx}</h2>${renderDiff(lineDiff(a, b))}`;
  });
}
