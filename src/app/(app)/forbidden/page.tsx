import Link from "next/link";
import { Empty } from "@/components/ui";

export default function Forbidden() {
  return <Empty title="You do not have permission to view this page">Ask your company administrator if you need access. <Link className="link" href="/dashboard">Back to dashboard</Link></Empty>;
}
