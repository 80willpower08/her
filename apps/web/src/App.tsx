import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { useAuth } from '@/lib/auth';
import { LoginPage } from '@/pages/LoginPage';
import { TodayPage } from '@/pages/TodayPage';
import { ListPage } from '@/pages/ListPage';
import { GoalsPage } from '@/pages/GoalsPage';
import { OverviewPage } from '@/pages/OverviewPage';
import { PatternsPage } from '@/pages/PatternsPage';
import { AgentPage } from '@/pages/AgentPage';
import { SettingsPage } from '@/pages/SettingsPage';
import { ShareReceivePage } from '@/pages/ShareReceivePage';
import { InboxPage } from '@/pages/InboxPage';
import { AboutMePage } from '@/pages/AboutMePage';
import { ChatPage } from '@/pages/ChatPage';
import { ProjectsPage } from '@/pages/ProjectsPage';
import { PlanPage } from '@/pages/PlanPage';
import { DashboardPage } from '@/pages/DashboardPage';
import { Layout } from '@/components/Layout';

export function App() {
  const token = useAuth((s) => s.token);
  if (!token) return <LoginPage />;

  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Layout />}>
          <Route index element={<Navigate to="/today" replace />} />
          <Route path="today" element={<TodayPage />} />
          <Route path="plan" element={<PlanPage />} />
          <Route path="plan/:section" element={<PlanPage />} />
          <Route path="plan/:section/:id" element={<PlanPage />} />
          <Route path="chat" element={<ChatPage />} />
          <Route path="chat/:threadId" element={<ChatPage />} />
          <Route path="inbox" element={<InboxPage />} />
          <Route path="settings" element={<SettingsPage />} />
          <Route path="dashboard" element={<DashboardPage />} />
          {/* Deep-linkable / legacy routes — still reachable but not in nav */}
          <Route path="all" element={<ListPage />} />
          <Route path="goals" element={<GoalsPage />} />
          <Route path="overview" element={<OverviewPage />} />
          <Route path="patterns" element={<PatternsPage />} />
          <Route path="agent" element={<AgentPage />} />
          <Route path="about-me" element={<AboutMePage />} />
          <Route path="projects" element={<ProjectsPage />} />
          <Route path="projects/:projectId" element={<ProjectsPage />} />
          <Route path="share-receive" element={<ShareReceivePage />} />
          <Route path="*" element={<Navigate to="/today" replace />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}
