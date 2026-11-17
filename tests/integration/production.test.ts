import { once } from "node:events";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { randomUUID } from "node:crypto";
import sharp from "sharp";
import { SMTPServer } from "smtp-server";
import S3rver from "s3rver";
import { afterAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { rateLimit } from "@/lib/rate-limit";
import { hashToken } from "@/lib/tokens";
import { loadSession, login } from "@/server/auth";
import { renderEmailHtml, resendTransport, smtpTransport, transportFromEnv } from "@/server/email";
import { clamdScan, pdfActiveContent, scanFile } from "@/server/scan";
import { createStorage, S3Storage } from "@/server/storage";
import * as account from "@/server/services/account";
import * as approvals from "@/server/services/approvals";
import { addJobAttachment, readAttachment } from "@/server/services/attachments";
import { processOutbox, purgeRetention } from "@/server/services/notifications";
import * as orgs from "@/server/services/orgs";
import { assessedJob, code, newJob, PNG, tenant, uniq } from "../helpers";
import * as quotes from "@/server/services/quotes";

const PASSWORD = "correct-horse-battery";
const EICAR = "X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*";
const tokenFrom = (body: string, path: string) => new RegExp(`/${path}/([A-Za-z0-9_-]{43})`).exec(body)?.[1];
const lastEmail = (to: string) => prisma.outboxEmail.findFirst({ where: { toEmail: to }, orderBy: { createdAt: "desc" } });

async function freshUser() {
  const email = `acct-${uniq()}@example.com`;
  const reg = await orgs.registerCompany({ name: "Ann Account", companyName: `Acct Co ${uniq()}`, email, password: PASSWORD });
  return { email, ...reg };
}

describe("email verification", () => {
  it("new sign-ups must confirm their email before emailing other people; the link works once", async () => {
    const u = await freshUser();
    const s = (await loadSession(u.token))!;
    expect(s.user.emailVerified).toBe(false);
    expect(s.ctx!.emailVerified).toBe(false);
    const mail = await lastEmail(u.email);
    expect(mail?.subject).toMatch(/Confirm your email/);
    const token = tokenFrom(mail!.body, "verify-email")!;
    expect(await prisma.authToken.count({ where: { tokenHash: token } })).toBe(0); // only the hash is stored

    await expect(orgs.inviteMember(s.ctx!, { email: `t${uniq()}@example.com`, roles: ["TECHNICIAN"] })).rejects.toThrow(/confirm your email/);
    expect(await account.verifyEmail("A".repeat(43))).toBe(false);
    expect(await account.verifyEmail(token)).toBe(true);
    expect(await account.verifyEmail(token)).toBe(false); // single use
    const s2 = (await loadSession(u.token))!;
    expect(s2.ctx!.emailVerified).toBe(true);
    await orgs.inviteMember(s2.ctx!, { email: `t${uniq()}@example.com`, roles: ["TECHNICIAN"] });
    await expect(account.resendVerification(s2.ctx!)).rejects.toEqual(code("CONFLICT"));
  });

  it("an unverified manager cannot send contractor quote requests; resending invalidates the old link", async () => {
    const t = await tenant();
    const job = await assessedJob(t);
    await prisma.user.update({ where: { id: t.manager.userId }, data: { emailVerifiedAt: null } });
    const unverified = { ...t.manager, emailVerified: false };
    await expect(quotes.requestQuotes(unverified, job.id, { contractorIds: [t.contractors[0].id], scope: "Quote please", deadline: null })).rejects.toThrow(/confirm your email/);
    await account.resendVerification(unverified);
    const first = tokenFrom((await lastEmail(t.manager.userEmail))!.body, "verify-email")!;
    await account.resendVerification(unverified);
    const second = tokenFrom((await lastEmail(t.manager.userEmail))!.body, "verify-email")!;
    expect(await account.verifyEmail(first)).toBe(false);
    expect(await account.verifyEmail(second)).toBe(true);
  });

  it("accepting an invitation counts as a confirmed email", async () => {
    const t = await tenant();
    const email = `inv-${uniq()}@example.com`;
    const inv = await orgs.inviteMember(t.owner, { email, roles: ["TECHNICIAN"] });
    await orgs.acceptInvitation(inv.token, { name: "Ina Invited", password: PASSWORD });
    expect((await prisma.user.findUniqueOrThrow({ where: { email } })).emailVerifiedAt).not.toBeNull();
  });
});

describe("password reset", () => {
  it("does not reveal whether an email exists", async () => {
    const before = await prisma.outboxEmail.count();
    await account.requestPasswordReset(`nobody-${uniq()}@example.com`);
    await account.requestPasswordReset("not-an-email");
    expect(await prisma.outboxEmail.count()).toBe(before);
  });

  it("resets with a single-use link, signs out every device, and confirms the email", async () => {
    const u = await freshUser();
    const other = await login(u.email, PASSWORD);
    await account.requestPasswordReset(u.email.toUpperCase());
    const token = tokenFrom((await lastEmail(u.email))!.body, "reset-password")!;
    expect(await account.isResetTokenValid(token)).toBe(true);
    await expect(account.resetPassword(token, "short")).rejects.toEqual(code("INVALID"));
    expect(await account.isResetTokenValid(token)).toBe(true); // a weak password does not burn the link

    const session = await account.resetPassword(token, "a-brand-new-password");
    expect(await loadSession(u.token)).toBeNull();
    expect(await loadSession(other)).toBeNull();
    expect((await loadSession(session))?.user.emailVerified).toBe(true);
    await expect(login(u.email, PASSWORD)).rejects.toEqual(code("UNAUTHENTICATED"));
    await login(u.email, "a-brand-new-password");
    await expect(account.resetPassword(token, "another-new-password")).rejects.toEqual(code("NOT_FOUND"));
    expect((await lastEmail(u.email))!.subject).toMatch(/password was changed/);
  });

  it("expired links fail, and only the newest link works", async () => {
    const u = await freshUser();
    await account.requestPasswordReset(u.email);
    const t1 = tokenFrom((await lastEmail(u.email))!.body, "reset-password")!;
    await account.requestPasswordReset(u.email);
    const t2 = tokenFrom((await lastEmail(u.email))!.body, "reset-password")!;
    expect(await account.isResetTokenValid(t1)).toBe(false);
    await prisma.authToken.update({ where: { tokenHash: hashToken(t2) }, data: { expiresAt: new Date(Date.now() - 1000) } });
    await expect(account.resetPassword(t2, "a-brand-new-password")).rejects.toEqual(code("NOT_FOUND"));
  });

  it("concurrent use of one reset link succeeds exactly once", async () => {
    const u = await freshUser();
    await account.requestPasswordReset(u.email);
    const token = tokenFrom((await lastEmail(u.email))!.body, "reset-password")!;
    const rs = await Promise.allSettled([1, 2, 3, 4].map((i) => account.resetPassword(token, `concurrent-password-${i}`)));
    expect(rs.filter((r) => r.status === "fulfilled")).toHaveLength(1);
  });
});

describe("shared rate limiter (Postgres)", () => {
  it("counts atomically across concurrent requests and resets after the window", async () => {
    const key = `test:${randomUUID()}`;
    const rs = await Promise.allSettled(Array.from({ length: 12 }, () => rateLimit(key, 5, 60_000)));
    expect(rs.filter((r) => r.status === "fulfilled")).toHaveLength(5);
    expect((await prisma.rateLimit.findUniqueOrThrow({ where: { key } })).count).toBe(12);
    const short = `test:${randomUUID()}`;
    await rateLimit(short, 1, 1000);
    await expect(rateLimit(short, 1, 1000)).rejects.toEqual(code("RATE_LIMITED"));
    await new Promise((r) => setTimeout(r, 1100));
    await rateLimit(short, 1, 1000);
  });
});

describe("file storage drivers", () => {
  const key = () => `${randomUUID()}/${randomUUID()}`;
  it("db driver (default) round-trips bytes and rejects unsafe keys", async () => {
    const s = createStorage({ STORAGE_DRIVER: "db" } as unknown as NodeJS.ProcessEnv);
    const k = key();
    await s.put(k, PNG, "image/png");
    expect((await s.get(k)).equals(PNG)).toBe(true);
    await expect(s.put("../../etc/passwd", PNG, "image/png")).rejects.toThrow(/Invalid storage key/);
  });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let s3: any;
  afterAll(async () => { await s3?.close(); });
  it("s3 driver works against an S3-compatible server (s3rver)", async () => {
    s3 = new S3rver({ port: 0, address: "127.0.0.1", silent: true, directory: `./.storage-test/s3-${uniq()}`, configureBuckets: [{ name: "fixrelay-test", configs: [] }] });
    const { port } = (await s3.run()) as AddressInfo;
    const st = new S3Storage("fixrelay-test", { region: "us-east-1", endpoint: `http://127.0.0.1:${port}`, accessKeyId: "S3RVER", secretAccessKey: "S3RVER", forcePathStyle: true });
    const k = key();
    const big = Buffer.concat([PNG, Buffer.alloc(3 * 1024 * 1024, 7)]);
    await st.put(k, big, "image/png");
    expect((await st.get(k)).equals(big)).toBe(true);
    await expect(st.get(key())).rejects.toThrow();
    expect(() => createStorage({ STORAGE_DRIVER: "s3" } as unknown as NodeJS.ProcessEnv)).toThrow(/S3_BUCKET/);
  });
});

describe("upload safety: antivirus, PDF active content, photo metadata", () => {
  const clam = process.env.CLAMAV_TEST_PORT ? Number(process.env.CLAMAV_TEST_PORT) : 0;
  it.skipIf(!clam)("real ClamAV (clamd INSTREAM) flags an infected PDF and passes a clean one", async () => {
    const infected = Buffer.from(`%PDF-1.4\n${EICAR}\n%%EOF`);
    expect(await clamdScan(infected, { port: clam })).toMatch(/EICAR/);
    expect(await clamdScan(Buffer.from("%PDF-1.4 clean report\n%%EOF"), { port: clam })).toBeNull();
    const env = { CLAMAV_HOST: "127.0.0.1", CLAMAV_PORT: String(clam) } as unknown as NodeJS.ProcessEnv;
    expect(await scanFile(infected, "application/pdf", env)).toMatchObject({ ok: false });
    expect(await scanFile(PNG, "image/png", env)).toEqual({ ok: true });
    // Through the real upload path:
    process.env.CLAMAV_HOST = "127.0.0.1"; process.env.CLAMAV_PORT = String(clam);
    try {
      const t = await tenant();
      const job = await newJob(t);
      await expect(addJobAttachment(t.manager, { jobId: job.id, kind: "REQUEST", filename: "report.pdf", bytes: infected })).rejects.toThrow(/virus scanner/);
      expect(await prisma.attachment.count({ where: { jobId: job.id } })).toBe(0);
    } finally { delete process.env.CLAMAV_HOST; delete process.env.CLAMAV_PORT; }
  });

  it("fails closed when ClamAV is configured but unreachable", async () => {
    const r = await scanFile(PNG, "image/png", { CLAMAV_HOST: "127.0.0.1", CLAMAV_PORT: "1" } as unknown as NodeJS.ProcessEnv);
    expect(r).toMatchObject({ ok: false, reason: expect.stringMatching(/could not be virus-scanned/) });
  });

  it("refuses PDFs with active content, including hex-obfuscated names", async () => {
    expect(pdfActiveContent(Buffer.from("%PDF-1.7 << /OpenAction << /S /JavaScript /JS (app.alert(1)) >> >>"))).toBe("JavaScript");
    expect(pdfActiveContent(Buffer.from("%PDF-1.7 << /S /J#61vaScript >>"))).toBe("JavaScript");
    expect(pdfActiveContent(Buffer.from("%PDF-1.7 << /Type /Launch /F (cmd.exe) >>"))).toBe("Launch");
    expect(pdfActiveContent(Buffer.from("%PDF-1.7 << /Type /Page /Contents 4 0 R >>"))).toBeNull();
    const t = await tenant();
    const job = await newJob(t);
    await expect(addJobAttachment(t.manager, { jobId: job.id, kind: "REQUEST", filename: "x.pdf", bytes: Buffer.from("%PDF-1.7 /JS (x)") })).rejects.toThrow(/active content/);
  });

  it("removes GPS/EXIF from photos, applies rotation and caps the size", async () => {
    const original = await sharp({ create: { width: 4000, height: 3000, channels: 3, background: "#808080" } })
      .jpeg().withMetadata({ orientation: 6, exif: { IFD0: { Make: "PhoneCo", Model: "X1" }, IFD3: { GPSLatitudeRef: "S", GPSLatitude: "26/1 12/1 0/1", GPSLongitudeRef: "E", GPSLongitude: "28/1 2/1 0/1" } } }).toBuffer();
    const meta = await sharp(original).metadata();
    expect(meta.exif).toBeDefined();
    expect(meta.orientation).toBe(6);
    expect(original.toString("latin1")).toContain("PhoneCo");
    const t = await tenant();
    const job = await newJob(t);
    const att = await addJobAttachment(t.manager, { jobId: job.id, kind: "REQUEST", filename: "site.jpg", bytes: original });
    const stored = await readAttachment(t.manager, att.id);
    const m = await sharp(stored.bytes).metadata();
    expect(m.exif).toBeUndefined();
    expect(m.xmp).toBeUndefined();
    expect(m.orientation).toBeUndefined();
    expect([m.width, m.height]).toEqual([1920, 2560]); // rotated 90° by the EXIF orientation, then capped at 2560
    expect(stored.bytes.toString("latin1")).not.toContain("PhoneCo");
    expect(att.sizeBytes).toBe(stored.bytes.length);
    await expect(addJobAttachment(t.manager, { jobId: job.id, kind: "REQUEST", filename: "broken.png", bytes: PNG })).resolves.toBeDefined();
    const corrupt = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff]), Buffer.alloc(100, 1)]);
    await expect(addJobAttachment(t.manager, { jobId: job.id, kind: "REQUEST", filename: "bad.jpg", bytes: corrupt })).rejects.toThrow(/could not be read/);
  });
});

describe("email delivery", () => {
  it("sends a real SMTP message (AUTH, text + branded HTML) through the SMTP transport", async () => {
    const received: { from?: string; to?: string; raw: string; user?: string }[] = [];
    const server = new SMTPServer({
      secure: false, authOptional: false, allowInsecureAuth: true, disabledCommands: ["STARTTLS"], // test server only
      onAuth(auth, _s, cb) { if (auth.username === "mailer" && auth.password === "s3cret") cb(null, { user: "mailer" }); else cb(new Error("bad auth")); },
      onData(stream, session, cb) {
        let raw = "";
        stream.on("data", (c: Buffer) => (raw += c.toString()));
        stream.on("end", () => { received.push({ raw, user: session.user, from: session.envelope.mailFrom ? session.envelope.mailFrom.address : undefined, to: session.envelope.rcptTo[0]?.address }); cb(); });
      },
    });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
    const port = (server.server.address() as AddressInfo).port;
    try {
      const env = { EMAIL_TRANSPORT: "smtp", EMAIL_FROM: "FixRelay <no-reply@fixrelay.test>", SMTP_HOST: "127.0.0.1", SMTP_PORT: String(port), SMTP_USER: "mailer", SMTP_PASS: "s3cret", SMTP_REQUIRE_TLS: "false" } as unknown as NodeJS.ProcessEnv;
      const t = transportFromEnv(env);
      expect(t.name).toBe("smtp");
      const html = renderEmailHtml({ subject: "Quote Q-00001", text: "Please review:\nhttps://app.test/q/abc", brandName: "Acme <Maintenance>", brandColour: "#b91c1c" });
      await t.send({ to: "carl@client.test", subject: "Quote Q-00001", text: "Please review:\nhttps://app.test/q/abc", html });
      expect(received).toHaveLength(1);
      expect(received[0]).toMatchObject({ user: "mailer", from: "no-reply@fixrelay.test", to: "carl@client.test" });
      expect(received[0]!.raw).toContain("Subject: Quote Q-00001");
      expect(received[0]!.raw).toContain("text/html");
      expect(received[0]!.raw).toContain("Acme &lt;Maintenance&gt;"); // escaped
      await expect(smtpTransport({ ...env, SMTP_PASS: "wrong" }).send({ to: "a@b.test", subject: "s", text: "t", html: "<p>t</p>" })).rejects.toThrow();
    } finally { server.close(); }
  });

  it("sends through the Resend HTTP API transport with the right request shape, and surfaces API errors", async () => {
    const calls: { auth?: string; body: Record<string, unknown> }[] = [];
    let status = 200;
    const srv = http.createServer((req, res) => {
      let b = ""; req.on("data", (c) => (b += c));
      req.on("end", () => { calls.push({ auth: req.headers.authorization, body: JSON.parse(b) }); res.writeHead(status, { "Content-Type": "application/json" }); res.end(status === 200 ? '{"id":"1"}' : '{"message":"invalid from"}'); });
    }).listen(0, "127.0.0.1");
    await once(srv, "listening");
    const url = `http://127.0.0.1:${(srv.address() as AddressInfo).port}/emails`;
    try {
      const env = { EMAIL_TRANSPORT: "resend", RESEND_API_KEY: "re_test_123", EMAIL_FROM: "FixRelay <no-reply@fixrelay.test>", EMAIL_API_URL: url } as unknown as NodeJS.ProcessEnv;
      await transportFromEnv(env).send({ to: "a@b.test", subject: "Hi", text: "Body", html: "<p>Body</p>", replyTo: "office@acme.test" });
      expect(calls[0]).toMatchObject({ auth: "Bearer re_test_123", body: { from: env.EMAIL_FROM, to: ["a@b.test"], subject: "Hi", text: "Body", html: "<p>Body</p>", reply_to: "office@acme.test" } });
      status = 422;
      await expect(resendTransport(env).send({ to: "a@b.test", subject: "Hi", text: "B", html: "B" })).rejects.toThrow(/422/);
    } finally { srv.close(); }
    expect(() => transportFromEnv({ EMAIL_TRANSPORT: "smtp", EMAIL_FROM: "x@y.z" } as unknown as NodeJS.ProcessEnv)).toThrow(/SMTP_HOST/);
    expect(() => transportFromEnv({ EMAIL_TRANSPORT: "resend" } as unknown as NodeJS.ProcessEnv)).toThrow(/EMAIL_FROM/);
  });

  it("the outbox renders tenant-branded HTML and sets reply-to to the company's address", async () => {
    const t = await tenant();
    await prisma.organisation.update({ where: { id: t.orgId }, data: { brandColour: "#0e7490", contactEmail: "office@acme.test" } });
    await prisma.outboxEmail.updateMany({ where: { status: "PENDING" }, data: { status: "SENT" } });
    const job = await assessedJob(t);
    const realContractor = await prisma.contractor.create({ data: { orgId: t.orgId, name: "Real Co", email: `carl-${uniq()}@client-co.co.za` } });
    await quotes.requestQuotes(t.manager, job.id, { contractorIds: [realContractor.id], scope: "Please quote", deadline: null });
    const sent: { html: string; replyTo?: string; to: string }[] = [];
    await processOutbox({ name: "test", send: async (m) => { sent.push(m); } }, 50);
    const m = sent.find((x) => x.to.startsWith("carl-"))!;
    expect(m.html).toContain("#0e7490");
    expect(m.html).toContain("Open in FixRelay");
    expect(m.replyTo).toBe("office@acme.test");
  });
});

describe("retention", () => {
  it("purges old delivered emails, used tokens and expired sessions, but keeps business records", async () => {
    const t = await tenant();
    const job = await newJob(t);
    const old = new Date(Date.now() - 100 * 86_400_000);
    const e = await prisma.outboxEmail.create({ data: { toEmail: "old@x.test", subject: "s", body: "[sent]", dedupeKey: `old:${uniq()}`, status: "SENT", createdAt: old } });
    const r = await purgeRetention();
    expect(r.emails).toBeGreaterThanOrEqual(1);
    expect(await prisma.outboxEmail.findUnique({ where: { id: e.id } })).toBeNull();
    expect(await prisma.job.findUnique({ where: { id: job.id } })).not.toBeNull();
    expect(await prisma.activityEvent.count({ where: { jobId: job.id } })).toBeGreaterThan(0);
  });
});
