import type { JoinOffer, OfferedFile } from "../api";
import { sizeOf } from "../size";

/** What a peer is offering, before a byte of it is written.
 *
 *  Accepting an invite is downloading somebody else's files, and until this
 *  existed the first moment anybody could look at what they had accepted was
 *  after all of it was on their disk. The documents are held open on the
 *  server while this is on screen, so discarding really does leave nothing
 *  behind rather than deleting something that was written a moment ago.
 *
 *  Drawn inside the join sheet as a block on the second surface: the
 *  count and the size, the sentence saying nothing has been written yet,
 *  the files with their sizes, and what accepting would do to each when
 *  the folder already has files.  The two answers, Discard and Accept, are
 *  the sheet's foot while the offer is on screen, not buttons of the
 *  block's own.
 */
export default function JoinOfferCard({ offer }: { offer: JoinOffer }) {
  const landing = offer.files.filter((file) => !file.refused);
  const refused = offer.files.filter((file) => file.refused);
  const total = landing.reduce((sum, file) => sum + file.size, 0);

  return (
    <div className="nx-offer" data-testid="join-offer">
      <div className="nx-offer-count">
        {landing.length} {landing.length === 1 ? "file" : "files"}, {sizeOf(total)}
      </div>
      <p className="nx-offer-text">
        {offer.existing ? (
          <>
            Nothing has been written yet. <span className="t-code-sm">{offer.path}</span>{" "}
            already has files, and this is what accepting would do to each.
            The shared project wins where they disagree; nothing of yours is
            lost, it goes to the file's history or to the trash.
          </>
        ) : (
          <>
            Nothing has been written yet. This is what would arrive in{" "}
            <span className="t-code-sm">{offer.path}</span>.
          </>
        )}
      </p>
      <div className="nx-offer-files">
        {landing.map((file) => (
          <div
            key={file.path}
            className="nx-offer-file"
            data-outcome={offer.existing ? file.outcome : undefined}
          >
            <span className="t-code-sm min-w-0 truncate text-ink">{file.path}</span>
            <span className="nx-offer-tail">
              {offer.existing ? (
                <>
                  <span className={file.outcome === "same" || file.outcome === "behind" ? "" : "text-ink-2"}>
                    {outcomeWords(file.outcome)}
                  </span>
                  {" · "}
                </>
              ) : null}
              {sizeOf(file.size)}
            </span>
          </div>
        ))}
      </div>
      {refused.length ? (
        <p className="nx-offer-text mt-2">
          {refused.length}{" "}
          {refused.length === 1 ? "file was offered" : "files were offered"}{" "}
          that NextTex will not write, because the build would run{" "}
          {refused.length === 1 ? "it" : "them"}:{" "}
          <span className="t-code-sm">
            {refused.map((file) => file.path).join(", ")}
          </span>
        </p>
      ) : null}
    </div>
  );
}

/** What accepting does to a file of a folder that already had files, in
 *  the words of the person whose files they are. */
function outcomeWords(outcome: OfferedFile["outcome"]): string {
  switch (outcome) {
    case "same":
      return "same as yours";
    case "differs":
      return "replaces yours; yours kept in its history";
    case "behind":
      return "newer than yours; replaces it, git has yours";
    case "merged":
      return "your edits merged in; goes to everybody";
    case "new here":
      return "only here; goes to everybody";
    case "deleted elsewhere":
      return "deleted by the others; yours goes to the trash";
    default:
      return "new from the others";
  }
}
