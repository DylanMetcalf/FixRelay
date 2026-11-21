import { LegalPage } from "@/components/legal";

export const metadata = { title: "Privacy notice" };

export default function Privacy() {
  return (
    <LegalPage title="Privacy notice" updated="17 November 2026">
      <h2>Who is responsible</h2>
      <p>Resultra is software used by organisations (our <em>customers</em>) to manage maintenance at their own sites. For the fault reports, job, contractor and site information an organisation enters, <strong>that organisation is the responsible party</strong> under the Protection of Personal Information Act (POPIA) and Resultra acts as its <strong>operator</strong>. For account information of people who sign up to Resultra, the Resultra operator is the responsible party. [Insert registered company name, address and Information Officer contact.]</p>
      <h2>What we process</h2>
      <ul>
        <li>Account details: name, email address, password (stored only as a one-way hash), the company and role you belong to.</li>
        <li>Maintenance records: requests, assessments, quotes, work notes, photos and documents, completion records, decisions and signatures.</li>
        <li>Contact details of contractors the organisation asks for quotes, and the name and phone number of people who report a fault without an account.</li>
        <li>Security records: sign-in sessions, the network (IP) address and time when someone submits through a secure link, and an activity history of each job.</li>
      </ul>
      <h2>What we do not do</h2>
      <ul>
        <li>We remove location (GPS) and camera information from photos when they are uploaded.</li>
        <li>We do not sell personal information or use it for advertising. We set only a single, essential sign-in cookie.</li>
        <li>Resultra staff cannot view a company&apos;s data unless that company grants time-limited support access, and every such visit is recorded in the company&apos;s history.</li>
      </ul>
      <h2>Why (lawful basis)</h2>
      <p>To provide the service the maintenance company subscribed to (contract), to keep accurate records of work, quotes and approvals (legitimate interest and legal record-keeping), and to keep the service secure.</p>
      <h2>How long we keep it</h2>
      <ul>
        <li>Delivered email copies: 90 days. Notifications: up to 12 months. Expired sign-in sessions and one-time links: deleted when expired or used.</li>
        <li>Maintenance records and their history: for as long as the maintenance company keeps its account, so it can meet its own record-keeping duties. When an account closes, records are deleted or anonymised after [insert period] unless the law requires longer.</li>
      </ul>
      <h2>Security</h2>
      <p>Each company&apos;s data is isolated, access is role-based, files are private and virus-scanned, connections are encrypted, and important records cannot be altered. See our security summary on request.</p>
      <h2>Your rights</h2>
      <p>You may ask to access, correct or delete your personal information, or object to its processing. If your information was entered by an organisation using Resultra (for example a site where you reported a fault, or a company that asked you for a quote), contact that organisation first; we will assist them. Account owners can export all of their data from Settings. You may complain to the Information Regulator (South Africa): inforeg.org.za.</p>
      <h2>Service providers and transfers</h2>
      <p>[List hosting, database, file storage and email providers and the countries where data is stored, with the safeguards in place.]</p>
    </LegalPage>
  );
}
