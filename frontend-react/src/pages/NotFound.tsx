import { Link } from '../router'
export default function NotFound() {
  return (
    <main className="wrap" style={{ textAlign: 'center', padding: '90px 0' }}>
      <span className="eyebrow">404</span><h1 style={{ fontSize: '2.2rem', margin: '10px 0' }}>That page does not exist</h1>
      <p className="muted" style={{ marginBottom: 22 }}>The address may be mistyped or the page may have moved.</p>
      <Link to="/" className="pbtn pbtn-primary">Go to the home page</Link>
    </main>
  )
}
