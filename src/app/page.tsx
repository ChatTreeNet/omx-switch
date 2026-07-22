'use client';

import * as React from 'react';
import { ConfigWorkspace } from '@/components/config/ConfigWorkspace';
import { SyncStatus } from '@/components/SyncStatus';
import type { ApiTarget } from '@/components/ModelSelector';

export default function Home() {
  const [target, setTarget] = React.useState<ApiTarget>('omo');

  return (
    <div className="min-h-screen bg-zinc-50 font-sans dark:bg-zinc-950">
      <div className="mx-auto max-w-6xl px-6 py-8 space-y-6">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="space-y-1">
            <h1 className="text-2xl font-bold text-zinc-900 dark:text-zinc-50">OMX Switch</h1>
            <p className="text-sm text-zinc-500 dark:text-zinc-400">
              Model switcher for OMO and OMP
            </p>
          </div>

          <div
            role="tablist"
            aria-label="Config target"
            className="flex items-center gap-1 rounded-lg bg-zinc-100 p-1 dark:bg-zinc-800"
          >
            {(['omo', 'omp'] as const).map((value) => (
              <button
                key={value}
                type="button"
                role="tab"
                aria-selected={target === value}
                onClick={() => setTarget(value)}
                className={`rounded-md px-4 py-1.5 text-sm font-medium transition-colors ${
                  target === value
                    ? 'bg-blue-600 text-white shadow-sm'
                    : 'text-zinc-600 hover:bg-zinc-200 dark:text-zinc-400 dark:hover:bg-zinc-700'
                }`}
              >
                {value.toUpperCase()}
              </button>
            ))}
          </div>
        </div>

        <SyncStatus />

        <ConfigWorkspace key={target} apiTarget={target} />
      </div>
    </div>
  );
}
