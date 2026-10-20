# 🌳 no life krew wiki

nolifecrew 친구들을 위한 나무위키 스타일 위키. 빌드 도구 없이 순수 HTML/CSS/JS로 동작하고, **문서는 이 저장소의 `wiki/` 폴더에 텍스트 파일로 저장**됩니다. GitHub Pages로 `nolifecrew.org`에 배포합니다.

## 배포 (최초 1회)

1. GitHub에서 **빈 공개(public) 저장소**를 만든 뒤 push:
   ```bash
   git remote add origin https://github.com/<계정>/<저장소>.git
   git push -u origin main
   ```
2. 저장소 **Settings → Pages**
   - Build and deployment → Source: **GitHub Actions**
   - Custom domain: `nolifecrew.org` 입력 후 Save → DNS 확인 후 **Enforce HTTPS** 체크
3. 도메인 구매처 DNS 설정:

   | 타입 | 호스트 | 값 |
   |---|---|---|
   | A | `@` | `185.199.108.153` |
   | A | `@` | `185.199.109.153` |
   | A | `@` | `185.199.110.153` |
   | A | `@` | `185.199.111.153` |
   | CNAME | `www` | `<계정>.github.io` |

   반영까지 몇 분~최대 24시간 걸릴 수 있습니다.
4. `assets/js/config.js`의 `github.owner`, `github.repo`를 채우고 커밋 → 편집 저장·역사 비교·토론이 활성화됩니다.

push할 때마다 `.github/workflows/pages.yml`이 `wiki/index.json`(문서 목록·역링크·역사)을 만들고 자동 배포합니다.

## 문서 쓰기

- 사이트에서 **✏️ 편집** → 미리보기로 확인 → **💾 GitHub에 저장** → GitHub 화면에서 *Commit changes*
- 또는 `wiki/` 폴더의 `.txt` 파일을 직접 수정해서 커밋
- 파일 규칙: `나무` → `wiki/나무.txt`, `틀:멤버` → `wiki/틀/멤버.txt`, `분류:크루` → `wiki/분류/크루.txt`, 하위 문서 `A/B` → `wiki/A/B.txt`
- 이미지는 `files/`에 올리고 `[[파일:이름.png]]`로 사용
- 문법은 사이트의 **문법 도움말** 문서 참고
- 친구가 편집하려면 저장소 **Settings → Collaborators**에 초대하세요 (아니면 fork + Pull Request)
- 토론은 문서 제목이 붙은 GitHub Issues(`[토론] 문서명`)로 운영됩니다

## 로컬 미리보기

```bash
python3 scripts/build_index.py   # wiki/index.json 생성
python3 -m http.server 8000      # http://localhost:8000
```

## 구조

```
index.html                 SPA 셸 (해시 라우팅 #/w/문서명)
assets/css/                theme(색상 토큰) · layout · wiki(본문)
assets/js/app.js           라우터
assets/js/parser/          나무마크 파서
assets/js/components/      viewer, editor, history, diff, search, sidebar, footnote, pages
wiki/                      문서 원본 (.txt)
scripts/build_index.py     index.json 생성기
```
