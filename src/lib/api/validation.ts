import "server-only";
import { NextResponse } from "next/server";



export type ValidationResult<T> =
  | { ok: true; value: T }
  | { ok: false; response: NextResponse };

export function validateEnum<T extends string>(
  value: unknown,
  allowed: readonly T[],
  field: string,
): ValidationResult<T> {
  if (typeof value !== "string" || !allowed.includes(value as T)) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: `${field} must be one of: ${allowed.join(", ")}` },
        { status: 400 },
      ),
    };
  }
  return { ok: true, value: value as T };
}

export function validateStringMap(
  body: unknown,
  allowedKeys: readonly string[],
): ValidationResult<Record<string, string>> {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: "Request body must be a JSON object" },
        { status: 400 },
      ),
    };
  }

  const obj = body as Record<string, unknown>;
  const result: Record<string, string> = {};

  for (const [key, value] of Object.entries(obj)) {
    if (!allowedKeys.includes(key)) {
      return {
        ok: false,
        response: NextResponse.json(
          {
            error: `Unknown config key: ${key}. Allowed keys: ${allowedKeys.join(", ")}`,
          },
          { status: 400 },
        ),
      };
    }

    if (value === null || value === undefined) {
      return {
        ok: false,
        response: NextResponse.json(
          { error: `Value for "${key}" must not be null or undefined` },
          { status: 400 },
        ),
      };
    }

    if (typeof value !== "string" && typeof value !== "number" && typeof value !== "boolean") {
      return {
        ok: false,
        response: NextResponse.json(
          { error: `Value for "${key}" must be string, number, or boolean` },
          { status: 400 },
        ),
      };
    }

    result[key] = String(value);
  }

  return { ok: true, value: result };
}

export function validateNumberInRange(
  value: unknown,
  min: number,
  max: number,
  field: string,
): ValidationResult<number> {
  const num = typeof value === "string" ? Number(value) : value;
  if (typeof num !== "number" || Number.isNaN(num) || num < min || num > max) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: `${field} must be a number between ${min} and ${max}` },
        { status: 400 },
      ),
    };
  }
  return { ok: true, value: num };
}
