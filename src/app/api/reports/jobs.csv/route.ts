import { NextResponse } from "next/server";
import { getSession } from "@/app/_lib/session";
import { prisma } from "@/lib/db";
import { can } from "@/server/permissions";
import { ROOT_CAUSE_LABEL, STATUS_LABEL } from "@/server/workflow";

/** Jobs reported in a period as CSV (opens in Excel / Google Sheets). Managers and owners only. */
export async function GET(req: Request) {
  const s = await getSession();
  if (!s?.ctx || !can(s.ctx, "reports.view")) return new NextResponse("Not found", { status: 404 });
  const q = new URL(req.url).searchParams;
  const date = (v: string | null, d: Date) => (v && !Number.isNaN(Date.parse(v)) ? new Date(v) : d);
  const from = date(q.get("from"), new Date(Date.now() - 30 * 86_400_000));
  const to = new Date(date(q.get("to"), new Date()).getTime() + 86_400_000);
  const siteId = q.get("siteId") && /^[0-9a-f-]{36}$/.test(q.get("siteId")!) ? q.get("siteId")! : undefined;
  const locationId = q.get("locationId") && /^[0-9a-f-]{36}$/.test(q.get("locationId")!) ? q.get("locationId")! : undefined;
  const scope = s.ctx.siteIds.length ? { siteId: { in: s.ctx.siteIds } } : {};
  const jobs = await prisma.job.findMany({
    where: { orgId: s.ctx.orgId, reportedAt: { gte: from, lt: to }, ...scope, ...(siteId ? { siteId } : {}), ...(locationId ? { locationId } : {}) },
    include: { site: { select: { name: true } }, location: { select: { name: true } }, asset: { select: { reference: true } }, contractor: { select: { name: true } }, updates: { select: { labourMinutes: true, materialCostCents: true } }, completions: { orderBy: { version: "desc" }, take: 1, select: { rootCauses: true, rootCauseNotes: true } } },
    orderBy: { reportedAt: "asc" }, take: 20_000,
  });
  const ids = [...new Set(jobs.map((j) => j.leadTechnicianId).filter((x): x is string => !!x))];
  const names = Object.fromEntries((await prisma.user.findMany({ where: { id: { in: ids } }, select: { id: true, name: true } })).map((u) => [u.id, u.name]));
  // Neutralise spreadsheet formulas (=, +, -, @) and quote every cell.
  const cell = (v: unknown) => { let t = v == null ? "" : String(v); if (/^[=+\-@\t\r]/.test(t)) t = `'${t}`; return `"${t.replace(/"/g, '""')}"`; };
  const iso = (d: Date | null) => (d ? d.toISOString() : "");
  const rows = [["Reference", "Title", "Site", "Location", "Equipment", "Category", "Priority", "Emergency", "Status", "Fixed by", "Technician / contractor", "Reported via", "Reported", "First response", "Assigned", "Completed", "Closed", "Due", "Approved contractor value incl. VAT (R)", "PO number", "In-house labour hours", "In-house materials (R)", "Project", "Root causes", "Root cause notes"]];
  for (const j of jobs) rows.push([
    j.reference, j.title, j.site.name, j.location?.name ?? "", j.asset?.reference ?? "", j.category, j.priority, j.emergency ? "yes" : "no", STATUS_LABEL[j.status],
    j.route === "CONTRACTOR" ? "Contractor" : j.route === "IN_HOUSE" ? "In-house" : "", j.route === "CONTRACTOR" ? (j.contractor?.name ?? "") : (j.leadTechnicianId ? (names[j.leadTechnicianId] ?? "") : ""),
    j.source === "PUBLIC_LINK" ? "Public link" : "App", iso(j.reportedAt), iso(j.respondedAt), iso(j.assignedAt), iso(j.completedAt), iso(j.closedAt), iso(j.dueAt),
    j.approvedCostCents != null ? (j.approvedCostCents / 100).toFixed(2) : "", j.poNumber ?? "", (j.updates.reduce((a, u) => a + u.labourMinutes, 0) / 60).toFixed(1),
    (j.updates.reduce((a, u) => a + u.materialCostCents, 0) / 100).toFixed(2),
    j.isProject ? "yes" : "no", (j.completions[0]?.rootCauses ?? []).map((c) => ROOT_CAUSE_LABEL[c]).join("; "), j.completions[0]?.rootCauseNotes ?? "",
  ]);
  return new NextResponse("﻿" + rows.map((r) => r.map(cell).join(",")).join("\r\n"), {
    headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="fixrelay-jobs-${locationId ? "area-" : ""}${from.toISOString().slice(0, 10)}.csv"`, "Cache-Control": "private, no-store" },
  });
}
