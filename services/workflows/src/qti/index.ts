// Canvas Classic Quizzes QTI 1.2: import an export zip into our Quiz, and export items back as a
// Canvas-importable zip (imsmanifest.xml + <id>/<id>.xml + <id>/assessment_meta.xml, figures as files).
// Also a Common Cartridge 1.1 package (.imscc) shaped like a Canvas course export, for Canvas installs
// whose Import Content has no "QTI .zip" option. Supported: multiple_choice_question, multiple_answers_question, numerical_question.
import { createHash } from "node:crypto";
import { XMLParser } from "fast-xml-parser";
import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";
import type { Item, Quiz } from "@unprompted/shared";

type Figure = { src: string; alt: string };
export type QtiItem = Item & { figure?: Figure };

// ---------------- export ----------------

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const ident = (s: string) => "g" + createHash("md5").update(s).digest("hex");
const field = (label: string, entry: string) => `<qtimetadatafield><fieldlabel>${label}</fieldlabel><fieldentry>${esc(entry)}</fieldentry></qtimetadatafield>`;

/** Canvas numerical answers are decimals: "1/6" -> 0.1667 with a small tolerance. */
export function numericKey(key: string): { value: number; margin: number } {
  const t = key.trim();
  const frac = t.match(/^(-?\d+(?:\.\d+)?)\s*\/\s*(-?\d+(?:\.\d+)?)$/);
  const value = frac ? Number(frac[1]) / Number(frac[2]) : Number(t.replace(/%$/, ""));
  if (!Number.isFinite(value)) throw new Error(`not a numeric key: ${key}`);
  const decimals = (t.split(".")[1] ?? "").length;
  // Exact keys get a tiny margin; fractions and rounded values get a rounding margin.
  const margin = frac ? 0.0005 : decimals ? 0.5 * 10 ** -decimals : 0;
  return { value: frac ? Math.round(value * 10000) / 10000 : value, margin };
}

/**
 * "canvas": a Canvas Classic Quizzes quiz item, pointing at its question-bank copy (assessment_question_identifierref).
 * "bank":   that question-bank copy (Canvas ships the bank next to the quiz and links quiz items to it).
 * "cc":     the IMS Common Cartridge 1.1 QTI profile.
 */
type Flavor = "canvas" | "bank" | "cc";
const CC_PROFILE = { multiple_choice_question: "cc.multiple_choice.v0p1", multiple_answers_question: "cc.multiple_response.v0p1", numerical_question: "cc.fib.v0p1" } as const;

function itemXml(it: QtiItem, figureHref?: string, flavor: Flavor = "canvas"): string {
  const id = flavor === "bank" ? ident(`aq:${it.id}`) : ident(it.id);
  const html = `<div><p>${esc(it.stem)}</p>${figureHref ? `<p><img src="$IMS-CC-FILEBASE$/${encodeURI(figureHref)}" alt="${esc(it.figure?.alt ?? "")}"></p>` : ""}</div>`;
  const stem = `<material><mattext texttype="text/html">${esc(html)}</mattext></material>`;
  const correct = Array.isArray(it.answerKey) ? it.answerKey : [it.answerKey];
  const meta = (type: keyof typeof CC_PROFILE, extra = "") =>
    `<itemmetadata><qtimetadata>${flavor === "cc" ? `${field("cc_profile", CC_PROFILE[type])}${field("cc_weighting", "1")}` : `${field("question_type", type)}${field("points_possible", "1.0")}${extra}${flavor === "canvas" ? field("assessment_question_identifierref", ident(`aq:${it.id}`)) : ""}`}</qtimetadata></itemmetadata>`;
  const scoring = (cond: string) =>
    `<resprocessing><outcomes><decvar maxvalue="100" minvalue="0" varname="SCORE" vartype="Decimal"/></outcomes><respcondition continue="No"><conditionvar>${cond}</conditionvar><setvar action="Set" varname="SCORE">100</setvar></respcondition></resprocessing>`;
  if (it.type === "mcq" || it.type === "multi") {
    const choices = it.choices ?? [];
    const cid = (c: { id: string }) => ident(`${it.id}:${c.id}`);
    const labels = choices.map((c) => `<response_label ident="${cid(c)}"><material><mattext texttype="text/plain">${esc(c.text)}</mattext></material></response_label>`).join("");
    const multi = it.type === "multi";
    const cond = multi
      ? `<and>${choices.map((c) => (correct.includes(c.id) ? `<varequal respident="response1">${cid(c)}</varequal>` : `<not><varequal respident="response1">${cid(c)}</varequal></not>`)).join("")}</and>`
      : `<varequal respident="response1">${cid(choices.find((c) => c.id === correct[0])!)}</varequal>`;
    const type = multi ? "multiple_answers_question" : "multiple_choice_question";
    return `<item ident="${id}" title="${esc(it.objective || "Question")}">${meta(type, field("original_answer_ids", choices.map(cid).join(",")))}<presentation>${stem}<response_lid ident="response1" rcardinality="${multi ? "Multiple" : "Single"}"><render_choice>${labels}</render_choice></response_lid></presentation>${scoring(cond)}</item>`;
  }
  if (it.type === "numeric") {
    const { value, margin } = numericKey(String(correct[0]));
    // CC 1.1 has no numeric type: fill-in-the-blank with the decimal as the exact answer. Canvas reads the
    // Classic copy (non_cc_assessments) instead, which keeps the range.
    const cond =
      flavor === "cc"
        ? `<varequal respident="response1" case="No">${value}</varequal>`
        : margin
          ? `<or><varequal respident="response1">${value}</varequal><and><vargte respident="response1">${+(value - margin).toFixed(6)}</vargte><varlte respident="response1">${+(value + margin).toFixed(6)}</varlte></and></or>`
          : `<varequal respident="response1">${value}</varequal>`;
    return `<item ident="${id}" title="${esc(it.objective || "Question")}">${meta("numerical_question")}<presentation>${stem}<response_str ident="response1" rcardinality="Single"><render_fib fibtype="${flavor === "cc" ? "String" : "Decimal"}"><response_label ident="answer1"/></render_fib></response_str></presentation>${scoring(cond)}</item>`;
  }
  throw new Error(`QTI export: unsupported item type ${it.type} (${it.id})`);
}

type ExportQuiz = { id: string; title: string; items: QtiItem[] };
type ExportResult = { zip: Uint8Array; exported: string[]; skipped: { id: string; reason: string }[] };

const QTI_NS = `xmlns="http://www.imsglobal.org/xsd/ims_qtiasiv1p2" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:schemaLocation="http://www.imsglobal.org/xsd/ims_qtiasiv1p2 http://www.imsglobal.org/xsd/ims_qtiasiv1p2p1.xsd"`;

/** Everything both packages share: the assessment in both flavors, Canvas's quiz settings, and figure files. */
function buildAssessment(quiz: ExportQuiz) {
  const aid = ident(`assessment:${quiz.id}`);
  const mid = ident(`meta:${quiz.id}`);
  const files: Record<string, Uint8Array> = {};
  const fileResources: string[] = [];
  const canvasParts: string[] = [];
  const ccParts: string[] = [];
  const bankParts: string[] = [];
  const exported: string[] = [];
  const skipped: { id: string; reason: string }[] = [];
  for (const it of quiz.items) {
    let href: string | undefined;
    if (it.figure?.src?.startsWith("data:image/png;base64,")) {
      href = `Uploaded Media/figure-${ident(it.id).slice(1, 9)}.png`;
      files[`web_resources/${href}`] = Uint8Array.from(Buffer.from(it.figure.src.split(",")[1]!, "base64"));
      const rid = ident(`file:${it.id}`);
      fileResources.push(`<resource identifier="${rid}" type="webcontent" href="web_resources/${esc(href)}"><file href="web_resources/${esc(href)}"/></resource>`);
    }
    try {
      canvasParts.push(itemXml(it, href, "canvas"));
      ccParts.push(itemXml(it, href, "cc"));
      bankParts.push(itemXml(it, href, "bank"));
      exported.push(it.id);
    } catch (e) {
      skipped.push({ id: it.id, reason: (e as Error).message });
    }
  }
  const canvasAssessment = `<?xml version="1.0" encoding="UTF-8"?>
<questestinterop ${QTI_NS}><assessment ident="${aid}" title="${esc(quiz.title)}"><qtimetadata>${field("cc_maxattempts", "1")}</qtimetadata><section ident="root_section">${canvasParts.join("")}</section></assessment></questestinterop>
`;
  const ccAssessment = `<?xml version="1.0" encoding="UTF-8"?>
<questestinterop ${QTI_NS}><assessment ident="${aid}" title="${esc(quiz.title)}"><qtimetadata>${field("cc_profile", "cc.exam.v0p1")}${field("qmd_assessmenttype", "Examination")}${field("qmd_scoretype", "Percentage")}${field("cc_maxattempts", "1")}</qtimetadata><section ident="root_section">${ccParts.join("")}</section></assessment></questestinterop>
`;
  const bid = ident(`bank:${quiz.id}`);
  const bank = `<?xml version="1.0" encoding="UTF-8"?>
<questestinterop ${QTI_NS}><objectbank ident="${bid}"><qtimetadata>${field("bank_title", `${quiz.title} (Unprompted)`)}</qtimetadata>${bankParts.join("")}</objectbank></questestinterop>
`;
  const points = exported.length.toFixed(1);
  /** Canvas quiz settings. With an assignment group, also the graded assignment Canvas attaches to the quiz. */
  const meta = (group?: string) => `<?xml version="1.0" encoding="UTF-8"?>
<quiz identifier="${aid}" xmlns="http://canvas.instructure.com/xsd/cccv1p0" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:schemaLocation="http://canvas.instructure.com/xsd/cccv1p0 https://canvas.instructure.com/xsd/cccv1p0.xsd"><title>${esc(quiz.title)}</title><description></description><shuffle_answers>false</shuffle_answers><scoring_policy>keep_highest</scoring_policy><hide_results></hide_results><quiz_type>assignment</quiz_type><points_possible>${points}</points_possible><require_lockdown_browser>false</require_lockdown_browser><show_correct_answers>false</show_correct_answers><anonymous_submissions>false</anonymous_submissions><could_be_locked>false</could_be_locked><allowed_attempts>1</allowed_attempts><one_question_at_a_time>false</one_question_at_a_time><cant_go_back>false</cant_go_back><available>false</available><one_time_results>false</one_time_results><show_correct_answers_last_attempt>false</show_correct_answers_last_attempt><only_visible_to_overrides>false</only_visible_to_overrides><module_locked>false</module_locked><assignment_group_identifierref>${group ?? ""}</assignment_group_identifierref>${group ? assignmentXml(ident(`assignment:${quiz.id}`), aid, group, quiz.title, points) : ""}</quiz>
`;
  return { aid, mid, bid, files, fileResources, canvasAssessment, ccAssessment, bank, meta, exported, skipped };
}

function assignmentXml(id: string, quizRef: string, group: string, title: string, points: string) {
  return `<assignment identifier="${id}"><title>${esc(title)}</title><due_at/><lock_at/><unlock_at/><module_locked>false</module_locked><workflow_state>unpublished</workflow_state><assignment_overrides></assignment_overrides><quiz_identifierref>${quizRef}</quiz_identifierref><allowed_extensions></allowed_extensions><has_group_category>false</has_group_category><points_possible>${points}</points_possible><grading_type>points</grading_type><all_day>false</all_day><submission_types>online_quiz</submission_types><position>1</position><turnitin_enabled>false</turnitin_enabled><vericite_enabled>false</vericite_enabled><peer_review_count>0</peer_review_count><peer_reviews>false</peer_reviews><automatic_peer_reviews>false</automatic_peer_reviews><anonymous_peer_reviews>false</anonymous_peer_reviews><grade_group_students_individually>false</grade_group_students_individually><freeze_on_copy>false</freeze_on_copy><omit_from_final_grade>false</omit_from_final_grade><intra_group_peer_reviews>false</intra_group_peer_reviews><only_visible_to_overrides>false</only_visible_to_overrides><post_to_sis>false</post_to_sis><moderated_grading>false</moderated_grading><grader_count>0</grader_count><grader_comments_visible_to_graders>true</grader_comments_visible_to_graders><anonymous_grading>false</anonymous_grading><graders_anonymous_to_graders>false</graders_anonymous_to_graders><grader_names_visible_to_final_grader>true</grader_names_visible_to_final_grader><anonymous_instructor_annotations>false</anonymous_instructor_annotations><post_policy><post_manually>false</post_manually></post_policy><assignment_group_identifierref>${group}</assignment_group_identifierref></assignment>`;
}

const CCCV = `xmlns="http://canvas.instructure.com/xsd/cccv1p0" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:schemaLocation="http://canvas.instructure.com/xsd/cccv1p0 https://canvas.instructure.com/xsd/cccv1p0.xsd"`;

/** Build a Canvas-importable QTI 1.2 zip ("QTI .zip file" import). Returns the bytes plus what was exported or skipped. */
export function exportQti(quiz: ExportQuiz): ExportResult {
  const { aid, mid, files, fileResources, canvasAssessment, meta, exported, skipped } = buildAssessment(quiz);
  const manifest = `<?xml version="1.0" encoding="UTF-8"?>
<manifest identifier="${ident(`manifest:${quiz.id}`)}" xmlns="http://www.imsglobal.org/xsd/imsccv1p1/imscp_v1p1" xmlns:lom="http://ltsc.ieee.org/xsd/imsccv1p1/LOM/resource" xmlns:imsmd="http://www.imsglobal.org/xsd/imsmd_v1p2" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:schemaLocation="http://www.imsglobal.org/xsd/imsccv1p1/imscp_v1p1 http://www.imsglobal.org/xsd/imscp_v1p1.xsd http://ltsc.ieee.org/xsd/imsccv1p1/LOM/resource http://www.imsglobal.org/profile/cc/ccv1p1/LOM/ccv1p1_lomresource_v1p0.xsd http://www.imsglobal.org/xsd/imsmd_v1p2 http://www.imsglobal.org/xsd/imsmd_v1p2p2.xsd"><metadata><schema>IMS Content</schema><schemaversion>1.1.3</schemaversion><imsmd:lom><imsmd:general><imsmd:title><imsmd:string>${esc(quiz.title)}</imsmd:string></imsmd:title></imsmd:general></imsmd:lom></metadata><organizations/><resources><resource identifier="${aid}" type="imsqti_xmlv1p2"><file href="${aid}/${aid}.xml"/><dependency identifierref="${mid}"/></resource><resource identifier="${mid}" type="associatedcontent/imscc_xmlv1p1/learning-application-resource" href="${aid}/assessment_meta.xml"><file href="${aid}/assessment_meta.xml"/></resource>${fileResources.join("")}</resources></manifest>
`;
  files["imsmanifest.xml"] = strToU8(manifest);
  files[`${aid}/${aid}.xml`] = strToU8(canvasAssessment);
  files[`${aid}/assessment_meta.xml`] = strToU8(meta());
  return { zip: zipSync(files, { level: 6 }), exported, skipped };
}

/**
 * Build an IMS Common Cartridge 1.1 package (.imscc), laid out like Canvas's own course export so
 * Canvas imports it as a Classic quiz through "Canvas Course Export Package" or "Common Cartridge 1.x":
 *   <aid>/assessment_qti.xml               the CC-profile assessment (what any CC-compliant LMS reads)
 *   non_cc_assessments/<aid>.xml.qti      the full Canvas Classic QTI (what Canvas reads instead); each item
 *                                         points at its copy in the question bank below
 *   non_cc_assessments/<bid>.xml.qti      the question bank (<objectbank>) Canvas ships beside every quiz
 *   <aid>/assessment_meta.xml             Canvas quiz settings plus the graded assignment
 *   course_settings/                      canvas_export.txt marks it as a Canvas export; assignment_groups.xml
 *                                         holds the assignment's group. No course title, so importing never
 *                                         renames the target course.
 */
export function exportCommonCartridge(quiz: ExportQuiz): ExportResult {
  const { aid, mid, bid, files, fileResources, canvasAssessment, ccAssessment, bank, meta, exported, skipped } = buildAssessment(quiz);
  const sid = ident(`settings:${quiz.id}`);
  const gid = ident(`group:${quiz.id}`);
  const SETTINGS = ["course_settings.xml", "files_meta.xml", "context.xml", "media_tracks.xml", "assignment_groups.xml", "canvas_export.txt"];
  const manifest = `<?xml version="1.0" encoding="UTF-8"?>
<manifest identifier="${ident(`manifest:${quiz.id}`)}" xmlns="http://www.imsglobal.org/xsd/imsccv1p1/imscp_v1p1" xmlns:lom="http://ltsc.ieee.org/xsd/imsccv1p1/LOM/resource" xmlns:lomimscc="http://ltsc.ieee.org/xsd/imsccv1p1/LOM/manifest" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:schemaLocation="http://www.imsglobal.org/xsd/imsccv1p1/imscp_v1p1 http://www.imsglobal.org/profile/cc/ccv1p1/ccv1p1_imscp_v1p2_v1p0.xsd http://ltsc.ieee.org/xsd/imsccv1p1/LOM/resource http://www.imsglobal.org/profile/cc/ccv1p1/LOM/ccv1p1_lomresource_v1p0.xsd http://ltsc.ieee.org/xsd/imsccv1p1/LOM/manifest http://www.imsglobal.org/profile/cc/ccv1p1/LOM/ccv1p1_lommanifest_v1p0.xsd"><metadata><schema>IMS Common Cartridge</schema><schemaversion>1.1.0</schemaversion><lomimscc:lom><lomimscc:general><lomimscc:title><lomimscc:string>${esc(quiz.title)}</lomimscc:string></lomimscc:title></lomimscc:general></lomimscc:lom></metadata><organizations><organization identifier="org_1" structure="rooted-hierarchy"><item identifier="LearningModules"/></organization></organizations><resources><resource identifier="${aid}" type="imsqti_xmlv1p2/imscc_xmlv1p1/assessment"><file href="${aid}/assessment_qti.xml"/><dependency identifierref="${mid}"/></resource><resource identifier="${mid}" type="associatedcontent/imscc_xmlv1p1/learning-application-resource" href="${aid}/assessment_meta.xml"><file href="${aid}/assessment_meta.xml"/><file href="non_cc_assessments/${aid}.xml.qti"/></resource><resource identifier="${bid}" type="associatedcontent/imscc_xmlv1p1/learning-application-resource" href="non_cc_assessments/${bid}.xml.qti"><file href="non_cc_assessments/${bid}.xml.qti"/></resource><resource identifier="${sid}" type="associatedcontent/imscc_xmlv1p1/learning-application-resource" href="course_settings/canvas_export.txt">${SETTINGS.map((f) => `<file href="course_settings/${f}"/>`).join("")}</resource>${fileResources.join("")}</resources></manifest>
`;
  const xml = (body: string) => `<?xml version="1.0" encoding="UTF-8"?>\n${body}\n`;
  files["imsmanifest.xml"] = strToU8(manifest);
  files[`${aid}/assessment_qti.xml`] = strToU8(ccAssessment);
  files[`${aid}/assessment_meta.xml`] = strToU8(meta(gid));
  files[`non_cc_assessments/${aid}.xml.qti`] = strToU8(canvasAssessment);
  files[`non_cc_assessments/${bid}.xml.qti`] = strToU8(bank);
  files["course_settings/course_settings.xml"] = strToU8(xml(`<course identifier="${sid}" ${CCCV}></course>`));
  files["course_settings/files_meta.xml"] = strToU8(xml(`<fileMeta ${CCCV}></fileMeta>`));
  files["course_settings/context.xml"] = strToU8(xml(`<context_info ${CCCV}></context_info>`));
  files["course_settings/media_tracks.xml"] = strToU8(xml(`<media_tracks ${CCCV}></media_tracks>`));
  files["course_settings/assignment_groups.xml"] = strToU8(xml(`<assignmentGroups ${CCCV}><assignmentGroup identifier="${gid}"><title>Unprompted quizzes</title><position>1</position><group_weight>0.0</group_weight></assignmentGroup></assignmentGroups>`));
  files["course_settings/canvas_export.txt"] = strToU8("Exported by Unprompted. This file marks the package as a Canvas course export.\n");
  return { zip: zipSync(files, { level: 6 }), exported, skipped };
}

// ---------------- import ----------------

const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: "@_", textNodeName: "#text", isArray: (name) => ["item", "response_label", "qtimetadatafield", "respcondition", "varequal", "section", "resource", "not"].includes(name) });

function decode(s: string) {
  return s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&");
}
/** Canvas stems are HTML: keep the text, drop tags. */
function plain(html: string) {
  return decode(decode(html).replace(/<br\s*\/?>/gi, "\n").replace(/<\/p>\s*<p[^>]*>/gi, "\n").replace(/<[^>]+>/g, "")).replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();
}
function text(node: unknown): string {
  if (node == null) return "";
  if (typeof node === "string" || typeof node === "number") return String(node);
  const n = node as Record<string, unknown>;
  return String(n["#text"] ?? "");
}
function findAll(node: unknown, key: string, out: unknown[] = []): unknown[] {
  if (!node || typeof node !== "object") return out;
  for (const [k, v] of Object.entries(node as Record<string, unknown>)) {
    if (k === key) (Array.isArray(v) ? v : [v]).forEach((x) => out.push(x));
    else if (typeof v === "object") (Array.isArray(v) ? v : [v]).forEach((x) => findAll(x, key, out));
  }
  return out;
}

/** IMS Common Cartridge 1.x question profiles -> Canvas question types. */
const CC_TYPES: Record<string, string> = {
  "cc.multiple_choice.v0p1": "multiple_choice_question",
  "cc.true_false.v0p1": "true_false_question",
  "cc.multiple_response.v0p1": "multiple_answers_question",
  "cc.fib.v0p1": "fill_in_blank",
  "cc.essay.v0p1": "essay_question",
  "cc.pattern_match.v0p1": "short_answer_question",
};

export interface QtiImportResult {
  quiz: Quiz;
  skipped: { title: string; type: string; reason: string }[];
}

/** Parse a Canvas QTI 1.2 export zip, or a Common Cartridge package (.imscc, e.g. a Canvas course export), into our Quiz. Item ids follow the convention <quizId>-q<n>. */
export function importQti(zip: Uint8Array, opts: { quizId: string; courseId: string }): QtiImportResult {
  const files = unzipSync(zip);
  const names = Object.keys(files);
  // A Canvas course export (.imscc) carries each quiz twice: the CC-profile <id>/assessment_qti.xml and the
  // full Classic QTI in non_cc_assessments/. Prefer Canvas's copy; otherwise read whatever QTI is there.
  // non_cc_assessments/ also holds question banks (<objectbank>), which are not quizzes.
  const canvasCopies = names.filter((f) => /^non_cc_assessments\/[^/]+\.xml\.qti$/.test(f) && /<assessment[\s>]/.test(strFromU8(files[f]!)));
  const assessmentFiles = canvasCopies.length ? canvasCopies : names.filter((f) => f.endsWith(".xml") && !/imsmanifest|assessment_meta|^course_settings\//.test(f));
  const items: Item[] = [];
  const skipped: QtiImportResult["skipped"] = [];
  let title = "Imported quiz";
  for (const f of assessmentFiles) {
    const doc = parser.parse(strFromU8(files[f]!));
    const assessment = findAll(doc, "assessment")[0] as Record<string, unknown> | undefined;
    if (!assessment) continue;
    title = String(assessment["@_title"] ?? title);
    for (const raw of findAll(assessment, "item") as Record<string, any>[]) {
      const meta = Object.fromEntries((findAll(raw.itemmetadata, "qtimetadatafield") as any[]).map((m) => [text(m.fieldlabel), text(m.fieldentry)]));
      let type = meta.question_type ?? CC_TYPES[meta.cc_profile ?? ""] ?? "unknown";
      const itemTitle = String(raw["@_title"] ?? "Question");
      const mattext = findAll(raw.presentation, "mattext")[0];
      const stem = plain(text(mattext));
      const conds = findAll(raw.resprocessing, "respcondition") as any[];
      const scoring = conds.find((c) => Number(text(c.setvar)) >= 100) ?? conds[0];
      if (type === "fill_in_blank") {
        // CC has no numeric type; a blank whose accepted answers are all numbers is one.
        const accepted = (findAll(scoring?.conditionvar, "varequal") as unknown[]).map((v) => text(v).trim());
        type = accepted.length && accepted.every((v) => v !== "" && Number.isFinite(Number(v))) ? "numerical_question" : "short_answer_question";
      }
      const n = items.length + 1;
      const base = { id: `${opts.quizId}-q${n}`, quizId: opts.quizId, stem, objective: itemTitle !== "Question" ? itemTitle : `Imported from Canvas: ${stem.slice(0, 60)}`, objectiveSource: "inferred" as const, originalItemId: null };
      try {
        if (type === "multiple_choice_question" || type === "true_false_question" || type === "multiple_answers_question") {
          const labels = findAll(raw.presentation, "response_label") as any[];
          const letter = new Map(labels.map((l, i) => [String(l["@_ident"]), String.fromCharCode(97 + i)]));
          const choices = labels.map((l, i) => ({ id: String.fromCharCode(97 + i), text: plain(text(findAll(l, "mattext")[0])) }));
          if (type === "multiple_answers_question") {
            const and = findAll(scoring?.conditionvar, "and")[0] as any;
            const correct = (and?.varequal ?? []).map((v: unknown) => letter.get(text(v))).filter(Boolean) as string[];
            if (!correct.length) throw new Error("no correct answers found");
            items.push({ ...base, type: "multi", choices, answerKey: correct.sort() });
          } else {
            const key = letter.get(text((findAll(scoring?.conditionvar, "varequal")[0] as unknown) ?? ""));
            if (!key) throw new Error("no correct answer found");
            items.push({ ...base, type: "mcq", choices, answerKey: key });
          }
        } else if (type === "numerical_question") {
          const eq = findAll(scoring?.conditionvar, "varequal")[0];
          const gte = findAll(scoring?.conditionvar, "vargte")[0];
          const lte = findAll(scoring?.conditionvar, "varlte")[0];
          const value = eq != null ? Number(text(eq)) : gte != null && lte != null ? (Number(text(gte)) + Number(text(lte))) / 2 : NaN;
          if (!Number.isFinite(value)) throw new Error("no numeric answer found");
          items.push({ ...base, type: "numeric", answerKey: String(+value.toFixed(6)) });
        } else {
          skipped.push({ title: itemTitle, type, reason: "question type not supported yet" });
        }
      } catch (e) {
        skipped.push({ title: itemTitle, type, reason: (e as Error).message });
      }
    }
  }
  if (!items.length) throw new Error(skipped.length ? `no supported questions (${skipped.length} skipped)` : "no QTI assessment found in the zip");
  return { quiz: { id: opts.quizId, courseId: opts.courseId, title, sourceFormat: "qti", items }, skipped };
}
