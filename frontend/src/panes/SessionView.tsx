import { useEffect, useState } from "react";
import api from "../api";
import { COMPACT_STEPS, duration, limitName, onSubscription, resetWords, tokens } from "./session-words";
import { get, set, useStore } from "../store";
import { ColumnHeader } from "./column-header";
import { Button } from "../ui/Button";
import { ExternalLink, Field, Meter, Row, Stepper, Switch, useLabelId } from "../ui/controls";
import { PageIcon } from "../ui/icons";

type Usage = Awaited<ReturnType<typeof api.usage>>;

/** The Claude session behind the project, as one view of the column:
 *  its name, remote control, how full the conversation is and where it is
 *  summarized, the plan's limits, what the project has used, and the
 *  session itself. Every control here is also somewhere else, the switch
 *  and the stepper in the settings sheet, so this is a place to look and
 *  to change, never the only one. */
export default function SessionView({
  onBack,
  onFold,
  usage,
}: {
  onBack: () => void;
  onFold?: () => void;
  usage: Usage | null;
}) {
  const projectId = useStore((s) => s.projectId);
  const session = useStore((s) => s.session);
  const [name, setName] = useState(session?.name ?? "");
  const [failed, setFailed] = useState("");
  const [copied, setCopied] = useState("");
  const remoteLabel = useLabelId();
  const [pages, setPages] = useState<{ name: string; modified: number }[] | null>(null);

  useEffect(() => {
    if (!projectId) return;
    let live = true;
    api.pages(projectId).then((answer) => live && setPages(answer.pages)).catch(() => live && setPages([]));
    return () => {
      live = false;
    };
  }, [projectId]);

  useEffect(() => {
    if (!projectId) return;
    let cancelled = false;
    api.agentSession(projectId).then((answer) => {
      if (cancelled) return;
      set({ session: answer });
      setName(answer.name ?? "");
    }).catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [projectId]);

  const change = async (what: { name?: string; remote?: boolean }) => {
    if (!projectId) return;
    setFailed("");
    try {
      const answer = await api.setAgentSession(projectId, what);
      set({ session: answer });
      setName(answer.name ?? "");
    } catch (error: any) {
      setFailed(error.message);
    }
  };

  const copy = async (text: string, which: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(which);
    } catch {
      setCopied("");
    }
  };

  const remote = session?.remote;
  const context = session?.context;
  const compactAt = session?.compactPercent ?? 60;
  const subscription = onSubscription(session);
  const totals = usage?.usage;

  return (
    <div className="flex h-full min-h-0 flex-col" data-testid="session-view">
      <ColumnHeader title="This session" onBack={onBack} backLabel="Back to the conversation" backTestid="session-back" onFold={onFold}>
        <span className="flex-1" />
      </ColumnHeader>
      <div className="nx-session min-h-0 flex-1 overflow-y-auto">
        <section className="nx-session-sec">
          <h3 className="nx-session-title">Name</h3>
          <Field
            className="nx-field-mono"
            frameClassName="nx-session-field"
            aria-label="The session's name"
            data-testid="session-name"
            value={name}
            maxLength={80}
            placeholder={session?.folderName ?? ""}
            onChange={(event) => setName(event.target.value)}
            onBlur={() => {
              if (name.trim() !== (session?.name ?? "")) void change({ name });
            }}
            onKeyDown={(event) => {
              if (event.key === "Enter") (event.target as HTMLInputElement).blur();
            }}
          />
          <p className="nx-session-hint">Other Claude Code sessions reach this one by this name.</p>
        </section>

        {session?.account?.remoteAvailable !== false ? (
          <section className="nx-session-sec">
            <h3 className="nx-session-title">
              <span id={remoteLabel}>Remote control</span>
              <Switch
                className="ml-auto"
                checked={Boolean(remote?.enabled)}
                aria-labelledby={remoteLabel}
                data-testid="session-remote"
                onChange={(on) => void change({ remote: on })}
              />
            </h3>
            {remote?.enabled ? (
              <>
                <p className="nx-session-hint" data-testid="session-remote-state">
                  {remote.state === "connected"
                    ? "Connected while this project is open."
                    : remote.state === "failed"
                      ? "The CLI did not open remote control. Turn it off and on to try again."
                      : "Connecting to claude.ai."}{" "}
                  {remote.state === "connected" && remote.url ? (
                    <ExternalLink href={remote.url}>Open it on claude.ai</ExternalLink>
                  ) : null}
                </p>
                <p className="nx-session-hint mt-1">
                  A turn sent this way follows the project's mode with no cards: what the mode would ask about is refused. Kept on this computer.
                </p>
              </>
            ) : (
              <p className="nx-session-hint">
                Off. On, this project's agent can be reached from claude.ai/code, the Claude app and your other Claude Code sessions while the project is open here.
              </p>
            )}
          </section>
        ) : null}

        <section className="nx-session-sec">
          <h3 className="nx-session-title">
            Context
            {context?.totalTokens != null && context?.maxTokens ? (
              <span className="t-micro ml-auto text-ink-3" data-testid="session-context-tokens">
                {tokens(context.totalTokens)} of {tokens(context.maxTokens)}
              </span>
            ) : null}
          </h3>
          <Meter
            size="lg"
            className="my-2"
            label="How full the conversation is"
            value={(context?.percentage ?? 0) / 100}
            mark={compactAt / 100}
            warnAt={0.5}
            testid="session-context-meter"
          />
          <div className="nx-session-line">
            <span>Summarize at</span>
            <Stepper
              what="point"
              verbs={["Earlier", "Later"]}
              value={compactAt}
              steps={COMPACT_STEPS}
              display={`${compactAt}%`}
              testid="session-compact"
              onChange={async (percent) => {
                try {
                  const answer = await api.setCompactPercent(percent);
                  const current = get().session;
                  if (current) set({ session: { ...current, compactPercent: answer.compactPercent } });
                } catch (error: any) {
                  setFailed(error.message);
                }
              }}
            />
          </div>
          <p className="nx-session-hint">
            The mark on the meter. The conversation says when it happens. The same setting as This install's row in Settings.
          </p>
        </section>

        {subscription ? (
          <section className="nx-session-sec" data-testid="session-limits">
            <h3 className="nx-session-title">Plan limits</h3>
            {session?.limits?.length ? (
              session.limits.map((entry) => (
                <div
                  key={entry.type}
                  className="nx-session-limit"
                  data-warn={entry.status === "allowed_warning" || entry.status === "rejected" ? "" : undefined}
                >
                  <span>{limitName(entry.type)}</span>
                  <Meter
                    label={limitName(entry.type)}
                    value={entry.utilization ?? 0}
                    warnAt={entry.status === "allowed" ? 2 : 0}
                    className="nx-session-limit-meter"
                  />
                  <small>
                    {entry.utilization !== null ? `${Math.round(entry.utilization * 100)}% used` : "In use"}
                    {resetWords(entry.resetsAt) ? `, ${resetWords(entry.resetsAt)}` : ""}
                    {entry.status === "allowed_warning" ? "; close to the limit" : ""}
                    {entry.status === "rejected" ? "; reached, so turns wait until it resets" : ""}
                  </small>
                </div>
              ))
            ) : (
              <p className="nx-session-hint">The CLI reports these once a turn has run.</p>
            )}
          </section>
        ) : null}

        {totals ? (
          <section className="nx-session-sec">
            <h3 className="nx-session-title">This project</h3>
            <p className="nx-session-usage" data-testid="session-usage">
              <b>{totals.turns}</b> {totals.turns === 1 ? "turn" : "turns"}, <b>{duration(totals.durationMs)}</b> of model time,{" "}
              <b>{tokens(totals.outputTokens)}</b> tokens written and <b>{tokens(totals.cacheReadTokens)}</b> read back from the cache
              {!subscription && totals.costUsd ? (
                <>
                  , <b>${totals.costUsd.toFixed(totals.costUsd < 1 ? 3 : 2)}</b>
                </>
              ) : null}
              .
            </p>
          </section>
        ) : null}

        <section className="nx-session-sec" data-testid="session-pages">
          <h3 className="nx-session-title">Pages</h3>
          {pages === null ? null : pages.length ? (
            pages.map((page) => (
              <Row
                key={page.name}
                className="nx-session-page"
                leading={<PageIcon size={14} />}
                data-testid="session-page"
                trailing={
                  <>
                    <Button variant="quiet" size="inline" onClick={() => projectId && window.open(api.pageUrl(projectId, page.name), "_blank", "noopener,noreferrer")}>
                      Open
                    </Button>
                    <Button variant="quiet" size="inline" onClick={() => projectId && copy(new URL(api.pageUrl(projectId, page.name), window.location.href).href, page.name)}>
                      {copied === page.name ? "Copied" : "Copy link"}
                    </Button>
                    <Button
                      variant="danger"
                      size="inline"
                      data-testid="session-page-delete"
                      onClick={async () => {
                        if (!projectId) return;
                        await api.deletePage(projectId, page.name).catch(() => undefined);
                        setPages((was) => (was ?? []).filter((entry) => entry.name !== page.name));
                      }}
                    >
                      Delete
                    </Button>
                  </>
                }
              >
                <span className="t-code-sm">{page.name}</span>
              </Row>
            ))
          ) : (
            <p className="nx-session-hint">Nothing published yet. Ask Claude for a page and it appears here, behind this install's sign-in.</p>
          )}
        </section>

        {session?.id ? (
          <section className="nx-session-sec">
            <h3 className="nx-session-title">Session</h3>
            <Field
              className="nx-field-mono"
            frameClassName="nx-session-field"
              readOnly
              aria-label="The session's id"
              data-testid="session-id"
              value={session.id}
              trailing={
                <Button variant="quiet" size="inline" onClick={() => copy(session.id ?? "", "id")}>
                  {copied === "id" ? "Copied" : "Copy"}
                </Button>
              }
            />
            <p className="nx-session-hint">
              To carry it on in a terminal, run the command in the project's folder, with the project closed here so the two do not answer at once.
            </p>
            <Button
              variant="ghost"
              size="inline"
              className="mt-2"
              data-testid="session-resume"
              onClick={() => copy(`claude --resume ${session.id}`, "resume")}
            >
              {copied === "resume" ? "Copied" : "Copy claude --resume"}
            </Button>
          </section>
        ) : null}

        {failed ? <p className="nx-session-sec text-compact text-error">{failed}</p> : null}
      </div>
    </div>
  );
}
