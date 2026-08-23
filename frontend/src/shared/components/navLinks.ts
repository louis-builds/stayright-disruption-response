import type { TopNavLink } from "./TopBar";

/** 客人端一级导航：首页/待办/我的预订/个人（常驻，跨页面一致）。 */
const GUEST_NAV_LINKS: TopNavLink[] = [
  { label: "Home", to: "/guest/home" },
  { label: "My Bookings", to: "/bookings" },
  { label: "Profile", to: "/profile" },
];

/** 协调员/酒店端首页在后续任务里实现，这里先给个最小导航（首页+个人），保持框架统一。 */
const COORDINATOR_NAV_LINKS: TopNavLink[] = [
  { label: "Home", to: "/coordinator/home" },
  { label: "Bad cases", to: "/coordinator/bad-cases" },
  { label: "Profile", to: "/profile" },
];

const HOTEL_NAV_LINKS: TopNavLink[] = [
  { label: "Home", to: "/hotel/home" },
  { label: "Profile", to: "/profile" },
];

export function getNavLinksForRole(role: string | undefined): TopNavLink[] {
  switch (role) {
    case "guest":
      return GUEST_NAV_LINKS;
    case "coordinator":
      return COORDINATOR_NAV_LINKS;
    case "hotel":
      return HOTEL_NAV_LINKS;
    default:
      return [];
  }
}
