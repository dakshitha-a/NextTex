import { useEffect, useRef, useState, type MouseEvent as ReactMouseEvent } from "react";
import api, { type Archive } from "../api";
import { chatFromTranscript, useStore, type ChatItem } from "../store";
import Prose from "./prose";
import { decisionWords } from "./Chat";
import { agentName, usageNote } from "../agent-name";
import { ColumnHeader } from "./column-header";
import { Button, IconButton } from "../ui/Button";
import { Field, Pressable } from "../ui/controls";
import { Menu, MenuDivider, MenuItem } from "../ui/Menu";
import { MoreIcon } from "../ui/icons";
import { atPointer, claimsRightClick, under, type Wanted } from "../place-menu";

type Usage = Awaited<ReturnType<typeof api.usage>>;

/** The kit menu's width, which the More button's menu hangs from. */
const MENU_WIDTH = 232;

/** A token count a person reads: 120k rather than 120000. */
function compact(value: number): string {
  if (value < 1000) return String(value);
  if (value < 10_000) return `${(value / 1000).toFixed(1)}k`;
  if (value < 1_000_000) return `${Math.round(value / 1000)}k`;
  return `${(value / 1_000_000).toFixed(1)}M`;
}

/** The conversations "New conversation" filed away, and one of them open.
 *
 *  A past conversation is drawn with its own renderers rather than the
 *  live panel's. That is not a shortcut: an edit chip in the live panel
 *  has an Undo that writes to a file, and a permission card has Allow and
 *  Deny that answer an id the agent is waiting on. A conversation from
 *  last week has neither an agent waiting nor a file in the state it was,
 *  so every control on it would be a promise the app cannot keep. What is
 *  shown is what was said and what was done, as a record.
 *
 *  What it does offer is the conversation as a whole: Continue makes it
 *  the live one again, its memory with it where the session still exists,
 *  and Rename and Delete look after the list. Each row has them under its
 *  More button and at a right-click; an open one has Continue at its foot.
 *
 *  It never touches the store's `chat` itself: Continue goes through the
 *  server, which tells every tab to draw the conversation it now holds.
 */
export default function PastConversation({
  onBack,
  onFold,
  usage,
  provider,
}: {
  onBack: () => void;
  onFold?: () => void;
  /** What the project has cost, for the sentence at the list's foot: the
   *  one place it is read, since a cleared conversation does not clear it. */
  usage: Usage | null;
  provider?: string;
}) {
  const projectId = useStore((s) => s.projectId);
  const session = useStore((s) => s.session);
  const busy = useStore((s) => s.thinking);
  const [archives, setArchives] = useState<Archive[] | null>(null);
  const [failed, setFailed] = useState("");
  const [open, setOpen] = useState<{ name: string; items: ChatItem[] } | null>(null);
  /** The row whose menu is open, and where it hangs. */
  const [menu, setMenu] = useState<{ name: string; at: Wanted | null } | null>(null);
  const [confirming, setConfirming] = useState(false);
  /** The archive being renamed, and the name as typed so far. */
  const [renaming, setRenaming] = useState<{ name: string; text: string } | null>(null);
  const [continuing, setContinuing] = useState(false);
  const moreButton = useRef<HTMLButtonElement | null>(null);

  const refresh = async () => {
    if (!projectId) return;
    try {
      setArchives((await api.archives(projectId)).archives);
    } catch (error: any) {
      setFailed(error.message);
    }
  };

  useEffect(() => {
    if (!projectId) return;
    let cancelled = false;
    api
      .archives(projectId)
      .then((answer) => !cancelled && setArchives(answer.archives))
      .catch((error: any) => !cancelled && setFailed(error.message));
    return () => {
      cancelled = true;
    };
  }, [projectId]);

  const entryOf = (name: string) => archives?.find((entry) => entry.name === name);

  const read = async (entry: Archive) => {
    if (!projectId) return;
    try {
      const answer = await api.archive(projectId, entry.name);
      setOpen({ name: entry.name, items: chatFromTranscript(answer.items) });
    } catch (error: any) {
      setFailed(error.message);
    }
  };

  const closeMenu = () => {
    setMenu(null);
    setConfirming(false);
  };

  const proceed = async (name: string) => {
    if (!projectId || busy) return;
    closeMenu();
    setContinuing(true);
    setFailed("");
    try {
      await api.continueArchive(projectId, name);
      // The server tells every tab, this one too, to draw the conversation
      // it now holds; what is left here is to go back to it.
      onBack();
    } catch (error: any) {
      setFailed(error.message);
      setContinuing(false);
    }
  };

  const remove = async (name: string) => {
    if (!projectId) return;
    closeMenu();
    try {
      await api.deleteArchive(projectId, name);
      if (open?.name === name) setOpen(null);
      await refresh();
    } catch (error: any) {
      setFailed(error.message);
    }
  };

  const saveName = async () => {
    if (!projectId || !renaming) return;
    const { name, text } = renaming;
    setRenaming(null);
    if (text.trim() === (entryOf(name)?.conversation ?? "")) return;
    try {
      await api.renameArchive(projectId, name, text);
      await refresh();
    } catch (error: any) {
      setFailed(error.message);
    }
  };

  const startRename = (name: string) => {
    closeMenu();
    setRenaming({ name, text: entryOf(name)?.conversation ?? "" });
  };

  const openMenu = (name: string, at: Wanted | null) => {
    setConfirming(false);
    setMenu(menu?.name === name ? null : { name, at });
  };

  /** The four things to do with a conversation, under its More button or
   *  at a right-click; the open one leaves out Open. */
  const actions = (name: string, inside: boolean) => (
    <Menu
      open
      wanted={menu?.at ?? null}
      anchor={moreButton}
      label="Past conversation"
      testid="past-menu"
      width={MENU_WIDTH}
      revision={confirming}
      onClose={closeMenu}
    >
      {confirming ? (
        <div className="nx-past-confirm" data-testid="past-delete-confirm">
          <p className="text-ink">Delete NextTex's record of this conversation?</p>
          <p className="t-meta text-ink-3">Claude Code keeps its own copy until it clears it.</p>
          <div className="nx-past-confirm-actions">
            <Button variant="danger" data-testid="past-delete-yes" onClick={() => void remove(name)}>
              Delete
            </Button>
            <Button onClick={() => setConfirming(false)}>Cancel</Button>
          </div>
        </div>
      ) : (
        <>
          {inside ? null : (
            <MenuItem
              onClick={() => {
                closeMenu();
                const entry = entryOf(name);
                if (entry) void read(entry);
              }}
            >
              Open
            </MenuItem>
          )}
          {/* Present only when it can act: a menu leaves out what does
              not apply rather than disabling it in place. */}
          {busy ? null : (
            <MenuItem onClick={() => void proceed(name)}>Continue this conversation</MenuItem>
          )}
          <MenuItem onClick={() => startRename(name)}>Rename</MenuItem>
          <MenuDivider />
          <MenuItem danger onClick={() => setConfirming(true)}>
            Delete
          </MenuItem>
        </>
      )}
    </Menu>
  );

  const nameField = (variant: "row" | "head") =>
    renaming ? (
      <Field
        autoFocus
        frameClassName={variant === "row" ? "nx-past-name-field" : "nx-past-head-field"}
        aria-label="The conversation's name"
        data-testid="past-rename"
        value={renaming.text}
        maxLength={80}
        onFocus={(event) => event.currentTarget.select()}
        onChange={(event) => setRenaming({ ...renaming, text: event.target.value })}
        onBlur={() => void saveName()}
        onKeyDown={(event) => {
          if (event.key === "Enter") (event.target as HTMLInputElement).blur();
          if (event.key === "Escape") {
            event.stopPropagation();
            setRenaming(null);
          }
        }}
      />
    ) : null;

  const openEntry = open ? entryOf(open.name) : undefined;
  const openTitle = open ? openEntry?.conversation || openEntry?.stamp || open.name : "Past conversations";

  return (
    <div className="flex h-full min-h-0 flex-col" data-testid="past-conversations">
      <ColumnHeader
        title={open && renaming?.name === open.name ? "" : openTitle}
        onBack={() => (open ? setOpen(null) : onBack())}
        backLabel={open ? "All past conversations" : "Back"}
        backTestid="past-back"
        onFold={onFold}
      >
        {open && renaming?.name === open.name ? nameField("head") : <span className="min-w-0 flex-1" />}
        {open ? (
          <IconButton
            ref={moreButton}
            label="More for this conversation"
            data-testid="past-open-more"
            on={menu?.name === open.name}
            aria-expanded={menu?.name === open.name}
            onClick={(event) => openMenu(open.name, under(event.currentTarget, MENU_WIDTH, "right"))}
          >
            <MoreIcon />
          </IconButton>
        ) : null}
      </ColumnHeader>
      {open && menu?.name === open.name ? actions(open.name, true) : null}
      <div className="flex min-h-0 flex-1 flex-col overflow-auto px-2 pb-2">
        {failed ? <p className="t-meta text-error">{failed}</p> : null}
        {!open && archives === null && !failed ? (
          <p className="t-meta text-ink-3">Reading</p>
        ) : null}
        {!open && archives && archives.length === 0 ? (
          <p className="t-meta text-ink-3">
            Nothing filed away yet. Starting a new conversation keeps the old
            one here.
          </p>
        ) : null}
        {!open && archives && archives.length ? (
          <div className="flex flex-col">
            {archives.map((entry) =>
              renaming?.name === entry.name ? (
                <div key={entry.name} className="nx-past-row nx-past-renaming">
                  {nameField("row")}
                </div>
              ) : (
                <div
                  key={entry.name}
                  className="nx-past-row"
                  data-open={menu?.name === entry.name || undefined}
                  data-testid="past-conversation"
                  onContextMenu={(event: ReactMouseEvent<HTMLDivElement>) => {
                    if (!claimsRightClick(event)) return;
                    event.preventDefault();
                    const button = event.currentTarget.querySelector<HTMLButtonElement>(".nx-past-more");
                    moreButton.current = button;
                    openMenu(entry.name, atPointer(event, button, MENU_WIDTH));
                  }}
                >
                  <Pressable className="nx-past-open" onClick={() => read(entry)}>
                    <span className="nx-past-name">{entry.conversation || "A conversation with no question in it"}</span>
                    <small>{whenFiled(entry.stamp)}</small>
                  </Pressable>
                  <IconButton
                    className="nx-past-more"
                    label={`More for ${entry.conversation || "this conversation"}`}
                    data-testid="past-more"
                    on={menu?.name === entry.name}
                    aria-expanded={menu?.name === entry.name}
                    onClick={(event) => {
                      moreButton.current = event.currentTarget;
                      openMenu(entry.name, under(event.currentTarget, MENU_WIDTH, "right"));
                    }}
                  >
                    <MoreIcon />
                  </IconButton>
                  {menu?.name === entry.name ? actions(entry.name, false) : null}
                </div>
              ),
            )}
          </div>
        ) : null}
        {/* What this project has cost, once, at the foot of the list: the
            sum over every conversation, which is why it is here and not in
            any one of them. */}
        {/* With a Claude session, what the project has used is in the
            Session view, beside the plan's limits it counts against. */}
        {!open && usage && !session?.available ? (
          <p className="nx-past-usage" data-testid="usage-line">
            This project:{" "}
            <b>
              {usage.usage.costUsd
                ? `$${usage.usage.costUsd.toFixed(usage.usage.costUsd < 1 ? 3 : 2)}`
                : "$0.000"}
            </b>{" "}
            estimated, <b>{usage.usage.turns}</b> {usage.usage.turns === 1 ? "turn" : "turns"},{" "}
            <b>{duration(usage.usage.durationMs)}</b> of model time,{" "}
            <b>{compact(usage.usage.inputTokens)}</b> tokens in
            {usage.usage.cacheReadTokens ? (
              <>
                {" "}(<b>{compact(usage.usage.cacheReadTokens)}</b> from cache)
              </>
            ) : null}
            , <b>{compact(usage.usage.outputTokens)}</b> out.
            {usageNote(provider as any) ? ` ${usageNote(provider as any)}` : ""}
          </p>
        ) : null}
        {open ? (
          <div className="flex flex-col gap-3 pt-1" data-testid="past-items">
            {open.items.map((item) => (
              <Row key={item.id} item={item} />
            ))}
          </div>
        ) : null}
      </div>
      {open ? (
        <div className="nx-past-foot" data-testid="past-continue-foot">
          <Button
            variant="pen"
            size="md"
            className="w-full justify-center"
            data-testid="past-continue"
            disabled={busy || continuing}
            onClick={() => void proceed(open.name)}
          >
            Continue this conversation
          </Button>
          <p className="t-meta text-ink-3">
            {busy
              ? `${agentName(provider as any)} is answering. Continue when it finishes.`
              : "Files the current conversation away and picks this one up where it stopped."}
          </p>
        </div>
      ) : null}
    </div>
  );
}

/** One row of a past conversation, as a record rather than a control. */
function Row({ item }: { item: ChatItem }) {
  if (item.kind === "user") {
    return (
      <div className="t-prose whitespace-pre-wrap rounded-mark bg-surface-2 px-3 py-2 text-ink">
        {item.text}
      </div>
    );
  }
  if (item.kind === "claude") return <Prose text={item.text} />;
  if (item.kind === "tool") {
    return (
      <p className="t-micro text-ink-3">
        {item.summary || item.name}
        {typeof item.ms === "number" ? ` (${Math.round(item.ms / 100) / 10}s)` : ""}
      </p>
    );
  }
  if (item.kind === "edit") {
    return (
      <p className="t-micro text-ink-2">
        {item.state === "reverted" ? "Edited and then undone" : "Edited"}{" "}
        <span className="t-code-sm">{item.path}</span>{" "}
        <span className="text-ok">+{item.added}</span>{" "}
        <span className="text-error">−{item.removed}</span>
      </p>
    );
  }
  if (item.kind === "permission") {
    // The live panel's own words for a decision, so a tool that ran
    // without asking reads "Allowed automatically" here as it does there,
    // rather than falling into a refused-by-default branch.
    return (
      <p className="t-micro text-ink-2">
        {item.headline || item.tool}: {decisionWords(item.decision)}
      </p>
    );
  }
  if (item.kind === "notice") {
    return (
      <p className={`t-micro ${item.tone === "error" ? "text-error" : "text-ink-3"}`}>
        {item.text}
      </p>
    );
  }
  return null;
}

/** Model time a person reads: "2m 10s", or "45s". */
function duration(ms: number): string {
  const seconds = Math.round(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
}

/** When a conversation was filed, as the page has it: "Today, 14:20",
 *  "Yesterday, 17:48", "Tuesday 16 September" within the week, and the
 *  date past that. The server's stamp is local time, "2026-09-20 14:20:00";
 *  a stamp that does not parse is shown as it came. */
export function whenFiled(stamp: string, now = new Date()): string {
  const match = /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2})/.exec(stamp);
  if (!match) return stamp;
  const [, y, mo, d, h, mi] = match;
  const at = new Date(Number(y), Number(mo) - 1, Number(d), Number(h), Number(mi));
  const day = (date: Date) => new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
  const days = Math.round((day(now) - day(at)) / 86_400_000);
  const time = `${h}:${mi}`;
  if (days === 0) return `Today, ${time}`;
  if (days === 1) return `Yesterday, ${time}`;
  // Day before month, as the page writes it, whatever the locale.
  const date = `${at.getDate()} ${MONTHS[at.getMonth()]}`;
  if (days > 1 && days < 7) return `${WEEKDAYS[at.getDay()]} ${date}`;
  return at.getFullYear() === now.getFullYear() ? date : `${date} ${at.getFullYear()}`;
}

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
