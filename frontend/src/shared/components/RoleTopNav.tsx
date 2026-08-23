import { NavLink } from "react-router-dom";
import { CoordinatorTopNav } from "./CoordinatorTopNav";
import { HotelTopNav } from "./HotelTopNav";
import { getNavLinksForRole } from "./navLinks";

/** 三端共用的详情页(案件会话、方案选择)用这个代替各自硬编码一份导航——
 * 保证不管从哪个角色进来，看到的导航条都跟该角色自己主页上那条完全一样。 */
export function RoleTopNav({ role }: { role: string }) {
  if (role === "coordinator") return <CoordinatorTopNav />;
  if (role === "hotel") return <HotelTopNav />;
  return (
    <>
      {getNavLinksForRole(role)
        .filter((l) => l.label !== "Profile")
        .map((link) => (
          <NavLink
            key={link.to}
            to={link.to}
            className={({ isActive }) => `topbar-nav-link${isActive ? " topbar-nav-link-active" : ""}`}
          >
            {link.label}
          </NavLink>
        ))}
    </>
  );
}
