import path from "node:path";
import { fileURLToPath } from "node:url";

const appRoot = path.dirname(fileURLToPath(import.meta.url));

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  outputFileTracingRoot: appRoot,
  serverExternalPackages: ["@prisma/client", "bcryptjs"],
  // Lint is run via `npm run lint`; don't block production builds on it.
  eslint: { ignoreDuringBuilds: true },
};

export default nextConfig;
