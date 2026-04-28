import { notFound } from "next/navigation";
import { SpotrSessionResultsShell } from "../../../components/spotr-shell";
import { getSessionPublicResults } from "../../../lib/server/spotr-store";

export const dynamic = "force-dynamic";

export default async function SessionResultsPage({
  params,
}: {
  params: Promise<{ sessionId: string }>;
}) {
  const { sessionId } = await params;
  const results = await getSessionPublicResults(sessionId);
  if (!results) notFound();
  return <SpotrSessionResultsShell results={results} />;
}
