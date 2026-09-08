import { useMemo, useRef, useEffect } from "react";
import {
  C, Contents, Figure, Keys, P, Section, useCurrentSection, type Entry,
} from "./parts";

import tabStripLight from "./shots/tab-strip-light.png";
import tabStripDark from "./shots/tab-strip-dark.png";
import composerLight from "./shots/composer-row-light.png";
import composerDark from "./shots/composer-row-dark.png";
import cardLight from "./shots/permission-card-light.png";
import cardDark from "./shots/permission-card-dark.png";
import chipLight from "./shots/edit-chip-light.png";
import chipDark from "./shots/edit-chip-dark.png";
import errorsLight from "./shots/errors-light.png";
import errorsDark from "./shots/errors-dark.png";
import gitLight from "./shots/git-card-light.png";
import gitDark from "./shots/git-card-dark.png";

const ENTRIES: Entry[] = [
  { id: "panes", label: "The four panes" },
  { id: "sync", label: "The page and the source" },
  { id: "documents", label: "More than one document" },
  { id: "folding", label: "Folding, reading, writing" },
  { id: "errors", label: "When it does not compile" },
  { id: "keys", label: "Keyboard" },
  { id: "agent", label: "The agent" },
  { id: "context", label: "Your template and your voice" },
  { id: "references", label: "References" },
  { id: "sharing", label: "Writing it with somebody" },
  { id: "safety", label: "Nothing is lost" },
];

const IDS = ENTRIES.map((entry) => entry.id);

/** The tutorial, as a sheet you can read while you try what it describes.
 *
 *  It deliberately does not dismiss on an outside press, which every other
 *  card in this app does.  A tutorial whose third section says "a single
 *  click on a pane header folds that pane away" and then closes the instant
 *  you try it is worse than no tutorial at all.  `History` is the existing
 *  surface with the same property, and this borrows its chrome so it reads
 *  as the same kind of object rather than a new one. */
export default function Tutorial({
  right,
  onClose,
}: {
  right: number;
  onClose: () => void;
}) {
  const scroller = useRef<HTMLDivElement | null>(null);
  const returnTo = useRef<HTMLElement | null>(null);
  const first = useRef<HTMLButtonElement | null>(null);
  const ids = useMemo(() => IDS, []);
  const current = useCurrentSection(scroller, ids);

  useEffect(() => {
    // The cog, which Settings focused on its way out.
    returnTo.current = document.activeElement as HTMLElement | null;
    const row = scroller.current
      ?.closest("[data-testid='tutorial']")
      ?.querySelector<HTMLElement>("[data-contents-row]");
    row?.focus();
  }, []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      // Focus is deliberately not trapped, so Escape has to leave the
      // composer and the filter boxes alone: closing the tutorial is not
      // what Escape means while you are typing into something.
      const active = document.activeElement as HTMLElement | null;
      if (active?.tagName === "TEXTAREA" || active?.tagName === "INPUT") return;
      onClose();
      returnTo.current?.focus();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const go = (id: string) => {
    scroller.current
      ?.querySelector(`[data-section="${id}"]`)
      ?.scrollIntoView({ block: "start" });
  };

  return (
    <div
      role="dialog"
      aria-labelledby="tutorial-heading"
      data-testid="tutorial"
      className="nx-arrive absolute inset-y-0 z-40 flex w-[380px] max-w-full flex-col border-l border-line bg-surface-2 shadow-float"
      style={{ right }}
    >
      <div className="flex h-[32px] shrink-0 items-center justify-between border-b border-line bg-surface-3 px-[10px]">
        <span id="tutorial-heading" className="t-ui-lg font-serif text-ink">
          Tutorial
        </span>
        <button
          ref={first}
          className="quiet flex h-[26px] w-[22px] items-center justify-center rounded-[3px] hover:bg-surface-3"
          aria-label="Close the tutorial"
          data-testid="tutorial-close"
          onClick={() => {
            onClose();
            returnTo.current?.focus();
          }}
        >
          ×
        </button>
      </div>

      <Contents entries={ENTRIES} current={current} onGo={go} />

      <div
        ref={scroller}
        tabIndex={0}
        aria-label="Tutorial"
        className="flex min-h-0 flex-1 flex-col gap-6 overflow-auto px-3 py-3"
      >
        <Section id="panes" title="The four panes">
          <P>
            The file list is on the left, your source in the middle, the
            typeset page beside it, and the agent on the right. Every one of
            them folds away, and the app remembers which.
          </P>
          <P>
            There is no save button. What you type is written about a quarter
            of a second after you stop, and the page rebuilds about a second
            after that — only the section you are in, which is why it is
            quick. The strip along the bottom says how long the last build
            took and whether the page is behind the source.
          </P>
          <P>
            <C>⌘S</C> does not save, because saving already happened. It
            skips the wait and builds now.
          </P>
        </Section>

        <Section id="sync" title="The page and the source are the same thing">
          <P>
            Double-click anything on the typeset page and the editor jumps to
            the line that produced it. That is the fastest way to find the
            sentence you are looking at, and it works in a table, a caption
            or an equation.
          </P>
          <P>
            <C>⌘↵</C> goes the other way: it scrolls the page to whatever line
            your caret is on.
          </P>
          <P>
            The text on the page can be selected and copied, so a quotation
            or a number can come straight out of the typeset document rather
            than being retyped from the source.
          </P>
        </Section>

        <Section id="documents" title="More than one document">
          <P>
            A project is often more than one document. A paper and its
            supplementary information live in the same folder and neither
            includes the other, so both need building and both need a page
            to look at.
          </P>
          <P>
            Any <C>.tex</C> file with its own <C>\documentclass</C> can be
            previewed alongside the main one. NextTex finds them for you:
            the <C>+</C> on the preview tabs lists them, and each file's
            <C>⋯</C> menu offers the same thing. A file that is
            <C>\include</C>d by something else is not offered, because its
            preview is the document that includes it.
          </P>
          <P>
            Each document builds on its own and keeps its own page, its own
            errors and its own place in the scroll. Saving a chapter rebuilds
            the document that includes it and leaves the others alone, so a
            second preview costs nothing until something it reads changes.
          </P>
          <P>
            The tabs and the source follow each other. Opening a document
            brings its page forward; clicking a tab opens its source.{" "}
            <C>⌘⌥P</C> moves between them.
          </P>
        </Section>

        <Section id="folding" title="Folding, reading and writing">
          <P>
            A single click on a pane's header folds that pane away, leaving a
            narrow strip that says where it went. Click the strip to bring it
            back.
          </P>
          <P>
            A double-click on the preview header gives the page the whole
            window — reading mode. A second double-click puts your layout back
            exactly as it was, including anything you had already folded.
          </P>
          <P>
            The editor has the same pair of gestures, but the target is the
            empty run of the tab strip to the right of your open files, not a
            tab. Writing mode keeps the file list open, because somebody
            writing is still moving between chapters.
          </P>
          <Figure
            light={tabStripLight}
            dark={tabStripDark}
            width={712}
            height={34}
            eager
            alt="The editor tab strip with two files open and empty space to the right of them."
            caption="The empty run to the right of the last tab. Double-click there."
          />
          <P>
            In the file list, the <C>Files</C> and <C>Sections</C> headers
            fold too. <C>⌘B</C> hides the whole left column.
          </P>
          <P>
            Below 900 pixels of width the source and the page share one view
            and take turns, so neither gesture exists there.
          </P>
        </Section>

        <Section id="errors" title="When it does not compile">
          <P>
            A bar appears in the margin next to the line LaTeX complained
            about, and the status strip counts the errors. The list itself
            stays shut until you ask for it — a drawer that opens itself
            while you are typing takes the page you were reading away.
          </P>
          <P>
            Click the count to open it. The strip along the top explains the
            first error in plain English and names the one to start from.
            Start there: LaTeX reports the consequences of a mistake as well
            as the mistake, so the last error is usually the least useful.
          </P>
          <Figure
            light={errorsLight}
            dark={errorsDark}
            width={968}
            height={498}
            alt="The error list, with an explanation of the first error above it."
            caption="Start here names the error to begin with, and what to try."
          />
          <P>
            No model is involved in any of that. The explanations are the
            app's own reading of the log.
          </P>
        </Section>

        <Section id="keys" title="Keyboard">
          <Keys
            rows={[
              ["⌘S", "Save now rather than waiting for the pause"],
              ["⌘B", "Hide the file list"],
              ["⌘⌥A", "Show or hide the agent, ready to type"],
              ["⌘⌥P", "Move between the previewed documents"],
              ["⌘↵", "Scroll the page to the line you are on"],
              ["Ctrl-F", "Find and replace"],
              ["Typing", "In the file list, jumps to a file"],
              ["F2, Delete", "In the file list, rename and move to trash"],
              ["A, ⇧A, D", "In a permission card: allow, allow always, deny"],
              ["Esc", "Closes whatever you opened, the agent panel last"],
            ]}
          />
        </Section>

        <Section id="agent" title="The agent">
          <P>
            It edits the files in this project directly. Each edit arrives in
            the panel as a chip you can open to see the diff, and undo without
            touching the editor.
          </P>
          <Figure
            light={chipLight}
            dark={chipDark}
            width={712}
            height={260}
            alt="An edit chip in the agent panel, opened to show a unified diff."
            caption="Open the chip for the diff. Undo puts the file back."
          />
          <P>
            Anything else asks first: a shell command, or a write to a file
            outside this project. The buttons ignore clicks for a third of a
            second, so a card that appears under a moving cursor cannot be
            approved on the way past.
          </P>
          <Figure
            light={cardLight}
            dark={cardDark}
            width={712}
            height={300}
            alt="A permission card showing a shell command and three buttons."
            caption="Allow always remembers a scope, not the button. For a command that is its first word; for a file it is that file."
          />
          <P>
            Turning on <C>Approve everything automatically</C> stops the cards.
            What it does not stop is the record: every action still appears in
            the conversation saying it was approved automatically, and a write
            outside the project still asks either way.
          </P>
          <P>
            The buttons under the box are, left to right: start a new
            conversation, choose the model, approve everything automatically,
            and add a template or a writing sample. None of them is labelled,
            so hover for a name.
          </P>
          <Figure
            light={composerLight}
            dark={composerDark}
            width={712}
            height={34}
            alt="The row of small buttons beneath the agent's message box."
            caption="Under the box, beside Send."
          />
          <P>
            Starting a new conversation clears the panel and the model's
            memory of the chat, but keeps what it has been told to remember
            about the project, and keeps the tally of what this project has
            cost. The old conversation is filed away on disk rather than
            deleted.
          </P>
          <P>
            <C>⌘⌥A</C> shows and hides the panel and leaves the caret in the
            box.
          </P>
          <P>
            Which agent answers is under <C>Agent</C> in the cog: Claude,
            an OpenAI key, or nobody at all. Working on your own removes the
            chat column rather than greying it out, and everything else in
            the app is unchanged. Changing it closes whatever conversations
            are open, because each one belongs to the agent that was
            answering.
          </P>
        </Section>

        <Section id="context" title="Teaching it your template and your voice">
          <P>
            The last button under the box takes a document you have to follow
            — a department handbook, a journal's author instructions, a class
            file — and a piece of writing that sounds like you, usually a
            paper you have already published.
          </P>
          <P>
            It reads each one once and keeps a distilled summary rather than
            the whole document, so the rules travel with every question
            without costing the length of a handbook each time. You can read
            and correct what it kept in the panel that says what it reads.
          </P>
          <P>
            The same panel holds what it has been told to remember. Ask it to
            remember something about the project and the note survives a new
            conversation. It is a plain file, and you can edit it by hand.
          </P>
        </Section>

        <Section id="references" title="References it cannot invent">
          <P>
            Ask for a citation and it searches real catalogues, then fetches
            the entry from the publisher's own record by DOI. It never
            composes a BibTeX entry from memory, which is the failure that
            matters most in a bibliography.
          </P>
          <P>
            It can also check a bibliography you already have, entry by entry
            against those records, and fill one from a folder of PDFs — each
            checked against the paper it came from, so a wrong DOI is refused
            rather than added.
          </P>
        </Section>

        <Section id="sharing" title="Writing it with somebody else">
          <P>
            <strong>Share</strong>, beside the project's name, gives you an invite to
            send. Whoever opens it gets the whole project — every file, and
            what those files used to say — into an empty folder of their own,
            and from then on the two copies stay in step.
          </P>
          <P>
            Both of you keep a whole copy: your own files, your own version
            history, your own git repository. If their laptop is shut, or
            yours is, you both carry on writing; when you are back, the two
            sets of edits are merged rather than one of them being refused.
            That is as true of an afternoon apart as of a second.
          </P>
          <P>
            Their caret sits in your margin in their own colour and says
            their name for a moment whenever it moves, and a strip at the end
            of the tabs shows who else is here — filled in while they are
            typing, outlined while they are only there. Their name is on the
            versions they wrote, so a month later the history says who
            changed the paragraph.
          </P>
          <P>
            An invite is a credential: whoever opens it joins. It works once
            and expires after a week, so send it the way you would send a
            password. There are no accounts and nothing in the middle — a
            collaborator is a public key, and the two installs talk directly,
            encrypted end to end.
          </P>
          <P>
            Nobody owns a shared project. Anyone in it can invite somebody
            else, and anyone can disconnect anybody — but disconnecting
            somebody does not take back the copy they already have. It stops
            the two of you syncing. It cannot unsend a paper.
          </P>
          <P>
            Two things that are true and might not be obvious. Each of you
            keeps your own <C>.git</C>, so pull between sessions rather than
            during one: a pull replaces a whole file and will win against a
            collaborator's untouched paragraphs. And your conversation with
            the agent is yours — the writing is shared, the chat is not.
          </P>
        </Section>

        <Section id="safety" title="Nothing is lost">
          <P>
            Every pause is a version. Open a file's history from the menu on
            its row in the file list, read any earlier version, and put it
            back if you want it. A version you are reading cannot be typed
            into. Give one a name and it is kept for good.
          </P>
          <P>
            Deleted files go to a trash that never empties itself, and a
            deleted folder comes back whole.
          </P>
          <P>
            The git panel at the foot of the file list offers a repository to
            a project that has none, and then does the four things a paper
            needs: see what changed, commit, push, pull. Branching stays in a
            terminal, where the tools are better and mistakes are
            recoverable.
          </P>
          <Figure
            light={gitLight}
            dark={gitDark}
            width={712}
            height={110}
            alt="A card in the file list footer offering to back the project up to GitHub."
            caption="Offered once. Dismiss it and the panel's four buttons are still there."
          />
          <P>
            Everything NextTex adds lives in <C>.nexttex/</C> beside your
            files. Delete that folder and you have exactly the LaTeX project
            you started with.
          </P>
          <p className="t-micro text-ink-3">
            Installing, choosing an agent and a longer walkthrough are in the
            project's README and <C>docs/first-session.md</C>.
          </p>
        </Section>
      </div>
    </div>
  );
}
