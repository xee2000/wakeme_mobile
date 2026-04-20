import { createClient } from '@supabase/supabase-js';

// TODO: .env 파일로 분리 필요
const SUPABASE_URL = process.env.SUPABASE_URL ?? 'https://YOUR_PROJECT.supabase.co';
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY ?? 'YOUR_ANON_KEY';

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
