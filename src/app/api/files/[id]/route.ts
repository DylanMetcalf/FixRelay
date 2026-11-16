import { NextResponse } from "next/server";
import { getSession } from "@/app/_lib/session";
import { AppError } from "@/lib/errors";
import { readAttachment } from "@/server/services/attachments";
import { fileResponse } from "../respond";

/** Private attachment download for signed-in members. Authorisation happens in readAttachment. */
export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const s = await getSession();
  if (!s?.ctx) return new NextResponse("Not found", { status: 404 });
  try {
    return fileResponse(await readAttachment(s.ctx, (await params).id));
  } catch (e) {
    if (!(e instanceof AppError)) console.error(e);
    return new NextResponse("Not found", { status: 404 });
  }
}
