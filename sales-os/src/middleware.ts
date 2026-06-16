export { default } from "next-auth/middleware";

/**
 * Protect the authenticated app surface. Unauthenticated users hitting any of
 * these routes are redirected to /login (configured via NextAuth pages.signIn).
 */
export const config = {
  matcher: [
    "/dashboard/:path*",
    "/leads/:path*",
    "/pipeline/:path*",
    "/campaigns/:path*",
    "/generator/:path*",
    "/templates/:path*",
    "/tasks/:path*",
    "/approvals/:path*",
    "/analytics/:path*",
    "/copilot/:path*",
    "/settings/:path*",
  ],
};
