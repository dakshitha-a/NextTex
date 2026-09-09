/** The mark: a page, struck through with a backslash.
 *
 *  Redrawn, and it is worth writing down why, because the drawing it
 *  replaces was not bad -- it was a sheet of paper with its corner turned
 *  and a chevron cut into its left edge so the negative space said *next* --
 *  and three things were wrong with it that only show up beside the rest of
 *  the interface.
 *
 *  **It was in a box.** A rounded square around a glyph is the most generic
 *  container in software, it said nothing the sheet inside was not already
 *  saying, and it cost the sheet half its height in a 20px slot. Taking the
 *  tile away lets the mark be nearly twice the size in the same space.
 *
 *  **The chevron read as damage.** A notch cut into a page's edge is a torn
 *  page before it is an arrow, and it sat on the *left* edge, which is where
 *  a control meaning "back" would be. It was carrying the wrong half of the
 *  name at the cost of the silhouette.
 *
 *  **It could have belonged to any program that opens files.** A sheet with
 *  a folded corner is the file icon -- it is, almost exactly, the glyph this
 *  application now draws beside every file in the tree, which is the point
 *  at which a logo has stopped being a logo. Nothing in it said typesetting,
 *  and nothing in it said TeX.
 *
 *  So: a backslash. Every command in the language this application exists to
 *  write begins with one; it is one stroke, so it survives 16px; and no
 *  other product's mark is a backslash. It is struck across a page rather
 *  than standing alone, because the page is the thing being made and the
 *  source is what makes it.
 *
 *  **The page is drawn in --ink and only the backslash is --pen.** That is
 *  the part worth keeping if anything here is ever redrawn again. Violet in
 *  this application means the agent touched something, and a mark washed in
 *  it spends a colour the interface has reserved. One stroke of it is a
 *  signature; a whole glyph of it is a claim. It also means the mark takes
 *  the theme's own inks and is legible on both grounds without a second set
 *  of values, which a single fixed brand violet would not be: #7B45A0 on the
 *  dark rail measures 2.8:1, under the 3:1 a graphic needs.
 */
export default function Logo({ size = 20 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" role="img" aria-label="NextTex">
      {/* 18 by 26 is close enough to A4 that it reads as a sheet rather than
          as a rectangle, and the 2 unit radius keeps it from looking like a
          window. */}
      <rect
        x="7"
        y="3"
        width="18"
        height="26"
        rx="2"
        fill="none"
        stroke="var(--ink)"
        strokeWidth="1.9"
      />
      {/* Steeper than a diagonal across the box: a backslash in a monospaced
          face falls further than it travels, and drawn at 45 degrees this
          stopped being a letter and became a strikethrough. */}
      <path
        d="M11.9 9 L20.1 23"
        fill="none"
        stroke="var(--pen)"
        strokeWidth="3.2"
        strokeLinecap="round"
      />
    </svg>
  );
}
