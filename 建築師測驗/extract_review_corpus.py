"""Extract local official question text for item-by-item explanation research.

Never edits source PDFs or the quiz bank. Figures remain in original PDFs.
"""
import json
import re
from pathlib import Path
import pdfplumber

APP = Path(__file__).resolve().parent
bank = json.loads((APP / 'bank.js').read_text(encoding='utf-8').split('=', 1)[1].strip().rstrip(';'))
result = []
for exam in bank['exams']:
    with pdfplumber.open(APP.parent / exam['paper']) as pdf:
        pages = [p.dedupe_chars() for p in pdf.pages]
        for question in exam['questions']:
            segments = []
            for page_no, top, bottom in question['parts']:
                page = pages[page_no - 1]
                segments.append(page.crop((0, top, page.width, bottom)).extract_text() or '')
            text = '\n'.join(segments)
            text = text.translate(str.maketrans('\ue18c\ue18d\ue18e\ue18f', 'ⒶⒷⒸⒹ'))
            start = re.search(rf"(?m)^\s*{question['number']}\s", text)
            if start:
                text = text[start.start():].lstrip()
            result.append({'id': f"{exam['key']}-{question['number']}",
                           'year': exam['year'], 'subject': exam['subject'],
                           'number': question['number'], 'text': text,
                           'accept': question['accept'], 'award': question.get('award', False),
                           'paper': exam['paper'], 'parts': question['parts'],
                           'hasFourOptionMarkers': all(text.count(c) == 1 for c in 'ⒶⒷⒸⒹ')})
    print(exam['key'], flush=True)
(APP / 'review-corpus.json').write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding='utf-8')
print(f'Extracted {len(result)} questions; figures must be read from source PDFs.')
