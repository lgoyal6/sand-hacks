import { readFile } from "node:fs/promises";
import { XMLValidator } from "fast-xml-parser";
import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";
import { describe, expect, it } from "vitest";
import { parseMarkdownQuiz } from "../src/ingest/markdown.js";
import { exportCommonCartridge, exportQti, importQti, numericKey, type QtiItem } from "../src/qti/index.js";

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
    // Both are guesses (a Canvas title, a stem excerpt), so the professor confirms them before a rewrite.
    expect(quiz.items.every((i) => i.objectiveSource === "inferred")).toBe(true);
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

  it("round-trips through a Common Cartridge .imscc shaped like a Canvas course export", () => {
    const quiz = parseMarkdownQuiz(md, { quizId: "sample-stats", courseId: "c" });
    const png = "data:image/png;base64," + Buffer.from([0x89, 0x50, 0x4e, 0x47]).toString("base64");
    const items: QtiItem[] = [
      ...quiz.items,
      { id: "sample-stats-q6", quizId: "sample-stats", stem: "Which are measures of spread?", type: "multi", choices: [{ id: "a", text: "SD" }, { id: "b", text: "Mean" }, { id: "c", text: "IQR" }], answerKey: ["a", "c"], objective: "spread", originalItemId: null },
      { id: "sample-stats-q7", quizId: "sample-stats", stem: "Using the table in the figure, what is n?", type: "numeric", answerKey: "36", objective: "read n", originalItemId: null, figure: { src: png, alt: "Figure for this question" } },
    ];
    const { zip, exported, skipped } = exportCommonCartridge({ id: "sample-stats", title: "Intro Statistics & more", items });
    expect(skipped).toEqual([]);
    expect(exported).toHaveLength(7);

    const files = unzipSync(zip);
    const names = Object.keys(files);
    const aid = names.find((n) => n.endsWith("/assessment_qti.xml"))!.split("/")[0]!;
    expect(names).toEqual(expect.arrayContaining(["imsmanifest.xml", `${aid}/assessment_qti.xml`, `${aid}/assessment_meta.xml`, `non_cc_assessments/${aid}.xml.qti`, "course_settings/course_settings.xml", "course_settings/canvas_export.txt"]));
    for (const n of names.filter((x) => /\.(xml|qti)$/.test(x))) expect(XMLValidator.validate(strFromU8(files[n]!))).toBe(true);

    const manifest = strFromU8(files["imsmanifest.xml"]!);
    expect(manifest).toContain("<schema>IMS Common Cartridge</schema><schemaversion>1.1.0</schemaversion>");
    expect(manifest).toContain(`<resource identifier="${aid}" type="imsqti_xmlv1p2/imscc_xmlv1p1/assessment"><file href="${aid}/assessment_qti.xml"/>`);
    expect(manifest).toContain(`<file href="non_cc_assessments/${aid}.xml.qti"/>`);
    expect(manifest).toMatch(/href="web_resources\/Uploaded Media\/figure-[0-9a-f]{8}\.png"/);
    // Importing must never rename the professor's course.
    expect(strFromU8(files["course_settings/course_settings.xml"]!)).not.toContain("<title>");

    const cc = strFromU8(files[`${aid}/assessment_qti.xml`]!);
    for (const profile of ["cc.exam.v0p1", "cc.multiple_choice.v0p1", "cc.multiple_response.v0p1", "cc.fib.v0p1"]) expect(cc).toContain(profile);
    expect(cc).not.toContain("question_type");
    const canvas = strFromU8(files[`non_cc_assessments/${aid}.xml.qti`]!);
    expect(canvas).toContain("numerical_question");
    expect(canvas).toContain('<vargte respident="response1">0.1662</vargte><varlte respident="response1">0.1672</varlte>');
    expect(canvas).toContain("$IMS-CC-FILEBASE$/Uploaded%20Media/figure-");

    // Canvas ships a question bank beside the quiz; every quiz item points at its bank copy.
    const bankFile = names.find((n) => n.startsWith("non_cc_assessments/") && n !== `non_cc_assessments/${aid}.xml.qti`)!;
    const bank = strFromU8(files[bankFile]!);
    expect(bank).toContain("<objectbank ident=");
    const refs = [...canvas.matchAll(/assessment_question_identifierref<\/fieldlabel><fieldentry>(g[0-9a-f]+)/g)].map((m) => m[1]);
    expect(refs).toHaveLength(7);
    expect([...bank.matchAll(/<item ident="(g[0-9a-f]+)"/g)].map((m) => m[1])).toEqual(refs);
    expect(manifest).toContain(`href="${bankFile}"`);
    // The quiz is graded: an assignment in a group that course_settings/assignment_groups.xml defines.
    const meta = strFromU8(files[`${aid}/assessment_meta.xml`]!);
    const group = strFromU8(files["course_settings/assignment_groups.xml"]!).match(/assignmentGroup identifier="(g[0-9a-f]+)"/)![1]!;
    expect(meta).toContain(`<quiz_identifierref>${aid}</quiz_identifierref>`);
    expect(meta).toContain("<submission_types>online_quiz</submission_types>");
    expect(meta.split(group).length - 1).toBe(2);
    for (const f of ["files_meta.xml", "context.xml", "media_tracks.xml", "assignment_groups.xml"]) expect(manifest).toContain(`href="course_settings/${f}"`);

    const expected = [
      ["mcq", "b"],
      ["mcq", "b"],
      ["numeric", "0.1667"],
      ["mcq", "b"],
      ["mcq", "b"],
      ["multi", ["a", "c"]],
      ["numeric", "36"],
    ];
    // Canvas's Classic copy wins when present: no duplicates from the CC copy or the question bank.
    const back = importQti(zip, { quizId: "sample-stats", courseId: "c" }).quiz;
    expect(back.title).toBe("Intro Statistics & more");
    expect(back.items.map((i) => [i.type, i.answerKey])).toEqual(expected);
    expect(back.items[0]!.choices).toEqual(quiz.items[0]!.choices);

    // A plain CC package from another LMS (no non_cc_assessments) imports from the CC profile alone.
    const ccOnly = Object.fromEntries(Object.entries(files).filter(([n]) => !n.startsWith("non_cc_assessments/")));
    const fromCc = importQti(zipSync(ccOnly), { quizId: "sample-stats", courseId: "c" });
    expect(fromCc.skipped).toEqual([]);
    expect(fromCc.quiz.items.map((i) => [i.type, i.answerKey])).toEqual(expected);
    // A bank-only non_cc folder (quiz copy missing) still falls back to the CC profile.
    const { [`non_cc_assessments/${aid}.xml.qti`]: _quizCopy, ...bankOnly } = files;
    expect(importQti(zipSync(bankOnly), { quizId: "sample-stats", courseId: "c" }).quiz.items).toHaveLength(7);
  });

  it("numeric keys become Canvas decimals with honest margins", () => {
    expect(numericKey("1/6")).toEqual({ value: 0.1667, margin: 0.0005 });
    expect(numericKey("2.5")).toEqual({ value: 2.5, margin: 0.05 });
    expect(numericKey("17")).toEqual({ value: 17, margin: 0 });
    expect(() => numericKey("about ten")).toThrow();
  });
});
