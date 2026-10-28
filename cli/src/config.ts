import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { CliError } from "./errors";

export interface PuckConfig {
  deploymentUrl: string;
  siteUrl: string;
  defaultBot?: string;
}

interface FileConfig {
  deploymentUrl?: unknown;
  siteUrl?: unknown;
  defaultBot?: unknown;
}

export function defaultConfigDir(env: NodeJS.ProcessEnv = process.env): string {
  return env.PUCK_CONFIG_DIR ?? join(homedir(), ".config", "puck");
}

/** `.convex.cloud` deployments serve HTTP actions on `.convex.site`. */
export function siteUrlFromDeployment(deploymentUrl: string): string {
  const parsed = new URL(deploymentUrl);
  if (parsed.protocol !== "https:") throw new CliError("deployment URL must be https");
  if (!parsed.hostname.endsWith(".convex.cloud")) {
    throw new CliError("set siteUrl in config when the deployment URL is not a convex.cloud host");
  }
  parsed.hostname = parsed.hostname.replace(/\.convex\.cloud$/u, ".convex.site");
  return parsed.origin;
}

function httpsOrigin(value: string, field: string): string {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new CliError(`${field} must be an https URL`);
  }
  if (parsed.protocol !== "https:") throw new CliError(`${field} must be an https URL`);
  return parsed.origin;
}

export async function loadConfig(configDir: string, env: NodeJS.ProcessEnv): Promise<PuckConfig> {
  const path = join(configDir, "config.json");
  let file: FileConfig = {};
  try {
    file = JSON.parse(await readFile(path, "utf8")) as FileConfig;
  } catch (error) {
    const missing = error instanceof Error && "code" in error && error.code === "ENOENT";
    if (!missing) throw new CliError("could not read config.json");
  }
  if (typeof file !== "object" || file === null || Array.isArray(file)) {
    throw new CliError("config.json must be a JSON object");
  }

  const deploymentRaw = env.PUCK_DEPLOYMENT_URL?.trim() || (typeof file.deploymentUrl === "string" ? file.deploymentUrl.trim() : "");
  if (!deploymentRaw) {
    throw new CliError("Set deploymentUrl in ~/.config/puck/config.json or PUCK_DEPLOYMENT_URL.");
  }
  const deploymentUrl = httpsOrigin(deploymentRaw, "deployment URL");
  const siteRaw = env.PUCK_SITE_URL?.trim() || (typeof file.siteUrl === "string" ? file.siteUrl.trim() : "");
  const siteUrl = siteRaw ? httpsOrigin(siteRaw, "site URL") : siteUrlFromDeployment(deploymentUrl);
  const defaultBot = typeof file.defaultBot === "string" && file.defaultBot.trim() ? file.defaultBot.trim() : undefined;
  return { deploymentUrl, siteUrl, ...(defaultBot ? { defaultBot } : {}) };
}
