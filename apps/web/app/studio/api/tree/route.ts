// GET /studio/api/tree?quiz=sample-stats -> TreeData (owner: B). Professor area (studio layout gate).
import { getStudioData } from "../../_lib/data";
import { buildTree } from "../../_lib/tree";

export async function GET(req: Request) {
  const quiz = new URL(req.url).searchParams.get("quiz") ?? "";
  if (!/^[\w-]+$/.test(quiz)) return Response.json({ error: "quiz is required" }, { status: 400 });
  const data = await getStudioData(quiz);
  return Response.json(await buildTree(quiz, data.experiments));
}
