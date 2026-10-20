import { CONFIG } from './config.js';
import { titleToPath } from './store.js';

const { owner, repo, branch } = CONFIG.github;
const encodePath = (p) => p.split('/').map(encodeURIComponent).join('/');

export const isConfigured = () => Boolean(owner && repo);

export const repoUrl = () => `https://github.com/${owner}/${repo}`;

/** @param {string} title */
export const editFileUrl = (title) =>
  `${repoUrl()}/edit/${branch}/${CONFIG.wikiDir}/${encodePath(titleToPath(title))}`;

/** GitHub 새 파일 화면은 filename/value 쿼리로 내용을 미리 채울 수 있다 */
/** @param {string} title @param {string} [content] */
export function newFileUrl(title, content) {
  const params = new URLSearchParams({ filename: titleToPath(title) });
  if (content) params.set('value', content);
  return `${repoUrl()}/new/${branch}/${CONFIG.wikiDir}?${params}`;
}

/** @param {string} title */
export const fileHistoryUrl = (title) =>
  `${repoUrl()}/commits/${branch}/${CONFIG.wikiDir}/${encodePath(titleToPath(title))}`;

/** @param {string} sha */
export const commitUrl = (sha) => `${repoUrl()}/commit/${sha}`;

/** @param {string} title @param {string} sha */
export const rawUrl = (title, sha) =>
  `https://raw.githubusercontent.com/${owner}/${repo}/${sha}/${CONFIG.wikiDir}/${encodePath(titleToPath(title))}`;

/** @param {string} title */
export const discussionTitle = (title) => `[토론] ${title}`;

/** @param {string} title */
export function newIssueUrl(title) {
  const params = new URLSearchParams({
    title: discussionTitle(title),
    body: `문서: ${location.origin}${location.pathname}#/w/${encodeURIComponent(title)}\n\n`,
  });
  return `${repoUrl()}/issues/new?${params}`;
}

/** @param {string} title */
export const issueSearchUrl = (title) =>
  `${repoUrl()}/issues?q=${encodeURIComponent(`is:issue in:title "${discussionTitle(title)}"`)}`;

/**
 * 문서 제목으로 토론(이슈) 목록을 조회한다. 비로그인 검색 API는 분당 10회 제한.
 * @param {string} title
 * @returns {Promise<Array<{title:string, html_url:string, state:string, comments:number, updated_at:string, user:{login:string}}>>}
 */
export async function searchDiscussions(title) {
  const q = `repo:${owner}/${repo} is:issue in:title "${discussionTitle(title)}"`;
  const res = await fetch(`https://api.github.com/search/issues?q=${encodeURIComponent(q)}&sort=updated&per_page=30`, {
    headers: { Accept: 'application/vnd.github+json' },
  });
  if (!res.ok) throw new Error(`GitHub API ${res.status}`);
  const data = await res.json();
  return data.items.filter((it) => it.title.startsWith(discussionTitle(title)));
}
