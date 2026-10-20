#!/usr/bin/env python3
"""wiki/ 폴더의 문서를 스캔해 wiki/index.json을 만든다.

- 문서 목록, 역링크, 분류, 검색용 본문 텍스트
- git 기록이 있으면 문서별 역사와 최근 변경 목록 (없으면 파일 수정 시각)

GitHub Actions 배포 시 자동 실행되며, 로컬 미리보기 전에도 한 번 실행하면 된다.
"""

from __future__ import annotations

import json
import re
import subprocess
import unicodedata
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
WIKI = ROOT / "wiki"
OUTPUT = WIKI / "index.json"
NAMESPACES = {"틀", "분류", "파일"}
HISTORY_LIMIT = 30
RECENT_LIMIT = 100
TEXT_LIMIT = 3000

LINK_RE = re.compile(r"(?<!\\)\[\[(.+?)\]\]")
INCLUDE_RE = re.compile(r"(?<!\\)\[include\(([^,)]+)", re.IGNORECASE)
# {{{ 뒤에 이 패턴이 오면 코드가 아니라 서식/상자 블록 (안쪽 문법이 살아 있음)
MARKUP_BRACE_RE = re.compile(r"#!(wiki|folding)\b|#[^\s!,]+(,#[^\s,]+)?\s|[+-][1-5]\s")


def strip_code(src: str) -> str:
    """{{{ 코드 }}} 영역을 지워 예시 속 링크가 역링크·분류로 잡히지 않게 한다"""
    out = []
    i = 0
    while i < len(src):
        if src.startswith("{{{", i) and not MARKUP_BRACE_RE.match(src, i + 3):
            depth, j = 1, i + 3
            while j < len(src) and depth:
                if src.startswith("{{{", j):
                    depth, j = depth + 1, j + 3
                elif src.startswith("}}}", j):
                    depth, j = depth - 1, j + 3
                else:
                    j += 1
            if depth == 0:
                i = j
                continue
        out.append(src[i])
        i += 1
    return "".join(out)


def nfc(s: str) -> str:
    return unicodedata.normalize("NFC", s)


def path_to_title(rel: str) -> str | None:
    """'틀/멤버.txt' -> '틀:멤버', '나무.txt' -> '나무'"""
    rel = nfc(rel)
    if not rel.endswith(".txt"):
        return None
    parts = rel[: -len(".txt")].split("/")
    if len(parts) > 1 and parts[0] in NAMESPACES:
        return f"{parts[0]}:{'/'.join(parts[1:])}"
    return "/".join(parts)


def resolve_relative(target: str, current: str) -> str:
    if target.startswith("../"):
        parent = current.rsplit("/", 1)[0] if "/" in current else current
        rest = target[3:]
        return f"{parent}/{rest}" if rest else parent
    if target.startswith("/"):
        return current + target
    return target


def split_unescaped(s: str, ch: str) -> tuple[str, str | None]:
    i = 0
    while i < len(s):
        if s[i] == "\\":
            i += 2
            continue
        if s[i] == ch:
            return s[:i], s[i + 1 :]
        i += 1
    return s, None


def extract(title: str, src: str) -> tuple[list[str], list[str], list[str]]:
    src = strip_code(src)
    links: set[str] = set()
    categories: list[str] = []
    for m in LINK_RE.finditer(src):
        target, _ = split_unescaped(m.group(1), "|")
        target = re.sub(r"\\(.)", r"\1", target.strip())
        if re.match(r"https?://", target, re.IGNORECASE) or target.startswith("파일:"):
            continue
        if target.startswith("분류:"):
            name = target[3:].strip()
            if name and name not in categories:
                categories.append(name)
            continue
        target = target.lstrip(":").split("#", 1)[0].strip()
        target = resolve_relative(target, title)
        if target and target != title:
            links.add(target)
    includes = sorted({m.group(1).strip() for m in INCLUDE_RE.finditer(src)})
    return sorted(links), includes, categories


def plain_text(src: str) -> str:
    """검색용으로 문법 기호를 대략 걷어낸 본문"""
    s = re.sub(r"^##.*$", "", src, flags=re.MULTILINE)
    s = re.sub(r"\[include\([^)]*\)\]", "", s, flags=re.IGNORECASE)
    s = re.sub(r"\[\[(파일|분류):[^\]]*\]\]", "", s)
    s = re.sub(r"\[\[(?:[^\]|]*\|)?([^\]]*)\]\]", r"\1", s)
    s = re.sub(r"\[\*\S*\s?", "", s)
    s = re.sub(r"\{\{\{(?:#!\w+[^\n]*|#\S+|[+-]\d)?\s?", "", s)
    s = re.sub(r"\}\}\}|'''|''|~~|__|\^\^|,,|\|\||<[^>\n]{1,30}>|^=+#?\s*|\s*#?=+$", " ", s, flags=re.MULTILINE)
    s = re.sub(r"\[(목차|각주|br|tableofcontents|footnote)\]|\]", " ", s, flags=re.IGNORECASE)
    return re.sub(r"\s+", " ", s).strip()[:TEXT_LIMIT]


def git(*args: str) -> str | None:
    try:
        result = subprocess.run(
            ["git", "-c", "core.quotepath=off", *args],
            cwd=ROOT,
            capture_output=True,
            text=True,
            encoding="utf-8",
            check=True,
        )
    except (OSError, subprocess.CalledProcessError):
        return None
    return result.stdout


def read_git_log() -> list[dict]:
    """wiki/ 아래 .txt 변경 기록 (최신순). 각 항목은 커밋 1개 x 파일 1개."""
    out = git("log", "-M", "--name-status", "--format=%x1e%H%x1f%aI%x1f%an%x1f%s", "--", "wiki")
    if not out:
        return []
    entries = []
    for chunk in out.split("\x1e")[1:]:
        lines = chunk.strip("\n").split("\n")
        sha, date, author, message = (lines[0].split("\x1f") + ["", "", "", ""])[:4]
        for line in lines[1:]:
            cols = line.split("\t")
            if len(cols) < 2:
                continue
            status = cols[0][0]
            path = cols[-1]
            if not path.startswith("wiki/"):
                continue
            title = path_to_title(path[len("wiki/") :])
            if title is None:
                continue
            entries.append(
                {"title": title, "sha": sha, "date": date, "author": author, "message": message, "status": status}
            )
    return entries


def main() -> None:
    pages: dict[str, dict] = {}
    for file in sorted(WIKI.rglob("*.txt")):
        rel = file.relative_to(WIKI).as_posix()
        title = path_to_title(rel)
        if title is None:
            continue
        src = file.read_text(encoding="utf-8")
        links, includes, categories = extract(title, src)
        mtime = datetime.fromtimestamp(file.stat().st_mtime, tz=timezone.utc).isoformat(timespec="seconds")
        pages[title] = {
            "file": nfc(rel),
            "updated": mtime,
            "author": None,
            "size": len(src.encode("utf-8")),
            "links": links,
            "includes": includes,
            "categories": categories,
            "text": plain_text(src),
            "history": [],
        }

    log = read_git_log()
    for entry in log:
        page = pages.get(entry["title"])
        if page is None:
            continue
        if not page["history"]:
            page["updated"] = entry["date"]
            page["author"] = entry["author"]
        if len(page["history"]) < HISTORY_LIMIT:
            page["history"].append({k: entry[k] for k in ("sha", "date", "author", "message", "status")})

    backlinks: dict[str, list[dict]] = {}
    category_members: dict[str, list[str]] = {}
    for title, page in pages.items():
        for target in page["links"]:
            backlinks.setdefault(target, []).append({"from": title, "type": "link"})
        for target in page["includes"]:
            backlinks.setdefault(target, []).append({"from": title, "type": "include"})
        for cat in page["categories"]:
            category_members.setdefault(cat, []).append(title)
    for items in backlinks.values():
        items.sort(key=lambda x: x["from"])

    if log:
        recent = log[:RECENT_LIMIT]
    else:  # 커밋 전: 파일 수정 시각 기준
        recent = sorted(
            (
                {"title": t, "sha": "", "date": p["updated"], "author": "local", "message": "", "status": "M"}
                for t, p in pages.items()
            ),
            key=lambda x: x["date"],
            reverse=True,
        )[:RECENT_LIMIT]

    index = {
        "generated": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "pages": pages,
        "backlinks": backlinks,
        "categories": {k: sorted(v) for k, v in category_members.items()},
        "recent": recent,
    }
    OUTPUT.write_text(json.dumps(index, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    print(f"wiki/index.json: 문서 {len(pages)}개, 변경 기록 {len(log)}건")


if __name__ == "__main__":
    main()
