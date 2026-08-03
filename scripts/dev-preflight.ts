#!/usr/bin/env bun

import { spawn, spawnSync } from "child_process";
import { existsSync } from "fs";
import { Socket } from "net";
import { join } from "path";

import { parseServerEnv } from "../packages/shared/src/index";

const REPO_ROOT = join(import.meta.dir, "..");

const TCP_PROBE_TIMEOUT_MS = 2_000;
const DOCKER_DAEMON_WAIT_MS = 120_000;
const POSTGRES_READY_WAIT_MS = 60_000;
const POLL_INTERVAL_MS = 2_000;

const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);

function fail(message: string): never {
  console.error(`\n✗ ${message}`);
  process.exit(1);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function probeTcp(host: string, port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = new Socket();
    const done = (up: boolean) => {
      socket.destroy();
      resolve(up);
    };
    socket.setTimeout(TCP_PROBE_TIMEOUT_MS);
    socket.once("connect", () => done(true));
    socket.once("timeout", () => done(false));
    socket.once("error", () => done(false));
    socket.connect(port, host);
  });
}

function dockerDaemonUp(): boolean {
  return spawnSync("docker", ["info"], { stdio: "ignore", shell: true }).status === 0;
}

function launchDockerDesktop(): boolean {
  if (process.platform === "win32") {
    const exe = join(
      process.env.ProgramFiles ?? "C:\\Program Files",
      "Docker",
      "Docker",
      "Docker Desktop.exe",
    );
    if (!existsSync(exe)) return false;
    spawn(exe, [], { detached: true, stdio: "ignore" }).unref();
    return true;
  }
  if (process.platform === "darwin") {
    return spawnSync("open", ["-a", "Docker"], { stdio: "ignore" }).status === 0;
  }
  return false;
}

async function ensureDockerDaemon(): Promise<void> {
  if (dockerDaemonUp()) return;

  console.log("Docker isn't running — starting it…");
  if (!launchDockerDesktop()) {
    fail("Docker isn't running and couldn't be started automatically. Start it, then re-run.");
  }

  const deadline = Date.now() + DOCKER_DAEMON_WAIT_MS;
  while (Date.now() < deadline) {
    await sleep(POLL_INTERVAL_MS);
    if (dockerDaemonUp()) {
      console.log("Docker is up.");
      return;
    }
  }
  fail("Docker didn't become ready in time. Start Docker Desktop manually, then re-run.");
}

async function ensurePostgres(host: string, port: number): Promise<void> {
  if (await probeTcp(host, port)) return;

  if (!LOOPBACK_HOSTS.has(host)) {
    fail(
      `DATABASE_URL points at ${host}:${port}, which is unreachable. ` +
        "That database isn't managed by this repo — check the address or your VPN/tunnel.",
    );
  }

  await ensureDockerDaemon();

  console.log("Starting Postgres (docker compose up -d postgres)…");
  const up = spawnSync("docker", ["compose", "up", "-d", "postgres"], {
    cwd: REPO_ROOT,
    stdio: "inherit",
    shell: true,
  });
  if (up.status !== 0) {
    fail("`docker compose up -d postgres` failed — see the output above.");
  }

  const deadline = Date.now() + POSTGRES_READY_WAIT_MS;
  while (Date.now() < deadline) {
    if (await probeTcp(host, port)) {
      console.log("Postgres is accepting connections.");
      return;
    }
    await sleep(POLL_INTERVAL_MS);
  }
  fail("Postgres started but never became reachable. Check: docker compose logs postgres");
}

function runMigrations(): void {
  console.log("Applying any pending database migrations…");
  const result = spawnSync("bun", ["run", "--filter", "@growthmind/db", "db:migrate"], {
    cwd: REPO_ROOT,
    stdio: "inherit",
    shell: true,
  });
  if (result.status !== 0) {
    fail("Migrations failed — see the output above. The dev server was not started.");
  }
}

const env = parseServerEnv(process.env);
const url = new URL(env.DATABASE_URL);
const host = url.hostname;
const port = Number(url.port || "5432");

await ensurePostgres(host, port);
runMigrations();
console.log("✓ Database is running and up to date.");
