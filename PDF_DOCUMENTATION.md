# Job documents (PDF)

Resultra produces four branded documents from live data. They are generated on the server for each request, checked against the person's access, and never stored.

| Document | Where | Who | File name |
|---|---|---|---|
| **Maintenance job card** (active job) | Job page → *Job card and documents* → View job card / Download PDF / Print; header button *Job card* | Anyone who can open the job | `RESULTRA_JobCard_<REF>.pdf` |
| **Completed job report** | Job page → *Download completion report* (once work is completed) | Anyone who can open the job | `RESULTRA_CompletionReport_<REF>.pdf` |
| **Full job history** | Job page → *Export job history (PDF)* | Maintenance team, approvers, managers (not people who only report faults) | `RESULTRA_JobHistory_<REF>.pdf` |
| **QR signs** (A4, one per site and area) | Site page → *Download QR signs (PDF)*; QR stickers page | Site / maintenance managers | `RESULTRA_QR_Signs_<Site>.pdf` |

The paper-style **requisition form** (`/jobs/:id/report`) remains as a browser print view that matches the company's original paper form.

## Engineering

- **Engine:** `@react-pdf/renderer` 4.9 (pure JavaScript, no browser). Code: `src/server/pdf/` (`theme.ts` fonts/colours/styles, `brand.tsx` mark/header/footer/sections, `parts.tsx` photo grid, writing boxes, signatures, `job-card.tsx`, `completion-report.tsx`, `job-history.tsx`, `qr-sign.tsx`, `data.ts` loading, `render.tsx` entry and permission rules).
- **Routes:** `GET /api/jobs/:id/documents/:kind` (`card`, `completion`, `history`; `?download=1` saves instead of opening) and `GET /api/sites/:id/signs` (`?location=<id>` one area, `?siteOnly=1`). Responses: `application/pdf`, `Cache-Control: private, no-store`, 401 signed out, 403 not allowed, 404 out of scope (including other companies), 409 completion report before completion.
- **Viewer:** `/jobs/:id/card` shows the PDF in a frame with Print, Download and Open buttons. Only this page may frame the PDF (`X-Frame-Options: SAMEORIGIN`, `frame-ancestors 'self'` on the document route; every other page keeps `DENY`). On phones the frame is hidden and the page offers Open and Download, because mobile browsers open PDFs full screen.
- **Page:** A4 portrait (595 × 842 pt), 36 pt margins, 64 pt bottom margin for the fixed footer. Fonts: Inter (Regular, Italic, SemiBold, Bold, ExtraBold) bundled in `assets/fonts/` under the SIL Open Font License, so output is identical everywhere. Colours from BRAND.md (Relay Navy, Signal Amber, Relay Blue, Mist).
- **Header:** Resultra mark, document title, document number (the job's requisition number), the customer's company (name, address, phone), the site (name, address), the status at generation time and the generation time.
- **Footer (every page):** Resultra mark, document reference, "Snapshot generated <time> SAST. The live record may have changed since.", *Page x of y*, and a QR code that is also a clickable link to `APP_URL/jobs/<id>`. The link opens the job only after signing in with access to it; it carries no token and grants nothing by itself.
- **Photos:** read from private storage on the server (never through public URLs), auto-rotated, flattened and re-encoded as JPEG (max 1400 px) so WebP uploads work too. Each sits in a fixed box at its own aspect ratio: never stretched or cropped. Captions give the kind (Reported / Before / After) and date. A clear "No photograph was added" panel is shown when there is none; "+ N more photos in the digital record" when there are more than fit.
- **Page breaks:** sections keep their heading with at least the start of their content (`minPresenceAhead`), field cells, photo rows, signature blocks and table rows never split, and long descriptions wrap across pages. There are no empty pages (tested).
- **Time:** all times are shown in South African time (`Africa/Johannesburg`, labelled SAST).
- **Snapshot / version:** every document states when it was generated and the status at that moment, so a printout is never mistaken for the current live job.
- **Permissions:** documents are built from the same permission-checked `getJob` the job page uses. People without price access never see amounts ("Restricted"); people who only report faults never see internal notes, assessments or internal photos; the history report is refused for them.
- **Signatures and approvals:** a signature or approval is shown only when it was actually recorded (image, name, time). Otherwise the block says "No signature recorded." A blank line never implies approval. On the active job card, the handwriting area is labelled as not part of the digital record until it is entered in Resultra.

## Content

**Job card:** reported issue (title, description, reported time, reporter, area, equipment, category, priority/emergency, request reference, department), photographs (reported and before, up to 4), assessment and assignment (department, responsible person or contractor, route, expected work date, assessment summary, recommended repair, instructions, spares), quotation reference and approval status (amounts only for people allowed to see prices, plus PO), and either the recorded completion (with signatures) or a handwriting area: work performed, parts and materials, observations, technician name/date/signature, manager verification name/date/signature.

**Completed job report:** final status (closed time and by whom, or "not closed yet"), original request, before photos, assessment summary and approved scope (approved quote and amount when allowed), work performed (notes, completion time, technician or contractor, root cause, food-area check), after photos (up to 6), verification (confirmed fixed / not fixed, by whom, how, when, comment) and recorded signatures (work completed by, confirmed by originator, manager sign-off).

**Full job history:** activity timeline (every recorded event with time and person), department handovers (from, to, by, reason), quotation history (all versions, status, totals when allowed), approvals and verifications, reopening events, comments and work updates (staff), and an attachment index.

**QR sign:** company name, "Need to report a maintenance issue?", site and area, a large QR code, the short link (`/r/<code>`), three steps, the emergency-procedure warning and the Resultra footer.

## Tests

- Integration (`tests/integration/documents.test.ts`, `qr.test.ts`): text extracted with pdf.js checks the content, A4 size, page numbers on every page, multi-page flow, embedded image count (photos + QR), the footer link target, no empty pages, completion-report rules (409 before completion, verification only when recorded, "No signature recorded."), price hiding, history refused to reporters, and 404 for other companies and unassigned staff.
- Browser (`e2e/resultra.spec.ts` D1–D7, S3, S20): document buttons on the job page, the in-app viewer, downloads with the right file names and headers, photo rendering, long reports, completion report after closure, permissions (401/403/404/409), the QR link requiring sign-in and returning to the job, and the phone layout.
- Visual check: pages were rendered to images with `pdftoppm` and inspected; screenshots are in the user guides.

## Known limits
- The QR code inside the PDF is verified through its link annotation (same URL), not by decoding the image.
- The browser print dialog (Print button) is not covered by automated tests: headless Chromium has no PDF viewer. The PDFs themselves are A4 and print-ready.
- Up to 4 photos on the job card and 6 after photos on the completion report; the rest are counted and remain in the digital record.
- Right-to-left scripts are not supported by the bundled font set.
