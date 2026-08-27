import { useLocation, useNavigate } from "react-router-dom";

export type CoordinatorTab =
  | "overview"
  | "disruptions"
  | "queue"
  | "todo"
  | "in_progress"
  | "closed"
  | "search"
  | "admin"
  | "kb"
  | "bad_cases"
  | "settings";

export interface CoordinatorNavGroup {
  navLabel: string;
  defaultTab: CoordinatorTab;
  tabs: { key: CoordinatorTab; label: string }[];
}

/** 协调员顶部导航的唯一定义——CoordinatorHomePage 和其它协调员专属子页面(P8 升级台、方案后台)
 * 都从这里取，保证同一个角色不管在哪个页面导航条都长一样，不是每页各画一套。 */
export const COORDINATOR_NAV_GROUPS: CoordinatorNavGroup[] = [
  { navLabel: "Dashboard", defaultTab: "overview", tabs: [{ key: "overview", label: "Dashboard" }] },
  { navLabel: "Disruptions", defaultTab: "disruptions", tabs: [{ key: "disruptions", label: "Disruptions" }] },
  { navLabel: "Tasks", defaultTab: "queue", tabs: [
    { key: "queue", label: "Needs attention" },
    { key: "todo", label: "My to-dos" },
    { key: "in_progress", label: "My in-progress" },
    { key: "closed", label: "Closed" },
    { key: "search", label: "All" },
  ] },
];

export function coordinatorGroupForTab(t: CoordinatorTab): CoordinatorNavGroup | undefined {
  return COORDINATOR_NAV_GROUPS.find((g) => g.tabs.some((x) => x.key === t));
}

/** activeTab: 当前页面对应的子页签，用来算高亮哪个顶部分组。
 * onSelectTab: 只有在 /coordinator/home 自己身上才用得到(直接切内部 state，不用整页跳转)；
 * 别的协调员页面不传这个，点导航项会带着目标 tab 跳回 /coordinator/home 重新挂载。 */
export function CoordinatorTopNav({ activeTab, onSelectTab }: { activeTab?: CoordinatorTab; onSelectTab?: (t: CoordinatorTab) => void }) {
  const navigate = useNavigate();
  const location = useLocation();
  const onHome = location.pathname === "/coordinator/home";
  const activeGroup = activeTab ? coordinatorGroupForTab(activeTab) : undefined;

  return (
    <>
      {COORDINATOR_NAV_GROUPS.map((g) => (
        <button
          key={g.navLabel}
          type="button"
          className={`topbar-nav-link${activeGroup === g ? " topbar-nav-link-active" : ""}`}
          onClick={() => {
            if (onHome && onSelectTab) {
              if (activeGroup !== g) onSelectTab(g.defaultTab);
            } else {
              navigate("/coordinator/home", { state: { tab: g.defaultTab } });
            }
          }}
        >
          {g.navLabel}
        </button>
      ))}
    </>
  );
}
