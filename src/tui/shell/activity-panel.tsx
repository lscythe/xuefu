import { type Accessor, For, Match, Show, Switch } from "solid-js";
import type { ActivitySubject } from "../../application/activity/describe";
import type { ActivityEntry } from "../../application/activity/queries";
import type { AppError } from "../../application/errors";
import type { Clock } from "../../application/ports/clock";
import type { Result } from "../../domain/shared/result";
import type { Workspace } from "../../domain/workspace/workspace";
import { ErrorLine } from "../error-line";
import { PALETTE } from "../theme/palette";
import { useNow } from "../use-now";
import { activityRows } from "./activity-rows";

export interface ActivityPanelProps {
  readonly clock: Clock;
  readonly timeZone: string | undefined;
  readonly tickMs: number;
  /** The workspace in front; null shows every workspace's activity, each entry named. */
  readonly workspace: Workspace | null;
  readonly activity: Result<readonly ActivityEntry[], AppError>;
  /** Screen rows and columns the panel may fill. */
  readonly rows: number;
  readonly width: number;
  readonly ascii: boolean;
}

/** The Activity section: what happened, newest first, under a heading for each day. */
export function ActivityPanel(props: ActivityPanelProps) {
  const now = useNow(props.clock, props.tickMs);
  const entries = () => (props.activity.ok ? props.activity.value : []);
  const rows = () =>
    activityRows(entries(), {
      rows: props.rows,
      width: props.width,
      now: now(),
      timeZone: props.timeZone,
      workspaces: props.workspace === null,
    });

  return (
    <Switch>
      <Match when={!props.activity.ok && props.activity.error}>
        {(error: Accessor<AppError>) => <ErrorLine error={error()} ascii={props.ascii} />}
      </Match>
      <Match when={entries().length === 0}>
        <text fg={PALETTE.textMuted}>
          {props.workspace === null
            ? "Nothing recorded yet."
            : `Nothing recorded in ${props.workspace.name} yet.`}
        </text>
      </Match>
      <Match when={true}>
        <For each={rows()}>
          {(row) =>
            row.kind === "day" ? (
              <text fg={PALETTE.accentTertiary}>
                <b>{row.label}</b>
              </text>
            ) : (
              <text wrapMode="none">
                <span style={{ fg: PALETTE.textMuted }}>{`${row.time}  `}</span>
                <Show when={row.workspace}>
                  {(name: Accessor<string>) => (
                    <span style={{ fg: PALETTE.textMuted }}>{`${name()}  `}</span>
                  )}
                </Show>
                <span style={{ fg: PALETTE.text }}>{row.description.action}</span>
                <Show when={row.description.subject}>
                  {(subject: Accessor<ActivitySubject>) =>
                    subject().kind === "issue" ? (
                      <span style={{ fg: PALETTE.accentSecondary }}>
                        <b>{` ${subject().text}`}</b>
                      </span>
                    ) : (
                      <span style={{ fg: PALETTE.text }}>{` ${subject().text}`}</span>
                    )
                  }
                </Show>
                <Show when={row.description.detail}>
                  {(detail: Accessor<string>) => (
                    <span style={{ fg: PALETTE.textMuted }}>{`  ${detail()}`}</span>
                  )}
                </Show>
              </text>
            )
          }
        </For>
      </Match>
    </Switch>
  );
}
