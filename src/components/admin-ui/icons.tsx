/**
 * Inline tabler-style line icons for the admin kit (T9.2).
 *
 * The public site uses astro-icon, which can't render inside React islands, so
 * the kit ships its own tiny hand-rolled SVG set — stroke `currentColor`, 24
 * viewBox, round caps/joins — matching the tabler visual language without a
 * dependency. `aria-hidden` by default; give a `title` for a labeled icon.
 */
import type { SVGProps } from 'react';

export interface IconProps extends SVGProps<SVGSVGElement> {
  size?: number;
  title?: string;
}

function IconBase({ size = 20, title, children, ...rest }: IconProps & { children: React.ReactNode }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden={title ? undefined : true}
      role={title ? 'img' : undefined}
      focusable="false"
      {...rest}
    >
      {title ? <title>{title}</title> : null}
      {children}
    </svg>
  );
}

export const IconCheck = (p: IconProps) => (
  <IconBase {...p}>
    <path d="M5 12l5 5L20 7" />
  </IconBase>
);
export const IconX = (p: IconProps) => (
  <IconBase {...p}>
    <path d="M6 6l12 12M18 6L6 18" />
  </IconBase>
);
export const IconChevronDown = (p: IconProps) => (
  <IconBase {...p}>
    <path d="M6 9l6 6 6-6" />
  </IconBase>
);
export const IconChevronRight = (p: IconProps) => (
  <IconBase {...p}>
    <path d="M9 6l6 6-6 6" />
  </IconBase>
);
export const IconChevronUp = (p: IconProps) => (
  <IconBase {...p}>
    <path d="M6 15l6-6 6 6" />
  </IconBase>
);
export const IconSelector = (p: IconProps) => (
  <IconBase {...p}>
    <path d="M8 9l4-4 4 4M8 15l4 4 4-4" />
  </IconBase>
);
export const IconSearch = (p: IconProps) => (
  <IconBase {...p}>
    <circle cx="11" cy="11" r="7" />
    <path d="M21 21l-4.3-4.3" />
  </IconBase>
);
export const IconPlus = (p: IconProps) => (
  <IconBase {...p}>
    <path d="M12 5v14M5 12h14" />
  </IconBase>
);
export const IconTrash = (p: IconProps) => (
  <IconBase {...p}>
    <path d="M4 7h16M10 11v6M14 11v6M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12M9 7V4h6v3" />
  </IconBase>
);
export const IconLock = (p: IconProps) => (
  <IconBase {...p}>
    <rect x="5" y="11" width="14" height="9" rx="2" />
    <path d="M8 11V7a4 4 0 0 1 8 0v4" />
  </IconBase>
);
export const IconPencil = (p: IconProps) => (
  <IconBase {...p}>
    <path d="M4 20h4L19 9l-4-4L4 16v4z" />
    <path d="M13.5 6.5l4 4" />
  </IconBase>
);
export const IconExternalLink = (p: IconProps) => (
  <IconBase {...p}>
    <path d="M14 4h6v6M20 4l-8 8" />
    <path d="M18 13v6a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h6" />
  </IconBase>
);
export const IconAlertTriangle = (p: IconProps) => (
  <IconBase {...p}>
    <path d="M12 4l9 16H3z" />
    <path d="M12 10v4M12 17h.01" />
  </IconBase>
);
export const IconInfo = (p: IconProps) => (
  <IconBase {...p}>
    <circle cx="12" cy="12" r="9" />
    <path d="M12 11v5M12 8h.01" />
  </IconBase>
);
export const IconDots = (p: IconProps) => (
  <IconBase {...p}>
    <path d="M12 6h.01M12 12h.01M12 18h.01" />
  </IconBase>
);
export const IconClock = (p: IconProps) => (
  <IconBase {...p}>
    <circle cx="12" cy="12" r="9" />
    <path d="M12 8v4l3 2" />
  </IconBase>
);
