import "./MTabBar.css";

export type MTabItem = {
  key: string;
  label: string;
  icon: string;
  active: boolean;
  onClick: () => void;
};

export function MTabBar({ items }: { items: MTabItem[] }) {
  return (
    <nav className="m-tabbar" aria-label="Mobile navigation">
      {items.map((item) => (
        <button key={item.key} type="button" className={item.active ? "active" : ""} onClick={item.onClick}>
          <i aria-hidden="true">{item.icon}</i>
          <span>{item.label}</span>
        </button>
      ))}
    </nav>
  );
}
