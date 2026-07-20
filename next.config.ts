import type { NextConfig } from "next";

const isGitHubPages = process.env.GITHUB_ACTIONS === "true";
const repositoryBasePath = isGitHubPages ? "/kladovaya" : "";

const nextConfig: NextConfig = {
  output: "export",
  images: { unoptimized: true },
  basePath: repositoryBasePath,
  assetPrefix: repositoryBasePath,
  trailingSlash: true
};

export default nextConfig;
