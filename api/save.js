import { reply, readAuthorized, github, currentSha, contentsPath, authorName, branch } from './_github.js';

/**
 * 문서 저장 API (Vercel 서버 함수). 크루 공용 비밀번호를 확인한 뒤
 * 서버에 있는 GitHub 토큰으로 wiki/ 파일을 커밋한다. 커밋되면 Vercel이 자동 재배포한다.
 */

const MAX_CONTENT = 500_000;

/** @param {Request} request */
export async function POST(request) {
  const auth = await readAuthorized(request);
  if ('error' in auth) return auth.error;
  const { title, content, summary, author, baseSha } = auth.body;

  if (typeof content !== 'string' || content.length > MAX_CONTENT) {
    return reply(400, { error: '문서 내용이 비었거나 너무 깁니다.' });
  }
  const note = typeof summary === 'string' ? summary.trim().slice(0, 200) : '';
  const path = contentsPath(title);

  const current = await currentSha(path);
  if ('error' in current) return current.error;
  if ((baseSha ?? null) !== current.sha) {
    return reply(409, {
      error: current.sha
        ? '편집하는 사이 다른 사람이 이 문서를 수정했습니다. 내용을 복사해 두고 새로고침한 뒤 다시 편집해 주세요.'
        : '그 사이 문서가 삭제되었거나 아직 반영되지 않았습니다.',
    });
  }

  const res = await github(`/contents/${path}`, {
    method: 'PUT',
    body: JSON.stringify({
      message: `${title}: ${note || (current.sha ? '편집' : '새 문서')}`,
      content: Buffer.from(content, 'utf8').toString('base64'),
      branch,
      ...(current.sha && { sha: current.sha }),
      author: { name: authorName(author), email: 'wiki@nolifecrew.org' },
    }),
  });
  if (res.status === 409 || res.status === 422) {
    return reply(409, { error: '다른 저장과 충돌했습니다. 잠시 후 다시 시도해 주세요.' });
  }
  if (!res.ok) return reply(502, { error: `GitHub 저장 실패 (${res.status})` });

  const data = await res.json();
  return reply(200, { sha: data.content.sha, commit: data.commit.sha });
}
