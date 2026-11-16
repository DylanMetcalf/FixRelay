import type { Prisma } from "@prisma/client";
import type { Tx } from "@/lib/db";
import type { Ctx } from "../permissions";

export interface Actor {
  orgId: string;
  userId: string | null;
  label: string;
}

export const actorOf = (ctx: Ctx): Actor => ({ orgId: ctx.orgId, userId: ctx.userId, label: ctx.userName });

/** Append one audit event. Always called inside the same transaction as the change it records. */
export function logEvent(
  tx: Tx,
  actor: Actor,
  jobId: string | null,
  type: string,
  summary: string,
  data: Prisma.InputJsonObject = {},
) {
  return tx.activityEvent.create({
    data: { orgId: actor.orgId, jobId, type, summary, actorUserId: actor.userId, actorLabel: actor.label, data },
  });
}
