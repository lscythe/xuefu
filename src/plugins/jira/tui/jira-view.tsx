import { useKeyboard } from "@opentui/solid";
import {
  type Accessor,
  type Component,
  createEffect,
  createSignal,
  For,
  Match,
  on,
  onCleanup,
  Show,
  Switch,
} from "solid-js";
import { confirmationTokenFor } from "../../../application/commands/command";
import type { AppError } from "../../../application/errors";
import type { ConfirmationPrompt } from "../../../domain/shared/confirmation";
import { validationError } from "../../../domain/shared/errors";
import { ConfirmDialog } from "../../../tui/confirm-dialog";
import { ErrorLine } from "../../../tui/error-line";
import { cycle, scrollOffset } from "../../../tui/list-navigation";
import { fitHints } from "../../../tui/shell/panel-status";
import type { SectionProps } from "../../../tui/shell/section-props";
import { truncateToWidth } from "../../../tui/shell/tab-labels";
import { PALETTE } from "../../../tui/theme/palette";
import { statusGlyph } from "../../../tui/theme/status";
import { type JiraChanges, startWorkOnIssue } from "../application/start-work";
import { IssueDialog } from "./issue-dialog";
import { categoryTone, type FoundIssues, issueColumns, issueCount } from "./issue-rows";

/** Everything the section needs from the Jira plugin. */
export interface JiraSection {
  /** Reads issues, starts work on them, and moves them in Jira. */
  readonly changes: JiraChanges;
  readonly jql: string;
  readonly maxResults: number;
  readonly refreshMs: number;
  /** The time zone dates are shown in; the host's unless given. */
  readonly timeZone?: string;
}

/** A line above the list: what is running, how it went, or what did not. */
interface Banner {
  readonly kind: "running" | "success" | "warning";
  readonly text: string;
}

/** A confirmation on screen, and how to answer it. */
interface Asking {
  readonly prompt: ConfirmationPrompt;
  readonly answer: (approved: boolean) => void;
}

const padded = (text: string, width: number) =>
  text + " ".repeat(Math.max(0, width - Bun.stringWidth(text)));

/**
 * The Jira section: the issues the configured query finds, read when it opens and every
 * `refreshMs` while it stays open. Reads never overlap, and one still running when the section
 * closes is stopped. A failed refresh keeps the issues last read and says why above them. With the
 * keyboard, Enter shows the issue under the cursor, `s` starts work on it in the front workspace,
 * offering to move it to in progress in Jira, and `r` reads the list again.
 */
export function jiraView(section: JiraSection): Component<SectionProps> {
  const { changes, jql, maxResults, refreshMs, timeZone } = section;
  const { client, actions } = changes;
  // The last list read, so the section opens on it while it reads again.
  let last: FoundIssues | null = null;

  return (props) => {
    const [found, setFound] = createSignal<FoundIssues | null>(last);
    const [failure, setFailure] = createSignal<AppError | null>(null);
    const [cursor, setCursor] = createSignal(0);
    const [opened, setOpened] = createSignal<string | null>(null);
    const [busy, setBusy] = createSignal(false);
    const [banner, setBanner] = createSignal<Banner | null>(null);
    const [asking, setAsking] = createSignal<Asking | null>(null);
    const ascii = () => props.icons === "ascii";

    let running: AbortController | null = null;
    let stopped = false;
    const load = async () => {
      if (running !== null) return;
      running = new AbortController();
      const result = await client.search(jql, maxResults, running.signal);
      running = null;
      if (stopped) return;
      if (result.ok) {
        last = result.value;
        setFound(result.value);
        setFailure(null);
      } else {
        setFailure(result.error);
      }
    };
    void load();
    const timer = setInterval(() => void load(), refreshMs);
    onCleanup(() => {
      stopped = true;
      clearInterval(timer);
      running?.abort();
    });

    // A dialog of the section's has every key while it is open.
    const modal = () => opened() !== null || asking() !== null;
    createEffect(on(modal, (open) => props.setModal(open), { defer: true }));
    onCleanup(() => {
      if (modal()) props.setModal(false);
    });

    const issues = () => found()?.issues ?? [];
    /** The cursor, kept in range as the list changes. */
    const at = () => Math.min(cursor(), Math.max(0, issues().length - 1));

    createEffect(() => {
      const shown = found();
      props.setStatus(shown === null ? null : issueCount(shown));
    });

    createEffect(() => {
      if (!props.focused) {
        props.setKeys(null);
        return;
      }
      props.setKeys(
        fitHints(
          [
            ...(issues().length > 0
              ? [
                  { text: "enter details", rank: 0 },
                  { text: "s start work", rank: 1 },
                ]
              : []),
            { text: "r refresh", rank: 2 },
          ],
          props.width - 2,
          ascii(),
        ),
      );
    });

    /** Shows a confirmation and resolves to the answer. */
    const ask = (prompt: ConfirmationPrompt) =>
      new Promise<boolean>((resolve) =>
        setAsking({
          prompt,
          answer: (approved) => {
            setAsking(null);
            resolve(approved);
          },
        }),
      );

    /**
     * Starts work on the issue in the front workspace, then offers to move it to in progress,
     * asking first, as the move changes Jira for the whole team.
     */
    const startWork = async (key: string) => {
      const workspace = props.workspace;
      if (workspace === null) {
        props.report(
          validationError("No workspace is open", [
            { path: "workspace", message: "open one with Ctrl+W to work there" },
          ]),
        );
        return;
      }
      setBusy(true);
      setBanner({ kind: "running", text: `Starting work on ${key}...` });
      const started = await startWorkOnIssue(changes, workspace.id, key);
      if (!started.ok) {
        setBusy(false);
        setBanner(null);
        props.report(started.error);
        return;
      }
      const { move, unread } = started.value;
      const working = `Working on ${key} in ${workspace.name}.`;
      setBanner(
        unread === null
          ? { kind: "success", text: working }
          : { kind: "warning", text: `${working} Could not read its moves: ${unread.message}` },
      );
      if (move !== null) {
        const asked = await changes.invoke(actions.move, move);
        const moved =
          !asked.ok && asked.error.kind === "confirmation-required"
            ? (await ask(asked.error.prompt))
              ? await changes.invoke(actions.move, move, {
                  confirmation: confirmationTokenFor(asked.error),
                })
              : null
            : asked;
        if (moved !== null && !moved.ok) props.report(moved.error);
        if (moved?.ok === true) {
          setBanner({ kind: "success", text: `${working} Moved it to ${move.to}.` });
          void load();
        }
      }
      setBusy(false);
    };

    useKeyboard((key) => {
      if (!props.focused || modal() || busy()) return;
      const count = issues().length;
      switch (key.name) {
        case "up":
        case "k":
          if (count > 0) setCursor(cycle(at(), -1, count));
          return;
        case "down":
        case "j":
          if (count > 0) setCursor(cycle(at(), 1, count));
          return;
        case "home":
          setCursor(0);
          return;
        case "end":
          setCursor(Math.max(0, count - 1));
          return;
        case "return": {
          const issue = issues()[at()];
          if (issue !== undefined) setOpened(issue.key);
          return;
        }
        case "s": {
          const issue = issues()[at()];
          if (issue !== undefined) void startWork(issue.key);
          return;
        }
        case "r":
          void load();
          return;
        default:
          return;
      }
    });

    /** Rows for the list: fewer for each line said above it. */
    const listRows = () =>
      Math.max(1, props.rows - (failure() === null ? 0 : 1) - (banner() === null ? 0 : 1));
    const bannerTone = (kind: Banner["kind"]) =>
      kind === "running" ? PALETTE.busy : kind === "success" ? PALETTE.success : PALETTE.warning;
    const bannerGlyph = (kind: Banner["kind"]) =>
      kind === "warning" ? (ascii() ? "[!]" : "⚠") : statusGlyph(kind, props.icons);
    const drawn = () => {
      const all = issues();
      const top = scrollOffset(props.focused ? at() : 0, all.length, listRows());
      return all.slice(top, top + listRows()).map((issue, index) => ({
        issue,
        chosen: props.focused && top + index === at(),
      }));
    };
    const columns = () => issueColumns(issues());
    const summaryWidth = () => Math.max(1, props.width - columns().key - columns().status - 4);

    return (
      <>
        <Switch>
          <Match when={found() === null && failure()}>
            {(error: Accessor<AppError>) => (
              <>
                <ErrorLine error={error()} ascii={ascii()} />
                <Show when={error().hint}>
                  {(hint: Accessor<string>) => <text fg={PALETTE.textMuted}>{hint()}</text>}
                </Show>
              </>
            )}
          </Match>
          <Match when={found() === null}>
            <text fg={PALETTE.textMuted}>Reading your Jira issues...</text>
          </Match>
          <Match when={issues().length === 0}>
            <text fg={PALETTE.success}>No issues match the query.</text>
            <text fg={PALETTE.textMuted}>{truncateToWidth(jql, props.width)}</text>
          </Match>
          <Match when={true}>
            <Show when={banner()}>
              {(line: Accessor<Banner>) => (
                <text>
                  <span
                    style={{ fg: bannerTone(line().kind) }}
                  >{`${bannerGlyph(line().kind)} `}</span>
                  <span style={{ fg: PALETTE.text }}>
                    {truncateToWidth(line().text, props.width - 2)}
                  </span>
                </text>
              )}
            </Show>
            <Show when={failure()}>
              {(error: Accessor<AppError>) => (
                <text>
                  <span style={{ fg: PALETTE.warning }}>{ascii() ? "[!] " : "⚠ "}</span>
                  <span style={{ fg: PALETTE.textMuted }}>
                    {truncateToWidth(`Could not refresh: ${error().message}`, props.width - 2)}
                  </span>
                </text>
              )}
            </Show>
            <For each={drawn()}>
              {({ issue, chosen }) => {
                const bg = chosen ? PALETTE.selectionBg : PALETTE.bg;
                return (
                  <text flexShrink={0}>
                    <span style={{ fg: PALETTE.accentSecondary, bg }}>
                      {padded(issue.key, columns().key)}
                    </span>
                    <span style={{ bg }}>{"  "}</span>
                    <span style={{ fg: PALETTE[categoryTone(issue.status.category)], bg }}>
                      {padded(
                        truncateToWidth(issue.status.name, columns().status),
                        columns().status,
                      )}
                    </span>
                    <span style={{ bg }}>{"  "}</span>
                    <span style={{ fg: chosen ? PALETTE.selectionFg : PALETTE.text, bg }}>
                      {padded(
                        truncateToWidth(issue.summary, summaryWidth()),
                        chosen ? summaryWidth() : 0,
                      )}
                    </span>
                  </text>
                );
              }}
            </For>
          </Match>
        </Switch>
        <Show when={opened()}>
          {(key: Accessor<string>) => (
            <IssueDialog
              issueKey={key()}
              load={(signal) => client.issue(key(), signal)}
              url={client.browseUrl(key())}
              icons={props.icons}
              timeZone={timeZone}
              onClose={() => setOpened(null)}
            />
          )}
        </Show>
        <Show when={asking()}>
          {(shown: Accessor<Asking>) => (
            <ConfirmDialog prompt={shown().prompt} icons={props.icons} onAnswer={shown().answer} />
          )}
        </Show>
      </>
    );
  };
}
