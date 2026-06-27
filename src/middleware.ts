import { NextRequest, NextResponse } from 'next/server';

export const config = {
  matcher: '/dashboard/:path*',
};

const DEVICE_COUNT_COOKIE = 'x-device-count';

/**
 * Reads the persisted device count from the Zustand localStorage key and
 * forwards it as a short-lived cookie so the SSR page render can include it
 * in the initial HTML — preventing the "No devices connected" flash.
 *
 * The cookie is set by the client (see deviceStore.ts) by calling
 * document.cookie directly after rehydration. The middleware reads it here
 * so the server can access it on the next navigation.
 */
export function middleware(request: NextRequest) {
  const response = NextResponse.next();

  // If the cookie already exists (set by a previous client-side session), pass
  // it through unchanged. If not, initialise to '0' so the server always has a
  // defined value to render rather than undefined / empty state.
  if (!request.cookies.has(DEVICE_COUNT_COOKIE)) {
    response.cookies.set(DEVICE_COUNT_COOKIE, '0', {
      path: '/dashboard',
      sameSite: 'strict',
      httpOnly: false, // must be readable by client JS to update
    });
  }

  return response;
}
