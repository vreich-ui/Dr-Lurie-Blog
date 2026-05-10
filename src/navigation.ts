import { getPermalink, getBlogPermalink, getAsset } from './utils/permalinks';
import type { CallToAction } from './types';

export const headerData = {
  links: [
    {
      text: 'Start Here',
      href: getPermalink('/'),
      links: [
        {
          text: 'Home',
          href: getPermalink('/'),
          description: 'A science-first overview of what changes in skin after 60.',
        },
        {
          text: 'About Dr. Lurié',
          href: getPermalink('/about'),
          description: 'Meet the biophysicist behind the age-aware approach.',
        },
      ],
    },
    {
      text: 'Learn',
      href: getBlogPermalink(),
      links: [
        {
          text: 'Education Library',
          href: getBlogPermalink(),
          description: 'Browse all skin science articles and practical explainers.',
        },
        {
          text: 'Topics',
          href: getPermalink('/topics'),
          description: 'Explore articles grouped by age-related skin and scent themes.',
        },
        {
          text: 'Free Guide',
          href: getPermalink('/#guide'),
          description: 'Get the structured guide to aging skin and body odor changes.',
        },
      ],
    },
    {
      text: 'Solutions',
      href: getPermalink('/shop'),
      links: [
        {
          text: 'Shop Preview',
          href: getPermalink('/shop'),
          description: 'See the upcoming age-aware skincare product direction.',
        },
        {
          text: 'Early Access',
          href: getPermalink('/#early-access'),
          description: 'Join updates as research-led solutions become available.',
        },
      ],
    },
  ],
  actions: [
    { text: 'Admin', href: getPermalink('/admin/publish'), variant: 'secondary' } satisfies CallToAction,
    { text: 'Join Early Access', href: getPermalink('/#early-access'), variant: 'primary' } satisfies CallToAction,
  ],
};

export const footerData = {
  links: [
    {
      title: 'Explore',
      links: [
        { text: 'Home', href: getPermalink('/') },
        { text: 'About', href: getPermalink('/about') },
        { text: 'Education', href: getBlogPermalink() },
        { text: 'Topics', href: getPermalink('/topics') },
      ],
    },
    {
      title: 'Next steps',
      links: [
        { text: 'Free Guide', href: getPermalink('/#guide') },
        { text: 'Shop Preview', href: getPermalink('/shop') },
        { text: 'Early Access', href: getPermalink('/#early-access') },
        { text: 'Contact', href: getPermalink('/contact') },
      ],
    },
  ],
  secondaryLinks: [
    { text: 'Terms', href: getPermalink('/terms') },
    { text: 'Privacy Policy', href: getPermalink('/privacy') },
  ],
  socialLinks: [{ ariaLabel: 'RSS', icon: 'tabler:rss', href: getAsset('/rss.xml') }],
  footNote: `
    Educational content only — not medical advice. © Dr. Lurié.
  `,
};
