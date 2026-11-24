import { NavLink, Route, Routes } from "react-router-dom";
import SearchPage from "./pages/SearchPage";
import PeoplePage from "./pages/PeoplePage";
import PersonPage from "./pages/PersonPage";
import HistoryPage from "./pages/HistoryPage";
import DuplicatesPage from "./pages/DuplicatesPage";
import AnalyticsPage from "./pages/AnalyticsPage";
import PolicyPage from "./pages/PolicyPage";
import SettingsPage from "./pages/SettingsPage";

export default function App() {
  return (
    <div className="app">
      <aside className="sidebar">
        <div className="brand">
          <span className="brand-dot" /> Contact Discovery
        </div>
        <nav className="nav">
          <NavLink to="/" end>Search</NavLink>
          <NavLink to="/people">Contacts</NavLink>
          <NavLink to="/history">Search history</NavLink>
          <NavLink to="/duplicates">Duplicates</NavLink>
          <NavLink to="/analytics">Analytics</NavLink>
          <NavLink to="/policy">Ethical use</NavLink>
          <NavLink to="/settings">Settings</NavLink>
        </nav>
        <div className="scope">
          Sources: Quora, Medium and Reddit. Scope: people in the <strong>United States</strong> and <strong>Europe</strong>. Public information they chose to publish.
        </div>
      </aside>
      <main className="main">
        <Routes>
          <Route path="/" element={<SearchPage />} />
          <Route path="/searches/:id" element={<SearchPage />} />
          <Route path="/people" element={<PeoplePage />} />
          <Route path="/people/:id" element={<PersonPage />} />
          <Route path="/history" element={<HistoryPage />} />
          <Route path="/duplicates" element={<DuplicatesPage />} />
          <Route path="/analytics" element={<AnalyticsPage />} />
          <Route path="/policy" element={<PolicyPage />} />
          <Route path="/settings" element={<SettingsPage />} />
        </Routes>
      </main>
    </div>
  );
}
