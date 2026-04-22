import { useEffect, useState } from 'react';
import {
  onAuthStateChanged,
  GoogleAuthProvider,
  signInWithPopup,
  signOut,
  type User,
} from 'firebase/auth';
import { auth } from '../lib/firebase';
import { ensureUserProfile } from '../lib/functions';

export interface AuthState {
  user: User | null;
  loading: boolean;
  signingIn: boolean;
  error: string | null;
}

export function useAuth() {
  const [state, setState] = useState<AuthState>({
    user: null,
    loading: true,
    signingIn: false,
    error: null,
  });

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (u) => {
      if (u) {
        // Ensure backend profile exists (idempotent).
        try {
          await ensureUserProfile();
        } catch (err) {
          console.error('[outcome99] ensureUserProfile failed', err);
        }
      }
      setState((s) => ({ ...s, user: u, loading: false }));
    });
    return () => unsub();
  }, []);

  const login = async () => {
    setState((s) => ({ ...s, signingIn: true, error: null }));
    try {
      const provider = new GoogleAuthProvider();
      await signInWithPopup(auth, provider);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Sign-in failed';
      setState((s) => ({ ...s, signingIn: false, error: msg }));
    }
  };

  const logout = () => signOut(auth);

  return { ...state, login, logout };
}
