import { createClient } from '@supabase/supabase-js';
import { config } from './config';

// Server-only client. Uses the service role key, so this file must NEVER be
// imported from client components — only from API routes / server actions.
let _client: ReturnType<typeof createClient> | null = null;

// Next.js's App Router patches global fetch to build a Data Cache key for
// every call. It can't hash a raw Buffer/binary body (used by Storage
// uploads), which throws "Failed to generate cache key for ..." and aborts
// the request. Passing cache: 'no-store' explicitly skips that hashing path.
function noStoreFetch(input: RequestInfo | URL, init?: RequestInit) {
  return fetch(input, { ...init, cache: 'no-store' });
}

export function getSupabase() {
  if (!_client) {
    if (!config.supabaseUrl || !config.supabaseServiceRoleKey) {
      throw new Error('SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY are not set');
    }
    _client = createClient(config.supabaseUrl, config.supabaseServiceRoleKey, {
      auth: { persistSession: false },
      global: { fetch: noStoreFetch as typeof fetch },
    });
  }
  return _client;
}
