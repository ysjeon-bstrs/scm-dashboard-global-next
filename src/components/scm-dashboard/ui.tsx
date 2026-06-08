import type { ReactNode } from "react";

export type Tone = "neutral" | "brand" | "ok" | "warn" | "danger";

const TONE_TEXT: Record<Tone, string> = {
  neutral: "text-ink",
  brand: "text-brand-ink",
  ok: "text-ok-ink",
  warn: "text-warn-ink",
  danger: "text-danger",
};

/** Compact Boosters SCM monogram — stacked inventory layers. */
export function BrandMark({ className = "" }: { className?: string }) {
  return (
    <span
      aria-hidden
      className={`inline-grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-brand-strong shadow-sm ${className}`}
    >
      <svg
        fill="none"
        height="19"
        viewBox="0 0 20 20"
        width="19"
        xmlns="http://www.w3.org/2000/svg"
      >
        <path
          d="M10 2.5 17 6l-7 3.5L3 6l7-3.5Z"
          stroke="var(--color-on-brand)"
          strokeLinejoin="round"
          strokeWidth="1.5"
        />
        <path
          d="M3 10l7 3.5L17 10"
          stroke="var(--color-on-brand)"
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth="1.5"
          opacity="0.7"
        />
        <path
          d="M3 14l7 3.5L17 14"
          stroke="var(--color-on-brand)"
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth="1.5"
          opacity="0.45"
        />
      </svg>
    </span>
  );
}

interface PageHeaderProps {
  eyebrow: string;
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
}

export function PageHeader({
  eyebrow,
  title,
  description,
  actions,
}: PageHeaderProps) {
  return (
    <header className="flex flex-col gap-4 border-b border-line pb-5 md:flex-row md:items-start md:justify-between">
      <div className="flex items-start gap-3.5">
        <BrandMark />
        <div className="min-w-0">
          <p className="eyebrow">{eyebrow}</p>
          <h1 className="mt-1.5 text-[1.7rem] leading-tight font-semibold tracking-tight text-ink sm:text-[2rem]">
            {title}
          </h1>
          {description ? (
            <p className="mt-2 max-w-2xl text-sm leading-6 text-muted">
              {description}
            </p>
          ) : null}
        </div>
      </div>
      {actions ? (
        <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>
      ) : null}
    </header>
  );
}

export function Panel({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string;
}) {
  return <section className={`panel p-4 sm:p-5 ${className}`}>{children}</section>;
}

/**
 * Bleeds an AG Grid to the panel edges so the table reads as the panel's
 * content rather than a nested box. Pair with a PanelHeader above it.
 */
export function GridFrame({
  height,
  children,
}: {
  height: number;
  children: ReactNode;
}) {
  return (
    <div className="overflow-hidden rounded-xl border border-line">
      <div className="ag-theme-quartz w-full" style={{ height }}>
        {children}
      </div>
    </div>
  );
}

interface PanelHeaderProps {
  title: ReactNode;
  meta?: ReactNode;
  eyebrow?: string;
}

export function PanelHeader({ title, meta, eyebrow }: PanelHeaderProps) {
  return (
    <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
      <div>
        {eyebrow ? <p className="eyebrow">{eyebrow}</p> : null}
        <h2 className="text-[0.95rem] font-semibold text-ink">{title}</h2>
      </div>
      {meta != null ? (
        <span className="text-xs font-medium tabular-nums text-faint">{meta}</span>
      ) : null}
    </div>
  );
}

export function StatusPill({
  tone = "neutral",
  children,
}: {
  tone?: Tone;
  children: ReactNode;
}) {
  return (
    <span className={`pill pill-${tone}`}>
      <span className="h-1.5 w-1.5 rounded-full bg-current opacity-70" />
      {children}
    </span>
  );
}

interface StatProps {
  label: string;
  value: ReactNode;
  tone?: Tone;
  hint?: ReactNode;
}

export function Stat({ label, value, tone = "neutral", hint }: StatProps) {
  return (
    <div>
      <p className="field-label">{label}</p>
      <p
        className={`mt-2 text-[1.75rem] leading-none font-semibold tracking-tight tabular-nums ${TONE_TEXT[tone]}`}
      >
        {value}
      </p>
      {hint ? <p className="mt-1.5 text-xs text-faint">{hint}</p> : null}
    </div>
  );
}

/** Collapsible panel (native details) for secondary content like raw rows. */
export function Collapsible({
  title,
  meta,
  defaultOpen = false,
  children,
}: {
  title: ReactNode;
  meta?: ReactNode;
  defaultOpen?: boolean;
  children: ReactNode;
}) {
  return (
    <details className="panel group overflow-hidden" open={defaultOpen}>
      <summary className="flex cursor-pointer list-none items-center justify-between gap-3 p-4 select-none sm:p-5 [&::-webkit-details-marker]:hidden">
        <span className="flex items-center gap-2.5">
          <svg
            aria-hidden
            className="text-faint transition-transform duration-200 group-open:rotate-90"
            fill="none"
            height="14"
            viewBox="0 0 16 16"
            width="14"
          >
            <path
              d="M6 4l4 4-4 4"
              stroke="currentColor"
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth="1.8"
            />
          </svg>
          <span className="text-[0.95rem] font-semibold text-ink">{title}</span>
        </span>
        {meta != null ? (
          <span className="text-xs font-medium tabular-nums text-faint">{meta}</span>
        ) : null}
      </summary>
      <div className="border-t border-line p-4 sm:p-5">{children}</div>
    </details>
  );
}

/** Banner for notices / errors. */
export function Banner({
  tone = "brand",
  children,
}: {
  tone?: "brand" | "ok" | "warn" | "danger";
  children: ReactNode;
}) {
  const styles: Record<string, string> = {
    brand: "bg-brand-soft text-brand-ink",
    ok: "bg-ok-soft text-ok-ink",
    warn: "bg-warn-soft text-warn-ink",
    danger: "bg-danger-soft text-danger-ink",
  };
  return (
    <div
      className={`flex items-start gap-2.5 rounded-xl px-3.5 py-3 text-sm ${styles[tone]}`}
    >
      <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-current opacity-70" />
      <p className="leading-6">{children}</p>
    </div>
  );
}
