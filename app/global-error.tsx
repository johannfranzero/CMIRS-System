'use client';

import React from 'react';
import { Button } from '@/components/ui/button';
import { ExclamationTriangleIcon } from '@/components/ui/icons';

/**
 * CMIRS — Root Error Boundary
 *
 * Next.js renders this boundary when the root layout itself throws, which replaces the
 * entire document — including `<html>` and `<body>`. It therefore has to provide its own
 * document shell rather than relying on `app/layout.tsx`.
 */

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  React.useEffect(() => {
    console.error(
      '[ui] Root application error:',
      error?.message,
      '| digest=',
      error?.digest ?? 'none'
    );
  }, [error]);

  return (
    <html lang="en">
      <body className="bg-slate-50 text-slate-900">
        <div className="min-h-screen flex flex-col justify-center py-10 px-4 sm:px-6">
          <div className="sm:mx-auto sm:w-full sm:max-w-lg">
            <div className="rounded-xl bg-white border border-slate-200/80 shadow-xs overflow-hidden">
              <div className="bg-rose-50 border-b border-rose-100 p-5 flex items-start gap-3">
                <div className="w-10 h-10 rounded-xl bg-rose-100 border border-rose-200 flex items-center justify-center text-rose-700 shrink-0">
                  <ExclamationTriangleIcon size={22} className="w-5 h-5" />
                </div>
                <div>
                  <div className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded text-[11px] font-bold bg-rose-200/80 text-rose-900 mb-1">
                    Application Error
                  </div>
                  <h1 className="text-base sm:text-lg font-bold text-slate-900 leading-tight">
                    CMIRS could not start this request
                  </h1>
                </div>
              </div>

              <div className="p-6 space-y-4">
                <p className="text-xs sm:text-sm text-slate-600 leading-relaxed">
                  An unexpected error interrupted the application. No data was changed. Try again,
                  and contact the CMIRS administrator if the failure persists.
                </p>

                {error?.digest ? (
                  <p className="text-[11px] text-slate-500 font-mono">Reference: {error.digest}</p>
                ) : null}

                <Button variant="primary" onClick={reset}>
                  Try again
                </Button>
              </div>
            </div>
          </div>
        </div>
      </body>
    </html>
  );
}
