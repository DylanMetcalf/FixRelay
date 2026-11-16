import { NextResponse } from "next/server";
import { AppError } from "@/lib/errors";
import { readAttachmentViaLink } from "@/server/services/attachments";
import { fileResponse } from "../../../../files/respond";

/** Files shown on a customer review page. The link token is the credential and limits what can be read. */
export async function GET(_: Request, { params }: { params: Promise<{ token: string; id: string }> }) {
  const { token, id } = await params;
  try {
    return fileResponse(await readAttachmentViaLink(token, id));
  } catch (e) {
    if (!(e instanceof AppError)) console.error(e);
    return new NextResponse("Not found", { status: 404 });
  }
}
