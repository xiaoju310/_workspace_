/** Conservative explicit-cause verification. A cause word elsewhere on the page is not evidence. */
export function isCausalQuestion(query: string): boolean {
  return /为什么|为何|什么原因|因为什么|\bwhy\b/i.test(query)
}
const clean = (text: string) => text.toLowerCase().replace(/[\s，,。.!！?？“”"'、：:；;]/g, '')
function subjectAction(action:string, remainder:string):boolean {
  if(/不是|并非|没有|没|未|不/.test(remainder))return false
  const prefix=remainder.match(/^(?:(?:会|要|就|便|又|才|决定|慢慢|悄悄|只好|于是|已经|正在|终于|立刻|马上|开始|曾经|也|都))*/)?.[0]??''
  return remainder.slice(prefix.length).startsWith(action[0]) && ordered(action,remainder.slice(prefix.length))
}
function ordered(needle: string, text: string): boolean {
  let at = 0
  for (const ch of needle) {
    const next = text.indexOf(ch, at)
    if (next < 0 || next - at > 24) return false
    at = next + 1
  }
  return Boolean(needle)
}
export function causalEffects(text: string): { quote: string; effect: string }[] {
  const found: { quote: string; effect: string }[] = []
  for (const quote of text.split(/[。.!！？?；;\n]+/).map(s=>s.trim()).filter(Boolean)) {
    const result = quote.match(/所以|因此|因而/)
    if (result?.index !== undefined) {
      const effect = quote.slice(result.index + result[0].length).split(/[，,]/)[0]
      if (effect) found.push({quote,effect})
      continue
    }
    const reason = quote.match(/因为|由于|为了|目的是/)
    if (reason?.index !== undefined) {
      const before = quote.slice(0, reason.index)
      const after = quote.slice(reason.index + reason[0].length)
      if (/[，,]\s*$/.test(before)) {
        // "X acted, because ...". A second independent clause is too ambiguous.
        if (!/[，,]/.test(after)) found.push({quote,effect:before.split(/[，,]/).filter(Boolean).at(-1) ?? ''})
      } else {
        const parts = after.split(/[，,]/)
        if (parts.length >= 2 && !/[，,]/.test(before)) found.push({quote,effect:before ? before+'，'+parts.slice(1).join('，') : parts.slice(1).join('，')})
      }
      continue
    }
    const because = /\bbecause\b/i.exec(quote)
    if (because?.index !== undefined) {
      const before = quote.slice(0,because.index).trim()
      const after = quote.slice(because.index+because[0].length)
      if (before && !/[,]/.test(before)) found.push({quote,effect:before})
      else if (!before && after.includes(',')) found.push({quote,effect:after.split(',')[1]})
    }
  }
  return found
}
export function supportedCause(query: string, text: string, bookText = text): string | null {
  if (!isCausalQuestion(query)) return null
  let subject = '', action = ''
  const chinese = query.replace(/^[请问]+/, '').match(/^(.*?)(?:为什么|为何|因为什么|是什么原因)(.*)$/)
  if (chinese) {
    subject = clean(chinese[1]).replace(/(?:是|会|要)$/, '')
    action = clean(chinese[2]).replace(/^(?:会|要|就|能|会要)/, '').replace(/(?:呢|呀|啊|吗)$/, '')
  } else {
    action = query.toLowerCase().replace(/^.*?\bwhy\b\s*/, '').replace(/\b(did|does|do|is|are|was|were|the|a|an)\b/g,'').replace(/[^a-z0-9 ]/g,' ').trim()
  }
  if (!action) return null
  // A written introduction may establish a nickname; never infer identity from a model's answer.
  const subjects = [subject]
  if (subject && /^[\u3400-\u9fff]+$/.test(subject)) {
    const alias = new RegExp(`(?:有一[只个位名]|是一[只个位名])[^。！？\\n]{0,12}?${subject}([\\u3400-\\u9fff]{2,3})[，,。]`, 'g')
    for (const match of bookText.matchAll(alias)) subjects.push(match[1])
  }
  for (const pair of causalEffects(text)) {
    const effect = clean(pair.effect)
    if (chinese) {
      if (!subjects.some(s=>!s || effect.includes(s))) continue
      // Match the action after the explicit subject, not an action by somebody preceding it.
      const clauses=pair.effect.split(/[，,]/)
      if (clauses.some((clause,i)=>subjects.some(s=> {
        const part=clean(clause)
        if(!s)return !/不是|并非|没有|没|未|不/.test(part)&&ordered(action,part)
        if(i===0&&part.includes(s))return subjectAction(action,part.slice(part.indexOf(s)+s.length))
        // Explicit subject followed immediately by an omitted-subject action clause.
        return i>0 && clean(clauses[i-1]).includes(s) && subjectAction(action,part)
      })))return pair.quote
    } else {
      if(/\b(?:not|never|no)\b|n['’]t/i.test(pair.effect))continue
      const words = action.split(/\s+/).filter(Boolean)
      const tokens: string[] = pair.effect.toLowerCase().replace(/\b(the|a|an)\b/g,'').match(/[a-z0-9]+/g) ?? []
      let at=0
      if (words.every(w=>{const i=tokens.indexOf(w,at);if(i<0)return false;at=i+1;return true})) return pair.quote
    }
  }
  return null
}
