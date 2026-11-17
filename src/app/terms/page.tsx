import { LegalPage } from "@/components/legal";

export const metadata = { title: "Terms of service" };

export default function Terms() {
  return (
    <LegalPage title="Terms of service" updated="17 November 2026">
      <h2>The service</h2>
      <p>FixRelay provides software to manage maintenance requests, quotations, approvals, work and sign-off. You are responsible for the accuracy of the information you enter and for how you use the service with your own clients.</p>
      <h2>Accounts</h2>
      <p>Keep your password secret and remove access for people who leave your company. The company owner controls who can access the company&apos;s data.</p>
      <h2>Your data</h2>
      <p>You own your data. You can export it at any time from Settings. If your subscription lapses your account becomes read-only; your records are not deleted while the account exists.</p>
      <h2>Approvals and signatures</h2>
      <p>Approvals given through FixRelay record who decided, when and how. A drawn signature records acknowledgement; it is not an advanced electronic signature under the Electronic Communications and Transactions Act. Use your own contracts where a formal signature is legally required.</p>
      <h2>Subscriptions</h2>
      <p>[Insert plans, fees, billing, cancellation and refund terms.]</p>
      <h2>Liability</h2>
      <p>[Insert limitation of liability, warranties and governing law (Republic of South Africa).]</p>
    </LegalPage>
  );
}
