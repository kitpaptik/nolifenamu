# Project Guidelines: nolifecrew Namuwiki

## Project Overview
- **Project Name:** nolifecrew Namuwiki (`nolifecrew` 친구들을 위한 전용 위키 서비스)
- **Goal:** 나무위키(Namuwiki)의 디자인, UI/UX, 핵심 기능들을 충실히 오마주하여 친구들 전용 위키 사이트 구축.

---

## Core Principles & Design System

### 1. Design & UI/UX Principles
- **Image-Driven Design:** 
  - 작업 폴더 내에 포함된 **예시 이미지/스크린샷들을 최우선적으로 참고**할 것.
  - 메인 컬러코드, 테마, 레이아웃, 폰트 비율, 요소간 간격(Padding/Margin), 아이콘 스타일 등은 이미지 분석을 통해 오리지널 나무위키 스킨(시드 스킨 등)의 느낌을 최대한 동일하게 구현할 것.
- **Responsive Layout:**
  - PC Desktop 버전을 기본으로 하되, 모바일 환경에서도 나무위키 특유의 가독성과 네비게이션이 유지되도록 모바일 반응형 디자인 적용.
- **Namuwiki Aesthetic:**
  - 특유의 상단 헤더, 검색창, 최근 변경 목록 Sidebar/Widget, 목차(TOC) 스타일, 인포박스(Infobox), 각주(Footnote) 스타일 정밀 구현.

---

## Key Features to Implement

1. **위키 문법 & 마크다운/파서 (Wiki Engine)**
   - 나무위키 특유의 문법 구현 또는 지원:
     - 목차 자동 생성 (`[목차]`, `[include(...)]` 등)
     - 각주 (`[* ...]`) 및 각주 호버/클릭 동작
     - 텍스트 취소선 (`~~...~~`), 볼드, 이탈릭, 글자 색상/크기 지정
     - 인포박스(틀) 및 표(Table) 스타일링
     - 내부 링크 (`[[문서명]]`, `[[문서명|표시텍스트]]`) 및 존재하지 않는 문서(빨간 링크) 처리

2. **문서 관리 (Document Management)**
   - 문서 조회, 작성, 수정, 역사(History/Diff), 역링크, 최근 변경(Recent Changes) 기능
   - 문서 토론(Discussion/Board) 기본 구조

3. **검색 & 네비게이션**
   - 실시간 문서 검색 및 자동완성
   - 상단 글로벌 검색바 및 내비게이션 바

---

## Technical Stack & Architecture Guidelines

- **Code Quality:**
  - 유지보수가 용이하도록 컴포넌트 단위 분리 (Header, Sidebar, WikiViewer, WikiEditor, Infobox, Footnote 등).
  - 타입 안정성(TypeScript 사용 권장) 및 깔끔한 코드 스타일 유지.
- **State Management:**
  - 위키 데이터, 최근 변경 내역, 문서 편집 이력 등을 효율적으로 관리할 수 있는 구조 설계.

---

## Instructions for Claude Code / Assistant

1. **UI/UX 판단 기준:** 
   - 디자인, 컬러 스킴, 레이아웃 상세 치수는 **작업 폴더 안의 예시 사진들을 직접 보고 분석하여 최우선으로 적용**할 것.
2. **개발 방식:**
   - 단계별로 커밋 및 테스트가 가능한 단위로 구현 진행.
   - 예시 사진과 나무위키 고유의 사용자 경험(UX)을 최대한 살려서 작성.