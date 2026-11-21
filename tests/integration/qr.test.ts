import { describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { renderQrSigns } from "@/server/pdf/qr-sign";
import * as jobs from "@/server/services/jobs";
import * as sites from "@/server/services/sites";
import { code, readPdf, tenant } from "../helpers";

describe("QR reporting links and signs", () => {
  it("short codes identify the site, area or machine without database ids; old links still work until replaced", async () => {
    const t = await tenant();
    const site = await prisma.site.findUniqueOrThrow({ where: { id: t.site.id } });
    const loc = await prisma.location.findUniqueOrThrow({ where: { id: t.location.id } });
    const asset = await prisma.asset.findUniqueOrThrow({ where: { id: t.asset.id } });
    for (const c of [site.publicCode, loc.publicCode, asset.publicCode]) expect(c).toMatch(/^[a-hj-km-np-z2-9]{10}$/);
    expect(await sites.resolvePublicCode(site.publicCode!)).toMatchObject({ site: { id: site.id }, locationId: null, assetId: null });
    expect(await sites.resolvePublicCode(loc.publicCode!)).toMatchObject({ site: { id: site.id }, locationId: loc.id });
    expect(await sites.resolvePublicCode(asset.publicCode!)).toMatchObject({ locationId: loc.id, assetId: asset.id });
    expect(await sites.resolvePublicCode(site.publicToken, { l: loc.id })).toMatchObject({ locationId: loc.id }); // printed before the upgrade
    expect(await sites.resolvePublicCode("zzzzzzzzzz")).toBeNull();
    expect(await sites.resolvePublicCode("../../etc")).toBeNull();

    await sites.rotateSiteToken(t.owner, site.id);
    expect(await sites.resolvePublicCode(site.publicCode!)).toBeNull();
    expect(await sites.resolvePublicCode(loc.publicCode!)).toBeNull();
    expect(await sites.resolvePublicCode(site.publicToken)).toBeNull();
  });

  it("anyone reports with just a name (contact optional); a second submit of the same form returns the same report", async () => {
    const t = await tenant();
    await prisma.organisation.update({ where: { id: t.orgId }, data: { publicReportingEnabled: true } });
    const loc = await prisma.location.findUniqueOrThrow({ where: { id: t.location.id } });
    const input = { title: "Leak", description: "Water on the floor by the door", reporterName: "Thabo", reporterPhone: "", reporterEmail: "", locationId: t.location.id, submissionKey: "abcdef0123456789" };
    const a = await jobs.createPublicReport(loc.publicCode!, input);
    const b = await jobs.createPublicReport(loc.publicCode!, input);
    expect(b.reference).toBe(a.reference);
    expect(await prisma.job.count({ where: { orgId: t.orgId } })).toBe(1);
    const job = await prisma.job.findFirstOrThrow({ where: { orgId: t.orgId } });
    expect(job).toMatchObject({ reporterName: "Thabo", reporterPhone: null, source: "PUBLIC_LINK" });
    await expect(jobs.createPublicReport(loc.publicCode!, { ...input, submissionKey: undefined, reporterPhone: "12" })).rejects.toEqual(code("INVALID"));
    await expect(jobs.createPublicReport(loc.publicCode!, { ...input, submissionKey: undefined, reporterName: "" })).rejects.toEqual(code("INVALID"));
  });

  it("prints an A4 sign per area with the QR code, the short link and the safety note (site managers only)", async () => {
    const t = await tenant();
    await sites.createLocation(t.owner, { siteId: t.site.id, name: "Workshop" });
    const { bytes, filename } = await renderQrSigns(t.manager, t.site.id);
    expect(filename).toBe("RESULTRA_QR_Signs_Germiston_Plant.pdf");
    if (process.env.PDF_OUT) (await import("node:fs")).writeFileSync(`${process.env.PDF_OUT}/signs.pdf`, bytes);
    const pdf = await readPdf(bytes);
    expect(pdf.pages).toHaveLength(3); // site + Cold Room 2 + Workshop
    expect(pdf.pages[0]!.width).toBeCloseTo(595.28, 0);
    const site = await prisma.site.findUniqueOrThrow({ where: { id: t.site.id } });
    expect(pdf.pages[0]!.text).toContain("Need to report a maintenance issue?");
    expect(pdf.pages[0]!.text).toContain(`test.local/r/${site.publicCode}`);
    expect(pdf.text).toContain("Workshop");
    expect(pdf.text).toContain("emergency procedure");
    expect(pdf.pages.every((p) => p.images >= 1)).toBe(true);
    await expect(renderQrSigns(t.tech, t.site.id)).rejects.toEqual(code("FORBIDDEN"));
    const other = await tenant();
    await expect(renderQrSigns(other.owner, t.site.id)).rejects.toEqual(code("NOT_FOUND"));
  });
});
