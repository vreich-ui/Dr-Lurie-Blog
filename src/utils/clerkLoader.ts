export type Clerk = {
  addListener?: (listener: () => void) => void;
  isSignedIn?: boolean;
  load: () => Promise<unknown> | unknown;
  openSignIn?: () => Promise<unknown> | unknown;
  openUserProfile?: () => Promise<unknown> | unknown;
  redirectToSignIn?: (options?: { redirectUrl?: string }) => Promise<unknown> | unknown;
  session?: {
    getToken?: () => Promise<unknown>;
  };
  signOut?: () => Promise<unknown> | unknown;
  status?: string;
  user?: {
    firstName?: string | null;
    fullName?: string | null;
    primaryEmailAddress?: {
      emailAddress?: string | null;
    } | null;
  } | null;
};

type ClerkConstructor = new (publishableKey: string) => Clerk;
type ClerkGlobal = Clerk | ClerkConstructor;

type ClerkWindow = Window & {
  Clerk?: ClerkGlobal;
  __drLurieClerkLoadPromises?: Record<string, Promise<Clerk>>;
};

type LoadClerkOptions = {
  publishableKey: string;
  scriptSrc: string;
};

const SCRIPT_SELECTOR = 'script[data-dr-lurie-clerkjs="true"]';
const LOAD_ERROR_MESSAGE = 'Clerk authentication could not be loaded.';
const INIT_ERROR_MESSAGE = 'Clerk authentication could not be initialized.';

const getClerkWindow = () => window as ClerkWindow;

const getLoadPromiseKey = ({ publishableKey, scriptSrc }: LoadClerkOptions) => `${scriptSrc}::${publishableKey}`;

const isClerkConstructor = (clerk: ClerkGlobal): clerk is ClerkConstructor => typeof clerk === 'function';

const getLoadedClerk = (publishableKey: string): Clerk | undefined => {
  const clerkWindow = getClerkWindow();
  const clerk = clerkWindow.Clerk;

  if (!clerk) return undefined;

  if (isClerkConstructor(clerk)) {
    const clerkInstance = new clerk(publishableKey);
    clerkWindow.Clerk = clerkInstance;
    return clerkInstance;
  }

  return clerk;
};

const waitForClerkScript = ({ publishableKey, scriptSrc }: LoadClerkOptions) =>
  new Promise<void>((resolve, reject) => {
    if (getLoadedClerk(publishableKey)) {
      resolve();
      return;
    }

    const existingScript = document.querySelector<HTMLScriptElement>(`${SCRIPT_SELECTOR}, script[src="${scriptSrc}"]`);

    if (existingScript?.dataset.drLurieClerkjsLoaded === 'true') {
      if (getLoadedClerk(publishableKey)) {
        resolve();
        return;
      }

      reject(new Error(INIT_ERROR_MESSAGE));
      return;
    }

    const markScriptLoaded = (script: HTMLScriptElement) => {
      script.dataset.drLurieClerkjsLoaded = 'true';
    };

    const resolveWhenClerkExists = (script: HTMLScriptElement) => {
      markScriptLoaded(script);

      if (!getLoadedClerk(publishableKey)) {
        reject(new Error(INIT_ERROR_MESSAGE));
        return;
      }

      resolve();
    };

    const rejectOnScriptError = () => reject(new Error(LOAD_ERROR_MESSAGE));

    if (existingScript) {
      existingScript.addEventListener('load', () => resolveWhenClerkExists(existingScript), { once: true });
      existingScript.addEventListener('error', rejectOnScriptError, { once: true });
      return;
    }

    const script = document.createElement('script');
    script.src = scriptSrc;
    script.async = true;
    script.crossOrigin = 'anonymous';
    script.type = 'text/javascript';
    script.dataset.drLurieClerkjs = 'true';
    script.dataset.clerkPublishableKey = publishableKey;
    script.addEventListener('load', () => resolveWhenClerkExists(script), { once: true });
    script.addEventListener('error', rejectOnScriptError, { once: true });
    document.head.append(script);
  });

export const loadClerk = async ({ publishableKey, scriptSrc }: LoadClerkOptions): Promise<Clerk> => {
  if (!publishableKey) {
    throw new Error('Clerk publishableKey is required.');
  }

  const clerkWindow = getClerkWindow();
  const loadPromiseKey = getLoadPromiseKey({ publishableKey, scriptSrc });
  clerkWindow.__drLurieClerkLoadPromises ||= {};
  clerkWindow.__drLurieClerkLoadPromises[loadPromiseKey] ||= (async () => {
    await waitForClerkScript({ publishableKey, scriptSrc });

    const clerk = getLoadedClerk(publishableKey);

    if (!clerk || typeof clerk.load !== 'function') {
      throw new Error(INIT_ERROR_MESSAGE);
    }

    await clerk.load();
    return clerk;
  })();

  return clerkWindow.__drLurieClerkLoadPromises[loadPromiseKey];
};
