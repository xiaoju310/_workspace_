"""Verify an explicitly written cause belongs to the questioned subject/action.
Ambiguous, implicit and cross-sentence inferences abstain rather than borrowing a cause.
"""
import re


def is_causal_question(query):
    return bool(re.search(r'为什么|为何|什么原因|因为什么|\bwhy\b', query, re.I))


def clean(text):
    return re.sub(r'[\s，,。.!！?？“”"\'、：:；;]', '', text.lower())


def subject_action(action, remainder):
    if re.search(r'不是|并非|没有|没|未|不', remainder):
        return False
    prefix = re.match(r'^(?:(?:会|要|就|便|又|才|决定|慢慢|悄悄|只好|于是|已经|正在|终于|立刻|马上|开始|曾经|也|都))*', remainder)[0]
    rest = remainder[len(prefix):]
    return rest.startswith(action[0]) and ordered(action, rest)


def ordered(needle, text):
    at = 0
    for char in needle:
        nxt = text.find(char, at)
        if nxt < 0 or nxt-at > 24:
            return False
        at = nxt+1
    return bool(needle)


def effects(text):
    for quote in re.split(r'[。.!！？?；;\n]+', text):
        quote = quote.strip()
        result = re.search(r'所以|因此|因而', quote)
        if result:
            yield quote, re.split(r'[，,]', quote[result.end():])[0]
            continue
        reason = re.search(r'因为|由于|为了|目的是', quote)
        if reason:
            before, after = quote[:reason.start()], quote[reason.end():]
            if re.search(r'[，,]\s*$', before):
                if not re.search(r'[，,]', after):
                    yield quote, re.split(r'[，,]', before.rstrip('，, '))[-1]
            else:
                parts = re.split(r'[，,]', after)
                if len(parts) >= 2 and not re.search(r'[，,]', before):
                    yield quote, (before+'，' if before else '')+'，'.join(parts[1:])
            continue
        because = re.search(r'\bbecause\b', quote, re.I)
        if because:
            before, after = quote[:because.start()].strip(), quote[because.end():]
            if before and ',' not in before:
                yield quote, before
            elif not before and ',' in after:
                yield quote, after.split(',')[1]


def supported_cause(query, text, book_text=None):
    if not is_causal_question(query):
        return None
    match = re.match(r'^(.*?)(?:为什么|为何|因为什么|是什么原因)(.*)$', re.sub(r'^[请问]+', '', query))
    subject, action = '', ''
    if match:
        subject = re.sub(r'(?:是|会|要)$', '', clean(match[1]))
        action = re.sub(r'(?:呢|呀|啊|吗)$', '', re.sub(r'^(?:会|要|就|能|会要)', '', clean(match[2])))
    else:
        action = re.sub(r'^.*?\bwhy\b\s*', '', query.lower())
        action = re.sub(r'\b(did|does|do|is|are|was|were|the|a|an)\b', '', action)
        action = re.sub('[^a-z0-9 ]', ' ', action).strip()
    if not action:
        return None
    subjects = [subject]
    if subject and re.fullmatch(r'[\u3400-\u9fff]+', subject):
        subjects.extend(re.findall(r'(?:有一[只个位名]|是一[只个位名])[^。！？\n]{0,12}?'+re.escape(subject)+r'([\u3400-\u9fff]{2,3})[，,。]', book_text or text))
    for quote, effect in effects(text):
        if match:
            clauses = re.split(r'[，,]', effect)
            for i, clause in enumerate(clauses):
                part = clean(clause)
                for name in subjects:
                    if not name and not re.search(r'不是|并非|没有|没|未|不', part) and ordered(action, part):
                        return quote
                    if name and i == 0 and name in part and subject_action(action, part[part.index(name)+len(name):]):
                        return quote
                    if name and i and name in clean(clauses[i-1]) and subject_action(action, part):
                        return quote
        else:
            if re.search(r"\b(?:not|never|no)\b|n['’]t", effect, re.I):
                continue
            tokens = re.findall(r'[a-z0-9]+', re.sub(r'\b(the|a|an)\b', '', effect.lower()))
            at = 0
            for word in action.split():
                try:
                    at = tokens.index(word, at)+1
                except ValueError:
                    break
            else:
                return quote
    return None
