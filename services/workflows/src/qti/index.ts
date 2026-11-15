// Canvas Classic Quizzes QTI 1.2: import an export zip into our Quiz, and export items back as a
// Canvas-importable zip (imsmanifest.xml + <id>/<id>.xml + <id>/assessment_meta.xml, figures as files).
// Supported: multiple_choice_question, multiple_answers_question, numerical_question.
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

function itemXml(it: QtiItem, figureHref?: string): string {
  const id = ident(it.id);
  const html = `<div><p>${esc(it.stem)}</p>${figureHref ? `<p><img src="$IMS-CC-FILEBASE$/${encodeURI(figureHref)}" alt="${esc(it.figure?.alt ?? "")}"></p>` : ""}</div>`;
  const stem = `<material><mattext texttype="text/html">${esc(html)}</mattext></material>`;
  const correct = Array.isArray(it.answerKey) ? it.answerKey : [it.answerKey];
  if (it.type === "mcq" || it.type === "multi") {
    const choices = it.choices ?? [];
    const cid = (c: { id: string }) => ident(`${it.id}:${c.id}`);
    const labels = choices.map((c) => `<response_label ident="${cid(c)}"><material><mattext texttype="text/plain">${esc(c.text)}</mattext></material></response_label>`).join("");
    const multi = it.type === "multi";
    const cond = multi
      ? `<and>${choices.map((c) => (correct.includes(c.id) ? `<varequal respident="response1">${cid(c)}</varequal>` : `<not><varequal respident="response1">${cid(c)}</varequal></not>`)).join("")}</and>`
      : `<varequal respident="response1">${cid(choices.find((c) => c.id === correct[0])!)}</varequal>`;
    return `<item ident="${id}" title="${esc(it.objective || "Question")}"><itemmetadata><qtimetadata>${field("question_type", multi ? "multiple_answers_question" : "multiple_choice_question")}${field("points_possible", "1.0")}${field("original_answer_ids", choices.map(cid).join(","))}${field("assessment_question_identifierref", ident(`aq:${it.id}`))}</qtimetadata></itemmetadata><presentation>${stem}<response_lid ident="response1" rcardinality="${multi ? "Multiple" : "Single"}"><render_choice>${labels}</render_choice></response_lid></presentation><resprocessing><outcomes><decvar maxvalue="100" minvalue="0" varname="SCORE" vartype="Decimal"/></outcomes><respcondition continue="No"><conditionvar>${cond}</conditionvar><setvar action="Set" varname="SCORE">100</setvar></respcondition></resprocessing></item>`;
  }
  if (it.type === "numeric") {
    const { value, margin } = numericKey(String(correct[0]));
    const cond = margin
      ? `<or><varequal respident="response1">${value}</varequal><and><vargte respident="response1">${+(value - margin).toFixed(6)}</vargte><varlte respident="response1">${+(value + margin).toFixed(6)}</varlte></and></or>`
      : `<varequal respident="response1">${value}</varequal>`;
    return `<item ident="${id}" title="${esc(it.objective || "Question")}"><itemmetadata><qtimetadata>${field("question_type", "numerical_question")}${field("points_possible", "1.0")}${field("assessment_question_identifierref", ident(`aq:${it.id}`))}</qtimetadata></itemmetadata><presentation>${stem}<response_str ident="response1" rcardinality="Single"><render_fib fibtype="Decimal"><response_label ident="answer1"/></render_fib></response_str></presentation><resprocessing><outcomes><decvar maxvalue="100" minvalue="0" varname="SCORE" vartype="Decimal"/></outcomes><respcondition continue="No"><conditionvar>${cond}</conditionvar><setvar action="Set" varname="SCORE">100</setvar></respcondition></resprocessing></item>`;
  }
  throw new Error(`QTI export: unsupported item type ${it.type} (${it.id})`);
}

/** Build a Canvas-importable QTI 1.2 zip. Returns the bytes plus what was exported or skipped. */
export function exportQti(quiz: { id: string; title: string; items: QtiItem[] }): { zip: Uint8Array; exported: string[]; skipped: { id: string; reason: string }[] } {
  const aid = ident(`assessment:${quiz.id}`);
  const files: Record<string, Uint8Array> = {};
  const fileResources: string[] = [];
  const parts: string[] = [];
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
      parts.push(itemXml(it, href));
      exported.push(it.id);
    } catch (e) {
      skipped.push({ id: it.id, reason: (e as Error).message });
    }
  }
  const assessment = `<?xml version="1.0" encoding="UTF-8"?>
<questestinterop xmlns="http://www.imsglobal.org/xsd/ims_qtiasiv1p2" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:schemaLocation="http://www.imsglobal.org/xsd/ims_qtiasiv1p2 http://www.imsglobal.org/xsd/ims_qtiasiv1p2p1.xsd"><assessment ident="${aid}" title="${esc(quiz.title)}"><qtimetadata>${field("cc_maxattempts", "1")}</qtimetadata><section ident="root_section">${parts.join("")}</section></assessment></questestinterop>
`;
  const meta = `<?xml version="1.0" encoding="UTF-8"?>
<quiz identifier="${aid}" xmlns="http://canvas.instructure.com/xsd/cccv1p0" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:schemaLocation="http://canvas.instructure.com/xsd/cccv1p0 https://canvas.instructure.com/xsd/cccv1p0.xsd"><title>${esc(quiz.title)}</title><description></description><shuffle_answers>false</shuffle_answers><scoring_policy>keep_highest</scoring_policy><hide_results></hide_results><quiz_type>assignment</quiz_type><points_possible>${exported.length.toFixed(1)}</points_possible><require_lockdown_browser>false</require_lockdown_browser><show_correct_answers>false</show_correct_answers><anonymous_submissions>false</anonymous_submissions><could_be_locked>false</could_be_locked><allowed_attempts>1</allowed_attempts><one_question_at_a_time>false</one_question_at_a_time><cant_go_back>false</cant_go_back><available>false</available><one_time_results>false</one_time_results><show_correct_answers_last_attempt>false</show_correct_answers_last_attempt><only_visible_to_overrides>false</only_visible_to_overrides><module_locked>false</module_locked><assignment_group_identifierref></assignment_group_identifierref></quiz>
`;
  const mid = ident(`meta:${quiz.id}`);
  const manifest = `<?xml version="1.0" encoding="UTF-8"?>
<manifest identifier="${ident(`manifest:${quiz.id}`)}" xmlns="http://www.imsglobal.org/xsd/imsccv1p1/imscp_v1p1" xmlns:lom="http://ltsc.ieee.org/xsd/imsccv1p1/LOM/resource" xmlns:imsmd="http://www.imsglobal.org/xsd/imsmd_v1p2" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:schemaLocation="http://www.imsglobal.org/xsd/imsccv1p1/imscp_v1p1 http://www.imsglobal.org/xsd/imscp_v1p1.xsd http://ltsc.ieee.org/xsd/imsccv1p1/LOM/resource http://www.imsglobal.org/profile/cc/ccv1p1/LOM/ccv1p1_lomresource_v1p0.xsd http://www.imsglobal.org/xsd/imsmd_v1p2 http://www.imsglobal.org/xsd/imsmd_v1p2p2.xsd"><metadata><schema>IMS Content</schema><schemaversion>1.1.3</schemaversion><imsmd:lom><imsmd:general><imsmd:title><imsmd:string>${esc(quiz.title)}</imsmd:string></imsmd:title></imsmd:general></imsmd:lom></metadata><organizations/><resources><resource identifier="${aid}" type="imsqti_xmlv1p2"><file href="${aid}/${aid}.xml"/><dependency identifierref="${mid}"/></resource><resource identifier="${mid}" type="associatedcontent/imscc_xmlv1p1/learning-application-resource" href="${aid}/assessment_meta.xml"><file href="${aid}/assessment_meta.xml"/></resource>${fileResources.join("")}</resources></manifest>
`;
  files["imsmanifest.xml"] = strToU8(manifest);
  files[`${aid}/${aid}.xml`] = strToU8(assessment);
  files[`${aid}/assessment_meta.xml`] = strToU8(meta);
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

export interface QtiImportResult {
  quiz: Quiz;
  skipped: { title: string; type: string; reason: string }[];
}

/** Parse a Canvas QTI 1.2 export zip into our Quiz. Item ids follow the convention <quizId>-q<n>. */
export function importQti(zip: Uint8Array, opts: { quizId: string; courseId: string }): QtiImportResult {
  const files = unzipSync(zip);
  const assessmentFiles = Object.keys(files).filter((f) => f.endsWith(".xml") && !/imsmanifest|assessment_meta/.test(f));
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
      const type = meta.question_type ?? "unknown";
      const itemTitle = String(raw["@_title"] ?? "Question");
      const mattext = findAll(raw.presentation, "mattext")[0];
      const stem = plain(text(mattext));
      const conds = findAll(raw.resprocessing, "respcondition") as any[];
      const scoring = conds.find((c) => Number(text(c.setvar)) >= 100) ?? conds[0];
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
