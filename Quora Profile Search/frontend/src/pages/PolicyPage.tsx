export default function PolicyPage() {
  return (
    <>
      <div className="page-head">
        <div>
          <h1>Ethical use policy</h1>
          <div className="sub">How this tool collects information, and what it may and may not be used for.</div>
        </div>
      </div>
      <div className="card policy">
        <h2>What the tool collects</h2>
        <ul>
          <li>Only <strong>professional</strong> information that people chose to publish: job title, employer, skills, experience, and professional links.</li>
          <li>Only people whose public profile places them in the <strong>United States</strong> or <strong>Europe</strong>.</li>
          <li>Only email addresses the person published themselves: in their own post, their GitHub profile's public email field, or their own website. Personal addresses (such as Gmail) are labeled as personal and can be switched off in Settings. Phone numbers and home addresses are never collected.</li>
          <li>Every detail is stored with its <strong>public source URL</strong> and discovery date. Nothing without a traceable source is saved.</li>
        </ul>

        <h2>How it collects it</h2>
        <ul>
          <li><strong>Quora:</strong> found through official search-engine APIs. Quora pages are never crawled, because Quora's terms prohibit it.</li>
          <li><strong>Medium:</strong> authors are found through official search-engine APIs. Only each author's public RSS feed (medium.com/feed/@user) is read, with robots.txt honored. Medium pages are never crawled.</li>
          <li><strong>Reddit:</strong> read through Reddit's official Data API, inside its rate limits, using only public posts and public profile bios. Without API keys, only search-engine snippets of public posts are used and Reddit is never crawled. Those records expire after 30 days because their deletion can't be checked.</li>
          <li><strong>LinkedIn:</strong> search-engine snippets only. It is never crawled.</li>
          <li><strong>GitHub:</strong> official API, public profile fields only.</li>
          <li><strong>Personal websites:</strong> fetched only where robots.txt allows. The tool never logs in, solves CAPTCHAs, or gets around access controls, rate limits or paywalls.</li>
        </ul>

        <h2>Accuracy</h2>
        <ul>
          <li>AI extraction is checked against the source text, and anything not supported by it is discarded. Missing information stays blank.</li>
          <li>Profiles are <em>verified</em> only by an explicit cross-link, such as a website linking back to the account. A shared name is never treated as proof.</li>
          <li>Self-reported, possible and verified information are always labeled separately. AI summaries are interpretation, not fact.</li>
        </ul>

        <h2>Reddit pseudonymity</h2>
        <ul>
          <li>Reddit accounts are treated as pseudonymous. The tool does not try to work out who is behind an account and never searches other sites for a Reddit username.</li>
          <li>Only links and contacts the author posted themselves are used. When a Reddit post is deleted, the record built from it is removed during the daily sync.</li>
        </ul>

        <h2>Acceptable use</h2>
        <ul>
          <li>Allowed: professional outreach, such as recruiting, hiring freelancers, or partnership inquiries, sent to the contact the person published for that purpose.</li>
          <li>Not allowed: spam or bulk unsolicited email, selling or reselling the data, harassment, stalking, doxxing, building profiles of private individuals, or decisions about credit, housing, insurance or employment eligibility.</li>
          <li>Follow applicable law, including CAN-SPAM for commercial email and state privacy laws such as the CCPA/CPRA. Honor opt-outs.</li>
          <li>Commercial use of Reddit data requires Reddit's approval. Use of Quora and LinkedIn data is subject to their terms.</li>
        </ul>

        <h2>People in Europe (GDPR)</h2>
        <ul>
          <li>The GDPR (and the UK GDPR) applies to personal data about people in Europe, even when that data is public.</li>
          <li>You need a lawful basis to use it. For relevant professional outreach this is usually legitimate interest, which means weighing it against the person's interests and keeping the outreach proportionate.</li>
          <li>Tell people where you got their details, normally in your first message and at the latest within one month (Article 14). Honor any objection or deletion request promptly.</li>
          <li>Under ePrivacy rules, many EU countries require prior consent for unsolicited marketing email, especially to personal addresses. Keep messages one-to-one, relevant, and easy to opt out of.</li>
        </ul>

        <h2>Removal requests</h2>
        <ul>
          <li>Anyone can ask to have their information removed. Delete the record from its detail page, which removes the person, their profiles and their contacts, and don't collect it again.</li>
          <li>Keep data only as long as there's a legitimate professional purpose. Review saved contacts regularly.</li>
        </ul>
      </div>
    </>
  );
}
