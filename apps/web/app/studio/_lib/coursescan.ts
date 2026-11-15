// Course website scan (owner: B; the crawler and leak check are A's services/agents `coursescan`).
// Shared types for the route and the card. The card is shown once; only `record` (hashes and URLs) is stored.
import type { LeakFinding } from "@unprompted/shared";
import type { LeakRadarData } from "@/components/dashboard/leak-radar-data";

export interface CourseScanRow {
  id: string;
  hash: string;
  sourceUrl: string;
  stem: string;
  leaks: LeakFinding[];
}
export interface CourseScanCard {
  site: string;
  consent: string;
  pagesScanned: number;
  pagesSkipped: { url: string; reason: string }[];
  problems: number;
  leaked: number;
  leakCheck?: string;
  headline: string;
  rows: CourseScanRow[];
}
export interface CourseScanView {
  card: CourseScanCard;
  radar: LeakRadarData;
}
