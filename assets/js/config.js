/**
 * 사이트 설정. GitHub에 push한 뒤 owner/repo를 실제 저장소로 바꿔주세요.
 * owner/repo가 비어 있으면 편집 저장·역사 비교·토론 기능이 안내 메시지로 대체됩니다.
 */
export const CONFIG = {
  siteName: 'no life krew wiki',
  github: {
    owner: 'kitpaptik',
    repo: 'nolifenamu',
    branch: 'main',
  },
  frontPage: '대문',
  noticePage: '공지사항',
  wikiDir: 'wiki',
  /** 사이드바 "주요 문서" 목록 */
  featured: [
    { icon: '📄', title: '대문' },
    { icon: '🌳', title: '나무' },
    { icon: '👥', title: 'nolifecrew' },
    { icon: '📝', title: '문법 도움말' },
  ],
};
