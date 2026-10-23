import { reply, readAuthorized, readProtection, github, authorName, branch, PROTECTION_FILE } from './_github.js';

/**
 * 문서 보호 설정 API. 관리자 비밀번호로만 쓸 수 있고, protected.json을 고치는 커밋을 만든다.
 * level: 'edit'(관리자만 편집·삭제) | 'delete'(관리자만 삭제) | null(보호 해제)
 */

const LEVEL_LABEL = { edit: '편집 보호', delete: '삭제 보호' };

/** @param {Request} request */
export async function POST(request) {
  const auth = await readAuthorized(request);
  if ('error' in auth) return auth.error;
  if (!process.env.WIKI_ADMIN_PASSWORD) {
    return reply(500, { error: '서버에 WIKI_ADMIN_PASSWORD가 설정되지 않았습니다.' });
  }
  if (!auth.admin) return reply(403, { error: '보호 설정은 관리자 비밀번호로만 할 수 있습니다.' });

  const { title, level, reason, author } = auth.body;
  if (level !== null && !Object.hasOwn(LEVEL_LABEL, level)) return reply(400, { error: '잘못된 보호 수준입니다.' });
  const note = typeof reason === 'string' ? reason.trim().slice(0, 200) : '';
  const name = authorName(author);

  const current = await readProtection();
  if ('error' in current) return current.error;
  const map = { ...current.map };
  if (level === null) {
    if (!map[title]) return reply(200, { protection: null });
    delete map[title];
  } else {
    map[title] = { level, reason: note, by: name, date: new Date().toISOString() };
  }

  const sorted = Object.fromEntries(Object.entries(map).sort(([a], [b]) => a.localeCompare(b)));
  const res = await github(`/contents/${PROTECTION_FILE}`, {
    method: 'PUT',
    body: JSON.stringify({
      message: `${title}: ${level === null ? '보호 해제' : `${LEVEL_LABEL[level]}${note ? ` (${note})` : ''}`}`,
      content: Buffer.from(`${JSON.stringify(sorted, null, 2)}\n`, 'utf8').toString('base64'),
      branch,
      ...(current.sha && { sha: current.sha }),
      author: { name, email: 'wiki@nolifecrew.org' },
    }),
  });
  if (res.status === 409 || res.status === 422) {
    return reply(409, { error: '다른 보호 설정과 충돌했습니다. 잠시 후 다시 시도해 주세요.' });
  }
  if (!res.ok) return reply(502, { error: `GitHub 저장 실패 (${res.status})` });
  return reply(200, { protection: map[title] ?? null });
}
