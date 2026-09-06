/** The mark.
 *
 *  A sheet of paper with its corner turned and a single chevron cut into
 *  its left edge, so the negative space says *next*.  One chevron, not two:
 *  the first drawing had a notch and a stroked arrow two units apart, and
 *  at 18 px in the rail they fused into a violet smudge.
 *
 *  The tile is outlined rather than filled, because filled violet means
 *  "answer the agent" everywhere else in this app and a brand mark should
 *  not spend that.
 */
export default function Logo({ size = 20 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" role="img" aria-label="NextTex">
      <rect
        x="1"
        y="1"
        width="30"
        height="30"
        rx="7"
        fill="none"
        stroke="var(--pen)"
        strokeWidth="2"
      />
      <path
        d="M11 7.5h7.5L23 12v12.5H11V19.5l3.5-3.5L11 12.5z"
        fill="none"
        stroke="var(--pen)"
        strokeWidth="2"
        strokeLinejoin="round"
        strokeLinecap="round"
      />
      <path d="M18.5 7.5V12H23" fill="none" stroke="var(--pen)" strokeWidth="2"
        strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}

/** The same mark as a data URI, for the browser tab.
 *
 *  Inlined rather than served: the server routes every unknown path to the
 *  app shell, so a /logo.svg would come back as HTML.  A tab icon is 16 px
 *  on a strip of other tabs, so this one is filled -- an outline that small
 *  disappears. */
export const FAVICON_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32">' +
  '<rect width="32" height="32" rx="7" fill="#7B45A0"/>' +
  '<path d="M11 7.5h7.5L23 12v12.5H11V19.5l3.5-3.5L11 12.5z" fill="#fff"/>' +
  '<path d="M18.5 7.5V12H23" fill="#7B45A0" opacity=".4"/></svg>';
