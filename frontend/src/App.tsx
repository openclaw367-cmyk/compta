import { Navigate, Route, Routes } from 'react-router-dom';
import { AppShell } from './components/layout/AppShell';
import { RequireAuth } from './components/auth/RequireAuth';
import { AppProvider } from './context/AppProvider';
import { AuthProvider } from './context/AuthProvider';
import { ToastProvider } from './context/ToastProvider';
import { PreferencesProvider } from './context/PreferencesProvider';
import { usePreferences } from './context/preferencesStore';
import { LoginPage } from './pages/LoginPage';
import { SignupPage } from './pages/SignupPage';
import { ForgotPasswordPage } from './pages/ForgotPasswordPage';
import { ResetPasswordPage } from './pages/ResetPasswordPage';
import { AcceptInvitePage } from './pages/AcceptInvitePage';
import { MembersPage } from './pages/MembersPage';
import { DashboardPage } from './pages/DashboardPage';
import { JournalEntriesPage } from './pages/JournalEntriesPage';
import { InvoicingPage } from './pages/InvoicingPage';
import { BatchInvoiceQueuePage } from './pages/BatchInvoiceQueuePage';
import { RecurringTemplatesPage } from './pages/RecurringTemplatesPage';
import { AnomaliesPage } from './pages/AnomaliesPage';
import { FiscalYearsPage } from './pages/FiscalYearsPage';
import { CompanyProfilePage } from './pages/CompanyProfilePage';
import { AccountsJournalsPage } from './pages/AccountsJournalsPage';
import { TiersPage } from './pages/TiersPage';
import { GrandLivrePage } from './pages/GrandLivrePage';
import { ImportExcelPage } from './pages/ImportExcelPage';
import { FecImportPage } from './pages/FecImportPage';
import { BankReconciliationPage } from './pages/BankReconciliationPage';
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
import { CreateCompanyPage } from './pages/CreateCompanyPage';

/** "/" redirects to whatever screen the user picked as their default
 * landing screen (see SettingsPage's "Écran de démarrage") — Dashboard
 * itself keeps a stable, always-reachable route at /tableau-de-bord so
 * changing the default never makes it unreachable. */
function HomeRedirect() {
  const { defaultLandingRoute } = usePreferences();
  return <Navigate to={defaultLandingRoute} replace />;
}

/**
 * Auth screens (login/signup/forgot-reset-password/accept-invite) render
 * standalone, with no AppShell chrome and no company/fiscal-year
 * context — see CLAUDE.md "Multi-user / roles & permissions". Every
 * other route is nested inside <RequireAuth><AppProvider>, in that
 * order: RequireAuth gates on session status FIRST, so AppProvider's own
 * GET /companies / GET /fiscal-years queries structurally never fire
 * before auth resolves (they simply don't mount until then).
 */
export default function App() {
  return (
    <PreferencesProvider>
      <AuthProvider>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route path="/signup" element={<SignupPage />} />
          <Route path="/mot-de-passe-oublie" element={<ForgotPasswordPage />} />
          <Route path="/reinitialiser-mot-de-passe" element={<ResetPasswordPage />} />
          <Route path="/invitation" element={<AcceptInvitePage />} />
          <Route
            path="/*"
            element={
              <RequireAuth>
                <AppProvider>
                  <ToastProvider>
                    <AppShell>
                      <Routes>
                        <Route path="/" element={<HomeRedirect />} />
                        <Route path="/tableau-de-bord" element={<DashboardPage />} />
                        <Route path="/ecritures" element={<JournalEntriesPage />} />
                        <Route path="/factures" element={<InvoicingPage />} />
                        <Route path="/factures/lot" element={<BatchInvoiceQueuePage />} />
                        <Route path="/modeles" element={<RecurringTemplatesPage />} />
                        <Route path="/anomalies" element={<AnomaliesPage />} />
                        <Route path="/exercices" element={<FiscalYearsPage />} />
                        <Route path="/tiers" element={<TiersPage />} />
                        <Route path="/comptes" element={<AccountsJournalsPage />} />
                        <Route path="/societe" element={<CompanyProfilePage />} />
                        <Route path="/grand-livre" element={<GrandLivrePage />} />
                        <Route path="/import" element={<ImportExcelPage />} />
                        <Route path="/import-fec" element={<FecImportPage />} />
                        <Route path="/rapprochement-bancaire" element={<BankReconciliationPage />} />
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
                        <Route path="/parametres/nouvelle-societe" element={<CreateCompanyPage />} />
                        <Route path="/parametres/membres" element={<MembersPage />} />
                      </Routes>
                    </AppShell>
                  </ToastProvider>
                </AppProvider>
              </RequireAuth>
            }
          />
        </Routes>
      </AuthProvider>
    </PreferencesProvider>
  );
}
