/**
 * Seed data for the interior + system page batch (2026-07-10, wave W1). One
 * combined family the round-trip driver converts in a single run: the five
 * interior `lede` pages (reused verbatim from page-lede-family-seed-data.mjs)
 * and the three `system` pages (privacy + terms as `prose`, 404 as
 * `cta_banner`), whose bodies are inlined verbatim from their committed
 * exports (src/data/site/pages/page_{privacy,terms,404}.json) — the large legal
 * copy is taken exactly rather than re-transcribed, so the materialized exports
 * stay byte-identical (empty build-diff).
 *
 * None of the eight pages reference a shared section, so ordering among them is
 * irrelevant; all are `objectType: 'page'`. Exports the generic driver contract
 * SEED_SITE + CONVERSION_SEEDS. page_newsletter is a plain `lede` today (the
 * shared newsletter-signup section can be added later — it already exists).
 *
 * NOTE: this file is generated from the committed exports + the lede seeds;
 * regenerate with scripts/scratch if those bodies ever change pre-conversion.
 */
import { LEDE_FAMILY_SEEDS, LEDE_FAMILY_SITE } from './page-lede-family-seed-data.mjs';

export const SEED_SITE = LEDE_FAMILY_SITE;

const SYSTEM_PAGE_SEEDS = [
  {
    objectId: 'page_privacy',
    body: {
      pageType: 'system',
      route: '/privacy',
      sections: [
        {
          data: {
            body: '<p><em>Last updated</em>: May 07, 2026</p><p>This Privacy Policy explains how Dr. Lurié Legal Entity (placeholder), Location TBD ("Company", "We", "Us", or "Our") collects and uses information when You visit <a href="https://drluriescience.netlify.app">https://drluriescience.netlify.app</a> (the "Website").</p><h2>Summary</h2><p>The Website is an educational site with Netlify-hosted forms. It does not currently provide user accounts, checkout, paid subscriptions, comments, public profiles, or a live quiz flow. Based on the current implementation, We collect information You choose to submit through forms and limited opt-in metadata captured when Netlify forms are submitted.</p><h2>Information We Collect</h2><h3>Information You Provide</h3><p>When You submit a Website form, We may collect:</p><ul><li>Email address.</li><li>Name, if the form asks for it.</li><li>Message text submitted through the contact form.</li><li>The form name, such as contact, free-guide, or newsletter.</li><li>Consent or disclaimer text associated with the submission, when present.</li></ul><p>Current Website forms include a contact form, a free-guide email signup form, and a newsletter signup form. The early-access call to action currently directs visitors to the free-guide signup flow rather than collecting a separate early-access form submission.</p><h3>Opt-In Metadata Collected by Netlify Function</h3><p>When a Netlify form is submitted, the Website also sends opt-in metadata to a Netlify Function at /.netlify/functions/save-opt-in. That Function stores a record in Netlify Blobs that may include:</p><ul><li>Form name.</li><li>Submission timestamp.</li><li>Email address, if provided.</li><li>Name, if provided.</li><li>Source URL and page path.</li><li>Consent text, if available.</li><li>User agent string.</li></ul><h3>Usage Data and Analytics</h3><p>The Website\'s configuration includes Google Analytics support, but the analytics ID is currently set to null. That means Google Analytics is not currently configured by this site unless the configuration changes.</p><p>Netlify or other hosting infrastructure may still process standard technical information, such as IP address, browser type, requested pages, timestamps, and diagnostic logs, as part of delivering and securing the Website.</p><h2>How We Use Information</h2><p>We may use information collected through the Website to:</p><ul><li>Respond to contact form inquiries, including education questions and media or partnership requests.</li><li>Send requested resources, such as the free guide.</li><li>Send newsletter, product-development, or early-access updates to people who opt in.</li><li>Maintain consent and opt-in records.</li><li>Operate, secure, debug, and improve the Website.</li><li>Comply with legal obligations and enforce applicable terms.</li></ul><p>We do not use Website forms to provide medical advice, diagnosis, or treatment.</p><h2>Sharing Information</h2><p>We may share information with service providers that help operate the Website and process form submissions, including Netlify. We may also disclose information if required by law, to protect rights and safety, or in connection with a business transaction such as a merger or asset transfer.</p><p>We do not sell personal information submitted through Website forms.</p><h2>Cookies and Similar Technologies</h2><p>The Website may use essential browser storage or cookies needed for normal site functionality, such as theme preferences. Google Analytics is not currently active because no Google Analytics ID is configured. If analytics or additional tracking tools are enabled later, this Privacy Policy should be updated to describe those tools.</p><h2>Retention</h2><p>We retain personal information only for as long as needed for the purposes described in this Privacy Policy, including responding to inquiries, maintaining opt-in records, sending requested communications, complying with legal obligations, resolving disputes, and enforcing agreements.</p><h2>Your Choices</h2><p>You may choose not to submit Website forms. You may also contact Us to request access to, correction of, or deletion of personal information You provided, subject to legal or operational retention requirements.</p><p>Newsletter or update emails, if sent, should include a way to unsubscribe or opt out of future marketing communications.</p><h2>Security</h2><p>We use reasonable measures to protect personal information, but no method of transmission over the Internet or electronic storage is 100% secure. We cannot guarantee absolute security.</p><h2>Children\'s Privacy</h2><p>The Website is not directed to children under 13, and We do not knowingly collect personal information from children under 13. If You believe a child has provided personal information through the Website, please contact Us so We can take appropriate steps.</p><h2>Links to Other Websites</h2><p>The Website may link to third-party websites or services that We do not operate. We are not responsible for the content, privacy policies, or practices of third-party sites.</p><h2>Changes to This Privacy Policy</h2><p>We may update this Privacy Policy from time to time by posting a new version on this page and updating the "Last updated" date.</p><h2>Contact Us</h2><p>If You have questions about this Privacy Policy, You can contact Us through the Website contact form:</p><ul><li>Website: <a href="https://drluriescience.netlify.app/contact">https://drluriescience.netlify.app/contact</a></li></ul>\n',
          },
          id: 's_privacy',
          type: 'prose',
        },
      ],
      seo: {
        description: 'How Dr. Lurié collects and uses information submitted through the website.',
        robots: {
          follow: true,
          index: true,
        },
      },
      title: 'Privacy Policy',
    },
  },
  {
    objectId: 'page_terms',
    body: {
      pageType: 'system',
      route: '/terms',
      sections: [
        {
          data: {
            body: '<p><em>Last updated</em>: May 07, 2026</p><p>Please read these terms and conditions carefully before using this website.</p><h2>Interpretation and Definitions</h2><h3>Definitions</h3><p>For the purposes of these Terms and Conditions:</p><ul><li><strong>Company</strong> (referred to as either "the Company", "We", "Us" or "Our") refers to Dr. Lurié Legal Entity (placeholder), Location TBD.</li><li><strong>Country</strong> refers to: United States.</li><li><strong>Device</strong> means any device that can access the Service, such as a computer, cellphone, or tablet.</li><li><strong>Service</strong> refers to the Website and related forms made available through the Website.</li><li><strong>Terms and Conditions</strong> (also referred to as "Terms") mean these Terms and Conditions that govern use of the Service.</li><li><strong>Website</strong> refers to Dr. Lurié, accessible from <a href="https://drluriescience.netlify.app">https://drluriescience.netlify.app</a>.</li><li><strong>You</strong> means the individual accessing or using the Service, or the company or other legal entity on behalf of which such individual accesses or uses the Service.</li></ul><h2>Acknowledgment</h2><p>These Terms govern Your use of the Service and set out the rights and obligations of visitors who access or use the Website.</p><p>By accessing or using the Service, You agree to be bound by these Terms. If You disagree with any part of these Terms, You should not use the Service.</p><p>The Website provides educational content about aging skin, age-related scent changes, skincare science, and future Dr. Lurié product updates. The Service is for informational purposes only and is not medical advice, diagnosis, or treatment. You should consult a qualified healthcare professional for personal medical concerns.</p><p>Your use of the Service is also subject to Our Privacy Policy, which describes how We collect and use information submitted through the Website\'s forms and related Netlify Function opt-in capture.</p><h2>Website Forms and Early Access</h2><p>The Website may include contact, free-guide, newsletter, or early-access paths. When You submit a form, You agree that We may use the information You provide to respond to Your inquiry, send the requested resource, manage newsletter or early-access communications, and maintain records of the consent or opt-in metadata associated with that submission.</p><p>Submitting a form does not create a patient-provider relationship, professional advisory relationship, partnership, or purchase agreement with the Company.</p><h2>Product Availability</h2><p>Some Website content may describe products, research directions, or concepts that are in development. Unless expressly stated otherwise, these references are previews only and do not guarantee that any product, feature, launch date, price, claim, or availability will occur.</p><h2>Intellectual Property</h2><p>The Service and its original content, branding, design, features, and functionality are and will remain the property of the Company or its licensors. You may not copy, reproduce, distribute, modify, or create derivative works from Website content without prior written permission, except for personal, non-commercial use or as otherwise permitted by law.</p><h2>Links to Other Websites</h2><p>Our Service may contain links to third-party websites or services that are not owned or controlled by the Company.</p><p>The Company has no control over, and assumes no responsibility for, the content, privacy policies, or practices of third-party websites or services. We strongly advise You to read the terms and privacy policies of any third-party websites or services You visit.</p><h2>Termination</h2><p>We may terminate or suspend access to the Service immediately, without prior notice or liability, for any reason, including if You breach these Terms.</p><h2>Limitation of Liability</h2><p>To the maximum extent permitted by applicable law, the Company and its suppliers will not be liable for any indirect, incidental, special, consequential, or punitive damages arising out of or related to Your use of, or inability to use, the Service.</p><p>Because the Website is currently informational and does not operate a checkout or paid account system, the Company\'s aggregate liability for claims related to the Service will be limited to 100 USD unless a different limit is required by applicable law.</p><h2>"AS IS" and "AS AVAILABLE" Disclaimer</h2><p>The Service is provided to You "AS IS" and "AS AVAILABLE" without warranty of any kind. The Company does not warrant that the Service will be uninterrupted, error-free, secure, or available at any particular time or location.</p><p>The Company does not warrant that educational content will be complete, current, or suitable for Your individual health circumstances. You are responsible for evaluating the information and seeking professional advice when appropriate.</p><h2>Governing Law</h2><p>The laws of the Country, excluding conflict-of-law rules, will govern these Terms and Your use of the Service, except where applicable law requires otherwise.</p><h2>Dispute Resolution</h2><p>If You have any concern or dispute about the Service, You agree to first try to resolve the dispute informally by contacting Us through the Website contact form.</p><h2>Changes to These Terms</h2><p>We may modify or replace these Terms at any time by posting an updated version on this page. Changes are effective when posted unless a later effective date is stated.</p><p>By continuing to access or use the Service after revisions become effective, You agree to be bound by the revised Terms.</p><h2>Contact Us</h2><p>If You have any questions about these Terms, You can contact Us through the contact form on the Website:</p><ul><li>Website: <a href="https://drluriescience.netlify.app/contact">https://drluriescience.netlify.app/contact</a></li></ul>\n',
          },
          id: 's_terms',
          type: 'prose',
        },
      ],
      seo: {
        description: 'Terms governing use of the Dr. Lurié website and its forms.',
        robots: {
          follow: true,
          index: true,
        },
      },
      title: 'Terms and Conditions',
    },
  },
  {
    objectId: 'page_404',
    body: {
      pageType: 'system',
      route: '/404',
      sections: [
        {
          data: {
            actions: [
              {
                label: 'Back to homepage',
                style: 'primary',
                target: {
                  href: '/',
                  kind: 'route',
                },
              },
            ],
            body: '<p>But don’t worry, you can find plenty of other things on our homepage.</p>',
            heading: "Sorry, we couldn't find this page.",
          },
          id: 's_404',
          type: 'cta_banner',
        },
      ],
      seo: {
        description: 'The page you are looking for could not be found.',
        robots: {
          follow: true,
          index: true,
        },
      },
      title: 'Page Not Found',
    },
  },
];

export const CONVERSION_SEEDS = [
  ...LEDE_FAMILY_SEEDS.map((seed) => ({ objectType: 'page', objectId: seed.objectId, body: seed.body })),
  ...SYSTEM_PAGE_SEEDS.map((seed) => ({ objectType: 'page', objectId: seed.objectId, body: seed.body })),
];
