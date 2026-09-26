import { redirect } from "next/navigation";
import { readHref } from "@/lib/routes";

// Legacy URL form; the reader now lives at /read?id=… (one cacheable page shell).
export default async function LegacyReadPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  redirect(readHref(decodeURIComponent(id)));
}
