import { createRoot } from 'react-dom/client';
import '../index.css';
import './fixtures.css';

const entries = [
  { date: '৪ অক্টোবর ২০২৬', title: 'পণ্য সরবরাহ', note: 'পরীক্ষার ডেটা', amount: '৳ ২,৫০০', balance: '৳ ৪,৭০০' },
  { date: '২ অক্টোবর ২০২৬', title: 'আংশিক পরিশোধ', note: 'পরীক্ষার ডেটা', amount: '৳ ১,০০০', balance: '৳ ২,২০০' },
  { date: '৩০ সেপ্টেম্বর ২০২৬', title: 'দোকানের মালামাল', note: 'পরীক্ষার ডেটা', amount: '৳ ১,২০০', balance: '৳ ৩,২০০' },
];

function FixtureLabel() {
  return <span className="vf-fixture-label">শুধু ভিজ্যুয়াল পরীক্ষা · কাল্পনিক তথ্য</span>;
}

function Header({ title }: { title: string }) {
  return (
    <header className="vf-header">
      <button className="vf-icon-button" aria-label="পেছনে যান" data-testid="button-fixture-back">‹</button>
      <div className="vf-header-title">
        <strong>{title}</strong>
        <FixtureLabel />
      </div>
      <button className="vf-icon-button" aria-label="আরও বিকল্প" data-testid="button-fixture-more">⋯</button>
    </header>
  );
}

function PartyLedgerFixture() {
  return (
    <div className="vf-page" data-testid="fixture-party-ledger">
      <Header title="পার্টির হিসাব" />
      <main className="vf-content">
        <section className="vf-party">
          <div className="vf-avatar">ট</div>
          <div className="vf-party-copy">
            <h1>টেস্ট গ্রাহক</h1>
            <p>01XX-XXX-XXXX</p>
          </div>
          <button className="vf-call" aria-label="কল" data-testid="button-fixture-call">কল</button>
        </section>

        <section className="vf-balance">
          <span>বর্তমান পাওনা</span>
          <strong>৳ ৪,৭০০.০০</strong>
          <small>আপনি পাবেন</small>
        </section>

        <div className="vf-list-heading">
          <div>
            <h2>লেনদেনের ইতিহাস</h2>
            <p>সাম্প্রতিক লেনদেন</p>
          </div>
          <button className="vf-outline" data-testid="button-fixture-report">রিপোর্ট</button>
        </div>

        <section className="vf-entries" aria-label="পরীক্ষার লেনদেন">
          {entries.map((entry) => (
            <article className="vf-entry" data-testid={`card-fixture-entry-${entry.title}`} key={entry.title}>
              <span className="vf-entry-date">{entry.date}</span>
              <div className="vf-entry-main">
                <div>
                  <strong>{entry.title}</strong>
                  <small>{entry.note}</small>
                </div>
                <strong className="vf-entry-amount">{entry.amount}</strong>
              </div>
              <div className="vf-entry-balance">
                <span>ব্যালেন্স</span>
                <strong>{entry.balance}</strong>
              </div>
            </article>
          ))}
        </section>
      </main>
      <footer className="vf-actions">
        <button className="vf-secondary" data-testid="button-fixture-payment">পেমেন্ট নিন</button>
        <button className="vf-primary" data-testid="button-fixture-add-entry">লেনদেন যোগ করুন</button>
      </footer>
    </div>
  );
}

function TransactionReportFixture() {
  return (
    <div className="vf-page" data-testid="fixture-transaction-report">
      <Header title="লেনদেনের রিপোর্ট" />
      <main className="vf-content vf-report">
        <section className="vf-report-party">
          <span className="vf-avatar">ট</span>
          <div>
            <h1>টেস্ট গ্রাহক</h1>
            <p>01XX-XXX-XXXX · কাল্পনিক পরীক্ষার তথ্য</p>
          </div>
        </section>

        <div className="vf-report-toolbar">
          <button className="vf-outline" data-testid="button-fixture-period">সব লেনদেন⌄</button>
          <div className="vf-report-buttons">
            <button className="vf-icon-button" aria-label="শেয়ার" data-testid="button-fixture-share">↗</button>
            <button className="vf-icon-button" aria-label="ডাউনলোড" data-testid="button-fixture-download">↓</button>
          </div>
        </div>

        <section className="vf-summary" aria-label="রিপোর্ট সারাংশ">
          <article data-testid="summary-fixture-opening"><span>শুরুর ব্যালেন্স</span><strong>৳ ২,২০০</strong></article>
          <article data-testid="summary-fixture-given"><span>আপনি দিয়েছেন</span><strong>৳ ৩,৭০০</strong></article>
          <article data-testid="summary-fixture-received"><span>আপনি পেয়েছেন</span><strong>৳ ১,২০০</strong></article>
          <article className="vf-summary-total" data-testid="summary-fixture-current"><span>বর্তমান ব্যালেন্স</span><strong>৳ ৪,৭০০</strong></article>
        </section>

        <div className="vf-table-wrap">
          <table className="vf-table">
            <thead>
              <tr><th>তারিখ</th><th>বিবরণ</th><th>দেওয়া</th><th>পাওয়া</th><th>ব্যালেন্স</th></tr>
            </thead>
            <tbody>
              {entries.map((entry, index) => (
                <tr data-testid={`row-fixture-report-entry-${index}`} key={entry.title}>
                  <td>{entry.date}</td>
                  <td>{entry.title}</td>
                  <td>{index === 1 ? '—' : entry.amount}</td>
                  <td>{index === 1 ? entry.amount : '—'}</td>
                  <td>{entry.balance}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="vf-report-note">এই রিপোর্টটি কাল্পনিক ভিজ্যুয়াল পরীক্ষার ডেটা দিয়ে তৈরি।</p>
      </main>
    </div>
  );
}

function App() {
  const screen = new URLSearchParams(window.location.search).get('screen');
  if (screen === 'party-ledger') return <PartyLedgerFixture />;
  if (screen === 'transaction-report') return <TransactionReportFixture />;
  return <main className="vf-page" data-testid="fixture-unknown">Unknown visual fixture.</main>;
}

createRoot(document.getElementById('root')!).render(<App />);