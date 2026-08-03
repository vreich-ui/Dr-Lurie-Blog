/**
 * Scale known source dimensions to a responsive image breakpoint.
 *
 * Astro can infer dimensions from imported image metadata, but public or
 * remote string paths must receive both width and height. Keeping this pure
 * calculation outside the optimizer makes that contract explicit and keeps
 * the Astro and CDN optimizer paths aligned.
 */
export const imageDimensionsAtBreakpoint = (
  breakpointWidth: number,
  sourceWidth?: number,
  sourceHeight?: number
): { width: number; height?: number } => ({
  width: breakpointWidth,
  ...(sourceWidth && sourceHeight ? { height: Math.floor(breakpointWidth / (sourceWidth / sourceHeight)) } : {}),
});
