import React from 'react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getCurrentUserAndProfile } from '@/utils/auth/server';
import { formatRoleLabel } from '@/utils/auth/validation';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { ShieldIcon, CmirsLogo, ChevronRightIcon, ReportsIcon } from '@/components/ui/icons';

export const metadata: Metadata = {
  title: '403 — Unauthorized Access | CMIRS',
  description: 'Access restricted by CMIRS Role-Based Access Control policy.',
};

export const instant = false;

export default async function UnauthorizedPage() {
  const user = await getCurrentUserAndProfile();

  // If user is unauthenticated, redirect to login
  if (!user) {
    redirect('/login?reason=unauthorized');
  }

  const roleTitle = formatRoleLabel(user.profile.role);

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col justify-center py-10 px-4 sm:px-6 lg:px-8">
      <div className="sm:mx-auto sm:w-full sm:max-w-lg">
        {/* Brand Header */}
        <div className="flex flex-col items-center text-center mb-6">
          <div className="p-2.5 rounded-2xl bg-white shadow-xs border border-slate-200/80 mb-3">
            <CmirsLogo size={40} className="w-10 h-10" />
          </div>
          <span className="text-xs font-semibold uppercase tracking-wider text-slate-400">
            CMIRS Security Architecture
          </span>
        </div>

        {/* 403 Alert Card */}
        <Card className="border-rose-200/80 shadow-sm bg-white overflow-hidden">
          {/* Card Top Banner */}
          <div className="bg-rose-50 border-b border-rose-100 p-4 sm:p-5 flex items-start gap-3">
            <div className="w-10 h-10 rounded-xl bg-rose-100 border border-rose-200 flex items-center justify-center text-rose-700 shrink-0">
              <ShieldIcon size={22} className="w-5.5 h-5.5" />
            </div>
            <div>
              <div className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded text-[11px] font-bold bg-rose-200/80 text-rose-800 mb-1">
                HTTP 403 &bull; Access Forbidden
              </div>
              <h1 className="text-base sm:text-lg font-bold text-slate-900 leading-tight">
                Restricted Operational Module
              </h1>
            </div>
          </div>

          <CardContent className="p-6 space-y-4">
            <p className="text-xs sm:text-sm text-slate-600 leading-relaxed">
              Your institutional account ({user.profile.email}) is currently assigned the operational role:
            </p>

            {/* Current Role Identity Card */}
            <div className="p-3.5 rounded-xl bg-slate-50 border border-slate-200 flex items-center justify-between gap-3">
              <div className="flex flex-col min-w-0">
                <span className="text-xs font-bold text-slate-900 truncate">
                  {user.profile.full_name}
                </span>
                <span className="text-[11px] font-medium text-slate-500 truncate">
                  {user.profile.email}
                </span>
              </div>
              <div className="px-2.5 py-1 rounded-lg bg-indigo-50 border border-indigo-200 text-indigo-700 text-xs font-bold shrink-0">
                {roleTitle}
              </div>
            </div>

            <p className="text-xs text-slate-500 leading-relaxed">
              Under the CMIRS Role-Based Access Control policy, this module is restricted to specific designated campus personnel. Actions and visibility are strictly partitioned by institutional responsibility to uphold separation of duties and system security.
            </p>

            <div className="pt-3 border-t border-slate-100 flex flex-wrap gap-2.5">
              <Link href="/" className="flex-1 min-w-[160px]">
                <Button variant="primary" size="md" className="w-full justify-center">
                  Return to Dashboard
                </Button>
              </Link>
              <Link href="/reports" className="flex-1 min-w-[160px]">
                <Button
                  variant="outline"
                  size="md"
                  leftIcon={<ReportsIcon size={16} className="w-4 h-4 text-slate-500" />}
                  rightIcon={<ChevronRightIcon size={14} className="w-3.5 h-3.5" />}
                  className="w-full justify-center"
                >
                  View Reports Queue
                </Button>
              </Link>
            </div>
          </CardContent>
        </Card>

        {/* Footer info */}
        <p className="text-center text-xs text-slate-400 mt-6">
          Need elevated role permissions? Contact your School Administrator.
        </p>
      </div>
    </div>
  );
}
