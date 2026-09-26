import { Suspense } from "react";
import { LibraryView } from "@/components/LibraryView";

export default function Page() {
  return (
    <Suspense fallback={null}>
      <LibraryView />
    </Suspense>
  );
}
