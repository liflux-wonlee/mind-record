import { FunctionsFetchError, FunctionsHttpError } from '@supabase/supabase-js';

/** Name given to errors that never reached the function (offline, DNS,
 *  timeout) -- the only kind worth retrying blindly. */
export const NETWORK_ERROR_NAME = 'NetworkError';

export function isNetworkError(e: unknown): boolean {
  return e instanceof Error && e.name === NETWORK_ERROR_NAME;
}

/** The machine-readable `code` an Edge Function put next to its `error` text (e.g. converse's 'turn_busy'), if any. */
export function functionErrorCode(e: unknown): string | undefined {
  const code = e instanceof Error ? (e as Error & { code?: unknown }).code : undefined;
  return typeof code === 'string' ? code : undefined;
}

/**
 * supabase-js's FunctionsHttpError.message is just the generic "Edge
 * Function returned a non-2xx status code" -- the Edge Function's own JSON
 * error body (`{ error: "..." }`) is on `error.context`, a Response object
 * that has to be read separately or it's silently lost. Shared by every
 * service that invokes an Edge Function (process-session, converse, ...).
 */
export async function describeFunctionError(error: unknown, fallback: string): Promise<Error> {
  if (error instanceof FunctionsFetchError) {
    // error.context is the ORIGINAL fetch rejection (e.g. a native
    // "Network request failed" TypeError) -- this used to be discarded
    // entirely in favor of a fixed generic message, which made a real
    // on-device failure undiagnosable from the alert/log alone (just
    // "NetworkError" with no indication of what actually happened, even
    // though the underlying reason was sitting right here the whole time).
    const underlying = error.context;
    const detail =
      underlying instanceof Error ? underlying.message : typeof underlying === 'string' ? underlying : undefined;
    const e = new Error(
      detail
        ? `No connection. Check your network and try again. (${detail})`
        : 'No connection. Check your network and try again.'
    );
    e.name = NETWORK_ERROR_NAME;
    if (underlying instanceof Error) e.cause = underlying;
    return e;
  }
  if (error instanceof FunctionsHttpError) {
    const status = error.context.status;
    try {
      const body = await error.context.json();
      if (typeof body?.error === 'string') {
        const e: Error & { code?: string } = new Error(body.error);
        if (typeof body.code === 'string') e.code = body.code;
        return e;
      }
      // Supabase's own gateway errors (e.g. 404 "Requested function was not
      // found" when a function was never deployed) use `message`, not `error`.
      if (typeof body?.message === 'string') return new Error(`${body.message} (HTTP ${status})`);
    } catch {
      // Response body wasn't JSON (or already consumed) -- fall through.
    }
    return new Error(`${fallback} (HTTP ${status})`);
  }
  return error instanceof Error ? error : new Error(fallback);
}
