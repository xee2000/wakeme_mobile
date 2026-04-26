import { create } from 'zustand';
import { MMKV } from 'react-native-mmkv';
import { User } from '../types';

const storage = new MMKV({ id: 'auth' });
const USER_KEY = 'wakeme_user';

interface AuthState {
  user: User | null;
  isLoggedIn: boolean;
  setUser: (user: User) => void;
  logout: () => void;
}

export function loadPersistedUser(): User | null {
  const raw = storage.getString(USER_KEY);
  if (!raw) return null;
  try { return JSON.parse(raw); } catch { return null; }
}

export const useAuthStore = create<AuthState>(set => ({
  user: loadPersistedUser(),
  isLoggedIn: !!loadPersistedUser(),

  setUser: (user: User) => {
    storage.set(USER_KEY, JSON.stringify(user));
    set({ user, isLoggedIn: true });
  },

  logout: () => {
    storage.delete(USER_KEY);
    set({ user: null, isLoggedIn: false });
  },
}));
