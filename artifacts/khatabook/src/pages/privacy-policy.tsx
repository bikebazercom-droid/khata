import { PublicPageShell } from "@/components/layout/public-page-shell";

const basePath = import.meta.env.BASE_URL.replace(/\/$/, "");

export function PrivacyPolicyPage() {
  return (
    <PublicPageShell
      title="Privacy Policy | BanglaKhata - Business Ledger"
      description="Read how BanglaKhata handles account details, customer and supplier records, ledger entries, offline data, and uploaded bill images."
    >
      <article lang="en" className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm sm:p-10">
        <div
          role="note"
          className="mb-8 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm leading-relaxed text-amber-900"
        >
          This policy is a general privacy notice, not legal advice. Please have it reviewed for your specific legal and Play Store requirements before publication.
        </div>
        <h1 className="mb-2 text-3xl font-bold tracking-tight text-[#1B3A6B]">Privacy Policy</h1>
        <p className="mb-8 text-sm text-slate-500">Last updated: October 6, 2026</p>

        <div className="space-y-8 text-sm leading-7 text-slate-700">
          <section>
            <h2 className="mb-2 text-lg font-semibold text-slate-900">Who operates BanglaKhata</h2>
            <p>
              BanglaKhata is operated by Mohammed Sakil Rahman in Bangladesh. This policy applies to the BanglaKhata web application and its mobile app.
              For privacy questions or requests, contact{" "}
              <a
                href="mailto:support@banglakhata.com?subject=BanglaKhata%20privacy%20request"
                data-testid="link-privacy-contact"
                className="font-medium text-sky-700 underline underline-offset-2"
              >
                support@banglakhata.com
              </a>.
            </p>
          </section>

          <section>
            <h2 className="mb-2 text-lg font-semibold text-slate-900">Information we handle</h2>
            <ul className="list-disc space-y-2 pl-5">
              <li><strong>Account and sign-in details:</strong> phone number, email or identity details supplied through the sign-in method you choose, and account/session identifiers.</li>
              <li><strong>Business and contact records:</strong> shop details and customer or supplier information you enter, such as names and phone numbers.</li>
              <li><strong>Ledger records:</strong> amounts, transaction types and dates, descriptions, due dates, bill references, balances, reports, and any bill photos you choose to upload.</li>
              <li><strong>Security and service information:</strong> sign-in events, IP address, device/browser information, and technical logs needed to operate, protect, and troubleshoot the service.</li>
              <li><strong>On-device data:</strong> selected account and ledger data may be cached in browser or app storage so the ledger can work offline and sync when a connection returns.</li>
            </ul>
          </section>

          <section>
            <h2 className="mb-2 text-lg font-semibold text-slate-900">How we use information</h2>
            <p>
              We use this information to authenticate users, provide business and ledger features, apply account and staff permissions, keep reports available, support offline access and synchronization, send requested sign-in or invitation codes, respond to support requests, and protect the service from misuse. BanglaKhata is a record-keeping tool; it does not process payments or provide financial advice.
            </p>
          </section>

          <section>
            <h2 className="mb-2 text-lg font-semibold text-slate-900">Service providers and sharing</h2>
            <p className="mb-3">
              We do not sell customer or ledger records. We share information with service providers only as needed to operate features, and with people whom the business owner authorizes in that business.
            </p>
            <ul className="list-disc space-y-2 pl-5">
              <li><strong>Clerk:</strong> provides account authentication and receives the identity information required for the sign-in method you choose.</li>
              <li><strong>sms.net.bd:</strong> receives a phone number and verification or invitation message when BanglaKhata requests delivery of an SMS code.</li>
              <li><strong>Expo push service:</strong> when mobile notifications are enabled, Expo receives the device push token and notification text or record identifiers needed to deliver ledger activity alerts.</li>
              <li><strong>Hosting, database, and object-storage providers:</strong> operate the app, store its PostgreSQL records, and store uploaded bill images. Providers can vary with the deployment configuration.</li>
              <li><strong>Apps you choose to share with:</strong> if you share a report or reminder through your device or another app, that app and its provider handle the information you send under their own privacy terms.</li>
            </ul>
            <p className="mt-3">
              We may also disclose information when required by law or when reasonably necessary to protect users, the service, or someone’s safety.
            </p>
          </section>

          <section>
            <h2 className="mb-2 text-lg font-semibold text-slate-900">Storage and security</h2>
            <p>
              Business records are stored in a PostgreSQL database, and uploaded bill images are stored separately in access-controlled object storage. The server checks account, business, and role permissions before providing protected records. We use technical and organizational safeguards intended to protect information, but no online service or device storage can be guaranteed completely secure. Keep your phone and browser protected, especially when using offline access on a shared device.
            </p>
          </section>

          <section>
            <h2 className="mb-2 text-lg font-semibold text-slate-900">Cookies and offline storage</h2>
            <p>
              BanglaKhata uses session cookies and browser/app storage to keep you signed in, remember your selected business, and support offline access. Cached records may remain on a device until the app clears them or the device/browser data is cleared. Signing out does not, by itself, delete your account or server-side ledger records.
            </p>
          </section>

          <section>
            <h2 className="mb-2 text-lg font-semibold text-slate-900">Retention and deletion</h2>
            <p>
              We keep information while it is needed to provide the service, maintain account security, or meet legal obligations. A business owner can use the in-app account deletion option to remove the account, business, party, ledger, and staff records from the active database. Bill images are stored separately; contact us to request removal of those files. Limited security logs or backup copies may remain for a period where needed for recovery, security, or legal requirements.
            </p>
          </section>

          <section>
            <h2 className="mb-2 text-lg font-semibold text-slate-900">Your choices and requests</h2>
            <p>
              You can review or correct business and ledger information in the app and can request access, correction, or deletion by emailing us. We will verify the request and respond subject to applicable law and legitimate security or record-retention needs. You may also clear local browser or app storage from your device; this removes local copies but does not delete server records.
            </p>
          </section>

          <section>
            <h2 className="mb-2 text-lg font-semibold text-slate-900">Children</h2>
            <p>
              BanglaKhata is a business record-keeping service and is not intended for children under 18. If you believe a child has provided personal information, contact us so we can review the request.
            </p>
          </section>

          <section>
            <h2 className="mb-2 text-lg font-semibold text-slate-900">Changes and contact</h2>
            <p>
              We may update this policy when the service or applicable requirements change. The latest version and its update date will be posted on this page. For questions, correction or deletion requests, email{" "}
              <a
                href="mailto:support@banglakhata.com?subject=BanglaKhata%20privacy%20request"
                data-testid="link-privacy-contact-footer"
                className="font-medium text-sky-700 underline underline-offset-2"
              >
                support@banglakhata.com
              </a>.
            </p>
          </section>
        </div>

        <a
          href={`${basePath}/support`}
          data-testid="link-privacy-support"
          className="mt-8 inline-flex text-sm font-semibold text-sky-700 underline underline-offset-4"
        >
          Visit BanglaKhata Support
        </a>
      </article>
    </PublicPageShell>
  );
}
