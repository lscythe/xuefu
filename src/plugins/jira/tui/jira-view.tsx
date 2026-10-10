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
import type { AppError } from "../../../application/errors";
import { ErrorLine } from "../../../tui/error-line";
import { cycle, scrollOffset } from "../../../tui/list-navigation";
import { fitHints } from "../../../tui/shell/panel-status";
import type { SectionProps } from "../../../tui/shell/section-props";
import { truncateToWidth } from "../../../tui/shell/tab-labels";
import { PALETTE } from "../../../tui/theme/palette";
import type { JiraClient } from "../application/jira-client";
import { IssueDialog } from "./issue-dialog";
import { categoryTone, type FoundIssues, issueColumns, issueCount } from "./issue-rows";

/** Everything the section needs from the Jira plugin. */
export interface JiraSection {
  readonly client: JiraClient;
  readonly jql: string;
  readonly maxResults: number;
  readonly refreshMs: number;
  /** The time zone dates are shown in; the host's unless given. */
  readonly timeZone?: string;
}

const padded = (text: string, width: number) =>
  text + " ".repeat(Math.max(0, width - Bun.stringWidth(text)));

/**
 * The Jira section: the issues the configured query finds, read when it opens and every
 * `refreshMs` while it stays open. Reads never overlap, and one still running when the section
 * closes is stopped. A failed refresh keeps the issues last read and says why above them. With the
 * keyboard, Enter shows the issue under the cursor and `r` reads the list again.
 */
export function jiraView(section: JiraSection): Component<SectionProps> {
  const { client, jql, maxResults, refreshMs, timeZone } = section;
  // The last list read, so the section opens on it while it reads again.
  let last: FoundIssues | null = null;

  return (props) => {
    const [found, setFound] = createSignal<FoundIssues | null>(last);
    const [failure, setFailure] = createSignal<AppError | null>(null);
    const [cursor, setCursor] = createSignal(0);
    const [opened, setOpened] = createSignal<string | null>(null);
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

    // The issue dialog has every key while it is open.
    const modal = () => opened() !== null;
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
            ...(issues().length > 0 ? [{ text: "enter details", rank: 0 }] : []),
            { text: "r refresh", rank: 1 },
          ],
          props.width - 2,
          ascii(),
        ),
      );
    });

    useKeyboard((key) => {
      if (!props.focused || modal()) return;
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
        case "r":
          void load();
          return;
        default:
          return;
      }
    });

    /** Rows for the list: one less when a failed refresh is said above it. */
    const listRows = () => Math.max(1, props.rows - (failure() === null ? 0 : 1));
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
      </>
    );
  };
}
