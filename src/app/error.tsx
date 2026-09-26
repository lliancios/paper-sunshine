"use client";
import { useEffect } from "react";
import { ErrorCard } from "@/components/ErrorBoundary";
import { isChunkError, reloadOnce } from "@/lib/recover";

export default function Error({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  useEffect(() => {
    console.error(error);
    if (isChunkError(error)) reloadOnce();
  }, [error]);
  return (
    <div className="min-h-dvh bg-bg px-4 py-10">
      <ErrorCard error={error} onRetry={retry} />
    </div>
  );
}
