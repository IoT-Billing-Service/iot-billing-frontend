'use client';

import { useState, useEffect } from 'react';
import { useFormTracker } from '@/stores/useFormTracker';

export function AppUpdateBanner() {
  const [pendingReload, setPendingReload] = useState(false);
  const { hasDirtyForms } = useFormTracker();

  useEffect(() => {
    const pending = localStorage.getItem('pendingReload') === 'true';
    setPendingReload(pending);
  }, []);

  const handleReloadNow = () => {
    localStorage.removeItem('pendingReload');
    location.reload();
  };

  useEffect(() => {
    if (pendingReload && !hasDirtyForms()) {
      const timer = setTimeout(() => {
        localStorage.removeItem('pendingReload');
        location.reload();
      }, 500);
      return () => clearTimeout(timer);
    }
  }, [pendingReload, hasDirtyForms]);

  if (!pendingReload) return null;

  return (
    <div className="bg-yellow-600 text-yellow-100 px-4 py-2 text-sm flex justify-between items-center">
      <span>App update pending! Save your work, then click reload.</span>
      <button
        onClick={handleReloadNow}
        className="bg-yellow-700 hover:bg-yellow-800 px-3 py-1 rounded text-xs font-semibold"
      >
        Reload Now
      </button>
    </div>
  );
}
