import type { ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { TopBar, type TopNavLink } from "./TopBar";
import { AvatarMenu } from "./AvatarMenu";
import { Footer } from "./Footer";
import { NotificationBell } from "../../features/notifications";
import "./AppShell.css";

interface AppShellProps {
  title?: string;
  navLinks?: TopNavLink[];
  centerContent?: ReactNode;
  /** true = navigate(-1)(回浏览器历史上一页); 传函数 = 用这个当点击处理器，
   * 用在"上一页到底是哪不好说、但这页该回哪个列表是确定的"这种页面(比如方案后台该固定回 Tasks 列表，
   * 不该看用户是从会话页还是列表点进来的、历史不一样就回到不同地方)。 */
  showBack?: boolean | (() => void);
  /** Optional layout class for pages that need a wider content canvas. */
  contentClassName?: string;
  children: ReactNode;
}

/** 登录后所有页面共用的框架：顶部导航(居中一级导航+铃铛+头像下拉) + 内容 + 页脚。
 * showBack: 从列表点进来的详情/表单页传 true，白色内容区顶部会出现一个"← Back"，点了就 navigate(-1) 回列表——
 * 故意不放进深色导航条里，导航条不管有没有 back 都长一个样，不会跟着页面变。
 * centerContent: 页面自己有一组内部 tab（不是路由）需要跟顶部导航合并展示时传这个，见 CoordinatorHomePage。 */
export function AppShell({ title, navLinks, centerContent, showBack, contentClassName, children }: AppShellProps) {
  const navigate = useNavigate();
  return (
    <div className="app-shell">
      <TopBar
        title={title}
        navLinks={navLinks}
        centerContent={centerContent}
        right={
          <>
            <NotificationBell />
            <AvatarMenu />
          </>
        }
      />
      <main className={`app-shell-content${contentClassName ? ` ${contentClassName}` : ""}`}>
        {showBack && (
          <button
            type="button"
            className="app-shell-back-btn"
            onClick={typeof showBack === "function" ? showBack : () => navigate(-1)}
            aria-label="Back"
          >
            ← Back
          </button>
        )}
        {children}
      </main>
      <Footer />
    </div>
  );
}
