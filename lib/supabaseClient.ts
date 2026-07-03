import { createClient } from '@supabase/supabase-js';
import { config } from './config';

// Server-only client. Uses the service role key, so this file must NEVER be
// imported from client components — only from API routes / server actions.
let _client: ReturnType<typeof createClient> | null = null;

export function getSupabase() {
  if (!_client) {
    if (!config.supabaseUrl || !config.supabaseServiceRoleKey) {
      throw new Error('SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY are not set');
    }
    _client = createClient(config.supabaseUrl, config.supabaseServiceRoleKey, {
      auth: { persistSession: false },
    });
  }
  return _client;
}
