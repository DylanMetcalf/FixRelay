import * as a from "@/app/actions/admin";
import { ActionButton, Form, Submit } from "@/components/form";
import { Card, Pill } from "@/components/ui";

type Dept = { id: string; name: string; members?: { userId: string; isManager: boolean }[] };
type Person = { userId: string; name: string };

/** Departments: organisational groups (separate from roles). Department managers see and hand over their department's jobs. */
export function DepartmentsCard({ departments, people, canEdit }: { departments: Dept[]; people: Person[]; canEdit: boolean }) {
  const nameOf = (id: string) => people.find((p) => p.userId === id)?.name ?? "Former member";
  return (
    <Card title="Departments">
      <p className="muted mb-3">Group people into departments such as Maintenance, Operations or Finance. Jobs can be given to a department and handed over between them. A department manager sees and hands over that department&apos;s work. Roles still decide what each person may do.</p>
      <ul className="space-y-3" data-testid="departments">
        {departments.map((d) => (
          <li key={d.id} className="rounded-md border border-gray-300 p-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="font-bold">{d.name} <span className="text-xs font-semibold text-gray-600">· {d.members?.length ?? 0} member{d.members?.length === 1 ? "" : "s"}</span></p>
              {canEdit && <ActionButton action={a.archiveDepartmentAction} hidden={{ departmentId: d.id }} className="btn btn-secondary btn-sm" confirm={`Archive ${d.name}? Its history is kept.`}>Archive</ActionButton>}
            </div>
            <ul className="mt-2 space-y-1">
              {(d.members ?? []).map((m) => (
                <li key={m.userId} className="flex items-center justify-between gap-2 text-sm">
                  <span>{nameOf(m.userId)} {m.isManager && <Pill tone="blue">Department manager</Pill>}</span>
                  {canEdit && <ActionButton action={a.departmentMemberAction} hidden={{ departmentId: d.id, userId: m.userId, remove: "1" }} className="btn btn-sm underline">Remove</ActionButton>}
                </li>
              ))}
            </ul>
            {canEdit && (
              <Form action={a.departmentMemberAction} hidden={{ departmentId: d.id }} className="mt-2 flex flex-wrap items-end gap-2">
                <label className="text-xs font-bold">Add or update a person
                  <select name="userId" required aria-label={`Person to add to ${d.name}`} className="input !min-h-9 text-sm">
                    <option value="">Choose…</option>{people.map((p) => <option key={p.userId} value={p.userId}>{p.name}</option>)}
                  </select>
                </label>
                <label className="flex min-h-9 items-center gap-1 text-xs font-semibold"><input type="checkbox" name="isManager" />Department manager</label>
                <Submit className="btn btn-secondary btn-sm">Save</Submit>
              </Form>
            )}
          </li>
        ))}
        {departments.length === 0 && <li className="text-sm text-gray-600">No departments yet.</li>}
      </ul>
      {canEdit && (
        <Form action={a.createDepartmentAction} className="mt-3 flex items-end gap-2">
          <label className="flex-1 text-xs font-bold">New department<input name="name" required minLength={2} maxLength={60} placeholder="e.g. Operations" className="input" /></label>
          <Submit className="btn btn-primary">Add department</Submit>
        </Form>
      )}
    </Card>
  );
}
