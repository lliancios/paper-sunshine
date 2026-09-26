import { ReaderView } from "@/components/reader/ReaderView";

export default async function ReadPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <ReaderView paperId={id} />;
}
