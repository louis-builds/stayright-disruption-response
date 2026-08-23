import { useEffect, useRef, useState, type ReactNode } from "react";
import { NavLink } from "react-router-dom";
import "./TopBar.css";

export interface TopNavLink {
  label: string;
  to: string;
}

interface TopBarProps {
  title?: string;
  navLinks?: TopNavLink[];
  /** 页面自己的一组 tab 按钮(内部状态切换，不是路由)，和 navLinks 一起渲染在同一条导航里，
   * 传了这个就不再单独渲染 navLinks 生成的 <nav>——由调用方把两者拼到一起传进来。 */
  centerContent?: ReactNode;
  right?: ReactNode;
}

/** 登录后页面的顶部一级导航条：背景有一架小飞机循环飞过，导航链接居中（常见问题.txt 布局约定）。
 * 故意不接 back 按钮——不管页面是不是详情页，这条导航条都长一个样，back 放在下面白色内容区里。 */
export function TopBar({ title, navLinks, centerContent, right }: TopBarProps) {
  const navRef = useRef<HTMLElement>(null);
  const [overflowing, setOverflowing] = useState(false);

  // 只有真的塞不下、能横向滚动时才加右边渐隐提示；塞得下就别裁/别虚化，
  // 不然明明放得下的最后一项(比如 "System admin")看起来像被切掉了一样。
  useEffect(() => {
    const el = navRef.current;
    if (!el) return;
    const check = () => setOverflowing(el.scrollWidth > el.clientWidth + 1);
    check();
    const observer = new ResizeObserver(check);
    observer.observe(el);
    return () => observer.disconnect();
  }, [centerContent]);

  return (
    <header className="topbar">
      <div className="topbar-sky" aria-hidden="true">
        <span className="topbar-plane">✈</span>
      </div>
      <div className="topbar-content">
        {title && (
          <span className="topbar-title-group">
            <span className="topbar-title">{title}</span>
          </span>
        )}
        {centerContent ? (
          <nav ref={navRef} className={`topbar-nav topbar-nav-scroll${overflowing ? " topbar-nav-overflowing" : ""}`}>
            {centerContent}
          </nav>
        ) : (
          navLinks && navLinks.length > 0 && (
            <nav className="topbar-nav">
              {navLinks.map((link) => (
                <NavLink
                  key={link.to}
                  to={link.to}
                  className={({ isActive }) => `topbar-nav-link${isActive ? " topbar-nav-link-active" : ""}`}
                >
                  {link.label}
                </NavLink>
              ))}
            </nav>
          )
        )}
        <div className="topbar-right">{right}</div>
      </div>
    </header>
  );
}
