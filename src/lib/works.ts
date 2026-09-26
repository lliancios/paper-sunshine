"use client";
import type { RelatedItem, WorkMeta } from "./apiTypes";
import { db } from "./db";
import { fetchPdfBlob } from "./api";
import { importPdf } from "./pipeline";

export const workKey = (w: WorkMeta) => w.openalexId ?? w.doi ?? w.title;
export const doiUrl = (w: WorkMeta) => (w.doi ? `https://doi.org/${w.doi}` : w.landing ?? w.oaUrl ?? "");

export async function saveWork(w: WorkMeta | RelatedItem) {
  const id = workKey(w);
  const now = Date.now();
  const existing = await db.saved.get(id);
  await db.saved.put({ id, meta: w, savedAt: existing?.savedAt ?? now, updatedAt: now, paperId: existing?.paperId, deleted: false });
}

export async function unsaveWork(id: string) {
  await db.saved.update(id, { deleted: true, updatedAt: Date.now() });
}

/**
 * Opens a recommended/cited work: jumps to it if it is already in the library,
 * imports the open-access PDF when there is one, otherwise saves it so a PDF
 * downloaded via VPN is matched by DOI when dropped into the library.
 */
export async function openWork(w: WorkMeta): Promise<{ paperId?: string; needsDownload?: boolean }> {
  if (w.doi) {
    const existing = await db.papers.where("doi").equals(w.doi.toLowerCase()).filter((p) => !p.deleted).first();
    if (existing?.hasFile) return { paperId: existing.id };
  }
  if (w.oaPdf) {
    try {
      const blob = await fetchPdfBlob(w.oaPdf);
      const id = await importPdf(blob, `${w.title.slice(0, 60)}.pdf`, { meta: w });
      return { paperId: id };
    } catch {
      /* fall through */
    }
  }
  await saveWork(w);
  return { needsDownload: true };
}
