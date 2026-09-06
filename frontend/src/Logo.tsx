/** The mark.
 *
 *  A sheet of paper with its corner turned, notched on the left so the
 *  negative space reads as a chevron — next.  Hectograph violet, the ink
 *  mid-century theses were actually duplicated in, which is where the whole
 *  palette comes from.  Drawn on a 16-unit grid so it survives a tab strip.
 */
export default function Logo({ size = 20 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 32 32"
      role="img"
      aria-label="NextTex"
    >
      <rect width="32" height="32" rx="7" fill="var(--pen)" />
      <path
        d="M11 7h8l5 5v13a1 1 0 0 1-1 1H11a1 1 0 0 1-1-1v-6l3-3-3-3V8a1 1 0 0 1 1-1z"
        fill="var(--paper)"
      />
      <path d="M19 7l5 5h-5V7z" fill="var(--pen)" opacity="0.35" />
      <path
        d="M14 15.5l3 3-3 3"
        fill="none"
        stroke="var(--pen)"
        strokeWidth="2.2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/** The same mark as a data URI, for the browser tab.
 *
 *  Inlined rather than served, because the server routes every unknown path
 *  to the app shell — a /logo.svg would come back as HTML. */
export const FAVICON_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32">' +
  '<rect width="32" height="32" rx="7" fill="#7B45A0"/>' +
  '<path d="M11 7h8l5 5v13a1 1 0 0 1-1 1H11a1 1 0 0 1-1-1v-6l3-3-3-3V8a1 1 0 0 1 1-1z" fill="#fff"/>' +
  '<path d="M19 7l5 5h-5V7z" fill="#7B45A0" opacity=".35"/>' +
  '<path d="M14 15.5l3 3-3 3" fill="none" stroke="#7B45A0" stroke-width="2.2" ' +
  'stroke-linecap="round" stroke-linejoin="round"/></svg>';
