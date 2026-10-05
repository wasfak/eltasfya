import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The winter API reads its bundled sales JSON from disk at runtime, so make
  // sure the file ships with that route's server trace.
  outputFileTracingIncludes: {
    "/api/winter": ["./lib/winter/sales.json"],
  },
};

export default nextConfig;
