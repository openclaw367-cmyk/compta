import { Navigate, Route, Routes } from 'react-router-dom';
import { AppShell } from './components/layout/AppShell';
import { AppProvider } from './context/AppProvider';
import { PreferencesProvider } from './context/PreferencesProvider';
import { usePreferences } from './context/preferencesStore';
import { DashboardPage } from './pages/DashboardPage';
import { JournalEntriesPage } from './pages/JournalEntriesPage';
import { FiscalYearsPage } from './pages/FiscalYearsPage';
import { CompanyProfilePage } from './pages/CompanyProfilePage';
import { AccountsJournalsPage } from './pages/AccountsJournalsPage';
import { TiersPage } from './pages/TiersPage';
import { GrandLivrePage } from './pages/GrandLivrePage';
import { ImportExcelPage } from './pages/ImportExcelPage';
import { FecExportPage } from './pages/FecExportPage';
import { VatPage } from './pages/VatPage';
import { ImmobilisationsPage } from './pages/ImmobilisationsPage';
import { FixedAssetDetailPage } from './pages/FixedAssetDetailPage';
import { LiassePage } from './pages/LiassePage';
import { CashFlowPage } from './pages/CashFlowPage';
import { FinancialAnalysisPage } from './pages/FinancialAnalysisPage';
import { ResultatFiscalPage } from './pages/ResultatFiscalPage';
import { AssistantPage } from './pages/AssistantPage';
import { AssistantSettingsPage } from './pages/AssistantSettingsPage';
import { SettingsPage } from './pages/SettingsPage';

/** "/" redirects to whatever screen the user picked as their default
 * landing screen (see SettingsPage's "Écran de démarrage") — Dashboard
 * itself keeps a stable, always-reachable route at /tableau-de-bord so
 * changing the default never makes it unreachable. */
function HomeRedirect() {
  const { defaultLandingRoute } = usePreferences();
  return <Navigate to={defaultLandingRoute} replace />;
}

export default function App() {
  return (
    <PreferencesProvider>
      <AppProvider>
        <AppShell>
          <Routes>
            <Route path="/" element={<HomeRedirect />} />
            <Route path="/tableau-de-bord" element={<DashboardPage />} />
            <Route path="/ecritures" element={<JournalEntriesPage />} />
            <Route path="/exercices" element={<FiscalYearsPage />} />
            <Route path="/tiers" element={<TiersPage />} />
            <Route path="/comptes" element={<AccountsJournalsPage />} />
            <Route path="/societe" element={<CompanyProfilePage />} />
            <Route path="/grand-livre" element={<GrandLivrePage />} />
            <Route path="/import" element={<ImportExcelPage />} />
            <Route path="/fec" element={<FecExportPage />} />
            <Route path="/immobilisations" element={<ImmobilisationsPage />} />
            <Route path="/immobilisations/:id" element={<FixedAssetDetailPage />} />
            <Route path="/tva" element={<VatPage />} />
            <Route path="/liasse" element={<LiassePage />} />
            <Route path="/flux-tresorerie" element={<CashFlowPage />} />
            <Route path="/analyse-financiere" element={<FinancialAnalysisPage />} />
            <Route path="/resultat-fiscal" element={<ResultatFiscalPage />} />
            <Route path="/assistant" element={<AssistantPage />} />
            <Route path="/assistant/parametres" element={<AssistantSettingsPage />} />
            <Route path="/parametres" element={<SettingsPage />} />
          </Routes>
        </AppShell>
      </AppProvider>
    </PreferencesProvider>
  );
}
