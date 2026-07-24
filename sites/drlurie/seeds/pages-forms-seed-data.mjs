/**
 * Seed data for the two form pages (W2, 2026-07-11) — the last bespoke
 * per-page section types retired.
 *
 * Both pages decompose off their one-page anti-pattern types into REUSABLE
 * generic sections an agent can edit, reorder, or reuse elsewhere
 * (design-principles rule 1), mirroring the /about decomposition:
 *
 *   page_contact  (standard)  lede + contact_form + content_grid(cards)
 *     - the bespoke `contact` type (HeroText/Contact/Features2 hardcoded into
 *       one section) is RETIRED. The hero heading → `lede`; the Netlify form →
 *       the generic `contact_form` (now carrying optional subtitle/description);
 *       the "How we can help" icon grid → a `content_grid` `cards` source whose
 *       cells gained an optional `icon`.
 *   page_thank_you (standard)  form_confirmation
 *     - the `thank_you` type was RENAMED to `form_confirmation` (the reusable
 *       post-submit confirmation type; today's /thank-you is one instance). The
 *       data shape and the ?form= swap script are unchanged.
 *
 * Sections stay INLINE in each page (page-specific copy — the home page kept its
 * hero/bio inline the same way); no new shared `section` objects. Section ids
 * are `s_<alnum>` (no underscores). This is a rule-4 flexible cutover, not a
 * byte-identical one: the generic components render differently than the old
 * marketing widgets, so a SCOPED build-diff on /contact and /thank-you is
 * expected and reviewed (Wolf, 2026-07-11).
 *
 * Driver contract for scripts/home-conversion-roundtrip.mjs:
 *   --seeds scripts/lib/pages-forms-seed-data.mjs
 */

export const SEED_SITE = 'site_drlurie';

// ─── page_contact ─────────────────────────────────────────────────────────────

export const pageContactBody = {
  route: '/contact',
  pageType: 'standard',
  title: 'Contact',
  seo: {},
  sections: [
    {
      id: 's_contactlede',
      type: 'lede',
      data: { kicker: 'Contact', heading: 'Connect with Dr. Lurié', actions: [] },
    },
    {
      id: 's_contactform',
      type: 'contact_form',
      data: {
        formName: 'contact',
        heading: 'Send a note to the Dr. Lurié team',
        subtitle:
          'Use this form for education questions, early-access and product-update requests, or media and partnership inquiries. We do not provide medical advice through this form.',
        description: 'We review messages submitted through the website contact form and respond when appropriate.',
        disclaimer:
          'By submitting this contact form, you acknowledge and agree to the collection of your personal information as described in the Privacy Policy.',
      },
    },
    {
      id: 's_contactgrid',
      type: 'content_grid',
      data: {
        heading: 'How we can help',
        source: {
          kind: 'cards',
          cards: [
            {
              icon: 'tabler:school',
              title: 'Education questions',
              description:
                'Ask about Dr. Lurié educational content on aging skin, age-related scent changes, barrier function, and skincare science. This is educational only and not medical advice.',
            },
            {
              icon: 'tabler:sparkles',
              title: 'Early access and product updates',
              description:
                'Request updates on research notes, guide availability, product previews, and future age-aware skincare launch announcements.',
            },
            {
              icon: 'tabler:microphone-2',
              title: 'Media inquiries',
              description:
                'Reach out for interview requests, expert commentary, podcast opportunities, or citation questions related to Dr. Lurié topics.',
            },
            {
              icon: 'tabler:heart-handshake',
              title: 'Partnership inquiries',
              description:
                'Contact us about aligned education, research, product-development, or distribution conversations.',
            },
            {
              icon: 'tabler:message-circle',
              title: 'Primary contact',
              description:
                'Please use the contact form on this page so your message reaches the right Dr. Lurié workflow.',
            },
            {
              icon: 'tabler:world',
              title: 'Website',
              description: 'https://drluriescience.netlify.app',
            },
          ],
        },
        limit: 6,
      },
    },
  ],
};

// ─── page_thank_you ───────────────────────────────────────────────────────────

export const pageThankYouBody = {
  route: '/thank-you',
  pageType: 'standard',
  title: 'Thank You',
  seo: { description: 'Thank you for connecting with Dr. Lurié.' },
  sections: [
    {
      id: 's_thankyou',
      type: 'form_confirmation',
      data: {
        eyebrow: 'Submission received',
        heading: 'Thank you for connecting with Dr. Lurié.',
        message:
          'Your submission has been received. We appreciate your interest in age-aware skin education and will follow up when appropriate.',
        formMessages: [
          {
            form: 'contact',
            heading: 'Thank you for reaching out.',
            message:
              'Your message has been received. The Dr. Lurié team will review it and follow up when appropriate.',
          },
          {
            form: 'free-guide',
            heading: 'Your free guide request is in.',
            message:
              'Thank you for requesting the Senior’s Guide to Aging Skin & Body Odor. Please check your inbox for next steps.',
          },
          {
            form: 'newsletter',
            heading: 'You’re on the list.',
            message:
              'Thank you for joining Dr. Lurié updates. We’ll send practical, science-led notes about aging skin changes.',
          },
        ],
        actions: [
          { label: 'Return Home', style: 'primary', target: { kind: 'route', href: '/' } },
          { label: 'Explore Skin Science', style: 'secondary', target: { kind: 'route', href: '/learn/topics' } },
        ],
      },
    },
  ],
};

// ─── driver contract ─────────────────────────────────────────────────────────

export const CONVERSION_SEEDS = [
  { objectType: 'page', objectId: 'page_contact', body: pageContactBody },
  { objectType: 'page', objectId: 'page_thank_you', body: pageThankYouBody },
];
