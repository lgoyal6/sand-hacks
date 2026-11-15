import { readFile } from "node:fs/promises";
import { XMLValidator } from "fast-xml-parser";
import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";
import { describe, expect, it } from "vitest";
import { parseMarkdownQuiz } from "../src/ingest/markdown.js";
import { exportQti, importQti, numericKey, type QtiItem } from "../src/qti/index.js";

const md = await readFile(new URL("../../../data/quizzes/sample-stats.md", import.meta.url), "utf8");

// Shaped like a Canvas Classic Quizzes export: numeric idents, HTML-escaped stems, mixed question types.
const CANVAS_XML = `<?xml version="1.0" encoding="UTF-8"?>
<questestinterop xmlns="http://www.imsglobal.org/xsd/ims_qtiasiv1p2"><assessment ident="g1" title="Week 3 check-in"><section ident="root_section">
<item ident="i1" title="Standard error"><itemmetadata><qtimetadata>
  <qtimetadatafield><fieldlabel>question_type</fieldlabel><fieldentry>multiple_choice_question</fieldentry></qtimetadatafield>
  <qtimetadatafield><fieldlabel>points_possible</fieldlabel><fieldentry>1.0</fieldentry></qtimetadatafield></qtimetadata></itemmetadata>
  <presentation><material><mattext texttype="text/html">&lt;div&gt;&lt;p&gt;A sample of 25 has s = 10. What is the &lt;strong&gt;standard error&lt;/strong&gt;?&lt;/p&gt;&lt;/div&gt;</mattext></material>
  <response_lid ident="response1" rcardinality="Single"><render_choice>
    <response_label ident="4417"><material><mattext texttype="text/plain">0.4</mattext></material></response_label>
    <response_label ident="9001"><material><mattext texttype="text/plain">2</mattext></material></response_label>
    <response_label ident="3315"><material><mattext texttype="text/plain">10</mattext></material></response_label>
  </render_choice></response_lid></presentation>
  <resprocessing><outcomes><decvar maxvalue="100" minvalue="0" varname="SCORE" vartype="Decimal"/></outcomes>
  <respcondition continue="No"><conditionvar><varequal respident="response1">9001</varequal></conditionvar><setvar action="Set" varname="SCORE">100</setvar></respcondition></resprocessing></item>
<item ident="i2" title="Question"><itemmetadata><qtimetadata><qtimetadatafield><fieldlabel>question_type</fieldlabel><fieldentry>multiple_answers_question</fieldentry></qtimetadatafield></qtimetadata></itemmetadata>
  <presentation><material><mattext texttype="text/html">&lt;p&gt;Which increase power?&lt;/p&gt;</mattext></material>
  <response_lid ident="response1" rcardinality="Multiple"><render_choice>
    <response_label ident="11"><material><mattext texttype="text/plain">Larger n</mattext></material></response_label>
    <response_label ident="12"><material><mattext texttype="text/plain">Smaller alpha</mattext></material></response_label>
    <response_label ident="13"><material><mattext texttype="text/plain">Larger effect</mattext></material></response_label>
  </render_choice></response_lid></presentation>
  <resprocessing><respcondition continue="No"><conditionvar><and><varequal respident="response1">11</varequal><not><varequal respident="response1">12</varequal></not><varequal respident="response1">13</varequal></and></conditionvar><setvar action="Set" varname="SCORE">100</setvar></respcondition></resprocessing></item>
<item ident="i3" title="Dice"><itemmetadata><qtimetadata><qtimetadatafield><fieldlabel>question_type</fieldlabel><fieldentry>numerical_question</fieldentry></qtimetadatafield></qtimetadata></itemmetadata>
  <presentation><material><mattext texttype="text/html">&lt;p&gt;P(sum = 7) for two dice?&lt;/p&gt;</mattext></material><response_str ident="response1" rcardinality="Single"><render_fib fibtype="Decimal"><response_label ident="answer1"/></render_fib></response_str></presentation>
  <resprocessing><respcondition continue="No"><conditionvar><or><varequal respident="response1">0.1667</varequal><and><vargte respident="response1">0.1662</vargte><varlte respident="response1">0.1672</varlte></and></or></conditionvar><setvar action="Set" varname="SCORE">100</setvar></respcondition></resprocessing></item>
<item ident="i4" title="Explain"><itemmetadata><qtimetadata><qtimetadatafield><fieldlabel>question_type</fieldlabel><fieldentry>essay_question</fieldentry></qtimetadatafield></qtimetadata></itemmetadata>
  <presentation><material><mattext texttype="text/html">&lt;p&gt;Explain why.&lt;/p&gt;</mattext></material></presentation></item>
</section></assessment></questestinterop>`;

describe("Canvas QTI 1.2", () => {
  it("imports a Canvas-style export: HTML stems to text, idents to letters, multi and numeric keys, skips unsupported types", () => {
    const zip = zipSync({ "imsmanifest.xml": strToU8("<manifest/>"), "g1/g1.xml": strToU8(CANVAS_XML), "g1/assessment_meta.xml": strToU8("<quiz/>") });
    const { quiz, skipped } = importQti(zip, { quizId: "week3", courseId: "c" });
    expect(quiz.title).toBe("Week 3 check-in");
    expect(quiz.items.map((i) => [i.id, i.type, i.answerKey])).toEqual([
      ["week3-q1", "mcq", "b"],
      ["week3-q2", "multi", ["a", "c"]],
      ["week3-q3", "numeric", "0.1667"],
    ]);
    expect(quiz.items[0]!.stem).toBe("A sample of 25 has s = 10. What is the standard error?");
    expect(quiz.items[0]!.choices).toEqual([{ id: "a", text: "0.4" }, { id: "b", text: "2" }, { id: "c", text: "10" }]);
    expect(quiz.items[0]!.objective).toBe("Standard error");
    expect(quiz.items[1]!.objective).toMatch(/^Imported from Canvas: Which increase power/);
    expect(skipped).toEqual([{ title: "Explain", type: "essay_question", reason: "question type not supported yet" }]);
  });

  it("round-trips our quiz (mcq, multi, numeric fraction, figure) through a Canvas-importable zip", () => {
    const quiz = parseMarkdownQuiz(md, { quizId: "sample-stats", courseId: "c" });
    const png = "data:image/png;base64," + Buffer.from([0x89, 0x50, 0x4e, 0x47]).toString("base64");
    const items: QtiItem[] = [
      ...quiz.items,
      { id: "sample-stats-q6", quizId: "sample-stats", stem: "Which are measures of spread?", type: "multi", choices: [{ id: "a", text: "SD" }, { id: "b", text: "Mean" }, { id: "c", text: "IQR" }], answerKey: ["a", "c"], objective: "spread", originalItemId: null },
      { id: "sample-stats-q7", quizId: "sample-stats", stem: "Using the table in the figure, what is n?", type: "numeric", answerKey: "36", objective: "read n", originalItemId: null, figure: { src: png, alt: "Figure for this question" } },
    ];
    const { zip, exported, skipped } = exportQti({ id: "sample-stats", title: "Intro Statistics & more", items });
    expect(skipped).toEqual([]);
    expect(exported).toHaveLength(7);

    const files = unzipSync(zip);
    const names = Object.keys(files);
    expect(names).toContain("imsmanifest.xml");
    expect(names.filter((n) => n.endsWith("assessment_meta.xml"))).toHaveLength(1);
    expect(names.some((n) => n.startsWith("web_resources/Uploaded Media/figure-"))).toBe(true);
    for (const n of names.filter((x) => x.endsWith(".xml"))) expect(XMLValidator.validate(strFromU8(files[n]!))).toBe(true);
    const assessment = strFromU8(files[names.find((n) => /\/g[0-9a-f]+\.xml$/.test(n) && !n.endsWith("assessment_meta.xml"))!]!);
    // The img src is URL-encoded like Canvas's own exports; the manifest and zip entry keep the raw path.
    expect(assessment).toContain("$IMS-CC-FILEBASE$/Uploaded%20Media/figure-");
    expect(assessment).not.toContain("$IMS-CC-FILEBASE$/Uploaded Media/");
    expect(strFromU8(files["imsmanifest.xml"]!)).toMatch(/href="web_resources\/Uploaded Media\/figure-[0-9a-f]{8}\.png"/);
    // 1/6 keeps its rounding margin on the way out.
    expect(assessment).toContain('<vargte respident="response1">0.1662</vargte><varlte respident="response1">0.1672</varlte>');
    expect(assessment).toContain("multiple_answers_question");
    expect(assessment).toContain("numerical_question");

    const back = importQti(zip, { quizId: "sample-stats", courseId: "c" }).quiz;
    expect(back.title).toBe("Intro Statistics & more");
    expect(back.items.map((i) => [i.type, i.answerKey])).toEqual([
      ["mcq", "b"],
      ["mcq", "b"],
      ["numeric", "0.1667"], // 1/6 exported as a decimal with a rounding margin
      ["mcq", "b"],
      ["mcq", "b"],
      ["multi", ["a", "c"]],
      ["numeric", "36"],
    ]);
    expect(back.items[0]!.stem).toBe(quiz.items[0]!.stem);
    expect(back.items[0]!.choices).toEqual(quiz.items[0]!.choices);
  });

  it("numeric keys become Canvas decimals with honest margins", () => {
    expect(numericKey("1/6")).toEqual({ value: 0.1667, margin: 0.0005 });
    expect(numericKey("2.5")).toEqual({ value: 2.5, margin: 0.05 });
    expect(numericKey("17")).toEqual({ value: 17, margin: 0 });
    expect(() => numericKey("about ten")).toThrow();
  });
});
