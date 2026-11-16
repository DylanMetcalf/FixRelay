import NextLink from "next/link";
import type { ComponentProps } from "react";

/**
 * App-wide link. Prefetch is OFF: every page is per-user and dynamic, so prefetching a dozen navigation
 * targets on each render only costs database queries (and, in production, raced with server actions).
 */
export default function Link(props: ComponentProps<typeof NextLink>) {
  return <NextLink prefetch={false} {...props} />;
}
