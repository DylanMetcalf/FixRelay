import { NextResponse, type NextRequest } from "next/server";

/**
 * Passes the requested path to server components so that, when a signed-out person opens a link from an email
 * (for example /jobs/…), the sign-in page can send them back to exactly that page afterwards.
 */
export function middleware(req: NextRequest) {
  const headers = new Headers(req.headers);
  headers.set("x-manop-path", `${req.nextUrl.pathname}${req.nextUrl.search}`.slice(0, 500));
  return NextResponse.next({ request: { headers } });
}

export const config = { matcher: ["/((?!api|_next/static|_next/image|favicon|icon|apple-touch|brand|screenshots|sw.js|offline.html).*)"] };
