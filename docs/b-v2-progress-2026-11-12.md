# B v2 progress, 2026-11-12

The desktop v2.0 task book replaces the earlier personal schedule for B. This
file records evidence, not a claim that planned dates were met.

| Planned item | Current evidence | Status |
|---|---|---|
| OCR and VLM on one self-created page | `sample-ocr-output.real.json`, `sample-page-output.real.json`, experiment log | Tested on synthetic input; authorized book pending |
| A/B/C video feasibility | Local AnimateDiff T2V and LTX I2V tests in experiment log; no cloud API or 2.5D six-second comparison | Partial; D3 gate unmet |
| 12-page bookpack, character/style sheets | `app.ai.bookpack` schema and validation CLI | Contract implemented; art and human review pending |
| L2 six-second clips and full film | One 256×256, nine-frame butterfly feasibility clip outside Git | Pending; prototype quality failed visual review |
| Automated video QC | `app.ai.qc_video` and CLI | Technical precheck implemented; identity and artifact review pending |
| Narration, subtitles, timeline, repro pack | Existing basic concat/timeline; new hash manifest | Partial; no final TTS, SRT, synchronized film, or full rerun |

Next P0 gates: obtain an authorized or self-created story page with known
provenance, make a reviewed 12-page bookpack, run LTX on a representative page
until identity and background pass, then generate page clips, narration,
subtitles, timeline and complete reproducibility records. Keep every generated
or degraded page labeled by its actual level. The plan's D9 acceptance of 12
L2 clips is not presently met.
