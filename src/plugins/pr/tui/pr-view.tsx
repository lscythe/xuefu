import { useKeyboard } from "@opentui/solid";
import {
  type Accessor,
  type Component,
  createEffect,
  createMemo,
  createSignal,
  For,
  Match,
  on,
  onCleanup,
  Show,
  Switch,
} from "solid-js";
import type { AppError } from "../../../application/errors";
import { createAsking } from "../../../tui/asking";
import { type Banner, BannerLine } from "../../../tui/banner-line";
import { ErrorLine } from "../../../tui/error-line";
import { cycle, scrollOffset } from "../../../tui/list-navigation";
import { fitHints } from "../../../tui/shell/panel-status";
import type { SectionProps } from "../../../tui/shell/section-props";
import { truncateToWidth } from "../../../tui/shell/tab-labels";
import { PALETTE } from "../../../tui/theme/palette";
import { mergeInput, type PrChanges, reviewInput } from "../application/actions";
import { branchPullRequest, whyNoPullRequest } from "../application/branch-pull-request";
import { readyToMerge } from "../application/merge";
import type { PullRequest, ReviewStatus } from "../domain/pull-request";
import { type PrLists, type PullRow, prColumns, prRows, reviewBadge, shortRef } from "./pr-rows";
import { PullRequestDialog } from "./pull-request-dialog";
import { ReviewDialog } from "./review-dialog";
import { reviewQuestion } from "./review-question";

/** Everything the section needs from the pull requests plugin. */
export interface PrSection extends PrChanges {
  readonly maxResults: number;
  readonly refreshMs: number;
  /** The time zone dates are shown in; the host's unless given. */
  readonly timeZone?: string;
}

interface Lists {
  readonly yours: readonly PullRequest[];
  readonly toReview: readonly PullRequest[];
}

const padded = (text: string, width: number) =>
  text + " ".repeat(Math.max(0, width - Bun.stringWidth(text)));

/** What a review key says once the server has it. */
const REVIEWED: Readonly<Record<ReviewStatus, string>> = {
  approved: "Approved",
  "needs-work": "Asked for changes on",
  unapproved: "Withdrew your review of",
};

/**
 * The pull requests section: the one from the front workspace's branch, then yours, then those
 * waiting on your review, read when it opens and every `refreshMs` while it stays open. Reads
 * never overlap, and one still running when the section closes is stopped. A failed refresh keeps
 * what was last read and says why above it. With the keyboard, Enter shows the pull request under
 * the cursor; `a` approves it, `n` asks for changes, `u` withdraws either, and `m` merges it once
 * Bitbucket says it can be, each asking first; and `r` reads everything again.
 */
export function prView(section: PrSection): Component<SectionProps> {
  const { client, invoke, actions, maxResults, refreshMs, timeZone } = section;
  // The lists last read, so the section opens on them while it reads again.
  let last: Lists | null = null;

  return (props) => {
    const [lists, setLists] = createSignal<Lists | null>(last);
    const [failure, setFailure] = createSignal<AppError | null>(null);
    const [branch, setBranch] = createSignal<{
      readonly workspace: string;
      readonly shown: PullRequest | string;
    } | null>(null);
    const [cursor, setCursor] = createSignal(0);
    const [opened, setOpened] = createSignal<PullRequest | null>(null);
    const [reviewing, setReviewing] = createSignal<PullRequest | null>(null);
    const [busy, setBusy] = createSignal(false);
    const [banner, setBanner] = createSignal<Banner | null>(null);
    const { asking, confirmed, AskingDialog } = createAsking();
    const ascii = () => props.icons === "ascii";

    let running: AbortController | null = null;
    let stopped = false;
    const load = async () => {
      if (running !== null) return;
      const reading = new AbortController();
      running = reading;
      const workspace = props.workspace;
      const [yours, toReview, fromBranch] = await Promise.all([
        client.mine("author", maxResults, reading.signal),
        client.mine("reviewer", maxResults, reading.signal),
        workspace === null ? null : branchPullRequest(section, workspace.path, reading.signal),
      ]);
      // A read stopped for another workspace's leaves the one that replaced it alone.
      if (running === reading) running = null;
      if (stopped || reading.signal.aborted) return;
      if (yours.ok && toReview.ok) {
        last = { yours: yours.value.pullRequests, toReview: toReview.value.pullRequests };
        setLists(last);
        setFailure(null);
      } else {
        setFailure(yours.ok ? (toReview.ok ? null : toReview.error) : yours.error);
      }
      if (workspace !== null && fromBranch !== null) {
        setBranch({
          workspace: workspace.id,
          shown: !fromBranch.ok
            ? `Could not look: ${fromBranch.error.message}`
            : fromBranch.value.kind === "found"
              ? fromBranch.value.pullRequest
              : whyNoPullRequest(fromBranch.value, workspace.name, section.host),
        });
      }
    };
    const timer = setInterval(() => void load(), refreshMs);
    onCleanup(() => {
      stopped = true;
      clearInterval(timer);
      running?.abort();
    });
    // Read again whenever another workspace comes to the front, for its branch.
    createEffect(
      on(
        () => props.workspace?.id,
        () => {
          running?.abort();
          running = null;
          setCursor(0);
          void load();
        },
      ),
    );

    // A dialog of the section's has every key while it is open.
    const modal = () => opened() !== null || reviewing() !== null || asking();
    createEffect(on(modal, (open) => props.setModal(open), { defer: true }));
    onCleanup(() => {
      if (modal()) props.setModal(false);
    });

    const rows = createMemo(() => {
      const read = lists();
      const workspace = props.workspace;
      const fromBranch = branch();
      const shown: PrLists = {
        branch:
          workspace === null
            ? "No workspace is open"
            : fromBranch?.workspace === workspace.id
              ? fromBranch.shown
              : null,
        yours: read?.yours ?? null,
        toReview: read?.toReview ?? null,
      };
      return prRows(shown);
    });
    const pulls = createMemo(() => rows().filter((row): row is PullRow => row.kind === "pull"));
    /** The pull request under the cursor, kept in range as the lists change. */
    const selected = () => {
      const all = pulls();
      return all.length === 0 ? null : (all[Math.min(cursor(), all.length - 1)] ?? null);
    };

    createEffect(() => {
      const read = lists();
      props.setStatus(
        read === null
          ? null
          : read.toReview.length > 0
            ? `${read.toReview.length} to review`
            : `${read.yours.length} yours`,
      );
    });

    createEffect(() => {
      if (!props.focused) {
        props.setKeys(null);
        return;
      }
      props.setKeys(
        fitHints(
          [
            ...(pulls().length > 0
              ? [
                  { text: "enter details", rank: 0 },
                  { text: "d diff", rank: 1 },
                  { text: "a approve", rank: 2 },
                  { text: "n needs work", rank: 3 },
                  { text: "m merge", rank: 4 },
                  { text: "u withdraw", rank: 6 },
                  ...(props.askAgent == null ? [] : [{ text: "A ask claude", rank: 7 }]),
                ]
              : []),
            { text: "r refresh", rank: 5 },
          ],
          props.width - 2,
          ascii(),
        ),
      );
    });

    /** Sets your review of the pull request, asking first, then reads the lists again. */
    const review = async (pull: PullRequest, status: ReviewStatus) => {
      setBusy(true);
      const sent = await confirmed((options) =>
        invoke(actions.review, reviewInput(pull, status), options),
      );
      setBusy(false);
      if (sent === null) return;
      if (!sent.ok) {
        props.report(sent.error);
        return;
      }
      setBanner({ kind: "success", text: `${REVIEWED[status]} ${shortRef(pull)}.` });
      void load();
    };

    /**
     * Merges the pull request once Bitbucket says it can be, asking first, then reads the lists
     * again. When it cannot be merged yet, why is said above the list.
     */
    const merge = async (pull: PullRequest) => {
      setBusy(true);
      setBanner({ kind: "running", text: `Checking ${shortRef(pull)} can be merged...` });
      const ready = await readyToMerge(client, pull);
      if (!ready.ok) {
        setBusy(false);
        const { message, hint } = ready.error;
        setBanner({ kind: "warning", text: hint === undefined ? message : `${message}: ${hint}` });
        return;
      }
      setBanner(null);
      const merged = await confirmed((options) => invoke(actions.merge, mergeInput(pull), options));
      setBusy(false);
      if (merged === null) return;
      if (!merged.ok) {
        props.report(merged.error);
        return;
      }
      setBanner({ kind: "success", text: `Merged ${shortRef(pull)} into ${pull.to}.` });
      void load();
    };

    /** Opens a conversation with the agent on reviewing the pull request. */
    const askReview = (pull: PullRequest) => {
      setOpened(null);
      props.askAgent?.(reviewQuestion(pull, section.host));
    };

    useKeyboard((key) => {
      if (!props.focused || modal() || busy()) return;
      const count = pulls().length;
      const at = Math.min(cursor(), Math.max(0, count - 1));
      if (key.shift && key.name === "a") {
        const row = selected();
        if (row !== null) askReview(row.pull);
        return;
      }
      switch (key.name) {
        case "up":
        case "k":
          if (count > 0) setCursor(cycle(at, -1, count));
          return;
        case "down":
        case "j":
          if (count > 0) setCursor(cycle(at, 1, count));
          return;
        case "home":
          setCursor(0);
          return;
        case "end":
          setCursor(Math.max(0, count - 1));
          return;
        case "return": {
          const row = selected();
          if (row !== null) setOpened(row.pull);
          return;
        }
        case "a":
        case "n":
        case "u": {
          const row = selected();
          const status =
            key.name === "a" ? "approved" : key.name === "n" ? "needs-work" : "unapproved";
          if (row !== null) void review(row.pull, status);
          return;
        }
        case "m": {
          const row = selected();
          if (row !== null) void merge(row.pull);
          return;
        }
        case "d": {
          const row = selected();
          if (row !== null) setReviewing(row.pull);
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
    const drawn = () => {
      const all = rows();
      const chosen = props.focused ? selected() : null;
      const at = chosen === null ? 0 : all.indexOf(chosen);
      const top = scrollOffset(at, all.length, listRows());
      return all.slice(top, top + listRows()).map((row) => ({ row, chosen: row === chosen }));
    };
    const columns = () => prColumns(rows());
    const titleWidth = () => Math.max(1, props.width - columns().ref - columns().reviews - 4);

    return (
      <>
        <Switch>
          <Match when={lists() === null && failure()}>
            {(error: Accessor<AppError>) => (
              <>
                <ErrorLine error={error()} ascii={ascii()} />
                <Show when={error().hint}>
                  {(hint: Accessor<string>) => <text fg={PALETTE.textMuted}>{hint()}</text>}
                </Show>
              </>
            )}
          </Match>
          <Match when={lists() === null}>
            <text fg={PALETTE.textMuted}>Reading your pull requests...</text>
          </Match>
          <Match when={true}>
            <Show when={banner()}>
              {(line: Accessor<Banner>) => (
                <BannerLine banner={line()} width={props.width} icons={props.icons} />
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
              {({ row, chosen }) => {
                if (row.kind === "heading") {
                  return (
                    <text fg={PALETTE.accentTertiary} flexShrink={0}>
                      <b>{row.text}</b>
                    </text>
                  );
                }
                if (row.kind === "note") {
                  return (
                    <text fg={PALETTE[row.tone]} flexShrink={0}>
                      {truncateToWidth(row.text, props.width) || " "}
                    </text>
                  );
                }
                const bg = chosen ? PALETTE.selectionBg : PALETTE.bg;
                const review = reviewBadge(row.pull);
                return (
                  <text flexShrink={0}>
                    <span style={{ fg: PALETTE.accentSecondary, bg }}>
                      {padded(shortRef(row.pull), columns().ref)}
                    </span>
                    <span style={{ bg }}>{"  "}</span>
                    <span style={{ fg: PALETTE[review.tone], bg }}>
                      {padded(review.text, columns().reviews)}
                    </span>
                    <span style={{ bg }}>{"  "}</span>
                    <span style={{ fg: chosen ? PALETTE.selectionFg : PALETTE.text, bg }}>
                      {padded(
                        truncateToWidth(row.pull.title, titleWidth()),
                        chosen ? titleWidth() : 0,
                      )}
                    </span>
                  </text>
                );
              }}
            </For>
          </Match>
        </Switch>
        <Show when={opened()}>
          {(pull: Accessor<PullRequest>) => (
            <PullRequestDialog
              pull={pull()}
              builds={(signal) => client.builds(pull().commit, signal)}
              icons={props.icons}
              timeZone={timeZone}
              onReview={() => {
                setReviewing(pull());
                setOpened(null);
              }}
              onAsk={props.askAgent == null ? null : () => askReview(pull())}
              onClose={() => setOpened(null)}
            />
          )}
        </Show>
        <Show when={reviewing()}>
          {(pull: Accessor<PullRequest>) => (
            <ReviewDialog
              pull={pull()}
              changes={section}
              icons={props.icons}
              timeZone={timeZone}
              onClose={() => setReviewing(null)}
            />
          )}
        </Show>
        <AskingDialog icons={props.icons} />
      </>
    );
  };
}
