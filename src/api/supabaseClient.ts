import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = 'https://zcmbcqixstacgoqiowif.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable__Zu1Z7DehZCZR-gpjhZciA_RXxuJQSV';

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
