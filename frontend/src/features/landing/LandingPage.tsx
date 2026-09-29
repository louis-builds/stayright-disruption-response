import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "../auth";
import { useMobileLayout } from "../../shared/layout/MobileLayoutProvider";
import { loginPath } from "../../shared/layout/mobileLayout";
import "./LandingPage.css";

type IconName = "signal" | "spark" | "route" | "traveller" | "hotel" | "coordinator" | "check";

function LandingIcon({ name }: { name: IconName }) {
  const paths: Record<IconName, React.ReactNode> = {
    signal: <><path d="M4 17.5A9.5 9.5 0 0 1 13.5 8"/><path d="M4 12.5A4.5 4.5 0 0 1 8.5 8"/><circle cx="4" cy="8" r="1.4"/></>,
    spark: <><path d="m12 3 1.3 4.2L17.5 8.5l-4.2 1.3L12 14l-1.3-4.2-4.2-1.3 4.2-1.3L12 3Z"/><path d="m18 14 .7 2.3L21 17l-2.3.7L18 20l-.7-2.3L15 17l2.3-.7L18 14Z"/></>,
    route: <><circle cx="5" cy="17" r="2"/><circle cx="19" cy="7" r="2"/><path d="M7 17h3.5a2.5 2.5 0 0 0 0-5H9a2.5 2.5 0 0 1 0-5h8"/></>,
    traveller: <><circle cx="12" cy="7" r="3"/><path d="M5.5 21a6.5 6.5 0 0 1 13 0"/></>,
    hotel: <><path d="M5 21V4h11v17M8 8h1m3 0h1M8 12h1m3 0h1M8 16h1m3 0h1M3 21h18"/><path d="M16 10h3v11"/></>,
    coordinator: <><path d="M4 6h16M7 3v6m10-6v6M4 14h16m-7-3v6"/><circle cx="8" cy="14" r="2"/><circle cx="16" cy="6" r="2"/></>,
    check: <path d="m5 12 4 4L19 6"/>,
  };
  return <svg viewBox="0 0 24 24" aria-hidden="true">{paths[name]}</svg>;
}

const workflowSteps = [
  { eyebrow: "Detect", title: "Detect a disruption signal", body: "Weather, flight and road signals are monitored against the places where travellers are due to stay.", actor: "StayRight AI", meta: "Live signal monitoring" },
  { eyebrow: "Match", title: "Find the bookings at risk", body: "The AI matches the disruption area and time window to real booking dates and hotel locations.", actor: "StayRight AI", meta: "Location + date matching" },
  { eyebrow: "Coordinate", title: "Create the case and contact the hotel", body: "A connected case is opened automatically, the relevant policy is read and an availability enquiry is sent to the hotel.", actor: "StayRight AI", meta: "Case and policy context" },
  { eyebrow: "Verify", title: "Hotel confirms what is available", body: "The hotel reviews defer and alternative-stay requests, then confirms which recovery choices can genuinely be offered.", actor: "Hotel partner", meta: "Human availability check" },
  { eyebrow: "Prepare", title: "AI assembles verified choices", body: "Confirmed hotel responses and refund policy are turned into three clear, comparable recovery options for the traveller.", actor: "StayRight AI", meta: "Policy-grounded options" },
  { eyebrow: "Choose", title: "Traveller chooses the best outcome", body: "The traveller reviews the verified choices, asks questions if needed and submits one final selection.", actor: "Traveller", meta: "One informed decision" },
  { eyebrow: "Resolve", title: "Execute, notify and close the case", body: "Hotel changes are synchronized, everyone is notified and the booking is updated. Refunds are confirmed by a coordinator before payment.", actor: "Connected workflow", meta: "Auditable completion" },
];

function WorkflowVisual({ step }: { step: number }) {
  if (step === 0) return (
    <div className="workflow-map" aria-label="Illustrative map of New Zealand disruption monitoring">
      <div className="workflow-map-label"><span>LIVE DETECTION</span><strong>New Zealand signal monitor</strong></div>
      <svg viewBox="0 0 560 360" role="img" aria-label="New Zealand map with a disruption near Queenstown">
        <defs><linearGradient id="nz-land" x1="0" y1="0" x2="1" y2="1"><stop stopColor="#25365c"/><stop offset="1" stopColor="#1b2847"/></linearGradient></defs>
        <path className="nz-coast" d="M302.3 175.8L320.1 168.2L321.3 168L316.9 175.6L321.7 171.3L321.2 169.7L327.7 170.2L322 175L329.1 172L329.1 173.8L322.7 179L324.6 181.8L323 184.2L327.3 185.6L325.8 188L311.5 202.3L304.5 212.1L291.8 218.4L294.1 220.2L289.7 222.5L293.2 222.1L295.7 225.9L301.4 227.1L301.8 230.7L289.2 230.7L290.9 229.2L288.7 228.2L284.7 231.2L279.2 227.6L282.2 231.8L262.2 239.7L263.7 240.5L260.1 253.5L257 253.5L259.9 254.9L259.4 256.2L250.6 270L252.2 274L242.8 276.6L228.9 288.6L216.3 290.3L201 289.8L196.8 284.6L189.4 284.6L182.9 280L179.3 282L167.8 281.6L165.2 279.7L169.6 275.9L165.6 277.9L163.9 277.7L165.4 274.4L160.6 276L161 272.8L171.5 270.6L167.1 269.2L171.2 266.8L165.7 267L166.7 264.2L169.7 264.1L168.6 262.1L174.7 264.2L173.9 262.2L176.3 261.6L172.1 260.2L172 258L177 257.2L175.1 255.3L180.2 251.7L181.4 254.5L181.8 250.5L188.2 246.7L190.9 248.2L189.7 244.7L200.6 235.8L215.6 231.1L218 232.1L217.8 229.2L232 224.1L232.6 221.7L240.7 216.1L244.1 216.5L242.1 214.9L245.4 213.4L248.7 214.6L246.8 212.8L249.8 211.8L251.3 213.2L251.5 211L256.4 206.6L257.8 209.6L257.6 206.1L263.7 201L262.4 199.8L267.4 186.8L277.3 181.3L284.2 164.6L292.1 159.5L298.6 159.5L294.1 160L293.5 162.7L294.8 165L299.6 166.6L302.3 175.8ZM319.4 166.9L316.5 168.1L317.2 165.4L320.4 163.7L319.4 166.9ZM166 269.4L165.6 271L161.4 270.4L166 269.4ZM171 259.2L171.9 261.8L169.1 260.5L171 259.2ZM195.9 295.3L193.7 296.8L198 297.8L198 299.7L182.6 303.7L188.5 296.2L188.2 291.8L191.9 291.7L195.9 295.3ZM354.2 68.8L354.4 69.9L350 67.5L350.9 64.5L354.2 68.8ZM305.6 40L309.4 38.1L309.9 40.3L323.4 44.5L324.3 47.8L328.1 46.7L332.8 53.9L333.6 58.2L329.7 58.5L338.4 69.4L337.3 73.3L338.7 75.9L336.7 80.8L349 84.1L350.8 88.6L354.2 88.5L353 77.6L350.9 74.7L352.5 73L357.2 78.8L359.1 78.5L366.3 98L391.3 105.5L397.3 103.4L407 96.1L418.3 99L415.2 104.7L412.5 117.4L406.3 121.1L404.8 132.1L402.2 129.4L396.6 128.6L387 131.7L384.4 134.9L384.1 138.9L387.8 141.4L382 151.8L363.6 174.4L349.2 182.9L346.1 178.7L340.1 178.9L339.7 174.6L337.4 176.8L334.8 176L346.1 161.7L348 154.6L345.9 150.9L342.8 147.4L319.8 137.9L316.1 133.8L317.9 130L329.7 126.2L334 122.4L336.5 110.4L339.2 106.1L338.4 103.4L341.1 101.4L336.8 93.8L337.6 91.5L333.7 86.3L336.9 88.8L341.1 86L337.9 83L331.4 83L325.2 73.3L329.8 75.7L329.6 67.9L322 65.4L319.4 60.8L324.8 69.8L322.4 70.5L308.6 53L313.2 48.2L307.9 52.1L306.5 50.9L302.3 45.8L303.9 41.7L293.5 29.7L300.7 29.2L299 31.5L305.6 40Z" fill="url(#nz-land)"/>
        <circle className="workflow-radar radar-outer" cx="207" cy="256" r="72"/><circle className="workflow-radar radar-inner" cx="207" cy="256" r="41"/><circle className="workflow-hotspot" cx="207" cy="256" r="8"/>
        <g className="workflow-city"><circle cx="337.5" cy="81" r="4"/><text x="349.5" y="86">Auckland</text></g>
        <g className="workflow-city"><circle cx="337.8" cy="175.9" r="4"/><text x="349.8" y="180.9">Wellington</text></g>
        <g className="workflow-city"><circle cx="292" cy="224" r="4"/><text x="304" y="229">Christchurch</text></g>
        <g className="workflow-city active"><circle cx="207" cy="256" r="5"/><text x="219" y="261">Queenstown</text></g>
      </svg>
      <div className="workflow-map-readout"><span><i/>Severe storm signal</span><strong>30 km impact radius</strong></div>
    </div>
  );

  if (step === 1) return <div className="workflow-match visual-stage"><div className="visual-stage-head"><span>IMPACT MATCHING</span><b>3 bookings matched</b></div><div className="match-event"><LandingIcon name="signal"/><span><small>DISRUPTION</small><strong>Queenstown severe storm</strong><em>9–10 September</em></span></div><div className="match-lines"><i/><i/><i/></div><div className="match-bookings"><article><small>CONF-2048</small><strong>Queenstown Lakeview</strong><span>9–12 Sept · In range</span></article><article><small>CONF-2184</small><strong>Alpine Suites</strong><span>10–13 Sept · In range</span></article><article><small>CONF-2217</small><strong>Harbour Hotel</strong><span>18–21 Sept · Not affected</span></article></div></div>;

  if (step === 2) return <div className="workflow-agent visual-stage"><div className="visual-stage-head"><span>AI CASE ORCHESTRATION</span><b>CASE-8821</b></div><div className="agent-case-summary"><span><LandingIcon name="spark"/></span><div><small>STAYRIGHT AI AGENT</small><strong>Recovery case created</strong><p>Booking, disruption and policy context connected.</p></div></div><div className="agent-actions"><div className="done"><i><LandingIcon name="check"/></i><span><strong>Read hotel policy</strong><small>Cancellation and date-change rules found</small></span></div><div className="done"><i><LandingIcon name="check"/></i><span><strong>Prepared availability enquiry</strong><small>Booking dates and guest requirements included</small></span></div><div className="active"><i><LandingIcon name="route"/></i><span><strong>Sent to hotel partner</strong><small>Awaiting verified availability</small></span><em>LIVE</em></div></div></div>;

  if (step === 3) return <div className="workflow-hotel visual-stage"><div className="visual-stage-head"><span>HOTEL WORKSPACE</span><b>Response required</b></div><div className="hotel-request"><header><span><small>CONF-2048 · ALICE</small><strong>Availability request</strong></span><em>HIGH PRIORITY</em></header><div className="hotel-request-grid"><span><small>CURRENT STAY</small><b>18–21 September</b></span><span><small>REQUEST</small><b>Defer or relocate</b></span><span><small>ROOM</small><b>Standard Queen</b></span></div><div className="hotel-offers"><article><div><small>DEFER STAY</small><strong>21–24 September</strong></div><button>Confirm available</button></article><article><div><small>ALTERNATIVE STAY</small><strong>Rotorua Thermal Hotel</strong></div><button>Confirm available</button></article></div></div></div>;

  if (step === 4) return <div className="workflow-options visual-stage"><div className="visual-stage-head"><span>AI-PREPARED RECOVERY</span><b>3 verified choices</b></div><div className="option-grid"><article><i>01</i><span><LandingIcon name="route"/></span><small>HOTEL CONFIRMED</small><strong>Defer stay</strong><p>Move the original booking to 21–24 September.</p></article><article><i>02</i><span><LandingIcon name="hotel"/></span><small>HOTEL CONFIRMED</small><strong>Alternative stay</strong><p>Move to a verified nearby partner property.</p></article><article><i>03</i><span><LandingIcon name="check"/></span><small>POLICY CHECKED</small><strong>Cancel &amp; refund</strong><p>NZD 540 estimated refund after confirmation.</p></article></div><div className="options-grounding"><LandingIcon name="spark"/><span><strong>Grounded by AI</strong> · Availability, hotel policy and booking details checked together</span></div></div>;

  if (step === 5) return <div className="workflow-guest visual-stage"><div className="visual-stage-head"><span>TRAVELLER WORKSPACE</span><b>Action required</b></div><div className="guest-choice"><div className="guest-choice-title"><span><LandingIcon name="traveller"/></span><div><small>RECOVERY OPTIONS READY</small><strong>Choose what works for your stay</strong></div></div><div className="guest-choice-list"><article><span><small>DEFER STAY</small><strong>21–24 September</strong></span><button>Choose</button></article><article className="selected"><span><small>ALTERNATIVE STAY</small><strong>Rotorua Thermal Hotel</strong></span><button><LandingIcon name="check"/> Selected</button></article><article><span><small>CANCEL &amp; REFUND</small><strong>NZD 540 estimated</strong></span><button>Choose</button></article></div><div className="guest-submit"><span>One final selection will be shared with the recovery team.</span><button>Submit choice</button></div></div></div>;

  return <div className="workflow-resolve visual-stage"><div className="visual-stage-head"><span>CONNECTED RESOLUTION</span><b>CASE CLOSED</b></div><div className="resolve-success"><span><LandingIcon name="check"/></span><div><small>RECOVERY COMPLETE</small><strong>Booking updated successfully</strong><p>Every participant now sees the same confirmed outcome.</p></div></div><div className="resolve-timeline"><article className="done"><i><LandingIcon name="check"/></i><span><strong>Hotel synchronized</strong><small>New stay confirmed</small></span></article><article className="done"><i><LandingIcon name="check"/></i><span><strong>Traveller notified</strong><small>Confirmation delivered</small></span></article><article className="done"><i><LandingIcon name="check"/></i><span><strong>Booking updated</strong><small>Dates and property saved</small></span></article><article className="done"><i><LandingIcon name="check"/></i><span><strong>Case resolved</strong><small>Audit history retained</small></span></article></div><div className="resolve-note">Refund path: coordinator verifies the amount before payment and closure.</div></div>;
}

const workspaces = [
  { id: "traveller" as const, icon: "traveller" as const, title: "Traveller", body: "Follow affected stays, review recovery choices and receive clear updates.", tone: "purple" },
  { id: "hotel" as const, icon: "hotel" as const, title: "Hotel partner", body: "Review impacted bookings and respond to availability requests quickly.", tone: "teal" },
  { id: "coordinator" as const, icon: "coordinator" as const, title: "Coordinator", body: "Focus on handoffs, exceptions and cases that genuinely need human judgement.", tone: "blue" },
];

type WorkspaceId = "traveller" | "hotel" | "coordinator";

function WorkspaceDemo({ active }: { active: WorkspaceId }) {
  return (
    <div className={`landing-product-demo ${active}`} role="tabpanel">
      <aside className="landing-demo-sidebar">
        <div className="landing-demo-logo"><i /> <strong>StayRight NZ</strong></div>
        {(active === "traveller" ? ["Dashboard", "My Bookings", "Profile settings"] : active === "hotel" ? ["My to-dos", "Done", "Hotel profile"] : ["Dashboard", "Disruptions", "Cases"]).map((item, index) => <span className={index === 0 ? "selected" : ""} key={item}>{item}</span>)}
      </aside>

      <div className="landing-demo-main">
        <div className="landing-demo-topbar">
          <div><small>{active === "traveller" ? "TRAVELLER" : active === "hotel" ? "HOTEL" : "COORDINATOR"} WORKSPACE</small><strong>{active === "hotel" ? "My to-dos" : "Dashboard"}</strong></div>
          <span>⌕ Search</span><b><i /> Online</b>
        </div>

        {active === "traveller" && <>
          <section className="landing-demo-welcome"><div><small>TRAVEL OVERVIEW</small><h3>Kia ora, Alice</h3><p>We are monitoring your upcoming stays and will alert you when something needs attention.</p></div><em>● Live monitoring</em></section>
          <div className="landing-demo-stats four">
            <article><small>UPCOMING STAYS</small><strong>3 Bookings</strong><p>2 protected</p></article>
            <article className="alert"><small>ACTION REQUIRED</small><strong>1 Open Case</strong><p>High priority</p></article>
            <article><small>UNREAD NOTICES</small><strong>2 Updates</strong><p>Recent notices</p></article>
            <article><small>NEXT CHECK-IN</small><strong>Tomorrow</strong><p>Queenstown</p></article>
          </div>
          <section className="landing-demo-panel traveller-list"><header><div><strong>Upcoming stays</strong><small>Your nearest active reservations</small></div><a>View all bookings →</a></header>
            <div><b>Queenstown Lakeview Hotel</b><span>18–21 Sept · Standard Queen</span><em>Action needed</em></div>
            <div><b>Rotorua Thermal Hotel</b><span>24–27 Sept · Standard Twin</span><em>Protected</em></div>
            <div><b>Auckland Harbour Hotel</b><span>2–5 Oct · Harbour King</span><em>Confirmed</em></div>
          </section>
        </>}

        {active === "hotel" && <>
          <section className="landing-demo-title"><small>LIVE QUEUE</small><h3>My to-dos</h3><p><i /> Synced just now</p></section>
          <div className="landing-demo-stats three">
            <article className="alert"><small>DISRUPTION REQUESTS</small><strong>5</strong><p>2 overdue</p></article>
            <article><small>GUEST SELECTIONS</small><strong>3</strong><p>Awaiting confirmation</p></article>
            <article><small>RETURNING GUESTS</small><strong>2</strong><p>Across queues</p></article>
          </div>
          <section className="landing-demo-panel hotel-list"><header><div><strong>Pending requests</strong><small>Bookings requiring a property response</small></div><a>5 requests</a></header>
            <div><span><b>CONF-2048 · Carol</b><small>Weather disruption · 18–21 Sept</small></span><em>HIGH VALUE</em><button>Confirm deferral</button></div>
            <div><span><b>CONF-2194 · Liam</b><small>Flight delay · 20–23 Sept</small></span><em>NEW</em><button>Review request</button></div>
            <div><span><b>CONF-2217 · Maya</b><small>Road closure · 22–25 Sept</small></span><em>OVERDUE</em><button>Respond</button></div>
          </section>
        </>}

        {active === "coordinator" && <>
          <section className="landing-demo-welcome"><div><small>OPERATIONS OVERVIEW</small><h3>Operations Analytics &amp; Intelligence</h3><p>Monitor workload, AI handoffs, hotel delays and resolution performance.</p></div><em>● Live data</em></section>
          <div className="landing-demo-stats four">
            <article className="attention"><small>REQUIRING ATTENTION</small><strong>12</strong><p>AI handoffs</p></article>
            <article><small>OVERDUE CASES</small><strong>3</strong><p>SLA exceeded</p></article>
            <article><small>WAITING FOR HOTEL</small><strong>8</strong><p>Follow-up required</p></article>
            <article><small>MY ACTIVE CASES</small><strong>6</strong><p>Assigned to you</p></article>
          </div>
          <div className="landing-demo-analytics">
            <section className="landing-demo-panel demo-chart"><header><div><strong>Case Workload Trend</strong><small>7-day distribution by operational phase</small></div></header><div className="demo-bars">{[42,58,76,66,88,54,72].map((height, index) => <span key={index} style={{ height: `${height}%` }}><i /><i /><i /></span>)}</div><div className="demo-days"><span>Wed</span><span>Thu</span><span>Fri</span><span>Sat</span><span>Sun</span><span>Mon</span><span>Tue</span></div></section>
            <section className="landing-demo-panel demo-reasons"><header><div><strong>Human Intervention Reasons</strong><small>Current AI handoff drivers</small></div></header><div><b>High-value guest review</b><span><i style={{ width: "78%" }} /></span><small>7 cases</small></div><div><b>AI confidence too low</b><span><i style={{ width: "48%" }} /></span><small>4 cases</small></div><div><b>Policy conflict</b><span><i style={{ width: "32%" }} /></span><small>3 cases</small></div></section>
          </div>
        </>}

        <div className="landing-demo-disclaimer">Illustrative demo data · Interface based on the current StayRight NZ product</div>
      </div>
    </div>
  );
}

export function LandingPage() {
  const { user, loading } = useAuth();
  const isMobile = useMobileLayout();
  const [activeWorkspace, setActiveWorkspace] = useState<WorkspaceId>("traveller");
  const [activeWorkflow, setActiveWorkflow] = useState(0);
  const [workflowPaused, setWorkflowPaused] = useState(false);
  const primaryHref = !loading && user ? user.homeRoute : loginPath();
  const primaryLabel = !loading && user ? "Open workspace" : "Sign in";

  useEffect(() => {
    if (workflowPaused) return;
    const timer = window.setInterval(() => setActiveWorkflow((current) => (current + 1) % workflowSteps.length), 6000);
    return () => window.clearInterval(timer);
  }, [workflowPaused]);

  return (
    <div className={`landing-page${isMobile ? " landing-page-m" : ""}`}>
      <div className="landing-topline">
        <span><i /> Built for New Zealand travel recovery</span>
        <span>Weather · Flights · Road closures</span>
      </div>
      <header className="landing-header">
        <Link to="/" className="landing-brand" aria-label="StayRight NZ home">
          <span className="landing-brand-mark"><span /></span>
          <span><strong>StayRight NZ</strong><small>Travel recovery, connected</small></span>
        </Link>
        <nav className="landing-nav" aria-label="Primary navigation">
          <a href="#ai-agent">AI agent</a>
          <a href="#how-it-works">How it works</a>
          <a href="#workspaces">Workspaces</a>
          <Link className="landing-nav-login" to={primaryHref}>{primaryLabel}</Link>
        </nav>
      </header>

      <main>
        <section className="landing-hero">
          <div className="landing-hero-copy">
            <div className="landing-kicker"><span /> Travel disruption recovery platform</div>
            <h1>Travel disruption,<br/><em>handled before the call.</em></h1>
            <p className="landing-lead">StayRight NZ detects risks to upcoming bookings, prepares suitable recovery options and connects travellers, hotels and coordinators in one clear workflow.</p>
            <div className="landing-hero-actions">
              <Link className="landing-button landing-button-primary" to={primaryHref}>{primaryLabel}<span>→</span></Link>
              <a className="landing-button landing-button-secondary" href="#how-it-works">See how it works</a>
            </div>
            <div className="landing-trust-line">
              <span><LandingIcon name="check"/>Live case updates</span>
              <span><LandingIcon name="check"/>Human help when needed</span>
              <span><LandingIcon name="check"/>One shared recovery record</span>
            </div>
          </div>

          <div className="landing-hero-visual" aria-label="A disruption recovery case moving from detection to resolution">
            <div className="landing-orbit landing-orbit-one" />
            <div className="landing-orbit landing-orbit-two" />
            <div className="landing-case-card">
              <div className="landing-card-top"><span className="landing-live"><i /> AI AGENT ACTIVE</span><span>NZ · QUEENSTOWN</span></div>
              <h2>Severe weather detected</h2>
              <p>The AI agent matched an affected stay and started the recovery workflow.</p>
              <div className="landing-case-route">
                <div><span className="landing-route-icon red"><LandingIcon name="signal"/></span><strong>Risk detected</strong><small>Weather signal matched</small></div>
                <i />
                <div><span className="landing-route-icon purple"><LandingIcon name="spark"/></span><strong>AI prepared options</strong><small>Policy-grounded choices</small></div>
                <i />
                <div><span className="landing-route-icon teal"><LandingIcon name="check"/></span><strong>Stay recovered</strong><small>Everyone kept informed</small></div>
              </div>
              <div className="landing-progress"><span /></div>
              <div className="landing-card-footer"><span>Traveller</span><b>↔</b><span>Hotel</span><b>↔</b><span>Coordinator</span></div>
            </div>
            <div className="landing-float landing-float-alert"><span>!</span><div><small>Priority update</small><strong>Action underway</strong></div></div>
            <div className="landing-float landing-float-success"><LandingIcon name="check"/><div><small>Recovery status</small><strong>Option confirmed</strong></div></div>
          </div>
        </section>

        <section className="landing-scale" aria-label="StayRight NZ operating context">
          <div><strong>180,000</strong><span>bookings served annually</span></div>
          <div><strong>2,000+</strong><span>New Zealand properties</span></div>
          <div><strong>8%</strong><span>of bookings affected by disruption</span></div>
          <div><strong>15</strong><span>people in the support team</span></div>
        </section>

        <section className="landing-ai" id="ai-agent">
          <div className="landing-ai-copy">
            <span>AI-POWERED RECOVERY</span>
            <h2>The AI agent turns a disruption signal into an actionable case.</h2>
            <p>Instead of leaving the support team to search across disconnected systems, StayRight NZ brings detection, booking impact, policy context and recovery choices into one guided process.</p>
            <div className="landing-signal-pills">
              <span><i className="weather" />Severe weather</span>
              <span><i className="flight" />Flight cancellations</span>
              <span><i className="road" />Road closures</span>
              <span><i className="alert" />Volcanic alerts</span>
            </div>
          </div>
          <div className="landing-agent-card">
            <div className="landing-agent-head">
              <div><span className="landing-agent-logo"><LandingIcon name="spark" /></span><span><strong>StayRight AI Agent</strong><small>Autonomous recovery workflow</small></span></div>
              <b><i /> Processing</b>
            </div>
            <div className="landing-agent-flow">
              <div className="complete"><span><LandingIcon name="signal" /></span><div><strong>Disruption understood</strong><small>Signal, location and severity evaluated</small></div><b>✓</b></div>
              <div className="complete"><span><LandingIcon name="route" /></span><div><strong>Affected bookings matched</strong><small>Dates and geographic impact checked</small></div><b>✓</b></div>
              <div className="active"><span><LandingIcon name="spark" /></span><div><strong>Policy-grounded options prepared</strong><small>Availability, preferences and terms considered</small></div><b>AI</b></div>
              <div><span><LandingIcon name="coordinator" /></span><div><strong>Human handoff when needed</strong><small>Complex cases arrive with context</small></div><b>04</b></div>
            </div>
            <div className="landing-agent-note"><LandingIcon name="check" /><span><strong>AI handles the routine path.</strong> Guests and hotels make decisions; coordinators remain in control of exceptions.</span></div>
          </div>
        </section>

        <section className="landing-capabilities" id="how-it-works" onMouseEnter={() => setWorkflowPaused(true)} onMouseLeave={() => setWorkflowPaused(false)}>
          <div className="landing-section-heading">
            <span>HOW IT WORKS</span>
            <h2>One connected path through disruption</h2>
            <p>Follow a recovery case from the first signal to a confirmed, shared outcome.</p>
          </div>
          <div className="landing-workflow-story">
            <div className="landing-workflow-copy" key={`copy-${activeWorkflow}`}>
              <span className="workflow-step-count">STEP {String(activeWorkflow + 1).padStart(2, "0")} / 07</span>
              <small>{workflowSteps[activeWorkflow].eyebrow}</small>
              <h3>{workflowSteps[activeWorkflow].title}</h3>
              <p>{workflowSteps[activeWorkflow].body}</p>
              <div className="workflow-actor"><span className="landing-capability-icon"><LandingIcon name={activeWorkflow === 3 ? "hotel" : activeWorkflow === 5 ? "traveller" : activeWorkflow === 6 ? "route" : "spark"}/></span><div><small>RESPONSIBLE</small><strong>{workflowSteps[activeWorkflow].actor}</strong><em>{workflowSteps[activeWorkflow].meta}</em></div></div>
            </div>
            <div className="landing-workflow-visual" key={`visual-${activeWorkflow}`}><WorkflowVisual step={activeWorkflow}/><span className="workflow-demo-label">ILLUSTRATIVE WORKFLOW</span></div>
          </div>
          <div className="landing-workflow-controls">
            <button type="button" aria-label="Previous workflow step" onClick={() => setActiveWorkflow((activeWorkflow - 1 + workflowSteps.length) % workflowSteps.length)}>←</button>
            <div className="landing-workflow-dots" role="tablist" aria-label="Workflow steps">{workflowSteps.map((item, index) => <button key={item.title} type="button" role="tab" aria-selected={activeWorkflow === index} aria-label={`Step ${index + 1}: ${item.title}`} onClick={() => setActiveWorkflow(index)}><i/><span>{item.eyebrow}</span></button>)}</div>
            <button type="button" aria-label="Next workflow step" onClick={() => setActiveWorkflow((activeWorkflow + 1) % workflowSteps.length)}>→</button>
          </div>
        </section>

        <section className="landing-workspaces" id="workspaces">
          <div className="landing-workspace-intro">
            <span>ONE PLATFORM · THREE VIEWS</span>
            <h2>Everyone sees what matters to them.</h2>
            <p>Each workspace is purpose-built for its user while staying connected to the same case and booking information.</p>
          </div>
          <div className="landing-workspace-tabs" role="tablist" aria-label="Preview a StayRight workspace">
            {workspaces.map((item) => (
              <button key={item.id} type="button" role="tab" aria-selected={activeWorkspace === item.id} onClick={() => setActiveWorkspace(item.id)} className={`landing-workspace-tab ${item.tone} ${activeWorkspace === item.id ? "active" : ""}`}>
                <span className="landing-workspace-icon"><LandingIcon name={item.icon}/></span>
                <span><strong>{item.title}</strong><small>{item.body}</small></span>
              </button>
            ))}
          </div>
          <WorkspaceDemo active={activeWorkspace} />
        </section>

        <section className="landing-outcomes">
          <div className="landing-outcomes-heading">
            <span>DESIGNED OUTCOMES</span>
            <h2>Success is measured in clearer, faster recovery.</h2>
            <p>These are the goals defined for the StayRight NZ disruption agent.</p>
          </div>
          <div className="landing-outcome-grid">
            <article><small>Guest notification target</small><strong>Within 15 min</strong><p>Reach affected travellers before they need to call for help.</p></article>
            <article><small>Resolution-time target</small><strong>50% faster</strong><p>Reduce the manual work required to move a case forward.</p></article>
            <article><small>Retention target</small><strong>80%+</strong><p>Keep disrupted travellers on-platform with suitable alternatives.</p></article>
          </div>
        </section>

        <section className="landing-cta">
          <div><span>READY WHEN PLANS CHANGE</span><h2>Open your StayRight NZ workspace.</h2><p>Your account automatically takes you to the right experience.</p></div>
          <Link className="landing-button landing-button-light" to={primaryHref}>{primaryLabel}<span>→</span></Link>
        </section>
      </main>

      <footer className="landing-footer">
        <div className="landing-brand landing-brand-footer"><span className="landing-brand-mark"><span /></span><span><strong>StayRight NZ</strong><small>Travel recovery, connected</small></span></div>
        <p>AI-powered travel disruption and rebooking support for New Zealand.</p>
        <span>© 2026 StayRight NZ</span>
      </footer>
    </div>
  );
}
