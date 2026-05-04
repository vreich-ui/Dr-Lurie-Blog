import { getPermalink, getBlogPermalink, getAsset } from './utils/permalinks';

export const headerData = {
  links: [
    {
      text: 'Home',
      href: getPermalink('/'),
    },
    {
      text: 'About',
      href: getPermalink('/about'),
    },
    {
      text: 'Education',
      href: getBlogPermalink(),
    },
    {
      text: 'Early Access',
      href: getPermalink('/#early-access'),
    },
    {
      text: 'Free Guide',
      href: getPermalink('/#guide'),
    },
  ],
  actions: [{ text: 'Join Early Access', href: getPermalink('/#early-access') }],
};

export const footerData = {
  links: [
    {
      title: 'Explore',
      links: [
        { text: 'Home', href: getPermalink('/') },
        { text: 'About', href: getPermalink('/about') },
        { text: 'Education', href: getBlogPermalink() },
        { text: 'Early Access', href: getPermalink('/#early-access') },
        { text: 'Free Guide', href: getPermalink('/#guide') },
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
