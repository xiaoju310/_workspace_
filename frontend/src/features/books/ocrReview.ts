/** 只标记少量可疑独立行，不删字、不改写，也不判断它一定是错误。 */
export function findSuspectOcrLines(text: string) {
  return text.split(/\r?\n/).flatMap((line, index) => {
    const value = line.trim()
    const suspect = /^[●•○◦◆◇■□▲△★☆]+$/.test(value)
      || /^(?:[àáâäèéêëìíîïòóôöùúûü]|II|Il|lI)$/.test(value)
    return suspect ? [{ line: index + 1, text: value }] : []
  })
}

/** 不用高分表示“正确”；无分数也不能显示 NaN 或伪造 0 分。 */
export function ocrReferenceScore(score: number | null | undefined): string {
  return typeof score === 'number' && Number.isFinite(score) && score >= 0 && score <= 1
    ? `${Math.round(score * 100)} / 100` : '暂未提供'
}
