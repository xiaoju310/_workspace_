/** Browser timestamps only: playback-start is NOT microphone-verified audible onset. */
export interface VoiceSample {
  id: string
  language: 'zh-CN' | 'en-US'
  stoppedAt: number | null
  asrCompletedAt: number | null
  requestStartedAt?: number
  answerAt?: number
  playbackAt?: number
  status: 'needs_confirmation' | 'recognition_failed' | 'requesting' | 'answer_ready' | 'request_failed' | 'playback_failed' | 'started' | 'cancelled'
}
export function summarizeVoiceSamples(samples: VoiceSample[]) {
  const completed = samples.filter(s => {
    if (s.status !== 'started' || s.stoppedAt === null || !Number.isFinite(s.stoppedAt) ||
        s.playbackAt === undefined || !Number.isFinite(s.playbackAt)) return false
    const stages = [s.stoppedAt, s.asrCompletedAt, s.requestStartedAt, s.answerAt, s.playbackAt]
      .filter((value): value is number => value !== null && value !== undefined)
    return stages.every((value, index) => Number.isFinite(value) && value >= 0 && (index === 0 || value >= stages[index - 1]))
  })
  const withinTwoSeconds = completed.filter(s => s.playbackAt! - s.stoppedAt! <= 2000).length
  return { total: samples.length, started: completed.length, withinTwoSeconds,
    ratio: samples.length ? withinTwoSeconds / samples.length : null,
    measurement: 'browser_playback_start_not_verified_audible_onset' as const }
}
