'use client';

import { useEffect, useRef, useCallback } from 'react';
import { useFormTracker } from '@/stores/useFormTracker';

export function ServiceWorkerRegister() {
  const { hasDirtyForms } = useFormTracker();
  const registrationRef = useRef<ServiceWorkerRegistration | null>(null);

  const checkAndActivateSW = useCallback(
    (registration: ServiceWorkerRegistration) => {
      const pending = localStorage.getItem('NEW_SW_PENDING') === 'true';
      if (pending && registration.waiting) {
        if (
          !hasDirtyForms() &&
          !localStorage.getItem('active_transaction_id')
        ) {
          registration.waiting.postMessage({ type: 'SKIP_WAITING' });
          localStorage.removeItem('NEW_SW_PENDING');
        }
      }
    },
    [hasDirtyForms],
  );

  useEffect(() => {
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker
        .register('/sw.js')
        .then((registration) => {
          registrationRef.current = registration;

          registration.addEventListener('updatefound', () => {
            const newWorker = registration.installing;
            if (newWorker) {
              newWorker.addEventListener('statechange', () => {
                if (
                  newWorker.state === 'installed' &&
                  navigator.serviceWorker.controller
                ) {
                  localStorage.setItem('NEW_SW_PENDING', 'true');
                  const event = new CustomEvent('sw-update-available', {
                    detail: { registration },
                  });
                  window.dispatchEvent(event);
                }
              });
            }
          });

          // Check for pending SW on mount
          checkAndActivateSW(registration);
        })
        .catch(() => {});
    }
  }, [checkAndActivateSW]);

  // Check for pending SW whenever hasDirtyForms changes
  useEffect(() => {
    if (registrationRef.current) {
      checkAndActivateSW(registrationRef.current);
    }
  }, [checkAndActivateSW]);

  return null;
}
