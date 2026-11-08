// Shared app state: who is acting, the labels and rules loaded once, the current page, and messages.
// Pages read it with useApp(). Keeping it in one small context avoids passing props through every level.

import { createContext, useContext } from 'react';
import type { Bootstrap, Person } from './types';

/** A page in the app, from the URL hash: #/queue, #/cases, #/cases/UC-1001, #/new, #/tools, #/tools/T-1001, #/outbox, #/audit, #/audit/UC-1012, #/training, #/dash, #/rules. */
export interface Route { page: string; id?: string }

export const parseHash = (hash: string): Route => {
  const [page, id] = hash.replace(/^#\/?/, '').split('/');
  return { page: page || 'queue', id: id ? decodeURIComponent(id) : undefined };
};

export const go = (page: string, id?: string) => { window.location.hash = '/' + page + (id ? '/' + encodeURIComponent(id) : ''); };

export interface AppState {
  boot: Bootstrap;
  me: Person;
  /** Bumped after every change, so lists and counts reload. */
  version: number;
  changed: () => void;
  /** Load the people, rules and labels again, after the rules are saved. */
  reloadBoot: () => void;
  toast: (text: string, bad?: boolean) => void;
  person: (id?: string | null) => Person | undefined;
  name: (id?: string | null) => string;
}

export const AppContext = createContext<AppState | null>(null);

export const useApp = (): AppState => {
  const s = useContext(AppContext);
  if (!s) throw new Error('useApp must be used inside <App>.');
  return s;
};
