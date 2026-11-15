#!/usr/bin/env node
// Voice think-aloud self-test, no human needed:  pnpm --filter @unprompted/web voice:selftest
//
// 1. Synthesizes two student answers with ElevenLabs TTS (16 kHz PCM): an explanation and a
//    counterfactual answer for the probed sample-stats item.
// 2. Starts a real attempt and probe through the app's own API (APP_URL, default :3100), then drives a
//    real ElevenLabs Agents conversation over the signed-URL WebSocket, streaming that audio in real time
//    as the user's microphone. The agent hears speech, calls get_followup (answered by the app's
//    /counterfactual route, Gemini only), asks the follow-up, hears the second clip, calls end_probe.
// 3. Marks the six probe_timing phases exactly like the browser does (agent VAD for speech onsets,
//    emulated audio playback for "agent stopped talking"), finishes the probe through the app, runs
//    Scribe on the call recording for word timestamps, and asserts everything in Neon and Tiger.
//
// Rows are tagged student "test-c". The ElevenLabs conversation is deleted at the end (audio is
// deleted after grading, build plan 7); pass --keep to keep it.
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const here = path.dirname(fileURLToPath(import.meta.url));
for (const f of [".env.local", ".env"]) {
  const p = path.resolve(here, "../../..", f);
  if (existsSync(p)) process.loadEnvFile(p);
}
const APP = process.env.APP_URL ?? "http://localhost:3100";
const XI = process.env.ELEVENLABS_API_KEY?.trim();
const KEEP = process.argv.includes("--keep");
const STUDENT = "test-c";
const VOICE = "SAz9YHcvj6GT2YYXdXww"; // premade "River" (a different voice from the agent's)
const SAMPLE_RATE = 16000;
const CHUNK_MS = 100;
const CHUNK_BYTES = (SAMPLE_RATE * 2 * CHUNK_MS) / 1000;
const VAD_SPEECH = 0.6; // same threshold as the browser hook

if (!XI) throw new Error("ELEVENLABS_API_KEY missing (repo-root .env.local)");
const t0 = Date.now();
const log = (...a) => console.log(`[${((Date.now() - t0) / 1000).toFixed(1).padStart(5)}s]`, ...a);
const failures = [];
const check = (ok, what) => {
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${what}`);
  if (!ok) failures.push(what);
};

async function api(p, body, method = body === undefined ? "GET" : "POST") {
  const res = await fetch(`${APP}${p}`, { method, headers: { "content-type": "application/json", "user-agent": "voice-selftest" }, body: body === undefined ? undefined : JSON.stringify(body) });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`${method} ${p} -> ${res.status} ${JSON.stringify(json)}`);
  return json;
}

// Plausible student speech per sample-stats item: an explanation and an answer to a "what if".
const SCRIPT = {
  "sample-stats-q1": ["The standard error is the standard deviation divided by the square root of n. The square root of twenty five is five, and ten divided by five is two.", "If the sample got bigger, the square root of n gets bigger, so the standard error would shrink."],
  "sample-stats-q2": ["The width depends on the standard error, which has the square root of n on the bottom. Four times the sample means the square root doubles, so the interval gets half as wide.", "If the sample only doubled, the width would shrink by the square root of two, so about seventy percent as wide, not half."],
  "sample-stats-q3": ["There are thirty six equally likely outcomes for two dice, and six of them add up to seven, like one and six or two and five. Six out of thirty six is one sixth.", "With three dice there would be six times six times six outcomes, so two hundred sixteen, and I would have to count the combinations again."],
  "sample-stats-q4": ["The p-value assumes the null hypothesis is true and asks how often data this extreme would show up. So three percent is that chance, not the chance the null is true.", "If the p-value were bigger than alpha, like eight percent, we would not reject the null, but that still would not prove it is true."],
  "sample-stats-q5": ["A type two error is missing a real effect. A bigger sample makes the estimate more precise, which raises the power, so we miss less often.", "If the effect were smaller it would be harder to detect, so the type two error would go up unless we added even more data."],
};

async function tts(text) {
  const res = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${VOICE}?output_format=pcm_16000`, {
    method: "POST",
    headers: { "xi-api-key": XI, "content-type": "application/json" },
    body: JSON.stringify({ text, model_id: "eleven_flash_v2_5" }),
  });
  if (!res.ok) throw new Error(`TTS ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return Buffer.from(await res.arrayBuffer());
}

async function main() {
  // ---- 1. Attempt + probe through the app ----
  log("starting a practice attempt on sample-stats via", APP);
  const att = await api("/api/attempts", { quizId: "sample-stats", mode: "practice", studentPseudonym: STUDENT });
  const answers = { "sample-stats-q1": "b", "sample-stats-q2": "b", "sample-stats-q3": "1/6", "sample-stats-q4": "b", "sample-stats-q5": "b" };
  let itemId = null;
  for (const [id, answer] of Object.entries(answers)) {
    const r = await api(`/api/attempts/${att.attemptId}/responses`, { itemId: id, answer, seconds: 20 });
    if (r.probe) {
      itemId = id;
      break;
    }
  }
  if (!itemId) throw new Error("no probe was triggered (practice guarantees one)");
  const [explainText, cfText] = SCRIPT[itemId];
  log(`probe on ${itemId}; synthesizing the student's two answers`);
  const [clip1, clip2] = await Promise.all([tts(explainText), tts(cfText)]);
  log(`clips: ${(clip1.length / 32000).toFixed(1)}s and ${(clip2.length / 32000).toFixed(1)}s of 16 kHz PCM`);

  const probe = await api("/api/probes", { attemptId: att.attemptId, itemId, confidenceBefore: 6, mode: "voice" });
  const voice = await api(`/api/probes/${probe.probeId}/voice`, { consent: true });
  log(`probe ${probe.probeId}; signed URL issued by the app (key stays server-side)`);

  // ---- 2. Real conversation ----
  const marks = {};
  const mark = async (phase) => {
    if (marks[phase]) return;
    marks[phase] = Date.now();
    log(`mark ${phase}`);
    await api(`/api/probes/${probe.probeId}/timing`, { phases: [{ phase, ms: marks[phase] - (marks.prompt ?? marks[phase]), ts: new Date(marks[phase]).toISOString() }] });
  };
  const userLines = [];
  const agentLines = [];
  let stage = "explain"; // explain -> followup_loading -> followup -> closing
  let conversationId = null;
  let speakingUntil = 0; // emulated playback of the agent's audio
  let agentSpoke = false;
  let wasSpeaking = false;
  let queue = []; // outgoing user audio (Buffers of CHUNK_BYTES)
  let sentClip1 = false;
  let sentClip2 = false;
  let ended = false;
  const silence = Buffer.alloc(CHUNK_BYTES);
  const enqueue = (pcm) => {
    for (let i = 0; i < pcm.length; i += CHUNK_BYTES) {
      const c = pcm.subarray(i, i + CHUNK_BYTES);
      queue.push(c.length === CHUNK_BYTES ? c : Buffer.concat([c, Buffer.alloc(CHUNK_BYTES - c.length)]));
    }
  };

  const ws = new WebSocket(voice.signedUrl);
  const done = new Promise((resolve) => (ws.onclose = resolve));
  ws.onopen = () => {
    ws.send(JSON.stringify({ type: "conversation_initiation_client_data", dynamic_variables: voice.dynamicVariables }));
  };
  ws.onmessage = async (ev) => {
    const m = JSON.parse(typeof ev.data === "string" ? ev.data : Buffer.from(ev.data).toString());
    switch (m.type) {
      case "ping":
        setTimeout(() => ws.readyState === 1 && ws.send(JSON.stringify({ type: "pong", event_id: m.ping_event.event_id })), m.ping_event.ping_ms ?? 0);
        break;
      case "conversation_initiation_metadata":
        conversationId = m.conversation_initiation_metadata_event.conversation_id;
        log("conversation", conversationId);
        break;
      case "audio": {
        const bytes = Buffer.from(m.audio_event.audio_base_64, "base64").length;
        speakingUntil = Math.max(speakingUntil, Date.now()) + (bytes / (SAMPLE_RATE * 2)) * 1000;
        agentSpoke = true;
        // The agent starting its closing line ends the student's follow-up answer (same as the browser).
        if (stage === "followup" && marks.cf_speech_start) await mark("cf_speech_end");
        break;
      }
      case "agent_response":
        agentLines.push(m.agent_response_event.agent_response);
        log("AGENT:", m.agent_response_event.agent_response);
        break;
      case "user_transcript":
        userLines.push(m.user_transcription_event.user_transcript);
        log("USER (heard):", m.user_transcription_event.user_transcript);
        break;
      case "vad_score": {
        const v = m.vad_score_event.vad_score;
        if (v < VAD_SPEECH) break;
        if (stage === "explain" && marks.prompt) await mark("speech_start");
        if (stage === "followup" && marks.cf_prompt) await mark("cf_speech_start");
        break;
      }
      case "client_tool_call": {
        const c = m.client_tool_call;
        log("TOOL", c.tool_name, JSON.stringify(c.parameters));
        if (c.tool_name === "get_followup") {
          await mark("speech_end");
          stage = "followup_loading";
          const said = userLines.join(" ") || c.parameters?.explanation_summary || "";
          const cf = await api(`/api/probes/${probe.probeId}/counterfactual`, { explanation: said });
          log(`follow-up (${cf.source}): ${cf.prompt}`);
          stage = "followup";
          ws.send(JSON.stringify({ type: "client_tool_result", tool_call_id: c.tool_call_id, result: cf.prompt, is_error: false }));
        } else if (c.tool_name === "end_probe") {
          stage = "closing";
          ws.send(JSON.stringify({ type: "client_tool_result", tool_call_id: c.tool_call_id, result: "ended", is_error: false }));
          setTimeout(() => {
            ended = true;
            ws.close();
          }, 1500);
        }
        break;
      }
      default:
        break;
    }
  };

  // Microphone loop: one chunk every CHUNK_MS (real time), speech when queued, else silence.
  // Also watches emulated playback to detect "the agent just stopped talking".
  const mic = setInterval(async () => {
    if (ws.readyState !== 1) return;
    const speaking = Date.now() < speakingUntil;
    if (wasSpeaking && !speaking && agentSpoke) {
      if (stage === "explain" && !marks.prompt) {
        await mark("prompt");
        if (!sentClip1) {
          sentClip1 = true;
          setTimeout(() => enqueue(clip1), 700); // a natural pause before answering
        }
      } else if (stage === "followup" && !marks.cf_prompt) {
        await mark("cf_prompt");
        if (!sentClip2) {
          sentClip2 = true;
          setTimeout(() => enqueue(clip2), 900);
        }
      }
    }
    wasSpeaking = speaking;
    const chunk = queue.shift() ?? silence;
    ws.send(JSON.stringify({ user_audio_chunk: chunk.toString("base64") }));
  }, CHUNK_MS);

  const timeout = setTimeout(() => {
    log("timeout after 150 s");
    ws.close();
  }, 150000);
  await done;
  clearInterval(mic);
  clearTimeout(timeout);
  log(`conversation closed (${ended ? "agent called end_probe" : "not ended by the agent"})`);

  // ---- 3. Finish through the app, as the browser does ----
  const latency = marks.cf_prompt && marks.cf_speech_start ? marks.cf_speech_start - marks.cf_prompt : undefined;
  const fin = await api(`/api/probes/${probe.probeId}/voice/finish`, { conversationId });
  await api(`/api/probes/${probe.probeId}`, { confidenceAfter: 5, counterfactualLatencyMs: latency }, "PATCH");
  log(`transcript finalized: ${fin.turns} turns, ${fin.durationSecs ?? "?"} s call`);

  // Scribe word timestamps on the call recording.
  let words = [];
  try {
    const audio = await fetch(`https://api.elevenlabs.io/v1/convai/conversations/${conversationId}/audio`, { headers: { "xi-api-key": XI } });
    if (!audio.ok) throw new Error(`audio ${audio.status}`);
    const blob = new Blob([await audio.arrayBuffer()], { type: "audio/mpeg" });
    for (const model of ["scribe_v2", "scribe_v1"]) {
      const fd = new FormData();
      fd.append("model_id", model);
      fd.append("file", blob, "call.mp3");
      fd.append("timestamps_granularity", "word");
      const r = await fetch("https://api.elevenlabs.io/v1/speech-to-text", { method: "POST", headers: { "xi-api-key": XI }, body: fd });
      if (!r.ok) continue;
      words = ((await r.json()).words ?? []).filter((w) => w.type === "word");
      log(`Scribe (${model}): ${words.length} words with timestamps`);
      break;
    }
  } catch (err) {
    log("Scribe step failed:", err.message);
  }

  // ---- 4. Assertions ----
  console.log("\nAssertions");
  check(ended, "agent ended the probe itself by calling end_probe");
  check(agentLines.length >= 3, `agent spoke ${agentLines.length} times (opening, follow-up, closing)`);
  check(userLines.length >= 2, `agent's ASR heard ${userLines.length} student turns`);
  const neon = new pg.Client({ connectionString: withCompat(process.env.DATABASE_URL) });
  const tiger = new pg.Client({ connectionString: withCompat(process.env.TIGER_DATABASE_URL) });
  await Promise.all([neon.connect(), tiger.connect()]);
  const row = (await neon.query("select p.*, a.student_pseudonym from probe p join attempt a on a.id = p.attempt_id where p.id = $1", [probe.probeId])).rows[0];
  check(!!row, "probe row in Neon");
  check(row?.student_pseudonym === STUDENT, `attempt tagged ${STUDENT}`);
  check(row?.mode === "voice" && row?.conversation_id === conversationId, "probe is voice and linked to the conversation");
  check((row?.transcript ?? "").split("\n").length >= 4, `Neon transcript has ${(row?.transcript ?? "").split("\n").length} timed lines`);
  check(!!row?.counterfactual_prompt && row.counterfactual_source !== null, `follow-up stored (${row?.counterfactual_source}, ${row?.counterfactual_model ?? "template"})`);
  check(row?.confidence_after === 5 && !!row?.completed_at, "probe completed with confidence after");
  const phases = (await tiger.query("select phase, ts, ms from probe_timing where probe_id = $1 order by ts", [probe.probeId])).rows;
  const got = new Set(phases.map((p) => p.phase));
  for (const p of ["prompt", "speech_start", "speech_end", "cf_prompt", "cf_speech_start", "cf_speech_end"]) check(got.has(p), `Tiger probe_timing has ${p}`);
  const lat = (await tiger.query("select cf_latency_ms from probe_latency where probe_id = $1", [probe.probeId]).catch(() => ({ rows: [] }))).rows[0]?.cf_latency_ms;
  check(typeof lat === "number" || typeof lat === "string", `D's probe_latency view computes cf latency: ${lat === undefined ? "n/a" : Math.round(Number(lat))} ms`);
  if (lat !== undefined) check(Number(lat) > 200 && Number(lat) < 10000, "counterfactual latency is sane (0.2-10 s)");
  check(words.length > 10 && words.every((w) => typeof w.start === "number" && typeof w.end === "number"), `Scribe word timestamps: ${words.length} words`);
  await Promise.all([neon.end(), tiger.end()]);

  console.log("\nNumbers");
  const rel = (p) => (marks[p] && marks.prompt ? `${((marks[p] - marks.prompt) / 1000).toFixed(2)} s` : "n/a");
  for (const p of ["prompt", "speech_start", "speech_end", "cf_prompt", "cf_speech_start", "cf_speech_end"]) console.log(`  ${p.padEnd(16)} +${rel(p)}`);
  console.log(`  speech onset after the opening: ${marks.speech_start && marks.prompt ? marks.speech_start - marks.prompt : "n/a"} ms`);
  console.log(`  counterfactual latency (cf_prompt -> cf_speech_start): ${latency ?? "n/a"} ms`);
  if (words.length) console.log(`  first words: ${words.slice(0, 6).map((w) => `${w.text}@${w.start.toFixed(2)}s`).join(" ")}`);
  console.log(`  probe ${probe.probeId}, attempt ${att.attemptId}, conversation ${conversationId}`);

  if (!KEEP && conversationId) {
    const del = await fetch(`https://api.elevenlabs.io/v1/convai/conversations/${conversationId}`, { method: "DELETE", headers: { "xi-api-key": XI } });
    console.log(`  ElevenLabs conversation deleted: ${del.ok}`);
  }
  console.log(failures.length ? `\nFAILED: ${failures.length} check(s)` : "\nALL CHECKS PASSED");
  process.exit(failures.length ? 1 : 0);
}

function withCompat(url) {
  const u = new URL(url);
  if (u.searchParams.get("sslmode") === "require") u.searchParams.set("uselibpqcompat", "true");
  return u.toString();
}

main().catch((err) => {
  console.error("voice self-test crashed:", err);
  process.exit(2);
});
