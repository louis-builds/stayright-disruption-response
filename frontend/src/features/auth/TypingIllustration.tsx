import "./TypingIllustration.css";

/** 脑图要求：登录页左侧一个人在动态敲键盘（动画）。纯 SVG + CSS，不引额外的插画/动画依赖。 */
export function TypingIllustration() {
  return (
    <svg className="typing-illustration" viewBox="0 0 300 260" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      {/* desk */}
      <rect x="30" y="190" width="240" height="10" rx="4" className="ti-desk" />
      {/* monitor */}
      <rect x="95" y="90" width="110" height="78" rx="6" className="ti-monitor-frame" />
      <rect x="103" y="98" width="94" height="60" rx="3" className="ti-screen" />
      <rect x="140" y="168" width="20" height="14" className="ti-monitor-frame" />
      <rect x="125" y="180" width="50" height="8" rx="3" className="ti-monitor-frame" />
      {/* screen content: blinking status line */}
      <rect x="110" y="106" width="46" className="ti-screen-line ti-screen-line-1" height="5" rx="2" />
      <rect x="110" y="118" width="60" className="ti-screen-line ti-screen-line-2" height="5" rx="2" />
      <rect x="110" y="130" width="36" className="ti-screen-line ti-screen-line-3" height="5" rx="2" />

      {/* chair */}
      <rect x="140" y="205" width="20" height="35" rx="3" className="ti-chair" />

      {/* person: head + body */}
      <circle cx="150" cy="140" r="16" className="ti-person" />
      <path d="M120 200 C120 168 132 156 150 156 C168 156 180 168 180 200 Z" className="ti-person" />

      {/* keyboard */}
      <rect x="108" y="200" width="84" height="16" rx="3" className="ti-keyboard" />

      {/* animated hands/arms typing */}
      <g className="ti-hand ti-hand-left">
        <rect x="122" y="192" width="9" height="20" rx="4" className="ti-arm" />
      </g>
      <g className="ti-hand ti-hand-right">
        <rect x="169" y="192" width="9" height="20" rx="4" className="ti-arm" />
      </g>
    </svg>
  );
}
