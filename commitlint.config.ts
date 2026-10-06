import type { UserConfig } from "@commitlint/types";

const config: UserConfig = {
  extends: ["@commitlint/config-conventional"],
  // Dependabot writes long release-note lines and its own scopes; its PR title is still linted.
  ignores: [(message) => message.includes("Signed-off-by: dependabot[bot]")],
  rules: {
    "header-max-length": [2, "always", 100],
    "body-max-line-length": [2, "always", 100],
    // Scopes mirror bounded contexts and tooling areas; extend deliberately.
    "scope-enum": [
      2,
      "always",
      [
        "shared",
        "app",
        "config",
        "db",
        "logging",
        "events",
        "commands",
        "cli",
        "tui",
        "theme",
        "workspace",
        "work",
        "timesheet",
        "activity",
        "git",
        "jira",
        "pr",
        "jenkins",
        "android",
        "notes",
        "arch",
        "ci",
        "release",
        "deps",
        "deps-dev",
        "tooling",
        "docs",
      ],
    ],
  },
};

export default config;
