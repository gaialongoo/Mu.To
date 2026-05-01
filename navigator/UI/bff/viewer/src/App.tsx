import "./styles/svg.css";
import SvgViewer from "./components/SvgViewer";
import { NavLangProvider } from "./i18n/NavLangContext";

export default function App() {
  return (
    <NavLangProvider>
      <div className="app-root">
        <div className="viewer-shell">
          <SvgViewer />
        </div>
      </div>
    </NavLangProvider>
  );
}
