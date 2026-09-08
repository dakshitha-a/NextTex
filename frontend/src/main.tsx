import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import Boundary from "./Boundary";
import "./styles.css";
import { applyAppearance, storedAppearance } from "./appearance";

// Before the first paint, so no frame renders in the wrong theme or at
// the wrong size.
applyAppearance(storedAppearance());

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Boundary>
      <App />
    </Boundary>
  </StrictMode>,
);
