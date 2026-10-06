/** A card that appears when the pointer rests on a thing in the editor,
 *  stays while the pointer is with it, and keeps clear of the thing.
 *
 *  The hover cards were CodeMirror's `hoverTooltip`, and two things about
 *  it did not survive contact with a writer.  Its placement anchors on
 *  the first line of the hovered range and, when there is no room above,
 *  pins the card to the top of the view over the range's own lines: an
 *  equation hovered near the top of the view had its card over its own
 *  code.  And under the interface size setting, which scales the shell
 *  with `zoom`, its tooltip layer drew the card at viewport coordinates
 *  written as CSS pixels, that much further right and down: at 125 % a
 *  reference's card sat on the hovered line, ran into the preview pane
 *  and put its buttons below the window.  Its presence rule then closed
 *  the card the moment the pointer was neither over the range nor inside
 *  the card, so a card drawn in the wrong place could not be reached, and
 *  the writer's report was that the cards "block the thing being hovered
 *  on and disappear when I try to click any buttons on it".
 *
 *  This plugin owns the pointer instead, with two rules.
 *
 *  Placement: `placeClear`, the same rule the selection's verb row uses.
 *  The card sits above the hovered block's first line when there is room,
 *  below its last line when there is not, and only when the block fills
 *  the view at the pane edge nearest the pointer; the left edge is at the
 *  text; everything is measured in shell pixels; and the card lives
 *  inside `.cm-editor`, so it is clipped by the pane it belongs to and
 *  never by a neighbour.  A card that grows after it is drawn, the maths
 *  when KaTeX lands or a figure when its thumbnail does, is placed again.
 *
 *  Presence: the card arms after the pointer has rested for `hoverTime`,
 *  stays while the pointer is over the hovered range or over the card,
 *  and goes 300 ms after it has left both, at once if it comes back.  A
 *  key press, a scroll, a mousedown outside the card, a change to the
 *  document or the window losing focus close it at once.  A mousedown on
 *  the card is kept from the editor, so a press on one of the card's
 *  buttons is an ordinary click that neither moves the selection nor
 *  closes the card before the click lands; the card closes after the
 *  button has done its work.  Never on touch, and never while a button
 *  is held, since a drag is choosing text rather than resting on it.
 *
 *  Quiet: a thing the writer has turned to work on does not bring its
 *  card back while they work on it.  Escape on an open card, or a press
 *  in the text, quiets the thing the card or the press was on: no card
 *  arms anywhere inside it, a formula in a quieted table's cell
 *  included, until the pointer has been off it for `QUIET_TIME`.  The
 *  quieted range is carried through edits, so typing in the thing keeps
 *  it quiet.  The writer's report was that a table's card, closed with
 *  Escape, came back "every time I use the mouse to navigate to a point
 *  on the table's source"; a fixed timeout would have brought it back
 *  mid edit, so the clock runs from the pointer leaving instead.
 *
 *  The card's `data-side` says which side of the text it is on, so the
 *  stylesheet can put the button row on the edge nearest the text.
 */

import { ViewPlugin, type EditorView, type Tooltip, type TooltipView, type ViewUpdate } from "@codemirror/view";
import type { Extension } from "@codemirror/state";
import { placeClear } from "./place-clear";
import { uiScale } from "../viewport";

/** How long the pointer rests on a thing before its card appears. */
export const HOVER_TIME = 250;
/** How long the card stays after the pointer has left it and the thing. */
export const LEAVE_TIME = 300;
/** How far outside the range or the card the pointer still counts as
 *  with them, so the gap between the two and a hand that wavers do not
 *  start the leave clock. */
const MARGIN = 6;
/** How long the pointer is off a quieted thing before its card may come
 *  back. */
export const QUIET_TIME = 1500;

type Source = (view: EditorView, pos: number) => Tooltip | null;

type Open = {
  tooltip: Tooltip;
  card: TooltipView;
  dom: HTMLElement;
  from: number;
  to: number;
  watcher: ResizeObserver | null;
};

type Rect = { left: number; top: number; right: number; bottom: number };

export function hoverCard(source: Source): Extension {
  return ViewPlugin.fromClass(
    class {
      open: Open | null = null;
      arm: ReturnType<typeof setTimeout> | null = null;
      leave: ReturnType<typeof setTimeout> | null = null;
      last: { x: number; y: number } | null = null;
      /** Whether the pointer has left the card and the thing since the
       *  card was drawn.  A pointer that comes back to the thing inside
       *  the grace gets a fresh card, since what the card says may have
       *  changed meanwhile, a build having landed the reference's number;
       *  one that comes back to the card keeps it. */
      away = false;
      /** The thing quieted by Escape or a press, and the clock that ends
       *  the quiet once the pointer is off it. */
      quiet: { from: number; to: number } | null = null;
      unquiet: ReturnType<typeof setTimeout> | null = null;
      readonly listeners: Array<[EventTarget, string, (event: any) => void, boolean | AddEventListenerOptions]>;

      constructor(readonly view: EditorView) {
        const close = () => this.close();
        this.listeners = [
          [view.dom, "pointermove", (event: PointerEvent) => this.moved(event), false],
          [view.dom, "pointerleave", () => this.left(), false],
          [view.dom, "mousedown", (event: MouseEvent) => this.pressed(event), true],
          [view.dom, "keydown", (event: KeyboardEvent) => this.keyed(event), false],
          [view.scrollDOM, "scroll", close, { passive: true }],
          [window, "blur", close, false],
        ];
        for (const [target, name, handler, options] of this.listeners) {
          target.addEventListener(name, handler, options);
        }
      }

      update(update: ViewUpdate) {
        if (!update.docChanged) return;
        if (this.open) this.close();
        if (this.quiet) {
          const from = update.changes.mapPos(this.quiet.from, -1);
          const to = update.changes.mapPos(this.quiet.to, 1);
          this.quiet = to > from ? { from, to } : null;
        }
      }

      destroy() {
        this.close();
        this.disarm();
        this.speak();
        for (const [target, name, handler, options] of this.listeners) {
          target.removeEventListener(name, handler, options);
        }
      }

      moved(event: PointerEvent) {
        if (event.pointerType === "touch") return;
        this.last = { x: event.clientX, y: event.clientY };
        if (this.quiet) {
          if (this.over(this.quiet, event.clientX, event.clientY)) this.hush();
          else this.leavingQuiet();
        }
        if (event.buttons !== 0) {
          this.disarm();
          return;
        }
        if (this.open) {
          if (this.open.dom.contains(event.target as Node)) {
            // On the card.  The text behind it is not being hovered,
            // whatever `posAtCoords` would say about the point.
            this.stay();
            this.away = false;
            this.disarm();
            return;
          }
          if (this.with(event.clientX, event.clientY)) this.stay();
          else this.leaving();
        }
        // Armed on every move: the card appears once the pointer has
        // rested, not while it is travelling.  With a card open the arm
        // still runs, so resting on another thing replaces the card.
        this.disarm();
        this.arm = setTimeout(() => {
          this.arm = null;
          this.rested();
        }, HOVER_TIME);
      }

      left() {
        this.disarm();
        if (this.open) this.leaving();
        if (this.quiet) this.leavingQuiet();
      }

      keyed(event: KeyboardEvent) {
        if (event.key === "Escape" && this.open) this.quieten(this.open);
        this.close();
      }

      pressed(event: MouseEvent) {
        if (this.open && this.open.dom.contains(event.target as Node)) {
          // Kept from the editor: a press on the card must not move the
          // selection, and must not close the card before the click that
          // follows it lands on the button.
          event.preventDefault();
          event.stopPropagation();
          return;
        }
        // A press in the text is the writer going to work there.  The arm
        // from the move before it would otherwise draw the card over the
        // caret just placed, and the next rest would draw it again.
        this.disarm();
        this.close();
        const pos = this.view.posAtCoords({ x: event.clientX, y: event.clientY });
        const thing = pos === null ? null : source(this.view, pos);
        if (thing) this.quieten({ from: thing.pos, to: thing.end ?? thing.pos });
      }

      /** The pointer has rested: draw the card for what is under it, or
       *  nothing. */
      rested() {
        const at = this.last;
        if (!at) return;
        const pos = this.view.posAtCoords(at);
        if (pos === null) return;
        if (this.quiet && pos >= this.quiet.from && pos <= this.quiet.to) return;
        const same = this.open !== null && pos >= this.open.from && pos <= this.open.to;
        if (same && !this.away) return;
        const tooltip = source(this.view, pos);
        if (!tooltip) return;
        const end = tooltip.end ?? tooltip.pos;
        this.close();
        this.show(tooltip, end);
      }

      show(tooltip: Tooltip, end: number) {
        const card = tooltip.create(this.view);
        const dom = card.dom;
        dom.classList.add("nx-hover-card");
        dom.style.position = "absolute";
        dom.style.visibility = "hidden";
        // After a button has done its work the card has said what it
        // had to say; the drawer it opened is where the writer looks
        // next.  A button whose answer is said on the card itself, the
        // formula card's Copy as SVG, carries `data-keeps-card`.
        dom.addEventListener("click", (event) => {
          const button = (event.target as HTMLElement).closest("button");
          if (button && !button.hasAttribute("data-keeps-card")) this.close();
        });
        this.view.dom.append(dom);
        card.mount?.(this.view);
        this.open = { tooltip, card, dom, from: tooltip.pos, to: end, watcher: null };
        this.away = false;
        this.place();
        dom.style.visibility = "";
        if (typeof ResizeObserver !== "undefined") {
          const watcher = new ResizeObserver(() => this.place());
          watcher.observe(dom);
          this.open.watcher = watcher;
        }
      }

      /** Where the card goes, clear of the hovered block, in the editor's
       *  own pixels. */
      place() {
        const open = this.open;
        if (!open) return;
        const view = this.view;
        const box = view.dom.getBoundingClientRect();
        const scale = uiScale();
        const origin = (view.documentTop - box.top) / scale;
        const first = view.lineBlockAt(open.from);
        const last = view.lineBlockAt(open.to);
        const start = view.coordsAtPos(open.from);
        const left = ((start?.left ?? box.left) - box.left) / scale;
        const pointerY = this.last ? (this.last.y - box.top) / scale : undefined;
        const at = placeClear(
          { top: first.top / scale + origin, bottom: first.bottom / scale + origin, left },
          { top: last.top / scale + origin, bottom: last.bottom / scale + origin, left },
          { width: view.dom.offsetWidth, height: view.dom.offsetHeight },
          { width: open.dom.offsetWidth, height: open.dom.offsetHeight },
          pointerY,
        );
        open.dom.style.left = `${at.left}px`;
        open.dom.style.top = `${at.top}px`;
        open.dom.dataset.side = at.side;
        open.card.positioned?.(box);
      }

      /** Whether a viewport point is with the card: over the hovered
       *  range's lines, or over the card, either with a small margin. */
      with(x: number, y: number): boolean {
        const open = this.open;
        if (!open) return false;
        return inside([open.dom.getBoundingClientRect(), ...this.rangeRects(open)], x, y);
      }

      /** Whether a viewport point is over a range's lines. */
      over(range: { from: number; to: number }, x: number, y: number): boolean {
        return inside(this.rangeRects(range), x, y);
      }

      /** A range on screen: the token's own box on one line, every line
       *  of it across several. */
      rangeRects(range: { from: number; to: number }): Rect[] {
        const view = this.view;
        const start = view.coordsAtPos(range.from);
        const end = view.coordsAtPos(range.to, -1);
        if (start && end && Math.abs(start.top - end.top) < 2) {
          return [{ left: start.left, top: start.top, right: end.right, bottom: end.bottom }];
        }
        // Line blocks are measured in the same pixels as `documentTop`,
        // so the two add to a viewport coordinate without conversion.
        const box = view.contentDOM.getBoundingClientRect();
        const first = view.lineBlockAt(range.from);
        const last = view.lineBlockAt(range.to);
        return [{
          left: box.left, top: view.documentTop + first.top,
          right: box.right, bottom: view.documentTop + last.bottom,
        }];
      }

      stay() {
        if (this.leave !== null) {
          clearTimeout(this.leave);
          this.leave = null;
        }
      }

      leaving() {
        this.away = true;
        if (this.leave !== null) return;
        this.leave = setTimeout(() => {
          this.leave = null;
          this.close();
        }, LEAVE_TIME);
      }

      quieten(range: { from: number; to: number }) {
        this.speak();
        this.quiet = { from: range.from, to: range.to };
      }

      /** The pointer is on the quieted thing: the quiet holds. */
      hush() {
        if (this.unquiet !== null) {
          clearTimeout(this.unquiet);
          this.unquiet = null;
        }
      }

      leavingQuiet() {
        if (this.unquiet !== null) return;
        this.unquiet = setTimeout(() => {
          this.unquiet = null;
          this.quiet = null;
        }, QUIET_TIME);
      }

      /** The quiet ends now. */
      speak() {
        this.hush();
        this.quiet = null;
      }

      disarm() {
        if (this.arm !== null) {
          clearTimeout(this.arm);
          this.arm = null;
        }
      }

      close() {
        this.stay();
        const open = this.open;
        if (!open) return;
        this.open = null;
        open.watcher?.disconnect();
        open.card.destroy?.();
        open.dom.remove();
      }
    },
  );
}

function inside(rects: Rect[], x: number, y: number): boolean {
  return rects.some((rect) =>
    x >= rect.left - MARGIN && x <= rect.right + MARGIN &&
    y >= rect.top - MARGIN && y <= rect.bottom + MARGIN);
}
