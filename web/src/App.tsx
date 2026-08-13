import { Routes, Route, useLocation, Navigate } from 'react-router-dom'
import { AuthProvider } from '@/context/AuthContext'
import { BrandProvider } from '@/context/BrandContext'
import { ToastProvider } from '@/components/ui/toast'
import { ErrorBoundary } from '@/components/ErrorBoundary'
import { Navbar } from '@/components/layout/Navbar'
import { Footer } from '@/components/layout/Footer'
import { ListingsPage } from '@/pages/ListingsPage'
import { ListingProfilePage } from '@/pages/ListingProfilePage'
import { AgentProfilePage } from '@/pages/AgentProfilePage'
import { AgentRegisterPage } from '@/pages/AgentRegisterPage'
import { AgentDashboardPage } from '@/pages/AgentDashboardPage'
import { AgentPricingPage } from '@/pages/AgentPricingPage'
import { AgencyPricingPage } from '@/pages/AgencyPricingPage'
import { InboxPage } from '@/pages/InboxPage'
import { TasksPage } from '@/pages/TasksPage'
import { ContactsPage } from '@/pages/ContactsPage'
import { ContactDetailPage } from '@/pages/ContactDetailPage'
import { OpportunitiesPage } from '@/pages/OpportunitiesPage'
import { CrmAnalyticsPage } from '@/pages/CrmAnalyticsPage'
import { CampaignsPage } from '@/pages/CampaignsPage'
import { CampaignBuilderPage } from '@/pages/CampaignBuilderPage'
import { LoginPage } from '@/pages/LoginPage'
import { ForgotPasswordPage } from '@/pages/ForgotPasswordPage'
import { ResetPasswordPage } from '@/pages/ResetPasswordPage'
import { AccountRecoveryPage } from '@/pages/AccountRecoveryPage'
import { AccountRecoveryCompletePage } from '@/pages/AccountRecoveryCompletePage'
import { AgencyManagementPage } from '@/pages/AgencyManagementPage'
import { WhiteLabelBuilderPage } from '@/pages/WhiteLabelBuilderPage'
import { WidgetBuilderPage } from '@/pages/WidgetBuilderPage'
import { IntegrationSettingsPage } from '@/pages/IntegrationSettingsPage'
import { SocialChannelsPage } from '@/pages/SocialChannelsPage'
import { CommandCenterPage } from '@/pages/CommandCenterPage'
import { RoutingSettingsPage } from '@/pages/RoutingSettingsPage'
import { MessageTemplatesPage } from '@/pages/MessageTemplatesPage'
import { AdminWhatsAppListingsPage } from '@/pages/admin/whatsapp-listings/AdminWhatsAppListingsPage'
import { AgencyWhatsAppListingsPage } from '@/pages/agency/whatsapp-listings/AgencyWhatsAppListingsPage'
import { AgentWhatsAppListingsPage } from '@/pages/agent/whatsapp-listings/AgentWhatsAppListingsPage'
import { AdminAreasPage } from '@/pages/admin/areas/AdminAreasPage'
import { AdminScoringPage } from '@/pages/admin/scoring/AdminScoringPage'
import { PricingAdminPage } from '@/pages/admin/pricing/PricingAdminPage'
import { InspectorPage } from '@/pages/inspector/InspectorPage'
import { AreaProfilePage } from '@/pages/AreaProfilePage'
import { PublicAgencyPage } from '@/pages/PublicAgencyPage'
import { PublicAgentPortfolioPage } from '@/pages/PublicAgentPortfolioPage'
import { PublicWhiteLabelSitePage } from '@/pages/PublicWhiteLabelSitePage'
import { PublicWhiteLabelPropertyPage } from '@/pages/PublicWhiteLabelPropertyPage'
import { TermsPage } from '@/pages/TermsPage'
import { PrivacyPage } from '@/pages/PrivacyPage'

function AppShell() {
  const location = useLocation()
  const isBrandedSite = location.pathname.startsWith('/site/')

  return (
    <div className="flex min-h-screen flex-col">
      {!isBrandedSite && <Navbar />}
      <main className="flex-1">
        <Routes>
          <Route path="/" element={<Navigate to="/dashboard" replace />} />
          <Route path="/dashboard" element={<AgentDashboardPage />} />
          <Route path="/listings" element={<ListingsPage />} />
          <Route path="/listings/:id" element={<ListingProfilePage />} />
          <Route path="/agent/:id" element={<AgentProfilePage />} />
          <Route path="/register" element={<AgentRegisterPage />} />
          <Route path="/agent/pricing" element={<AgentPricingPage />} />
          <Route path="/dashboard/inbox" element={<InboxPage />} />
          <Route path="/tasks" element={<TasksPage />} />
          <Route path="/contacts" element={<ContactsPage />} />
          <Route path="/contacts/:id" element={<ContactDetailPage />} />
          <Route path="/opportunities" element={<OpportunitiesPage />} />
          <Route path="/analytics/crm" element={<CrmAnalyticsPage />} />
          <Route path="/campaigns" element={<CampaignsPage />} />
          <Route path="/campaigns/new" element={<CampaignBuilderPage />} />
          <Route path="/message-templates" element={<MessageTemplatesPage />} />
          <Route path="/login" element={<LoginPage />} />
          <Route path="/forgot-password" element={<ForgotPasswordPage />} />
          <Route path="/reset-password" element={<ResetPasswordPage />} />
          <Route path="/account-recovery" element={<AccountRecoveryPage />} />
          <Route path="/account-recovery/complete" element={<AccountRecoveryCompletePage />} />
          <Route path="/agency" element={<AgencyManagementPage />} />
          <Route path="/agency/pricing" element={<AgencyPricingPage />} />
          <Route path="/white-label" element={<WhiteLabelBuilderPage />} />
          <Route path="/widgets" element={<WidgetBuilderPage />} />
          <Route path="/integrations" element={<IntegrationSettingsPage />} />
          <Route path="/settings/channels" element={<SocialChannelsPage />} />
          <Route path="/settings/routing" element={<RoutingSettingsPage />} />
          <Route path="/command-center" element={<CommandCenterPage />} />
          <Route path="/operations" element={<CommandCenterPage />} />
          <Route path="/admin/whatsapp-listings" element={<AdminWhatsAppListingsPage />} />
          <Route path="/admin/areas" element={<AdminAreasPage />} />
          <Route path="/admin/scoring" element={<AdminScoringPage />} />
          <Route path="/admin/pricing" element={<PricingAdminPage />} />
          <Route path="/agency/whatsapp-listings" element={<AgencyWhatsAppListingsPage />} />
          <Route path="/agent/whatsapp-listings" element={<AgentWhatsAppListingsPage />} />
          <Route path="/areas/:slug" element={<AreaProfilePage />} />
          <Route path="/inspector" element={<InspectorPage />} />
          <Route path="/public/agency/:id" element={<PublicAgencyPage />} />
          <Route path="/public/agent/:id" element={<PublicAgentPortfolioPage />} />
          <Route path="/site/:subdomain" element={<PublicWhiteLabelSitePage />} />
          <Route path="/site/:subdomain/property/:propertyId" element={<PublicWhiteLabelPropertyPage />} />
          <Route path="/terms" element={<TermsPage />} />
          <Route path="/privacy" element={<PrivacyPage />} />
          <Route path="*" element={<Navigate to="/dashboard" replace />} />
        </Routes>
      </main>
      {!isBrandedSite && <Footer />}
    </div>
  )
}

function App() {
  return (
    <ErrorBoundary>
      <BrandProvider>
        <ToastProvider>
          <AuthProvider>
            <AppShell />
          </AuthProvider>
        </ToastProvider>
      </BrandProvider>
    </ErrorBoundary>
  )
}

export default App
