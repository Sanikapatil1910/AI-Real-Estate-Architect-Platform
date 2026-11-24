import type { ComplianceReport as Report, GenerateResponse, Ledger } from '../types'

const show = (v: string | number | boolean): string => (v === true ? 'yes' : v === false ? 'no' : String(v))

interface Props {
  report: Report
  search?: GenerateResponse['search']
  /** the requirement ledger of the plan being shown (counts per type and per floor, counted from the plan's geometry) */
  ledger?: Ledger
  status?: GenerateResponse['status']
}

/**
 * What was asked for versus what the plans really contain.  The numbers come from the backend, which counts them from the generated
 * plans themselves (never from what the search says it did), so this panel cannot claim more than the drawings deliver.
 */
export default function ComplianceReport({ report, search, ledger, status }: Props) {
  const exact = report.exact && (ledger ? ledger.ok : true) && status !== 'closest_alternative'
  const tone = exact
    ? { bg: '#f0fdf4', border: '#22c55e', fg: '#14532d' }
    : { bg: '#fffbeb', border: '#f59e0b', fg: '#78350f' }
  const title = exact
    ? 'These plans meet your whole brief.'
    : report.mode === 'strict'
      ? `Your exact brief does not fit this plot. These are the closest valid plans, NOT your brief (${report.satisfied} of ${report.total} requirements met).`
      : `Your brief was adjusted so that it fits this plot (${report.satisfied} of ${report.total} requirements met).`
  return (
    <section
      role="status"
      aria-label="Brief compliance report"
      data-testid="compliance-report"
      style={{ margin: '12px 0', padding: '12px 16px', borderRadius: 10, background: tone.bg, border: `1px solid ${tone.border}`, color: tone.fg, fontSize: 14, lineHeight: 1.5 }}
    >
      <strong>{title}</strong>
      <div style={{ marginTop: 4, fontSize: 13 }}>
        Setbacks, stairs, doors, circulation and minimum room sizes were never relaxed. Mode: {report.mode === 'strict' ? 'keep my brief as asked' : 'let the planner adjust my brief'}.
      </div>
      {ledger && (
        <details open={!ledger.ok} data-testid="requirement-ledger" style={{ marginTop: 8 }}>
          <summary style={{ cursor: 'pointer', fontWeight: 600 }}>
            Requirement ledger: {ledger.floors.actual} of {ledger.floors.required} floors, {ledger.ok ? 'every count met' : 'not every requirement met'}
          </summary>
          <table style={{ borderCollapse: 'collapse', marginTop: 6, width: '100%', fontSize: 13 }}>
            <thead><tr style={{ textAlign: 'left' }}><th style={{ padding: '2px 8px 2px 0' }}>Room</th><th style={{ padding: '2px 8px' }}>Asked</th><th style={{ padding: '2px 8px' }}>Planned</th><th style={{ padding: '2px 0 2px 8px' }}>Status</th></tr></thead>
            <tbody>
              {ledger.totals.map((t) => (
                <tr key={t.type} style={{ borderTop: '1px solid rgba(0,0,0,0.08)' }}>
                  <td style={{ padding: '2px 8px 2px 0' }}>{t.label}</td><td style={{ padding: '2px 8px' }}>{t.required}</td><td style={{ padding: '2px 8px' }}>{t.actual}</td>
                  <td style={{ padding: '2px 0 2px 8px', fontWeight: 600, color: t.met ? '#166534' : '#991b1b' }}>{t.met ? 'met' : 'not met'}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div style={{ marginTop: 6, fontSize: 13 }}>
            {ledger.per_floor.map((f) => (
              <div key={f.floor}>
                <strong>{f.floor}:</strong>{' '}
                {Object.entries(f.actual).filter(([k]) => !['staircase', 'passage'].includes(k)).map(([k, n]) => `${n} ${k.replace(/_/g, ' ')}`).join(', ') || 'no rooms'}
                {f.required ? (f.met ? ' (as requested)' : ' (differs from the per-floor request)') : ''}
              </div>
            ))}
          </div>
          {ledger.violations.length > 0 && (
            <ul style={{ margin: '6px 0 0 18px' }}>
              {ledger.violations.map((v, i) => (<li key={i}>{v.message}</li>))}
            </ul>
          )}
        </details>
      )}
      {!exact && (
        <details open style={{ marginTop: 8 }}>
          <summary style={{ cursor: 'pointer', fontWeight: 600 }}>Requested vs planned</summary>
          <table style={{ borderCollapse: 'collapse', marginTop: 6, width: '100%', fontSize: 13 }}>
            <thead>
              <tr style={{ textAlign: 'left' }}>
                <th style={{ padding: '2px 8px 2px 0' }}>Requirement</th>
                <th style={{ padding: '2px 8px' }}>Asked</th>
                <th style={{ padding: '2px 8px' }}>Planned</th>
                <th style={{ padding: '2px 0 2px 8px' }}>Status</th>
              </tr>
            </thead>
            <tbody>
              {report.items.map((it) => (
                <tr key={it.key} style={{ borderTop: '1px solid rgba(0,0,0,0.08)' }}>
                  <td style={{ padding: '2px 8px 2px 0' }}>{it.label}</td>
                  <td style={{ padding: '2px 8px' }}>{show(it.requested)}</td>
                  <td style={{ padding: '2px 8px' }}>{show(it.delivered)}</td>
                  <td style={{ padding: '2px 0 2px 8px', fontWeight: 600, color: it.met ? '#166534' : '#991b1b' }}>{it.met ? 'met' : 'not met'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </details>
      )}
      {report.adjustments.length > 0 && (
        <div style={{ marginTop: 8 }}>
          <strong>What changed and why</strong>
          <ul style={{ margin: '4px 0 0 18px' }}>
            {report.adjustments.map((a, i) => (
              <li key={i}>{a}</li>
            ))}
          </ul>
        </div>
      )}
      {report.unmet.length > 0 && (
        <div style={{ marginTop: 8 }}>
          <strong>Not provided</strong>
          <ul style={{ margin: '4px 0 0 18px' }}>
            {report.unmet.map((u) => (
              <li key={u.key}>
                {u.label}: {show(u.requested)} asked, {show(u.delivered)} planned. {u.reason}
              </li>
            ))}
          </ul>
        </div>
      )}
      {report.compromises.length > 0 && (
        <div style={{ marginTop: 8 }}>
          <strong>Layout compromises</strong>
          <ul style={{ margin: '4px 0 0 18px' }}>
            {report.compromises.map((c, i) => (
              <li key={i}>{c}</li>
            ))}
          </ul>
        </div>
      )}
      {search && (search.total_elapsed_s ?? search.elapsed_s) !== undefined && (
        <div style={{ marginTop: 8, fontSize: 12, opacity: 0.8 }}>
          Searched {search.candidates ?? 0} candidate layouts{search.programmes_tried ? ` across ${search.programmes_tried} programmes` : ''} in {search.total_elapsed_s ?? search.elapsed_s} s.
        </div>
      )}
    </section>
  )
}
