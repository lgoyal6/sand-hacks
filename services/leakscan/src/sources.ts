import type { LeakFinding } from "@unprompted/shared";

export type SourceType = LeakFinding["sourceType"];

const HOSTS: [RegExp, SourceType][] = [
  [/(^|\.)quizlet\.com$/, "quizlet"],
  [/(^|\.)reddit\.com$/, "reddit"],
  [/(^|\.)chegg\.com$/, "chegg"],
  [/(^|\.)coursehero\.com$/, "coursehero"],
];

/** Sites where a match means "the question (and probably its answer) is online". */
export const STUDY_SITES = ["quizlet.com", "chegg.com", "coursehero.com", "reddit.com", "brainly.com", "studocu.com", "numerade.com", "bartleby.com", "gauthmath.com", "vaia.com", "transtutors.com", "homeworklib.com", "studyx.ai"];

/** Hosts that are the question's own legitimate source, not a leak (the textbook itself, LMS pages). */
const ORIGIN_HOSTS = [
  /(^|\.)openstax\.org$/,
  /(^|\.)libretexts\.org$/,
  /(^|\.)instructure\.com$/,
  // OER mirrors of open textbooks (Pressbooks) republish the book itself; that is not an answer leak.
  /(^|\.)pressbooks\./,
  /^pressbooks/,
];

/** Search-engine plumbing that is never evidence (redirect wrappers, cached copies). */
const ENGINE_HOSTS = [/(^|\.)google\.[a-z.]+$/, /(^|\.)googleusercontent\.com$/, /(^|\.)bing\.com$/];

export function isEngine(url: string): boolean {
  const h = hostOf(url);
  return ENGINE_HOSTS.some((re) => re.test(h));
}

export function hostOf(url: string): string {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return "";
  }
}

export function classify(url: string): SourceType {
  const h = hostOf(url);
  for (const [re, t] of HOSTS) if (re.test(h)) return t;
  return "other";
}

export function isOrigin(url: string): boolean {
  const h = hostOf(url);
  return ORIGIN_HOSTS.some((re) => re.test(h));
}

export function isStudySite(url: string): boolean {
  const h = hostOf(url);
  return STUDY_SITES.some((s) => h === s || h.endsWith("." + s));
}
