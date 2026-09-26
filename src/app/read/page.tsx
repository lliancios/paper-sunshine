import { Suspense } from "react";
import { ReaderRoute } from "@/components/reader/ReaderRoute";

export default function ReadPage() {
  return (
    <Suspense fallback={null}>
      <ReaderRoute />
    </Suspense>
  );
}
