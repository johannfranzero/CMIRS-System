'use client';

import React, { useActionState, useState } from 'react';
import { loginAction } from '@/actions/auth';
import { LoginFormState } from '@/types/auth';
import { Button } from '@/components/ui/button';
import {
  MailIcon,
  LockIcon,
  EyeIcon,
  EyeOffIcon,
  ExclamationTriangleIcon,
  CheckCircleIcon,
  ShieldIcon,
} from '@/components/ui/icons';

interface LoginFormProps {
  initialReason?: string;
  nextUrl?: string;
}

const initialState: LoginFormState = {
  success: false,
};

const TEST_ACCOUNTS = [
  {
    role: 'Student / Personnel',
    email: 'test-student@cmirs.internal',
    badge: 'student_personnel',
    desc: 'Report issues & track own submissions',
  },
  {
    role: 'Maintenance Coordinator',
    email: 'test-coord@cmirs.internal',
    badge: 'coordinator',
    desc: 'Triage, assign work & verify repairs',
  },
  {
    role: 'Maintenance Technician',
    email: 'test-tech@cmirs.internal',
    badge: 'technician',
    desc: 'Work on assigned repairs & decline RPC',
  },
  {
    role: 'School Administrator',
    email: 'test-admin@cmirs.internal',
    badge: 'administrator',
    desc: 'Manage roles, facilities & categories',
  },
  {
    role: 'School Management',
    email: 'test-mgmt@cmirs.internal',
    badge: 'management',
    desc: 'Read-only SLA metrics & oversight',
  },
];

export function LoginForm({ initialReason, nextUrl = '/' }: LoginFormProps) {
  const [state, formAction, isPending] = useActionState(loginAction, initialState);
  const [showPassword, setShowPassword] = useState(false);
  const [emailInput, setEmailInput] = useState('');
  const [showTestAccounts, setShowTestAccounts] = useState(true);

  // Helper to prefill email input for testing
  const handleSelectTestAccount = (email: string) => {
    setEmailInput(email);
  };

  return (
    <div className="flex flex-col gap-6">
      {/* 1. Reason Notice Banners */}
      {initialReason === 'logged_out' && (
        <div
          role="status"
          className="p-3.5 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-800 text-xs sm:text-sm flex items-center gap-2.5 animate-in fade-in duration-200"
        >
          <CheckCircleIcon size={18} className="w-4.5 h-4.5 text-emerald-600 shrink-0" />
          <p className="font-medium">You have been signed out successfully.</p>
        </div>
      )}

      {initialReason === 'expired' && (
        <div
          role="alert"
          className="p-3.5 rounded-xl bg-amber-50 border border-amber-200 text-amber-800 text-xs sm:text-sm flex items-center gap-2.5 animate-in fade-in duration-200"
        >
          <ExclamationTriangleIcon size={18} className="w-4.5 h-4.5 text-amber-600 shrink-0" />
          <p className="font-medium">Your session has expired. Please sign in again to continue.</p>
        </div>
      )}

      {initialReason === 'unauthorized' && (
        <div
          role="alert"
          className="p-3.5 rounded-xl bg-indigo-50 border border-indigo-200 text-indigo-900 text-xs sm:text-sm flex items-center gap-2.5 animate-in fade-in duration-200"
        >
          <ShieldIcon size={18} className="w-4.5 h-4.5 text-indigo-600 shrink-0" />
          <p className="font-medium">Please sign in to access the requested module.</p>
        </div>
      )}

      {/* 2. Global Error Banner */}
      {state.error && (
        <div
          role="alert"
          aria-live="polite"
          className="p-3.5 rounded-xl bg-rose-50 border border-rose-200 text-rose-900 text-xs sm:text-sm flex items-start gap-2.5 animate-in fade-in duration-200"
        >
          <ExclamationTriangleIcon size={18} className="w-4.5 h-4.5 text-rose-600 mt-0.5 shrink-0" />
          <div className="flex-1">
            <p className="font-semibold text-rose-800">Sign-in Failed</p>
            <p className="text-rose-700 text-xs mt-0.5">{state.error}</p>
          </div>
        </div>
      )}

      {/* 3. Login Form */}
      <form action={formAction} className="space-y-4">
        {/* Hidden next URL parameter */}
        <input type="hidden" name="next" value={nextUrl} />

        {/* Email Address */}
        <div>
          <label htmlFor="email" className="block text-xs font-semibold text-slate-700 mb-1.5">
            Institutional Email Address
          </label>
          <div className="relative rounded-lg shadow-2xs">
            <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3 text-slate-400">
              <MailIcon size={18} className="w-4.5 h-4.5" />
            </div>
            <input
              id="email"
              name="email"
              type="email"
              autoComplete="email"
              required
              value={emailInput}
              onChange={(e) => setEmailInput(e.target.value)}
              placeholder="username@cmirs.internal"
              aria-invalid={Boolean(state.fieldErrors?.email)}
              aria-describedby={state.fieldErrors?.email ? 'email-error' : undefined}
              className={`block w-full rounded-lg border bg-white py-2.5 pl-10 pr-3 text-sm text-slate-900 placeholder:text-slate-400 transition-colors focus:outline-none focus:ring-2 focus:ring-indigo-600 focus:border-indigo-600 ${
                state.fieldErrors?.email
                  ? 'border-rose-300 bg-rose-50/30'
                  : 'border-slate-300 hover:border-slate-400'
              }`}
            />
          </div>
          {state.fieldErrors?.email && (
            <p id="email-error" className="mt-1 text-xs text-rose-600">
              {state.fieldErrors.email}
            </p>
          )}
        </div>

        {/* Password */}
        <div>
          <div className="flex items-center justify-between mb-1.5">
            <label htmlFor="password" className="block text-xs font-semibold text-slate-700">
              Account Password
            </label>
          </div>
          <div className="relative rounded-lg shadow-2xs">
            <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3 text-slate-400">
              <LockIcon size={18} className="w-4.5 h-4.5" />
            </div>
            <input
              id="password"
              name="password"
              type={showPassword ? 'text' : 'password'}
              autoComplete="current-password"
              required
              placeholder="••••••••••••"
              aria-invalid={Boolean(state.fieldErrors?.password)}
              aria-describedby={state.fieldErrors?.password ? 'password-error' : undefined}
              className={`block w-full rounded-lg border bg-white py-2.5 pl-10 pr-10 text-sm text-slate-900 placeholder:text-slate-400 transition-colors focus:outline-none focus:ring-2 focus:ring-indigo-600 focus:border-indigo-600 ${
                state.fieldErrors?.password
                  ? 'border-rose-300 bg-rose-50/30'
                  : 'border-slate-300 hover:border-slate-400'
              }`}
            />
            <button
              type="button"
              onClick={() => setShowPassword(!showPassword)}
              className="absolute inset-y-0 right-0 flex items-center pr-3 text-slate-400 hover:text-slate-600 focus:outline-none"
              aria-label={showPassword ? 'Hide password' : 'Show password'}
            >
              {showPassword ? (
                <EyeOffIcon size={18} className="w-4.5 h-4.5" />
              ) : (
                <EyeIcon size={18} className="w-4.5 h-4.5" />
              )}
            </button>
          </div>
          {state.fieldErrors?.password && (
            <p id="password-error" className="mt-1 text-xs text-rose-600">
              {state.fieldErrors.password}
            </p>
          )}
        </div>

        {/* Submit Button */}
        <div className="pt-2">
          <Button
            type="submit"
            variant="primary"
            size="lg"
            isLoading={isPending}
            className="w-full justify-center shadow-xs"
          >
            {isPending ? 'Verifying Credentials...' : 'Sign In to CMIRS'}
          </Button>
        </div>
      </form>

      {/* 4. Policy Information Notice (Registration & Password Reset Policy) */}
      <div className="pt-2 border-t border-slate-100 text-center">
        <p className="text-xs text-slate-500 leading-relaxed">
          Public self-registration and self-service password recovery are disabled. For access requests or account assistance, please contact your campus facilities administrator.
        </p>
      </div>

      {/* 5. Testing & Verification Quick-Fill Helper (Authorized Test Accounts) */}
      <div className="rounded-xl border border-slate-200/80 bg-slate-50/70 p-3.5">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-indigo-600" />
            <span className="text-xs font-bold text-slate-800">
              Authorized Test Personas (Stage 2.1 QA)
            </span>
          </div>
          <button
            type="button"
            onClick={() => setShowTestAccounts(!showTestAccounts)}
            className="text-[11px] font-semibold text-indigo-700 hover:text-indigo-900"
          >
            {showTestAccounts ? 'Hide' : 'Show'}
          </button>
        </div>

        {showTestAccounts && (
          <div className="mt-2.5 space-y-1.5">
            <p className="text-[11px] text-slate-500 mb-2">
              Click any account below to autofill its email for staging authentication verification:
            </p>
            <div className="grid grid-cols-1 gap-1.5">
              {TEST_ACCOUNTS.map((acc) => (
                <button
                  key={acc.email}
                  type="button"
                  onClick={() => handleSelectTestAccount(acc.email)}
                  className={`w-full text-left p-2 rounded-lg border transition-all flex items-center justify-between text-xs ${
                    emailInput === acc.email
                      ? 'bg-indigo-50 border-indigo-300 ring-1 ring-indigo-300'
                      : 'bg-white border-slate-200 hover:bg-slate-50 hover:border-slate-300'
                  }`}
                >
                  <div className="flex flex-col min-w-0 pr-2">
                    <span className="font-semibold text-slate-800 truncate">{acc.role}</span>
                    <span className="text-[10px] text-slate-500 font-mono truncate">{acc.email}</span>
                  </div>
                  <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-slate-100 text-slate-600 shrink-0">
                    {acc.badge}
                  </span>
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
