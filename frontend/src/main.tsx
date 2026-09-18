import { StrictMode, Suspense, lazy } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import Boundary from "./Boundary";
import { pageWindowRequest } from "./page-window";
import "./styles.css";
import { applyAppearance, storedAppearance } from "./appearance";
import { install as recordErrors } from "./errors";

// First, so that a failure in anything below is in the report.
recordErrors();

// Before the first paint, so no frame renders in the wrong theme or at
// the wrong size.
applyAppearance(storedAppearance());

// A window with nothing but the typeset page, when the URL asks for one;
// read before the app strips the query string of its token.  Lazy, so
// the main window's entry chunk does not carry a view it never shows.
const pageWindow = pageWindowRequest(window.location.search);
const PageWindow = lazy(() => import("./panes/PageWindow"));

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Boundary>
      {pageWindow
        ? <Suspense fallback={null}><PageWindow request={pageWindow} /></Suspense>
        : <App />}
    </Boundary>
  </StrictMode>,
);
