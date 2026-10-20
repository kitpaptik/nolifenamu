/** 각주 툴팁: 마우스가 있으면 호버, 터치 기기면 탭으로 표시 */

/** @type {HTMLDivElement | null} */
let tip = null;
/** @type {Element | null} */
let current = null;
let hideTimer = 0;

function ensureTip() {
  if (tip) return tip;
  tip = document.createElement('div');
  tip.className = 'fn-tooltip';
  tip.hidden = true;
  tip.addEventListener('mouseenter', () => clearTimeout(hideTimer));
  tip.addEventListener('mouseleave', hideSoon);
  document.body.append(tip);
  document.addEventListener('click', (e) => {
    if (tip && !tip.hidden && !tip.contains(/** @type {Node} */ (e.target))) hideFootnote();
  });
  return tip;
}

export function hideFootnote() {
  clearTimeout(hideTimer);
  if (tip) tip.hidden = true;
  current = null;
}

function hideSoon() {
  clearTimeout(hideTimer);
  hideTimer = setTimeout(hideFootnote, 200);
}

/**
 * @param {HTMLElement} ref
 * @param {HTMLElement} root
 */
function show(ref, root) {
  const fn = root.querySelector(`#fn-${ref.dataset.fn}`);
  if (!fn) return;
  const el = ensureTip();
  clearTimeout(hideTimer);
  const clone = /** @type {HTMLElement} */ (fn.cloneNode(true));
  clone.querySelector('a')?.remove(); // 맨 앞의 되돌아가기 링크 제거
  el.innerHTML = `<strong>[${ref.textContent?.replace(/[[\]]/g, '')}]</strong> ${clone.innerHTML}`;
  el.hidden = false;

  const rect = ref.getBoundingClientRect();
  const maxLeft = document.documentElement.clientWidth - el.offsetWidth - 8;
  el.style.left = `${Math.max(8, Math.min(rect.left + window.scrollX - 12, maxLeft + window.scrollX))}px`;
  el.style.top = `${rect.bottom + window.scrollY + 8}px`;
  current = ref;
}

/** @param {HTMLElement} root 렌더된 문서 본문 */
export function bindFootnotes(root) {
  const canHover = window.matchMedia('(hover: hover)').matches;
  root.querySelectorAll('.wiki-fn-ref').forEach((node) => {
    const ref = /** @type {HTMLElement} */ (node);
    if (canHover) {
      ref.addEventListener('mouseenter', () => show(ref, root));
      ref.addEventListener('mouseleave', hideSoon);
    } else {
      ref.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (current === ref) hideFootnote();
        else show(ref, root);
      });
    }
  });
}
