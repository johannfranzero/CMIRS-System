'use client';

import React, { useState } from 'react';
import { canRenderTestPersonaPanel } from '@/utils/auth/dev-tools';

/**
 * CMIRS — Development-Only QA Persona Quick-Fill Panel
 *
 * ## Production safety contract
 *
 * This panel renders **only** when the server hands it a non-empty persona
 * list, and the server hands it one **only** when the application runs under
 * `next dev` with `CMIRS_ENABLE_TEST_PERSONAS=true`
 * (see `utils/auth/dev-tools.ts`). The panel additionally refuses to render in
 * a production build, where `process.env.NODE_ENV` is the build-time constant
 * `"production"`.
 *
 * The panel holds **no** addresses of its own: the entries arrive as props
 * from the Server Component, so the e-mail identifiers never enter the browser
 * bundle of a production build.
 */

export interface TestPersonaEntry {
  role: string;
  email: string;
  badge: string;
  desc: string;
}

interface TestPersonaPanelProps {
  personas: readonly TestPersonaEntry[];
  selectedEmail?: string;
  onSelect: (email: string) => void;
}

export function TestPersonaPanel({ personas, selectedEmail, onSelect }: TestPersonaPanelProps) {
  const [showTestAccounts, setShowTestAccounts] = useState(true);

  // Hard production guard. `canRenderTestPersonaPanel` reads
  // `process.env.NODE_ENV`, which Next.js inlines as a build-time constant:
  // `"production"` in every production build, so this branch is removed by the
  // bundler and the panel can never render in production.
  if (!canRenderTestPersonaPanel() || !personas || personas.length === 0) {
    return null;
  }

  return (
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
            {personas.map((acc) => (
              <button
                key={acc.email}
                type="button"
                onClick={() => onSelect(acc.email)}
                title={acc.desc}
                className={`w-full text-left p-2 rounded-lg border transition-all flex items-center justify-between text-xs ${
                  selectedEmail === acc.email
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
  );
}
