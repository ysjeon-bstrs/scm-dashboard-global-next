---
target: Amazon 보충 Action Center (/global/amazon)
total_score: 27
p0_count: 0
p1_count: 1
timestamp: 2026-07-02T03-07-21Z
slug: src-app-global-amazon-amazonstockclient-tsx
---
# critique — Amazon 보충 Action Center (/global/amazon)

Method: inline single-context (parallel sub-agent orphaned by turn interrupt; code + user screenshots + detector). Detector: clean ([]). Visual evidence: user screenshots.

## Design Health Score: 27/40 (Acceptable)
Visibility 3 · Match 3 · Control 3 · Consistency 3 · ErrorPrev 3 · Recognition 3 · Flexibility 2 · Aesthetic 2 · ErrorRecovery 3 · Help 2

## Priority Issues
- [P1] Triage tables have no column sort (AmazonStockClient.tsx:386). Operators can't prioritize by 권장발송/DOH across 30 rows x 12 cols. Fix: move to AG Grid ledger primitive (sort + left-align + consistency) or add sortable headers. cmd: layout.
- [P2] "이유" column repeats an identical sentence per row (:400,420). Noise, wastes width. Fix: reason code/icon + tooltip or show only when differs. cmd: clarify.
- [P2] KPI strip = 6 equal multi-color tiles (:320-327), color not rationed (red/green/blue/amber at once), near hero-metric. Fix: lead with 지금발송/권장발송 large, demote rest, color on action metrics only. cmd: layout/quieter.
- [P2] Jargon unexplained (DOH 7/30/90, Vel 7d, Pending FC, Fee risk). Fix: header tooltips/legend; collapse DOH to one primary + expand. cmd: clarify.
- [P3] Per-center summary shows only the selected center (:333-352) though titled 센터별. Fix: always aggregate all centers for the summary. cmd: harden.

## Anti-patterns
Right-aligned numeric columns diverge from the product's all-columns-left AG Grid rule; hand-rolled tables (no sort/virtualization) vs AG Grid on sibling pages.

## Persona red flags
Alex: no sort/shortcuts/export/bulk. Sam: loading pill lacks role=status/aria-live; abbreviation headers opaque to SR. Operator: 3 DOH columns ambiguous; identical 이유 gives no row differentiation.

## Strengths
Status pills with text labels (color not sole signal); tabular-nums numbers-lead; strong visibility (snapshot date, row/filter counts, empty/loading states); reuses shared primitives.
