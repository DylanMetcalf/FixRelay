import Link from "@/components/link";
import { joinWithCodeAction } from "@/app/actions/auth";
import { PasswordField } from "@/components/client";
import { Form, Submit } from "@/components/form";
import { Field } from "@/components/ui";
import { lookupJoinCode } from "@/server/services/registration";

export const metadata = { title: "Join your company", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

/**
 * Employee registration with a site code. Step 1: type the code (or follow a link that carries it).
 * Step 2: name, work email, password, department; optional job title, phone and photo. An administrator then approves.
 */
export default async function JoinPage({ searchParams }: { searchParams: Promise<{ code?: string }> }) {
  const raw = (await searchParams).code?.slice(0, 20) ?? "";
  const info = raw ? await lookupJoinCode(raw) : null;
  if (!info) {
    return (
      <>
        <h1 className="text-xl font-extrabold">Join your company on Resultra</h1>
        <p className="muted mb-4 mt-1">Enter the registration code from your site administrator. It looks like <strong>ABCD-1234</strong>.</p>
        {raw && <p className="mb-3 rounded-md bg-red-50 p-3 text-sm font-semibold text-red-900" role="alert">That code is not valid. It may have expired or been replaced. Ask your site administrator for the current code.</p>}
        <form method="get" action="/join" className="space-y-3">
          <Field label="Registration code" name="code" required autoComplete="off" autoCapitalize="characters" maxLength={12} defaultValue={raw} placeholder="ABCD-1234" />
          <button className="btn btn-primary w-full">Continue</button>
        </form>
        <p className="muted mt-4 text-center">Already have an account? <Link className="link" href="/login">Sign in</Link></p>
      </>
    );
  }
  return (
    <>
      <h1 className="text-xl font-extrabold">Join {info.orgName}</h1>
      <p className="muted mb-4 mt-1">{info.siteName ? <>Site: <strong>{info.siteName}</strong>. </> : null}Your administrator approves your access before you can see company information.</p>
      <Form action={joinWithCodeAction} hidden={{ code: info.code }}>
        <Field label="Your name" name="name" autoComplete="name" required />
        <Field label="Work email" name="email" type="email" autoComplete="email" required hint="We send a link to confirm it." />
        <PasswordField label="Password" name="password" autoComplete="new-password" minLength={10} hint="At least 10 characters." />
        {info.departments.length > 0 && (
          <div>
            <label className="label" htmlFor="departmentId">Department</label>
            <select id="departmentId" name="departmentId" className="input" defaultValue="">
              <option value="">Not sure / none</option>{info.departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
            </select>
          </div>
        )}
        <details className="rounded-md border border-gray-300 p-3">
          <summary className="cursor-pointer text-sm font-semibold">Optional: job title, phone number and photo</summary>
          <div className="mt-3 space-y-3">
            <Field label="Job title (optional)" name="jobTitle" maxLength={80} autoComplete="organization-title" />
            <Field label="Phone number (optional)" name="phone" type="tel" maxLength={40} autoComplete="tel" />
            <Field label="Profile photo (optional)" name="photo" hint="JPEG, PNG or WebP. Location data is removed.">
              <input id="photo" name="photo" type="file" accept="image/jpeg,image/png,image/webp" className="input" />
            </Field>
          </div>
        </details>
        <Submit className="btn btn-primary w-full">Ask for access</Submit>
      </Form>
      <p className="muted mt-4 text-center text-xs">The code only lets you ask. Nothing is shared with you until your administrator approves.</p>
    </>
  );
}
