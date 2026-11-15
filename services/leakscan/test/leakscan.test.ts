import { describe, expect, it } from "vitest";
import { classify, isOrigin } from "../src/sources";
import { exactWindows, keywordQuery, matchScore } from "../src/text";
import { scanItem } from "../src/scan";
import type { SearchClient, SerpResult } from "../src/brightdata";

const STEM = "A sample of 25 has mean 40 and standard deviation 10. What is the standard error of the mean?";

describe("exactWindows", () => {
  it("returns 8-12 word, non-overlapping windows from long stems", () => {
    const ws = exactWindows(STEM);
    expect(ws.length).toBeGreaterThan(0);
    for (const w of ws) {
      const n = w.split(" ").length;
      expect(n).toBeGreaterThanOrEqual(8);
      expect(n).toBeLessThanOrEqual(12);
      expect(w).not.toMatch(/"/);
    }
  });
  it("prefers windows with numbers", () => {
    expect(exactWindows(STEM, { count: 1 })[0]).toMatch(/25/);
  });
  it("returns short stems whole", () => {
    expect(exactWindows("Interpret a p-value of 0.03.")).toEqual(["Interpret a p-value of 0.03"]);
  });
});

describe("keywordQuery", () => {
  it("keeps numbers and content words, drops stopwords", () => {
    const q = keywordQuery(STEM);
    expect(q).toMatch(/25/);
    expect(q).toMatch(/deviation/);
    expect(q.split(" ")).not.toContain("the");
  });
});

describe("matchScore", () => {
  it("is high when a snippet quotes the stem", () => {
    expect(matchScore(STEM, "Solved: A sample of 25 has mean 40 and standard deviation 10. What is the standard error")).toBeGreaterThanOrEqual(0.8);
  });
  it("is low for an unrelated statistics snippet", () => {
    expect(matchScore(STEM, "The standard deviation measures spread. Learn how to compute variance step by step.")).toBeLessThan(0.4);
  });
});

describe("sources", () => {
  it("classifies study sites and origins", () => {
    expect(classify("https://quizlet.com/123/stats-flash-cards/")).toBe("quizlet");
    expect(classify("https://www.chegg.com/homework-help/questions-and-answers/x")).toBe("chegg");
    expect(classify("https://old.reddit.com/r/statistics/x")).toBe("reddit");
    expect(classify("https://example.com")).toBe("other");
    expect(isOrigin("https://openstax.org/books/introductory-statistics-2e/pages/7-homework")).toBe(true);
  });
});

describe("scanItem", () => {
  const results: Record<string, SerpResult[]> = {};
  const client: SearchClient = {
    async search(q) {
      return results[q] ?? [];
    },
  };

  it("keeps matching study-site results, skips the textbook itself and unrelated pages", async () => {
    const [w] = exactWindows(STEM, { count: 1 });
    results[`"${w}"`] = [
      { rank: 1, url: "https://openstax.org/books/x", title: "Homework", snippet: STEM },
      { rank: 2, url: "https://quizlet.com/1/stats/", title: "Stats quiz", snippet: STEM.slice(0, 80) },
      { rank: 3, url: "https://example.com/blog", title: "Spread", snippet: "Variance and spread explained." },
    ];
    const scan = await scanItem({ id: "q1", stem: STEM }, client, { fuzzy: false });
    expect(scan.findings.map((f) => f.url)).toEqual(["https://quizlet.com/1/stats/"]);
    expect(scan.findings[0]).toMatchObject({ itemId: "q1", sourceType: "quizlet" });
    expect(scan.findings[0].snippet.length).toBeLessThanOrEqual(300);
  });

  it("logs query errors instead of throwing", async () => {
    const failing: SearchClient = { search: async () => Promise.reject(new Error("429")) };
    const scan = await scanItem({ id: "q2", stem: STEM }, failing);
    expect(scan.findings).toEqual([]);
    expect(scan.queries.every((q) => q.error?.includes("429"))).toBe(true);
  });
});

describe("noise filtering", () => {
  it("drops search-engine redirects and OER mirrors of the textbook", async () => {
    const { isEngine } = await import("../src/sources");
    expect(isEngine("https://www.google.com/goto?url=abc")).toBe(true);
    expect(isOrigin("https://pressbooks-dev.oer.hawaii.edu/introductorystatistics/chapter/x")).toBe(true);
    expect(isOrigin("https://quizlet.com/1/")).toBe(false);
  });
});

describe("archive url patterns", () => {
  it("builds whole-path regexes from distinctive words, digits kept", async () => {
    const { urlPatterns } = await import("../src/archive");
    const p = urlPatterns("The average height of young adult males has a normal distribution with standard deviation of 2.5 inches.");
    expect(p[0]).toBe(".*average.*height.*young.*adult.*");
    expect(p.every((x) => x.startsWith(".*") && x.endsWith(".*"))).toBe(true);
    expect(urlPatterns("What is it?")).toEqual([]);
  });
});
