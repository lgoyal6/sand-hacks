// GET /studio/api/tree?quiz=sample-stats -> TreeData (owner: B). Professor area (studio layout gate).
import { getStudioData } from "../../_lib/data";
import { buildTree } from "../../_lib/tree";
import { replayJson, withReplay } from "../../_lib/replay";

export async function GET(req: Request) {
  const quiz = new URL(req.url).searchParams.get("quiz") ?? "";
  if (!/^[\w-]+$/.test(quiz)) return Response.json({ error: "quiz is required" }, { status: 400 });
  try {
    return replayJson(await withReplay(req, "tree", quiz, async () => buildTree(quiz, (await getStudioData(quiz)).experiments)));
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 503 });
  }
}
