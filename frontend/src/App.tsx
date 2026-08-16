import { Route, Routes } from 'react-router-dom';
import { AppShell } from './components/layout/AppShell';
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

export default function App() {
  return (
    <AppShell>
      <Routes>
        <Route path="/" element={<JournalEntriesPage />} />
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
      </Routes>
    </AppShell>
  );
}
