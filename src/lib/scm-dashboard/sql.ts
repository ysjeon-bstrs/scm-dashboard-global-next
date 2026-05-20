export function getSafeMysqlIdentifier(envName: string, fallback: string) {
  const value = process.env[envName] || fallback;

  if (!/^[A-Za-z0-9_]+$/.test(value)) {
    throw new Error(`Invalid MySQL identifier in ${envName}.`);
  }

  return value;
}

export function clampLimit(value: string | null, fallback = 20, max = 500) {
  const parsed = Number(value ?? fallback);

  if (!Number.isFinite(parsed) || parsed < 1) {
    return fallback;
  }

  return Math.min(Math.floor(parsed), max);
}
