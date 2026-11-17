import { NextResponse } from "next/server";
import { getSession } from "@/app/_lib/session";
import { prisma } from "@/lib/db";
import { can } from "@/server/permissions";
import { STATUS_LABEL } from "@/server/workflow";

/** Jobs reported in a period as CSV (opens in Excel / Google Sheets). Managers and owners only. */
export async function GET(req: Request) {
  const s = await getSession();
  if (!s?.ctx || !can(s.ctx, "reports.view")) return new NextResponse("Not found", { status: 404 });
  const q = new URL(req.url).searchParams;
  const date = (v: string | null, d: Date) => (v && !Number.isNaN(Date.parse(v)) ? new Date(v) : d);
  const from = date(q.get("from"), new Date(Date.now() - 30 * 86_400_000));
  const to = new Date(date(q.get("to"), new Date()).getTime() + 86_400_000);
  const clientId = q.get("clientId") && /^[0-9a-f-]{36}$/.test(q.get("clientId")!) ? q.get("clientId")! : undefined;
  const jobs = await prisma.job.findMany({
    where: { orgId: s.ctx.orgId, reportedAt: { gte: from, lt: to }, ...(clientId ? { clientId } : {}) },
    include: { client: { select: { name: true } }, site: { select: { name: true } }, quotes: { where: { status: "APPROVED" }, select: { totalCents: true } }, updates: { select: { labourMinutes: true, materialCostCents: true } } },
    orderBy: { reportedAt: "asc" }, take: 20_000,
  });
  const ids = [...new Set(jobs.map((j) => j.leadTechnicianId).filter((x): x is string => !!x))];
  const names = Object.fromEntries((await prisma.user.findMany({ where: { id: { in: ids } }, select: { id: true, name: true } })).map((u) => [u.id, u.name]));
  // Neutralise spreadsheet formulas (=, +, -, @) and quote every cell.
  const cell = (v: unknown) => { let t = v == null ? "" : String(v); if (/^[=+\-@\t\r]/.test(t)) t = `'${t}`; return `"${t.replace(/"/g, '""')}"`; };
  const iso = (d: Date | null) => (d ? d.toISOString() : "");
  const rows = [["Reference", "Title", "Customer", "Site", "Category", "Priority", "Emergency", "Status", "Technician", "Reported", "First response", "Assigned", "Completed", "Closed", "Due", "Approved quotes incl. VAT (R)", "Labour hours", "Materials (R)"]];
  for (const j of jobs) rows.push([
    j.reference, j.title, j.client.name, j.site.name, j.category, j.priority, j.emergency ? "yes" : "no", STATUS_LABEL[j.status],
    j.leadTechnicianId ? (names[j.leadTechnicianId] ?? "") : "", iso(j.reportedAt), iso(j.respondedAt), iso(j.assignedAt), iso(j.completedAt), iso(j.closedAt), iso(j.dueAt),
    (j.quotes.reduce((a, x) => a + x.totalCents, 0) / 100).toFixed(2), (j.updates.reduce((a, u) => a + u.labourMinutes, 0) / 60).toFixed(1),
    (j.updates.reduce((a, u) => a + u.materialCostCents, 0) / 100).toFixed(2),
  ]);
  return new NextResponse("﻿" + rows.map((r) => r.map(cell).join(",")).join("\r\n"), {
    headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="fixrelay-jobs-${from.toISOString().slice(0, 10)}.csv"`, "Cache-Control": "private, no-store" },
  });
}
