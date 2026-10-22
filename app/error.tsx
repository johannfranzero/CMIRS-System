'use client';

import React from 'react';
import { Button } from '@/components/ui/button';
import { ExclamationTriangleIcon } from '@/components/ui/icons';

/**
 * CMIRS — Route-Level Error Boundary
 *
 * Next.js renders this boundary when a Server Component or a nested route segment
 * throws. Without it the browser shows the framework's default error page, which
 * carries no brand, no recovery action and no reference an operator could use to
 * correlate the failure with a server log entry.
 *
 * The boundary deliberately shows only a generic message. The underlying error is
 * logged server-side; nothing about the database, the query or the session is
 * disclosed to the browser.
 */

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  React.useEffect(() => {
    // Server-side only. The message is never rendered to the user.
    console.error('[ui] Route segment error:', error?.message, '| digest=', error?.digest ?? 'none');
  }, [error]);

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col justify-center py-10 px-4 sm:px-6 lg:px-8">
      <div className="sm:mx-auto sm:w-full sm:max-w-lg">
        <div className="rounded-xl bg-white border border-slate-200/80 shadow-xs overflow-hidden">
          <div className="bg-amber-50 border-b border-amber-100 p-5 flex items-start gap-3">
            <div className="w-10 h-10 rounded-xl bg-amber-100 border border-amber-200 flex items-center justify-center text-amber-700 shrink-0">
              <ExclamationTriangleIcon size={22} className="w-5 h-5" />
            </div>
            <div>
              <div className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded text-[11px] font-bold bg-amber-200/80 text-amber-900 mb-1">
                Application Error
              </div>
              <h1 className="text-base sm:text-lg font-bold text-slate-900 leading-tight">
                This page could not be loaded
              </h1>
            </div>
          </div>

          <div className="p-6 space-y-4">
            <p className="text-xs sm:text-sm text-slate-600 leading-relaxed">
              The request could not be completed. No data was changed. Try again; if the problem
              persists, contact the CMIRS administrator with the time of the failure.
            </p>

            {error?.digest ? (
              <p className="text-[11px] text-slate-500 font-mono">
                Reference: {error.digest}
              </p>
            ) : null}

            <Button variant="primary" onClick={reset}>
              Try again
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
