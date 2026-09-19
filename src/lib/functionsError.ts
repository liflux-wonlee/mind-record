import { FunctionsHttpError } from '@supabase/supabase-js';

/**
 * supabase-js's FunctionsHttpError.message is just the generic "Edge
 * Function returned a non-2xx status code" -- the Edge Function's own JSON
 * error body (`{ error: "..." }`) is on `error.context`, a Response object
 * that has to be read separately or it's silently lost. Shared by every
 * service that invokes an Edge Function (process-session, converse, ...).
 */
export async function describeFunctionError(error: unknown, fallback: string): Promise<Error> {
  if (error instanceof FunctionsHttpError) {
    const status = error.context.status;
    try {
      const body = await error.context.json();
      if (typeof body?.error === 'string') return new Error(body.error);
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
