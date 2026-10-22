import React from 'react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { CmirsLogo, ReportsIcon } from '@/components/ui/icons';

export const metadata: Metadata = {
  title: '404 — Page Not Found | CMIRS',
  description: 'The requested CMIRS page does not exist.',
};

export const instant = false;

/**
 * CMIRS — 404 Boundary
 *
 * Without this boundary an unknown path renders the framework's default page, which
 * does not match the application shell and offers no route back into the product.
 */
export default function NotFound() {
  return (
    <div className="min-h-screen bg-slate-50 flex flex-col justify-center py-10 px-4 sm:px-6 lg:px-8">
      <div className="sm:mx-auto sm:w-full sm:max-w-lg">
        <div className="flex flex-col items-center text-center mb-6">
          <div className="p-2.5 rounded-2xl bg-white shadow-xs border border-slate-200/80 mb-3">
            <CmirsLogo size={40} className="w-10 h-10" />
          </div>
          <span className="text-xs font-semibold uppercase tracking-wider text-slate-500">
            CMIRS
          </span>
        </div>

        <Card className="border-slate-200/80 shadow-sm bg-white overflow-hidden">
          <div className="bg-slate-50 border-b border-slate-100 p-5 flex items-start gap-3">
            <div className="w-10 h-10 rounded-xl bg-slate-100 border border-slate-200 flex items-center justify-center text-slate-600 shrink-0">
              <ReportsIcon size={22} className="w-5 h-5" />
            </div>
            <div>
              <div className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded text-[11px] font-bold bg-slate-200/80 text-slate-700 mb-1">
                HTTP 404 &bull; Not Found
              </div>
              <h1 className="text-base sm:text-lg font-bold text-slate-900 leading-tight">
                That page does not exist
              </h1>
            </div>
          </div>

          <CardContent className="p-6 space-y-4">
            <p className="text-xs sm:text-sm text-slate-600 leading-relaxed">
              The address may be mistyped, or the record may have been removed. Use the operations
              dashboard to continue.
            </p>

            <Link href="/">
              <Button variant="primary">Return to dashboard</Button>
            </Link>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
