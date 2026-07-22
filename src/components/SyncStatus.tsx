'use client';

import { useQuery } from '@tanstack/react-query';
import { AlertTriangle } from 'lucide-react';

interface OmoSyncResponse {
  needsSync: boolean;
  daysSincePush: number | null;
  lastPush: string | null;
  error?: string;
}

export function SyncStatus() {
  const { data } = useQuery<OmoSyncResponse>({
    queryKey: ['omo-sync'],
    queryFn: async () => {
      const res = await fetch('/api/omo-sync');
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Failed to check OMO upstream status');
      }
      return data;
    },
    retry: false,
  });

  if (!data?.needsSync) {
    return null;
  }

  return (
    <div
      role="alert"
      className="flex w-full items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200"
    >
      <AlertTriangle className="h-4 w-4 shrink-0" />
      OMO upstream has not been updated in {data.daysSincePush} days. Consider syncing.
    </div>
  );
}
