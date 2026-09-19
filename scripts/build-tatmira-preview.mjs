import { cpSync, rmSync, mkdirSync } from "node:fs";
import { execFileSync } from "node:child_process";

const npm = process.platform === "win32" ? "npm.cmd" : "npm";

execFileSync(npm, ["run", "build:tatmira"], { stdio: "inherit" });
execFileSync(npm, ["run", "build:tatmira-accounts"], { stdio: "inherit" });

rmSync("dist-tatmira-preview", { recursive: true, force: true });
cpSync("dist-tatmira-accounts", "dist-tatmira-preview", { recursive: true });
mkdirSync("dist-tatmira-preview/demo", { recursive: true });
cpSync("dist-tatmira/index.html", "dist-tatmira-preview/demo/index.html");
cpSync("dist-tatmira/assets", "dist-tatmira-preview/demo/assets", { recursive: true });
