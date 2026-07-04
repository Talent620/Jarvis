import {
  LayoutDashboard,
  Users,
  KanbanSquare,
  Megaphone,
  Sparkles,
  LibraryBig,
  CheckSquare,
  BadgeCheck,
  BarChart3,
  Bot,
  Settings,
  Magnet,
  Radar,
  PhoneCall,
  Share2,
  type LucideIcon,
} from "lucide-react";

export interface NavItem {
  label: string;
  href: string;
  icon: LucideIcon;
}

export const NAV_GROUPS: { heading: string; items: NavItem[] }[] = [
  {
    heading: "Workspace",
    items: [
      { label: "Dashboard", href: "/dashboard", icon: LayoutDashboard },
      { label: "Leads", href: "/leads", icon: Users },
      { label: "Pipeline", href: "/pipeline", icon: KanbanSquare },
      { label: "Calls", href: "/calls", icon: PhoneCall },
      { label: "Tasks", href: "/tasks", icon: CheckSquare },
    ],
  },
  {
    heading: "Acquisition",
    items: [
      { label: "Lead Finder", href: "/prospecting", icon: Radar },
      { label: "Autopilot", href: "/acquisition", icon: Magnet },
      { label: "Social Studio", href: "/social", icon: Share2 },
      { label: "Campaigns", href: "/campaigns", icon: Megaphone },
      { label: "Generator", href: "/generator", icon: Sparkles },
      { label: "Templates", href: "/templates", icon: LibraryBig },
      { label: "Approvals", href: "/approvals", icon: BadgeCheck },
    ],
  },
  {
    heading: "Intelligence",
    items: [
      { label: "Analytics", href: "/analytics", icon: BarChart3 },
      { label: "AI Copilot", href: "/copilot", icon: Bot },
      { label: "Settings", href: "/settings", icon: Settings },
    ],
  },
];

export const NAV_FLAT: NavItem[] = NAV_GROUPS.flatMap((g) => g.items);
