# Product

## Register

product

## Users

Internal Boosters supply-chain operators (boosters.kr Google accounts only). They
work in this tool daily to read inventory snapshots, track inbound/outbound
logistics, run FEFO lot allocation against company stock, and review logistics
settlement. Sessions are task-focused: scan a lot/stock table, upload a request
file, confirm allocation, export a WMS file; or read a settlement mart. The
interface is read-heavy and number-heavy — accuracy and fast scanning matter far
more than decoration.

## Product Purpose

Migrate Boosters' Streamlit SCM dashboards to a faster, more legible Next.js app
spanning multiple warehouses (CJ US, 디자인KR, Amazon FBA, AcrossB NL/UK) and ocean
logistics settlement. It reads company SCM data (read-only MySQL) and Supabase
marts and turns them into operator workbenches. Success = operators trust the
numbers and finish their task (read stock, allocate lots, export the correct WMS
file, review settlement) faster and with fewer errors than the old tool.

## Brand Personality

Trustworthy and precise — three words: **calm, exact, dependable**. It should feel
like a well-made instrument, not a marketing site. Confidence comes from legible
numbers, clear status, and quiet surfaces — never from flashy effects. It reads as
"someone who cares about correctness built this."

## Anti-references

Generic slate-on-white admin templates; evenly-distributed same-size card grids;
Inter / system-default type; purple-blue gradients; glassmorphism; dark mode with
glowing accents; dashboards that decorate instead of making the numbers legible.

## Design Principles

1. **Numbers lead.** Quantities are the content — give them the strongest weight and
   size and tabular numerals; labels stay quiet (small, tinted).
2. **Status is meaning; everything else is neutral.** Color carries decisions (action,
   and ok / warn / shortage-or-danger state); neutral surfaces never compete with it.
3. **Rationed color over a neutral canvas.** A near-neutral slate/gray surface with one
   portal-blue accent and a green/amber/red status triad; color is rare so the numbers
   lead (concrete tokens in DESIGN.md).
4. **Hierarchy through rhythm, not boxes.** Group meaning with spacing and weight;
   avoid nesting cards in cards or repeating identical containers.
5. **Correctness is visible.** Surface truncation, shortages, stale/blocked states, and
   validation results plainly; never let a partial or stale result look complete.

## Accessibility & Inclusion

Target **WCAG AA**. Body text (incl. placeholders) ≥ 4.5:1; large/bold text ≥ 3:1 —
bump body toward ink rather than shipping light-gray-on-tint. Light-first (dark-theme
tokens exist in CSS but are dormant). Every animation has a `prefers-reduced-motion`
alternative (crossfade or instant). Status
that drives a decision is never color-only — pair it with a label, icon, or text.
