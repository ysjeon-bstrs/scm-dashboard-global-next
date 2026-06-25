export type LogisticsJobMode = "ocean" | "ground" | "send" | "air";

// Only the steps the live web routes actually emit. Sheet import/bootstrap runs via
// the admin CLI (scripts/etl/...), which logs raw JSON rather than this envelope.
export type LogisticsJobStep = "RECOMPUTE" | "VALIDATE";

export type LogisticsJobStatus =
  | "SUCCEEDED"
  | "SUCCEEDED_WITH_WARNINGS"
  | "FAILED"
  | "BLOCKED";

export type LogisticsJobMessage = {
  code: string;
  message: string;
  details?: unknown;
};

export type JobActionResponse<T> = {
  ok: boolean;
  etlRunId: string;
  mode: LogisticsJobMode;
  step: LogisticsJobStep;
  status: LogisticsJobStatus;
  summary: T;
  warnings: LogisticsJobMessage[];
  errors: LogisticsJobMessage[];
  generatedAt: string;
};

export function mapWarningsToStatus(
  warnings: LogisticsJobMessage[],
  errors: LogisticsJobMessage[],
): LogisticsJobStatus {
  if (errors.length > 0) return "FAILED";
  if (warnings.length > 0) return "SUCCEEDED_WITH_WARNINGS";
  return "SUCCEEDED";
}

export function buildJobActionResponse<T>(input: {
  etlRunId: string;
  mode: LogisticsJobMode;
  step: LogisticsJobStep;
  summary: T;
  warnings?: LogisticsJobMessage[];
  errors?: LogisticsJobMessage[];
  status?: LogisticsJobStatus;
}): JobActionResponse<T> {
  const warnings = input.warnings ?? [];
  const errors = input.errors ?? [];
  const status = input.status ?? mapWarningsToStatus(warnings, errors);

  return {
    ok: status !== "FAILED" && status !== "BLOCKED",
    etlRunId: input.etlRunId,
    mode: input.mode,
    step: input.step,
    status,
    summary: input.summary,
    warnings,
    errors,
    generatedAt: new Date().toISOString(),
  };
}

export function buildLogisticsEtlRunId(pipeline: string, date = new Date()) {
  const stamp = date.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
  return `${pipeline}_${stamp}`;
}
