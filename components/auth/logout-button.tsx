'use client';

import React, { useTransition } from 'react';
import { logoutAction } from '@/actions/auth';
import { LogOutIcon } from '@/components/ui/icons';

interface LogoutButtonProps {
  className?: string;
  variant?: 'button' | 'icon' | 'compact';
  showLabel?: boolean;
}

export function LogoutButton({
  className = '',
  variant = 'button',
  showLabel = true,
}: LogoutButtonProps) {
  const [isPending, startTransition] = useTransition();

  const handleLogout = () => {
    startTransition(async () => {
      await logoutAction();
    });
  };

  if (variant === 'icon') {
    return (
      <button
        type="button"
        onClick={handleLogout}
        disabled={isPending}
        className={`p-1.5 rounded-md text-slate-400 hover:text-rose-600 hover:bg-rose-50 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-500 disabled:opacity-50 shrink-0 ${className}`}
        aria-label="Sign out of CMIRS"
        title={isPending ? 'Signing out...' : 'Sign out'}
      >
        {isPending ? (
          <span className="w-4 h-4 border-2 border-rose-600 border-t-transparent rounded-full animate-spin inline-block" />
        ) : (
          <LogOutIcon size={16} className="w-4 h-4" />
        )}
      </button>
    );
  }

  if (variant === 'compact') {
    return (
      <button
        type="button"
        onClick={handleLogout}
        disabled={isPending}
        className={`inline-flex items-center gap-1.5 text-xs font-semibold text-slate-500 hover:text-rose-600 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-500 disabled:opacity-50 ${className}`}
        aria-label="Sign out of CMIRS"
      >
        {isPending ? (
          <span className="w-3.5 h-3.5 border-2 border-rose-600 border-t-transparent rounded-full animate-spin inline-block" />
        ) : (
          <LogOutIcon size={14} className="w-3.5 h-3.5" />
        )}
        {showLabel && <span>{isPending ? 'Signing out...' : 'Sign Out'}</span>}
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={handleLogout}
      disabled={isPending}
      className={`flex items-center justify-center gap-2 text-xs font-semibold text-rose-700 bg-rose-50/70 hover:bg-rose-100/80 border border-rose-200/80 px-3 py-2 rounded-lg transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-500 disabled:opacity-50 w-full ${className}`}
      aria-label="Sign out of CMIRS"
    >
      {isPending ? (
        <span className="w-4 h-4 border-2 border-rose-600 border-t-transparent rounded-full animate-spin inline-block" />
      ) : (
        <LogOutIcon size={16} className="w-4 h-4 text-rose-600" />
      )}
      {showLabel && <span>{isPending ? 'Signing out of CMIRS...' : 'Sign Out'}</span>}
    </button>
  );
}
