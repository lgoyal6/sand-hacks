import { NextResponse } from "next/server";
import { getViewer } from "@/lib/auth/server";
import { loadClassProgress } from "../../../_lib/class";

// Professor-only class roster: every student's attempts, responses and think-alouds (pseudonyms only).
export async function GET(req: Request) {
  const viewer = await getViewer();
  if (!viewer || viewer.role !== "professor") return NextResponse.json({ error: "professors only" }, { status: 403 });
  const quiz = new URL(req.url).searchParams.get("quiz") ?? undefined;
  if (quiz && !/^[\w-]{1,64}$/.test(quiz)) return NextResponse.json({ error: "bad quiz" }, { status: 400 });
  return NextResponse.json({ students: await loadClassProgress({ quizId: quiz }) });
}
