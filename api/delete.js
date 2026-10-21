import { CONFIG } from '../assets/js/config.js';
import { reply, readAuthorized, github, currentSha, contentsPath, authorName, branch } from './_github.js';

/**
 * 문서 삭제 API. 저장과 같은 비밀번호로 확인한 뒤 wiki/ 파일을 지우는 커밋을 만든다.
 * 지운 문서도 git 기록에 남으므로 역사에서 이전 판을 보고 되살릴 수 있다.
 */

const PROTECTED = [CONFIG.frontPage];

/** @param {Request} request */
export async function POST(request) {
  const auth = await readAuthorized(request);
  if ('error' in auth) return auth.error;
  const { title, reason, author, baseSha } = auth.body;

  if (PROTECTED.includes(title)) return reply(403, { error: `"${title}" 문서는 삭제할 수 없습니다.` });
  const note = typeof reason === 'string' ? reason.trim().slice(0, 200) : '';
  if (!note) return reply(400, { error: '삭제 사유를 입력해 주세요.' });
  const path = contentsPath(title);

  const current = await currentSha(path);
  if ('error' in current) return current.error;
  if (!current.sha) return reply(404, { error: '이미 삭제되었거나 없는 문서입니다.', gone: true });
  if (baseSha !== current.sha) {
    return reply(409, { error: '그 사이 다른 사람이 이 문서를 수정했습니다. 새로고침해서 최신 내용을 확인한 뒤 다시 시도해 주세요.' });
  }

  const res = await github(`/contents/${path}`, {
    method: 'DELETE',
    body: JSON.stringify({
      message: `${title}: 삭제 (${note})`,
      sha: current.sha,
      branch,
      author: { name: authorName(author), email: 'wiki@nolifecrew.org' },
    }),
  });
  if (res.status === 409 || res.status === 422) {
    return reply(409, { error: '다른 저장과 충돌했습니다. 잠시 후 다시 시도해 주세요.' });
  }
  if (!res.ok) return reply(502, { error: `GitHub 삭제 실패 (${res.status})` });
  return reply(200, { commit: (await res.json()).commit.sha });
}
