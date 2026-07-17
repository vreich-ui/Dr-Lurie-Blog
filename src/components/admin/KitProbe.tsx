import { useState } from 'react';

/**
 * T9.1 proof island — the smallest React component that proves the
 * `@astrojs/react` integration hydrates on `/admin/kit`.
 *
 * Deliberately trivial: no kit tokens or components (those are T9.2), no shell
 * (T9.3). The counter is the hydration signal — a non-hydrated static render
 * would paint "Clicked 0 times" and never advance. If clicking increments, the
 * client runtime took over, which is all this task needs to demonstrate.
 */
export default function KitProbe() {
  const [count, setCount] = useState(0);

  return (
    <div className="admin-kit-probe" data-admin-kit-probe>
      <p className="admin-kit-probe__note">
        React island mounted. This counter only advances once the client runtime hydrates the island.
      </p>
      <button type="button" className="btn-primary admin-kit-probe__btn" onClick={() => setCount((value) => value + 1)}>
        Clicked {count} {count === 1 ? 'time' : 'times'}
      </button>
    </div>
  );
}
