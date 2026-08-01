import { Route, Routes } from 'react-router-dom';
import { AppShell } from './components/layout/AppShell';
import { PlaceholderPage } from './components/placeholders/PlaceholderPage';
import { JournalEntriesPage } from './pages/JournalEntriesPage';
import { TiersPage } from './pages/TiersPage';
import { GrandLivrePage } from './pages/GrandLivrePage';
import { ImportExcelPage } from './pages/ImportExcelPage';

export default function App() {
  return (
    <AppShell>
      <Routes>
        <Route path="/" element={<JournalEntriesPage />} />
        <Route path="/tiers" element={<TiersPage />} />
        <Route path="/grand-livre" element={<GrandLivrePage />} />
        <Route path="/import" element={<ImportExcelPage />} />
        <Route
          path="/fec"
          element={
            <PlaceholderPage
              kind="not-built"
              title="Export FEC"
              message="Sélection de la période puis génération et téléchargement du fichier — l'export lui-même est déjà conforme côté serveur."
            />
          }
        />
        <Route
          path="/tva"
          element={
            <PlaceholderPage
              kind="not-implemented"
              title="TVA"
              message="Le calcul de la déclaration de TVA n'est pas encore implémenté côté serveur (VatService.computeDeclaration lève NotImplementedException). Rien à afficher ici tant que ce n'est pas fait — voir CLAUDE.md."
            />
          }
        />
        <Route
          path="/liasse"
          element={
            <PlaceholderPage
              kind="not-implemented"
              title="Liasse fiscale"
              message="La génération de la liasse fiscale n'est pas encore implémentée côté serveur. Rien à afficher ici tant que ce n'est pas fait — voir CLAUDE.md."
            />
          }
        />
      </Routes>
    </AppShell>
  );
}
