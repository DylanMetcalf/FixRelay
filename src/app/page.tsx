import { redirect } from "next/navigation";
import { getSession } from "./_lib/session";

export default async function Home() {
  redirect((await getSession()) ? "/dashboard" : "/login");
}
