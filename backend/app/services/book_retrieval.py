"""Bounded, deterministic whole-book retrieval; never invents missing OCR."""
import json
import math
import re
from collections import Counter


def tokens(text):
    text = text.casefold()
    words = re.findall(r"[a-z0-9]+", text)
    for sequence in re.findall(r"[\u3400-\u9fff]+", text):
        words.extend(sequence[i:i+2] for i in range(len(sequence)-1))
        if len(sequence) == 1:
            words.append(sequence)
    return Counter(words)


def retrieve(pages, meanings, question, current_page=None, limit=12):
    visuals = {v['page_no']: v for v in meanings}
    docs = []
    for page in pages:
        ocr = json.loads(page.get('ocr_json') or '{}')
        text = str(ocr.get('text') or '')
        visual = visuals.get(page['page_no'])
        search_text = text + (' ' + json.dumps(visual, ensure_ascii=False) if visual else '')
        docs.append((page['page_no'], text, visual, tokens(search_text)))
    query = tokens(question)
    frequencies = Counter(t for _, _, _, ts in docs for t in ts)
    average = sum(sum(d[3].values()) for d in docs) / max(1, len(docs)) or 1
    explicit = {int(n) for n in re.findall(r'第\s*(\d+)\s*页', question)}
    scored = []
    for number, text, visual, ts in docs:
        length = sum(ts.values())
        score = sum(math.log(1+(len(docs)-frequencies[t]+.5)/(frequencies[t]+.5)) *
                    (ts[t]*2.2)/(ts[t]+1.2*(.25+.75*length/average)) for t in query if ts[t])
        scored.append((number in explicit, score, number == current_page, number, text, visual))
    # Explicit references first; one current-page context slot, then relevant pages anywhere in the book.
    ranked = sorted(scored, key=lambda d: (-d[0], -d[1], -d[2], d[3]))
    chosen = ranked[:limit]
    if current_page is not None and not any(d[3] == current_page for d in chosen):
        context = next((d for d in ranked if d[3] == current_page), None)
        if context and chosen and not chosen[-1][0]:
            chosen[-1] = context
    material = []
    for _, _, _, number, text, visual in chosen:
        # Long individual pages: choose the most relevant passage rather than always the page opening.
        windows = [text[i:i+3000] for i in range(0, len(text), 2400)] or ['']
        excerpt = max(windows, key=lambda s: sum((tokens(s) & query).values()))
        material.append({'page_no': number, 'text': excerpt, 'visual': visual})
    return material, {'method': 'whole_book_bm25_v1', 'total_pages': len(docs),
                      'selected_page_nos': [d['page_no'] for d in material],
                      'limit': limit, 'explicit_page_nos': sorted(explicit),
                      'coverage': 'retrieved_passages_not_exhaustive'}
