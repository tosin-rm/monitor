import { describe, expect, it } from "vitest";
import {
  buildMetricGuidance,
  getLighthouseFindings,
  performanceScoreExplanation,
  selectLighthouseFindings,
} from "@/lib/health/performance-guidance";

describe("performance guidance", () => {
  it("selects the highest-impact failing audits and strips markdown links", () => {
    const findings = selectLighthouseFindings({
      performance: {
        auditRefs: [
          { id: "image", weight: 5 },
          { id: "blocking", weight: 10 },
          { id: "passed", weight: 20 },
          { id: "manual", weight: 30 },
        ],
      },
    }, {
      image: {
        title: "Optimize image",
        description: "Use a smaller image. [Read more](https://example.test/docs)",
        score: 0,
        details: { overallSavingsMs: 1200 },
      },
      blocking: {
        title: "Remove render blocking resources",
        description: "Reduce blocking CSS.",
        score: 0.5,
        details: { overallSavingsMs: 400 },
      },
      passed: { title: "Passed", description: "Passed audit", score: 1 },
      manual: {
        title: "Manual audit",
        description: "Check this manually.",
        score: 0,
        scoreDisplayMode: "manual",
      },
    });

    expect(findings.performance.map(({ id }) => id)).toEqual(["image", "blocking"]);
    expect(findings.performance[0]?.description).toBe("Use a smaller image. Read more");
    expect(findings.accessibility).toEqual([]);
  });

  it("gives next steps for measured metrics outside their target ranges", () => {
    expect(buildMetricGuidance({
      lcp_ms: 4200,
      inp_ms: 350,
      cls: 0.05,
      fcp_ms: 1700,
      ttfb_ms: 1900,
    })).toMatchObject([
      { label: "Largest Contentful Paint", assessment: "poor", value: "4200 ms" },
      { label: "Interaction to Next Paint", assessment: "improve", value: "350 ms" },
      { label: "Time to First Byte", assessment: "poor", value: "1900 ms" },
    ]);
  });

  it("parses persisted findings defensively and explains score categories", () => {
    expect(getLighthouseFindings({
      category_findings: {
        accessibility: [{ id: "contrast", title: "Contrast", description: "Improve contrast", score: 0 }],
      },
    }, "accessibility")).toHaveLength(1);
    expect(getLighthouseFindings({ category_findings: null }, "performance")).toEqual([]);
    expect(performanceScoreExplanation(51)).toContain("do not lower this performance score");
  });
});
