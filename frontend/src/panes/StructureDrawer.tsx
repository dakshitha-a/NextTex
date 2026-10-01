import { lazy, useState } from "react";
import type { Heading } from "../outline";
import { keep, recallText } from "../remember";
import { Segmented } from "../ui/controls";
import SectionsPanel from "./SectionsPanel";

const FiguresPanel = lazy(() => import("./FiguresPanel"));

type Which = "sections" | "figures";

/** The Sections drawer: the document's structure, as its headings or as
 *  its figures and tables, under one switch rather than two buttons on
 *  the bar. The choice is remembered on this computer. */
export default function StructureDrawer({
  onJump,
  onOpen,
  resolve,
}: {
  onJump: (heading: Heading) => void;
  onOpen: (file: string, line: number) => void;
  resolve: (path: string) => string | undefined;
}) {
  const [which, setWhich] = useState<Which>(
    () => (recallText("nexttex.structure") === "figures" ? "figures" : "sections"),
  );
  const choose = (next: Which) => {
    setWhich(next);
    keep("nexttex.structure", next);
  };
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="shrink-0 px-2 pb-2">
        <Segmented
          tone="drawer"
          value={which}
          onChange={choose}
          label="Show"
          testid="structure-choice"
          options={[
            { value: "sections", label: "Sections", testid: "structure-sections" },
            { value: "figures", label: "Figures", testid: "structure-figures" },
          ]}
        />
      </div>
      {which === "sections" ? (
        <SectionsPanel drawer onJump={onJump} grow resolve={resolve} />
      ) : (
        <FiguresPanel onOpen={onOpen} />
      )}
    </div>
  );
}
