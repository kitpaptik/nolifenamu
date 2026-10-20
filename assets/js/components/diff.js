import { escapeHtml as esc } from '../utils.js';

/**
 * @typedef {{ type: 'eq' | 'add' | 'del', text: string, a: number | null, b: number | null }} DiffOp
 */

const MAX_CELLS = 4_000_000;
const CONTEXT = 3;

/**
 * 줄 단위 LCS diff
 * @param {string} oldText
 * @param {string} newText
 * @returns {DiffOp[]}
 */
export function lineDiff(oldText, newText) {
  const A = oldText.split('\n');
  const B = newText.split('\n');

  let pre = 0;
  while (pre < A.length && pre < B.length && A[pre] === B[pre]) pre++;
  let suf = 0;
  while (suf < A.length - pre && suf < B.length - pre && A[A.length - 1 - suf] === B[B.length - 1 - suf]) suf++;

  const a = A.slice(pre, A.length - suf);
  const b = B.slice(pre, B.length - suf);
  /** @type {DiffOp[]} */
  const ops = [];
  for (let i = 0; i < pre; i++) ops.push({ type: 'eq', text: A[i], a: i + 1, b: i + 1 });

  const n = a.length;
  const m = b.length;
  if (n * m > MAX_CELLS) {
    a.forEach((text, i) => ops.push({ type: 'del', text, a: pre + i + 1, b: null }));
    b.forEach((text, j) => ops.push({ type: 'add', text, a: null, b: pre + j + 1 }));
  } else {
    const dp = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));
    for (let i = n - 1; i >= 0; i--) {
      for (let j = m - 1; j >= 0; j--) {
        dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
      }
    }
    let i = 0;
    let j = 0;
    while (i < n || j < m) {
      if (i < n && j < m && a[i] === b[j]) {
        ops.push({ type: 'eq', text: a[i], a: pre + i + 1, b: pre + j + 1 });
        i++;
        j++;
      } else if (j < m && (i >= n || dp[i][j + 1] >= dp[i + 1][j])) {
        ops.push({ type: 'add', text: b[j], a: null, b: pre + j + 1 });
        j++;
      } else {
        ops.push({ type: 'del', text: a[i], a: pre + i + 1, b: null });
        i++;
      }
    }
  }

  for (let k = 0; k < suf; k++) {
    const ai = A.length - suf + k;
    const bi = B.length - suf + k;
    ops.push({ type: 'eq', text: A[ai], a: ai + 1, b: bi + 1 });
  }
  return ops;
}

/**
 * 변경 주변 몇 줄만 남기고 나머지는 접어서 렌더링
 * @param {DiffOp[]} ops
 */
export function renderDiff(ops) {
  if (!ops.some((op) => op.type !== 'eq')) return '<p class="muted">두 판의 내용이 같습니다.</p>';
  const keep = ops.map(() => false);
  ops.forEach((op, i) => {
    if (op.type === 'eq') return;
    for (let k = Math.max(0, i - CONTEXT); k <= Math.min(ops.length - 1, i + CONTEXT); k++) keep[k] = true;
  });

  let html = '';
  let skipped = 0;
  ops.forEach((op, i) => {
    if (!keep[i]) {
      skipped++;
      return;
    }
    if (skipped) {
      html += `<div class="diff-skip">… ${skipped}줄 동일 …</div>`;
      skipped = 0;
    }
    const sign = op.type === 'add' ? '+' : op.type === 'del' ? '−' : ' ';
    html += `<div class="diff-line ${op.type}"><span class="ln">${op.a ?? ''}</span><span class="ln">${op.b ?? ''}</span><span class="tx">${sign} ${esc(op.text)}</span></div>`;
  });
  if (skipped) html += `<div class="diff-skip">… ${skipped}줄 동일 …</div>`;
  return `<div class="diff">${html}</div>`;
}
