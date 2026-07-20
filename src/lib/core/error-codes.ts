export enum ErrorCode {
  // ─── Gallery / Download ───
  /** Gallery or ZIP is already being downloaded or locked by another process. */
  ERR_ALREADY_DOWNLOADING = 'ERR_ALREADY_DOWNLOADING',
  /** Page not found (HTTP 404). */
  ERR_PAGE_NOT_FOUND = 'ERR_PAGE_NOT_FOUND',
  /** Content has been blocked by the target site. */
  ERR_CONTENT_BLOCKED = 'ERR_CONTENT_BLOCKED',
  /** All attempted domains failed to scrape. */
  ERR_ALL_DOMAINS_FAILED = 'ERR_ALL_DOMAINS_FAILED',
  /** Scrape completed but returned no usable content. */
  ERR_EMPTY_SCRAPE_RESULT = 'ERR_EMPTY_SCRAPE_RESULT',

  // ─── Authentication ───
  /** Login form not found on the page. */
  ERR_NO_LOGIN_FORM = 'ERR_NO_LOGIN_FORM',
  /** Login attempt failed. */
  ERR_LOGIN_FAILED = 'ERR_LOGIN_FAILED',
  /** No cookies obtained after login. */
  ERR_NO_COOKIE = 'ERR_NO_COOKIE',

  // ─── Search ───
  /** No valid keywords provided. */
  ERR_NO_KEYWORD = 'ERR_NO_KEYWORD',
  /** No valid title provided. */
  ERR_NO_TITLE = 'ERR_NO_TITLE',
  /** No M3U8 URL found in the scraped page. */
  ERR_NO_M3U8 = 'ERR_NO_M3U8',

  // ─── Download ───
  /** No available download URL. */
  ERR_NO_DOWNLOAD_URL = 'ERR_NO_DOWNLOAD_URL',
  /** Redirect / intermediate-page resolution depth exceeded. */
  ERR_REDIRECT_DEPTH = 'ERR_REDIRECT_DEPTH',
  /** No download link found on the page. */
  ERR_NO_DOWNLOAD_LINK = 'ERR_NO_DOWNLOAD_LINK',

  // ─── System ───
  /** Unregistered slot type encountered. */
  ERR_UNKNOWN_SLOT_TYPE = 'ERR_UNKNOWN_SLOT_TYPE',
}

/**
 * Application error with a structured error code.
 *
 * Use this instead of `throw new Error("hardcoded message")` so that API
 * routes can inspect `error.code` rather than matching on `message.includes(...)`.
 */
export class AppError extends Error {
  public readonly code: ErrorCode;

  constructor(code: ErrorCode, message: string) {
    super(message);
    this.code = code;
    this.name = 'AppError';
  }
}

/**
 * Type guard: returns `true` if the error is an `AppError` instance.
 */
export function isAppError(error: unknown): error is AppError {
  return error instanceof AppError;
}

/**
 * Extracts the `ErrorCode` from an arbitrary error, returning `null` for
 * non-`AppError` instances (backward-compatible with legacy `Error` throws).
 */
export function getErrorCode(error: unknown): ErrorCode | null {
  if (error instanceof AppError) {
    return error.code;
  }
  return null;
}