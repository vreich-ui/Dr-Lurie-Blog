const WIDGET_CDN_URL = 'https://identity.netlify.com/v1/netlify-identity-widget.js';

export type NetlifyIdentityUser = {
  id: string;
  email: string;
  user_metadata?: { full_name?: string; [key: string]: unknown };
  app_metadata?: { roles?: string[]; provider?: string; [key: string]: unknown };
  token?: {
    access_token?: string;
    refresh_token?: string;
    expires_at?: number;
  };
};

export type NetlifyIdentity = {
  currentUser: () => NetlifyIdentityUser | null;
  open: (tab?: 'login' | 'signup') => void;
  close: () => void;
  logout: () => Promise<void>;
  init: (opts?: { APIUrl?: string; logo?: boolean }) => void;
  on: (
    event: 'init' | 'login' | 'logout' | 'error' | 'open' | 'close',
    cb: (userOrError?: NetlifyIdentityUser | Error) => void
  ) => void;
  off: (event: string, cb?: (...args: unknown[]) => void) => void;
};

type IdentityWindow = Window & { netlifyIdentity?: NetlifyIdentity };

const getIdentityWindow = () => window as IdentityWindow;

let loadPromise: Promise<NetlifyIdentity> | undefined;

export const loadNetlifyIdentity = (opts?: { APIUrl?: string }): Promise<NetlifyIdentity> => {
  loadPromise ||= new Promise<NetlifyIdentity>((resolve, reject) => {
    const existing = getIdentityWindow().netlifyIdentity;
    if (existing) {
      existing.init(opts);
      resolve(existing);
      return;
    }

    const script = document.createElement('script');
    script.src = WIDGET_CDN_URL;
    script.async = true;
    script.addEventListener('load', () => {
      const identity = getIdentityWindow().netlifyIdentity;
      if (!identity) {
        reject(new Error('Netlify Identity Widget could not be initialized.'));
        return;
      }
      identity.init(opts);
      resolve(identity);
    });
    script.addEventListener('error', () => reject(new Error('Netlify Identity Widget could not be loaded.')));
    document.head.append(script);
  });

  return loadPromise;
};
