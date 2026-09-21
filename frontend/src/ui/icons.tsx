import type { ReactNode, SVGAttributes } from "react";

/** The one icon set.
 *
 *  Every icon in the interface is drawn here, on a 16 px grid at a 1.5 px
 *  stroke, in `currentColor` so it takes the ink of whatever holds it and
 *  never carries a colour of its own.  Named exports and no table of
 *  them, deliberately: an icon that a lazy pane imports stays in that
 *  pane's chunk, and a table would pull every icon into the entry the
 *  first time one was used there.  `size` is 16 unless a bar wants 18 or
 *  20; nothing else about an icon is a caller's to choose. */
type IconProps = SVGAttributes<SVGSVGElement> & { size?: number };

function icon(paths: ReactNode) {
  return function Icon({ size = 16, className, ...rest }: IconProps) {
    return (
      <svg
        width={size}
        height={size}
        viewBox="0 0 16 16"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
        className={className}
        {...rest}
      >
        {paths}
      </svg>
    );
  };
}

export const FileIcon = icon(<><path d="M4 2h6l3 3v9H4z" /><path d="M10 2v3h3" /></>);
export const FolderIcon = icon(<path d="M2 4h4l1.5 1.5H14v8H2z" />);
export const FolderOpenIcon = icon(<><path d="M2 4h4l1.5 1.5H13v2" /><path d="M2 13l1.6-5.5H14.5L13 13z" /></>);
export const UploadIcon = icon(<><path d="M8 11V3" /><path d="M5 6l3-3 3 3" /><path d="M3 13h10" /></>);
export const SearchIcon = icon(<><circle cx="7" cy="7" r="4" /><path d="M10 10l3.5 3.5" /></>);
export const SectionsIcon = icon(<path d="M3 4h10M5 8h8M7 12h6" />);
export const PapersIcon = icon(<><path d="M3 3h7a2 2 0 0 1 2 2v9H5a2 2 0 0 1-2-2z" /><path d="M12 5h1v9" /></>);
export const HistoryIcon = icon(<><circle cx="8" cy="8" r="5.5" /><path d="M8 5v3l2 1.5" /></>);
export const PeopleIcon = icon(<><circle cx="6" cy="5.5" r="2.5" /><path d="M1.5 13.5c0-2.5 2-4 4.5-4s4.5 1.5 4.5 4" /><circle cx="11.5" cy="6" r="2" /><path d="M12 9.5c1.7.2 2.8 1.5 2.8 3.5" /></>);
export const BuildIcon = icon(<><path d="M9 3.5l3.5 3.5" /><path d="M8 4.5l1-1 4 4-1 1z" /><path d="M8.5 6.5L3 12l1.5 1.5L10 8" /></>);
export const GitIcon = icon(<><circle cx="5" cy="4" r="1.5" /><circle cx="5" cy="12" r="1.5" /><circle cx="11" cy="6" r="1.5" /><path d="M5 5.5v5M11 7.5c0 2-6 1-6 3" /></>);
export const SubmitIcon = icon(<path d="M3 8.5l3 3 7-7" />);
export const TrashIcon = icon(<path d="M3 4h10M6 4V2.5h4V4M4.5 4l.7 9h5.6l.7-9" />);
export const ShareIcon = icon(<><circle cx="12" cy="3.5" r="1.5" /><circle cx="4" cy="8" r="1.5" /><circle cx="12" cy="12.5" r="1.5" /><path d="M5.4 7.3l5.2-3M5.4 8.7l5.2 3" /></>);
export const DownloadIcon = icon(<path d="M8 2v8M5 7l3 3 3-3M3 13h10" />);
export const SettingsIcon = icon(<><path d="M3 5h10M3 11h10" /><circle cx="6" cy="5" r="1.6" /><circle cx="10" cy="11" r="1.6" /></>);
export const ChevronLeftIcon = icon(<path d="M10 3L5 8l5 5" />);
export const ChevronRightIcon = icon(<path d="M6 3l5 5-5 5" />);
export const ChevronDownIcon = icon(<path d="M3 6l5 5 5-5" />);
export const ChevronUpIcon = icon(<path d="M3 10l5-5 5 5" />);
export const PlusIcon = icon(<path d="M8 3v10M3 8h10" />);
export const SendIcon = icon(<path d="M8 13V3M4 7l4-4 4 4" />);
export const CloseIcon = icon(<path d="M4 4l8 8M12 4l-8 8" />);
export const ContextIcon = icon(<><path d="M3 3h10v10H3z" /><path d="M5.5 6h5M5.5 8.5h5M5.5 11h3" /></>);
export const ClipIcon = icon(<path d="M10.5 4.5l-5 5a1.8 1.8 0 0 0 2.5 2.5l5.5-5.5a3 3 0 0 0-4.2-4.2L4 7.5" />);
export const FoldIcon = icon(<path d="M2 3h12M2 8h12M2 13h12" />);
export const MoreIcon = icon(<><circle cx="4" cy="8" r="1.2" fill="currentColor" stroke="none" /><circle cx="8" cy="8" r="1.2" fill="currentColor" stroke="none" /><circle cx="12" cy="8" r="1.2" fill="currentColor" stroke="none" /></>);
export const SlidersIcon = icon(<><path d="M3 4h10M3 8h10M3 12h10" /><circle cx="6" cy="4" r="1.4" /><circle cx="10" cy="8" r="1.4" /><circle cx="5" cy="12" r="1.4" /></>);
export const ImageIcon = icon(<><path d="M2.5 3.5h11v9h-11z" /><path d="M4 11l3-3 2 2 1.5-1.5L12 11" /></>);
export const DocIcon = icon(<><path d="M4 2h8v12H4z" /><path d="M6 6h4M6 8.5h4M6 11h2" /></>);
export const UpdateIcon = icon(<><path d="M13 8a5 5 0 1 1-1.5-3.6" /><path d="M13 2.5v3h-3" /></>);
export const ReportIcon = icon(<><path d="M2.5 3h11v8H7l-3 2.5V11H2.5z" /><path d="M8 5.5v2.5" /><circle cx="8" cy="9.6" r="0.5" fill="currentColor" /></>);
export const HelpIcon = icon(<><circle cx="8" cy="8" r="5.5" /><path d="M6.3 6.5a1.7 1.7 0 1 1 2.4 1.6c-.5.3-.7.6-.7 1.1" /><circle cx="8" cy="11.2" r="0.5" fill="currentColor" /></>);
export const LockIcon = icon(<><rect x="3.5" y="7" width="9" height="6.5" rx="1" /><path d="M5.5 7V5a2.5 2.5 0 0 1 5 0v2" /></>);
export const RunIcon = icon(<path d="M5 3l8 5-8 5z" />);
export const StopIcon = icon(<rect x="4" y="4" width="8" height="8" rx="1" />);
export const SparkIcon = icon(<path d="M8 2v12M2 8h12M4 4l8 8M12 4l-8 8" />);
export const BoltIcon = icon(<path d="M9 2L4 9h4l-1 5 5-7H8z" />);
