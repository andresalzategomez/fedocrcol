import { useEffect, useState } from "react";
import { supabase } from "./supabase";

export interface Profile {
  id: string;
  role: "superadmin" | "admin" | "athlete";
  tenant_id: string | null;
  full_name: string | null;
}

interface SessionState {
  loading: boolean;
  email: string | null;
  profile: Profile | null;
}

/**
 * Carga la sesión actual de Supabase y el profile (rol + tenant_id).
 * Se refresca ante cambios de autenticación.
 */
export function useSession() {
  const [state, setState] = useState<SessionState>({ loading: true, email: null, profile: null });

  useEffect(() => {
    if (!supabase) {
      setState({ loading: false, email: null, profile: null });
      return;
    }
    let active = true;

    async function load() {
      const { data: { user } } = await supabase!.auth.getUser();
      if (!user) {
        if (active) setState({ loading: false, email: null, profile: null });
        return;
      }
      const { data: profile } = await supabase!
        .from("profiles")
        .select("id, role, tenant_id, full_name")
        .eq("id", user.id)
        .maybeSingle();
      if (active) setState({ loading: false, email: user.email ?? null, profile: (profile as Profile) ?? null });
    }

    load();
    const { data: sub } = supabase.auth.onAuthStateChange(() => load());
    return () => { active = false; sub.subscription.unsubscribe(); };
  }, []);

  async function signOut() {
    await supabase?.auth.signOut();
  }

  return { ...state, signOut };
}
