/**
 * 나무마크 경량 파서. 원문을 HTML 문자열로 변환한다.
 * 모든 텍스트는 이스케이프되며, 스타일 값은 화이트리스트로 검증한다.
 */
import { escapeHtml as esc, docHref, stripTags, formatDate } from '../utils.js';

/**
 * @typedef {{ exists?: (title: string) => boolean, getInclude?: (title: string) => string | null,
 *   currentTitle?: string, pageCount?: () => number }} ParseOptions
 * @typedef {{ level: number, num: string, id: string, html: string }} TocEntry
 * @typedef {{ id: number, label: string, html: string }} Footnote
 * @typedef {{ html: string, toc: TocEntry[], footnotes: Footnote[], categories: string[] }} ParseResult
 */

const TOC_MARK = '\u0000TOC\u0000';
const MAX_INCLUDE_DEPTH = 3;
const PAIRS = [
  ["'''", 'strong'],
  ["''", 'em'],
  ['~~', 'del'],
  ['--', 'del'],
  ['__', 'u'],
  ['^^', 'sup'],
  [',,', 'sub'],
];
const HEADING_RE = /^(={1,6})(#?)\s+(.+?)\s+\2\1\s*$/;
const LIST_RE = /^(\s+)(?:(\*)\s?|(1\.|a\.|A\.|i\.|I\.)(?:#(\d+))?\s)(.*)$/;
const COLOR_RE = /^#([^\s,]+)(?:,#([^\s,]+))?\s([\s\S]*)$/;
const SIZE_RE = /^([+-])([1-5])\s([\s\S]*)$/;
const STYLE_PROPS =
  /^(background(-color)?|color|border(-[a-z]+)*|padding(-[a-z]+)?|margin(-[a-z]+)?|text-align|font-(size|weight|style)|(max-|min-)?(width|height)|line-height|word-break|display|border-radius)$/;
const STYLE_DANGER = /url\s*\(|expression|javascript:|@import|behavior|[<>\\"]/i;

/**
 * @param {string} src
 * @param {ParseOptions} [opts]
 * @returns {ParseResult}
 */
export function parse(src, opts = {}) {
  const parser = new Parser(opts, null, 0);
  const html = parser.render(src);
  return { html, toc: parser.toc, footnotes: parser.footnotes, categories: parser.categories };
}

/** 원문에서 [include(틀:...)] 대상 제목을 뽑는다 (미리 불러오기 용도) */
/** @param {string} src */
export function collectIncludes(src) {
  const titles = new Set();
  for (const m of src.matchAll(/\[include\(([^,)]+)/gi)) titles.add(m[1].trim());
  return [...titles];
}

class Parser {
  /**
   * @param {ParseOptions} opts
   * @param {Parser | null} root
   * @param {number} depth include 깊이
   */
  constructor(opts, root, depth) {
    this.opts = opts;
    this.root = root ?? this;
    this.depth = depth;
    /** @type {TocEntry[]} */
    this.toc = [];
    /** @type {Footnote[]} */
    this.footnotes = [];
    /** @type {string[]} */
    this.categories = [];
    this.fnNumber = 0;
    this.fnPlaced = 0;
    /** @type {number[]} 열려 있는 섹션의 헤딩 레벨 */
    this.sections = [];
    this.counters = [0, 0, 0, 0, 0, 0, 0];
    this.minLevel = 1;
    this.hasTocMacro = false;
    this.autoToc = false;
  }

  /** @param {string} src */
  render(src) {
    const lines = src.replace(/\r\n?/g, '\n').split('\n');
    const isRoot = this.root === this;
    if (isRoot) {
      // {{{ }}} 코드 블록 안의 헤딩·[목차]는 세지 않는다
      const levels = [];
      let depth = 0;
      for (const l of lines) {
        if (depth === 0) {
          const m = l.match(HEADING_RE);
          if (m) levels.push(m[1].length);
          if (/^\s*\[(목차|tableofcontents)\]\s*$/i.test(l)) this.hasTocMacro = true;
        }
        depth = Math.max(0, depth + l.split('{{{').length - l.split('}}}').length);
      }
      this.minLevel = levels.length ? Math.min(...levels) : 1;
      this.autoToc = !this.hasTocMacro;
    }
    let html = this.blocks(lines, isRoot);
    if (isRoot) {
      html += '</div>'.repeat(this.sections.length);
      this.sections = [];
      html += this.renderFootnotes();
      html = html.split(TOC_MARK).join(this.renderToc());
    }
    return html;
  }

  /* ================= 블록 ================= */

  /**
   * @param {string[]} lines
   * @param {boolean} top 문서 최상위 여부 (헤딩·섹션은 최상위에서만)
   */
  blocks(lines, top) {
    /** @type {string[]} */
    const out = [];
    /** @type {string[]} */
    let para = [];
    const flush = () => {
      const parts = para.map((l) => this.inline(l)).filter((h) => h.trim() !== '');
      if (parts.length) out.push(`<div class="wiki-paragraph">${parts.join('<br>')}</div>`);
      para = [];
    };

    let i = 0;
    while (i < lines.length) {
      const line = lines[i];
      const trimmed = line.trim();

      if (trimmed.startsWith('{{{')) {
        const block = this.braceBlock(lines, i);
        if (block) {
          flush();
          out.push(block.html);
          i = block.next;
          continue;
        }
      }

      if (trimmed.startsWith('##')) {
        i++; // 주석
        continue;
      }

      const h = line.match(HEADING_RE);
      if (h) {
        flush();
        out.push(
          top
            ? this.heading(h[1].length, h[2] === '#', h[3])
            : `<div class="wiki-subheading">${this.inline(h[3])}</div>`,
        );
        i++;
        continue;
      }

      if (/^\[(목차|tableofcontents)\]$/i.test(trimmed)) {
        flush();
        out.push(TOC_MARK);
        i++;
        continue;
      }

      if (/^\[(각주|footnote)\]$/i.test(trimmed)) {
        flush();
        out.push(this.renderFootnotes());
        i++;
        continue;
      }

      const inc = trimmed.match(/^\[include\((.+)\)\]$/i);
      if (inc) {
        flush();
        out.push(this.include(inc[1]));
        i++;
        continue;
      }

      if (/^-{4,9}$/.test(trimmed)) {
        flush();
        out.push('<hr>');
        i++;
        continue;
      }

      if (trimmed.startsWith('||')) {
        flush();
        const t = this.table(lines, i);
        out.push(t.html);
        i = t.next;
        continue;
      }

      if (line.startsWith('>')) {
        flush();
        const inner = [];
        while (i < lines.length && lines[i].startsWith('>')) inner.push(lines[i++].replace(/^>\s?/, ''));
        out.push(`<blockquote class="wiki-quote">${this.blocks(inner, false)}</blockquote>`);
        continue;
      }

      if (LIST_RE.test(line)) {
        flush();
        const l = this.list(lines, i);
        out.push(l.html);
        i = l.next;
        continue;
      }

      if (/^\s/.test(line) && trimmed !== '') {
        flush();
        const inner = [];
        while (i < lines.length && /^\s/.test(lines[i]) && lines[i].trim() !== '' && !LIST_RE.test(lines[i])) {
          inner.push(lines[i++].replace(/^\s/, ''));
        }
        out.push(`<div class="wiki-indent">${this.blocks(inner, false)}</div>`);
        continue;
      }

      if (trimmed === '') {
        flush();
        i++;
        continue;
      }

      para.push(line);
      i++;
    }
    flush();
    return out.join('\n');
  }

  /**
   * @param {number} level
   * @param {boolean} folded
   * @param {string} raw
   */
  heading(level, folded, raw) {
    let html = '';
    while (this.sections.length && /** @type {number} */ (this.sections.at(-1)) >= level) {
      html += '</div>';
      this.sections.pop();
    }
    if (this.autoToc && this.toc.length === 0) html += TOC_MARK; // 첫 헤딩 앞에 자동 목차

    this.counters[level]++;
    this.counters.fill(0, level + 1);
    const num = this.counters.slice(this.minLevel, level + 1).join('.');
    const id = `s-${num}`;
    const inner = this.inline(raw);
    this.toc.push({ level, num, id, html: inner });

    const tag = `h${Math.min(6, level - this.minLevel + 2)}`;
    const cls = folded ? ' folded' : '';
    html +=
      `<${tag} class="wiki-heading${cls}" id="${id}"><a class="wiki-heading-num" href="#toc">${num}.</a> ` +
      `<span id="${esc(stripTags(inner).trim())}">${inner}</span></${tag}><div class="wiki-section${cls}">`;
    this.sections.push(level);
    return html;
  }

  renderToc() {
    if (!this.toc.length) return '';
    const items = this.toc
      .map((t) => {
        const depth = Math.min(4, t.num.split('.').length - 1);
        const text = t.html.replace(/<a class="wiki-fn-ref"[^>]*>.*?<\/a>/g, '');
        return `<span class="wiki-toc-item toc-d${depth}"><a href="#${t.id}">${t.num}.</a> <span class="toc-text">${text}</span></span>`;
      })
      .join('');
    return `<div class="wiki-toc" id="toc"><div class="wiki-toc-title">목차</div>${items}</div>`;
  }

  renderFootnotes() {
    const root = this.root;
    const list = root.footnotes.slice(root.fnPlaced);
    root.fnPlaced = root.footnotes.length;
    if (!list.length) return '';
    const items = list
      .map((f) => `<span class="wiki-fn" id="fn-${f.id}"><a href="#rfn-${f.id}">[${esc(f.label)}]</a> ${f.html}</span>`)
      .join('');
    return `<div class="wiki-footnotes">${items}</div>`;
  }

  /**
   * 여러 줄에 걸친 {{{ ... }}} 블록. 같은 줄에서 닫히면 null (인라인으로 처리).
   * @param {string[]} lines
   * @param {number} i
   */
  braceBlock(lines, i) {
    const first = lines[i];
    const start = first.indexOf('{{{');
    const text = lines.slice(i).join('\n');
    const close = findBraceClose(text, start + 3);
    if (close < 0 || close < first.length) return null;

    const inner = text.slice(start + 3, close);
    const consumed = text.slice(0, close + 3).split('\n').length;
    const rest = text.slice(close + 3).split('\n')[0];
    let html = this.braceBlockHtml(inner);
    if (rest.trim()) html += `<div class="wiki-paragraph">${this.inline(rest)}</div>`;
    return { html, next: i + consumed };
  }

  /** @param {string} inner */
  braceBlockHtml(inner) {
    const nl = inner.indexOf('\n');
    const head = nl < 0 ? inner : inner.slice(0, nl);
    const body = nl < 0 ? '' : inner.slice(nl + 1);
    let m;
    if ((m = head.match(/^#!wiki\b(.*)$/))) {
      const style = sanitizeStyle(readAttr(m[1], 'style'));
      return `<div class="wiki-box"${style ? ` style="${esc(style)}"` : ''}>${this.blocks(body.split('\n'), false)}</div>`;
    }
    if ((m = head.match(/^#!folding\s*(.*)$/))) {
      const summary = m[1].trim() ? this.inline(m[1].trim()) : '[ 펼치기 · 접기 ]';
      return `<details class="wiki-folding"><summary>${summary}</summary>${this.blocks(body.split('\n'), false)}</details>`;
    }
    if ((m = head.match(/^#!syntax\s*(\S*)/))) return codeBlock(body, m[1]);
    if (head.startsWith('#!')) return codeBlock(body); // #!html 등은 보안상 코드로만 표시
    if ((m = inner.match(COLOR_RE))) {
      const vars = colorVars('fg', m[1], m[2]);
      if (vars) return `<div class="nm-fg" style="${vars}">${this.blocks(m[3].split('\n'), false)}</div>`;
    }
    if ((m = inner.match(SIZE_RE))) {
      return `<div class="${sizeClass(m[1], m[2])}">${this.blocks(m[3].split('\n'), false)}</div>`;
    }
    return codeBlock(inner);
  }

  /** @param {string} argStr */
  include(argStr) {
    const parts = splitUnescaped(argStr, ',');
    const title = /** @type {string} */ (parts.shift()).trim();
    /** @type {Record<string, string>} */
    const params = {};
    for (const p of parts) {
      const eq = p.indexOf('=');
      if (eq > 0) params[p.slice(0, eq).trim()] = p.slice(eq + 1).trim().replace(/\\,/g, ',');
    }
    const src = this.depth < MAX_INCLUDE_DEPTH && this.opts.getInclude ? this.opts.getInclude(title) : null;
    if (src == null) {
      return `<div class="wiki-include-missing">${this.link(title)} 문서를 불러올 수 없습니다.</div>`;
    }
    const filled = src.replace(/@([^@=\n]+)(?:=([^@\n]*))?@/g, (_, k, def) => params[k.trim()] ?? def ?? '');
    const child = new Parser({ ...this.opts, currentTitle: title }, this.root, this.depth + 1);
    return `<div class="wiki-include">${child.render(filled)}</div>`;
  }

  /**
   * @param {string[]} lines
   * @param {number} i
   */
  table(lines, i) {
    /** @type {string[]} */
    const rows = [];
    while (i < lines.length && lines[i].trim().startsWith('||')) {
      let row = lines[i++].trim();
      while (!(row.length >= 4 && row.endsWith('||')) && i < lines.length) row += `\n${lines[i++].trimEnd()}`;
      rows.push(row);
    }

    const table = { align: '', width: '', style: /** @type {string[]} */ ([]), cls: /** @type {string[]} */ ([]) };
    const trs = rows.map((row) => {
      const tr = { style: /** @type {string[]} */ ([]), cls: /** @type {string[]} */ ([]) };
      const body = row.slice(2, row.endsWith('||') && row.length >= 4 ? -2 : undefined);
      let span = 1;
      let tds = '';
      for (const part of splitCells(body)) {
        if (part === '') {
          span++;
          continue;
        }
        tds += this.cell(part, span, table, tr);
        span = 1;
      }
      return `<tr${classStyle(tr.cls, tr.style)}>${tds}</tr>`;
    });

    if (table.width) table.style.push('width:100%');
    const wrapStyle = table.width ? ` style="width:${table.width};max-width:100%"` : '';
    const wrapCls = table.align ? ` align-${table.align}` : '';
    const html =
      `<div class="wiki-table-wrap${wrapCls}"${wrapStyle}><table class="wiki-table${table.cls.length ? ` ${table.cls.join(' ')}` : ''}"` +
      `${table.style.length ? ` style="${esc(table.style.join(';'))}"` : ''}><tbody>${trs.join('')}</tbody></table></div>`;
    return { html, next: i };
  }

  /**
   * @param {string} raw
   * @param {number} span
   * @param {{align: string, width: string, style: string[], cls: string[]}} table
   * @param {{style: string[], cls: string[]}} tr
   */
  cell(raw, span, table, tr) {
    const td = { colspan: span, rowspan: 1, align: '', style: /** @type {string[]} */ ([]), cls: /** @type {string[]} */ ([]) };
    let text = raw;
    let m;
    while ((m = text.match(/^<([^<>\n]*)>/))) {
      if (!applyCellAttr(m[1].trim(), td, table, tr)) break;
      text = text.slice(m[0].length);
    }
    if (!td.align) {
      const left = /^ /.test(text);
      const right = / $/.test(text);
      if (left && right) td.align = 'center';
      else if (left) td.align = 'right';
    }
    if (td.align) td.style.push(`text-align:${td.align}`);

    const content = text.trim();
    const inner = content.includes('\n') ? this.blocks(content.split('\n'), false) : this.inline(content);
    const spans =
      (td.colspan > 1 ? ` colspan="${td.colspan}"` : '') + (td.rowspan > 1 ? ` rowspan="${td.rowspan}"` : '');
    return `<td${spans}${classStyle(td.cls, td.style)}>${inner}</td>`;
  }

  /**
   * @param {string[]} lines
   * @param {number} i
   */
  list(lines, i) {
    /** @type {{indent: number, type: string, start: string | undefined, text: string}[]} */
    const items = [];
    while (i < lines.length) {
      const m = lines[i].match(LIST_RE);
      if (!m) break;
      items.push({ indent: m[1].length, type: m[2] ?? m[3], start: m[4], text: m[5] });
      i++;
    }

    let k = 0;
    /** @param {number} level @returns {string} */
    const rec = (level) => {
      const first = items[k];
      const type = first.type;
      const isUl = type === '*';
      let html = isUl
        ? '<ul class="wiki-list">'
        : `<ol class="wiki-list" type="${type[0]}"${first.start ? ` start="${first.start}"` : ''}>`;
      while (k < items.length && items[k].indent >= level) {
        const it = items[k];
        if (it.indent === level) {
          if (it.type !== type) break;
          k++;
          html += `<li>${this.inline(it.text)}`;
          if (k < items.length && items[k].indent > level) html += rec(items[k].indent);
          html += '</li>';
        } else {
          html += `<li class="nobullet">${rec(it.indent)}</li>`;
        }
      }
      return html + (isUl ? '</ul>' : '</ol>');
    };

    let html = '';
    while (k < items.length) html += rec(items[k].indent);
    return { html, next: i };
  }

  /* ================= 인라인 ================= */

  /** @param {string} s */
  inline(s) {
    let out = '';
    let buf = '';
    const flushText = () => {
      if (buf) out += esc(buf);
      buf = '';
    };
    let i = 0;
    outer: while (i < s.length) {
      const c = s[i];
      if (c === '\\' && i + 1 < s.length) {
        buf += s[i + 1];
        i += 2;
        continue;
      }
      if (c === '{' && s.startsWith('{{{', i)) {
        const end = findBraceClose(s, i + 3);
        if (end >= 0) {
          flushText();
          out += this.braces(s.slice(i + 3, end));
          i = end + 3;
          continue;
        }
      }
      if (c === '[') {
        if (s.startsWith('[[', i)) {
          const end = findLinkClose(s, i + 2);
          if (end >= 0) {
            flushText();
            out += this.link(s.slice(i + 2, end));
            i = end + 2;
            continue;
          }
        } else {
          const m = this.macro(s, i);
          if (m) {
            flushText();
            out += m.html;
            i = m.end;
            continue;
          }
        }
      }
      for (const [mark, tag] of PAIRS) {
        if (c === mark[0] && s.startsWith(mark, i)) {
          const end = s.indexOf(mark, i + mark.length);
          if (end > i + mark.length) {
            flushText();
            out += `<${tag}>${this.inline(s.slice(i + mark.length, end))}</${tag}>`;
            i = end + mark.length;
            continue outer;
          }
        }
      }
      buf += c;
      i++;
    }
    flushText();
    return out;
  }

  /** @param {string} inner */
  braces(inner) {
    let m;
    if (inner.startsWith('#!')) return `<code>${esc(inner)}</code>`;
    if ((m = inner.match(COLOR_RE))) {
      const vars = colorVars('fg', m[1], m[2]);
      if (vars) return `<span class="nm-fg" style="${vars}">${this.inline(m[3])}</span>`;
    }
    if ((m = inner.match(SIZE_RE))) return `<span class="${sizeClass(m[1], m[2])}">${this.inline(m[3])}</span>`;
    return `<code>${esc(inner)}</code>`;
  }

  /** @param {string} content [[ ]] 안쪽 */
  link(content) {
    const sep = indexOfUnescaped(content, '|');
    const rawTarget = (sep < 0 ? content : content.slice(0, sep)).trim();
    const label = sep < 0 ? null : content.slice(sep + 1);
    let target = rawTarget.replace(/\\(.)/g, '$1');

    if (/^https?:\/\//i.test(target)) {
      const text = label !== null ? this.inline(label) : esc(target);
      return `<a class="wiki-link-external" href="${esc(target)}" target="_blank" rel="noopener noreferrer">${text}</a>`;
    }
    if (target.startsWith('파일:')) return this.image(target.slice(3), label);
    if (target.startsWith('분류:')) {
      const cat = target.slice(3).trim();
      if (cat && !this.categories.includes(cat)) this.categories.push(cat);
      return '';
    }
    if (target.startsWith(':')) target = target.slice(1);

    let anchor = '';
    const hash = target.indexOf('#');
    if (hash >= 0) {
      anchor = target.slice(hash + 1);
      target = target.slice(0, hash);
    }
    target = this.resolveRelative(target.trim());
    const text = label !== null ? this.inline(label) : esc(rawTarget.replace(/\\(.)/g, '$1'));

    if (!target) return `<a class="wiki-link-anchor" href="#${esc(encodeURIComponent(anchor))}">${text}</a>`;
    const exists = this.opts.exists ? this.opts.exists(target) : true;
    const cls = exists ? 'wiki-link-internal' : 'wiki-link-missing';
    return `<a class="${cls}" href="${esc(docHref(target, anchor))}" title="${esc(target)}">${text}</a>`;
  }

  /** 하위 문서 링크: [[/하위]] → 현재문서/하위, [[../]] → 상위 문서 */
  /** @param {string} t */
  resolveRelative(t) {
    const cur = this.opts.currentTitle ?? '';
    if (t.startsWith('../')) {
      const parent = cur.includes('/') ? cur.slice(0, cur.lastIndexOf('/')) : cur;
      const rest = t.slice(3);
      return rest ? `${parent}/${rest}` : parent;
    }
    if (t.startsWith('/')) return cur + t;
    return t;
  }

  /**
   * @param {string} name 파일명(files/ 폴더 기준) 또는 http(s) URL
   * @param {string | null} label width=300&align=center 형식
   */
  image(name, label) {
    name = name.trim();
    let src;
    if (/^https?:\/\//i.test(name)) src = name;
    else if (!name.includes('..') && !/[:\\]/.test(name)) src = `files/${name.split('/').map(encodeURIComponent).join('/')}`;
    else return esc(name);

    const params = new URLSearchParams(label ?? '');
    const style = [];
    for (const key of ['width', 'height']) {
      const size = cssSize(params.get(key));
      if (size) style.push(`${key}:${size}`);
    }
    const img = `<img class="wiki-image" src="${esc(src)}" alt="${esc(name)}" loading="lazy"${style.length ? ` style="${style.join(';')}"` : ''}>`;
    const align = params.get('align');
    if (align === 'center') return `<span style="display:block;text-align:center">${img}</span>`;
    if (align === 'right') return `<span style="float:right;margin:0 0 8px 12px">${img}</span>`;
    return img;
  }

  /**
   * @param {string} s
   * @param {number} i '['의 위치
   */
  macro(s, i) {
    if (s[i + 1] === '*') {
      const end = findBracketClose(s, i);
      if (end < 0) return null;
      return { html: this.footnote(s.slice(i + 2, end)), end: end + 1 };
    }
    const m = s.slice(i).match(/^\[([a-zA-Z가-힣]+)(?:\(([^)]*)\))?\]/);
    if (!m) return null;
    const html = this.macroHtml(m[1].toLowerCase(), m[2] ?? '');
    return html === null ? null : { html, end: i + m[0].length };
  }

  /**
   * @param {string} name
   * @param {string} arg
   * @returns {string | null}
   */
  macroHtml(name, arg) {
    switch (name) {
      case 'br':
        return '<br>';
      case 'clearfix':
        return '<div style="clear:both"></div>';
      case '목차':
      case 'tableofcontents':
      case '각주':
      case 'footnote':
        return '';
      case 'date':
      case 'datetime':
        return esc(formatDate(new Date().toISOString()));
      case 'pagecount':
        return String(this.opts.pageCount?.() ?? 0);
      case 'age': {
        const d = parseDate(arg);
        if (!d) return null;
        const now = new Date();
        const beforeBirthday =
          now.getMonth() < d.getMonth() || (now.getMonth() === d.getMonth() && now.getDate() < d.getDate());
        return String(now.getFullYear() - d.getFullYear() - (beforeBirthday ? 1 : 0));
      }
      case 'dday': {
        const d = parseDate(arg);
        if (!d) return null;
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const n = Math.round((d.getTime() - today.getTime()) / 86400000);
        return n > 0 ? `D-${n}` : n === 0 ? 'D-Day' : `D+${-n}`;
      }
      case 'youtube': {
        const id = arg.split(',')[0].trim();
        if (!/^[\w-]{11}$/.test(id)) return null;
        return `<iframe class="wiki-youtube" src="https://www.youtube-nocookie.com/embed/${id}" title="YouTube" loading="lazy" allowfullscreen></iframe>`;
      }
      default:
        return null;
    }
  }

  /** @param {string} inner "[*" 와 "]" 사이 */
  footnote(inner) {
    const root = this.root;
    const m = /** @type {RegExpMatchArray} */ (inner.match(/^(\S*)\s?([\s\S]*)$/));
    const id = root.footnotes.length + 1;
    const label = m[1] || String(++root.fnNumber);
    /** @type {Footnote} */
    const fn = { id, label, html: '' };
    root.footnotes.push(fn); // 중첩 각주보다 먼저 번호를 차지하도록 먼저 넣는다
    fn.html = this.inline(m[2]);
    return `<a class="wiki-fn-ref" id="rfn-${id}" href="#fn-${id}" data-fn="${id}">[${esc(label)}]</a>`;
  }
}

/* ================= 헬퍼 ================= */

/** @param {string} s @param {number} from */
function findBraceClose(s, from) {
  let depth = 1;
  for (let i = from; i < s.length; ) {
    if (s.startsWith('{{{', i)) {
      depth++;
      i += 3;
    } else if (s.startsWith('}}}', i)) {
      if (--depth === 0) return i;
      i += 3;
    } else i++;
  }
  return -1;
}

/** @param {string} s @param {number} from */
function findLinkClose(s, from) {
  let depth = 1;
  for (let i = from; i < s.length - 1; i++) {
    if (s[i] === '\\') {
      i++;
    } else if (s.startsWith('[[', i)) {
      depth++;
      i++;
    } else if (s.startsWith(']]', i)) {
      if (--depth === 0) return i;
      i++;
    }
  }
  return -1;
}

/** @param {string} s @param {number} open '['의 위치 */
function findBracketClose(s, open) {
  let depth = 0;
  for (let i = open; i < s.length; i++) {
    const c = s[i];
    if (c === '\\') i++;
    else if (c === '[') depth++;
    else if (c === ']' && --depth === 0) return i;
  }
  return -1;
}

/** @param {string} s @param {string} ch */
function indexOfUnescaped(s, ch) {
  for (let i = 0; i < s.length; i++) {
    if (s[i] === '\\') i++;
    else if (s[i] === ch) return i;
  }
  return -1;
}

/** @param {string} s @param {string} ch */
function splitUnescaped(s, ch) {
  const out = [];
  let start = 0;
  for (let i = 0; i < s.length; i++) {
    if (s[i] === '\\') i++;
    else if (s[i] === ch) {
      out.push(s.slice(start, i));
      start = i + 1;
    }
  }
  out.push(s.slice(start));
  return out;
}

/** 표 행을 || 기준으로 나누되 {{{ }}} 와 [[ ]] 안쪽은 건너뛴다 */
/** @param {string} s */
function splitCells(s) {
  const out = [];
  let cur = '';
  let brace = 0;
  let link = 0;
  for (let i = 0; i < s.length; ) {
    if (s.startsWith('{{{', i)) {
      brace++;
      cur += '{{{';
      i += 3;
    } else if (brace && s.startsWith('}}}', i)) {
      brace--;
      cur += '}}}';
      i += 3;
    } else if (!brace && s.startsWith('[[', i)) {
      link++;
      cur += '[[';
      i += 2;
    } else if (!brace && link && s.startsWith(']]', i)) {
      link--;
      cur += ']]';
      i += 2;
    } else if (!brace && !link && s.startsWith('||', i)) {
      out.push(cur);
      cur = '';
      i += 2;
    } else {
      cur += s[i++];
    }
  }
  out.push(cur);
  return out;
}

/**
 * 셀 속성 <...> 하나를 해석한다. 모르는 속성이면 false.
 * @param {string} token
 * @param {{colspan: number, rowspan: number, align: string, style: string[], cls: string[]}} td
 * @param {{align: string, width: string, style: string[], cls: string[]}} table
 * @param {{style: string[], cls: string[]}} tr
 */
function applyCellAttr(token, td, table, tr) {
  let m;
  if ((m = token.match(/^-(\d+)$/))) {
    td.colspan = Number(m[1]);
    return true;
  }
  if ((m = token.match(/^([\^v]?)\|(\d+)$/))) {
    td.rowspan = Number(m[2]);
    if (m[1]) td.style.push(`vertical-align:${m[1] === '^' ? 'top' : 'bottom'}`);
    return true;
  }
  const aligns = { '(': 'left', ':': 'center', ')': 'right' };
  if (token in aligns) {
    td.align = aligns[/** @type {'(' | ':' | ')'} */ (token)];
    return true;
  }
  if ((m = token.match(/^#([^\s,]+)(?:,#([^\s,]+))?$/))) return addColor(td, 'bg', m[1], m[2]);

  const kv = token.match(/^([a-z]+)\s*=\s*(.+)$/i);
  if (!kv) return false;
  const key = kv[1].toLowerCase();
  const val = kv[2].trim().replace(/^['"]|['"]$/g, '');
  const [light, dark] = val.split(',');
  switch (key) {
    case 'bgcolor':
      return addColor(td, 'bg', light, dark);
    case 'color':
      return addColor(td, 'fg', light, dark);
    case 'rowbgcolor':
      return addColor(tr, 'bg', light, dark);
    case 'rowcolor':
      return addColor(tr, 'fg', light, dark);
    case 'tablebgcolor':
      return addColor(table, 'bg', light, dark);
    case 'tablecolor':
      return addColor(table, 'fg', light, dark);
    case 'tablebordercolor': {
      const c = normColor(light);
      if (c) table.style.push(`--tb-border:${c}`);
      return true;
    }
    case 'tablealign':
      if (['left', 'center', 'right'].includes(val)) table.align = val;
      return true;
    case 'tablewidth':
      table.width = cssSize(val) ?? '';
      return true;
    case 'width':
    case 'height': {
      const size = cssSize(val);
      if (size) td.style.push(`${key}:${size}`);
      return true;
    }
    case 'colbgcolor':
    case 'colcolor':
    case 'nopad':
      return true;
    default:
      return false;
  }
}

/**
 * @param {{style: string[], cls: string[]}} target
 * @param {'bg' | 'fg'} kind
 * @param {string | undefined} light
 * @param {string | undefined} dark
 */
function addColor(target, kind, light, dark) {
  const vars = colorVars(kind, light, dark);
  if (vars) {
    target.cls.push(`nm-${kind}`);
    target.style.push(vars);
  }
  return true;
}

/** @param {string | undefined} c */
function normColor(c) {
  if (!c) return null;
  const v = c.trim().replace(/^#/, '');
  if (/^[0-9a-f]+$/i.test(v) && [3, 4, 6, 8].includes(v.length)) return `#${v}`;
  if (/^[a-z]+$/i.test(v)) return v.toLowerCase();
  return null;
}

/**
 * 라이트/다크 색상을 CSS 변수로 넘긴다. 실제 적용은 wiki.css의 .nm-fg/.nm-bg.
 * @param {'bg' | 'fg'} kind
 * @param {string | undefined} light
 * @param {string | undefined} dark
 */
function colorVars(kind, light, dark) {
  const l = normColor(light);
  if (!l) return '';
  const d = normColor(dark);
  return `--${kind}-l:${l}${d ? `;--${kind}-d:${d}` : ''}`;
}

/** @param {string | null | undefined} v */
function cssSize(v) {
  const m = v?.trim().match(/^(\d+(?:\.\d+)?)(px|%)?$/);
  return m ? `${m[1]}${m[2] ?? 'px'}` : null;
}

/** @param {string} sign @param {string} n */
const sizeClass = (sign, n) => `wiki-size-${sign === '+' ? 'up' : 'down'}-${n}`;

/** @param {string[]} cls @param {string[]} style */
const classStyle = (cls, style) =>
  (cls.length ? ` class="${cls.join(' ')}"` : '') + (style.length ? ` style="${esc(style.join(';'))}"` : '');

/** @param {string} code @param {string} [lang] */
function codeBlock(code, lang) {
  const body = code.replace(/^\n/, '').replace(/\n$/, '');
  return `<pre class="wiki-code"${lang ? ` data-lang="${esc(lang)}"` : ''}><code>${esc(body)}</code></pre>`;
}

/** @param {string} s @param {string} name */
function readAttr(s, name) {
  const m = s.match(new RegExp(`(?:^|\\s)${name}\\s*=\\s*"([^"]*)"`));
  return m ? m[1] : '';
}

/** 허용된 CSS 속성만 남긴다 */
/** @param {string} style */
function sanitizeStyle(style) {
  return style
    .split(';')
    .map((decl) => decl.trim())
    .filter((decl) => {
      const idx = decl.indexOf(':');
      if (idx < 0) return false;
      const prop = decl.slice(0, idx).trim().toLowerCase();
      const value = decl.slice(idx + 1);
      return STYLE_PROPS.test(prop) && !STYLE_DANGER.test(value);
    })
    .join(';');
}

/** @param {string} s YYYY-MM-DD */
function parseDate(s) {
  const m = s.trim().match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  return m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : null;
}
