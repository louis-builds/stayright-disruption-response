import "./Footer.css";

/** 常见问题.txt 要求：页脚压缩布局，含邮箱和手机联系方式。 */
export function Footer() {
  return (
    <footer className="app-footer">
      <span>© {new Date().getFullYear()} Travel Disruption Agent</span>
      <span className="app-footer-contact">
        <a href="mailto:support@traveldisruption.example">support@traveldisruption.example</a>
        <span aria-hidden="true">·</span>
        <a href="tel:+6448000000">+64 4 800 0000</a>
      </span>
    </footer>
  );
}
