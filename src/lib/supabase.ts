import { createClient } from "@supabase/supabase-js";

const defaultUrl = "https://ydiinfqmgecemwdpidrb.supabase.co";
const defaultPublishableKey = "sb_publishable_tzNjtPS1hhbuKE-pKl7Ddw_dLhsjh-u";

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL?.trim() || defaultUrl;
const supabasePublishableKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY?.trim() || defaultPublishableKey;

export const supabase = createClient(supabaseUrl, supabasePublishableKey, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
  },
});
