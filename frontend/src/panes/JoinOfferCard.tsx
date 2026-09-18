import type { JoinOffer, OfferedFile } from "../api";

/** What a peer is offering, before a byte of it is written.
 *
 *  Accepting an invite is downloading somebody else's files, and until this
 *  existed the first moment anybody could look at what they had accepted was
 *  after all of it was on their disk. The documents are held open on the
 *  server while this is on screen, so discarding really does leave nothing
 *  behind rather than deleting something that was written a moment ago.
 */
export default function JoinOfferCard({
  offer,
  onAccept,
  onDiscard,
}: {
  offer: JoinOffer;
  onAccept: () => void;
  onDiscard: () => void;
}) {
  const landing = offer.files.filter((file) => !file.refused);
  const refused = offer.files.filter((file) => file.refused);
  const total = landing.reduce((sum, file) => sum + file.size, 0);

  return (
    <div
      className="mt-3 rounded-[3px] border border-line bg-surface"
      data-testid="join-offer"
    >
      <div className="border-b border-line px-3 py-2">
        <p className="t-ui text-ink">
          {landing.length} {landing.length === 1 ? "file" : "files"}, {size(total)}
        </p>
        <p className="t-meta mt-[2px] text-ink-2">
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
      </div>
      <div className="max-h-[220px] overflow-y-auto">
        {landing.map((file) => (
          <div
            key={file.path}
            className="flex items-baseline justify-between gap-3 px-3 py-[3px]"
            data-outcome={offer.existing ? file.outcome : undefined}
          >
            <span className="t-code-sm truncate text-ink">{file.path}</span>
            <span className="t-micro shrink-0 text-ink-3">
              {offer.existing ? (
                <>
                  <span className={file.outcome === "same" || file.outcome === "behind" ? "" : "text-ink-2"}>
                    {outcomeWords(file.outcome)}
                  </span>
                  {" · "}
                </>
              ) : null}
              {size(file.size)}
            </span>
          </div>
        ))}
      </div>
      {refused.length ? (
        <div className="border-t border-line px-3 py-2">
          <p className="t-meta text-ink-2">
            {refused.length}{" "}
            {refused.length === 1 ? "file was offered" : "files were offered"}{" "}
            that NextTex will not write, because the build would run{" "}
            {refused.length === 1 ? "it" : "them"}:{" "}
            <span className="t-code-sm">
              {refused.map((file) => file.path).join(", ")}
            </span>
          </p>
        </div>
      ) : null}
      <div className="flex justify-end gap-2 border-t border-line px-3 py-2">
        <button
          className="ghost-button h-[26px] px-3 t-ui"
          data-testid="discard-join"
          onClick={onDiscard}
        >
          Discard
        </button>
        <button
          className="pen-button h-[26px] px-3 t-ui"
          data-testid="accept-join"
          onClick={onAccept}
        >
          Accept
        </button>
      </div>
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

/** A size a person reads. */
function size(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} kB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
