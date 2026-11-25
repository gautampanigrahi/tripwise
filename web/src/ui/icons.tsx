import type { SVGProps } from "react";

/** Small inline SVG icons (no icon library). Decorative by default (`aria-hidden`). */
export type IconProps = SVGProps<SVGSVGElement> & { size?: number };

function Svg({ size = 16, children, ...rest }: IconProps) {
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
      aria-hidden="true"
      focusable="false"
      {...rest}
    >
      {children}
    </svg>
  );
}

export const CloseIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M18 6 6 18M6 6l12 12" />
  </Svg>
);

export const CheckIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M20 6 9 17l-5-5" />
  </Svg>
);

export const CheckCircleIcon = (p: IconProps) => (
  <Svg {...p}>
    <circle cx="12" cy="12" r="10" />
    <path d="m8 12 3 3 5-6" />
  </Svg>
);

export const AlertCircleIcon = (p: IconProps) => (
  <Svg {...p}>
    <circle cx="12" cy="12" r="10" />
    <path d="M12 8v4M12 16h.01" />
  </Svg>
);

export const InfoIcon = (p: IconProps) => (
  <Svg {...p}>
    <circle cx="12" cy="12" r="10" />
    <path d="M12 16v-4M12 8h.01" />
  </Svg>
);

export const PlusIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M12 5v14M5 12h14" />
  </Svg>
);

export const ChevronRightIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="m9 18 6-6-6-6" />
  </Svg>
);

export const InboxIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M22 12h-6l-2 3h-4l-2-3H2" />
    <path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z" />
  </Svg>
);

export const LogOutIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9" />
  </Svg>
);

export const SpinnerIcon = ({ className, ...p }: IconProps) => (
  <Svg className={className ? `spinner ${className}` : "spinner"} {...p}>
    <path d="M21 12a9 9 0 1 1-6.22-8.56" />
  </Svg>
);

/** TripWise logo mark: a map pin over a route line. */
export const LogoMark = ({ size = 24, ...rest }: IconProps) => (
  <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden="true" focusable="false" {...rest}>
    <rect width="32" height="32" rx="8" fill="currentColor" />
    <path d="M8 23c3-1 5-3 8-3s5 2 8 0" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round" opacity="0.7" />
    <path d="M16 6.5a5.5 5.5 0 0 0-5.5 5.5c0 4 5.5 8.5 5.5 8.5s5.5-4.5 5.5-8.5A5.5 5.5 0 0 0 16 6.5z" fill="#fff" />
    <circle cx="16" cy="12" r="2" fill="currentColor" />
  </svg>
);
