export function parseJsonColumn<TValue>(value: unknown, fallback: TValue): TValue {
  if (typeof value !== "string" || value.length === 0) {
    return fallback;
  }

  try {
    return JSON.parse(value) as TValue;
  } catch {
    return fallback;
  }
}

export function serializeJsonColumn(value: unknown): string {
  return JSON.stringify(value);
}

export function toNullableString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}
