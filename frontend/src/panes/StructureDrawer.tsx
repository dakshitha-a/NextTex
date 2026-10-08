import { lazy, useState } from "react";
import type { Heading } from "../outline";
import { keep, recallText } from "../remember";
import { Segmented } from "../ui/controls";
import SectionsPanel from "./SectionsPanel";

const FiguresPanel = lazy(() => import("./FiguresPanel"));
const TypesetPanel = lazy(() => import("./TypesetPanel"));

type Which = "sections" | "figures" | "typeset";

/** The Sections drawer: the document's structure, as the headings of the
 *  file in the editor, as its figures and tables, or as the headings of
 *  the whole document in the preview, under one switch rather than three
 *  buttons on the bar. The choice is remembered on this computer. */
export default function StructureDrawer({
  onJump,
  onOpen,
  onShow,
  resolve,
}: {
  onJump: (heading: Heading) => void;
  onOpen: (file: string, line: number) => void;
  /** Shows a source line's place on the typeset page. */
  onShow: (file: string, line: number, kind: string) => void;
  resolve: (path: string) => string | undefined;
}) {
  const [which, setWhich] = useState<Which>(() => {
    const kept = recallText("nexttex.structure");
    return kept === "figures" || kept === "typeset" ? kept : "sections";
  });
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
            { value: "typeset", label: "Typeset", testid: "structure-typeset" },
          ]}
        />
      </div>
      {which === "sections" ? (
        <SectionsPanel drawer onJump={onJump} grow resolve={resolve} />
      ) : which === "figures" ? (
        <FiguresPanel onOpen={onOpen} />
      ) : (
        <TypesetPanel onOpen={onOpen} onShow={onShow} />
      )}
    </div>
  );
}
