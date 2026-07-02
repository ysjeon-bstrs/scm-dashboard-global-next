---
name: SCM Dashboard Global Next
description: Portal-grade operations desk for Boosters supply-chain operators — light-first, number-first.
colors:
  brand: "#2563eb"
  brand-press: "#1e40af"
  brand-soft: "#dbeafe"
  brand-softer: "#eff6ff"
  brand-ink: "#1e40af"
  on-brand: "#ffffff"
  paper: "#f9fafb"
  surface: "#ffffff"
  sunken: "#f8fafc"
  line: "#e5e7eb"
  line-strong: "#cbd5e1"
  ink: "#111827"
  muted: "#374151"
  faint: "#6b7280"
  slate-structure: "#1e293b"
  ok: "#15803d"
  ok-soft: "#dcfce7"
  ok-ink: "#166534"
  warn: "#d97706"
  warn-soft: "#fef3c7"
  warn-ink: "#92400e"
  danger: "#b91c1c"
  danger-soft: "#fee2e2"
  danger-ink: "#991b1b"
typography:
  title:
    fontFamily: "Pretendard Variable, Pretendard, ui-sans-serif, system-ui, sans-serif"
    fontSize: "clamp(1.7rem, 4vw, 2rem)"
    fontWeight: 600
    lineHeight: 1.15
    letterSpacing: "-0.018em"
  metric:
    fontFamily: "Pretendard Variable, Pretendard, ui-sans-serif, system-ui, sans-serif"
    fontSize: "1.75rem"
    fontWeight: 600
    lineHeight: 1
    letterSpacing: "-0.01em"
    fontFeature: "tabular-nums"
  body:
    fontFamily: "Pretendard Variable, Pretendard, ui-sans-serif, system-ui, sans-serif"
    fontSize: "0.875rem"
    fontWeight: 400
    lineHeight: 1.5
  label:
    fontFamily: "Pretendard Variable, Pretendard, ui-sans-serif, system-ui, sans-serif"
    fontSize: "0.6875rem"
    fontWeight: 600
    letterSpacing: "0.04em"
  eyebrow:
    fontFamily: "Pretendard Variable, Pretendard, ui-sans-serif, system-ui, sans-serif"
    fontSize: "0.6875rem"
    fontWeight: 600
    letterSpacing: "0.08em"
  code:
    fontFamily: "SFMono-Regular, ui-monospace, JetBrains Mono, Consolas, monospace"
    fontSize: "0.75rem"
    fontWeight: 400
    letterSpacing: "-0.01em"
rounded:
  control: "0.5rem"
  panel: "0.75rem"
  pill: "9999px"
spacing:
  panel: "1.25rem"
  gap: "1rem"
components:
  button-primary:
    backgroundColor: "{colors.brand}"
    textColor: "{colors.on-brand}"
    rounded: "{rounded.control}"
    padding: "0 0.75rem"
    height: "2.25rem"
  button-primary-hover:
    backgroundColor: "{colors.brand-press}"
    textColor: "{colors.on-brand}"
  button-secondary:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    rounded: "{rounded.control}"
    padding: "0 0.75rem"
    height: "2.25rem"
  button-ghost:
    backgroundColor: "transparent"
    textColor: "{colors.muted}"
    rounded: "{rounded.control}"
  panel:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    rounded: "{rounded.panel}"
    padding: "1.25rem"
  field:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    rounded: "{rounded.control}"
    height: "2.25rem"
  pill-ok:
    backgroundColor: "{colors.ok-soft}"
    textColor: "{colors.ok-ink}"
    rounded: "{rounded.pill}"
  pill-warn:
    backgroundColor: "{colors.warn-soft}"
    textColor: "{colors.warn-ink}"
    rounded: "{rounded.pill}"
  pill-danger:
    backgroundColor: "{colors.danger-soft}"
    textColor: "{colors.danger-ink}"
    rounded: "{rounded.pill}"
---

# Design System: SCM Dashboard Global Next

## 1. Overview

**Creative North Star: "The Operations Desk"**

A quiet, number-first workbench for internal Boosters supply-chain operators. It is
light-first and read-heavy: operators scan lot/stock tables, upload request files,
confirm FEFO allocation, export WMS files, and read settlement marts, often for long
sessions. The interface behaves like a well-made instrument — legible numbers, clear
status, calm surfaces — and never like a marketing site. Confidence comes from
correctness made visible, not from effects.

The system is built on a portal blue accent over a near-neutral slate/gray canvas
(committed in hex, not OKLCH). Color is rationed: the blue brand marks the single
primary action, and the ok/warn/danger triad carries allocation and settlement state.
Everything else stays neutral so the numbers lead. Density is high but rhythmic —
grouping comes from spacing and weight, not from boxing everything into cards.

It explicitly rejects the generic admin look: slate-on-white templates, evenly sized
card grids, Inter/system-default type, purple-blue gradients, glassmorphism, and dark
mode with glowing accents.

**Key Characteristics:**
- Light-first (dark-theme tokens exist in CSS but are dormant; the shipped mode is light).
- Numbers are the content: tabular numerals, strong weight, generous size.
- One blue accent + a three-state status triad; neutrals never compete.
- Flush data ledgers (AG Grid Quartz) with **all columns left-aligned**.
- One subtle page-load entrance; reduced-motion safe.

## 2. Colors

A near-neutral slate canvas with a single portal-blue accent and a semantic status triad.

### Primary
- **Portal Blue** (`#2563eb`): the one brand accent — primary buttons, focus rings, links,
  selected rows, the eyebrow kicker. Deepens to **Blue Press** (`#1e40af`) on hover/active
  and as `brand-ink` for text on soft-blue fills. Soft fills **Blue Soft** (`#dbeafe`) and
  **Blue Softer** (`#eff6ff`) back pills and row hover.

### Secondary (semantic status)
- **Signal Green** (`#15803d`, ink `#166534`, soft `#dcfce7`): ok / allocated / analyzed.
- **Signal Amber** (`#d97706`, ink `#92400e`, soft `#fef3c7`): warning / attention.
- **Signal Red** (`#b91c1c`, ink `#991b1b`, soft `#fee2e2`): shortage / danger / failure.

### Neutral
- **Paper** (`#f9fafb`): page background. **Surface** (`#ffffff`): panel/card fills.
  **Sunken** (`#f8fafc`): table headers, insets, hover.
- **Ink** (`#111827`): primary text and quantities. **Muted** (`#374151`): secondary text.
  **Faint** (`#6b7280`): labels, hints, meta. **Slate Structure** (`#1e293b`): grid header text.
- **Line** (`#e5e7eb`) / **Line Strong** (`#cbd5e1`): borders, row rules, header underline.

### Named Rules
**The One Accent Rule.** Portal blue marks the single most important action or state on a
surface; if two things are blue, one is wrong. Its rarity is what makes it read.
**The Status-Is-Meaning Rule.** Green/amber/red appear only to communicate allocation or
settlement state — never decoratively — and always alongside a label or icon, never color alone.

## 3. Typography

**Body / Display Font:** Pretendard Variable (KO + EN), fallback `ui-sans-serif, system-ui, sans-serif`.
**Code Font:** SFMono-Regular / JetBrains Mono (fallback `ui-monospace, Consolas, monospace`).

**Character:** One humanist-leaning sans in multiple weights carries everything; monospace is
reserved for real machine codes. No decorative or paired display face — the numbers are the display.

### Hierarchy
- **Title** (600, `clamp(1.7rem–2rem)`, ls −0.018em): page headers (`PageHeader` h1); h1–h3 share the −0.018em tracking.
- **Metric** (600, `1.75rem`, line-height 1, tabular-nums): KPI/`Stat` values — the loudest element on any screen.
- **Body** (400, `0.875rem`, line-height 1.5): default text, table cells.
- **Label** (600, `0.6875rem`, ls 0.04em): field labels (`.field-label`), quiet and tinted `faint`.
- **Eyebrow** (600, `0.6875rem`, ls 0.08em, `brand`): the single kicker above a panel title.
- **Code** (`0.75rem`, mono, ls −0.01em): SKU / lot / BL numbers where monospace aids scanning.

### Named Rules
**The Numbers-Lead Rule.** Quantities always use tabular numerals and the strongest weight on
their row; labels stay small, tinted, and quiet. Never let a label out-shout its number.
**The Real-Codes-Only Rule.** Monospace is for actual identifiers (SKU, lot, BL) only — never for prose or labels.

## 4. Elevation

Flat by default with tonal layering, not stacked shadows. Depth comes from the paper→surface→sunken
tonal ramp and 1px lines. The only shadows are a whisper-soft panel lift and a slightly deeper pop
for transient overlays; there is no shadow scale beyond these two.

### Shadow Vocabulary
- **Panel** (`box-shadow: 0 1px 4px rgb(15 23 42 / 0.06)`): the resting lift on `.panel` surfaces.
- **Pop** (`box-shadow: 0 8px 24px rgb(15 23 42 / 0.12)`): dropdowns / popovers / transient overlays only.

### Named Rules
**The No-Nested-Panels Rule.** `.panel` is the single source of the "card" look; never put a panel
inside a panel. Group with spacing and headers instead.
**The Flush-Ledger Rule.** Data tables render edge-to-edge inside their panel — no wrapper frame,
no zebra stripes — just horizontal row rules and a strong header underline.

## 5. Components

### Buttons
- **Shape:** `0.5rem` radius (control), min height `2.25rem`, medium weight, 150ms transition.
- **Primary:** `brand` fill, `on-brand` text, subtle shadow; hover → `brand-press`. Rare — one per surface.
- **Secondary:** `surface` fill, `line` border, `ink` text; hover → `sunken`. The workhorse.
- **Ghost:** no fill, `muted` text; hover → `sunken` + `ink`. For low-emphasis actions.
- **Disabled:** primary drops to `sunken`/`faint` no-shadow; never looks clickable.

### Status pills
- **Style:** fully rounded (`9999px`), `0.75rem` semibold, soft-fill + matching ink per state
  (`neutral` sunken/muted, `brand`, `ok`, `warn`, `danger`). A leading dot reinforces state.
- Color is meaning: use the state that matches allocation/settlement, not decoration.

### Cards / Containers (`.panel`)
- **Corner:** `0.75rem` (panel). **Background:** `surface`. **Border:** 1px `line`. **Shadow:** Panel (resting).
- **Padding:** `1rem`–`1.25rem`. Never nested (see Elevation rules).

### Inputs / Fields (`.field`, `.input`)
- **Style:** 1px `line` border, `surface` fill, `0.5rem` radius, `faint` placeholder, subtle shadow.
- **Focus:** `brand` border + 2px `brand`/25% ring, no default outline.
- Global focus-visible is a 2px `brand` outline with 2px offset.

### Segmented selector (`.seg`)
- Outbound-type / warehouse switches: `seg-on` = `brand` fill + `on-brand`; `seg-off` = `line` border, `muted`, hover → `line-strong`/`ink`.

### AG Grid ledger (signature)
- Quartz theme rendered flush: transparent background, `sunken` header, `line` row rules, `line-strong`
  header underline, `brand` accent (hover `brand-softer`, selected `brand-soft`), 36px header / 38px rows,
  12px cells, slim tinted scrollbars. **All columns left-aligned** — the `.ag-right-aligned-cell` override
  forces numeric columns left while keeping numeric sorting, so mixed text/number grids scan cleanly.
  Cell accents: `cell-shortage` (danger, bold), `cell-allocated` (ok-ink, bold), `cell-code` (mono).

### Step marker (`.step-no`)
- 24px `brand-soft` circle with `brand-ink` bold tabular number — sequences a real multi-step flow only.

## 6. Do's and Don'ts

### Do:
- **Do** give every quantity tabular numerals and the strongest weight on its row (`Numbers-Lead Rule`).
- **Do** keep portal blue (`#2563eb`) to one action/state per surface (`One Accent Rule`).
- **Do** use `ok`/`warn`/`danger` only for real allocation/settlement state, paired with a label or icon.
- **Do** render tables flush inside a single `.panel`, all columns left-aligned, row rules only.
- **Do** bump body text toward `ink` for ≥4.5:1 contrast (incl. placeholders); large/bold ≥3:1.
- **Do** ship one subtle `rise` entrance, gated behind `prefers-reduced-motion: no-preference`.

### Don't:
- **Don't** nest `.panel` inside `.panel`, or build evenly-sized identical card grids.
- **Don't** use generic slate-on-white admin-template styling or Inter/system-default type.
- **Don't** use purple-blue gradients, gradient text, glassmorphism, or side-stripe (`border-left`) accents.
- **Don't** ship dark mode with glowing accents (dark tokens are dormant; the product is light-first).
- **Don't** right-align numeric grid columns (override to left) or add zebra striping to the ledger.
- **Don't** let color be the only signal for a decision, or let a label out-weight its number.
