import React, { Suspense } from 'react';
import type { Metadata } from 'next';
import { CmirsLogo } from '@/components/ui/icons';
import { Card, CardContent } from '@/components/ui/card';
import { LoginForm } from '@/components/auth/login-form';
import { getTestPersonas } from '@/utils/auth/test-personas.server';

export const metadata: Metadata = {
  title: 'Sign In — CMIRS',
  description: 'Authenticate with your institutional account to access CMIRS.',
};

interface LoginPageProps {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}

async function LoginParamsResolver({ searchParams }: LoginPageProps) {
  const resolvedParams = await searchParams;

  const reasonParam = resolvedParams.reason;
  const reason = Array.isArray(reasonParam) ? reasonParam[0] : reasonParam;

  const nextParam = resolvedParams.next;
  const nextUrl = Array.isArray(nextParam) ? nextParam[0] : nextParam;

  // Development-only QA persona catalogue. `getTestPersonas()` returns an empty
  // list outside `next dev` (see utils/auth/dev-tools.ts), so a production build
  // never renders the quick-fill panel and never exposes a test e-mail address.
  const testPersonas = getTestPersonas();

  return <LoginForm initialReason={reason} nextUrl={nextUrl} testPersonas={testPersonas} />;
}

export default function LoginPage({ searchParams }: LoginPageProps) {
  return (
    <div className="min-h-screen bg-slate-50 flex flex-col justify-center py-10 px-4 sm:px-6 lg:px-8">
      <div className="sm:mx-auto sm:w-full sm:max-w-md">
        {/* Brand Logo & Title */}
        <div className="flex flex-col items-center text-center">
          <div className="p-2.5 rounded-2xl bg-white shadow-sm border border-slate-200/80 mb-3">
            <CmirsLogo size={44} className="w-11 h-11" />
          </div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900">
            CMIRS
          </h1>
          <p className="mt-1 text-xs text-slate-500 font-medium">
            Campus Maintenance & Incident Reporting System
          </p>
        </div>

        {/* Login Card */}
        <div className="mt-6">
          <Card className="shadow-sm border-slate-200/90 bg-white">
            <CardContent className="p-6 sm:p-8">
              <div className="mb-6">
                <h2 className="text-lg font-bold text-slate-900">
                  Sign in to your account
                </h2>
                <p className="text-xs text-slate-500 mt-1">
                  Enter your credentials below to access your role-specific dashboard
                </p>
              </div>

              <Suspense
                fallback={
                  <div className="flex flex-col items-center justify-center py-8">
                    <div className="w-6 h-6 border-2 border-indigo-600 border-t-transparent rounded-full animate-spin" />
                    <span className="text-xs text-slate-400 mt-2">Loading authentication form...</span>
                  </div>
                }
              >
                <LoginParamsResolver searchParams={searchParams} />
              </Suspense>
            </CardContent>
          </Card>
        </div>

        {/* Footer Notice */}
        <div className="mt-8 text-center text-xs text-slate-400">
          <p>
            &copy; 2026 Campus Maintenance & Incident Reporting System.
          </p>
          <p className="mt-0.5 text-[11px] text-slate-400/80">
            Institutional Operations Platform &bull; Authorized Personnel Only
          </p>
        </div>
      </div>
    </div>
  );
}
