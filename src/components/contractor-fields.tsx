import { Check, Field, TextArea } from "./ui";

interface C { name?: string; trade?: string; contactName?: string; email?: string; phone?: string; vatRegistered?: boolean; vatNumber?: string; notes?: string }

export function ContractorFields({ c = {} }: { c?: C }) {
  return (
    <>
      <Field label="Company name" name="name" required defaultValue={c.name} />
      <Field label="Trade" name="trade" defaultValue={c.trade} placeholder="e.g. Electrical, Refrigeration, Plumbing" />
      <Field label="Contact person" name="contactName" defaultValue={c.contactName} />
      <Field label="Email (quote requests go here)" name="email" type="email" required defaultValue={c.email} />
      <Field label="Phone" name="phone" type="tel" defaultValue={c.phone} />
      <Check name="vatRegistered" label="VAT registered (15% is added to their prices)" defaultChecked={c.vatRegistered} />
      <Field label="VAT number" name="vatNumber" defaultValue={c.vatNumber} />
      <TextArea label="Notes" name="notes" rows={2} defaultValue={c.notes} />
    </>
  );
}
