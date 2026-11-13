import type { Metadata } from "next";

import { JobReview } from "@/components/review/job-review";

export const metadata: Metadata = {
  title: "Job review",
};

// Next 16: `params` is a Promise. The page itself stays a Server Component; the review
// UI is a Client Component because the API is reached through the browser-only `/api`
// rewrite.
export default async function JobReviewPage({
  params,
}: {
  params: Promise<{ jobId: string }>;
}) {
  const { jobId } = await params;
  return <JobReview jobId={jobId} />;
}
