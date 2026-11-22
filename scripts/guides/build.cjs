/**
 * Builds the four Resultra guides (A4 PDF) from the screenshots in docs/screenshots (run capture.cjs first).
 *   node scripts/guides/build.cjs
 * Output: docs/RESULTRA_USER_GUIDE.pdf, RESULTRA_SITE_ADMIN_GUIDE.pdf, RESULTRA_PLATFORM_ADMIN_GUIDE.pdf, RESULTRA_PILOT_TESTING_GUIDE.pdf
 * plus the HTML sources next to them (docs/guides-src/*.html) so the guides can be edited and rebuilt.
 */
const { chromium } = require("playwright");
const fs = require("node:fs");
const path = require("node:path");

const SHOTS = path.resolve("docs/screenshots");
const SRC = path.resolve("docs/guides-src");
fs.mkdirSync(SRC, { recursive: true });
const img = (name) => (fs.existsSync(path.join(SHOTS, `${name}.png`)) ? `../screenshots/${name}.png` : null);
const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;");
const md = (s) => esc(s).replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>").replace(/`(.+?)`/g, "<code>$1</code>");

const MARK = `<svg viewBox="0 0 512 512" width="36" height="36"><rect width="512" height="512" rx="112" fill="#0B1F3A"/><path d="M156 372V140h96a62 62 0 0 1 0 124h-96" fill="none" stroke="#fff" stroke-width="46" stroke-linecap="round" stroke-linejoin="round"/><path d="M232 268l64 92 92-140" fill="none" stroke="#F5A524" stroke-width="46" stroke-linecap="round" stroke-linejoin="round"/><circle cx="156" cy="372" r="25" fill="#5B8DEF"/></svg>`;

function page(title, audience, sections) {
  const body = sections.map((s) => {
    const pics = (s.img ? (Array.isArray(s.img) ? s.img : [s.img]) : []).map((n) => [n, img(n)]).filter(([, src]) => src);
    const phone = s.phone ? " phone" : "";
    return `<section class="${s.break ? "break" : ""}">
      <h2>${esc(s.h)}</h2>
      ${(s.p ?? []).map((x) => `<p>${md(x)}</p>`).join("")}
      ${s.steps ? `<ol>${s.steps.map((x) => `<li>${md(x)}</li>`).join("")}</ol>` : ""}
      ${s.list ? `<ul>${s.list.map((x) => `<li>${md(x)}</li>`).join("")}</ul>` : ""}
      ${s.check ? `<table class="check"><tr><th>Done</th><th>Task</th><th>What to look for</th><th>Notes</th></tr>${s.check.map(([t, w]) => `<tr><td class="box">☐</td><td>${md(t)}</td><td>${md(w)}</td><td></td></tr>`).join("")}</table>` : ""}
      ${pics.length ? `<div class="pics${phone}">${pics.map(([n, src]) => `<figure><img src="${src}" alt="${esc(s.cap ?? s.h)}"><figcaption>${esc(s.caps?.[pics.findIndex((p) => p[0] === n)] ?? s.cap ?? "")}</figcaption></figure>`).join("")}</div>` : ""}
    </section>`;
  }).join("\n");
  return `<!doctype html><html lang="en-ZA"><head><meta charset="utf-8"><title>${esc(title)}</title><style>
  @page { size: A4; margin: 16mm 15mm 18mm; }
  body { font-family: Inter, "Segoe UI", Arial, sans-serif; color: #111827; font-size: 10.5pt; line-height: 1.45; }
  .cover { background: #0B1F3A; color: #fff; border-radius: 10px; padding: 26px 28px; margin-bottom: 18px; }
  .cover .brand { display: flex; align-items: center; gap: 10px; font-weight: 800; font-size: 18pt; }
  .cover h1 { font-size: 24pt; margin: 18px 0 4px; }
  .cover .tag { color: #F5A524; font-weight: 800; }
  .cover .aud { color: #CBD5E1; margin-top: 10px; }
  h2 { color: #0B1F3A; font-size: 14pt; margin: 18px 0 6px; padding-bottom: 4px; border-bottom: 3px solid #F5A524; display: inline-block; }
  section { break-inside: auto; }
  section.break { break-before: page; }
  p, li { margin: 4px 0; }
  code { background: #F3F5F8; padding: 1px 4px; border-radius: 3px; font-size: 9.5pt; }
  .pics { display: flex; flex-wrap: wrap; gap: 10px; margin: 8px 0; }
  .pics figure { margin: 0; flex: 1 1 100%; break-inside: avoid; }
  .pics.phone figure { flex: 0 0 31%; }
  .pics img { width: 100%; border: 1px solid #D1D5DB; border-radius: 6px; }
  figcaption { font-size: 8.5pt; color: #4B5563; margin-top: 2px; }
  table.check { width: 100%; border-collapse: collapse; font-size: 9.5pt; margin-top: 6px; }
  table.check th, table.check td { border: 1px solid #D1D5DB; padding: 5px 6px; vertical-align: top; text-align: left; }
  table.check th { background: #F3F5F8; }
  td.box { width: 30px; text-align: center; font-size: 13pt; }
  table.check td:last-child { width: 22%; }
  .note { background: #FFFBEB; border-left: 4px solid #F5A524; padding: 6px 10px; }
  </style></head><body>
  <div class="cover"><div class="brand">${MARK} Resultra</div><h1>${esc(title)}</h1><div class="tag">From reported to resolved.</div><div class="aud">${esc(audience)}</div><div class="aud">Screenshots are taken from the running application with synthetic sample data. Version of ${new Date().toISOString().slice(0, 10)}.</div></div>
  ${body}
  </body></html>`;
}

const GUIDES = {
  RESULTRA_USER_GUIDE: ["User guide", "For everyone who reports faults, technicians and maintenance managers.", [
    { h: "1. What Resultra does", p: ["Resultra takes a maintenance problem from the moment someone reports it to the moment it is fixed and signed off. Every job shows what happened, where, who reported it, how urgent it is, who is responsible, its status, **what happens next**, photos, approvals and the full history. Every job is also a branded **job card** you can print or download."] },
    { h: "2. Joining and signing in", steps: ["Your site administrator gives you a **registration code** (for example `ABCD-1234`) or a link with it.", "Open the link, or go to `/join` and type the code.", "Enter your name, work email, a password (at least 10 characters) and your department. Job title, phone number and photo are optional.", "Open the confirmation email and tap the link.", "Wait for your administrator to approve you. You get an email when it is done. Then sign in at `/login`."], img: ["join-form", "join-pending", "login-phone"], phone: true, caps: ["Asking for access with a code", "Waiting for approval", "Signing in"] },
    { h: "3. Finding your way around", p: ["On a computer the menu is on the left: **Dashboard**, **My jobs** (technicians), **Reports**, **Jobs**, and more depending on your role. On a phone the menu is at the bottom. The **dashboard** shows live counts of jobs at every stage; tap a tile to see those jobs. The **Jobs** page has **Open now** and **History** tabs and priority buttons."], img: ["dashboard", "jobs-board"], caps: ["Dashboard", "Jobs board: Open now / History, priority buttons, photos"] },
    { h: "4. Reporting a problem with a QR code (no account)", p: ["Every site, area and machine can have its own QR sign. Scan it with your phone camera. The place is filled in for you. If someone is hurt or in danger, follow your site's emergency procedure first."], steps: ["Tap what kind of problem it is (optional) and describe it.", "Choose how urgent it is: Critical, High, Medium or Low.", "Check the place.", "Add a photo if you can.", "Enter your name. Phone and email are optional.", "Check and send. You get a report number."], img: ["qr-1-start", "qr-2-urgency", "qr-3-place", "qr-5-review", "qr-6-done"], phone: true, caps: ["Describe the problem", "How urgent", "The place from the QR code", "Check and send", "Thank you + report number"] },
    { h: "5. Reporting a problem in the app", p: ["Signed in, tap **+ Report a fault**. The form goes one step at a time: what is wrong, how urgent, where, photo, then a review. Maintenance staff can also choose the category and the responsible department. Resultra warns the maintenance manager if the report looks like one already open."], img: ["report-step1"], caps: ["Reporting in the app"] },
    { h: "6. The job page", break: true, p: ["Everything about a job is on one page: status and priority, **What happens next** with the responsible person, the actions you may take, photos, the assessment, quotes, the work log, completion, signatures, related reports and the full activity history."], img: ["job-page"], caps: ["A job page"] },
    { h: "7. Assessment, quotations and approvals", list: ["**Assess**: findings, likely cause, recommended work, whether spares are needed, and whether a contractor is needed.", "**In-house**: give the job to the in-house team and assign a technician with instructions and dates.", "**Contractor**: send quote requests by secure link or capture a quote received by email; compare quotes; approve within your limit (with a PO if your company requires it) or send it for approval to someone with enough authority.", "Approvers see **Needs your approval** on their dashboard and approve or decline with a comment."] },
    { h: "8. Work updates and completion (technicians)", p: ["Open the job (from **My jobs** or the alert), tap **Start work**, add progress notes, then **Work finished – submit evidence**: what was done, an after photo or document, the root cause, and (in food-handling areas) the tools/clean check. Review and submit."], img: ["tech-job", "tech-completion-review"], phone: true, caps: ["A technician's job on a phone", "Completion review before submitting"] },
    { h: "9. Job cards: view, print, download", p: ["On the job page, **Job card and documents**: **View job card** opens the branded PDF inside Resultra with **Print** and **Download PDF**. On a phone, use **Open in a new tab** or **Download PDF**. Every PDF shows when it was generated and the status at that moment: it is a snapshot, not the live record. The QR code on a printed card opens the job after signing in."], img: ["documents-card", "jobcard-p1", "jobcard-p2"], caps: ["Document buttons on the job page", "Job card page 1", "Job card page 2 (handwriting area for printed cards)"] },
    { h: "10. Completion, verification and closing", p: ["The person who reported the fault answers **Is it fixed?** (or signs on the technician's phone). If it is not fixed, the job goes back with a reason. Then the maintenance manager **signs off and closes** it. The **completion report** (PDF) then shows before and after photos, the work done, the verification and recorded signatures."], img: ["completion-p1"], caps: ["Completed job report"] },
    { h: "11. Job history", p: ["The activity history on the job page lists every step with time and person. Maintenance staff can export the **full job history** as a PDF (timeline, handovers, quotes, approvals, reopenings, comments and an attachment index). If the fault comes back after a job is closed, use **The fault came back – report a repeat**: the new job is linked to the old one."], img: ["history-p1"], caps: ["Job history report"] },
  ]],
  RESULTRA_SITE_ADMIN_GUIDE: ["Site administrator guide", "For the person who runs Resultra for their company and sites.", [
    { h: "1. Becoming the site administrator", p: ["The Resultra team creates your company and first site and emails you an invitation. Open it, set your password, and you are the site administrator (owner) with maintenance-manager rights."], img: ["invite-accept"], caps: ["Accepting the invitation"] },
    { h: "2. Sites, areas and QR codes", steps: ["**Sites** → your site → add areas (Workshop, Offices, Warehouse, Production …) and equipment.", "Switch on **QR reporting without an account** in Settings if visitors and staff without accounts should report.", "Download **QR signs (PDF)**: one A4 sign for the site and one per area. Print and put them up. Or print the smaller stickers.", "**Replace link** if signs are misused: all old codes stop working; print new ones."], img: ["site-page", "qr-sign-p2", "qr-stickers"], caps: ["Site page with the short report link", "An A4 QR sign", "QR stickers"] },
    { h: "3. Departments", p: ["**Settings → Departments**: add departments such as Maintenance, Operations, Management and Finance; add people and tick **Department manager** for the person who runs it. Departments group people; **roles** still decide what someone may do. Department managers see their department's open work on their dashboard and can hand jobs over."], img: ["settings-departments"], caps: ["Departments"] },
    { h: "4. Adding employees", list: ["**Invite**: Settings → Invite someone (email, role, sites). Best for managers and technicians you know.", "**Registration code**: Settings → Registration codes → Create code (all sites or one site, valid for a number of days). Share the code or link. Switch it off or **Replace** it at any time. A code never gives access by itself."], img: ["settings-codes"], caps: ["Registration codes"] },
    { h: "5. Approving registrations and assigning roles", p: ["People who used a code appear under **Waiting for approval** with their details. Once their email is confirmed, choose their role(s), department and whether they manage it, then **Approve access** (or **Decline**). They are emailed either way. Change roles later in **Team**; untick **Active** to remove access immediately."], img: ["settings-approvals"], caps: ["Waiting for approval"] },
    { h: "6. Managing site requests", break: true, p: ["The dashboard shows new reports, **unassigned** jobs, possible duplicates, jobs waiting for assessment, quotes, approval, work in progress, overdue, waiting for confirmation, reopened and completed. Filter by department, status, site, priority or technician. Public (QR) reports are marked **To screen**: accept them for assessment or reject them with a reason."], img: ["dashboard"], caps: ["Dashboard"] },
    { h: "7. Department work queues and handovers", p: ["On a job, **Department → Hand over this job**: choose the department and/or person and say why or what must happen next. The handover is recorded with who, from, to, why and when; only the receiver is notified."], img: ["handover-form", "department-queue"], caps: ["Handing a job over", "A department manager's queue"] },
    { h: "8. Duplicate and reopened jobs", p: ["When a report looks like an open or recent job (same site, same area or machine, similar words), it is marked **Possible duplicate**. Compare the original reports under **Related reports**, then **Link as duplicate** (the report and reporter stay on record; unworked reports are closed as “Duplicate of …”) or **Not a duplicate – keep separate**. Closed jobs can be **reopened** with a reason; the original closure stays in the history."], img: ["duplicate-review", "duplicate-job"], caps: ["Duplicate review", "A linked duplicate"] },
    { h: "9. Downloading reports and documents", list: ["Job card, completion report and job history PDFs from each job.", "**Insights**: spend, response and fix times, root causes, contractors; area reports; CSV download.", "**Settings → Export** (owners): all company data as JSON."], img: ["card-viewer"], caps: ["Job card viewer"] },
    { h: "10. Support access", p: ["Resultra staff cannot see your jobs. If you need help, **Settings → Support access** grants read-only access for a limited time; every visit is recorded in your history and you can revoke it."] },
  ]],
  RESULTRA_PLATFORM_ADMIN_GUIDE: ["Platform administrator guide", "For the Resultra team (the SaaS owner).", [
    { h: "1. Signing in", p: ["The platform owner account is created on the server with `PLATFORM_ADMIN_EMAIL=… PLATFORM_ADMIN_PASSWORD=… npm run db:seed`. Sign in at `/login`: you land on **Platform admin** (`/platform`)."] },
    { h: "2. Creating a customer company", steps: ["Fill in **Create a customer company**: company name, first site and address, phone, the main contact's name and work email, the starting departments, and whether QR reporting without an account is on.", "**Create company and invite contact**. The company starts on a trial with the site (with QR codes) and departments ready.", "The main contact receives a secure invitation (you can also copy the link shown). Accepting it makes them the site administrator."], img: ["platform-create"], caps: ["Creating a customer company"] },
    { h: "3. Customer overview", p: ["Each company shows its main contact (and whether the invitation was accepted), sites, users, people waiting for approval, departments, jobs, email delivery, subscription and an **onboarding checklist** (administrator joined, site, departments, team, first job). Search finds a company by name."], img: ["platform-overview"], caps: ["Platform admin"] },
    { h: "4. Customer profile", p: ["Open a company to see its users (roles, status, departments, email confirmed), sites, departments and email delivery failures. **Re-send the administrator invitation** if it expired. This is **account information only**: jobs, quotes, photos and reports are never shown here."], img: ["platform-customer"], caps: ["Customer profile"] },
    { h: "5. Subscriptions and account status", p: ["Under **Subscription and support** set the plan, status (trial, active, past due, suspended, cancelled) and dates. Suspended or expired accounts become read-only: customers keep access to their records and exports."] },
    { h: "6. Authorised support access", steps: ["The customer's administrator grants support access in their Settings (reason and 4, 24 or 72 hours).", "**Open read-only support session (recorded)** appears for that company.", "The visit is written to the company's history; you cannot change anything; access ends when the grant expires or is revoked."], p: ["There is no other way to see a company's business data."] },
    { h: "7. Platform health", p: ["**Platform health** shows emails sent, waiting and failed over the last 7 days (recipient and error for failures), and recent unexpected server errors (message and page, no personal data). Check it daily during the pilot."] },
    { h: "8. Demo and pilot companies", list: ["**Demo**: any user can open a separate demo workspace with sample data and switch roles with **View as**; demo companies never send email and can be reset.", "**Pilot**: create a normal customer company for the pilot customer (or a separate staging deployment); testers register with a code and are approved by the pilot's administrator."], img: ["demo-dashboard", "demo-view-as"], caps: ["Demo workspace with View as", "Viewing as the finance approver"] },
  ]],
  RESULTRA_PILOT_TESTING_GUIDE: ["Pilot testing guide", "For invited pilot testers. Please work through the tasks and note anything confusing.", [
    { h: "Before you start", list: ["Use your work email. You need a phone with a camera and a computer.", "The pilot uses test data only. Do not enter real personal information about other people.", "If something is unclear, write down what you expected and what happened. Screenshots help."] },
    { h: "Part A – Join and look around", check: [["Open the registration link or go to `/join` and enter the code", "Your company and site name appear"], ["Ask for access with your name, work email, department", "“Waiting for approval”"], ["Confirm your email from the message", "The page says the email is confirmed"], ["After approval, sign in", "You see the dashboard with your name"], ["Open your profile", "Your job title / department are already there"]] },
    { h: "Part B – Report problems", check: [["Scan an area QR sign (or open the short link) on your phone without signing in", "The area is already filled in; a safety notice is shown"], ["Report a problem with a photo and only your name", "A report number appears"], ["Report the same problem again in the app", "It is marked as a possible duplicate for the manager"], ["Report a problem in the app and choose a priority", "It appears on the Jobs board with that priority"]] },
    { h: "Part C – Manage the work (managers)", check: [["Open a new QR report and accept it for assessment", "Status changes; “What happens next” updates"], ["Review the possible duplicate and link it, or keep it separate", "The report stays on record either way"], ["Hand a job over to another department with a reason", "The department changes; the other manager is notified"], ["Request or capture a quotation and approve it (or send it for approval)", "The contractor is appointed, or the approver is asked"], ["Assign a technician", "The technician sees it under My jobs"]] },
    { h: "Part D – Do the work (technicians)", check: [["Start work on an assigned job on your phone", "Status: In progress"], ["Add a progress note", "It appears in the work log"], ["Finish with an after photo and root cause", "Status: Awaiting confirmation"]] },
    { h: "Part E – Documents and closing", check: [["Open the job card, then Print and Download PDF", "Your company, site, job details and photo are on the card; the generation time is shown"], ["Print the card and fill it in by hand", "There is enough space; it is clear and readable"], ["Confirm the job is fixed (as the reporter) and close it (as the manager)", "Status: Closed"], ["Download the completion report", "Before/after photos, the work done and the verification are shown"], ["Reopen the closed job with a reason (managers)", "“Reopened ×1”; the old closure is still in the history"], ["Scan the QR code on a printed job card", "You are asked to sign in, then the job opens"]] },
    { h: "Feedback checklist", check: [["Was it clear what to do next on every screen?", "Rate 1–5"], ["Was reporting a problem quick on your phone?", "Time it"], ["Could you find the job card and documents?", ""], ["Did any wording confuse you?", "Write the exact words"], ["Did anything look broken on your phone or computer?", "Device and browser"], ["What would stop you using Resultra every day?", ""], ["What would you pay for, and what is missing?", ""]] },
    { h: "Where to send feedback", p: ["Send your notes and screenshots to the Resultra team contact who invited you. Thank you for helping make Resultra better."] },
  ]],
};

(async () => {
  const browser = await chromium.launch();
  const p = await browser.newPage();
  for (const [file, [title, audience, sections]] of Object.entries(GUIDES)) {
    const html = page(`Resultra – ${title}`, audience, sections);
    const src = path.join(SRC, `${file}.html`);
    fs.writeFileSync(src, html);
    await p.goto(`file://${src}`);
    await p.waitForLoadState("networkidle");
    await p.pdf({
      path: path.resolve("docs", `${file}.pdf`), format: "A4", printBackground: true, displayHeaderFooter: true,
      headerTemplate: "<span></span>",
      footerTemplate: `<div style="font-size:8px;color:#4B5563;width:100%;padding:0 15mm;display:flex;justify-content:space-between"><span>Resultra · ${title}</span><span><span class="pageNumber"></span> / <span class="totalPages"></span></span></div>`,
      margin: { top: "16mm", bottom: "18mm", left: "15mm", right: "15mm" },
    });
    console.log("built", file);
  }
  await browser.close();
})();
