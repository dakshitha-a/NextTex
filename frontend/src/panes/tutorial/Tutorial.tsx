import { useMemo, useRef, useEffect } from "react";
import { CHORDED } from "../../actions";
import { IconButton } from "../../ui/Button";
import { Heading } from "../../ui/controls";
import { CloseIcon } from "../../ui/icons";
import {
  C, Contents, Figure, Key, Keys, Lead, P, Section, useCurrentSection, type Entry,
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
  { id: "errors", label: "Errors and spelling" },
  { id: "agent", label: "The agent" },
  { id: "context", label: "Your template and your voice" },
  { id: "references", label: "References" },
  { id: "sharing", label: "Writing it with somebody" },
  { id: "safety", label: "Nothing is lost" },
  { id: "keys", label: "Keyboard" },
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
      // A sheet open over the tutorial owns that Escape; the tutorial takes
      // the next one.
      if (document.querySelector('[role="dialog"][aria-modal="true"]')) return;
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
      className="nx-arrive nx-tutorial absolute inset-y-0 z-40 flex w-[380px] max-w-full flex-col"
      style={{ right }}
    >
      {/* The drawn panel: on the second surface with the float shadow and
          no border, a header row like the Claude column's, the contents as
          rows, and the prose below. */}
      <div className="nx-tutorial-head">
        <Heading level={2} id="tutorial-heading">Tutorial</Heading>
        <IconButton
          ref={first}
          label="Close the tutorial"
          data-testid="tutorial-close"
          onClick={() => {
            onClose();
            returnTo.current?.focus();
          }}
        >
          <CloseIcon />
        </IconButton>
      </div>

      <Contents entries={ENTRIES} current={current} onGo={go} />

      <div
        ref={scroller}
        tabIndex={0}
        aria-label="Tutorial"
        className="nx-tutorial-body flex min-h-0 flex-1 flex-col gap-6 overflow-auto"
      >
        <Section id="panes" n={1} title="The four panes">
          <Lead>
            The bar and its drawer are on the left, your source in the
            middle, the typeset page beside it, and the agent on the right.
            Every one of them folds away, and the app remembers which.
          </Lead>
          <P>
            There is no save button. What you type is written as you type
            it, and with <C>Compile as you type</C> on, which it is to begin
            with, the page rebuilds about a second after you pause, and only
            the section you are in, which is why it is quick. Every column
            ends in a strip: the source&rsquo;s says how long the last build
            took and whether the page is behind the source, the page&rsquo;s
            holds the page number and the zoom, the drawer&rsquo;s is where
            to report a problem, and the agent&rsquo;s says what the
            conversations have cost.
          </P>
          <P>
            <Key spec="Mod-S" /> does not save, because saving already
            happened. It skips the wait and builds now. With{" "}
            <C>Compile as you type</C> off, in Settings under{" "}
            <C>This project</C>, nothing builds until you press it or{" "}
            <C>Compile</C> in the strip.
          </P>
        </Section>

        <Section id="sync" n={2} title="The page and the source are the same thing">
          <Lead>
            Double-click anything on the typeset page and the editor jumps to
            the line that produced it. That is the fastest way to find the
            sentence you are looking at, and it works in a table, a caption
            or an equation.
          </Lead>
          <P>
            <Key spec="Mod-Enter" /> goes the other way: it scrolls the page
            to whatever line your caret is on.
          </P>
          <P>
            The text on the page can be selected and copied, so a quotation
            or a number can come straight out of the typeset document rather
            than being retyped from the source, and <Key spec="Mod-F" /> with
            the page in front finds on the page rather than in the source.
          </P>
        </Section>

        <Section id="documents" n={3} title="More than one document">
          <Lead>
            A project is often more than one document. A paper and its
            supplementary information live in the same folder and neither
            includes the other, so both need building and both need a page
            to look at.
          </Lead>
          <P>
            There is no main document. Any <C>.tex</C> file with its own{" "}
            <C>\documentclass</C> that nothing else reads is a document, and
            the page follows whatever you are writing: open a document and it
            comes to the front, open a chapter and the document that{" "}
            <C>\include</C>s it does, however many files deep. The{" "}
            <C>+</C> at the end of the preview tabs, <C>Preview another
            document</C>, lists the documents not yet on the strip, and each
            file's <C>⋯</C> menu offers the same thing, along with its PDF.
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
            <Key spec="Mod-Alt-P" /> moves between them.
          </P>
          <P>
            A Python script in the project opens in the source pane like a
            chapter. <C>Run</C> at the end of its tab strip runs it, and{" "}
            <Key spec="Mod-Enter" /> does the same on a script rather than
            scrolling the page; it reads <C>Stop</C> while the run is going.
            What the script prints, and the figure it would have shown, is a
            tab on the preview strip beside the documents.
          </P>
        </Section>

        <Section id="folding" n={4} title="Folding, reading and writing">
          <Lead>
            A single click on the tab in front, on either pane, folds that
            pane away, leaving a narrow strip that says where it went. Click
            the strip to bring it back. The empty run to the right of the
            tabs does the same, when there is one.
          </Lead>
          <P>
            A double-click on the preview's tab in front gives the page the
            whole window, which is reading mode. A second double-click puts
            your layout back exactly as it was, including anything you had
            already folded.
          </P>
          <P>
            The editor has the same pair of gestures on its own tab in front.
            Writing mode keeps the drawer open, because somebody writing is
            still moving between chapters. Any other tab is only selected
            by a click, and a double-click on one selects it and folds
            nothing.
          </P>
          <P>
            Both modes have a key as well: <Key spec="Mod-Alt-R" /> for
            reading and <Key spec="Mod-Alt-E" /> for writing, and the same
            key again puts your layout back.
          </P>
          <Figure
            light={tabStripLight}
            dark={tabStripDark}
            width={856}
            height={68}
            eager
            alt="The editor tab strip with two files open and empty space to the right of them."
            caption="The empty run to the right of the last tab. Double-click there."
          />
          <P>
            The bar at the far left has eleven buttons, <C>Files</C>,{" "}
            <C>Sections</C>, <C>Search</C>, <C>Papers</C>, <C>History</C>,{" "}
            <C>Git</C>, <C>People</C>, <C>Build</C>, <C>Before you submit</C>,{" "}
            <C>Download</C> and <C>Deleted</C>, and one drawer beside it
            shows whichever you chose, at full height. A second press on the
            button that is lit folds the drawer away, and{" "}
            <Key spec="Mod-B" /> hides the whole column. The Settings button
            sits at the foot of the bar, and the project&rsquo;s name heads
            the column.
          </P>
          <P>
            Four things render on hover in the source: rest the pointer on a
            formula and it appears typeset, on a table and it appears drawn,
            on an <C>\includegraphics</C> and the figure appears with its
            size, and on a <C>\ref</C> and the figure, table or equation it
            points at appears under what the reference says. The Files
            drawer does the same beside a row for an image or a PDF.
          </P>
          <P>
            Below 900 pixels of width the source and the page share one view
            and take turns, so neither gesture exists there.
          </P>
        </Section>

        <Section id="errors" n={5} title="When it does not compile, and when it is misspelt">
          <Lead>
            A bar appears in the margin next to the line LaTeX complained
            about, and the status strip counts the errors. The list itself,
            the <C>Build</C> drawer on the bar, stays shut until you ask for
            it, because a drawer that opens itself while you are typing
            takes the page you were reading away.
          </Lead>
          <P>
            Click the count to open it, or press <C>F8</C>, which steps to the
            next error from anywhere and opens the drawer on the way;{" "}
            <Key spec="Shift-F8" /> steps back. The card at the top explains
            the first error in plain English and names the one to start
            from. Start there: LaTeX reports the consequences of a mistake
            as well as the mistake, so the last error is usually the least
            useful. The drawer has Rebuild at its foot, and double-clicking
            its button on the bar rebuilds too.
          </P>
          <Figure
            light={errorsLight}
            dark={errorsDark}
            width={240}
            height={330}
            alt="The Build drawer: the build's state, Start here explaining the first error, and the rows under it."
            caption="Start here names the error to begin with, and what to try."
          />
          <P>
            No model is involved in any of that. The explanations are the
            app's own reading of the log.
          </P>
          <P>
            Spelling is checked in the source when <C>Spelling</C> is on,
            in Settings under <C>While you write</C>, in the language your
            document declares. A word it does not know is underlined;
            right-click it, or press <Key spec="Mod-." /> with the caret on
            it, to add it to the project's dictionary, which travels with the
            project and with anybody you share it with.
          </P>
        </Section>

        <Section id="agent" n={6} title="The agent">
          <Lead>
            It edits the files in this project directly. Each edit arrives in
            the panel as a chip you can open to see the diff, and undo without
            touching the editor.
          </Lead>
          <Figure
            light={chipLight}
            dark={chipDark}
            width={744}
            height={316}
            alt="An edit chip in the agent panel, opened to show a unified diff."
            caption="Open the chip for the diff. Undo puts the file back."
          />
          <P>
            Select a sentence or a paragraph in the source and a row of verbs
            appears over it: <C>Reword</C>, <C>Shorten</C>, <C>Expand</C>,{" "}
            <C>Ask</C>. Each one writes the question into the box with the
            selection attached and leaves you to finish the sentence and
            press Send, because the second half of the instruction is usually
            the part that matters: reword this, and keep the citation.
          </P>
          <P>
            Anything else asks first: a shell command, or a write to a file
            outside this project. The buttons ignore clicks for a third of a
            second, so a card that appears under a moving cursor cannot be
            approved on the way past.
          </P>
          <Figure
            light={cardLight}
            dark={cardDark}
            width={744}
            height={428}
            alt="A permission card showing a shell command and four buttons."
            caption="Allow always remembers a scope, not the button: a command by its first word, or by its exact text when it has pipes or redirects; a file by that file. For this conversation forgets it when the conversation ends."
          />
          <P>
            The chip under the box names the model and what it asks about,
            and opens a menu with both. What to ask about has three
            positions. <C>Ask before acting</C> is the cards above. <C>Run the work
            without asking</C> lets commands and edits inside the project run
            silently and still asks about a write outside it or anything that
            reaches the internet. <C>Never ask about anything</C> stops the
            cards altogether. None of them stops the record: every action
            still appears in the conversation, saying it ran without asking.
          </P>
          <P>
            Under the box there are three controls and the send glyph: new
            conversation, attach an image, and the chip. The column's header
            holds the rest, past conversations and what the agent reads, as
            icon buttons that say their names on hover; while a turn runs the
            header shows what the agent is doing, and <C>Stop</C>. Runs of
            tool calls fold into one line you can open.
          </P>
          <Figure
            light={composerLight}
            dark={composerDark}
            width={736}
            height={224}
            alt="The composer: the box, the attach button, the chip naming the model and what it asks about, and the send glyph."
            caption="Under the box: attach an image, the chip, and the send glyph. Enter sends; Shift-Enter breaks a line."
          />
          <P>
            Starting a new conversation clears the panel and the model's
            memory of the chat, but keeps what it has been told to remember
            about the project, and keeps the tally of what this project has
            cost. The old conversation is filed away rather than deleted, and
            past conversations reopens any of them.
          </P>
          <P>
            <Key spec="Mod-Alt-A" /> shows and hides the panel and leaves the
            caret in the box. <C>Esc</C> in the panel stops a turn that is
            running, and closes the panel when nothing is.
          </P>
          <P>
            Which agent answers is one sheet, <C>What writes with you</C>:
            Claude, ChatGPT or a model on this machine, or no agent at all.
            The name at the top of this column opens it, so does the{" "}
            <C>Writing agent</C> row in Settings, and so does the control on
            the projects screen's bar. Working on your own removes the chat
            column rather than greying it out, and everything else in the app
            is unchanged. Changing it closes whatever conversations are open,
            because each one belongs to the agent that was answering.
          </P>
        </Section>

        <Section id="context" n={7} title="Teaching it your template and your voice">
          <Lead>
            What the agent reads, the third button in this column's header,
            takes a document you have to follow, such as a department
            handbook, a journal's author instructions or a class file, and a
            piece of writing that sounds like you, usually a paper you have
            already published.
          </Lead>
          <P>
            It reads each one once and keeps a distilled summary rather than
            the whole document, so the rules travel with every question
            without costing the length of a handbook each time. You can read
            and correct what it kept in that same view.
          </P>
          <P>
            The same view holds what it has been told to remember. Ask it to
            remember something about the project and the note survives a new
            conversation. It is a plain file, and you can edit it by hand.
          </P>
        </Section>

        <Section id="references" n={8} title="References it cannot invent">
          <Lead>
            Ask for a citation and it searches real catalogues, then fetches
            the entry from the publisher's own record by DOI. It never
            composes a BibTeX entry from memory, which is the failure that
            matters most in a bibliography.
          </Lead>
          <P>
            It can also check a bibliography you already have, entry by entry
            against those records, and fill one from a folder of PDFs, each
            checked against the paper it came from, so a wrong DOI is refused
            rather than added. The <C>Papers</C> drawer is where those PDFs
            live: one field takes a search or a pasted DOI, and each result
            has a card with its authors and abstract.
          </P>
        </Section>

        <Section id="sharing" n={9} title="Writing it with somebody else">
          <Lead>
            <strong>People</strong>, on the bar, or Share on the
            project's row in the list, gives you an invite to send. Whoever opens it gets the whole project, every file and
            what those files used to say, into a folder of their own, empty or
            already holding a copy, and from then on the two copies stay in
            step.
          </Lead>
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
            of the tabs shows who else is here: filled in while they are
            typing, outlined while they are only there. A click on it opens
            <C>People</C>, where each of them has a row saying which file
            they are in, with Remove on it. Their name is on the
            versions they wrote, so a month later the history says who
            changed the paragraph.
          </P>
          <P>
            An invite is a credential: whoever opens it joins. It works once
            and expires after a week, so send it the way you would send a
            password. There are no accounts and nothing in the middle: a
            collaborator is a public key, and the two installs talk directly,
            encrypted end to end.
          </P>
          <P>
            Nobody owns a shared project. Anyone in it can invite somebody
            else, and anyone can disconnect anybody, but disconnecting
            somebody does not take back the copy they already have. It stops
            the two of you syncing. It cannot unsend a paper.
          </P>
          <P>
            Two things that are true and might not be obvious. Each of you
            keeps your own <C>.git</C>, so pull between sessions rather than
            during one: a pull replaces a whole file and will win against a
            collaborator's untouched paragraphs. And your conversation with
            the agent is yours: the writing is shared, the chat is not.
          </P>
        </Section>

        <Section id="safety" n={10} title="Nothing is lost">
          <Lead>
            Every pause is a version. Open a file's history from the menu on
            its row in the Files drawer, or from the History button on the
            bar, read any earlier version, and put it back if you want it. A version you are reading cannot be typed
            into. Give one a name and it is kept for good.
          </Lead>
          <P>
            The same menu duplicates a file, and can clear a file's history
            when you are sure. Deleted files go to the <C>Deleted</C> drawer,
            which never empties itself, and a deleted folder comes back
            whole. A whole project can be archived or put in the trash from
            its row on the projects screen, and both are undone from the view
            that holds them; nothing on disk moves.
          </P>
          <P>
            The <C>Git</C> drawer offers a repository to a project that has
            none, and then does the four things a paper needs: see what
            changed, commit, push, pull. Branching stays in a
            terminal, where the tools are better and mistakes are
            recoverable.
          </P>
          <Figure
            light={gitLight}
            dark={gitDark}
            width={480}
            height={520}
            alt="The Git drawer offering to keep versions of the project with git."
            caption="Offered once. Not now puts it away, and Back up brings the wizard back later."
          />
          <P>
            Everything NextTex adds lives in <C>.nexttex/</C> beside your
            files. Delete that folder and you have exactly the LaTeX project
            you started with.
          </P>
        </Section>

        <Section id="keys" n={11} title="Keyboard">
          <P>
            Every chord is written for both keyboards. The app reads the Mac's{" "}
            <C>⌘</C> and everybody else's <C>Ctrl</C> as the same key, so
            either line is true wherever you are.
          </P>
          <Keys
            groups={[
              {
                // From the registry every chord is dispatched from, so this
                // list cannot say a key the app does not answer; the
                // README's table is checked against the same registry.
                where: "Anywhere",
                rows: CHORDED.map((action) => ({ spec: action.chord!, does: action.does ?? action.label })),
              },
              {
                where: "In the source",
                rows: [
                  { spec: "Mod-Enter", does: "Scroll the page to the line you are on; in a script, run it" },
                  { spec: "Mod-F", does: "Find and replace in this file" },
                  { spec: "Mod-.", does: "The menu for the word under the caret" },
                  { spec: "Mod-click", does: "Follow a \\ref to its label or an \\input to its file" },
                  { spec: "Alt-drag", does: "Select a column, for editing a table" },
                  { spec: "Mod-Alt-ArrowDown", does: "A caret on the row below; ↑ for above" },
                  { key: "↹ or ↵", does: "In the completion list, take the suggestion" },
                  { key: "Esc", does: "Back to one caret" },
                ],
              },
              {
                where: "On the page",
                rows: [
                  { spec: "Mod-F", does: "Find on the typeset page" },
                  { key: "Double-click", does: "Go to the line that set this" },
                ],
              },
              {
                where: "In the Files drawer",
                rows: [
                  { key: "Typing", does: "Jumps to a file" },
                  { key: "F2, Delete", does: "Rename, move to trash" },
                ],
              },
              {
                where: "In the agent column",
                rows: [
                  { key: "↵, ⇧↵", does: "Send; a new line" },
                  { key: "A, ⇧A, C, D", does: "In a permission card: allow, allow always, for this conversation, deny" },
                  { key: "Esc", does: "Stop the turn if one is running, otherwise close the panel" },
                ],
              },
            ]}
          />
          <P>
            <C>Esc</C> closes this tutorial too, unless you are typing into
            something.
          </P>
          <p className="t-micro text-ink-3">
            Installing and a longer walkthrough are in the project's README
            and <C>docs/first-session.md</C>.
          </p>
        </Section>
      </div>
    </div>
  );
}
