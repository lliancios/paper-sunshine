"use client";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { readIdFromLocation } from "@/lib/routes";
import { ReaderView } from "./ReaderView";

export function ReaderRoute() {
  const id = readIdFromLocation(useSearchParams().get("id"), usePathname());
  if (!id)
    return (
      <div className="flex h-full items-center justify-center text-sm text-ink-soft">
        找不到這篇論文。
        <Link href="/" className="ml-1 text-accent-strong underline">
          回文獻庫
        </Link>
      </div>
    );
  return <ReaderView key={id} paperId={id} />;
}
