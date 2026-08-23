import { useLocation, useNavigate } from "react-router-dom";

export type HotelTab = "todo" | "done" | "profile";

const TASK_TABS: HotelTab[] = ["todo", "done"];

function isTaskTab(t: HotelTab) {
  return TASK_TABS.includes(t);
}

/** 酒店顶部导航的唯一定义——HotelHomePage 和其它酒店专属子页面都从这里取，
 * 道理跟 CoordinatorTopNav 一样：同一角色不管在哪个页面导航条都长一样。 */
export function HotelTopNav({ activeTab, onSelectTab }: { activeTab?: HotelTab; onSelectTab?: (t: HotelTab) => void }) {
  const navigate = useNavigate();
  const location = useLocation();
  const onHome = location.pathname === "/hotel/home";
  const tasksActive = activeTab ? isTaskTab(activeTab) : false;
  const profileActive = activeTab === "profile";

  function go(defaultTab: HotelTab, alreadyActive: boolean) {
    if (onHome && onSelectTab) {
      if (!alreadyActive) onSelectTab(defaultTab);
    } else {
      navigate("/hotel/home", { state: { tab: defaultTab } });
    }
  }

  return (
    <>
      <button type="button" className={`topbar-nav-link${tasksActive ? " topbar-nav-link-active" : ""}`} onClick={() => go("todo", tasksActive)}>
        Tasks
      </button>
      <button type="button" className={`topbar-nav-link${profileActive ? " topbar-nav-link-active" : ""}`} onClick={() => go("profile", profileActive)}>
        Hotel profile
      </button>
    </>
  );
}
