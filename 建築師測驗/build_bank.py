"""Build the offline quiz bank from the original MOEX PDFs in the workspace."""
import json
import re
import unicodedata
from pathlib import Path

import pdfplumber
import pypdfium2

APP = Path(__file__).resolve().parent
ARCHIVE = APP.parent / "建築師歷年考題"
SUBJECTS = {"law": "營建法規與實務", "build": "建築構造與施工"}
LETTERS = "ABCD"
MARKERS = "\ue18c\ue18d\ue18e\ue18f"


def official_answers(path):
    with pdfplumber.open(path) as doc:
        text = "\n".join(page.extract_text() for page in doc.pages)
    text = unicodedata.normalize("NFKC", text)
    result = {}
    for row in re.finditer(r"^題\s*[序號] +([^\n]+)\n答\s*案 *([^\n]*)", text, re.M):
        numbers = re.findall(r"\d+", row[1])
        values = row[2].split()
        if values:
            assert len(values) <= len(numbers) and all(v in (*LETTERS, "#") for v in values), path
            result.update({int(n): {"accept": [v]} for n, v in zip(numbers, values)})
    notes = re.split(r"備\s*註\s*:", text, maxsplit=1)
    if len(notes) > 1:
        compact = re.sub(r"\s+", "", notes[1])
        for note in re.finditer(r"第(\d+)題([^,。;]+)", compact):
            n = int(note[1])
            if n not in result or result[n]["accept"] != ["#"]:
                continue
            if "一律給分" in note[2]:
                result[n] = {"accept": [], "award": True, "notice": "考選部公告本題一律給分。"}
            else:
                match = re.fullmatch(r"答([A-D]+(?:或[A-D]+)*)(?:者)?(?:均)?給分", note[2])
                assert match, (path, note[0])
                result[n] = {"accept": match[1].split("或"), "notice": note[0] + "。"}
    assert set(result) == set(range(1, 81)), (path, sorted(result))
    assert not any("#" in key["accept"] for key in result.values()), path
    return result


def question_layout(path):
    starts, pages = [], []
    with pdfplumber.open(path) as doc:
        for p, page in enumerate(doc.pages, 1):
            words = page.extract_words(x_tolerance=2)
            body = [w for w in words if w["top"] >= 73]
            pages.append((page.width, page.height, body))
            for w in body:
                if (w["text"] == str(len(starts) + 1)
                        and 30 < w["x0"] < 60 and w["bottom"] < page.height - 22):
                    starts.append((p, w["top"], w["x1"]))
            page.close()
    assert len(starts) == 80, (path, len(starts), starts[-5:])
    parts = []
    for i, (p, top, x) in enumerate(starts):
        next_page, next_top, _ = starts[i + 1] if i < 79 else (p, None, None)
        assert next_page - p <= 1, (path, i)
        width, height, words = pages[p - 1]
        segments = [(p, top - 4, next_top - 4 if p == next_page and next_top else height - 14)]
        if p != next_page:
            _, _, next_words = pages[next_page - 1]
            continuation = [w for w in next_words if 76 <= w["top"] < next_top - 7]
            if continuation:
                segments.append((next_page, min(w["top"] for w in continuation) - 4, next_top - 4))
        marks = []
        for page_no, y1, y2 in segments:
            for w in pages[page_no - 1][2]:
                if y1 <= w["top"] < y2:
                    marks.extend(c for c in w["text"] if c in MARKERS)
        if marks != list(MARKERS):
            print(f"Layout review {path.name} Q{i + 1}: {len(marks)} option marks", flush=True)
        parts.append([[p, round(top, 1), round(bottom, 1)] for p, top, bottom in segments])
    return pages, parts


def render_pages(path, dest, pages):
    dest.mkdir(parents=True, exist_ok=True)
    with pypdfium2.PdfDocument(path) as pdf:
        for p in range(len(pages)):
            output = dest / f"{p + 1}.webp"
            if output.exists():
                continue
            page = pdf[p]
            try:
                bitmap = page.render(scale=1.85, grayscale=True)
                try:
                    bitmap.to_pil().convert("RGB").save(output, "WEBP", quality=88)
                finally:
                    bitmap.close()
            finally:
                page.close()


def main():
    bank = []
    archive = []
    for subject, name in SUBJECTS.items():
        folder = ARCHIVE / name
        for path in sorted(folder.glob("*_試題.pdf")):
            prefix = path.name.split("年")[0]
            year = int(prefix)
            paper = path.relative_to(APP.parent).as_posix()
            if year < 97:
                archive.append({"year": year, "subject": subject, "paper": paper})
                continue
            answer, = folder.glob(f"{prefix}年*答案.pdf")
            scores = official_answers(answer)
            key = f"{subject}-{year}"
            pages, questions = question_layout(path)
            render_pages(path, APP / "pages" / key, pages)
            bank.append({
                "key": key, "year": year, "subject": subject, "paper": paper,
                "answer": answer.relative_to(APP.parent).as_posix(),
                "sizes": [[round(w, 2), round(h, 2)] for w, h, _ in pages],
                "questions": [{"number": n, "parts": parts, **scores[n]}
                              for n, parts in enumerate(questions, 1)],
            })
            print(f"{key}: {len(questions)} questions / {len(pages)} pages", flush=True)
    assert len(bank) == 36 and len(archive) == 32
    (APP / "bank.js").write_text(
        "window.EXAM_DATA = " + json.dumps({"exams": bank, "archive": archive},
                                            ensure_ascii=False, separators=(",", ":")) + ";\n",
        encoding="utf-8",
    )


if __name__ == "__main__":
    main()
