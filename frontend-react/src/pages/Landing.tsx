import { useState } from 'react'
import '../styles/landing.css'
import { Link } from '../router'
import { useAuth } from '../auth/AuthContext'
import { Logo, STYLE_INFO } from '../components/ui'
import { ARCH_STYLES } from '@/lib/archStyle'

const Check = () => <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m5 12.5 4.5 4.5L19 7.5" /></svg>
const Icon = ({ d }: { d: string }) => <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={d} /></svg>

export function PublicNav() {
  const { user, logout } = useAuth()
  const [open, setOpen] = useState(false)
  return (
    <header className={`nav${open ? ' open' : ''}`}>
      <div className="wrap nav-in">
        <Link to="/" className="brand"><Logo />AI Architect</Link>
        <nav className="nav-links" aria-label="Sections" onClick={() => setOpen(false)}>
          <a href="/#how">How it works</a><a href="/#styles">Styles</a><a href="/#upload">Floor-plan upload</a><a href="/#features">Features</a>
        </nav>
        <div className="nav-end">
          {user ? (<>
            <Link to="/app" className="pbtn pbtn-primary pbtn-sm">Open dashboard</Link>
            <button type="button" className="pbtn pbtn-ghost pbtn-sm" onClick={logout}>Log out</button>
          </>) : (<>
            <Link to="/login" className="pbtn pbtn-ghost pbtn-sm">Log in</Link>
            <Link to="/signup" className="pbtn pbtn-primary pbtn-sm">Sign up</Link>
          </>)}
        </div>
        <button type="button" className="nav-toggle" aria-label="Menu" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><path d={open ? 'M6 6l12 12M18 6 6 18' : 'M4 7h16M4 12h16M4 17h16'} /></svg>
        </button>
      </div>
    </header>
  )
}

export default function Landing() {
  const { user } = useAuth()
  const start = user ? '/app/create' : '/signup'
  return (
    <>
      <PublicNav />
      <main>
        <section className="hero-l">
          <div className="wrap hero-grid">
            <div>
              <span className="eyebrow">AI architecture studio</span>
              <h1>Your Vision. Your Home. <em>Designed with AI.</em></h1>
              <p className="lead">Tell us about your plot and family, or upload an existing floor plan. Get plans you can inspect and explain, then walk through them in 3D and dress them in Modern, Traditional Indian or Maharashtrian Wada style.</p>
              <div className="hero-cta">
                <Link to={start} className="pbtn pbtn-primary pbtn-lg" data-testid="cta-start">Start designing</Link>
                <Link to="/app/upload" className="pbtn pbtn-ghost pbtn-lg" data-testid="cta-upload">Upload your floor plan</Link>
              </div>
            </div>
            <figure className="hero-fig">
              <img src="/samples/hero-wada.jpg" alt="3D render of a three-storey house in Maharashtrian Wada style with a carved timber verandah" width={1000} height={692} />
              <span className="hero-chip"><b>Maharashtrian Wada</b>Carved verandah, ochre walls, tiled eaves</span>
              <figcaption>Sample: rendered by this platform&apos;s own 3D engine from a generated plan, not a stock photo.</figcaption>
            </figure>
          </div>
        </section>

        <div className="strip"><div className="wrap strip-in">
          {['Three architectural styles', 'Vastu and climate aware', 'Explainable analysis', 'Upload a plan, get a 3D twin', 'Export the 3D model (.glb)'].map((t) => <div key={t}><Check />{t}</div>)}
        </div></div>

        <section className="sec" id="how"><div className="wrap">
          <div className="sec-head"><span className="eyebrow">How it works</span><h2>From a plot to a home you can walk through</h2><p>Three steps, and you stay in control at each one.</p></div>
          <div className="how">
            <div className="pcard"><h3>Describe or upload</h3><p className="muted">Enter plot size, road side, family and room needs, or upload a 2D plan image to be read for you.</p></div>
            <div className="pcard"><h3>Compare real concepts</h3><p className="muted">Four layout concepts, each with an explanation of why it works and where it compromises. No made-up scores.</p></div>
            <div className="pcard"><h3>Walk through it in 3D</h3><p className="muted">Switch style, palette and materials, look inside with the cutaway, then save the project or export the model.</p></div>
          </div>
        </div></section>

        <section className="sec" id="styles" style={{ paddingTop: 0 }}><div className="wrap">
          <div className="sec-head"><span className="eyebrow">Architectural styles</span><h2>Three distinct ways to dress the same plan</h2><p>A style changes the look, materials, furniture and roofs, never the rooms, walls or openings you approved.</p></div>
          <div className="style-grid">
            {ARCH_STYLES.map((s) => (
              <Link key={s} to={start} className="style-card" style={{ textDecoration: 'none' }}>
                <img src={STYLE_INFO[s].img} alt={`${s} sample render`} loading="lazy" />
                <span className="body"><b>{s}</b><span>{STYLE_INFO[s].blurb}</span></span>
              </Link>
            ))}
          </div>
          <p className="hint" style={{ marginTop: 10 }}>Images are renders produced by the platform&apos;s 3D engine from a sample plan.</p>
        </div></section>

        <section className="sec dark-band" id="upload"><div className="wrap up-grid">
          <div>
            <span className="eyebrow">Floor-plan upload</span>
            <h2 style={{ fontSize: 'clamp(1.7rem,3.4vw,2.6rem)', margin: '10px 0 12px' }}>Upload Your Floor Plan → Build Your 3D Dream Home</h2>
            <p>Already have a 2D plan? Upload a PNG or JPG. Gemini reads it, you confirm the scale, review every room and opening, and the same 3D engine builds your home.</p>
            <ul>
              <li><Check /><span>Reads only what is drawn: nothing is invented, and unclear items are listed as unknown.</span></li>
              <li><Check /><span>You give one real dimension (or approve an approximate scale) and edit the result before building.</span></li>
              <li><Check /><span>Structure and design are separate: restyle freely without moving a wall.</span></li>
            </ul>
            <Link to="/app/upload" className="pbtn pbtn-gold pbtn-lg">Upload your floor plan</Link>
          </div>
          <img src="/samples/upload-twin.jpg" alt="3D model built from an uploaded plan, shown in Wada style" loading="lazy" />
        </div></section>

        <section className="sec" id="features"><div className="wrap">
          <div className="sec-head"><span className="eyebrow">Features</span><h2>Built for people who want to understand their home</h2></div>
          <div className="feat">
            {[
              ['M3 11.5 12 4l9 7.5M5.5 10.5V20h13v-9.5', 'Constraint-based planning', 'Exact room counts, setbacks, parking, stairs and circulation rules, with a clear explanation if a brief cannot fit.'],
              ['M12 3v18M3 12h18M6 6l12 12M18 6 6 18', 'Vastu and climate aware', 'Basic or strict Vastu, daylight and ventilation preferences are part of how concepts are generated.'],
              ['M4 5h16v14H4zM8 9h8M8 13h5', 'Explainable analysis', 'Every concept says what it does well and what it trades off, in plain language.'],
              ['M3 17l9 4 9-4M3 12l9 4 9-4M12 3 3 7l9 4 9-4z', 'Interactive 3D twin', 'Cutaway walls, exterior and interior views, doors that open, lighting from morning to evening.'],
              ['M4 20h16M6 16l6-12 6 12', 'Customise interior and exterior', 'Palettes, floors, wall colours, facades and fixtures, applied without changing the building itself.'],
              ['M12 3v12m0 0-4-4m4 4 4-4M5 21h14', 'Save, reopen and export', 'Keep projects in your dashboard, regenerate later, and download the model as .glb.'],
            ].map(([d, t, p]) => <div key={t} className="pcard"><Icon d={d} /><h3>{t}</h3><p>{p}</p></div>)}
          </div>
        </div></section>

        <section className="sec" style={{ paddingTop: 0 }}><div className="wrap">
          <div className="pcard pcard-pad" style={{ maxWidth: 860, margin: '0 auto' }}>
            <span className="eyebrow">Honest by design</span>
            <h2 style={{ fontSize: '1.6rem', margin: '8px 0 8px' }}>What the AI does, and what it does not</h2>
            <p className="muted">AI is used to read drawings and word explanations. Geometry, dimensions, walls, openings and 3D models are produced by deterministic code that you can review. The results are concept designs for planning and discussion, not construction drawings, and they do not replace a licensed architect, a structural engineer or local building approval.</p>
          </div>
        </div></section>

        <section className="sec" style={{ paddingTop: 0 }}><div className="wrap">
          <div className="cta-band"><h2>Ready to see your home?</h2><p className="muted" style={{ marginBottom: 22 }}>Create an account and design your first plan in minutes.</p>
            <div className="row" style={{ justifyContent: 'center' }}>
              <Link to={start} className="pbtn pbtn-primary pbtn-lg">Start designing</Link>
              <Link to="/login" className="pbtn pbtn-ghost pbtn-lg">I already have an account</Link>
            </div></div>
        </div></section>
      </main>
      <footer className="foot"><div className="wrap row" style={{ justifyContent: 'space-between' }}>
        <span>AI Architect · concept designs only, not a substitute for a licensed architect or local approvals.</span>
        <span>Sample images are renders by the platform&apos;s 3D engine.</span>
      </div></footer>
    </>
  )
}
