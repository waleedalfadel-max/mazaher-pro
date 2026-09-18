import { cpSync, rmSync } from "node:fs";
import { execFileSync } from "node:child_process";

const npm = process.platform === "win32" ? "npm.cmd" : "npm";

execFileSync(npm, ["run", "build:tatmira"], { stdio: "inherit" });
execFileSync(npm, ["run", "build:tatmira-accounts"], { stdio: "inherit" });

rmSync("dist-tatmira/accounts", { recursive: true, force: true });
cpSync("dist-tatmira-accounts", "dist-tatmira/accounts", {
  recursive: true,
});
